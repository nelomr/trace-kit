# Capability: decimation-lttb

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). MODIFIED delta against the
> archived baseline at `openspec/specs/decimation-lttb/spec.md`.
>
> Source: `proposal.md` Scope ("LTTB gap awareness"), Modified Capabilities, Approach step 2,
> Open Technical Decisions 1 and 2. This delta adds gap-aware bucketing and a break-carrying
> output on top of the archived signature and work-count contract, both of which are unchanged
> and hold verbatim except where explicitly modified below. The general gap guarantees ("never
> interpolated across", "leading/trailing/all-gap defined") are owned by `gap-sentinel-semantics`
> and are not restated here; this file states only how `lttb` specifically satisfies them.
>
> **Encoding and apportionment are pinned by `design.md` (D1, D2)** and stated normatively in the
> "Return-Count and Index-Content Contract" and "Threshold Apportionment" requirements below.

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
