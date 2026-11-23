import { describe, expect, it } from "vitest";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { SATURATED, SlotState } from "../../src/transport/ownership.js";
import {
  StatCounter,
  StatGauge,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";
import { FailureReason } from "../../src/transport/decimation-port.js";
import { MAX_BUCKETS } from "../../src/transport/streaming-contract.js";

describe("pool-lifecycle", () => {
  it("drives a lease through Free -> Acquired -> InFlight -> Settled -> Free", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    const lease = pool.acquire();
    expect(lease).not.toBe(SATURATED);
    if (lease === SATURATED) throw new Error("unreachable");

    expect(pool.__debugState(lease)).toBe(SlotState.Acquired);

    const inflight = pool.submit(lease);
    if (inflight === SATURATED) throw new Error("unreachable");
    expect(pool.__debugState(inflight)).toBe(SlotState.InFlight);

    pool.settle(inflight, 4);
    expect(pool.__debugState(inflight)).toBe(SlotState.Settled);

    pool.poll({
      onSettled: (settled) => {
        pool.release(settled);
      },
    });
    expect(pool.__debugState(inflight)).toBe(SlotState.Free);
  });

  it("a double submit is a no-op that increments ownershipViolations exactly once", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");

    pool.submit(lease);
    // Re-submitting the same (now stale-phase) lease value.
    pool.submit(lease);

    const out = { counters: new Int32Array(14), gauges: new Float64Array(3) };
    pool.readStats(out);
    expect(out.counters[StatCounter.OwnershipViolations]).toBe(1);
  });

  it("the ownership-violation branch of submit() returns SATURATED and allocates no new lease", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");

    const before = { counters: new Int32Array(14), gauges: new Float64Array(3) };
    pool.readStats(before);

    pool.submit(lease);
    // Second submit of the same stale-phase value: the invalid branch, not the happy path.
    const secondResult = pool.submit(lease);
    expect(secondResult).toBe(SATURATED);

    const after = { counters: new Int32Array(14), gauges: new Float64Array(3) };
    pool.readStats(after);
    expect(
      (after.counters[StatCounter.OwnershipViolations] ?? 0) -
        (before.counters[StatCounter.OwnershipViolations] ?? 0),
    ).toBe(1);
  });

  it("a runtime-only consumer copying a lease into a plain number is still rejected after submit", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    const rawNumber: number = lease;

    pool.submit(lease);

    const view = pool.viewX(rawNumber);
    expect(view.length).toBe(0);

    const out = { counters: new Int32Array(14), gauges: new Float64Array(3) };
    pool.readStats(out);
    expect(out.counters[StatCounter.OwnershipViolations]).toBe(1);
  });

  it("acquire() returns SATURATED once every slot is Acquired, with no throw", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    pool.acquire();
    pool.acquire();
    expect(pool.acquire()).toBe(SATURATED);
  });

  it("allocates fixed viewIndices length MAX_BUCKETS * 2 independent of request bucketCount", () => {
    const pool = createBufferPool({ poolPairs: 1, transitCapacitySamples: 64 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    expect(pool.viewX(lease).length).toBe(64);
    expect(pool.viewOut(lease).length).toBe(MAX_BUCKETS * 2);
    expect(pool.viewIndices(lease).length).toBe(MAX_BUCKETS * 2);
  });

  it("tracks StatCounter.LeasesOutstanding live across acquire, submit, release, failure, and dispose", () => {
    const pool = createBufferPool({ poolPairs: 3 });
    const stats = createTransportStatsView();

    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(0);

    const l0 = pool.acquire();
    const l1 = pool.acquire();
    if (l0 === SATURATED || l1 === SATURATED) throw new Error("unreachable");
    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(2);

    const f0 = pool.submit(l0);
    const f1 = pool.submit(l1);
    if (f0 === SATURATED || f1 === SATURATED) throw new Error("unreachable");
    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(2);

    pool.settle(f0, 4);
    pool.poll({
      onSettled: (settled) => {
        pool.release(settled);
      },
    });
    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(1);

    // Remaining in-flight slot fails and recovers to Free
    pool.reportResponderFailure(FailureReason.WorkerError);
    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(0);

    // Acquire one more and dispose — LeasesOutstanding must reset to 0
    const l2 = pool.acquire();
    if (l2 === SATURATED) throw new Error("unreachable");
    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(1);

    pool.dispose();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.LeasesOutstanding]).toBe(0);
  });

  it("updates StatGauge.OldestInFlightMs across readStats, sweepDeadlines, and dispose", () => {
    let clock = 100;
    const pool = createBufferPool({
      poolPairs: 3,
      leaseTimeoutMs: 1000,
      now: () => clock,
    });
    const stats = createTransportStatsView();

    pool.readStats(stats);
    expect(stats.gauges[StatGauge.OldestInFlightMs]).toBe(0);

    const l0 = pool.acquire();
    if (l0 === SATURATED) throw new Error("unreachable");
    const f0 = pool.submit(l0);
    if (f0 === SATURATED) throw new Error("unreachable");

    clock = 140;
    const l1 = pool.acquire();
    if (l1 === SATURATED) throw new Error("unreachable");
    const f1 = pool.submit(l1);
    if (f1 === SATURATED) throw new Error("unreachable");

    clock = 250;
    pool.readStats(stats);
    expect(stats.gauges[StatGauge.OldestInFlightMs]).toBe(150);

    pool.settle(f0, 2);
    pool.poll({ onSettled: (settled) => pool.release(settled) });

    clock = 300;
    pool.readStats(stats);
    expect(stats.gauges[StatGauge.OldestInFlightMs]).toBe(160);

    pool.settle(f1, 2);
    pool.poll({ onSettled: (settled) => pool.release(settled) });

    clock = 320;
    pool.readStats(stats);
    expect(stats.gauges[StatGauge.OldestInFlightMs]).toBe(0);

    // Verify dispose resets OldestInFlightMs to 0 even with an active InFlight slot
    const l2 = pool.acquire();
    if (l2 === SATURATED) throw new Error("unreachable");
    pool.submit(l2);
    clock = 500;
    pool.readStats(stats);
    expect(stats.gauges[StatGauge.OldestInFlightMs]).toBe(180);
    pool.dispose();
    clock = 900;
    pool.readStats(stats);
    expect(stats.gauges[StatGauge.OldestInFlightMs]).toBe(0);
  });
});
