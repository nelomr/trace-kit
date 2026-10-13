# Capability: viewport-window-resolution

> Change: `raw-data-viewport-export` (roadmap `order: 6.5`). New capability.
>
> Source: `proposal.md` Approach 1 and Risks (ascending X, plateaus, precision). Implemented in
> `packages/core/src/viewport/window.ts` as `resolveSampleWindow`, `SampleSpan`, `createSampleSpan`
> and `SampleWindowOptions`.

## ADDED Requirements

### Requirement: A Window Resolves to a Source Index Span Before Any Decimation
`@trace-kit/core` MUST export, from its root entry, a pure function that maps a domain range
`[xMin, xMax]` and one `SpectrumDataPayload` to a half-open source index span `[start, end)` over
`[0, payload.sampleCount)`. Membership MUST be decided on the absolute X `payload.xOrigin + payload.x[i]`
evaluated in f64, never on `x[i]` alone and never on decimated or drawn points. The function MUST
return a span (two integers), never a copy of any buffer, and MUST read only the first
`sampleCount` elements.

#### Scenario: Absolute X, not the offset, decides membership
- **GIVEN**: a payload with `xOrigin = 1550`, offsets `[0, 0.25, 0.5, 0.75, 1]`
- **WHEN**: the window `[1550.25, 1550.75]` is resolved in strict mode
- **THEN**: the span is `{ start: 1, end: 4 }`

#### Scenario: Samples beyond sampleCount are ignored
- **GIVEN**: a payload with capacity 8, `sampleCount = 4`, and stale values past index 3 that would fall inside the window
- **WHEN**: the window is resolved
- **THEN**: `end <= 4`

#### Scenario: The span is a view, not a copy
- **GIVEN**: any resolved span
- **WHEN**: its result type is inspected
- **THEN**: it contains only integer indices; no typed array or subarray is returned

### Requirement: The Default Window Is Strict and Boundaries Are Lower/Upper Bound
By default the span MUST contain exactly the samples with `xMin <= abs(i) <= xMax` (both bounds
inclusive). `start` MUST be the lower bound of `xMin` (the first index with `abs(i) >= xMin`) and
`end` MUST be the upper bound of `xMax` (the first index with `abs(i) > xMax`), found by binary
search. Consequently, when X contains repeated values (plateaus), every sample equal to `xMin` and
every sample equal to `xMax` MUST be included, regardless of how many repeat.

#### Scenario: Inclusive bounds on exact hits
- **GIVEN**: absolute X `[1, 2, 3, 4, 5]`
- **WHEN**: window `[2, 4]` is resolved
- **THEN**: the span is `{ start: 1, end: 4 }` (X values 2, 3, 4)

#### Scenario: A plateau at the lower boundary is fully included
- **GIVEN**: absolute X `[1, 2, 2, 2, 3]`
- **WHEN**: window `[2, 3]` is resolved
- **THEN**: the span is `{ start: 1, end: 5 }`

#### Scenario: A plateau at the upper boundary is fully included
- **GIVEN**: absolute X `[1, 2, 2, 2, 3]`
- **WHEN**: window `[1, 2]` is resolved
- **THEN**: the span is `{ start: 0, end: 4 }`

#### Scenario: Zero-width window on a plateau
- **GIVEN**: absolute X `[1, 2, 2, 2, 3]`
- **WHEN**: window `[2, 2]` is resolved
- **THEN**: the span is `{ start: 1, end: 4 }`

#### Scenario: Gaps do not affect resolution
- **GIVEN**: two payloads with identical X, one with all-finite Y and one with `NaN` at several Y indices inside the window
- **WHEN**: the same window is resolved on both
- **THEN**: both spans are equal

### Requirement: Optional Neighbour Samples Extend the Span by One Sample Per Side
The function MUST accept a caller option that, when enabled, extends the strict span by exactly one
sample on each side (`start - 1`, `end + 1`), clamped to `[0, sampleCount]`. The extension MUST be
applied to the outer edges of the strict span, so with plateaus the neighbour is the single sample
adjacent to the strict span, not the whole adjacent plateau. When the window lies strictly between
two adjacent samples (strict span empty but data brackets the window), the neighbour option MUST
return the two bracketing samples. When the window lies entirely before the first sample's X or
after the last sample's X, the span MUST remain empty even with the option enabled (no bracket
exists). The default MUST be strict.

#### Scenario: Neighbours extend both sides
- **GIVEN**: absolute X `[1, 2, 3, 4, 5]`, window `[2, 4]`
- **WHEN**: resolved with the neighbour option on
- **THEN**: the span is `{ start: 0, end: 5 }`

#### Scenario: Neighbours clamp at the payload bounds
- **GIVEN**: absolute X `[1, 2, 3]`, window `[1, 3]`
- **WHEN**: resolved with the neighbour option on
- **THEN**: the span is `{ start: 0, end: 3 }`

#### Scenario: Neighbours with a plateau add only the adjacent sample
- **GIVEN**: absolute X `[1, 2, 2, 2, 3, 4]`, window `[3, 3]`
- **WHEN**: resolved with the neighbour option on
- **THEN**: the span is `{ start: 3, end: 6 }` (one sample before the strict start, one after the strict end)

#### Scenario: A window between two samples is bracketed
- **GIVEN**: absolute X `[1, 2, 3, 4]`, window `[2.25, 2.75]`
- **WHEN**: resolved strict, then with the neighbour option
- **THEN**: strict yields an empty span; neighbour yields `{ start: 1, end: 3 }`

