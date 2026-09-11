# `@trace-kit/core` Benchmark Harness

## What this is

A dependency-free (well, `tsx`-run) warm-up + N-measured-iterations + median/p95 timing
harness (`runner.ts`). It exists so every later performance criterion in the roadmap can be
expressed as a **self-calibrating relative regression budget measured on the executing
runner** — never a literal ms/FPS number, because comparing a laptop median to a CI-runner
median is meaningless.

Run it with:

```sh
pnpm --filter @trace-kit/core run bench
```

This writes `bench-results.json` (gitignored — it is a machine/run-specific artifact, not a
committed asset) next to `bench/index.ts`.

## Why warm-up is not a nicety

The cold first invocation of a numeric pass runs interpreted before TurboFan tiering and can
be 3–5x slower than the warm steady state — enough on its own to blow any millisecond budget.
`runBenchmark`
requires a non-zero `warmup` count and discards those iterations entirely from the timed set;
a harness that reports a single cold sample is a defect, not a measurement.

## The harness's own tests are not workload benchmarks — both statements are true at once

`packages/core/test/bench/warmup-median.test.ts` and `.../result-format.test.ts` verify the
harness's **logic** — that the median genuinely excludes the cold sample, that the written
JSON carries the full schema below. They are fast, deterministic, and coverage-safe, and
**legitimately run inside `turbo run test`** (they live under `packages/core/test/bench/`,
matched by the `core` Vitest project's `test/**/*.test.ts` include glob).

This is a different thing from a **real-workload benchmark that asserts a wall-clock
budget** — that must never enter the test run or `ci.yml`. Excluding "benchmarks" from the
test run means excluding workload timing assertions, not the tests that verify the timing
machinery itself works correctly.

## Hard separation from `test` and CI

The `bench` script (`tsx bench/index.ts`) is deliberately not named `test`/`test:unit`, is not
a `turbo.json` task, and is not referenced by any `test` task's `dependsOn`. It appears nowhere
in `.github/workflows/ci.yml`. Coverage instrumentation (`@vitest/coverage-v8`) rewrites the
code under measurement and distorts timing, so a benchmark inside a coverage job produces a
number that looks precise and means nothing. Timing output from this harness is
**informational on shared CI runners and is never a merge gate there** — shared runners have
variable, contended CPU allocation, so a hard millisecond threshold there would be flaky by
construction. Stored-baseline comparison and regression-budget computation are a separate
concern from this harness, which only supplies the measurement.

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

`schemaVersion` lets a future consumer refuse an unrecognized file loudly instead
of reading `undefined` as `0`. The `runner` block exists because a baseline is meaningless
without knowing which machine produced it. `iterations` and `warmup` are recorded because a
median over N=3 and a median over N=1000 are not comparable numbers.

## What this harness does not build

The **GC-event zero-allocation gate** (`PerformanceObserver`, `entryTypes: ['gc']`,
`--expose-gc`) is a separate concern from this harness, which supplies only the
warm-up/median/p95 timing and the JSON format that such a gate would consume. A CDP
`HeapProfiler` browser-side allocation gate is likewise out of scope here. Any
baseline-comparison or regression-budget *computation*, and any CI merge gate on timing:
none exists in this harness, deliberately — see the sections above for why.

`runBenchmark` itself allocates a `number[]` sample array per run and times with
`performance.now()` per call — negligible against `packages/core`'s own timing budgets, but if
a future change reuses this runner to measure something allocation-sensitive, that overhead
needs to be acknowledged or subtracted rather than attributed to the code under measurement.

## Real first consumers: `minMaxEnvelope` and `lttb`

`bench/index.ts` runs both decimation algorithms warm, `warmup: 20, iterations: 30`, over a
1,000,000-sample synthetic series. Declared reference-hardware record from a real run:

```json
{
  "runner": {
    "node": "v24.16.0",
    "platform": "darwin",
    "arch": "x64",
    "cpuModel": "Intel(R) Core(TM) i5-1038NG7 CPU @ 2.00GHz"
  },
  "benchmarks": {
    "minMaxEnvelope": { "median": 1.50, "p95": 1.96, "iterations": 30 },
    "lttb": { "median": 4.85, "p95": 6.67, "iterations": 30 }
  }
}
```

**These figures — and the roadmap's own "Min-Max over 1e6 samples: under 4 ms" / "LTTB over
1e6 samples: under 12 ms" — are informational only, on the declared machine above, and are
never gated on shared CI runners.** No `turbo.json` task and no `ci.yml` step asserts a
pass/fail verdict against them. Stored-baseline comparison and regression-budget computation
are a separate concern; this harness supplies only the measurement, in the
`bench-results.json` format such a comparator would consume.

## `--trace-deopt` mode (local-only)

```sh
pnpm --filter @trace-kit/core run bench:deopt
```

Runs a supervisor (`bench/trace-deopt.ts`) that spawns a fresh `node --trace-deopt` child
running `bench/deopt-workload.ts` (which imports `minMaxEnvelope`/`lttb` from `src/`, not
`dist`, so the trace names match the authored function names), warms both to tier-up with
monomorphic arguments, then deliberately deopts a sentinel fixture (`injectedDeoptFixture`, via
a hidden-class/map transition after warm-up — not a `Float32Array`-then-`Float64Array` call,
which commonly produces a polymorphic inline cache and no traced deopt line at all under modern
V8) to prove the parser is still matching. Two distinct, meaningful exit codes:

- **exit `0`** — clean: no deoptimization entry names `minMaxEnvelope` or `lttb`, and the
  sentinel was detected as expected.
- **exit `1`** — a real deoptimization was reported for `minMaxEnvelope` and/or `lttb`.
- **exit `2`** — the sentinel fixture's own deopt was *not* detected, meaning the trace parser
  or the fixture itself is broken; a clean report under these conditions cannot be trusted.
  Exit `2` is distinct from exit `1` specifically so a parser that silently stops matching
  after a V8 upgrade cannot report false-clean forever.

**Local-only, never CI.** `bench:deopt` appears in no `turbo.json` task and no
`.github/workflows/ci.yml` step — `--trace-deopt` output is high-volume and V8-version-
sensitive, making it a good pre-merge/pre-release local check and a poor merge gate.
