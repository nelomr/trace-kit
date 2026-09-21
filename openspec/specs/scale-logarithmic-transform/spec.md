# Capability: scale-logarithmic-transform

> Change: `core-scale-transforms` (roadmap `order: 5.6`). New capability.
>
> Source: `design.md` D1 (allocation contract), D2 (dispatch, field layout, coefficients), D3
> (log inverse totality), D4 (`selectLogTicks`). Base-10 logarithmic Y projection, its total
> finite inverse, the `yDomainMin <= 0` construction error, and `selectLogTicks`. Lives in
> `@trace-kit/core` and MUST satisfy CLAUDE.md rule 5 (zero DOM reference).

## ADDED Requirements

### Requirement: Y-Axis Scale Kind Is a Numeric, Reserved-Range Discriminant
`@trace-kit/core` MUST export `Y_SCALE_KIND_LINEAR = 0` and `Y_SCALE_KIND_LOG = 1` as numeric
constants. `createViewportTransform` MUST throw `RangeError` when the supplied `yScaleKind` is
not an integer in `[0, 1]`. Values `2` and above are reserved for future scale kinds and MUST NOT
be accepted by this change.

#### Scenario: A supported scale kind constructs successfully
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LOG` and `yDomainMin: 1`,
  `yDomainMax: 1000`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it returns a frozen `ViewportTransform`, no error is thrown

#### Scenario: A reserved scale kind throws
- **GIVEN**: construction options with `yScaleKind: 2`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

#### Scenario: A non-integer scale kind throws
- **GIVEN**: construction options with `yScaleKind: 0.5`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

### Requirement: A Log Y Axis Requires a Strictly Positive Domain Minimum
`createViewportTransform` MUST throw `RangeError` when `yScaleKind === Y_SCALE_KIND_LOG` and
`yDomainMin <= 0`. This validation MUST occur at construction (a cold path) and MUST NOT be
silently clamped, defaulted, or epsilon-shifted.

#### Scenario: A zero domain minimum on a log axis throws
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LOG` and `yDomainMin: 0`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

#### Scenario: A negative domain minimum on a log axis throws
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LOG` and `yDomainMin: -5`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it throws `RangeError`

#### Scenario: A positive domain minimum on a log axis does not throw
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LOG` and `yDomainMin: 0.001`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it does not throw

#### Scenario: A zero or negative domain minimum on a linear axis is unaffected
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LINEAR` and `yDomainMin: -10`
- **WHEN**: `createViewportTransform` is called
- **THEN**: it does not throw for this reason (linear axes admit negative and zero domains,
  unchanged from the archived `viewport-transform` behavior)

### Requirement: Log Coefficients Are Precomputed Once at Construction
For `yScaleKind === Y_SCALE_KIND_LOG`, `createViewportTransform` MUST compute `yLogDomainMin`
as `Math.log10(yDomainMin)` and `yLogScale` as `logSpan === 0 ? 0 : plotHeight / logSpan` where
`logSpan = Math.log10(yDomainMax) - yLogDomainMin`, exactly once, at construction. For
`yScaleKind === Y_SCALE_KIND_LINEAR`, `yLogDomainMin` MUST be `0` and `yLogScale` MUST be `0`.
`yScale` MUST be `Number.NaN` on a log axis, and `yBase` MUST be `plotTop + plotHeight` on a log
axis (folding `yDomainMin` out of `yBase` rather than into it, as the linear path does).

#### Scenario: yLogDomainMin is the log10 of the domain minimum
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LOG`, `yDomainMin: 100`,
  `yDomainMax: 100000`
- **WHEN**: the transform is constructed
- **THEN**: `transform.yLogDomainMin === Math.log10(100)`

#### Scenario: yLogScale is device pixels per decade
- **GIVEN**: the same construction options with `plotHeight` known
- **WHEN**: the transform is constructed
- **THEN**: `transform.yLogScale === plotHeight / (Math.log10(100000) - Math.log10(100))`

#### Scenario: yScale is NaN on a log axis
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: `transform.yScale` is read
- **THEN**: `Number.isNaN(transform.yScale)` is `true`

