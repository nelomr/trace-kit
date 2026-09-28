# Capability: decimation-lttb

> Change: `core-decimation-math`. New capability.
>
> Correction to the input brief, per exploration §3.11: `lttb` emits an `Int32Array` of selected
> indices, not a `Float32Array` per axis.

## ADDED Requirements

### Requirement: Two-Reads-Per-Sample Forward Traversal Into a Caller-Preallocated Buffer
`lttb` MUST accept flat positional parameters — never an options object literal at the call
site, because an object literal allocates and the call site of a per-frame decimation is a hot
path governed by the `allocation-free-hot-path` capability. `lttb`'s work count is stated in its
own terms, distinct from `minMaxEnvelope`'s one-read-per-sample instrument (owned by
`decimation-min-max`'s "Single-Pass Deterministic Work Count" requirement): `lttb` MUST perform
**one forward traversal, at most two reads per sample, no backtracking, no scratch allocation**,
reading each sample in `[sourceOffset, sourceOffset + sampleCount)` at most twice (once
accumulating its own bucket's mean, once as a triangle-area candidate). No test MUST apply
`minMaxEnvelope`'s exactly-`sampleCount`-reads instrument to `lttb`; the two capabilities define
separate, non-interchangeable work-count properties. It MUST emit its result as an `Int32Array` of selected
**absolute** sample indices (indices into the original `x`/`y` buffers, inclusive of
`sourceOffset`), written into a caller-preallocated output buffer starting at an explicit
`outputOffset`, touching only `[outputOffset, outputOffset + threshold)`. It MUST NOT emit a
`Float32Array` per axis, and MUST return the count of indices written (`threshold`).

The signature is:

```ts
function lttb(
  x: Float32Array,
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Int32Array,
  outputOffset: number,
  threshold: number,
): number;
```

There is exactly one signature for `lttb` across this change; no other spec in this change MUST
describe a different call shape.

#### Scenario: lttb writes an Int32Array of absolute indices into the caller's buffer
- **GIVEN**: a preallocated `Int32Array` of length `64` passed as `out`, and `x`, `y`, `sourceOffset
  = 1000`, `sampleCount = 5000`, `outputOffset = 0`, `threshold = 64`
- **WHEN**: `lttb(x, y, 1000, 5000, out, 0, 64)` runs
- **THEN**: `out` is unmodified in type (`Int32Array`), contains exactly `64` indices, the
  function returns `64`, and every emitted index lies in `[1000, 6000)` — the original `x`/`y`
  buffers' absolute index space, not a `[0, sampleCount)`-relative one

#### Scenario: No object literal appears at the call site
- **GIVEN**: any call site of `lttb` inside `packages/core/src/decimation/**`
- **WHEN**: a source-level check inspects the call's argument list
- **THEN**: every argument is a positional identifier, numeric literal, or typed-array reference,
  and no argument is an object literal

#### Scenario: Each sample is read at most twice, not once
- **GIVEN**: an instrumented `x`/`y` pair whose element accessors count reads
- **WHEN**: `lttb` decimates `sampleCount` samples to a `threshold` well below `sampleCount`
- **THEN**: the total read count is at most `2 * sampleCount` and is not asserted to equal
  `sampleCount` (that one-read-per-sample count is `minMaxEnvelope`'s work-count property, not
  `lttb`'s)

### Requirement: Boundary Preconditions
`lttb` MUST validate, at the function boundary before any loop runs, that `threshold >= 2`,
`threshold <= sampleCount`, `sampleCount >= 2`, `sourceOffset >= 0`, `out.length >=
outputOffset + threshold`, and that every numeric argument is a non-negative integer within
`[0, 2^31)`. A violation MUST raise a `RangeError` naming the violated bound before any output is
written. When `threshold === 2` the interior-bucket loop MUST NOT run at all (the bucket count is
`threshold - 2 === 0`, and running the division would otherwise produce a silently wrong result
rather than a crash); `lttb` MUST instead write only the two endpoint indices.

#### Scenario: threshold below 2 is rejected
- **GIVEN**: `threshold = 1`
- **WHEN**: `lttb` is invoked with this value
- **THEN**: it throws a `RangeError` before writing to `out`

#### Scenario: threshold greater than sampleCount is rejected
- **GIVEN**: `sampleCount = 100` and `threshold = 101`
- **WHEN**: `lttb` is invoked with these values
- **THEN**: it throws a `RangeError` before writing to `out`

#### Scenario: threshold === 2 emits only the two endpoints with no interior division
- **GIVEN**: `sampleCount = 500` and `threshold = 2`
- **WHEN**: `lttb` runs
- **THEN**: it writes exactly two indices — `sourceOffset` and
  `sourceOffset + sampleCount - 1` — and does not throw or emit `NaN`/`Infinity` from a
  zero-bucket division

### Requirement: Subset, Monotonicity, and Endpoint-Retention Properties
The emitted indices MUST be a subset of `[sourceOffset, sourceOffset + sampleCount)`, MUST be
strictly increasing, and MUST always include index `sourceOffset` and index
`sourceOffset + sampleCount - 1` (first and last point retained, expressed as absolute indices).
When `sourceOffset === 0` this reduces to `[0, sampleCount)` with endpoints `0` and
`sampleCount - 1`.

#### Scenario: Property-based check across random inputs and a nonzero sourceOffset
- **GIVEN**: a `fast-check` arbitrary generating random X/Y series of varying length, a random
  valid `sourceOffset >= 0`, and a random valid `threshold`
- **WHEN**: `lttb` runs against each generated case
- **THEN**: for every case, the output length equals `threshold`, every index lies in
  `[sourceOffset, sourceOffset + sampleCount)`, indices are strictly increasing, index
  `sourceOffset` is present, and index `sourceOffset + sampleCount - 1` is present

### Requirement: Zero Allocation, Asserted by GC-Event Count
`lttb` MUST NOT allocate on its hot path, asserted by zero `PerformanceObserver` `gc` entries
over N warm iterations under `--expose-gc` (claim **C4b**), with an allocating control variant
in the same test file reporting non-zero events.

The gate MUST run both of the following configurations, each asserted at zero, because a
per-call allocation and a per-sample allocation hide from different ones:

| Configuration | `sampleCount` | `threshold` | iterations |
|---|---|---|---|
| `small` | `4,096` | `512` | `10,000` |
| `large` | `1,000,000` | `1,000` | `200` |

#### Scenario: lttb reports zero GC events over warm iterations at the small configuration
- **GIVEN**: `lttb` invoked `10,000` times with `sampleCount = 4,096` and `threshold = 512`,
  after warm-up, under `node --expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events during the measured
  window
- **THEN**: the observed count is exactly `0`

#### Scenario: lttb reports zero GC events over warm iterations at the large configuration
- **GIVEN**: `lttb` invoked `200` times with `sampleCount = 1,000,000` and `threshold = 1,000`,
  after warm-up, under `node --expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events during the measured
  window
- **THEN**: the observed count is exactly `0`

#### Scenario: The allocating control variant proves the gate is live
- **GIVEN**: a deliberately allocating variant (e.g. one using `.slice()` per bucket average)
  invoked the same number of times, at the same `sampleCount` and `threshold`, in the same test
  file for both the `small` and `large` configurations
- **WHEN**: the same observer measures it
- **THEN**: the observed GC event count is greater than `0` for each configuration

### Requirement: Deopt Freedom
`lttb` MUST NOT deoptimize under `--trace-deopt` across its tested input shapes, maintaining
strict argument monomorphism.

#### Scenario: No deoptimization reported for lttb
- **GIVEN**: a benchmark script invoking `lttb` repeatedly with monomorphic typed-array
  arguments
- **WHEN**: `node --trace-deopt` runs the script
- **THEN**: the trace output contains no deoptimization entry naming `lttb`

### Requirement: Determinism Across Runs and Node Versions
Repeated invocation of `lttb` over identical input MUST yield byte-identical index output.
Bucket averages MUST accumulate in `number` (f64), summed in ascending index order, and the
implementation MUST NOT use any of the following transcendental `Math` functions, whose results
ECMA-262 permits to be implementation-dependent: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`,
`atan2`, `exp`, `expm1`, `log`, `log2`, `log10`, `log1p`, `pow`, `cbrt`, `sinh`, `cosh`, `tanh`,
`asinh`, `acosh`, `atanh`, `hypot`. Exactly-specified functions (`Math.abs`, `Math.min`,
`Math.max`, `Math.floor`, `Math.trunc`, `Math.round`, `Math.sign`, `Math.sqrt`) are permitted but
not required. When two or more candidate indices within a bucket produce the same maximum
triangle area, `lttb` MUST select the **lowest** (first-encountered) index — a strict `>`
comparison, never `>=` — so the tie is resolved identically on every run.

#### Scenario: Byte-identical indices across repeated runs
- **GIVEN**: a fixed input X/Y series and `threshold`
- **WHEN**: `lttb` runs twice against fresh output buffers
- **THEN**: the two output `Int32Array`s are element-wise identical

#### Scenario: A recorded golden output stays stable
- **GIVEN**: a committed golden fixture (input + expected indices)
- **WHEN**: `lttb` runs against the fixture input
- **THEN**: the output matches the committed golden indices exactly

#### Scenario: A tie in triangle area resolves to the lowest index
- **GIVEN**: a flat (constant-Y) input segment within one bucket, so every candidate index in
  that bucket produces an equal (zero) triangle area
- **WHEN**: `lttb` selects a representative index for that bucket
- **THEN**: the selected index is the lowest index in the bucket's candidate range, and repeated
  runs against the same input select the same index

#### Scenario: The banned transcendental set does not appear in the implementation
- **GIVEN**: the committed `lttb` implementation in `packages/core/src/decimation/lttb.ts`
- **WHEN**: a source-level check scans for `Math.<name>` calls naming any function in the banned
  transcendental set
- **THEN**: no such call is found

### Requirement: Randomised Peak-Fidelity Property
Per CLAUDE.md rule 6, `lttb` MUST NOT apply naive uniform sub-sampling, and a randomised test
varying peak position and peak width across the domain MUST assert the peak survives
decimation (at least one selected index falls within the peak's half-maximum window).

#### Scenario: A randomised narrow peak survives decimation
- **GIVEN**: a `fast-check` arbitrary generating a synthetic peak (Lorentzian or Gaussian shape)
  at a random position and random width within the domain, superimposed on a noise floor
- **WHEN**: `lttb` decimates the series to a `threshold` well below the sample count
- **THEN**: at least one selected index's Y-domain sample lies within the peak's half-maximum
  width, for every generated case

### Requirement: No Coverage-Percentage Acceptance Criterion
Line or branch coverage percentage MUST NOT be used as an acceptance criterion for `lttb`,
because exploration §1.5 records it as unfalsifiable for numeric loops.

#### Scenario: CI does not gate on a coverage threshold for this module
- **GIVEN**: the CI configuration for `packages/core`
- **WHEN**: a reviewer inspects the coverage step for `lttb.ts`
- **THEN**: no step fails the build based on a coverage percentage threshold for that file

### Requirement: Benchmark Output Feeds the Regression Comparator Owned by Change 16
This change's ownership stops at emission: `lttb` MUST be benchmarked warm, median-of-N, through
the `benchmark-harness` capability, and its median, p95, and iteration count MUST be written into
`bench-results.json` in the machine-readable format that change 16's regression comparator
consumes. This change MUST NOT implement a stored-baseline comparison, a declared
relative-tolerance check, or a benchmark-triggered CI failure for `lttb` — that comparator, its
tolerance value, its baseline storage location, and its no-baseline behaviour are change 16's
`benchmark-regression-gate` capability, per `proposal.md`'s Scope & Non-Goals ("Coverage
thresholds ... change 16") and `packages/core/bench/README.md`, which states that
baseline-comparison and regression-budget computation belong to change 16.

#### Scenario: bench-results.json carries a consumable entry with no local pass/fail verdict
- **GIVEN**: a benchmark run of `lttb`
- **WHEN**: `bench-results.json` is written
- **THEN**: it contains an `lttb` entry with `median`, `p95`, and `iterations` fields, and no
  field or side effect in this change's own test suite asserts a pass/fail verdict against a
  stored baseline for `lttb`

### Requirement: Informational Reference-Hardware Benchmark (Non-Blocking)
The literal figure "LTTB over 1e6 samples: under 12 ms" MUST be recorded only as an
informational benchmark on declared reference hardware, warm, median-of-N, and MUST NOT be
gated on shared CI runners.

#### Scenario: The 12 ms figure is documented as informational, not a CI gate
- **GIVEN**: the committed benchmark documentation for `lttb`
- **WHEN**: a reviewer inspects CI configuration for a blocking step tied to this figure
- **THEN**: no such blocking step exists
## MODIFIED Requirements

### Requirement: Bucketing Never Crosses a Gap, and Segment Endpoints Are Retained
`lttb` MUST treat a run of consecutive `NaN` Y samples as splitting its input into finite
segments (per `gap-sentinel-semantics`), and MUST NOT form a bucket, or select a triangle-area
candidate, that spans samples on both sides of a gap. Each finite segment of length `>= 1` MUST
retain its own first and last index as an endpoint, exactly as the archived "Subset, Monotonicity,
and Endpoint-Retention Properties" requirement retains `sourceOffset` and
`sourceOffset + sampleCount - 1` for a gap-free input — that archived requirement is generalized
here to apply per-segment rather than only to the whole input range. Endpoint
retention is guaranteed whenever the input is feasible as defined in "Threshold Apportionment";
an infeasible input returns `0` and emits no index stream at all.

#### Scenario: No emitted bucket spans a source gap
- **GIVEN**: a Y buffer with one interior `NaN` run splitting it into two finite segments
- **WHEN**: `lttb` decimates the input to a `threshold` requiring multiple buckets
- **THEN**: for every emitted candidate pair used in a triangle-area computation, both indices
  lie within the same finite segment; no candidate pair straddles the gap

#### Scenario: Each finite segment's own first and last sample are retained
- **GIVEN**: a Y buffer with a `NaN` run splitting it into a first segment `[0, 40)` and a second
  segment `[45, 200)`
- **WHEN**: `lttb` decimates the input
- **THEN**: index `0`, index `39`, index `45`, and index `199` are all present among the emitted
  (non-break) indices

#### Scenario: Property check — no candidate pair straddles a randomly placed gap
- **GIVEN**: a `fast-check` arbitrary generating a Y series with 0 or more randomly placed `NaN`
  runs of random length, and a random valid `threshold`
- **WHEN**: `lttb` decimates each generated case
- **THEN**: for every case, no two indices used together as a triangle-area candidate pair fall
  on opposite sides of any gap

### Requirement: The Emitted Index Stream Carries a Detectable Break
`lttb`'s output MUST allow a consumer to detect, from the emitted `Int32Array` alone (without
re-reading the source Y buffer), that a gap occurred between two consecutively-emitted indices.
The encoding MUST be the sentinel value `-1` written into the output slot between two finite
segments (see "Return-Count and Index-Content Contract"); it MUST be deterministic (same input produces the same break representation on every run) and
MUST NOT require the consumer to perform an out-of-band Y-buffer re-scan to find the break.

#### Scenario: A consumer detects a break without re-scanning the source Y buffer
- **GIVEN**: a Y buffer with one interior gap, decimated by `lttb`
- **WHEN**: a consumer walks only the emitted `Int32Array` output (and the documented break
  encoding), with no access to the original `y` buffer
- **THEN**: the consumer can determine the position in the emitted stream where a break occurs

#### Scenario: The break representation is deterministic across repeated runs
- **GIVEN**: a fixed input with one interior gap and a fixed `threshold`
- **WHEN**: `lttb` runs twice against fresh output buffers
- **THEN**: the two outputs, including their break representation, are element-wise identical

### Requirement: Zero-Allocation, Determinism, and Peak-Fidelity Hold Unchanged With `NaN` Input
The archived "Zero Allocation, Asserted by GC-Event Count," "Deopt Freedom," "Determinism Across
Runs and Node Versions," and "Randomised Peak-Fidelity Property" requirements continue to hold,
unchanged, when the input Y buffer contains `NaN` gaps. Gap detection MUST use the inline
self-comparison `y[i] !== y[i]` (per `gap-sentinel-semantics`), adding no allocation, no
transcendental `Math` call, and no additional read beyond the archived at-most-two-reads-per-
sample bound.

#### Scenario: Zero GC events hold for a gapped input at the small configuration
- **GIVEN**: the archived `small` GC-event configuration (`sampleCount = 4,096`,
  `threshold = 512`, `10,000` iterations), with 5% of samples replaced by `NaN` gaps in a fixed
  pattern
- **WHEN**: `lttb` runs under the archived `PerformanceObserver({ entryTypes: ['gc'] })` gate
- **THEN**: the observed GC event count is exactly `0`, matching the archived gap-free result

#### Scenario: A narrow peak adjacent to a gap still survives decimation
- **GIVEN**: the archived randomised peak-fidelity property's `fast-check` arbitrary, extended so
  a random gap may be placed adjacent to (but not inside) the generated peak's half-maximum
  window
- **WHEN**: `lttb` decimates the series to a `threshold` well below the sample count
- **THEN**: at least one selected index's Y-domain sample still lies within the peak's
  half-maximum width, for every generated case

### Requirement: Gap-Free Input Is Bit-Identical to the Pre-Change Implementation
For any input containing no `NaN` sample, `lttb`'s output — including index selection, tie
resolution, and the absence of any break marker — MUST be byte-identical to the archived
(pre-this-change) implementation's output for the same input and parameters. This is the
regression guarantee named in `proposal.md` Risk 1 and Success Criteria.

#### Scenario: A gap-free golden fixture is unchanged
- **GIVEN**: a committed golden fixture from the archived `decimation-lttb` capability (input and
  expected indices), containing no `NaN` sample
- **WHEN**: `lttb` runs against the fixture input after this change
- **THEN**: the output matches the committed golden indices exactly, with no break marker present

### Requirement: All-`NaN` Input Is Defined
An input Y buffer whose every sample is `NaN` MUST NOT cause `lttb` to throw, and MUST NOT cause
`lttb` to select any index as if it held a real value. `lttb` MUST write `-1` into all `threshold` output
slots and return `threshold`.

#### Scenario: An all-NaN input does not throw and selects no real point
- **GIVEN**: a Y buffer whose every sample is `NaN`, with `sampleCount >= threshold >= 2`
- **WHEN**: `lttb` is invoked
- **THEN**: it does not throw, returns `threshold`, and every written slot equals `-1`

## ADDED Requirements

### Requirement: Return-Count and Index-Content Contract
Every slot `lttb` writes MUST be either a valid absolute index in
`[sourceOffset, sourceOffset + sampleCount)` whose `y` sample is not `NaN`, or the break sentinel
`-1`. For feasible input `lttb` MUST write exactly `threshold` slots and return `threshold`; the
slots are, in order, the selected indices of each finite segment separated by exactly one `-1`
between consecutive segments, followed by `-1` padding up to `threshold`. A leading or trailing
gap MUST NOT produce a leading `-1`. Non-`-1` slots MUST be strictly increasing. `-1` MUST NOT
appear for gap-free input. For infeasible input (see "Threshold Apportionment") `lttb` MUST return
`0`, MUST NOT throw, and its `out` contents are unspecified.

#### Scenario: Short segments are padded with trailing breaks
- **GIVEN**: `y = [1, NaN, NaN, NaN, 2]` and `threshold = 5`
- **WHEN**: `lttb` runs
- **THEN**: it returns `5` and `out` is `[0, -1, 4, -1, -1]`

#### Scenario: Leading gap emits no leading break
- **GIVEN**: a Y buffer whose first 10 samples are `NaN`, followed by finite samples
- **WHEN**: `lttb` runs at a feasible `threshold`
- **THEN**: the first written slot is `10`

#### Scenario: Infeasible fragmentation returns 0
- **GIVEN**: 1,000 samples alternating finite and `NaN`, and `threshold = 64`
- **WHEN**: `lttb` runs
- **THEN**: it returns `0` and does not throw

### Requirement: Threshold Apportionment
With `S` finite segments of lengths `L_s`, `F = sum(L_s)`, and `min_s = 2` when `L_s >= 2` else `1`,
`lttb` MUST compute budget `B = min(threshold - (S - 1), F)` and required `M = sum(min_s)`. The
input is infeasible when `M > B`. Otherwise each segment MUST receive
`k_s = min_s + floor(E * after_s / C) - floor(E * before_s / C)` slots, where `E = B - M`,
`C = F - M`, and `before_s`/`after_s` are the running sums of `(L_s - min_s)` before and after
segment `s` (`k_s = min_s` when `C = 0`). A segment with `k_s = 1` emits its only index; `k_s = 2`
emits its endpoints; `k_s >= 3` is decimated by the archived LTTB selection over that segment
alone with threshold `k_s`.

#### Scenario: A single-sample segment is emitted as an isolated point
- **GIVEN**: a Y buffer containing a finite sample at index `50` with `NaN` at indices `49` and `51`
- **WHEN**: `lttb` runs at a feasible `threshold`
- **THEN**: index `50` appears exactly once, with a `-1` immediately before and after it

#### Scenario: Apportionment is proportional and sums to the budget
- **GIVEN**: two finite segments of lengths `100` and `900` separated by one `NaN`, and `threshold = 101`
- **WHEN**: `lttb` runs
- **THEN**: the first segment receives `min_s` plus its proportional share of the spare slots, the
  written non-`-1` slot count equals `B = 100`, and exactly one `-1` separates the segments
