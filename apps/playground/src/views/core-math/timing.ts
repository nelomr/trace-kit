import { runBenchmark } from "@trace-kit/bench-harness";

/**
 * The millisecond table for the selected algorithm run, computed through the shared
 * warm-up + median-of-N harness — never a single `performance.now()` pair — so the panel's
 * numbers mean what the CI benchmark's numbers mean.
 */
export function measureRunMs(name: string, run: () => void): number {
  const result = runBenchmark(name, run, { warmup: 5, iterations: 30 });
  return result.median;
}
