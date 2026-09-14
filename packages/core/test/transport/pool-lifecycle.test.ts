import { describe, expect, it } from "vitest";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { SATURATED, SlotState } from "../../src/transport/ownership.js";
import { StatCounter } from "../../src/transport/backpressure.js";

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
});
