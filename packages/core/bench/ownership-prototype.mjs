#!/usr/bin/env node
/**
 * The de-risking prototype for `buffer-ownership-protocol`/`transport-backpressure`.
 * Committed and re-runnable: `node --expose-gc --trace-gc
 * packages/core/bench/ownership-prototype.mjs [--mode=sync|transfer] [--kind=MinMaxEnvelope|Lttb]
 * [--delta-samples=N] [--stall-frames=N]`.
 *
 * Modeled directly on the working evidence probes this repository already committed
 * (`openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs` and
 * `transfer-roundtrip-probe.mjs`): same `PerformanceObserver({ entryTypes: ['gc'] })`
 * instrumentation via `gc-gate.mjs`, same warm-up-then-measure structure, same allocating
 * control. It is a self-contained model of the pool/lease/backpressure protocol — the same
 * pattern those two precedent scripts use — not a wrapper around the real `@trace-kit/core`
 * build, because the whole point of a de-risking prototype is to exercise the *shape* of the
 * protocol independently, deterministically, and without a build step as a prerequisite to
 * running it.
 *
 * Two modes exercise the same one gate over two different surfaces of the protocol:
 *  - `sync`: pool, lease state machine, backpressure accounting — nothing detaches.
 *  - `transfer`: real detach semantics via `structuredClone(msg, { transfer: [...] })` — no
 *    `Worker`, but a genuine transfer, so the generation guard, the accessor sentinel and the
 *    view re-mint are all genuinely exercised.
 */
import { createGcGate, settle, forceGc } from "./gc-gate.mjs";

const SlotState = Object.freeze({ Free: 0, Acquired: 1, InFlight: 2, Settled: 3, Lost: 4 });
const Health = Object.freeze({
  Ready: "Ready",
  Saturated: "Saturated",
  Stalled: "Stalled",
  Recovering: "Recovering",
  Degraded: "Degraded",
});
const SATURATED = -1;

const MAX_BUCKETS = 8192;
const DEFAULT_MAX_REMINT_EVENTS = 8;
const DEFAULT_STALL_DROP_THRESHOLD = 120;

// `structuredClone(msg, { transfer })` moves the backing store zero-copy, but the receiving
// ArrayBuffer is still a freshly minted young-gen JSArrayBuffer wrapper, and each re-minted
// typed-array view is another young-gen allocation — a handful of these per round trip reliably
// crosses the scavenge threshold at streaming iteration counts, independent of anything this pool
// does wrong. Observed range on this machine at the real 3,600-iteration run shape: 32
// (MinMaxEnvelope, 3 re-minted views) to 39 (Lttb, 4 re-minted views). Budget set with real margin
// above that observed maximum so a genuine regression (e.g. an extra unnecessary re-mint) still
// trips the gate.
const TRANSFER_SCAVENGE_BUDGET = 80;

function deriveHealth({ remintCapReached, hasLostSlot, consecutiveDrops, stallDropThreshold }) {
  if (remintCapReached) return Health.Degraded;
  if (hasLostSlot) return Health.Recovering;
  if (consecutiveDrops >= stallDropThreshold) return Health.Stalled;
  if (consecutiveDrops > 0) return Health.Saturated;
  return Health.Ready;
}

function packLease(slot, generation) {
  return ((generation & 0x1fffffff) << 3) | (slot & 0b111);
}
function unpackSlot(lease) {
  return lease & 0b111;
}
function unpackGeneration(lease) {
  return lease >> 3;
}

/**
 * Constructs the self-contained prototype pool. `mode: "transfer"` performs a real
 * `structuredClone(..., { transfer })` on `submit`/`settle`, so slot views genuinely detach and
 * are genuinely re-minted; `mode: "sync"` never transfers, so nothing detaches and nothing is
 * re-minted on the happy path — only a `reportResponderFailure` re-mints, in both modes.
 */
