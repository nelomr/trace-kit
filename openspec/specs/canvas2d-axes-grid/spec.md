# Capability: canvas2d-axes-grid

> Change: `renderers-canvas2d` (ADDED). Modified by: `core-scale-transforms` (roadmap `order: 5.6`).
>
> Source: `design.md` §D3 (single-canvas axes/grid, core-side tick generation) and §D4
> (constructor-frozen style and layout). Axes and grid are in scope because the axis gutters
> define the plot-area insets that `ViewportTransform` consumes (`viewport-transform`
> capability) — not for completeness. As with `canvas2d-trace-rendering`, requirements here are
> written against call sequence and work counts against a fake context, never against rasterized
> pixel output (§D8's honest gap).

## ADDED Requirements

### Requirement: Axes, Grid, and Trace Share a Single Canvas and a Single Context
`Canvas2DRenderer` MUST paint the background, gridlines, trace, and axes (lines, ticks, and
labels) onto exactly one drawing surface using exactly one 2D context. `render()` MUST issue
these in the fixed order: background fill, gridlines, trace stroke, axis lines/ticks/labels.

#### Scenario: The paint order is fixed and complete in one call sequence
- **GIVEN**: a `Canvas2DRenderer` wired to a fake `TraceDrawingContext` that records call order
- **WHEN**: `render()` is called with data present
- **THEN**: the recorded call sequence shows the background fill before any gridline call, every
  gridline call before the trace `stroke(path)` call, and the trace `stroke(path)` call before
  any axis line, tick, or label call

#### Scenario: A single renderer instance owns both the trace and the axes
- **GIVEN**: the `Canvas2DRenderer` public export surface
- **WHEN**: its constructor and members are inspected
- **THEN**: no second renderer class or context-acquiring member exists for axes separately from
  the trace

### Requirement: `render()` Is a Full Repaint With No Partial Invalidation
Every `render()` call MUST repaint the background, gridlines, trace, and axes in full. There MUST
be no dirty-rectangle tracking and no partial-invalidation path. `render()` MUST be idempotent
for a fixed payload revision and a fixed `transform`: repeated calls MUST issue the identical
call sequence and identical arguments each time.

#### Scenario: Repeated renders at a fixed state issue identical call sequences
- **GIVEN**: a fixed payload revision and a fixed `transform`
- **WHEN**: `render()` is called twice in succession
- **THEN**: the fake context records two call sequences of identical length, with identical
  method names and identical arguments in the same order

#### Scenario: A full background fill occurs on every render, not only the first
- **GIVEN**: a renderer that has already called `render()` once
- **WHEN**: `render()` is called a second time with no state change
- **THEN**: the second call sequence includes a full-surface `fillRect` covering
  `(0, 0, deviceWidth, deviceHeight)`, not a partial region

### Requirement: The Axis Layout Owns the Plot-Area Insets, Generalized to N Left-Stacked Axes
Inset computation (left, right, top, bottom gutters in CSS pixels) MUST be a pure function of the
style/layout configuration (font size, tick length, label gutter, per-axis visibility, and the
count of registered Y axes only), never of the data. `computeAxisInsets(style, axes,
yAxisCount)` MUST compute `insetLeft` as the sum of `yAxisCount` per-axis gutters (each
`tickLength + labelGutter + fontSizeCss`) when `axes.showLeftAxis` is true, and `0` otherwise;
`insetRight` and `insetTop` remain `0`; `insetBottom` is unchanged from the archived baseline.
This single summed `insetLeft` MUST feed every one of the N `createViewportTransform` (or
`createAxisTransforms`) calls identically, per the `multi-axis-viewport` capability's
shared-plot-geometry invariant. Inset computation MUST run on `resize` and `setDomain`. No other
code path in the renderer MUST independently compute or override an inset value.

#### Scenario: Insets are derived only from configuration and axis count, not from data
- **GIVEN**: two payloads with different data but the same style/layout configuration and the
  same `yAxisCount`
- **WHEN**: the renderer computes insets for each
- **THEN**: the two computed inset sets are identical

#### Scenario: insetLeft scales linearly with the number of registered left axes
- **GIVEN**: a fixed style/layout configuration with `showLeftAxis: true`
- **WHEN**: `computeAxisInsets` is called once with `yAxisCount: 1` and once with `yAxisCount: 2`
- **THEN**: the `yAxisCount: 2` result's `insetLeft` is exactly twice the `yAxisCount: 1` result's
  `insetLeft` (each axis contributing an identical per-axis gutter)

#### Scenario: Insets feed every one of the N transforms' construction options identically
- **GIVEN**: a renderer configured with a known style/layout and two registered left axes
- **WHEN**: `resize` runs and both resulting transforms are inspected
- **THEN**: `transform[0].plotLeft === transform[1].plotLeft === computedInsetLeft * dpr`,
  matching both the archived single-axis inset-conversion requirement and the
  `multi-axis-viewport` capability's shared-plot-geometry invariant

#### Scenario: Insets recompute on setDomain as well as resize
- **GIVEN**: a renderer with per-axis visibility that could change formatted label width
- **WHEN**: `setDomain` changes the visible range
- **THEN**: the inset computation runs again and every transform reflects the recomputed insets

#### Scenario: Zero registered left axes matches pre-existing single-axis behavior
- **GIVEN**: `yAxisCount: 0`
- **WHEN**: `computeAxisInsets` runs
- **THEN**: `insetLeft === 0`, identical to the archived single-axis-absent behavior

### Requirement: Tick Values Are Computed by Core's `selectTicks` or `selectLogTicks`, Never Duplicated in the Renderer
The renderer MUST obtain tick values for a linear axis by calling `selectTicks` from
`@trace-kit/core`, and for a log axis (`yScaleKind === Y_SCALE_KIND_LOG`) by calling
`selectLogTicks` from `@trace-kit/core`, selecting between the two per axis based on that axis's
`ViewportTransform.yScaleKind`. Both MUST write into a preallocated `Float64Array` of fixed
capacity `MAX_TICKS`. The renderer MUST NOT implement its own nice-number or logarithmic
tick-selection algorithm.

#### Scenario: The renderer calls core's selectTicks and selectLogTicks rather than reimplementing either
- **GIVEN**: `packages/renderers/src/canvas2d/axes.ts`
- **WHEN**: its source and imports are inspected
- **THEN**: it imports both `selectTicks` and `selectLogTicks` from `@trace-kit/core` and
  contains no independently implemented nice-number or logarithmic tick-selection loop

#### Scenario: A log-axis transform is drawn with decade ticks from selectLogTicks
- **GIVEN**: a per-axis `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: the renderer computes tick values for that axis
- **THEN**: it calls `selectLogTicks`, not `selectTicks`, for that axis

#### Scenario: A linear-axis transform is drawn with selectTicks, unchanged
- **GIVEN**: a per-axis `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LINEAR`
- **WHEN**: the renderer computes tick values for that axis
- **THEN**: it calls `selectTicks`, matching the archived pre-change behavior exactly

#### Scenario: Tick values are written into a fixed-capacity preallocated buffer
- **GIVEN**: the renderer's tick storage
- **WHEN**: its allocation site is inspected
- **THEN**: the `Float64Array` used for tick values is allocated once (at construction or
  `resize`) to a fixed `MAX_TICKS` capacity, not reallocated per `render()` call, per axis

### Requirement: `drawGrid`/`drawAxes` Iterate N Transforms, One Per Registered Y Axis
`render()` MUST iterate every registered Y axis's `ViewportTransform` when painting gridlines and
axis lines/ticks/labels, in registration order, using the paint order fixed by the archived
"Axes, Grid, and Trace Share a Single Canvas and a Single Context" requirement (background,
gridlines, trace, axes) for the whole render pass — not once per axis interleaved with the trace.
Existing single-linear-axis figures (`yAxisCount === 1`, `yScaleKind === Y_SCALE_KIND_LINEAR`)
MUST produce a byte-identical call sequence to the archived pre-change behavior.

#### Scenario: Two axes each draw their own gridlines and axis labels
- **GIVEN**: a renderer configured with two registered Y axes, one log and one linear
- **WHEN**: `render()` runs
- **THEN**: the recorded call sequence includes gridline and axis-label calls attributable to
  each of the two transforms, both occurring within the single fixed background/gridlines/
  trace/axes paint order for the whole call

#### Scenario: A single linear axis produces the identical call sequence as before this change
- **GIVEN**: a renderer configured with exactly one left Y axis, `yScaleKind:
  Y_SCALE_KIND_LINEAR`
- **WHEN**: `render()` runs
- **THEN**: the recorded call sequence, method names, and arguments are identical to the archived
  pre-change single-axis call sequence for the same payload and transform

### Requirement: Decade Gridlines Are Painted for a Log Axis
When painting gridlines for an axis with `yScaleKind === Y_SCALE_KIND_LOG`, the renderer MUST
draw one gridline per tick value returned by `selectLogTicks` for that axis, projected through
that axis's `ViewportTransform` via `projectY`, using the same gridline-painting call shape as
the linear path (no separate gridline-drawing function for log axes).

#### Scenario: Gridlines for a log axis are drawn at the projected decade tick positions
- **GIVEN**: a log-axis `ViewportTransform` and its `selectLogTicks` output
- **WHEN**: gridlines are painted for that axis
- **THEN**: one gridline call occurs per returned tick value, at the device-pixel Y position
  `projectY(transform, tickValue)`

### Requirement: Formatted Tick Labels Are Cached and Recomputed Only on a Revision Bump
Label strings MUST be formatted in the renderer (not in `@trace-kit/core`) into a preallocated
`string[MAX_TICKS]` array, and MUST be recomputed only when a `tickRevision` counter changes
(domain change or axis-unit change) — never unconditionally on every `render()` call.

#### Scenario: Label formatting does not run on an unchanged tickRevision
- **GIVEN**: a renderer that has rendered once and formatted its tick labels
- **WHEN**: `render()` is called again with the domain and axis units unchanged
- **THEN**: the label-formatting routine is not invoked again on the second call

#### Scenario: A domain change bumps tickRevision and triggers reformatting
- **GIVEN**: the same renderer
- **WHEN**: `setDomain` changes the visible range and `render()` is called
- **THEN**: the label-formatting routine is invoked again, producing labels for the new tick
  values

### Requirement: `selectTicks` Introduces No Cross-Engine Non-Determinism
Because change 6's golden SVG tests compare exact tick label text across a developer machine and
CI, the tick-selection algorithm consumed here MUST NOT call `Math.log10` or `Math.pow` (per the
`viewport-transform` capability's `selectTicks` requirement), and the renderer's own label
formatting MUST produce identical output for identical input on repeated calls within the same
process.

#### Scenario: Repeated formatting of the same tick value is byte-identical
- **GIVEN**: a fixed tick value and axis-unit configuration
- **WHEN**: the label formatter is called twice with the same input
- **THEN**: both calls return the identical string
