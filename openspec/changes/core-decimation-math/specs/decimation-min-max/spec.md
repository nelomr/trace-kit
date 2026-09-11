# Capability: decimation-min-max

> Change: `core-decimation-math`. New capability.

## ADDED Requirements

### Requirement: Bucketed Min-Max Envelope Into a Caller-Preallocated Buffer
`minMaxEnvelope` MUST accept flat positional parameters — never an options object literal at the
call site, because an object literal allocates and the call site of a per-frame decimation is a
hot path governed by the `allocation-free-hot-path` capability. `minMaxEnvelope` MUST NOT accept
an `x` parameter: buckets are index ranges over the sample prefix `y[sourceOffset …
sourceOffset + sampleCount)`, and the function never reads X (domain-keyed bucketing is a
different algorithm, owned elsewhere). `minMaxEnvelope` MUST compute a bucketed min/max envelope
over that input range and MUST write its result into a caller-preallocated output buffer,
starting at an explicit `outputOffset`, touching only `[outputOffset, outputOffset +
bucketCount * 2)`. It MUST NOT allocate any output buffer internally, and MUST return the count
of values written (`bucketCount * 2`).

The signature is:

```ts
function minMaxEnvelope(
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Float32Array,
  outputOffset: number,
  bucketCount: number,
): number;
```

There is exactly one signature for `minMaxEnvelope` across this change; no other spec in this
change MUST describe a different call shape.

#### Scenario: minMaxEnvelope writes into the caller's buffer, not a new one
- **GIVEN**: a preallocated `Float32Array` of length `4096` passed as `out`, and `y`, `1024`
  (`sourceOffset`), `2048` (`sampleCount`), `256` (`bucketCount`)
- **WHEN**: `minMaxEnvelope(y, 1024, 2048, out, 512, 256)` runs
- **THEN**: the function returns `512` (`bucketCount * 2`), never a newly allocated array, and
  `out` contains the computed min/max pairs written only over indices `[512, 1024)`

#### Scenario: No object literal appears at the call site
- **GIVEN**: any call site of `minMaxEnvelope` inside `packages/core/src/decimation/**`
- **WHEN**: a source-level check inspects the call's argument list
- **THEN**: every argument is a positional identifier, numeric literal, or typed-array reference,
  and no argument is an object literal

#### Scenario: minMaxEnvelope does not read an x parameter
- **GIVEN**: the committed signature of `minMaxEnvelope`
- **WHEN**: its parameter list is inspected
- **THEN**: it contains no X-buffer parameter, only `y`, `sourceOffset`, `sampleCount`, `out`,
  `outputOffset`, and `bucketCount`

### Requirement: Per-Bucket Bounding Correctness Property
For every bucket, the emitted min and max values MUST bound every sample assigned to that
bucket: `min[bucket] <= sample.y <= max[bucket]` for every sample in the bucket's index range.

#### Scenario: Property-based bounding check across random inputs
- **GIVEN**: a `fast-check` arbitrary generating a random `Float32Array` of Y values partitioned
  into buckets of random (but valid) sizes
- **WHEN**: `minMaxEnvelope` runs and the per-bucket sample ranges are checked against the
  emitted min/max
- **THEN**: for every generated case and every bucket, all samples in that bucket fall within
  `[min[bucket], max[bucket]]`

### Requirement: Boundary Preconditions
`minMaxEnvelope` MUST validate, at the function boundary before any loop runs, that
`bucketCount <= sampleCount`, `sourceOffset >= 0`, `sampleCount >= 0`, and that every numeric
argument is a non-negative integer within `[0, 2^31)`. A violation MUST raise a `RangeError`
naming the violated bound before any output is written. `bucketCount <= sampleCount` guarantees
no bucket is ever empty, so the per-bucket bounding property never applies vacuously to an empty
range.

