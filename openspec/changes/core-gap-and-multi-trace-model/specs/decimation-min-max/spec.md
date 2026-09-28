# Capability: decimation-min-max

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). MODIFIED delta against the
> archived baseline at `openspec/specs/decimation-min-max/spec.md`.
>
> Source: `proposal.md` Scope ("Min-max gap awareness"), Modified Capabilities, Open Technical
> Decision 3. The archived "NaN Is the 'No Sample' Sentinel; an All-Gap Bucket Emits NaN, Never
> Infinity" requirement already covers a bucket whose samples are all `NaN`, and the `±Infinity`
> propagation rule; both are retained unchanged and are not restated in full here except where
> this delta narrows or extends them for the mixed-bucket case.
>
> **Encoding pinned by `design.md` (D4):** any bucket containing at least one `NaN` sample
> collapses to the break — `NaN`/`NaN` in `minMaxEnvelope`, `[-1, -1]` in `minMaxEnvelopeIndices`.
> The fixed `2 * bucketCount` output length is preserved for both functions.

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
