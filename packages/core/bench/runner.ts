import { writeFileSync } from "node:fs";
import { cpus } from "node:os";

// Benchmark harness. Dependency-free: warm-up + N-measured-iterations + median/p95
// reporting, and the result JSON schema below. Excluded from the published build —
// this file lives outside `src/`, so `tsup.config.ts` (which only globs `src/**`) never sees
// it; it is nonetheless typechecked and linted via `packages/core/tsconfig.test.json`, which
// includes `bench/**/*`.
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

export interface RunnerInfo {
  node: string;
  platform: string;
  arch: string;
  cpuModel: string;
}

export interface BenchmarkFileResult {
  schemaVersion: 1;
  createdAt: string;
  runner: RunnerInfo;
  benchmarks: Record<string, Omit<BenchmarkResult, "name">>;
}

const MIN_ITERATIONS = 30;

function percentile(sortedSamples: readonly number[], p: number): number {
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

function median(sortedSamples: readonly number[]): number {
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

function currentRunnerInfo(): RunnerInfo {
  const cpuList = cpus();
  const firstCpu = cpuList[0];
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: firstCpu?.model ?? "unknown",
  };
}

/**
 * Runs a set of named benchmarks and assembles the full result-file schema
 * (`schemaVersion`, `createdAt`, `runner`, `benchmarks`).
 */
export function runBenchmarkSuite(
  benchmarks: ReadonlyArray<{ name: string; fn: () => void; options: BenchmarkOptions }>,
): BenchmarkFileResult {
  const results: Record<string, Omit<BenchmarkResult, "name">> = {};
  for (const { name, fn, options } of benchmarks) {
    const result = runBenchmark(name, fn, options);
    results[name] = {
      median: result.median,
      p95: result.p95,
      min: result.min,
      max: result.max,
      iterations: result.iterations,
      warmup: result.warmup,
      unit: result.unit,
    };
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    runner: currentRunnerInfo(),
    benchmarks: results,
  };
}

/**
 * Writes a {@link BenchmarkFileResult} to `filePath` as machine-readable JSON
 * (`bench-results.json`) — one entry per named benchmark, with the full
 * `schemaVersion`/`runner` envelope every later regression-budget consumer requires.
 */
export function writeBenchResults(filePath: string, result: BenchmarkFileResult): void {
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
