/**
 * The fixed-capacity transit slot pool: the five-state ownership machine, the generation guard,
 * the lazy deadline sweep, bounded re-minting and the backpressure/stats bookkeeping described
 * by `buffer-ownership-protocol` and `transport-backpressure`. This module knows nothing about
 * decimation — `sync-port.ts` is the thin layer that drives real work through it.
 */
import {
  type Lease,
  type Saturated,
  SATURATED,
  SlotState,
  packLease,
  unpackGeneration,
  unpackSlot,
} from "./ownership.js";
import {
  type TransportStatsView,
  StatCounter,
  StatGauge,
  createTransportStatsView,
  deriveHealth,
  readStatsInto,
} from "./backpressure.js";
import { FailureReason, type SettlementSink } from "./decimation-port.js";
import { MAX_BUCKETS } from "./streaming-contract.js";
import { BufferBacking, detectTransportCapabilities, selectBufferBacking } from "./capabilities.js";

/** `poolPairs` is clamped to this range: the lease packs the slot index into a 3-bit field. */
const MIN_POOL_PAIRS = 1;
const MAX_POOL_PAIRS = 8;

const DEFAULT_TRANSIT_CAPACITY_SAMPLES = 65_536;
const DEFAULT_LEASE_TIMEOUT_MS = 1000;
const DEFAULT_MAX_REMINT_EVENTS = 8;
const DEFAULT_STALL_DROP_THRESHOLD = 120;

export interface BufferPoolConfig {
  poolPairs?: number;
  transitCapacitySamples?: number;
  leaseTimeoutMs?: number;
  maxRemintEvents?: number;
  stallDropThreshold?: number;
  /** Test-only seam: overrides the isomorphic time source. */
  now?: () => number;
}

export interface ReplacementViews {
  x: Float32Array;
  y: Float32Array;
  out: Float32Array;
  indices: Int32Array;
}

export interface BufferPool {
  readonly poolPairs: number;
  readonly transitCapacitySamples: number;

  acquire(): Lease<"acquired"> | Saturated;

  viewX(lease: number): Float32Array;
  viewY(lease: number): Float32Array;
  viewOut(lease: number): Float32Array;
  viewIndices(lease: number): Int32Array;

  submit(lease: Lease<"acquired">): Lease<"inflight"> | Saturated;
  /**
   * Test/transfer-mode entry point: settles an in-flight lease, optionally replacing the slot's
   * views (the new `ArrayBuffer` objects a real transfer-back round trip would hand back).
   */
  settle(
    lease: Lease<"inflight">,
    outCount: number,
    replacement?: ReplacementViews,
  ): void;
  poll(sink: SettlementSink): number;
  release(lease: Lease<"acquired"> | Lease<"settled">): void;

  reportResponderFailure(reason: FailureReason): void;
  noteDroppedSamples(count: number): void;
  readStats(out: TransportStatsView): void;
  dispose(): void;

  /** Test-only introspection: never part of the public `@trace-kit/core` export surface. */
  __debugState(lease: number): SlotState;
  __debugGeneration(slot: number): number;
  /** Test-only introspection: the deadline sweep's scratch buffer, identity-stable across every
   *  call for the pool's whole lifetime — proves the sweep never allocates one per call. */
  __debugSweepScratchRef(): unknown;
  /** Test-only introspection: the `BufferBacking` selected at construction. Never part of the
   *  public `DecimationPort` surface — the backing choice stays an internal detail. */
  __debugBacking(): BufferBacking;
}

function defaultNow(): number {
  // The presence check lives inside this function body on every call — never cached at module
  // scope, and never hoisted to a top-level reference — evaluating it once at import time would
  // freeze the answer from whichever realm happened to load the module first, which is wrong
  // the moment this code is bundled once and run in more than one realm.
  const g: typeof globalThis = globalThis;
  const perf = (g as { performance?: { now?: () => number } }).performance;
  if (perf !== undefined && typeof perf.now === "function") {
    return perf.now();
  }
  return Date.now();
}

function clampPoolPairs(value: number | undefined): number {
  const requested = value ?? 3;
  if (requested < MIN_POOL_PAIRS) return MIN_POOL_PAIRS;
  if (requested > MAX_POOL_PAIRS) return MAX_POOL_PAIRS;
  return requested;
}

