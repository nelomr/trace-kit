import { describe, expect, it } from "vitest";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { type Lease, SATURATED, SlotState } from "../../src/transport/ownership.js";
import {
  StatCounter,
  TransportHealth,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";
import { FailureReason } from "../../src/transport/decimation-port.js";

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
});
