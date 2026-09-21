# Capability: viewport-transform

> Change: `core-scale-transforms` (roadmap `order: 5.6`). MODIFIED delta against the archived
> baseline at `openspec/specs/viewport-transform/spec.md`.
>
> Source: `design.md` D1 (allocation/allow-list wording), D2 (field layout, monomorphism, GPU
> obligation carrier fields), D6 (GPU precision contract). Three `readonly number` fields are
> added (`yScaleKind`, `yLogDomainMin`, `yLogScale`); the archived "no `Math.*`" clause is
> narrowed to a source-scannable allow-list; the archived "fourteen numeric fields" prose is
> corrected; a GPU-consumer obligation is stated on `xOrigin`/`xDomainMin`/`xDomainMax`. The
> `selectTicks` requirement is unaffected and is not restated here.

## MODIFIED Requirements

### Requirement: `ViewportTransform` Is a Frozen Flat Object, Not a Class
`@trace-kit/core` MUST export `ViewportTransform` as a plain interface of `readonly number`
fields only (`xDomainMin`, `xDomainMax`, `yDomainMin`, `yDomainMax`, `xOrigin`, `deviceWidth`,
`deviceHeight`, `dpr`, `plotLeft`, `plotTop`, `plotWidth`, `plotHeight`, `xScale`, `yScale`,
`yBase`, `yScaleKind`, `yLogDomainMin`, `yLogScale` — eighteen fields total), and
`createViewportTransform(options)` MUST return an instance frozen with `Object.freeze`.
Projection and inversion MUST be exposed as module-level free functions (`projectX`, `projectY`,
`unprojectX`, `unprojectY`, `isInsidePlotArea`, `transformMatchesPayload`) operating on that
object, not as methods on it. No field or function in this module MUST reference `document`,
`window`, `HTMLCanvasElement`, `OffscreenCanvas`, or `getContext`. The three new fields
(`yScaleKind`, `yLogDomainMin`, `yLogScale`) MUST be present, in this exact insertion order
immediately after `yBase`, on every instance the module produces, including a linear
(`yScaleKind === Y_SCALE_KIND_LINEAR`) instance — never conditionally omitted — so that every
instance the module produces shares one V8 object shape regardless of scale kind.

#### Scenario: A constructed transform is frozen
- **GIVEN**: a `ViewportTransform` returned by `createViewportTransform`
- **WHEN**: an attempt is made to assign to `transform.plotWidth` in strict-mode code
- **THEN**: the assignment throws a `TypeError`, and `transform.plotWidth` is unchanged

#### Scenario: The transform survives structuredClone with all eighteen numeric fields
- **GIVEN**: a constructed `ViewportTransform`
- **WHEN**: it is passed through `structuredClone`
- **THEN**: the clone has all eighteen numeric fields, each compared to the original with
  `Object.is` (not `===`), so that a log transform's `yScale: NaN` field is correctly asserted
  equal to itself via `Object.is(clone.yScale, original.yScale)` rather than failing under `===`

#### Scenario: Projection and inversion are exported as free functions, not methods
- **GIVEN**: the module's public export surface
- **WHEN**: `projectX`, `projectY`, `unprojectX`, `unprojectY`, and `isInsidePlotArea` are
  inspected
- **THEN**: each is a standalone exported function taking a `ViewportTransform` as its first
  parameter, and `ViewportTransform` itself declares no method

#### Scenario: The module contains no DOM reference
- **GIVEN**: `packages/core/src/viewport/**`
- **WHEN**: the source is scanned for `document`, `window`, `HTMLCanvasElement`,
  `OffscreenCanvas`, and `getContext`
- **THEN**: none of these identifiers appears