#### Scenario: Linear-axis log fields are exact zero, not merely falsy
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LINEAR`
- **WHEN**: `transform.yLogDomainMin` and `transform.yLogScale` are read
- **THEN**: both are exactly `0`

#### Scenario: A zero-decade log domain yields yLogScale of zero
- **GIVEN**: construction options with `yScaleKind: Y_SCALE_KIND_LOG`, `yDomainMin: 50`,
  `yDomainMax: 50`
- **WHEN**: the transform is constructed
- **THEN**: `transform.yLogScale === 0`

### Requirement: Log Forward Projection Computes `t.yBase - (Math.log10(yValue) - t.yLogDomainMin) * t.yLogScale`
`projectY` MUST, when `t.yScaleKind !== Y_SCALE_KIND_LINEAR`, compute its result as
`t.yBase - (Math.log10(yValue) - t.yLogDomainMin) * t.yLogScale`. This is the one point in the
module permitted to call `Math.log10`; the governing allocation-and-allow-list requirement is
recorded on the `viewport-transform` capability's MODIFIED delta in this same change.

#### Scenario: The domain minimum projects to exactly yBase
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`,
  `yDomainMin: 0.5`, `yDomainMax: 500`
- **WHEN**: `projectY(t, 0.5)` is called
- **THEN**: the result is exactly `t.yBase` (`Object.is` equality), because
  `Math.log10(yDomainMin)` and `t.yLogDomainMin` are the same call on the same input, so their
  difference is exactly `+0`

#### Scenario: The domain maximum projects to plotTop within 1 ULP
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `projectY(t, 500)` is called
- **THEN**: the result is within 1 ULP of `t.plotTop`, not necessarily bit-identical to it

#### Scenario: A mid-domain value projects between plotTop and yBase
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `projectY(t, 5)` (one decade above the domain minimum) is called
- **THEN**: the result is strictly between `t.plotTop` and `t.yBase`, and closer to `t.yBase`
  than to `t.plotTop` (since `[0.5, 500]` spans 3 decades and 1 decade is 1/3 of the span)

### Requirement: Log Inverse Projection Is Total, Finite, and Never `NaN` for a Finite Input
`unprojectY` MUST, when `t.yScaleKind !== Y_SCALE_KIND_LINEAR`, guard `t.yLogScale === 0` before
any division and return `t.yDomainMin` in that case. Otherwise it MUST compute
`10 ** ((t.yBase - devicePixelY) / t.yLogScale + t.yLogDomainMin)`. For every finite
`devicePixelY`, the result MUST be a non-`NaN` number: finite within the representable f64 range,
saturating to exactly `+0` or exactly `+Infinity` when the true mathematical value falls outside
f64 range, and MUST NOT be clamped to a finite domain-derived value in that saturating case.

#### Scenario: A pixel inside the plot area inverts to a finite in-domain value
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`,
  `yDomainMin: 1`, `yDomainMax: 1000`
- **WHEN**: `unprojectY` is called with a device pixel strictly inside
  `[t.plotTop, t.plotTop + t.plotHeight]`
- **THEN**: the result is finite and lies within `[1, 1000]`

#### Scenario: A pixel just above the plot area extrapolates above the domain maximum without clamping
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectY` is called with a device pixel one unit above `t.plotTop`
- **THEN**: the result is finite, strictly greater than `1000`, and not equal to `1000`

#### Scenario: A pixel just below the plot area extrapolates below the domain minimum without reaching zero or negative
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectY` is called with a device pixel one unit below `t.plotTop + t.plotHeight`
- **THEN**: the result is finite, strictly less than `1`, and strictly greater than `0`

#### Scenario: A pixel far above the plot area saturates to positive infinity, not NaN
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectY` is called with a device pixel far enough above `t.plotTop` that the true
  mathematical result exceeds `Number.MAX_VALUE` (approximately 61,000 device pixels above
  `plotTop` for this domain and a 600px `plotHeight`)
- **THEN**: the result is exactly `+Infinity`, and `Number.isNaN(result)` is `false`

