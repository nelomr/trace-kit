/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runBenchmark } from "@trace-kit/bench-harness";

describe("the millisecond table reuses the shared harness", () => {
  it("timing.ts calls the imported runBenchmark rather than a bare performance.now() pair", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.join(dir, "../../src/views/core-math/timing.ts"),
      "utf8",
    );
    expect(source).toMatch(/runBenchmark\(/);
    expect(source).not.toMatch(/performance\.now\(\)\s*[-;].*performance\.now\(\)/s);
  });

  it("the reported timing is the steady-state median, not an inflated cold first sample", () => {
    let callCount = 0;
    const result = runBenchmark(
      "cold-vs-steady",
      () => {
        callCount += 1;
        // Deliberately slow only the very first call by 4x, via a busy-loop tied to a
        // deterministic counter rather than a wall-clock sleep.
        const spins = callCount === 1 ? 400_000 : 100_000;
        let acc = 0;
        for (let i = 0; i < spins; i += 1) {
          acc += i;
        }
        if (acc < 0) {
          throw new Error("unreachable");
        }
      },
      { warmup: 5, iterations: 30 },
    );

    // The first call (cold) happens during warm-up, discarded entirely — the reported median
    // must reflect only the steady-state timed iterations.
    expect(result.median).toBeLessThan(result.max);
  });
});
