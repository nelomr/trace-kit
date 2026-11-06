# Capability: viewport-transform

> `ViewportTransform` is the single projection consumed by every renderer and by the SVG exporter. It
> lives in `@trace-kit/core` (`packages/core/src/viewport/transform.ts`; tick selection in
> `packages/core/src/viewport/ticks.ts`) and MUST satisfy CLAUDE.md rule 5 (zero DOM reference) with no
> environment guard anywhere.

## ADDED Requirements

### Requirement: `ViewportTransform` Is a Frozen Flat Object, Not a Class
`@trace-kit/core` MUST export `ViewportTransform` as a plain interface of `readonly number`
fields only (`xDomainMin`, `xDomainMax`, `yDomainMin`, `yDomainMax`, `xOrigin`, `xOffsetMin`,
`deviceWidth`, `deviceHeight`, `dpr`, `plotLeft`, `plotTop`, `plotWidth`, `plotHeight`, `xScale`,
`yScale`, `yBase`, `yScaleKind`, `yLogDomainMin`, `yLogScale` — nineteen fields total), and
`createViewportTransform(options)` MUST return an instance frozen with `Object.freeze`.
Projection and inversion MUST be exposed as module-level free functions (`projectX`, `projectY`,
`unprojectX`, `unprojectY`, `isInsidePlotArea`, `transformMatchesPayload`) operating on that
object, not as methods on it. No field or function in this module MUST reference `document`,
`window`, `HTMLCanvasElement`, `OffscreenCanvas`, or `getContext`. `xOffsetMin` MUST be present
immediately after `xOrigin`, and the three Y-scale fields (`yScaleKind`, `yLogDomainMin`,
`yLogScale`) MUST be present, in this exact insertion order immediately after `yBase`, on every
instance the module produces, including a linear (`yScaleKind === Y_SCALE_KIND_LINEAR`) instance —
never conditionally omitted — so that every instance the module produces shares one V8 object shape
regardless of scale kind.

#### Scenario: A constructed transform is frozen
- **GIVEN**: a `ViewportTransform` returned by `createViewportTransform`
- **WHEN**: an attempt is made to assign to `transform.plotWidth` in strict-mode code
- **THEN**: the assignment throws a `TypeError`, and `transform.plotWidth` is unchanged

#### Scenario: The transform survives structuredClone with all nineteen numeric fields
- **GIVEN**: a constructed `ViewportTransform`
- **WHEN**: it is passed through `structuredClone`
- **THEN**: the clone has all nineteen numeric fields, each compared to the original with
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

#### Scenario: xOffsetMin sits immediately after xOrigin on every instance
- **GIVEN**: any constructed `ViewportTransform`, whatever its `xOrigin`
- **WHEN**: `Object.keys` is called on it
- **THEN**: `"xOffsetMin"` is at the index immediately following `"xOrigin"`

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
span. `unprojectX(t, px)` MUST return **absolute** physical X, `t.xDomainMin + (px - t.plotLeft) /
t.xScale`, and MUST NOT depend on `xOrigin`. Round-tripping MUST hold for values both inside and
outside the current domain: `unprojectX(t, projectX(t, o)) === t.xOrigin + o` within floating-point
tolerance, for any finite payload offset `o`. This requirement governs the linear (X, and Y when
`yScaleKind === Y_SCALE_KIND_LINEAR`) paths; the log-axis Y inverse's totality, saturation
behavior, and relative round-trip tolerance are governed separately by the
`scale-logarithmic-transform` capability.

#### Scenario: The inverse round-trips an offset inside the domain to absolute X
- **GIVEN**: a `ViewportTransform` with `xOrigin: 1000`, domain `[1000, 1299]` and a non-zero span
- **WHEN**: `unprojectX(t, projectX(t, o))` is computed for `o = 123.5`
- **THEN**: the result equals `1123.5` within f64 tolerance

