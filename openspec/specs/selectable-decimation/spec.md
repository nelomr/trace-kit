# Capability: selectable-decimation

> Change: `renderers-canvas2d`. New capability.
>
> Source: `proposal.md` §7 (capability contract, backward-compatible default) and `design.md`
> §D10 (`minMaxEnvelopeIndices`, absolute-index normal form, unchanged walk) and §D11
> (`DecimationSelection` discriminated union, `setDecimation` runtime setter and constructor
> default, memo key widened with an algorithm field). Requirements here govern the selection
> type, its two entry points on the shared `FigureRenderer` surface, the new core function, and
> the widened memoization — not the unchanged `buildTracePath` walk, which is governed by
> `canvas2d-trace-rendering`.

## ADDED Requirements

### Requirement: `DecimationSelection` Makes an Invalid Algorithm/Parameter Pairing Unrepresentable
`@trace-kit/core` MUST export `DecimationSelection` from `packages/core/src/decimation/selection.ts`
as the union of `LttbSelection` (`{ algorithm: "lttb", threshold?: number, bucketCount?: never }`)
and `MinMaxSelection` (`{ algorithm: "min-max", bucketCount?: number, threshold?: never }`). A
value carrying `algorithm: "lttb"` together with a `bucketCount` MUST NOT type-check, and a value
carrying `algorithm: "min-max"` together with a `threshold` MUST NOT type-check, for both object
literals and a variable of a wider declared shape. Neither interface's declaration MUST contain an
`as never`, `as any`, `as unknown as`, or `<any>` assertion; the `never`-typed optional fields are
the sole mechanism enforcing exclusivity.

#### Scenario: An LTTB selection with a bucketCount does not type-check
- **GIVEN**: a fixture assignment `const s: DecimationSelection = { algorithm: "lttb", bucketCount: 10 }`
- **WHEN**: `tsc --noEmit` checks the fixture file
- **THEN**: it fails to compile with an error naming `bucketCount`

#### Scenario: A min-max selection with a threshold does not type-check
- **GIVEN**: a fixture assignment `const s: DecimationSelection = { algorithm: "min-max", threshold: 10 }`
- **WHEN**: `tsc --noEmit` checks the fixture file
- **THEN**: it fails to compile with an error naming `threshold`

#### Scenario: A variable of a wider shape still rejects the invalid pairing
- **GIVEN**: a fixture function accepting a parameter typed `{ algorithm: "lttb"; bucketCount?: number }`
  and attempting to return it as `DecimationSelection`
- **WHEN**: `tsc --noEmit` checks the fixture file
- **THEN**: it fails to compile, confirming the exclusion holds for a non-literal value, not only
  for an object literal under excess-property checking

#### Scenario: No banned assertion appears in the selection module
- **GIVEN**: `packages/core/src/decimation/selection.ts`
- **WHEN**: the file is scanned for `as never`, `as any`, `as unknown as`, and `<any>`
- **THEN**: none of these patterns appears; only a declared `?: never` field type is present

### Requirement: A Caller That Selects Nothing Gets Today's LTTB Behavior Unchanged
`Canvas2DRenderer` MUST default to LTTB with `threshold = min(sampleCount, max(2,
ceil(plotWidth * 2)))` whenever no `DecimationSelection` is in effect — neither passed to
`Canvas2DRendererOptions.decimation` at construction nor set later via `setDecimation`. The
resulting decimated index set and drawn vertex sequence MUST be identical, index for index, to the
renderer's behavior before this capability existed.

#### Scenario: An unconfigured renderer draws the pre-existing LTTB default
- **GIVEN**: a `Canvas2DRenderer` constructed with no `decimation` option, over a payload of
  100,000 samples and a plot width producing threshold `T`
- **WHEN**: `render()` runs for the first time
- **THEN**: `lttb` is invoked exactly once with `threshold === T`, and `minMaxEnvelopeIndices` is
  not invoked

#### Scenario: setDecimation(undefined) restores the default after a prior selection
- **GIVEN**: a renderer with `setDecimation({ algorithm: "min-max" })` already applied and rendered
  at least once
- **WHEN**: `setDecimation(undefined)` is called and `render()` runs again
- **THEN**: the drawn index set for that render call is byte-for-byte identical to the index set
  the same renderer would produce with no selection ever applied, at the same revision and domain

### Requirement: `setDecimation` Recomputes the Decimated Result but Issues No Drawing Call
`FigureRenderer.setDecimation(selection: DecimationSelection | undefined): void` MUST invalidate
the currently held decimated index set so the next `render()` call recomputes it under the new
selection. `setDecimation` itself MUST NOT issue any drawing-surface call and MUST NOT invoke
`lttb` or `minMaxEnvelopeIndices` synchronously within the call.