#### Scenario: Omitting the option is strict
- **GIVEN**: absolute X `[1, 2, 3, 4, 5]`, window `[2, 4]`
- **WHEN**: resolved with no options
- **THEN**: the span is `{ start: 1, end: 4 }`

### Requirement: Empty, Out-of-Range, Inverted and Single-Sample Windows Are Defined
The function MUST NOT throw for any numeric or non-numeric bounds. An empty result MUST be
`start === end` with both values within `[0, sampleCount]`. A window wholly below or above the data,
a payload with `sampleCount === 0`, an inverted window (`xMin > xMax`) and a window with a `NaN`
bound MUST all yield an empty span. A window covering all samples MUST yield `{ 0, sampleCount }`.
Infinite bounds are valid (`-Infinity` / `Infinity` select open-ended windows). A single-sample
payload MUST yield `{0,1}` when its X is within the window and an empty span otherwise.

#### Scenario: Window entirely below the data
- **GIVEN**: absolute X `[10, 20, 30]`, window `[1, 5]`
- **WHEN**: resolved strict and with neighbours
- **THEN**: both spans are empty

#### Scenario: Window entirely above the data
- **GIVEN**: absolute X `[10, 20, 30]`, window `[40, 50]`
- **WHEN**: resolved strict and with neighbours
- **THEN**: both spans are empty

#### Scenario: Zero-sample payload
- **GIVEN**: a payload with `sampleCount = 0`
- **WHEN**: any window is resolved
- **THEN**: the span is empty, with no out-of-bounds read

#### Scenario: Inverted window
- **GIVEN**: absolute X `[1, 2, 3]`, window `[3, 1]`
- **WHEN**: resolved
- **THEN**: the span is empty and no error is thrown

#### Scenario: NaN bound
- **GIVEN**: any payload, `xMin = NaN`
- **WHEN**: resolved
- **THEN**: the span is empty and no error is thrown

#### Scenario: Open-ended window
- **GIVEN**: absolute X `[1, 2, 3]`, window `[-Infinity, Infinity]`
- **WHEN**: resolved
- **THEN**: the span is `{ start: 0, end: 3 }`

#### Scenario: Single-sample payload inside and outside
- **GIVEN**: one sample at absolute X `5`
- **WHEN**: window `[4, 6]` and then window `[6, 7]` are resolved strict
- **THEN**: the first span is `{0,1}`, the second is empty

### Requirement: Ascending X Is a Documented Precondition With Safe Behaviour When Violated
The resolver's precondition is that absolute X is non-decreasing over `[0, sampleCount)`; no
existing capability guarantees this and this change MUST NOT add a payload invariant. The behaviour
on a violating payload MUST be observable and safe: the function MUST NOT throw, MUST NOT loop
unboundedly, MUST NOT read outside `[0, sampleCount)`, and MUST return a span satisfying
`0 <= start <= end <= sampleCount`. Which span is returned for a violating payload is
unspecified, and no consumer MAY rely on it. Whether a guard (for example a debug-only check) exists
is a design decision; if one exists it MUST NOT add per-call work proportional to `sampleCount` in
production builds. The precondition MUST be stated in the function's documentation. Behaviour for
`NaN` in X remains out of contract per `gap-sentinel-semantics`.

#### Scenario: A descending sweep returns a safe span
- **GIVEN**: absolute X `[5, 4, 3, 2, 1]`
- **WHEN**: window `[2, 4]` is resolved
- **THEN**: no error is thrown and `0 <= start <= end <= 5`

#### Scenario: A randomly ordered X never escapes bounds (property)
- **GIVEN**: a `fast-check` arbitrary generating arbitrary finite X arrays and windows
- **WHEN**: resolved
- **THEN**: for every case, `0 <= start <= end <= sampleCount` and the call terminates

#### Scenario: Ascending sweeps agree with a linear reference (property)
- **GIVEN**: a `fast-check` arbitrary generating non-decreasing X (with repeats) and arbitrary windows
- **WHEN**: the span is resolved strict
- **THEN**: it equals the span of the linear-scan definition (first and last index with `xMin <= abs <= xMax`), for empty windows `start === end`

### Requirement: Resolution Is Allocation-Free and Isomorphic
The resolver MUST allocate no object, array or closure per call in the steady state (the span
MUST be written into a caller-owned `SampleSpan` record created once by `createSampleSpan()`). It MUST live in `@trace-kit/core`, MUST NOT reference `document`, `window`,
`HTMLCanvasElement` or any browser global, and MUST run under the plain `node` Vitest environment.

#### Scenario: Repeated calls allocate nothing
- **GIVEN**: a warmed-up `resolveSampleWindow` and a caller-owned `SampleSpan`
- **WHEN**: 10,000 calls are made while heap usage is sampled (or an allocation probe counts allocations)
- **THEN**: no retained allocation growth attributable to the calls is observed, and the `SampleSpan` identity is unchanged

#### Scenario: No DOM reference
- **GIVEN**: the resolver module and its imports
- **WHEN**: inspected, and exercised under the `node` environment
- **THEN**: no DOM type or global is referenced and the tests run without a DOM shim

#### Scenario: Root entry export
- **GIVEN**: `@trace-kit/core`'s root entry
- **WHEN**: its exports are inspected
- **THEN**: `resolveSampleWindow`, `createSampleSpan`, `SampleSpan` and `SampleWindowOptions` are exported from it
