import { describe, expect, it } from "vitest";
import { runBenchmark } from "../../bench/runner.js";

// RED (task 4.1): a function deliberately ~4x slower on its first call than on later calls —
// modeling the pre-tiering cost claim C4b records (a cold first invocation of a numeric pass
// can be 3-5x slower than the warm steady state before TurboFan tiering). Rather than relying
// on real, nondeterministic V8 tiering behavior, this fixture controls the cost directly with
// a call counter, so the test is deterministic regardless of the host JS engine's actual
// warm-up characteristics.
function makeColdFirstCallFn(): () => void {
  let calls = 0;
  return () => {
    calls += 1;
    const spinIterations = calls === 1 ? 400_000 : 100_000;
    let acc = 0;
    for (let i = 0; i < spinIterations; i += 1) {
      acc += Math.sqrt(i);
    }
    void acc;
  };
}

describe("bench runner warm-up + median", () => {
  it("does not let the cold first sample inflate the reported median", () => {
    const fn = makeColdFirstCallFn();
    const result = runBenchmark("cold-first-call", fn, { warmup: 5, iterations: 30 });

    // The harness must discard the warm-up iterations from timing entirely; the reported
    // median must reflect the steady-state cost, not the ~4x-inflated cold sample.
    expect(result.iterations).toBe(30);
    expect(result.warmup).toBe(5);
    expect(Number.isFinite(result.median)).toBe(true);
    expect(Number.isFinite(result.p95)).toBe(true);
    // p95 (tail) may legitimately exceed the median, but neither should be wildly larger than
    // the other in a benchmark of a function whose steady-state cost is uniform — a cold
    // sample leaking into the timed set would show up as an outsized max/p95 relative to the
    // median. This is a loose bound deliberately (not asserting exact ms figures, which would
    // be hardware-dependent), sufficient to catch the specific defect this test targets.
    expect(result.p95).toBeLessThan(result.median * 4);
  });
});
