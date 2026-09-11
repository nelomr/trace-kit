import path from "node:path";
import { lttb } from "../src/decimation/lttb.js";
import { minMaxEnvelope } from "../src/decimation/min-max.js";
import { runBenchmarkSuite, writeBenchResults } from "./runner.js";
import { runTraceDeoptCheck } from "./trace-deopt.js";

// Bench entrypoint. Argv dispatch: no flag runs the real-workload timing suite through
// `runBenchmarkSuite`; `--trace-deopt` runs the separate deopt-freedom check instead (a
// distinct process mode, since `--trace-deopt` is a V8 flag that must be set at process
// start, so it cannot be toggled from inside an already-running process).
if (process.argv.includes("--trace-deopt")) {
  const exitCode = runTraceDeoptCheck();
  process.exit(exitCode);
} else {
  const sampleCount = 1_000_000;
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    y[i] = Math.sin(i * 0.001) * 100 + Math.cos(i * 0.0003) * 20;
  }
  const bucketCount = 2000; // ~2x a realistic viewport width in pixels
  const minMaxOut = new Float32Array(bucketCount * 2);

  const x = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) x[i] = i;
  const threshold = 2000;
  const lttbOut = new Int32Array(threshold);

  const result = runBenchmarkSuite([
    {
      name: "minMaxEnvelope",
      fn: () => {
        minMaxEnvelope(y, 0, sampleCount, minMaxOut, 0, bucketCount);
      },
      options: { warmup: 20, iterations: 30 },
    },
    {
      name: "lttb",
      fn: () => {
        lttb(x, y, 0, sampleCount, lttbOut, 0, threshold);
      },
      options: { warmup: 20, iterations: 30 },
    },
  ]);

  const outPath = path.join(import.meta.dirname, "bench-results.json");
  writeBenchResults(outPath, result);

  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(result, null, 2));
}