#### Scenario: The inverse round-trips an offset outside the domain
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectX(t, projectX(t, o))` is computed for `o` outside
  `[t.xOffsetMin, t.xDomainMax - t.xOrigin]` (for example `o = 600`)
- **THEN**: the result equals `t.xOrigin + o` within f64 tolerance, and the produced device pixel
  lies outside `[plotLeft, plotLeft + plotWidth]`

#### Scenario: With a zero origin the inverse is unchanged
- **GIVEN**: a `ViewportTransform` with `xOrigin: 0`
- **WHEN**: `unprojectX(t, projectX(t, v))` is computed for `v` inside the domain
- **THEN**: the result equals `v` within f64 tolerance

#### Scenario: The inverse of a plot-edge pixel is the absolute domain edge
- **GIVEN**: a transform with `xOrigin: 1550` and domain `[1550, 1551]`
- **WHEN**: `unprojectX` is called with `plotLeft` and with `plotLeft + plotWidth`
- **THEN**: the results are `1550` and `1551` within f64 tolerance

#### Scenario: The inverse does not clamp at the plot-area edge
- **GIVEN**: a `ViewportTransform` with a known `plotLeft` and `plotWidth`
- **WHEN**: `unprojectX` is called with a device pixel one unit beyond `plotLeft + plotWidth`
- **THEN**: the returned value is strictly greater than `xDomainMax`, not equal to it

#### Scenario: The inverse never returns NaN for a finite input
- **GIVEN**: a `ViewportTransform`, including one with a zero-span axis
- **WHEN**: `unprojectX` and `unprojectY` are called with an arbitrary finite device pixel value
- **THEN**: neither call returns `NaN`

### Requirement: Plot-Area Containment Is a Separate Predicate From Projection
`isInsidePlotArea(t, deviceX, deviceY)` MUST be the only function that reports whether a device
pixel coordinate lies within the plot area, and MUST be inclusive of all four edges. Neither
`projectX`/`projectY` nor `unprojectX`/`unprojectY` MUST perform or imply a containment check.

#### Scenario: All four edges are inside
- **GIVEN**: a `ViewportTransform` with known `plotLeft`, `plotTop`, `plotWidth`, `plotHeight`
- **WHEN**: `isInsidePlotArea` is evaluated at each of the four edge coordinates
  (`plotLeft`, `plotLeft + plotWidth`, `plotTop`, `plotTop + plotHeight`, holding the other axis
  fixed inside range)
- **THEN**: each call returns `true`

#### Scenario: One pixel beyond each edge is outside
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `isInsidePlotArea` is evaluated one device pixel beyond each of the four edges
- **THEN**: each call returns `false`

### Requirement: A Zero-Span Domain Projects to a Single Line and Inverts Without NaN
`createViewportTransform` MUST accept a domain where `xDomainMin === xDomainMax` or
`yDomainMin === yDomainMax` (a single-sample or flat-signal payload) as valid input, not an
error. When the X span is zero, `projectX` MUST return `plotLeft` for every input, and
`unprojectX` MUST return `xDomainMin` for every input, without evaluating a `0/0` division. The
same MUST hold per axis independently for Y with `plotTop + plotHeight` (via `yBase`) and
`yDomainMin`.

#### Scenario: A zero-span X domain projects every value to plotLeft
- **GIVEN**: a `ViewportTransform` constructed with `xDomainMin === xDomainMax`
- **WHEN**: `projectX` is called with several different offset values
- **THEN**: every call returns exactly `plotLeft`

#### Scenario: The inverse of a zero-span domain returns the domain minimum, not NaN
- **GIVEN**: the same zero-span transform
- **WHEN**: `unprojectX` is called with an arbitrary device pixel
- **THEN**: it returns exactly `xDomainMin`, and does not return `NaN`

#### Scenario: A flat signal (zero-span Y) still draws as a horizontal line
- **GIVEN**: a `ViewportTransform` constructed with `yDomainMin === yDomainMax`
- **WHEN**: `projectY` is called for several different Y values
- **THEN**: every call returns exactly the transform's `yBase`

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

### Requirement: Insets Enter in CSS Pixels and Are Converted to Device Pixels Once
`CreateViewportTransformOptions` MUST accept `insetLeft`, `insetRight`, `insetTop`, and
`insetBottom` in CSS pixels. `createViewportTransform` MUST multiply each by `dpr` exactly once,
at construction, to derive `plotLeft`, `plotTop`, `plotWidth`, and `plotHeight` in device pixels.
`deviceWidth` and `deviceHeight` MUST be computed with `Math.round(cssDimension * dpr)`, matching
the integer backing-store size the renderer writes to `canvas.width`/`canvas.height`.

#### Scenario: plotLeft is the CSS inset scaled by dpr
- **GIVEN**: construction options with `insetLeft: 40` and `dpr: 2`
- **WHEN**: the transform is constructed
- **THEN**: `transform.plotLeft === 80`

#### Scenario: deviceWidth matches the rounded backing-store size
- **GIVEN**: construction options with `cssWidth: 801` and `dpr: 2`
- **WHEN**: the transform is constructed
- **THEN**: `transform.deviceWidth === Math.round(801 * 2)`

### Requirement: `selectTicks` Writes Into a Caller Buffer and Returns a Count
`@trace-kit/core` MUST export `selectTicks(domainMin, domainMax, targetCount, out, outputOffset)`
which writes "nice" (1/2/5 × 10^k) tick values covering `[domainMin, domainMax]` into `out`
starting at `outputOffset`, and returns the number of ticks written. It MUST NOT allocate an
array to return values, MUST NOT call `Math.log10` or `Math.pow` or any other transcendental
function, and MUST NOT write beyond `out.length`.

#### Scenario: selectTicks writes into the caller's buffer and returns the count
- **GIVEN**: a preallocated `Float64Array` of length `32` and a call with `outputOffset: 0`
- **WHEN**: `selectTicks(0, 100, 5, out, 0)` runs
- **THEN**: it returns a count `n <= 32`, and `out[0..n)` holds finite, ascending nice-number
  values covering `[0, 100]`, with no return value other than the count

#### Scenario: selectTicks refuses to overrun the output buffer
- **GIVEN**: a preallocated `Float64Array` of length `4` and a domain that would naturally
  produce more than `4` ticks at the requested `targetCount`
- **WHEN**: `selectTicks(domainMin, domainMax, targetCount, out, 0)` runs
- **THEN**: it writes no more than `4` values into `out` and returns a count `<= 4`

#### Scenario: selectTicks produces identical output across two runs (no transcendental drift)
- **GIVEN**: the same domain, target count, and output buffer size
- **WHEN**: `selectTicks` is called twice in the same process
- **THEN**: both calls return the same count and write bit-identical values, and the source of
  `selectTicks` contains no `Math.log10` or `Math.pow` call (asserted by a source scan)

#### Scenario: selectTicks writes at the given offset without disturbing prior contents
- **GIVEN**: a preallocated `Float64Array` of length `32` with sentinel values written to indices
  `[0, 10)`
- **WHEN**: `selectTicks(domainMin, domainMax, targetCount, out, 10)` runs
- **THEN**: indices `[0, 10)` are unchanged and the new ticks start at index `10`

### Requirement: A GPU Consumer of X-Domain Values MUST Normalize in Float64 Before Any Float32 Cast
A consumer that uploads X-domain values to a WebGL2 vertex attribute, uniform, or buffer MUST do
exactly one of the following, and nothing else. In both options the origin of the subtraction is the
transform's `xOffsetMin` (binary64), because the per-sample data are payload offsets and
`xOffsetMin = xDomainMin - xOrigin` is the domain minimum in that same offset space:

1. **CPU normalization**: compute the normalized quantity
   `(xOffset - t.xOffsetMin) / (t.xDomainMax - t.xDomainMin)` entirely in IEEE-754 binary64 on
   the CPU and cast only that normalized result, whose magnitude is bounded by the visible domain,
   to float32; or
2. **Hi/lo origin**: leave the per-sample data as the payload's float32 offsets from `xOrigin`
   (uploaded unmodified) and pass the offset-space domain origin to the shader as a pair of float32
   uniforms `(hi, lo)` derived in binary64 as `hi = Math.fround(d)` and `lo = Math.fround(d - hi)`,
   where `d = t.xOffsetMin` is the binary64 offset-space domain minimum of the consumer's own
   per-trace transform. The shader MAY then subtract on float32 operands only in the form
   `((offset - hi) * one) - lo`, in that order, where `one` is a float32 uniform always set to `1`
   so the compiler cannot reassociate the two subtractions, before scaling by a float32 uniform
   equal to the binary64 quotient of the plot width and the X span.

In both cases the consumer MUST NOT cast `xOrigin`, `xDomainMin`, `xDomainMax`, `xOffsetMin` or the
sum `xOrigin + xOffset` to float32 individually (other than as the `hi` of the pair), MUST NOT use a
single float32 origin uniform in place of the `(hi, lo)` pair, MUST NOT upload the absolute
`xDomainMin` as the shader origin (it is not in the space of the per-sample offsets), and MUST NOT
perform any other subtraction of float32 X operands in shader code (in particular `x - xDomainMin`
or `x - xOffsetMin` with a single float).
`createViewportTransform` MUST store `xOrigin`, `xOffsetMin`, `xDomainMin` and `xDomainMax`
without any float32 rounding, so that `Math.fround(t.xOrigin) !== t.xOrigin` holds for an origin
such as `1550.123456`. Conformance of a specific consumer's GLSL and upload code is not verifiable
from `@trace-kit/core`, which has no GPU access; it is an acceptance criterion of the WebGL2
renderer that consumes this contract, verified there by `Math.fround` emulation tests against a
float64 reference (`webgl2-golden-parity`).

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

#### Scenario: xOffsetMin is stored without float32 rounding
- **GIVEN**: a `ViewportTransform` constructed with `xOrigin: 1550`, `xDomainMin: 1550.123456`,
  `xDomainMax: 1550.987654`
- **WHEN**: `Math.fround(t.xOffsetMin)` is compared to `t.xOffsetMin`
- **THEN**: `Math.fround(t.xOffsetMin) !== t.xOffsetMin`, and `t.xOffsetMin === 1550.123456 - 1550`

#### Scenario: A naive individual-float32-cast normalization exceeds 1 picometre of error
- **GIVEN**: `xOrigin: 1550.0`, an `xOffset` of a few nanometres, and absolute
  `xDomainMin`/`xDomainMax` describing a visible span
- **WHEN**: the normalized position is computed as
  `Math.fround(xOrigin + xOffset) - Math.fround(xDomainMin)` (modeling an individual float32 cast
  of `xOrigin + xOffset` and of `xDomainMin` before subtracting)
- **THEN**: the absolute error against the exact f64 computation of `xOffset - t.xOffsetMin`
  (equal to `xOrigin + xOffset - xDomainMin`) exceeds 1 picometre, demonstrating the obligation is
  not theoretical

#### Scenario: The prescribed float64-normalize-then-cast path stays under 1 picometre of error
- **GIVEN**: the same `xOrigin`, `xOffset`, `xDomainMin`, `xDomainMax` values, evaluated over both
  a 100 nm span and a 1500 nm span
- **WHEN**: the normalized position is computed as
  `Math.fround((xOffset - t.xOffsetMin) / (xDomainMax - xDomainMin))` (float64 arithmetic
  throughout, one float32 cast at the end, modeling the prescribed CPU-side normalization)
- **THEN**: the absolute error against the exact f64 computation, mapped back to nanometres, stays
  below 1 picometre for both spans

#### Scenario: The hi/lo pair reconstructs the float64 offset-space origin to float32-pair precision
- **GIVEN**: a transform with `xOrigin: 1550` and `xDomainMin: 2550.00002`, so `d = t.xOffsetMin`
  is approximately `1000.00002` in binary64
- **WHEN**: `hi = Math.fround(d)` and `lo = Math.fround(d - hi)` are computed
- **THEN**: `Math.abs((hi + lo) - d) < 1e-9` while `Math.abs(hi - d) > 1e-5`, demonstrating `lo`
  carries information `hi` alone loses

#### Scenario: Deep zoom at a non-zero origin stays under a hundredth of a device pixel
- **GIVEN**: a transform with `xOrigin: 1550`, `xDomainMin: 2550.00002`, `xDomainMax: 2550.01002`
  (window `0.01`), `plotWidth = 1000` device pixels, so `d = t.xOffsetMin` is approximately
  `1000.00002`, and float32 offsets near `1000`
- **WHEN**: the shader expression `((offset - hi) * one - lo) * scale` (with `one = 1`, `hi`/`lo`
  from `d`) is emulated with `Math.fround` after every operation and compared with the binary64
  evaluation `(offset - d) * (plotWidth / (xDomainMax - xDomainMin))` on the same float32 offsets
- **THEN**: the maximum absolute difference is below `0.01` device pixels

#### Scenario: A single float32 origin at deep zoom misplaces samples by more than a pixel
- **GIVEN**: the same inputs
- **WHEN**: the origin is passed as one value `Math.fround(d)` with no `lo`
- **THEN**: the maximum absolute difference against the binary64 evaluation exceeds `1` device
  pixel

#### Scenario: The absolute domain minimum is not a valid shader origin
- **GIVEN**: the same inputs
- **WHEN**: the emulation uses `hi`/`lo` split from the absolute `t.xDomainMin` instead of `d`
- **THEN**: the maximum absolute difference against the binary64 evaluation exceeds `1` device
  pixel, demonstrating the origin must be the offset-space `xOffsetMin`

#### Scenario: Subtracting a single-float domain minimum is rejected
- **GIVEN**: the WebGL2 vertex shader source
- **WHEN**: it is searched for a subtraction whose right operand is a single-float uniform holding
  `xDomainMin`, `xOffsetMin` or `xOrigin` rather than the `hi`/`lo` pair
- **THEN**: no such subtraction exists

### Requirement: The X Domain Is Absolute Physical X, and Projection Subtracts a Per-Trace Offset-Space Origin
`ViewportTransform.xDomainMin` and `xDomainMax`, and the `xDomainMin`/`xDomainMax` options of
`createViewportTransform`, MUST be expressed in absolute physical X, the same space as
`payload.xOrigin + payload.x[i]` (`spectrum-data-payload`, `viewport-window-resolution`). They MUST
be stored as given, in binary64, without float32 rounding. `xOrigin` MUST be the binary64 origin of
the payload the transform serves (`0` when the transform serves no payload).

The transform MUST carry a readonly binary64 field `xOffsetMin` equal to `xDomainMin - xOrigin`,
computed exactly once at construction. It is the left edge of the domain in offset space, the space
of the payload's `x` buffer.

`projectX(t, xOffset)` MUST keep its signature. Its input `xOffset` is a payload offset `x[i]`
(never an absolute X), and it MUST return `t.plotLeft + (xOffset - t.xOffsetMin) * t.xScale`: one
subtraction and one multiplication per call, reading neither `t.xOrigin` nor `t.xDomainMin`.
`xScale` MUST remain `plotWidth / (xDomainMax - xDomainMin)` (and `0` for a zero span). A caller
that holds an absolute X MUST convert it with the same origin (`xAbsolute - t.xOrigin`) before
calling `projectX`. Because the per-trace transform owns the origin, two traces with different
`xOrigin` that sample the same absolute X MUST project it to the same device pixel.

When `xOrigin === 0`, `xOffsetMin` MUST be bit-identical to `xDomainMin`, so projection of a payload
with a zero origin is unchanged.

#### Scenario: A zero origin leaves projection unchanged
- **GIVEN**: a transform constructed with `xOrigin: 0`, `xDomainMin: 10`, `xDomainMax: 20`
- **WHEN**: `xOffsetMin` is read and `projectX(t, 12.5)` is evaluated
- **THEN**: `Object.is(t.xOffsetMin, t.xDomainMin)` is `true`, and the result is bit-identical to
  `t.plotLeft + (12.5 - t.xDomainMin) * t.xScale`

#### Scenario: An absolute domain maps payload offsets across the plot
- **GIVEN**: a transform constructed with `xOrigin: 1000`, `xDomainMin: 1000`, `xDomainMax: 1299`
  and a plot width of `598` device pixels
- **WHEN**: `projectX` is evaluated at offsets `0`, `149.5` and `299`
- **THEN**: `t.xOffsetMin === 0`, and the results are `plotLeft`, `plotLeft + 299` and
  `plotLeft + 598`

#### Scenario: The offset-space origin is the absolute domain minimum less the origin
- **GIVEN**: a transform constructed with `xOrigin: 1550`, `xDomainMin: 1550.25`,
  `xDomainMax: 1551.25`
- **WHEN**: `xOffsetMin` is read
- **THEN**: `t.xOffsetMin === 0.25`, and `projectX(t, 0.25) === t.plotLeft`

#### Scenario: Traces with different origins agree on the same absolute X
- **GIVEN**: two transforms built from the same geometry and the absolute domain `[0, 299]`, one with
  `xOrigin: 0` and one with `xOrigin: 1000`
- **WHEN**: `projectX(t0, i)` and `projectX(t1, i - 1000)` are evaluated for `i` in `0..299`
- **THEN**: the two results are equal for every `i`, and `t1.xOffsetMin === -1000`

#### Scenario: The domain edges project to the plot edges
- **GIVEN**: a transform with a non-zero `xOrigin` and a non-zero X span
- **WHEN**: `projectX` is evaluated at `t.xDomainMin - t.xOrigin` and at `t.xDomainMax - t.xOrigin`
- **THEN**: the results equal `t.plotLeft` and `t.plotLeft + t.plotWidth` within f64 tolerance

#### Scenario: projectX reads only the offset-space origin
- **GIVEN**: the source of `projectX` in `packages/core/src/viewport/transform.ts`
- **WHEN**: it is scanned for member accesses on the transform parameter
- **THEN**: it reads `plotLeft`, `xOffsetMin` and `xScale` and does not read `xOrigin` or
  `xDomainMin`
