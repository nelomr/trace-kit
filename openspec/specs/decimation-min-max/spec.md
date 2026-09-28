# Capability: decimation-min-max

> Changes: `core-decimation-math` (initial), `playground-shell` (added the `out.length`
> boundary-check requirement, closing a silent-truncation gap the base spec had left
> unvalidated).

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
`bucketCount <= sampleCount`, `sourceOffset >= 0`, `sampleCount >= 0`, that every numeric
argument is a non-negative integer within `[0, 2^31)`, **and that `out.length >= outputOffset +
bucketCount * 2`**. A violation MUST raise a `RangeError` naming the violated bound before any
output is written. `bucketCount <= sampleCount` guarantees no bucket is ever empty, so the
per-bucket bounding property never applies vacuously to an empty range. The `out.length` bound
guarantees the function's own documented write range, `[outputOffset, outputOffset + bucketCount
* 2)`, always fits inside `out`: without it, an undersized `out` accepts a silent truncated
write rather than an error, because a typed array silently drops an out-of-range indexed write
instead of throwing.

`lttb` (`decimation-lttb`) validates `out.length >= outputOffset + threshold` for the same
reason: both decimation entry points now validate their output buffer identically, so a caller
correct about one function's `out` sizing convention is correct about the other's — there is no
"validates sometimes" surface between the two functions this change's `/core-math` view chooses
between.

#### Scenario: bucketCount greater than sampleCount is rejected
- **GIVEN**: `sampleCount = 100` and `bucketCount = 200`
- **WHEN**: `minMaxEnvelope` is invoked with these values
- **THEN**: it throws a `RangeError` before writing to `out`, and `out` is left unmodified

#### Scenario: A valid boundary case runs without error
- **GIVEN**: `sampleCount = 100` and `bucketCount = 100` (the equality boundary)
- **WHEN**: `minMaxEnvelope` is invoked with a correctly sized `out`
- **THEN**: it completes without throwing

#### Scenario: An undersized out is rejected before any write
- **GIVEN**: `outputOffset = 0`, `bucketCount = 256` (so the write needs 512 elements) and an
  `out` of length `511`
- **WHEN**: `minMaxEnvelope` is invoked with these values
- **THEN**: it throws a `RangeError` naming the violated `out.length` bound before writing any
  element, and `out` is left byte-for-byte unmodified

#### Scenario: The exact-fit boundary completes without throwing
- **GIVEN**: `outputOffset = 0`, `bucketCount = 256` and an `out` of length exactly `512`
  (`outputOffset + bucketCount * 2`)
- **WHEN**: `minMaxEnvelope` is invoked with these values
- **THEN**: it completes without throwing and writes exactly the `512` values into
  `[0, 512)`

#### Scenario: A non-zero outputOffset large enough for the values alone is still rejected
- **GIVEN**: `outputOffset = 100`, `bucketCount = 256` (needing `512` elements starting at
  `100`, i.e. `out.length >= 612`) and an `out` of length `600` — large enough to hold `512`
  values on its own, but not large enough once `outputOffset` is added
- **WHEN**: `minMaxEnvelope` is invoked with these values
- **THEN**: it throws a `RangeError` before writing to `out`, and `out` is left unmodified

#### Scenario: The out.length check runs at the boundary, not inside the per-bucket loop
- **GIVEN**: an instrumented call path that records when each validation check runs relative to
  the first per-bucket iteration
- **WHEN**: `minMaxEnvelope` runs, whether `out` is valid or undersized
- **THEN**: the `out.length` check evaluates once, before the per-bucket loop begins, alongside
  the function's other boundary checks — it MUST NOT add a per-bucket or per-sample comparison,
  so it adds no work to the hot path and does not affect the zero-allocation GC-event gate
  (claim **C4b**) already measured for `minMaxEnvelope`

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
## MODIFIED Requirements

### Requirement: A Mixed Bucket Never Silently Bridges a Gap Into Its Envelope
A bucket containing both one or more real (non-`NaN`) samples and one or more `NaN` samples MUST
NOT report an envelope computed only from its real samples as if the bucket were entirely
gap-free — doing so is the exact silent-bridging defect this change closes (a hole narrower than
a bucket disappearing into the reported min/max of its real neighbours). Instead, `minMaxEnvelope` MUST emit `NaN` for
both the min and the max of that bucket — the same encoding as an all-`NaN` bucket — and the
output length MUST remain exactly `bucketCount * 2`. This requirement **replaces** the archived
sentence "A bucket containing at least one non-NaN sample MUST emit the min/max of its non-NaN
samples only" and **supersedes** the archived scenario "A bucket with one gap among real samples
reports the envelope of the real samples". The archived all-`NaN`-bucket case is retained; the
archived `±Infinity` propagation case is retained for buckets that contain no `NaN` sample.

#### Scenario: A mixed bucket emits a detectable break rather than the real-sample envelope alone
- **GIVEN**: a bucket containing 60 real samples and 1 `NaN` sample positioned such that a hole
  narrower than the bucket exists
- **WHEN**: `minMaxEnvelope` computes that bucket's output
- **THEN**: both the emitted min and max for that bucket are `NaN`

#### Scenario: A downstream renderer does not bridge a mixed-bucket gap
- **GIVEN**: a mixed bucket's break-marked output, consumed by the Canvas2D path builder
- **WHEN**: the trace is rendered
- **THEN**: no line segment is drawn connecting a sample before the gap to a sample after it
  through that bucket, consistent with `gap-sentinel-semantics`'s "A Gap Is Never Interpolated
  Across" requirement

#### Scenario: Property check — no mixed bucket's reported envelope silently absorbs its gap
- **GIVEN**: a `fast-check` arbitrary generating buckets with a random mix of real samples and
  0 or more `NaN` samples, including buckets with exactly one `NaN` among many real samples
- **WHEN**: `minMaxEnvelope` computes every generated bucket's output
- **THEN**: for every bucket containing at least one real sample and at least one `NaN` sample,
  the emitted min and max are both `NaN`, and every bucket containing no `NaN` equals the
  pre-change output

### Requirement: The All-`NaN`-Bucket Rule Is Retained; `±Infinity` Propagates Only in Gap-Free Buckets
A bucket whose samples are **all** `NaN` MUST emit `NaN` for both min and max (never `±Infinity`
or any other sentinel), exactly as archived. A real finite-input `+Infinity` or `-Infinity` sample
MUST propagate unchanged into the emitted min/max of any bucket containing it **and no `NaN`
sample**. In a bucket containing both an infinite sample and a `NaN` sample, the break takes
precedence and the bucket emits `NaN`/`NaN`.

#### Scenario: An all-NaN bucket still emits NaN/NaN, not a break marker in place of it
- **GIVEN**: a bucket whose every sample is `NaN`
- **WHEN**: `minMaxEnvelope` computes that bucket's output
- **THEN**: both the emitted min and max are `NaN`, exactly as the archived requirement states

#### Scenario: A real +Infinity sample in a gap-free bucket propagates unchanged
- **GIVEN**: a bucket containing one `+Infinity` sample and several ordinary finite samples
- **WHEN**: `minMaxEnvelope` computes that bucket's output
- **THEN**: the emitted max equals `+Infinity`

#### Scenario: A gap takes precedence over +Infinity in the same bucket
- **GIVEN**: a bucket containing one `+Infinity` sample, one `NaN` sample, and several ordinary
  finite samples
- **WHEN**: `minMaxEnvelope` computes that bucket's output
- **THEN**: both the emitted min and max are `NaN`

### Requirement: Gap-Free Input Is Byte-Identical to the Pre-Change Implementation
For any input containing no `NaN` sample, `minMaxEnvelope`'s output MUST be byte-identical to the
archived (pre-this-change) implementation's output for the same input and parameters, including
`bucketCount * 2` as the exact output length with no break-marker overhead. This is the
regression guarantee named in `proposal.md` Risk 1 and Success Criteria.

#### Scenario: A gap-free input produces exactly bucketCount * 2 values, no break overhead
- **GIVEN**: an input Y buffer containing no `NaN` sample
- **WHEN**: `minMaxEnvelope` runs with a given `bucketCount`
- **THEN**: it returns exactly `bucketCount * 2`, matching the archived "Single-Pass
  Deterministic Work Count" requirement verbatim, with no additional break-marker slots

### Requirement: Zero-Allocation and Determinism Hold Unchanged With Gap-Containing Input
The archived "Zero Allocation, Asserted by GC-Event Count," "Deopt Freedom," and "Determinism"
requirements continue to hold, unchanged, when the input Y buffer contains `NaN` gaps, including
mixed buckets. Gap detection MUST use the inline self-comparison `y[i] !== y[i]` (per
`gap-sentinel-semantics`), adding no allocation and no additional pass over the input beyond the
archived single-pass, one-read-per-sample bound.

#### Scenario: Zero GC events hold for gap-containing input at the small configuration
- **GIVEN**: the archived `small` GC-event configuration (`sampleCount = 4,096`,
  `bucketCount = 512`, `10,000` iterations), with a fixed pattern of mixed and all-`NaN` buckets
  present
- **WHEN**: `minMaxEnvelope` runs under the archived `PerformanceObserver({ entryTypes: ['gc'] })`
  gate
- **THEN**: the observed GC event count is exactly `0`, matching the archived gap-free result

#### Scenario: The single-pass, one-read-per-sample bound holds with gaps present
- **GIVEN**: an instrumented input iterator and a Y buffer containing a mix of real, `NaN`, and
  `+Infinity` samples
- **WHEN**: `minMaxEnvelope` computes the full bucketed envelope
- **THEN**: the instrumented iterator records exactly `sampleCount` reads — one pass, one read
  per sample, unchanged from the archived gap-free work-count guarantee

### Requirement: `minMaxEnvelopeIndices` Emits `[-1, -1]` for Any Bucket Containing a Gap
This MODIFIES the shipped behavior of `minMaxEnvelopeIndices` (specified in
`selectable-decimation`): a bucket containing at least one `NaN` sample — whether mixed or all-`NaN`
— MUST emit the pair `[-1, -1]`, replacing the previous unspecified `[start, start]` fallback for
all-`NaN` buckets (which pointed at a `NaN` sample) and the real-sample argmin/argmax pair for
mixed buckets. `-1` is the same break sentinel `decimation-lttb` uses. The output length remains
exactly `bucketCount * 2`; buckets containing no `NaN` are byte-identical to the pre-change output;
the archived "agrees bucket-for-bucket with `minMaxEnvelope`" requirement holds with a `[-1, -1]`
bucket corresponding to a `NaN`/`NaN` bucket. The one-pass, one-read-per-sample and zero-allocation
guarantees hold unchanged.

#### Scenario: An all-NaN bucket emits [-1, -1], not [start, start]
- **GIVEN**: a single bucket of 8 samples, all `NaN`
- **WHEN**: `minMaxEnvelopeIndices` runs with `bucketCount = 1`
- **THEN**: it returns `2` and `out` is `[-1, -1]`

#### Scenario: A mixed bucket emits [-1, -1]
- **GIVEN**: a bucket containing 60 finite samples and 1 `NaN`
- **WHEN**: `minMaxEnvelopeIndices` computes that bucket
- **THEN**: the emitted pair is `[-1, -1]`

#### Scenario: Gap-free buckets are unchanged
- **GIVEN**: a committed pre-change fixture with no `NaN` sample
- **WHEN**: `minMaxEnvelopeIndices` runs
- **THEN**: the output equals the fixture exactly and contains no `-1`
