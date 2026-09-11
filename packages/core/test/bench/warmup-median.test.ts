import { describe, expect, it } from "vitest";
import { runBenchmark } from "../../bench/runner.js";

const WARMUP = 5;
const ITERATIONS = 30;
const COLD_COST_MS = 400;
const WARM_COST_MS = 100;

/**
 * A virtual clock plus a workload whose cost is charged to that clock rather than to real
 * elapsed time. The first `WARMUP` calls cost `COLD_COST_MS`, every later call costs
 * `WARM_COST_MS`, modeling a cold first invocation that runs interpreted before JIT tiering.
 *
 * Driving the harness from an injected clock is what makes this test deterministic: a real
 * wall-clock assertion on a machine that shares its cores with the rest of the suite can only
 * ever be a loose ratio bound, and a single scheduler preemption is enough to break it. With
 * a virtual clock the expected samples are exact, so the assertion is both stricter and immune
 * to CPU contention.
 */
function makeVirtualClockWorkload(): {
  now: () => number;
  fn: () => void;
} {
  let currentTime = 0;
  let calls = 0;
  return {
    now: () => currentTime,
    fn: () => {
      calls += 1;
      currentTime += calls <= WARMUP ? COLD_COST_MS : WARM_COST_MS;
    },
  };
}

describe("bench runner warm-up + median", () => {
  it("does not let the cold first samples inflate the reported statistics", () => {
    const { now, fn } = makeVirtualClockWorkload();
    const result = runBenchmark("cold-first-call", fn, {
      warmup: WARMUP,
      iterations: ITERATIONS,
      now,
    });

    expect(result.iterations).toBe(ITERATIONS);
    expect(result.warmup).toBe(WARMUP);

    // The warm-up iterations must be discarded entirely rather than merely de-weighted: every
    // timed sample is the steady-state cost, so the whole distribution collapses onto it. A
    // harness that let even one cold sample leak into the timed set would report a max of
    // COLD_COST_MS here.
    expect(result.median).toBe(WARM_COST_MS);
    expect(result.p95).toBe(WARM_COST_MS);
    expect(result.min).toBe(WARM_COST_MS);
    expect(result.max).toBe(WARM_COST_MS);
  });

  it("defaults to real elapsed time when no clock is injected", () => {
    let calls = 0;
    const result = runBenchmark(
      "default-clock",
      () => {
        calls += 1;
      },
      { warmup: 1, iterations: 30 },
    );

    expect(calls).toBe(31);
    expect(Number.isFinite(result.median)).toBe(true);
    expect(Number.isFinite(result.p95)).toBe(true);
    expect(result.median).toBeGreaterThanOrEqual(0);
  });
});