#### Scenario: bucketCount greater than sampleCount is rejected
- **GIVEN**: `sampleCount = 100` and `bucketCount = 200`
- **WHEN**: `minMaxEnvelope` is invoked with these values
- **THEN**: it throws a `RangeError` before writing to `out`, and `out` is left unmodified

#### Scenario: A valid boundary case runs without error
- **GIVEN**: `sampleCount = 100` and `bucketCount = 100` (the equality boundary)
- **WHEN**: `minMaxEnvelope` runs
- **THEN**: it completes without throwing and every bucket contains exactly one sample

### Requirement: Single-Pass Deterministic Work Count
`minMaxEnvelope` MUST perform exactly one pass over the input, reading each sample in
`[sourceOffset, sourceOffset + sampleCount)` exactly once, and MUST write exactly
`bucketCount * 2` output values, independent of input size beyond that single pass.

#### Scenario: Output length matches bucketCount * 2 regardless of input size
- **GIVEN**: two runs with `sampleCount` of `1_000` and `1_000_000` respectively, both with
  `bucketCount = 512`, `sourceOffset = 0`
- **WHEN**: `minMaxEnvelope` runs for both
- **THEN**: exactly `1024` output values are written in both cases, and an instrumented input
  iterator records exactly `sampleCount` reads (one pass, one read per sample) in each run

### Requirement: Zero Allocation, Asserted by GC-Event Count
`minMaxEnvelope` MUST NOT allocate on its hot path. This is asserted by a `PerformanceObserver`
with `entryTypes: ['gc']` reporting zero `gc` entries over N warm iterations under
`--expose-gc`, per claim **C4b**. The same test file MUST include an allocating control variant
(e.g. one that uses `.slice()` or builds an array per bucket) that reports non-zero GC events
over the same N iterations, proving the gate is live rather than vacuous.

The gate MUST run both of the following configurations, each asserted at zero, because a
per-call allocation and a per-sample allocation hide from different ones:

| Configuration | `sampleCount` | `bucketCount` | iterations |
|---|---|---|---|
| `small` | `4,096` | `512` | `10,000` |
| `large` | `1,000,000` | `1,000` | `200` |

#### Scenario: The allocation-free variant reports zero GC events at the small configuration
- **GIVEN**: `minMaxEnvelope` invoked `10,000` times with `sampleCount = 4,096` and
  `bucketCount = 512`, after a warm-up phase, under `node --expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts GC entries during the
  measured window
- **THEN**: the observed GC event count is exactly `0`

#### Scenario: The allocation-free variant reports zero GC events at the large configuration
- **GIVEN**: `minMaxEnvelope` invoked `200` times with `sampleCount = 1,000,000` and
  `bucketCount = 1,000`, after a warm-up phase, under `node --expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts GC entries during the
  measured window
- **THEN**: the observed GC event count is exactly `0`

#### Scenario: The allocating control variant reports non-zero GC events in the same run
- **GIVEN**: a deliberately allocating variant of the same bucketing logic (e.g. constructing a
  new array literal per bucket) invoked the same number of times, at the same `sampleCount` and
  `bucketCount`, in the same test file for both the `small` and `large` configurations
- **WHEN**: the same `PerformanceObserver` measures it
- **THEN**: the observed GC event count is greater than `0` for each configuration,
  demonstrating the instrumentation is capable of detecting allocation (the `C4b` 0-vs-17
  discrimination discipline)

### Requirement: NaN Is the "No Sample" Sentinel; an All-Gap Bucket Emits NaN, Never Infinity
`NaN` MUST be treated as the normative "no sample" (telemetry gap) sentinel. A bucket containing
at least one non-NaN sample MUST emit the min/max of its non-NaN samples only. A bucket whose
samples are **all** NaN MUST emit `NaN` for both its min and max; it MUST NOT emit `+Infinity`,
`-Infinity`, or any other sentinel, because a renderer given `±Infinity` draws a fabricated
full-height spike, in violation of CLAUDE.md rule 6. A finite `+Infinity` or `-Infinity` sample
present in the input is a real over-range reading and MUST propagate unchanged into the emitted
min/max.

