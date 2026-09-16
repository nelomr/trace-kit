import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import type { BenchmarkOptions, BenchmarkResult } from "./runner-core.js";
import { runBenchmark } from "./runner-core.js";

// Node-coupled reporting half of the benchmark harness. The isomorphic
// warm-up/median-of-N logic lives in `runner-core.ts`, which has no `node:*` import and is
// what a browser consumer (`apps/playground`'s millisecond table) reaches through the
// `@trace-kit/bench-harness` alias. Re-exporting it here keeps every existing import path
// (`bench/runner.js`, `bench/index.ts`) byte-compatible.
export * from "./runner-core.js";

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