function createPrototypePool({
  mode,
  poolPairs,
  transitCapacitySamples,
  kind,
  maxRemintEvents = DEFAULT_MAX_REMINT_EVENTS,
  stallDropThreshold = DEFAULT_STALL_DROP_THRESHOLD,
  onAllocate = () => {},
  onViewConstruction = () => {},
  proportionalViewConstructionFixture = false,
}) {
  const states = new Array(poolPairs).fill(SlotState.Free);
  const generations = new Array(poolPairs).fill(0);
  const xViews = [];
  const yViews = [];
  const outViews = [];
  const indexViews = [];
  const pendingTransfer = new Array(poolPairs).fill(null);

  function allocateSlot(slot) {
    xViews[slot] = new Float32Array(transitCapacitySamples);
    yViews[slot] = new Float32Array(transitCapacitySamples);
    outViews[slot] = new Float32Array(MAX_BUCKETS * 2);
    indexViews[slot] = new Int32Array(MAX_BUCKETS);
    onAllocate();
  }
  for (let slot = 0; slot < poolPairs; slot += 1) allocateSlot(slot);

  const sentinelF32 = new Float32Array(0);
  const sentinelI32 = new Int32Array(0);

  const stats = {
    chunksAccepted: 0,
    chunksDropped: 0,
    consecutiveDrops: 0,
    maxConsecutiveDrops: 0,
    poolExhaustionEvents: 0,
    staleSettlements: 0,
    ownershipViolations: 0,
    remintEvents: 0,
    responderFailures: 0,
    samplesDropped: 0,
    detachedBufferExceptions: 0,
  };
  let degraded = false;
  let remintEventCount = 0;

  function lostSlotCount() {
    let count = 0;
    for (let slot = 0; slot < poolPairs; slot += 1) if (states[slot] === SlotState.Lost) count += 1;
    return count;
  }
  function health() {
    return deriveHealth({
      remintCapReached: degraded,
      hasLostSlot: lostSlotCount() > 0,
      consecutiveDrops: stats.consecutiveDrops,
      stallDropThreshold,
    });
  }

  function isSlotValid(lease, expected) {
    const slot = unpackSlot(lease);
    if (slot < 0 || slot >= poolPairs) return -1;
    if (states[slot] !== expected) return -1;
    if (unpackGeneration(lease) !== generations[slot]) return -1;
    return slot;
  }
  function isReadable(lease) {
    const slot = unpackSlot(lease);
    if (slot < 0 || slot >= poolPairs) return -1;
    const state = states[slot];
    if (state !== SlotState.Acquired && state !== SlotState.Settled) return -1;
    if (unpackGeneration(lease) !== generations[slot]) return -1;
    return slot;
  }

  function view(arrayOf, sentinel) {
    return (lease) => {
      const slot = isReadable(lease);
      if (slot === -1) {
        stats.ownershipViolations += 1;
        return sentinel;
      }
      return arrayOf[slot];
    };
  }

  function acquire() {
    let free = -1;
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] === SlotState.Free) {
        free = slot;
        break;
      }
    }
    if (free === -1) {
      stats.chunksDropped += 1;
      stats.consecutiveDrops += 1;
      if (stats.consecutiveDrops > stats.maxConsecutiveDrops) {
        stats.maxConsecutiveDrops = stats.consecutiveDrops;
      }
      if (stats.consecutiveDrops === 1) stats.poolExhaustionEvents += 1;
      return SATURATED;
    }
    states[free] = SlotState.Acquired;
    stats.chunksAccepted += 1;
    stats.consecutiveDrops = 0;
    return packLease(free, generations[free]);
  }

  function submit(lease) {
    const slot = isSlotValid(lease, SlotState.Acquired);
    if (slot === -1) {
      stats.ownershipViolations += 1;
      return SATURATED;
    }
    states[slot] = SlotState.InFlight;

    if (mode === "transfer") {
      const payload = { x: xViews[slot], y: yViews[slot], out: outViews[slot], indices: indexViews[slot] };
      const transferList = [payload.x.buffer, payload.y.buffer, payload.out.buffer];
      if (kind === "Lttb") transferList.push(payload.indices.buffer);
      const received = structuredClone(payload, { transfer: transferList });
      pendingTransfer[slot] = received;
    }
    return packLease(slot, generations[slot]);
  }

  function settle(inflightLease, outCount) {
    const slot = isSlotValid(inflightLease, SlotState.InFlight);
    if (slot === -1) {
      stats.staleSettlements += 1;
      return;
    }
    if (mode === "transfer") {
      const received = pendingTransfer[slot];
      pendingTransfer[slot] = null;
      const transferBack = [received.x.buffer, received.y.buffer, received.out.buffer];
      if (kind === "Lttb") transferBack.push(received.indices.buffer);
      const back = structuredClone(received, { transfer: transferBack });
      xViews[slot] = back.x;
      yViews[slot] = back.y;
      outViews[slot] = back.out;
      if (kind === "Lttb") indexViews[slot] = back.indices;

      // The gated run always re-mints proportionally to the request's own view count (3 for
      // MinMaxEnvelope, 4 for Lttb) — constant per kind, never a function of payload size. The
      // fixture-only variant below deliberately breaks that invariant so P5 can be proven live:
      // it scales re-mint "work" with the transit capacity, which a correct implementation must
      // never do.
      const realCount = kind === "Lttb" ? 4 : 3;
      const constructedCount = proportionalViewConstructionFixture
        ? realCount + Math.floor(transitCapacitySamples / 4096)
        : realCount;
      for (let i = 0; i < constructedCount; i += 1) onViewConstruction();
    }
    states[slot] = SlotState.Settled;
  }

  function release(lease) {
    const slot = isReadable(lease);
    if (slot === -1) {
      stats.ownershipViolations += 1;
      return;
    }
    states[slot] = SlotState.Free;
  }

  function reportResponderFailure() {
    stats.responderFailures += 1;
    const failedSlots = [];
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (states[slot] === SlotState.InFlight) failedSlots.push(slot);
    }
    if (failedSlots.length === 0) return;
    if (remintEventCount >= maxRemintEvents) {
      degraded = true;
      return;
    }
    remintEventCount += 1;
    for (const slot of failedSlots) {
      states[slot] = SlotState.Lost;
      allocateSlot(slot);
      generations[slot] += 1;
      states[slot] = SlotState.Free;
    }
    stats.remintEvents += failedSlots.length;
  }

  function noteDroppedSamples(count) {
    stats.samplesDropped += count;
  }

  return {
    poolPairs,
    acquire,
    submit,
    settle,
    release,
    viewX: view(xViews, sentinelF32),
    viewY: view(yViews, sentinelF32),
    viewOut: view(outViews, sentinelF32),
    viewIndices: view(indexViews, sentinelI32),
    reportResponderFailure,
    noteDroppedSamples,
    stats,
    health,
  };
}

