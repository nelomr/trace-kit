import { describe, expect, it } from "vitest";
import {
  createBufferPool,
  type SlotViews,
} from "../../src/transport/buffer-pool.js";
import { BufferBacking } from "../../src/transport/capabilities.js";
import { type Lease, SATURATED, SlotState } from "../../src/transport/ownership.js";
import {
  StatCounter,
  TransportHealth,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";
import { FailureReason } from "../../src/transport/decimation-port.js";
import { MAX_BUCKETS } from "../../src/transport/streaming-contract.js";

describe("failure-path", () => {
  it("a clean run reports RemintEvents === 0", () => {
    const pool = createBufferPool({ poolPairs: 3 });
    for (let i = 0; i < 3_600; i += 1) {
      const lease = pool.acquire();
      if (lease === SATURATED) continue;
      const inflight = pool.submit(lease);
      if (inflight === SATURATED) throw new Error("unreachable");
      pool.settle(inflight, 0);
      pool.poll({
        onSettled: (settled) => {
          pool.release(settled);
        },
      });
    }
    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.RemintEvents]).toBe(0);
  });

  it("one injected responder failure re-mints exactly poolPairs slots and returns Health to Ready", () => {
    const pool = createBufferPool({ poolPairs: 3 });
    const leases = [pool.acquire(), pool.acquire(), pool.acquire()];
    const inflights = leases.map((lease) => {
      if (lease === SATURATED) throw new Error("unreachable");
      const inflight = pool.submit(lease);
      if (inflight === SATURATED) throw new Error("unreachable");
      return inflight;
    });

    pool.reportResponderFailure(FailureReason.WorkerError);

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.RemintEvents]).toBe(3);
    expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Ready);

    // A stale-generation settlement from the pre-failure lease is discarded.
    pool.settle(inflights[0] as Lease<"inflight">, 0);
    pool.readStats(stats);
    expect(stats.counters[StatCounter.StaleSettlements]).toBe(1);
  });

  it("enforces maxRemintEvents: beyond the cap Health becomes Degraded and acquire() returns SATURATED permanently", () => {
    const pool = createBufferPool({ poolPairs: 1, maxRemintEvents: 2 });

    for (let event = 0; event < 3; event += 1) {
      const lease = pool.acquire();
      if (lease !== SATURATED) {
        pool.submit(lease);
        pool.reportResponderFailure(FailureReason.WorkerError);
      }
    }

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
    expect(pool.acquire()).toBe(SATURATED);
    expect(pool.acquire()).toBe(SATURATED);
  });

  it("enforces terminal Degraded when poolPairs > 1 and only 1 slot is InFlight: remaining Free slots are never handed out", () => {
    const pool = createBufferPool({ poolPairs: 3, maxRemintEvents: 2 });

    // Only 1 of 3 slots is InFlight on each failure; 2 sibling slots remain Free.
    for (let event = 0; event < 3; event += 1) {
      const lease = pool.acquire();
      expect(lease).not.toBe(SATURATED);
      if (lease === SATURATED) throw new Error("unreachable");
      const inflight = pool.submit(lease);
      expect(inflight).not.toBe(SATURATED);
      pool.reportResponderFailure(FailureReason.WorkerError);
    }

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
    expect(stats.counters[StatCounter.ResponderFailures]).toBe(3);
    expect(stats.counters[StatCounter.RemintEvents]).toBe(2);
    expect(stats.counters[StatCounter.ChunksDropped]).toBe(0);

    // Subsequent acquire() calls must return SATURATED permanently (never handing out the 2 Free slots).
    expect(pool.acquire()).toBe(SATURATED);
    expect(pool.acquire()).toBe(SATURATED);
    expect(pool.acquire()).toBe(SATURATED);

    pool.readStats(stats);
    expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
    expect(stats.counters[StatCounter.ResponderFailures]).toBe(3);
    expect(stats.counters[StatCounter.ChunksDropped]).toBe(3);
    expect(stats.counters[StatCounter.ConsecutiveDrops]).toBe(3);
    expect(stats.counters[StatCounter.PoolExhaustionEvents]).toBe(1);
  });

  it("the lazy deadline sweep fires at exactly leaseTimeoutMs and not before, with no timer installed", () => {
    let clock = 0;
    const pool = createBufferPool({
      poolPairs: 1,
      leaseTimeoutMs: 1000,
      now: () => clock,
    });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    pool.submit(lease);

    clock = 999;
    pool.acquire(); // triggers the sweep as a side effect; must not fire yet
    let stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.ResponderFailures]).toBe(0);

    clock = 1000;
    pool.acquire();
    stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.ResponderFailures]).toBe(1);
  });

  it("dispose() is terminal and idempotent: no re-mint, Health Degraded, later settlements stale, a second call changes nothing", () => {
    const pool = createBufferPool({ poolPairs: 1 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    const inflight = pool.submit(lease);
    if (inflight === SATURATED) throw new Error("unreachable");

    pool.dispose();
    expect(pool.__debugState(inflight)).toBe(SlotState.Lost);
    expect(pool.acquire()).toBe(SATURATED);

    const before = createTransportStatsView();
    pool.readStats(before);
    expect(before.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);

    pool.settle(inflight, 0);
    const afterStaleSettle = createTransportStatsView();
    pool.readStats(afterStaleSettle);
    expect(afterStaleSettle.counters[StatCounter.StaleSettlements]).toBe(1);

    pool.dispose();
    const afterSecondDispose = createTransportStatsView();
    pool.readStats(afterSecondDispose);
    expect(afterSecondDispose.counters).toEqual(afterStaleSettle.counters);
  });

  it("unified timeout sweep fails ALL InFlight slots together when any slot reaches leaseTimeoutMs", () => {
    let clock = 0;
    const pool = createBufferPool({
      poolPairs: 3,
      leaseTimeoutMs: 1000,
      now: () => clock,
    });

    const l0 = pool.acquire();
    if (l0 === SATURATED) throw new Error("unreachable");
    const f0 = pool.submit(l0); // dispatched at t = 0
    if (f0 === SATURATED) throw new Error("unreachable");

    clock = 800;
    const l1 = pool.acquire();
    if (l1 === SATURATED) throw new Error("unreachable");
    const f1 = pool.submit(l1); // dispatched at t = 800 (not individually expired at t = 1000)
    if (f1 === SATURATED) throw new Error("unreachable");

    // Slot 2 stays Acquired (not InFlight) — must NOT be failed by the timeout sweep.
    const l2 = pool.acquire();
    if (l2 === SATURATED) throw new Error("unreachable");

    clock = 1000; // slot 0 reaches leaseTimeoutMs; slot 1 is only 200ms old
    pool.poll({ onSettled: () => {} });

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.ResponderFailures]).toBe(1);
    expect(stats.counters[StatCounter.RemintEvents]).toBe(2);
    expect(pool.__debugState(f0)).toBe(SlotState.Free);
    expect(pool.__debugState(f1)).toBe(SlotState.Free);
    expect(pool.__debugState(l2)).toBe(SlotState.Acquired);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(1);
  });

  it("direct createBufferPool stays ArrayBuffer-backed before and after failure, while BufferPoolInternalOptions supports custom allocation and helpers", () => {
    // 1. Direct createBufferPool allocates plain ArrayBuffers even in Node where SharedArrayBuffer exists
    const directPool = createBufferPool({ poolPairs: 1, transitCapacitySamples: 32 });
    const d0 = directPool.acquire();
    if (d0 === SATURATED) throw new Error("unreachable");
    expect(directPool.viewX(d0).buffer).toBeInstanceOf(ArrayBuffer);
    const df0 = directPool.submit(d0);
    if (df0 === SATURATED) throw new Error("unreachable");
    expect(directPool.isInFlightLease(df0)).toBe(true);
    directPool.reportResponderFailure(FailureReason.WorkerError);
    expect(directPool.isInFlightLease(df0)).toBe(false);
    const d1 = directPool.acquire();
    if (d1 === SATURATED) throw new Error("unreachable");
    expect(directPool.viewX(d1).buffer).toBeInstanceOf(ArrayBuffer);

    // 2. Internal options: custom backing, allocateSlotViews, onResponderFailure invoked BEFORE re-mint,
    //    plus noteStaleSettlement, rebindSlotViews, replaceSlotViews.
    const events: string[] = [];
    let epoch = 0;
    const makeSabSlotViews = (): SlotViews => {
      events.push(`alloc:${epoch}`);
      return {
        x: new Float32Array(new SharedArrayBuffer(32 * 4)),
        y: new Float32Array(new SharedArrayBuffer(32 * 4)),
        out: new Float32Array(new SharedArrayBuffer(MAX_BUCKETS * 2 * 4)),
        indices: new Int32Array(new SharedArrayBuffer(MAX_BUCKETS * 2 * 4)),
      };
    };

    const customPool = createBufferPool(
      { poolPairs: 2, transitCapacitySamples: 32 },
      {
        backing: BufferBacking.Shared,
        allocateSlotViews: makeSabSlotViews,
        onResponderFailure: (reason, willRemint) => {
          epoch += 1;
          events.push(`fail:${reason}:${willRemint}:${epoch}`);
        },
      },
    );
    expect(customPool.__debugBacking()).toBe(BufferBacking.Shared);
    expect(events).toEqual(["alloc:0", "alloc:0"]);

    const c0 = customPool.acquire();
    if (c0 === SATURATED) throw new Error("unreachable");
    const preFailureSab = customPool.viewX(c0).buffer;
    expect(preFailureSab).toBeInstanceOf(SharedArrayBuffer);

    const cf0 = customPool.submit(c0);
    if (cf0 === SATURATED) throw new Error("unreachable");
    expect(customPool.isInFlightLease(cf0)).toBe(true);

    customPool.reportResponderFailure(FailureReason.WorkerError);
    // onResponderFailure must fire BEFORE allocateSlotViews so epoch increments first!
    expect(events).toEqual([
      "alloc:0",
      "alloc:0",
      `fail:${FailureReason.WorkerError}:true:1`,
      "alloc:1",
    ]);

    const c1 = customPool.acquire();
    if (c1 === SATURATED) throw new Error("unreachable");
    expect(customPool.viewX(c1).buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(customPool.viewX(c1).buffer).not.toBe(preFailureSab);

    // noteStaleSettlement increments StaleSettlements
    customPool.noteStaleSettlement();
    const stats = createTransportStatsView();
    customPool.readStats(stats);
    expect(stats.counters[StatCounter.StaleSettlements]).toBe(1);

    // Idle responder failure still invokes onResponderFailure with willRemint === false
    customPool.release(c1);
    customPool.reportResponderFailure(FailureReason.WorkerError);
    expect(events[events.length - 1]).toBe(`fail:${FailureReason.WorkerError}:false:2`);

    // rebindSlotViews switches backing & rebinds all slots
    customPool.rebindSlotViews(
      () => ({
        x: new Float32Array(32),
        y: new Float32Array(32),
        out: new Float32Array(MAX_BUCKETS * 2),
        indices: new Int32Array(MAX_BUCKETS * 2),
      }),
      BufferBacking.Transfer,
    );
    expect(customPool.__debugBacking()).toBe(BufferBacking.Transfer);
    const c2 = customPool.acquire();
    if (c2 === SATURATED) throw new Error("unreachable");
    expect(customPool.viewX(c2).buffer).toBeInstanceOf(ArrayBuffer);

    // replaceSlotViews updates a single slot in place
    const customX = new Float32Array(32);
    customPool.replaceSlotViews(0, {
      x: customX,
      y: new Float32Array(32),
      out: new Float32Array(MAX_BUCKETS * 2),
      indices: new Int32Array(MAX_BUCKETS * 2),
    });
    expect(customPool.viewX(c2)).toBe(customX);
  });
});
