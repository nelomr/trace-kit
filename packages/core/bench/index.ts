import path from "node:path";
import { runBenchmarkSuite, writeBenchResults } from "./runner.js";

// Bench entrypoint (design.md §D6). This change is harness-only — no domain code exists yet
// (`src/index.ts` is a `VERSION` export). This placeholder benchmark demonstrates the harness
// end to end (warm-up, N-iteration timing, median/p95, the full result schema written to
// `bench-results.json`) and is intended to be replaced by a real workload benchmark in
// `core-decimation-math` (change 2) once there is decimation code to measure.
function placeholderWorkload(): void {
  let acc = 0;
  for (let i = 0; i < 10_000; i += 1) {
    acc += Math.sqrt(i);
  }
  void acc;
}

const result = runBenchmarkSuite([
  {
    name: "placeholder",
    fn: placeholderWorkload,
    options: { warmup: 5, iterations: 30 },
  },
]);

const outPath = path.join(import.meta.dirname, "bench-results.json");
writeBenchResults(outPath, result);

console.log(`Wrote ${outPath}`);
console.log(JSON.stringify(result, null, 2));