/**
 * The deliberate-violation control segment for P3: a separate, clearly excluded code path that
 * performs exactly one stale-lease read (reading through an already-submitted handle) and
 * exactly one pre-existing-view-after-transfer read (re-transferring a buffer that was already
 * detached by a real transfer), so the "0 ownershipViolations / 0 detachedBufferExceptions" gate
 * can be proven live rather than vacuous.
 */
function runViolationControl(pool) {
  const before = pool.stats.ownershipViolations;

  // Stale-lease read: submit, then read through the same (now stale) acquired-phase handle.
  const lease = pool.acquire();
  if (lease !== SATURATED) {
    pool.submit(lease);
    pool.viewX(lease); // counted violation — the accessor sentinel path
  }

  // Pre-existing-view-after-transfer read: capture a view, transfer its buffer away, then try to
  // transfer the same (now-detached) buffer again — a genuine DataCloneError.
  let detachedBufferExceptions = 0;
  const scratch = new Float32Array(8);
  structuredClone(scratch, { transfer: [scratch.buffer] });
  try {
    structuredClone(scratch, { transfer: [scratch.buffer] });
  } catch {
    detachedBufferExceptions = 1;
  }

  const staleLeaseReads = pool.stats.ownershipViolations - before > 0 ? 1 : 0;
  return { staleLeaseReads, detachedBufferExceptions };
}