export function createBufferPool(config: BufferPoolConfig = {}): BufferPool {
  const poolPairs = clampPoolPairs(config.poolPairs);
  const transitCapacitySamples =
    config.transitCapacitySamples ?? DEFAULT_TRANSIT_CAPACITY_SAMPLES;
  const leaseTimeoutMs = config.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;
  const maxRemintEvents = config.maxRemintEvents ?? DEFAULT_MAX_REMINT_EVENTS;
  const stallDropThreshold =
    config.stallDropThreshold ?? DEFAULT_STALL_DROP_THRESHOLD;
  const now = config.now ?? defaultNow;
  // Selected once at construction from live detection, never branched on again: the backing
  // choice only changes which internal code path moves the bytes; it never gates a
  // feature or changes an observable counter, stat, or Health transition.
  const backing = selectBufferBacking(detectTransportCapabilities());

  const states = new Int32Array(poolPairs).fill(SlotState.Free);
  const generations = new Int32Array(poolPairs);
  const dispatchTimestamps = new Float64Array(poolPairs);

  const xViews: Float32Array[] = [];
  const yViews: Float32Array[] = [];
  const outViews: Float32Array[] = [];
  const indexViews: Int32Array[] = [];
  for (let slot = 0; slot < poolPairs; slot += 1) {
    xViews.push(new Float32Array(transitCapacitySamples));
    yViews.push(new Float32Array(transitCapacitySamples));
    outViews.push(new Float32Array(MAX_BUCKETS * 2));
    indexViews.push(new Int32Array(MAX_BUCKETS));
  }

  const sentinelF32 = new Float32Array(0);
  const sentinelI32 = new Int32Array(0);

  const settlementLeases = new Int32Array(poolPairs);
  const settlementOutCounts = new Int32Array(poolPairs);
  let settlementHead = 0;
  let settlementCount = 0;

  // Reused across every `sweepDeadlines()` call (itself run inside `acquire()`/`poll()`, i.e. on
  // every hot-path entry) so a timeout never allocates: the pool owns one scratch buffer sized
  // to `poolPairs` at construction and each sweep just overwrites its live prefix, tracked by
  // `timedOutCount` rather than by reallocating or slicing. `sweepDeadlines` never re-enters
  // itself (JS has no preemption, and nothing on its call path calls back into it), so a single
  // instance-owned buffer is safe without per-call isolation.
  const timedOutScratch = new Int32Array(poolPairs);

  const stats = createTransportStatsView();
  let disposed = false;
  let degraded = false;
  let remintEventCount = 0;

  function lostSlotCount(): number {
    let count = 0;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] === SlotState.Lost) count += 1;
    }
    return count;
  }

  function updateHealth(): void {
    const health = deriveHealth({
      remintCapReached: degraded,
      hasLostSlot: lostSlotCount() > 0,
      consecutiveDrops: stats.counters[StatCounter.ConsecutiveDrops] ?? 0,
      stallDropThreshold,
    });
    stats.counters[StatCounter.Health] = health;
  }

  const INVALID_SLOT = -1;

  function isSlotValid(lease: number, expectedState: SlotState): number {
    const slot = unpackSlot(lease);
    if (slot < 0 || slot >= poolPairs) return INVALID_SLOT;
    if (states[slot] !== expectedState) return INVALID_SLOT;
    if (unpackGeneration(lease) !== generations[slot]) return INVALID_SLOT;
    return slot;
  }

  /** Accepts either `Acquired` or `Settled` — the two readable phases. */
  function isReadableSlot(lease: number): number {
    const slot = unpackSlot(lease);
    if (slot < 0 || slot >= poolPairs) return INVALID_SLOT;
    const state = states[slot];
    if (state !== SlotState.Acquired && state !== SlotState.Settled) return INVALID_SLOT;
    if (unpackGeneration(lease) !== generations[slot]) return INVALID_SLOT;
    return slot;
  }

  function sweepDeadlines(): void {
    if (disposed) return;
    let timedOutCount = 0;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] !== SlotState.InFlight) continue;
      if (now() - dispatchTimestamps[slot]! >= leaseTimeoutMs) {
        timedOutScratch[timedOutCount] = slot;
        timedOutCount += 1;
      }
    }
    if (timedOutCount === 0) return;
    stats.counters[StatCounter.ResponderFailures] =
      (stats.counters[StatCounter.ResponderFailures] ?? 0) + 1;
    failSlots(timedOutScratch, timedOutCount);
    updateHealth();
  }

  function failSlots(slots: Int32Array, count: number): void {
    for (let i = 0; i < count; i += 1) {
      states[slots[i]!] = SlotState.Lost;
    }
    if (count === 0) return;
    if (remintEventCount >= maxRemintEvents) {
      degraded = true;
      return;
    }
    remintEventCount += 1;
    for (let i = 0; i < count; i += 1) {
      const slot = slots[i]!;
      // Re-minting is bounded by `maxRemintEvents`: a buffer in a dead realm (its context lost
      // to a crashed or reloaded responder) cannot be reused, so a fresh backing store is the
      // only recovery available, and the bound exists so a responder stuck in a crash loop
      // degrades the pool once rather than leaking allocations without limit.
      xViews[slot] = new Float32Array(transitCapacitySamples);
      yViews[slot] = new Float32Array(transitCapacitySamples);
      outViews[slot] = new Float32Array(MAX_BUCKETS * 2);
      indexViews[slot] = new Int32Array(MAX_BUCKETS);
      generations[slot] = (generations[slot] ?? 0) + 1;
      states[slot] = SlotState.Free;
    }
    stats.counters[StatCounter.RemintEvents] =
      (stats.counters[StatCounter.RemintEvents] ?? 0) + count;
  }

  const pool: BufferPool = {
    poolPairs,
    transitCapacitySamples,

    acquire(): Lease<"acquired"> | Saturated {
      if (disposed) return SATURATED;
      sweepDeadlines();

      let freeSlot = -1;
      for (let slot = 0; slot < poolPairs; slot += 1) {
        if (states[slot] === SlotState.Free) {
          freeSlot = slot;
          break;
        }
      }

      if (freeSlot === -1) {
        stats.counters[StatCounter.ChunksDropped] =
          (stats.counters[StatCounter.ChunksDropped] ?? 0) + 1;
        const nextConsecutive =
          (stats.counters[StatCounter.ConsecutiveDrops] ?? 0) + 1;
        stats.counters[StatCounter.ConsecutiveDrops] = nextConsecutive;
        if (nextConsecutive > (stats.counters[StatCounter.MaxConsecutiveDrops] ?? 0)) {
          stats.counters[StatCounter.MaxConsecutiveDrops] = nextConsecutive;
        }
        if (nextConsecutive === 1) {
          stats.counters[StatCounter.PoolExhaustionEvents] =
            (stats.counters[StatCounter.PoolExhaustionEvents] ?? 0) + 1;
        }
        updateHealth();
        return SATURATED;
      }

      states[freeSlot] = SlotState.Acquired;
      stats.counters[StatCounter.ChunksAccepted] =
        (stats.counters[StatCounter.ChunksAccepted] ?? 0) + 1;
      stats.counters[StatCounter.ConsecutiveDrops] = 0;
      stats.gauges[StatGauge.LastAcceptMs] = now();
      updateHealth();
      return packLease<"acquired">(freeSlot, generations[freeSlot] ?? 0);
    },

    viewX(lease: number): Float32Array {
      const slot = isReadableSlot(lease);
      if (slot === -1) {
        stats.counters[StatCounter.OwnershipViolations] =
          (stats.counters[StatCounter.OwnershipViolations] ?? 0) + 1;
        return sentinelF32;
      }
      return xViews[slot]!;
    },

    viewY(lease: number): Float32Array {
      const slot = isReadableSlot(lease);
      if (slot === -1) {
        stats.counters[StatCounter.OwnershipViolations] =
          (stats.counters[StatCounter.OwnershipViolations] ?? 0) + 1;
        return sentinelF32;
      }
      return yViews[slot]!;
    },

    viewOut(lease: number): Float32Array {
      const slot = isReadableSlot(lease);
      if (slot === -1) {
        stats.counters[StatCounter.OwnershipViolations] =
          (stats.counters[StatCounter.OwnershipViolations] ?? 0) + 1;
        return sentinelF32;
      }
      return outViews[slot]!;
    },

    viewIndices(lease: number): Int32Array {
      const slot = isReadableSlot(lease);
      if (slot === -1) {
        stats.counters[StatCounter.OwnershipViolations] =
          (stats.counters[StatCounter.OwnershipViolations] ?? 0) + 1;
        return sentinelI32;
      }
      return indexViews[slot]!;
    },

    submit(lease: Lease<"acquired">): Lease<"inflight"> | Saturated {
      const slot = isSlotValid(lease, SlotState.Acquired);
      if (slot === -1) {
        stats.counters[StatCounter.OwnershipViolations] =
          (stats.counters[StatCounter.OwnershipViolations] ?? 0) + 1;
        // A double submit (or any other invalid lease) is a counted no-op, not a throw: the
        // caller already holds a stale handle, so there is no in-flight lease to honestly
        // return. Mirrors acquire()'s own SATURATED-on-failure shape instead of reinterpreting
        // the caller's stale acquired-phase value as a different phase.
        return SATURATED;
      }
      states[slot] = SlotState.InFlight;
      dispatchTimestamps[slot] = now();
      stats.gauges[StatGauge.LastSubmitMs] = now();
      updateHealth();
      return packLease<"inflight">(slot, generations[slot] ?? 0);
    },

    settle(
      lease: Lease<"inflight">,
      outCount: number,
      replacement?: ReplacementViews,
    ): void {
      const slot = isSlotValid(lease, SlotState.InFlight);
      if (slot === -1) {
        stats.counters[StatCounter.StaleSettlements] =
          (stats.counters[StatCounter.StaleSettlements] ?? 0) + 1;
        return;
      }
      if (replacement !== undefined) {
        xViews[slot] = replacement.x;
        yViews[slot] = replacement.y;
        outViews[slot] = replacement.out;
        indexViews[slot] = replacement.indices;
      }
      states[slot] = SlotState.Settled;
      const writeIndex = (settlementHead + settlementCount) % poolPairs;
      settlementLeases[writeIndex] = lease;
      settlementOutCounts[writeIndex] = outCount;
      settlementCount += 1;
      updateHealth();
    },

    poll(sink: SettlementSink): number {
      sweepDeadlines();
      let drained = 0;
      while (settlementCount > 0) {
        const lease = settlementLeases[settlementHead]!;
        const outCount = settlementOutCounts[settlementHead]!;
        settlementHead = (settlementHead + 1) % poolPairs;
        settlementCount -= 1;
        drained += 1;
        sink.onSettled(lease as Lease<"settled">, outCount);
      }
      return drained;
    },

    release(lease: Lease<"acquired"> | Lease<"settled">): void {
      const slot = isReadableSlot(lease);
      if (slot === -1) {
        stats.counters[StatCounter.OwnershipViolations] =
          (stats.counters[StatCounter.OwnershipViolations] ?? 0) + 1;
        return;
      }
      states[slot] = SlotState.Free;
      updateHealth();
    },

    reportResponderFailure(reason: FailureReason): void {
      void reason; // reserved for a future change-8 adapter; this pool moves every InFlight slot regardless of the specific reason.
      if (disposed) return;
      let inFlightCount = 0;
      for (let slot = 0; slot < poolPairs; slot += 1) {
        if (states[slot] === SlotState.InFlight) {
          timedOutScratch[inFlightCount] = slot;
          inFlightCount += 1;
        }
      }
      stats.counters[StatCounter.ResponderFailures] =
        (stats.counters[StatCounter.ResponderFailures] ?? 0) + 1;
      failSlots(timedOutScratch, inFlightCount);
      updateHealth();
    },

    noteDroppedSamples(count: number): void {
      stats.counters[StatCounter.SamplesDropped] =
        (stats.counters[StatCounter.SamplesDropped] ?? 0) + count;
    },

    readStats(out: TransportStatsView): void {
      readStatsInto(stats, out);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (let slot = 0; slot < poolPairs; slot += 1) {
        if (states[slot] !== SlotState.Free) {
          states[slot] = SlotState.Lost;
        }
      }
      degraded = true;
      updateHealth();
    },

    __debugState(lease: number): SlotState {
      const slot = unpackSlot(lease);
      return states[slot] as SlotState;
    },
    __debugGeneration(slot: number): number {
      return generations[slot] ?? 0;
    },
    __debugSweepScratchRef(): unknown {
      return timedOutScratch;
    },
    __debugBacking(): BufferBacking {
      return backing;
    },
  };

  updateHealth();
  return pool;
}
