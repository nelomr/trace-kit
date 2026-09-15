// Isomorphic half of the benchmark harness (design.md §D9): warm-up + N-measured-iterations +
// median/p95 reporting, with no `node:*` import so it can be bundled for a browser consumer
// (`apps/playground`'s millisecond table) without pulling in Node builtins. `bench/runner.ts`
// keeps the Node-coupled reporting half (`RunnerInfo`, `writeBenchResults`, …) and re-exports
// everything below so every existing import path stays byte-compatible.
//
// Never a total-divided-by-N mean: the mean is exactly the statistic a single slow outlier
// (a cold sample, an unexpected GC pause, a deopt) destroys. Each of the N measured iterations
// is timed individually with `performance.now()`, and the median/p95 are computed from that
// full set of individual samples.

export interface BenchmarkOptions {
  /** Non-zero count of untimed iterations executed before the first timed sample. */
  warmup: number;
  /** Number of timed iterations. Must be >= 30 for the median/p95 to be statistically stable. */
  iterations: number;
  /**
   * Clock used to time each iteration, in milliseconds. Defaults to `performance.now`.
   *
   * Injecting a clock exists so the harness's own behaviour — that warm-up iterations are
   * discarded rather than merely de-weighted — can be asserted exactly, instead of through a
   * wall-clock ratio bound that a single scheduler preemption on a loaded machine can break.
   * Real benchmark runs leave this unset.
   */
  now?: () => number;
}

export interface BenchmarkResult {
  name: string;
  median: number;
  p95: number;
  min: number;
  max: number;
  iterations: number;
  warmup: number;
  unit: "ms";
}

const MIN_ITERATIONS = 30;

export function percentile(sortedSamples: readonly number[], p: number): number {
  if (sortedSamples.length === 0) {
    throw new RangeError("cannot compute a percentile of zero samples");
  }
  const index = Math.min(
    sortedSamples.length - 1,
    Math.ceil((p / 100) * sortedSamples.length) - 1,
  );
  const sample = sortedSamples[Math.max(0, index)];
  if (sample === undefined) {
    throw new RangeError("percentile index resolved out of bounds");
  }
  return sample;
}

export function median(sortedSamples: readonly number[]): number {
  return percentile(sortedSamples, 50);
}

/**
 * Runs `fn` through `options.warmup` untimed iterations (discarded entirely, never entering
 * the timed set) followed by `options.iterations` individually timed iterations, and reports
 * the median and p95 of those timed samples — never a total-divided-by-N mean, since the mean
 * is exactly the statistic a single slow outlier (a cold sample, a GC pause, a deopt) destroys.
 */
export function runBenchmark(
  name: string,
  fn: () => void,
  options: BenchmarkOptions,
): BenchmarkResult {
  if (options.warmup <= 0) {
    throw new RangeError(
      "warmup must be a non-zero, positive count — the cold first invocation of a numeric pass runs interpreted before JIT tiering and can be 3-5x slower than the warm steady state, so a harness reporting a single cold sample is a defect, not a measurement",
    );
  }
  if (options.iterations < MIN_ITERATIONS) {
    throw new RangeError(
      `iterations must be >= ${MIN_ITERATIONS} for the median/p95 to be statistically meaningful, got ${options.iterations}`,
    );
  }

  const now = options.now ?? (() => performance.now());

  for (let i = 0; i < options.warmup; i += 1) {
    fn();
  }

  const samples: number[] = [];
  for (let i = 0; i < options.iterations; i += 1) {
    const start = now();
    fn();
    const end = now();
    samples.push(end - start);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const firstSample = sorted[0];
  const lastSample = sorted[sorted.length - 1];
  if (firstSample === undefined || lastSample === undefined) {
    throw new RangeError("no samples were recorded");
  }

  return {
    name,
    median: median(sorted),
    p95: percentile(sorted, 95),
    min: firstSample,
    max: lastSample,
    iterations: options.iterations,
    warmup: options.warmup,
    unit: "ms",
  };
}
