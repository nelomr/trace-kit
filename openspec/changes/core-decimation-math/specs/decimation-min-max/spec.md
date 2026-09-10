# Capability: decimation-min-max

> Change: `core-decimation-math`. New capability.

## ADDED Requirements

### Requirement: Bucketed Min-Max Envelope Into a Caller-Preallocated Buffer
`minMaxEnvelope` MUST compute a bucketed min/max envelope over an input X/Y series and MUST
write its result into a caller-preallocated output buffer. It MUST NOT allocate any output
buffer internally.

#### Scenario: minMaxEnvelope writes into the caller's buffer, not a new one
- **GIVEN**: a preallocated `Float32Array` of length `bucketCount * 2` passed as `out`
- **WHEN**: `minMaxEnvelope(x, y, out, { bucketCount, sampleCount })` runs
- **THEN**: the function's return value is `void` or a count, never a newly allocated array, and
  `out` contains the computed min/max pairs

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

### Requirement: Single-Pass Deterministic Work Count
`minMaxEnvelope` MUST perform exactly one pass over the input and MUST write exactly
`bucketCount * 2` output values, independent of input size beyond that single pass.

#### Scenario: Output length matches bucketCount * 2 regardless of input size
- **GIVEN**: two runs with `sampleCount` of `1_000` and `1_000_000` respectively, both with
  `bucketCount = 512`
- **WHEN**: `minMaxEnvelope` runs for both
- **THEN**: exactly `1024` output values are written in both cases, and an instrumented input
  iterator records exactly `sampleCount` reads (one pass) in each run

### Requirement: Zero Allocation, Asserted by GC-Event Count
`minMaxEnvelope` MUST NOT allocate on its hot path. This is asserted by a `PerformanceObserver`
with `entryTypes: ['gc']` reporting zero `gc` entries over N warm iterations under
`--expose-gc`, per claim **C4b**. The same test file MUST include an allocating control variant
(e.g. one that uses `.slice()` or builds an array per bucket) that reports non-zero GC events
over the same N iterations, proving the gate is live rather than vacuous.

#### Scenario: The allocation-free variant reports zero GC events
- **GIVEN**: `minMaxEnvelope` invoked 10,000 times after a warm-up phase, under
  `node --expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts GC entries during the
  measured window
- **THEN**: the observed GC event count is exactly `0`

#### Scenario: The allocating control variant reports non-zero GC events in the same run
- **GIVEN**: a deliberately allocating variant of the same bucketing logic (e.g. constructing a
  new array literal per bucket) invoked the same number of times in the same test file
- **WHEN**: the same `PerformanceObserver` measures it
- **THEN**: the observed GC event count is greater than `0`, demonstrating the instrumentation
  is capable of detecting allocation (the `C4b` 0-vs-17 discrimination discipline)

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

### Requirement: Relative Regression Budget (Self-Calibrating)
`minMaxEnvelope`'s warm, median-of-N throughput MUST be measured by the benchmark harness against
a baseline recorded on the same runner, and a relative regression beyond the declared tolerance
MUST fail the benchmark check. This is the only timing gate that blocks.

#### Scenario: A regression beyond tolerance fails the benchmark check
- **GIVEN**: a recorded baseline median for `minMaxEnvelope` on the executing runner
- **WHEN**: a subsequent benchmark run's median exceeds the baseline by more than the declared
  relative tolerance
- **THEN**: the benchmark check reports failure

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