#### Scenario: A pixel far below the plot area saturates to positive zero, not NaN or negative zero
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectY` is called with a device pixel far enough below `t.plotTop + t.plotHeight`
  that the true mathematical result underflows below `Number.MIN_VALUE`
- **THEN**: the result is exactly `+0` (`Object.is(result, 0)` is `true`, `Object.is(result, -0)`
  is `false`), and `Number.isNaN(result)` is `false`

#### Scenario: unprojectY never returns NaN for any finite device pixel input
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: `unprojectY` is called across a sweep of finite device pixel values spanning from far
  above to far below the plot area, including values within it
- **THEN**: no call returns `NaN`

#### Scenario: A zero-decade log domain inverts to the single domain value without division by zero
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`,
  `yDomainMin: 50`, `yDomainMax: 50`
- **WHEN**: `unprojectY` is called with an arbitrary finite device pixel
- **THEN**: it returns exactly `50`, and does not return `NaN`

#### Scenario: Infinite device pixel inputs remain total, not NaN
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: `unprojectY` is called with `Number.POSITIVE_INFINITY` and then with
  `Number.NEGATIVE_INFINITY`
- **THEN**: the first call returns exactly `+0` and the second returns exactly `+Infinity`;
  neither returns `NaN`

### Requirement: Log Round-Trip Error Is Bounded by a Relative, Not Absolute, Tolerance
`unprojectY(t, projectY(t, v))` MUST satisfy `|result - v| / v <= 1e-9` for every `v` in
`[yDomainMin, yDomainMax]` and for `v` up to one decade outside each edge, for domains spanning
up to 12 decades. This bound MUST be asserted as a relative error. An absolute error bound MUST
NOT be substituted, because a single absolute tolerance is simultaneously vacuous at the high end
of a multi-decade domain and unsatisfiable at the low end of the same domain.