#### Scenario: A bucket with one gap among real samples reports the envelope of the real samples
- **GIVEN**: a bucket containing 99 finite samples and 1 `NaN` sample
- **WHEN**: `minMaxEnvelope` computes that bucket's min/max
- **THEN**: the emitted min and max equal the min and max of the 99 finite samples, ignoring the
  `NaN`

#### Scenario: An all-NaN bucket emits NaN/NaN, not Infinity
- **GIVEN**: a bucket whose every sample is `NaN`
- **WHEN**: `minMaxEnvelope` computes that bucket's min/max
- **THEN**: both the emitted min and the emitted max are `NaN`, and neither is `+Infinity` or
  `-Infinity`

#### Scenario: A real +Infinity sample propagates unchanged
- **GIVEN**: a bucket whose only sample is the finite-input value `+Infinity`
- **WHEN**: `minMaxEnvelope` computes that bucket's min/max
- **THEN**: both the emitted min and max equal `+Infinity`, not `NaN`

### Requirement: Deopt Freedom
`minMaxEnvelope` MUST NOT deoptimize under `--trace-deopt` across its tested input shapes.

#### Scenario: No deoptimization reported for minMaxEnvelope
- **GIVEN**: a benchmark script invoking `minMaxEnvelope` repeatedly with monomorphic typed-array
  arguments
- **WHEN**: `node --trace-deopt` runs the script
- **THEN**: the trace output contains no deoptimization entry naming `minMaxEnvelope`

### Requirement: Determinism
Repeated invocation of `minMaxEnvelope` over identical input MUST yield byte-identical output,
across repeated runs and across Node versions available in CI.

#### Scenario: Byte-identical output across repeated runs
- **GIVEN**: a fixed input X/Y series and bucket configuration
- **WHEN**: `minMaxEnvelope` runs twice against fresh output buffers
- **THEN**: the two output buffers are byte-identical (`Buffer.compare` equivalent equals 0)

### Requirement: Benchmark Output Feeds the Regression Comparator Owned by Change 16
This change's ownership stops at emission: `minMaxEnvelope` MUST be benchmarked warm,
median-of-N, through the `benchmark-harness` capability, and its median, p95, and iteration count
MUST be written into `bench-results.json` in the machine-readable format that change 16's
regression comparator consumes. This change MUST NOT implement a stored-baseline comparison, a
declared relative-tolerance check, or a benchmark-triggered CI failure for `minMaxEnvelope` —
that comparator, its tolerance value, its baseline storage location, and its no-baseline
behaviour are change 16's `benchmark-regression-gate` capability, per `proposal.md`'s Scope &
Non-Goals ("Coverage thresholds ... change 16") and `packages/core/bench/README.md`, which
states that baseline-comparison and regression-budget computation belong to change 16.

#### Scenario: bench-results.json carries a consumable entry with no local pass/fail verdict
- **GIVEN**: a benchmark run of `minMaxEnvelope`
- **WHEN**: `bench-results.json` is written
- **THEN**: it contains a `minMaxEnvelope` entry with `median`, `p95`, and `iterations` fields,
  and no field or side effect in this change's own test suite asserts a pass/fail verdict against
  a stored baseline for `minMaxEnvelope`

### Requirement: Informational Reference-Hardware Benchmark (Non-Blocking)
The literal figure "Min-Max envelope over 1e6 samples: under 4 ms" MUST be recorded only as an
informational benchmark on declared reference hardware, warm, median-of-N, and MUST NOT be
gated on shared CI runners.

#### Scenario: The 4 ms figure is documented as informational, not a CI gate
- **GIVEN**: the committed benchmark documentation for `minMaxEnvelope`
- **WHEN**: a reviewer inspects the CI configuration for a step that fails the build if the
  reference-hardware run exceeds 4 ms
- **THEN**: no such blocking step exists; the figure appears only in a non-blocking
  informational report