#### Scenario: setDecimation paints nothing
- **GIVEN**: a `Canvas2DRenderer` wired to a fake `TraceDrawingContext` that records calls
- **WHEN**: `setDecimation({ algorithm: "min-max", bucketCount: 500 })` is called
- **THEN**: the fake context records zero calls

#### Scenario: setDecimation does not itself invoke a decimation function
- **GIVEN**: a renderer instrumented to count calls to `lttb` and `minMaxEnvelopeIndices`
- **WHEN**: `setDecimation({ algorithm: "min-max" })` is called, with no subsequent `render()` call
- **THEN**: neither function's call count changes

#### Scenario: The next render call after setDecimation uses the new algorithm
- **GIVEN**: a renderer that has rendered once under the LTTB default
- **WHEN**: `setDecimation({ algorithm: "min-max", bucketCount: 400 })` is called and `render()`
  runs again with the same revision and domain
- **THEN**: `minMaxEnvelopeIndices` is invoked exactly once with `bucketCount === 400`, and `lttb`
  is not invoked on that call

### Requirement: The Memoization Key Includes the Algorithm, Not Only the Numeric Parameter
`Canvas2DRenderer` MUST hold a decimation memo keyed on `(revision, algorithm, parameter, xMin,
xMax, yMin, yMax)`, where `algorithm` is the resolved `DecimationAlgorithm` and `parameter` is the
resolved numeric `threshold` or `bucketCount`. A `render()` call MUST NOT reuse a previously
computed decimated result when `algorithm` has changed, even when `parameter`, `revision`, and the
domain are all unchanged.

#### Scenario: An algorithm-only change at a colliding numeric parameter forces a repaint
- **GIVEN**: a renderer rendered once under `{ algorithm: "lttb", threshold: 1920 }` at a fixed
  revision and domain
- **WHEN**: `setDecimation({ algorithm: "min-max", bucketCount: 1920 })` is called and `render()`
  runs again with the same revision and domain
- **THEN**: `minMaxEnvelopeIndices` is invoked (the memo is not reused), and the drawn index set for
  the second call differs from the first

#### Scenario: An unchanged algorithm and parameter still skip recomputation
- **GIVEN**: a renderer rendered once under a fixed selection, revision, and domain
- **WHEN**: `render()` is called 59 more times with no change to the selection, revision, or domain
- **THEN**: the resolved decimation function (`lttb` or `minMaxEnvelopeIndices`, whichever applies)
  is invoked exactly once across all 60 calls

### Requirement: The Selection Resolves to a Scalar Parameter With No Per-Frame Record Allocation
`resolveDecimationParameter(selection, plotWidth, sampleCount): number` MUST return a plain
number — the resolved `threshold` for an LTTB selection or the resolved `bucketCount` for a
min-max selection — and MUST NOT construct an object, array, or closure to do so. When the
selection (or its numeric field) is omitted, the resolved value MUST be derived from `plotWidth`
consistently with the existing viewport-derived default: `threshold = min(sampleCount, max(2,
ceil(plotWidth * 2)))` for LTTB, `bucketCount = min(sampleCount, max(1, floor(max(2,
ceil(plotWidth * 2)) / 2)))` for min-max.

#### Scenario: An omitted threshold resolves to the viewport-derived default
- **GIVEN**: `selection = { algorithm: "lttb" }`, a plot width producing vertex budget `V`, and a
  `sampleCount` greater than `V`
- **WHEN**: `resolveDecimationParameter` is called
- **THEN**: it returns `V`

#### Scenario: An omitted bucketCount resolves to half the vertex budget
- **GIVEN**: `selection = { algorithm: "min-max" }`, a plot width producing vertex budget `V`, and
  a `sampleCount` greater than `V`
- **WHEN**: `resolveDecimationParameter` is called
- **THEN**: it returns `floor(V / 2)`, so the min-max default emits the same vertex count (`floor(V
  / 2) * 2`) as the default LTTB selection emits vertices (`V`), within one vertex of parity

#### Scenario: resolveDecimationParameter constructs nothing
- **GIVEN**: `packages/core/src/decimation/**`
- **WHEN**: the implementation of `resolveDecimationParameter` is inspected
- **THEN**: it contains no object literal, array literal, or closure construction in its body

### Requirement: `minMaxEnvelopeIndices` Emits Ascending Indices Per Bucket, Monotone Non-Decreasing Overall
`minMaxEnvelopeIndices(y, sourceOffset, sampleCount, out, outputOffset, bucketCount)` MUST write
`bucketCount * 2` absolute `Int32` indices into `out` starting at `outputOffset`: for each bucket,
the lower of its argmin/argmax indices first, then the higher, so consecutive pairs are ascending
within a bucket. Across the whole output, the sequence MUST be monotone non-decreasing. It MUST
return `bucketCount * 2`.