#### Scenario: A linear transform and a log transform share identical key order (the shape-split regression test)
- **GIVEN**: two `ViewportTransform` instances, one constructed with `yScaleKind:
  Y_SCALE_KIND_LINEAR` and one with `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: `Object.keys` is called on each
- **THEN**: the two key-order arrays are identical — the log-only fields are present and in the
  same position on the linear instance too, so conditionally omitting them (the specific mistake
  that would make the hot call site polymorphic) is caught directly

### Requirement: Forward Projection Is Allocation-Free Per Point, With a Closed, Source-Scannable `Math.*` Allow-List
`projectX` and `projectY` MUST compute their result using only arithmetic over their parameters
and the `ViewportTransform` object's own numeric fields, with no object literal, array literal,
or closure in either function body. `projectX` MUST contain no `Math.*` call. `projectY` MUST
contain no `Math.*` call other than exactly one `Math.log10`, which MUST appear only in the
branch taken when `yScaleKind !== 0`; the branch taken when `yScaleKind === 0` MUST remain free
of any `Math.*` call. A loop invoking either function once per sample point MUST report zero
garbage-collector events under the repository's established
`PerformanceObserver({ entryTypes: ["gc"] })` gate, for each `yScaleKind` value independently.

#### Scenario: A per-point projection loop over a linear transform reports zero GC events
- **GIVEN**: a warmed-up loop calling `projectX` and `projectY` once per point over 100,000
  points, against a `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LINEAR`, under
  `--expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures the loop after warm-up
- **THEN**: zero GC events are reported

#### Scenario: A per-point projection loop over a log transform reports zero GC events
- **GIVEN**: the identical warmed-up loop shape, but against a `ViewportTransform` with
  `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures the loop after warm-up
- **THEN**: zero GC events are reported, proving `Math.log10`'s non-allocating nature is measured
  for this codebase and this engine, not merely assumed

#### Scenario: An allocating control variant proves the gate is live
- **GIVEN**: a deliberately allocating variant that constructs a `{x, y}` object per point instead
  of returning two numbers
- **WHEN**: the same instrumentation measures it
- **THEN**: the observed GC event count is greater than `0`

#### Scenario: projectY contains exactly one Math.log10 call, and only in the log branch
- **GIVEN**: the source of `projectY` in `packages/core/src/viewport/transform.ts`
- **WHEN**: it is scanned for every `Math.` member access
- **THEN**: the set of matches is exactly `{log10}` with exactly one occurrence, and that
  occurrence's syntactic position is within the branch of the conditional expression taken when
  `yScaleKind !== 0`

#### Scenario: projectX contains no Math.* call
- **GIVEN**: the source of `projectX`
- **WHEN**: it is scanned for any `Math.` member access
- **THEN**: none is found

#### Scenario: projectY's linear branch contains no Math.* call
- **GIVEN**: the source of `projectY`
- **WHEN**: the branch of its conditional expression taken when `yScaleKind === 0` is scanned in
  isolation for any `Math.` member access
- **THEN**: none is found

### Requirement: The Inverse Projection Is Total and Extrapolates
`unprojectX` and `unprojectY` MUST be defined for every finite `number` input, including device
pixel coordinates outside `[plotLeft, plotLeft + plotWidth]` or
`[plotTop, plotTop + plotHeight]` respectively. They MUST NOT clamp their result to the domain
and MUST NOT return `NaN` for any finite input, including when the corresponding axis has zero
span. Round-tripping MUST hold for values both inside and outside the current domain:
`unprojectX(t, projectX(t, v)) === v` within floating-point tolerance, for any finite `v`. This
requirement governs the linear (X, and Y when `yScaleKind === Y_SCALE_KIND_LINEAR`) paths
verbatim as archived; the log-axis Y inverse's totality, saturation behavior, and relative
round-trip tolerance are governed separately by the `scale-logarithmic-transform` capability.

#### Scenario: The inverse round-trips a value inside the domain
- **GIVEN**: a `ViewportTransform` with a non-zero X span
- **WHEN**: `unprojectX(t, projectX(t, v))` is computed for `v` inside `[xDomainMin, xDomainMax]`
- **THEN**: the result equals `v` within f64 tolerance

#### Scenario: The inverse round-trips a value outside the domain
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectX(t, projectX(t, v))` is computed for `v` outside `[xDomainMin, xDomainMax]`
  (for example, twice `xDomainMax`)
- **THEN**: the result equals `v` within f64 tolerance, and the produced device pixel lies outside
  `[plotLeft, plotLeft + plotWidth]`

#### Scenario: The inverse does not clamp at the plot-area edge
- **GIVEN**: a `ViewportTransform` with a known `plotLeft` and `plotWidth`
- **WHEN**: `unprojectX` is called with a device pixel one unit beyond `plotLeft + plotWidth`
- **THEN**: the returned value is strictly greater than `xDomainMax`, not equal to it

#### Scenario: The inverse never returns NaN for a finite input
- **GIVEN**: a `ViewportTransform`, including one with a zero-span axis
- **WHEN**: `unprojectX` and `unprojectY` are called with an arbitrary finite device pixel value
- **THEN**: neither call returns `NaN`

