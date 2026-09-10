import { describe, expect, it } from "vitest";
import { runBenchmarkSuite, writeBenchResults } from "../../bench/runner.js";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// RED/GREEN for design.md §D6's full result-file schema: not just `median`/`p95`/
// `iterations`, but `schemaVersion` (so a future change-16 consumer can refuse an
// unrecognized file loudly instead of reading `undefined` as `0`) and a `runner` block
// (confirmed decision 3 makes every performance criterion a self-calibrating relative budget
// measured on the executing runner — a baseline is meaningless without knowing which machine
// produced it), plus `warmup`.
describe("bench result format", () => {
  it("produces the full D6 schema for a run of N >= 30 iterations", () => {
    const fileResult = runBenchmarkSuite([
      {
        name: "noop",
        fn: () => {
          /* deliberately trivial */
        },
        options: { warmup: 5, iterations: 30 },
      },
    ]);

    expect(fileResult.schemaVersion).toBe(1);
    expect(typeof fileResult.createdAt).toBe("string");
    expect(fileResult.runner.node.length).toBeGreaterThan(0);
    expect(fileResult.runner.platform.length).toBeGreaterThan(0);
    expect(fileResult.runner.arch.length).toBeGreaterThan(0);
    expect(fileResult.runner.cpuModel.length).toBeGreaterThan(0);

    const noop = fileResult.benchmarks.noop;
    if (noop === undefined) {
      throw new Error("expected a 'noop' benchmark entry");
    }
    expect(typeof noop.median).toBe("number");
    expect(typeof noop.p95).toBe("number");
    expect(typeof noop.min).toBe("number");
    expect(typeof noop.max).toBe("number");
    expect(noop.iterations).toBe(30);
    expect(noop.warmup).toBe(5);
    expect(noop.unit).toBe("ms");
  });

  it("writes a bench-results.json file that round-trips the same schema", () => {
    const fileResult = runBenchmarkSuite([
      {
        name: "noop",
        fn: () => {
          /* deliberately trivial */
        },
        options: { warmup: 5, iterations: 30 },
      },
    ]);
    const outPath = path.join(tmpdir(), `bench-results-${Date.now()}.json`);
    writeBenchResults(outPath, fileResult);

    const parsed: unknown = JSON.parse(readFileSync(outPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("schemaVersion" in parsed) ||
      !("runner" in parsed)
    ) {
      throw new Error("expected the written file to parse with schemaVersion and runner");
    }
    expect(parsed.schemaVersion).toBe(1);
  });
});