#### Scenario: Each bucket's pair is ascending
- **GIVEN**: a `y` buffer of 10,000 samples and `bucketCount = 50`
- **WHEN**: `minMaxEnvelopeIndices` runs
- **THEN**: for every bucket `b`, `out[2*b] <= out[2*b + 1]`

#### Scenario: The full output sequence is monotone non-decreasing
- **GIVEN**: the same call
- **WHEN**: the returned `out` slice of length `bucketCount * 2` is inspected end to end
- **THEN**: `out[i] <= out[i + 1]` holds for every adjacent pair, with no backward step across a
  bucket boundary

#### Scenario: A bucket where the maximum occurs before the minimum still emits ascending order
- **GIVEN**: a single bucket constructed so its argmax index is lower than its argmin index
- **WHEN**: `minMaxEnvelopeIndices` runs over that bucket
- **THEN**: the emitted pair is `(argmax, argmin)` in that ascending numeric order — the lower
  index first, regardless of which extremum it represents

#### Scenario: The function returns the exact written count
- **GIVEN**: `bucketCount = 500`
- **WHEN**: `minMaxEnvelopeIndices` runs
- **THEN**: it returns `1000`

### Requirement: `minMaxEnvelopeIndices` Agrees Bucket-for-Bucket With `minMaxEnvelope`'s Extremes
For the same `y`, `sourceOffset`, `sampleCount`, and `bucketCount`, the sample values at the
indices `minMaxEnvelopeIndices` emits for a given bucket MUST equal the values `minMaxEnvelope`
emits for that same bucket (its minimum and its maximum), independent of emission order.

#### Scenario: Index-resolved values match the value-based envelope's extremes
- **GIVEN**: an identical `y` buffer, `sourceOffset`, `sampleCount`, and `bucketCount` passed to
  both `minMaxEnvelope` and `minMaxEnvelopeIndices`
- **WHEN**: both functions run and, for `minMaxEnvelopeIndices`, `y` is read at each emitted index
- **THEN**: for every bucket, the set `{y[loIndex], y[hiIndex]}` equals the set `{minMaxEnvelope`'s
  emitted min, `minMaxEnvelope`'s emitted max`}` for that bucket

#### Scenario: A constant bucket emits its single index twice
- **GIVEN**: a bucket whose samples are all equal (a flat segment)
- **WHEN**: `minMaxEnvelopeIndices` runs over that bucket
- **THEN**: it emits the same index for both the argmin and the argmax position, and the returned
  count still advances by exactly `2` for that bucket

#### Scenario: minMaxEnvelope itself is unmodified
- **GIVEN**: `packages/core/src/decimation/min-max.ts`
- **WHEN**: its exported `minMaxEnvelope` signature and write order (`min` then `max`, lines
  92-93 as documented in `design.md` §D10) are compared against the pre-change implementation
- **THEN**: no difference is observed; `minMaxEnvelopeIndices` is added as a sibling file and does
  not alter, wrap, or deprecate the existing function

### Requirement: The Zero-GC Guarantee Extends to Selection Resolution and `minMaxEnvelopeIndices`, Not to a New Walk Mode
The allocation-free hot-path guarantee MUST hold across `resolveDecimationParameter` and
`minMaxEnvelopeIndices` under the repository's `--expose-gc` zero-GC gate. `buildTracePath` and
`packages/renderers/src/path/**` MUST NOT be modified to add a value-based or envelope-specific
walk branch; both algorithms MUST continue to hand the walk the single existing shape — `(Int32Array
indices, count)`.

#### Scenario: minMaxEnvelopeIndices reports zero GC events under warm-up
- **GIVEN**: `minMaxEnvelopeIndices` driven over a 100,000-sample buffer at `bucketCount = 960`
  (parity with a 1920px plot width's default LTTB threshold), under `--expose-gc`, after warm-up
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures the run
- **THEN**: zero GC events are reported

#### Scenario: resolveDecimationParameter reports zero GC events under warm-up
- **GIVEN**: `resolveDecimationParameter` called repeatedly across varying selections and plot
  widths, under `--expose-gc`, after warm-up
- **WHEN**: the same GC observer measures the run
- **THEN**: zero GC events are reported

#### Scenario: buildTracePath's guarded file is untouched by this capability
- **GIVEN**: `packages/renderers/src/path/build-trace-path.ts` as committed for
  `canvas2d-trace-rendering`
- **WHEN**: the file is diffed against its state after this capability's implementation lands
- **THEN**: no difference is observed; the existing `--expose-gc` allocation gate and ESLint
  hot-path block continue to cover the same unchanged function
