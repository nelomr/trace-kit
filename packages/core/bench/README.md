# `@trace-kit/core` Benchmark Harness

## What this is

A dependency-free (well, `tsx`-run) warm-up + N-measured-iterations + median/p95 timing
harness (`runner.ts`), implementing design.md §D6. It exists so every later performance
criterion in the roadmap can be expressed as a **self-calibrating relative regression budget
measured on the executing runner**, per confirmed decision 3 — never a literal ms/FPS number,
because comparing a laptop median to a CI-runner median is meaningless.

Run it with:

```sh
pnpm --filter @trace-kit/core run bench
```

This writes `bench-results.json` (gitignored — it is a machine/run-specific artifact, not a
committed asset) next to `bench/index.ts`.

## Why warm-up is not a nicety

Per claim **C4b** (`openspec/changes/00-roadmap-decomposition/research.md`), the cold first
invocation of a numeric pass runs interpreted before TurboFan tiering and can be 3–5x slower
than the warm steady state — enough on its own to blow any millisecond budget. `runBenchmark`
requires a non-zero `warmup` count and discards those iterations entirely from the timed set;
a harness that reports a single cold sample is a defect, not a measurement.

## The harness's own tests are not workload benchmarks — both statements are true at once

`packages/core/test/bench/warmup-median.test.ts` and `.../result-format.test.ts` (tasks
4.1–4.4) verify the harness's **logic** — that the median genuinely excludes the cold sample,
that the written JSON carries the full schema below. They are fast, deterministic, and
coverage-safe, and **legitimately run inside `turbo run test`** (they live under
`packages/core/test/bench/`, matched by the `core` Vitest project's `test/**/*.test.ts`
include glob).

This is a different thing from a **real-workload benchmark that asserts a wall-clock
budget** — that must never enter the test run or `ci.yml`. Read literally, "no benchmarks in
the test run" would delete 4.1–4.4; it does not. The rule is specifically about workload
timing assertions, not about testing the timing machinery itself.

## Hard separation from `test` and CI

The `bench` script (`tsx bench/index.ts`) is deliberately not named `test`/`test:unit`, is not
a `turbo.json` task, and is not referenced by any `test` task's `dependsOn`. It appears nowhere
in `.github/workflows/ci.yml`. Coverage instrumentation (`@vitest/coverage-v8`) rewrites the
code under measurement and distorts timing, so a benchmark inside a coverage job produces a
number that looks precise and means nothing. Timing output from this harness is
**informational on shared CI runners and is never a merge gate there** — the roadmap's
change 16 (`benchmark-ci-and-deployment`) owns the stored baseline and the regression-budget
*comparison*; this harness only supplies the measurement.

## Result schema (`bench-results.json`)

```json
{
  "schemaVersion": 1,
  "createdAt": "<ISO-8601 string>",
  "runner": { "node": "...", "platform": "...", "arch": "...", "cpuModel": "..." },
  "benchmarks": {
    "<name>": {
      "median": 0,
      "p95": 0,
      "min": 0,
      "max": 0,
      "iterations": 30,
      "warmup": 5,
      "unit": "ms"
    }
  }
}
```

`schemaVersion` lets a future consumer (change 16) refuse an unrecognized file loudly instead
of reading `undefined` as `0`. The `runner` block exists because a baseline is meaningless
without knowing which machine produced it. `iterations` and `warmup` are recorded because a
median over N=3 and a median over N=1000 are not comparable numbers.

## What this harness does not build

The **GC-event zero-allocation gate** (`PerformanceObserver`, `entryTypes: ['gc']`,
`--expose-gc`) belongs to `core-decimation-math` (change 2), per claim **C4b** — this harness
supplies only the warm-up/median/p95 timing and the JSON format that gate consumes. See
`openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs` for the worked
reference whose measurement style change 2 follows (cross-referenced, not copied in). The CDP
`HeapProfiler` browser gate (claim **C4d**) belongs to changes 5/7. Any baseline-comparison or
regression-budget *computation* belongs to change 16. Any CI merge gate on timing: none exists
here, deliberately.