function median(sortedSamples) {
  const n = sortedSamples.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedSamples[mid - 1] + sortedSamples[mid]) / 2 : sortedSamples[mid];
}

/**
 * Runs one full prototype invocation and returns a machine-readable result. Never throws on a
 * gate failure — callers (the CLI entry point, or a test) read the result and decide pass/fail
 * themselves, which is what lets the same function serve both the informational CLI run and
 * fine-grained assertions.
 */
export async function runPrototype(options = {}) {
  const {
    mode = "sync",
    kind = "MinMaxEnvelope",
    poolPairs = 3,
    warmupIterations = 200,
    measureIterations = 3_600,
    deltaSamples = 4_096,
    stallFrames = 0,
    injectResponderFailure = false,
    __proportionalViewConstructionFixture = false,
  } = options;

  // The pool is sized to the request's own delta — P5 asserts that view-construction count is
  // invariant to this size, i.e. sizing the slot's backing store to deltaSamples must not make
  // the re-mint count scale with it (a correct implementation re-mints a constant count of
  // *views*, never a count proportional to their length).
  const transitCapacitySamples = options.transitCapacitySamples ?? deltaSamples;

  if (warmupIterations === 0) {
    return {
      mode,
      valid: false,
      reason: "warmupIterations === 0: cold-run measurements do not count.",
    };
  }

  let poolAllocationCount = 0;
  let viewConstructionCount = 0;
  const pool = createPrototypePool({
    mode,
    poolPairs,
    transitCapacitySamples,
    kind,
    onAllocate: () => {
      poolAllocationCount += 1;
    },
    onViewConstruction: () => {
      viewConstructionCount += 1;
    },
    proportionalViewConstructionFixture: __proportionalViewConstructionFixture,
  });

  const gate = createGcGate();
  const roundTripSamplesMs = [];
  let settledCount = 0;
  let trippedStalled = false;

  // The keeping-up responder: every round trip acquires, submits, settles, and immediately
  // releases — the pool never accumulates outstanding leases, so it never saturates on its own
  // (P6). `stallFrames`/`injectResponderFailure` are exercised as dedicated, separately-counted
  // phases below rather than interleaved into this loop, so `chunksDropped`/`remintEvents` are
  // exactly attributable to the injected condition and not to loop-order coincidence.
  function roundTrip() {
    const lease = pool.acquire();
    if (lease === SATURATED) return;
    const inflight = pool.submit(lease);
    if (inflight === SATURATED) return;
    pool.settle(inflight, 1);
    settledCount += 1;
    pool.release(inflight);
  }

  for (let i = 0; i < warmupIterations; i += 1) roundTrip();
  if (typeof globalThis.gc === "function") forceGc();
  await settle();
  gate.reset();

  const checkpointPoolAllocationCount = poolAllocationCount;
  const checkpointViewConstructionCount = viewConstructionCount;
  const checkpointSettledCount = settledCount;

  for (let i = 0; i < measureIterations; i += 1) {
    const t0 = performance.now();
    roundTrip();
    roundTripSamplesMs.push(performance.now() - t0);
  }

  // Dedicated stall phase (P7/P8): occupy every pair, then attempt `stallFrames` further
  // acquisitions with nothing draining — each one is a genuine drop, so `chunksDropped` after
  // this phase equals `stallFrames` exactly (the occupying acquisitions themselves are not
  // drops). Health is sampled at the deepest point of the stall, then every held lease is
  // released and one more round trip proves recovery.
  if (stallFrames > 0) {
    const held = [];
    for (let s = 0; s < pool.poolPairs; s += 1) {
      const l = pool.acquire();
      if (l !== SATURATED) held.push(l);
    }
    for (let i = 0; i < stallFrames; i += 1) {
      pool.acquire(); // expected SATURATED — every pair is held
    }
    if (pool.health() === Health.Stalled) trippedStalled = true;
    for (const l of held) pool.release(l);
    roundTrip(); // the next accepted chunk — proves Health clears
  }

  // Dedicated failure phase (P9): drive every pair in flight, inject one responder failure
  // (re-mints exactly `poolPairs` slots and returns Health to Ready), then replay a settlement
  // against one of the pre-failure (now stale) generations.
  if (injectResponderFailure) {
    const inflightLeases = [];
    for (let s = 0; s < pool.poolPairs; s += 1) {
      const l = pool.acquire();
      if (l !== SATURATED) inflightLeases.push(pool.submit(l));
    }
    pool.reportResponderFailure();
    if (inflightLeases.length > 0) pool.settle(inflightLeases[0], 1); // replayed stale settlement
  }

  await settle();

  const { scavengeCount, majorCount } = gate.counts();
  gate.disconnect();

  // P10 control: a deliberately allocating variant, proving the instrumentation is live and not
  // silently measuring nothing. When `--expose-gc` exposes the `{ type: 'minor' }` form, force a
  // deterministic scavenge directly — cheap and immune to nursery-size/timing flakiness across
  // hosts. Otherwise fall back to enough allocation pressure to reliably fill the young
  // generation at least once, independent of `measureIterations`.
  const controlGate = createGcGate();
  await settle();
  controlGate.reset();
  let forcedMinorGc = false;
  if (typeof globalThis.gc === "function") {
    try {
      globalThis.gc({ type: "minor" });
      forcedMinorGc = true;
    } catch {
      // Older Node without the `{ type }` overload: allocation pressure below is the fallback.
    }
  }
  if (!forcedMinorGc) {
    let junk = [];
    for (let i = 0; i < 500_000; i += 1) {
      junk.push({ i, payload: new Float64Array(1024) });
      if (junk.length > 4096) junk = [];
    }
  }
  await settle(200);
  const allocatingControlScavengeEvents = controlGate.counts().scavengeCount;
  controlGate.disconnect();

  const violationControl = runViolationControl(
    createPrototypePool({ mode, poolPairs, transitCapacitySamples, kind }),
  );

  const sorted = [...roundTripSamplesMs].sort((a, b) => a - b);
  const firstHalf = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
  const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
  const baselineMedianMs = median(firstHalf);
  const medianRoundTripMs = median(secondHalf);
  // Relative regression budget: the second half of the same run must not be more than 3x the
  // first half's median. No absolute millisecond constant participates in the comparison — only
  // a same-runner, same-invocation ratio.
  const regressionRatio = baselineMedianMs > 0 ? medianRoundTripMs / baselineMedianMs : 1;
  const withinBudget = regressionRatio <= 3;

  return {
    mode,
    kind,
    valid: true,
    poolPairs,
    settledCount,
    scavengeEvents: scavengeCount,
    majorGcEvents: majorCount,
    allocatingControlScavengeEvents,
    poolAllocationCountAtCheckpoint: checkpointPoolAllocationCount,
    poolAllocationCountAtEnd: poolAllocationCount,
    viewConstructionPerSettlement:
      mode === "transfer" && settledCount > checkpointSettledCount
        ? (viewConstructionCount - checkpointViewConstructionCount) /
          (settledCount - checkpointSettledCount)
        : 0,
    detachedBufferExceptions: pool.stats.detachedBufferExceptions,
    ownershipViolations: pool.stats.ownershipViolations,
    staleSettlements: pool.stats.staleSettlements,
    remintEvents: pool.stats.remintEvents,
    chunksAccepted: pool.stats.chunksAccepted,
    chunksDropped: pool.stats.chunksDropped,
    maxConsecutiveDrops: pool.stats.maxConsecutiveDrops,
    health: pool.health(),
    trippedStalled,
    violationControl,
    throughput: {
      medianRoundTripMs,
      baselineMedianMs,
      regressionRatio,
      withinBudget,
    },
  };
}