#### Scenario: Round-trip error stays within the relative bound across a wide domain
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`,
  `yDomainMin: 1e-6`, `yDomainMax: 1e6` (12 decades)
- **WHEN**: `unprojectY(t, projectY(t, v))` is computed for `v` values sampled across each decade
  of `[yDomainMin, yDomainMax]`
- **THEN**: for every sampled `v`, `Math.abs(result - v) / v <= 1e-9`

#### Scenario: Round-trip error stays within the relative bound just outside the domain edges
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `unprojectY(t, projectY(t, v))` is computed for `v` one decade below `yDomainMin` and
  one decade above `yDomainMax`
- **THEN**: for both values, `Math.abs(result - v) / v <= 1e-9`

#### Scenario: A relative-only bound rejects an absolute-tolerance implementation
- **GIVEN**: the assertion helper used by the round-trip test
- **WHEN**: it is invoked with a hypothetical absolute-error implementation that passes at
  `v = 1e6` (error `1e-3` absolute, well within a loose absolute bound) but whose relative error
  at that same point exceeds `1e-9`
- **THEN**: the assertion fails, demonstrating the test measures relative error, not absolute
  error

### Requirement: An Out-of-Domain Sample on a Log Axis Projects to a Non-Finite Coordinate, Not a Defect
For `yScaleKind === Y_SCALE_KIND_LOG` and a caller-supplied data value `yValue <= 0` (outside a
validated log domain, distinct from a construction-time domain bound), `projectY` MUST return a
non-finite result (`NaN` or `-Infinity`, following directly from `Math.log10(yValue)`). This is
specified behavior, not an error condition to be caught or masked: a non-finite device coordinate
is silently skipped by `Path2D`/`lineTo` consumers, which is the intended, loud-rather-than-silent
outcome for data a log axis cannot represent.

#### Scenario: A zero data value on a log axis projects to a non-finite coordinate
- **GIVEN**: a `ViewportTransform` constructed with `yScaleKind: Y_SCALE_KIND_LOG`,
  `yDomainMin: 1`, `yDomainMax: 100`
- **WHEN**: `projectY(t, 0)` is called
- **THEN**: the result is not finite (`Number.isFinite(result)` is `false`)

#### Scenario: A negative data value on a log axis projects to a non-finite coordinate
- **GIVEN**: the same `ViewportTransform`
- **WHEN**: `projectY(t, -3)` is called
- **THEN**: the result is not finite

### Requirement: `selectLogTicks` Writes Into a Caller Buffer, Returns a Count, and Is Fully Transcendental-Free
`@trace-kit/core` MUST export
`selectLogTicks(domainMin, domainMax, targetCount, out, outputOffset)` with the identical
caller-buffer/return-count contract as `selectTicks`: it writes decade and, where applicable,
`2..9` mantissa minor tick values covering `[domainMin, domainMax]` into `out` starting at
`outputOffset`, returns the number written, MUST NOT allocate an array to return values, and MUST
NOT write beyond `out.length`. The decade classification and thinning walk MUST use only integer
multiply/divide magnitude stepping (the same technique `niceStep` already uses), and MUST call
neither `Math.log10` nor `Math.pow` anywhere in its implementation, including in its sub-decade
fallback, so `ticks.ts`'s source-scan determinism guarantee extends unchanged to this function.

#### Scenario: selectLogTicks writes into the caller's buffer and returns the count
- **GIVEN**: a preallocated `Float64Array` of length `32` and a call with `outputOffset: 0`
- **WHEN**: `selectLogTicks(1, 1000, 5, out, 0)` runs
- **THEN**: it returns a count `n <= 32`, and `out[0..n)` holds finite, ascending values covering
  `[1, 1000]`

#### Scenario: selectLogTicks contains no transcendental call anywhere, including the sub-decade path
- **GIVEN**: the source of `selectLogTicks` in `packages/core/src/viewport/ticks.ts`
- **WHEN**: it is scanned for `Math.log10` and `Math.pow`
- **THEN**: neither identifier appears anywhere in the function, including the branch handling a
  sub-decade domain

#### Scenario: A many-decade span thins to at most one tick per power of ten
- **GIVEN**: `domainMin: 1e-3`, `domainMax: 1e6`, `targetCount: 5`
- **WHEN**: `selectLogTicks` runs
- **THEN**: it returns exactly the decades `[1e-3, 1e-1, 1e1, 1e3, 1e5]` (stride-2 thinning across
  9 decades toward a target of 5)

#### Scenario: A few-decade span emits every decade plus 2..9 mantissa minors
- **GIVEN**: `domainMin: 1`, `domainMax: 100`, `targetCount: 12`, `out` of capacity `>= 20`
- **WHEN**: `selectLogTicks` runs
- **THEN**: it returns the ascending sequence `1, 2, 3, ..., 9, 10, 20, ..., 90, 100`, clamped to
  the output buffer's capacity if smaller

#### Scenario: A sub-decade span delegates to selectTicks
- **GIVEN**: `domainMin: 286.9252014`, `domainMax: 329.4978332`, `targetCount: 5`
- **WHEN**: `selectLogTicks` runs
- **THEN**: it returns the same tick values `selectTicks(286.9252014, 329.4978332, 5, out,
  outputOffset)` would return for the identical arguments

#### Scenario: selectLogTicks never returns zero ticks for a valid non-degenerate domain
- **GIVEN**: any domain with `domainMin > 0`, `domainMin < domainMax`, both finite, and an output
  buffer with capacity `>= 1`
- **WHEN**: `selectLogTicks` runs, including for the documented d3-scale defect domain
  `[42, 43]` (<https://github.com/d3/d3-scale/issues/44>) and the narrow domain
  `[286.9252014, 329.4978332]`
- **THEN**: it returns a count `>= 1` in every case

#### Scenario: A degenerate or invalid domain returns zero, not an error
- **GIVEN**: `domainMin: 0` (invalid for a log domain), or `domainMin: 100, domainMax: 10`
  (inverted)
- **WHEN**: `selectLogTicks` runs
- **THEN**: it returns `0`

#### Scenario: A zero-span log domain returns exactly the single domain value
- **GIVEN**: `domainMin: 50`, `domainMax: 50`
- **WHEN**: `selectLogTicks` runs with an output buffer of capacity `>= 1`
- **THEN**: it returns `1`, and `out[outputOffset] === 50`

#### Scenario: `selectTicks` itself is unmodified by this change
- **GIVEN**: `selectTicks`'s archived requirement and scenarios in `viewport-transform`
- **WHEN**: `selectTicks` is exercised with the same inputs as before this change
- **THEN**: it produces identical output to its pre-change behavior; its transcendental ban and
  caller-buffer contract hold verbatim
