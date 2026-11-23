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

export interface SlotViews {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly out: Float32Array;
  readonly indices: Int32Array;
}

export interface ReplacementViews {
  x: Float32Array;
  y: Float32Array;
  out?: Float32Array;
  indices?: Int32Array;
}

/**
 * Strictly internal hook options passed by `createWorkerDecimationPort`. Never re-exported from
 * `@trace-kit/core` and never merged into `BufferPoolConfig`.
 */
export interface BufferPoolInternalOptions {
  readonly backing?: BufferBacking;
  readonly allocateSlotViews?: (slot: number) => SlotViews;
  readonly onResponderFailure?: (reason: FailureReason, willRemint: boolean) => void;
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

  /** Internal helper: returns true iff `lease` matches a live `InFlight` slot + generation. */
  isInFlightLease(lease: number): boolean;
  /** Internal helper: records a stale reply dropped before view construction. */
  noteStaleSettlement(): void;
  /** Internal helper: rebinds every slot's views and updates active backing (e.g. clone fallback). */
  rebindSlotViews(allocate: (slot: number) => SlotViews, newBacking: BufferBacking): void;
  /** Internal helper: replaces a single slot's views in place (e.g. cross-epoch SAB migration). */
  replaceSlotViews(slot: number, views: SlotViews): void;

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

export function createBufferPool(
  config: BufferPoolConfig = {},
  internal?: BufferPoolInternalOptions,
): BufferPool {
  const poolPairs = clampPoolPairs(config.poolPairs);
  const transitCapacitySamples =
    config.transitCapacitySamples ?? DEFAULT_TRANSIT_CAPACITY_SAMPLES;
  const leaseTimeoutMs = config.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;
  const maxRemintEvents = config.maxRemintEvents ?? DEFAULT_MAX_REMINT_EVENTS;
  const stallDropThreshold =
    config.stallDropThreshold ?? DEFAULT_STALL_DROP_THRESHOLD;
  const now = config.now ?? defaultNow;
  // Selected once at construction from live detection (or supplied by the internal worker-port
  // adapter); never branched on for public feature gating or observable Health transitions.
  let backing = internal?.backing ?? selectBufferBacking(detectTransportCapabilities());

  function defaultAllocateSlotViews(): SlotViews {
    return {
      x: new Float32Array(transitCapacitySamples),
      y: new Float32Array(transitCapacitySamples),
      out: new Float32Array(MAX_BUCKETS * 2),
      indices: new Int32Array(MAX_BUCKETS * 2),
    };
  }

  let allocateSlotViews: (slot: number) => SlotViews =
    internal?.allocateSlotViews ?? defaultAllocateSlotViews;

  const states = new Int32Array(poolPairs).fill(SlotState.Free);
  const generations = new Int32Array(poolPairs);
  const dispatchTimestamps = new Float64Array(poolPairs);

  const xViews: Float32Array[] = [];
  const yViews: Float32Array[] = [];
  const outViews: Float32Array[] = [];
  const indexViews: Int32Array[] = [];
  for (let slot = 0; slot < poolPairs; slot += 1) {
    const views = allocateSlotViews(slot);
    xViews.push(views.x);
    yViews.push(views.y);
    outViews.push(views.out);
    indexViews.push(views.indices);
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
  // `inFlightCount` rather than by reallocating or slicing. `sweepDeadlines` never re-enters
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

  function syncLeasesOutstanding(): void {
    let count = 0;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      const state = states[slot];
      if (
        state === SlotState.Acquired ||
        state === SlotState.InFlight ||
        state === SlotState.Settled
      ) {
        count += 1;
      }
    }
    stats.counters[StatCounter.LeasesOutstanding] = count;
  }

  function syncOldestInFlight(currentTime: number): void {
    let oldestAge = 0;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] !== SlotState.InFlight) continue;
      const age = currentTime - dispatchTimestamps[slot]!;
      if (age > oldestAge) oldestAge = age;
    }
    stats.gauges[StatGauge.OldestInFlightMs] = oldestAge;
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
    const currentTime = now();
    syncOldestInFlight(currentTime);
    let anyTimedOut = false;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] !== SlotState.InFlight) continue;
      if (currentTime - dispatchTimestamps[slot]! >= leaseTimeoutMs) {
        anyTimedOut = true;
        break;
      }
    }
    if (!anyTimedOut) return;
    let inFlightCount = 0;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] === SlotState.InFlight) {
        timedOutScratch[inFlightCount] = slot;
        inFlightCount += 1;
      }
    }
    stats.counters[StatCounter.ResponderFailures] =
      (stats.counters[StatCounter.ResponderFailures] ?? 0) + 1;
    failSlots(timedOutScratch, inFlightCount, FailureReason.Timeout);
    updateHealth();
  }

  function failSlots(slots: Int32Array, count: number, reason: FailureReason): void {
    for (let i = 0; i < count; i += 1) {
      states[slots[i]!] = SlotState.Lost;
    }
    const willRemint = count > 0 && remintEventCount < maxRemintEvents;
    if (count > 0 && !willRemint) {
      degraded = true;
    }
    internal?.onResponderFailure?.(reason, willRemint);
    if (willRemint) {
      remintEventCount += 1;
      for (let i = 0; i < count; i += 1) {
        const slot = slots[i]!;
        // Re-minting is bounded by `maxRemintEvents`: a buffer in a dead realm (its context lost
        // to a crashed or reloaded responder) cannot be reused, so a fresh backing store is the
        // only recovery available, and the bound exists so a responder stuck in a crash loop
        // degrades the pool once rather than leaking allocations without limit.
        const fresh = allocateSlotViews(slot);
        xViews[slot] = fresh.x;
        yViews[slot] = fresh.y;
        outViews[slot] = fresh.out;
        indexViews[slot] = fresh.indices;
        generations[slot] = (generations[slot] ?? 0) + 1;
        states[slot] = SlotState.Free;
      }
      stats.counters[StatCounter.RemintEvents] =
        (stats.counters[StatCounter.RemintEvents] ?? 0) + count;
    }
    syncLeasesOutstanding();
    syncOldestInFlight(now());
  }

  const pool: BufferPool = {
    poolPairs,
    transitCapacitySamples,

    acquire(): Lease<"acquired"> | Saturated {
      if (disposed) return SATURATED;
      sweepDeadlines();

      let freeSlot = -1;
      if (!degraded) {
        for (let slot = 0; slot < poolPairs; slot += 1) {
          if (states[slot] === SlotState.Free) {
            freeSlot = slot;
            break;
          }
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
      syncLeasesOutstanding();
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
      const submitTime = now();
      dispatchTimestamps[slot] = submitTime;
      stats.gauges[StatGauge.LastSubmitMs] = submitTime;
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
        if (replacement.out !== undefined) {
          outViews[slot] = replacement.out;
        }
        if (replacement.indices !== undefined) {
          indexViews[slot] = replacement.indices;
        }
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
      syncLeasesOutstanding();
      updateHealth();
    },

    reportResponderFailure(reason: FailureReason): void {
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
      failSlots(timedOutScratch, inFlightCount, reason);
      updateHealth();
    },

    noteDroppedSamples(count: number): void {
      stats.counters[StatCounter.SamplesDropped] =
        (stats.counters[StatCounter.SamplesDropped] ?? 0) + count;
    },

    readStats(out: TransportStatsView): void {
      if (!disposed) {
        syncOldestInFlight(now());
      }
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
      stats.counters[StatCounter.LeasesOutstanding] = 0;
      stats.gauges[StatGauge.OldestInFlightMs] = 0;
      updateHealth();
    },

    isInFlightLease(lease: number): boolean {
      return isSlotValid(lease, SlotState.InFlight) !== INVALID_SLOT;
    },

    noteStaleSettlement(): void {
      stats.counters[StatCounter.StaleSettlements] =
        (stats.counters[StatCounter.StaleSettlements] ?? 0) + 1;
    },

    rebindSlotViews(
      allocate: (slot: number) => SlotViews,
      newBacking: BufferBacking,
    ): void {
      allocateSlotViews = allocate;
      backing = newBacking;
      for (let slot = 0; slot < poolPairs; slot += 1) {
        const views = allocate(slot);
        xViews[slot] = views.x;
        yViews[slot] = views.y;
        outViews[slot] = views.out;
        indexViews[slot] = views.indices;
      }
    },

    replaceSlotViews(slot: number, views: SlotViews): void {
      if (slot < 0 || slot >= poolPairs) return;
      xViews[slot] = views.x;
      yViews[slot] = views.y;
      outViews[slot] = views.out;
      indexViews[slot] = views.indices;
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