function evaluatePassConditions({
  sync,
  transfer,
  transferSmall,
  transferLarge,
  syncStall10,
  transferStall10,
  syncStall200,
  transferStall200,
  syncFailure,
  transferFailure,
}) {
  return [
    ["P1", sync.scavengeEvents === 0],
    [
      "P2",
      sync.poolAllocationCountAtCheckpoint > 0 &&
        sync.poolAllocationCountAtEnd === sync.poolAllocationCountAtCheckpoint,
    ],
    [
      "P3",
      sync.detachedBufferExceptions === 0 &&
        sync.ownershipViolations === 0 &&
        transfer.detachedBufferExceptions === 0 &&
        transfer.ownershipViolations === 0,
    ],
    ["P4", transfer.viewConstructionPerSettlement === (transfer.kind === "Lttb" ? 4 : 3)],
    [
      "P5",
      transferSmall.viewConstructionPerSettlement === transferLarge.viewConstructionPerSettlement,
    ],
    [
      "P5b",
      transferSmall.scavengeEvents <= TRANSFER_SCAVENGE_BUDGET &&
        transferLarge.scavengeEvents <= TRANSFER_SCAVENGE_BUDGET,
    ],
    [
      "P6",
      sync.chunksDropped === 0 && transfer.chunksDropped === 0,
    ],
    [
      "P7",
      syncStall10.chunksDropped === 10 &&
        transferStall10.chunksDropped === 10 &&
        syncStall10.health !== "Stalled" &&
        transferStall10.health !== "Stalled",
    ],
    [
      "P8",
      syncStall200.trippedStalled &&
        transferStall200.trippedStalled &&
        syncStall200.health !== "Stalled" &&
        transferStall200.health !== "Stalled",
    ],
    [
      "P9",
      syncFailure.remintEvents === syncFailure.poolPairs &&
        syncFailure.health === "Ready" &&
        syncFailure.staleSettlements === 1 &&
        transferFailure.remintEvents === transferFailure.poolPairs &&
        transferFailure.health === "Ready" &&
        transferFailure.staleSettlements === 1,
    ],
    ["P10", sync.scavengeEvents === 0 && sync.allocatingControlScavengeEvents > 0],
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const prefix = `--${name}=`;
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
  };

  const kind = flag("kind", "MinMaxEnvelope");
  const deltaSamples = Number(flag("delta-samples", "4096"));

  // Each invocation's `createGcGate()` observes process-wide `gc` performance entries — running
  // two invocations concurrently would let one's allocation cross-contaminate the other's
  // scavenge count. Sequential, not `Promise.all`, is required for the GC-derived fields to mean
  // anything.
  const sync = await runPrototype({ mode: "sync", kind, deltaSamples });
  const transfer = await runPrototype({ mode: "transfer", kind, deltaSamples });
  const transferSmall = await runPrototype({ mode: "transfer", kind, deltaSamples: 4_096 });
  const transferLarge = await runPrototype({ mode: "transfer", kind, deltaSamples: 262_144 });
  const syncStall10 = await runPrototype({ mode: "sync", kind, deltaSamples, stallFrames: 10 });
  const transferStall10 = await runPrototype({
    mode: "transfer",
    kind,
    deltaSamples,
    stallFrames: 10,
  });
  const syncStall200 = await runPrototype({ mode: "sync", kind, deltaSamples, stallFrames: 200 });
  const transferStall200 = await runPrototype({
    mode: "transfer",
    kind,
    deltaSamples,
    stallFrames: 200,
  });
  const syncFailure = await runPrototype({
    mode: "sync",
    kind,
    deltaSamples,
    injectResponderFailure: true,
  });
  const transferFailure = await runPrototype({
    mode: "transfer",
    kind,
    deltaSamples,
    injectResponderFailure: true,
  });

  const checks = evaluatePassConditions({
    sync,
    transfer,
    transferSmall,
    transferLarge,
    syncStall10,
    transferStall10,
    syncStall200,
    transferStall200,
    syncFailure,
    transferFailure,
  });

  console.log(
    JSON.stringify(
      {
        sync,
        transfer,
        p5: { transferSmall, transferLarge },
        checks,
      },
      null,
      2,
    ),
  );
  const allPass = checks.every(([, pass]) => pass);
  process.exit(allPass ? 0 : 1);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