### Requirement: Degenerate Construction Inputs Throw `RangeError`
`createViewportTransform` MUST throw `RangeError` when any numeric option is non-finite, when
`dpr <= 0`, when any inset is negative, when the sum of insets on either axis meets or exceeds
the corresponding CSS dimension (a non-positive plot area), when `yScaleKind` is not an integer
in `[0, 1]`, or when `yScaleKind === Y_SCALE_KIND_LOG` and `yDomainMin <= 0`. This validation
MUST occur at construction (a cold path); it MUST NOT be silently clamped or defaulted.

#### Scenario: A non-finite input throws
- **GIVEN**: construction options with `xDomainMax: Infinity`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

#### Scenario: A non-positive dpr throws
- **GIVEN**: construction options with `dpr: 0`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

#### Scenario: A negative inset throws
- **GIVEN**: construction options with `insetLeft: -1`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

#### Scenario: Insets exceeding the canvas throw
- **GIVEN**: construction options where `insetLeft + insetRight >= cssWidth`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

### Requirement: A GPU Consumer of X-Domain Values MUST Normalize in Float64 Before Any Float32 Cast
A consumer that uploads X-domain values to a WebGL2 vertex attribute, uniform, or buffer MUST
compute the normalized quantity `(xOrigin + xOffset - xDomainMin) / (xDomainMax - xDomainMin)`
entirely in IEEE-754 binary64 on the CPU, and MUST cast only that normalized result — whose
magnitude is bounded by the visible domain rather than by the absolute wavelength — to float32.
It MUST NOT cast `xOrigin`, `xDomainMin`, `xDomainMax`, or the sum `xOrigin + xOffset` to
float32 individually, and MUST NOT perform the subtraction `x - xDomainMin` on float32 operands
in shader code. `createViewportTransform` MUST store `xOrigin`, `xDomainMin` and `xDomainMax`
without any float32 rounding, so that `Math.fround(t.xOrigin) !== t.xOrigin` holds for an origin
such as `1550.123456`. Whether a specific WebGL2 consumer's GLSL and buffer-upload code actually
obeys this contract is not verifiable from `@trace-kit/core`, which has no GPU access; that
conformance is an acceptance criterion of the WebGL2 renderer change that consumes this contract,
not of this change.

#### Scenario: xOrigin is stored without float32 rounding
- **GIVEN**: a `ViewportTransform` constructed with `xOrigin: 1550.123456`
- **WHEN**: `Math.fround(t.xOrigin)` is compared to `t.xOrigin`
- **THEN**: `Math.fround(t.xOrigin) !== t.xOrigin`

#### Scenario: xDomainMin and xDomainMax are stored without float32 rounding
- **GIVEN**: a `ViewportTransform` constructed with `xDomainMin: 1550.123456`,
  `xDomainMax: 1550.987654`
- **WHEN**: `Math.fround` is applied to each and compared to the stored value
- **THEN**: `Math.fround(t.xDomainMin) !== t.xDomainMin` and
  `Math.fround(t.xDomainMax) !== t.xDomainMax`

#### Scenario: A naive individual-float32-cast normalization exceeds 1 picometre of error
- **GIVEN**: `xOrigin: 1550.0`, an `xOffset` of a few nanometres, and
  `xDomainMin`/`xDomainMax` describing a visible span
- **WHEN**: the normalized position is computed as
  `Math.fround(xOrigin + xOffset) - Math.fround(xDomainMin)` (modeling an individual float32 cast
  of `xOrigin + xOffset` and of `xDomainMin` before subtracting)
- **THEN**: the absolute error against the exact f64 computation of
  `xOrigin + xOffset - xDomainMin` exceeds 1 picometre, demonstrating the obligation is not
  theoretical

#### Scenario: The prescribed float64-normalize-then-cast path stays under 1 picometre of error
- **GIVEN**: the same `xOrigin`, `xOffset`, `xDomainMin`, `xDomainMax` values, evaluated over both
  a 100 nm span and a 1500 nm span
- **WHEN**: the normalized position is computed as
  `Math.fround((xOrigin + xOffset - xDomainMin) / (xDomainMax - xDomainMin))` (float64 arithmetic
  throughout, one float32 cast at the end, modeling the prescribed CPU-side normalization)
- **THEN**: the absolute error against the exact f64 computation, mapped back to nanometres, stays
  below 1 picometre for both spans
