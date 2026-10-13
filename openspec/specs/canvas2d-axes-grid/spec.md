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
yAxisCount)` MUST be implemented in the `figure-scene-layout` module and MUST compute
`insetLeft` as the sum of `yAxisCount` per-axis gutters (each `tickLength + labelGutter +
fontSizeCss`) when `axes.showLeftAxis` is true, and `0` otherwise; `insetRight` and `insetTop`
remain `0`; `insetBottom` is unchanged. `Canvas2DRenderer` MUST obtain insets only by consuming
that module on `resize` and `setDomain`; no code in `canvas2d/` MUST independently compute or
override an inset value. This single summed `insetLeft` MUST feed every one of the N
`createViewportTransform` (or `createAxisTransforms`) calls identically, per the
`multi-axis-viewport` capability's shared-plot-geometry invariant.

#### Scenario: Insets are derived only from configuration and axis count, not from data
- **GIVEN**: two payloads with different data but the same style/layout configuration and the
  same `yAxisCount`
- **WHEN**: the renderer obtains insets for each from the layout module
- **THEN**: the two inset sets are identical

#### Scenario: insetLeft scales linearly with the number of registered left axes
- **GIVEN**: a fixed style/layout configuration with `showLeftAxis: true`
- **WHEN**: `computeAxisInsets` is called once with `yAxisCount: 1` and once with `yAxisCount: 2`
- **THEN**: the `yAxisCount: 2` `insetLeft` is exactly twice the `yAxisCount: 1` `insetLeft`

#### Scenario: Insets feed every one of the N transforms identically
- **GIVEN**: a renderer with two registered left axes and a known style/layout
- **WHEN**: `resize` runs and both transforms are inspected
- **THEN**: `transform[0].plotLeft === transform[1].plotLeft === computedInsetLeft * dpr`

#### Scenario: Insets recompute on setDomain as well as resize
- **GIVEN**: a renderer with per-axis visibility that could change label width
- **WHEN**: `setDomain` changes the visible range
- **THEN**: the layout module is consulted again and every transform reflects the recomputed
  insets

#### Scenario: Zero registered left axes matches pre-existing behavior
- **GIVEN**: `yAxisCount: 0`
- **WHEN**: `computeAxisInsets` runs
- **THEN**: `insetLeft === 0`

#### Scenario: Canvas2D contains no inset computation of its own
- **GIVEN**: the sources under `packages/renderers/src/canvas2d/`
- **WHEN**: they are inspected
- **THEN**: no function computes gutter or inset arithmetic; they import it from the layout module

### Requirement: Tick Values Are Computed by Core's `selectTicks` or `selectLogTicks`, Never Duplicated in the Renderer
Tick values for a linear axis MUST be obtained by calling `selectTicks` from `@trace-kit/core`,
and for a log axis (`yScaleKind === Y_SCALE_KIND_LOG`) by calling `selectLogTicks`, selected per
axis by that axis's `ViewportTransform.yScaleKind`. The call site MUST be in the
`figure-scene-layout` module, which `Canvas2DRenderer` consumes; `canvas2d/` MUST NOT call either
selector itself. Both selectors MUST write into a preallocated `Float64Array` of fixed capacity
`MAX_TICKS`. No nice-number or logarithmic tick-selection algorithm MUST be implemented outside
core.

#### Scenario: The layout module calls core's selectors, Canvas2D does not reimplement them
- **GIVEN**: the layout module and `packages/renderers/src/canvas2d/`
- **WHEN**: their sources and imports are inspected
- **THEN**: the layout module imports `selectTicks` and `selectLogTicks` from `@trace-kit/core`,
  and no file under `canvas2d/` implements a nice-number or logarithmic tick loop

#### Scenario: A log-axis transform is drawn with decade ticks from selectLogTicks
- **GIVEN**: a per-axis `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LOG`
- **WHEN**: the renderer's layout computes tick values for that axis
- **THEN**: `selectLogTicks`, not `selectTicks`, is called for that axis

#### Scenario: A linear-axis transform is drawn with selectTicks, unchanged
- **GIVEN**: a per-axis `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LINEAR`
- **WHEN**: tick values are computed for that axis
- **THEN**: `selectTicks` is called, matching the pre-change behavior exactly

#### Scenario: Tick values are written into a fixed-capacity preallocated buffer
- **GIVEN**: the layout's tick storage
- **WHEN**: its allocation site is inspected
- **THEN**: the `Float64Array` is allocated once (at construction or `resize`) with fixed
  `MAX_TICKS` capacity, not per `render()` call, per axis

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
Label strings MUST be formatted in the `figure-scene-layout` module (not in `@trace-kit/core`) into
a preallocated `string[MAX_TICKS]` array, and MUST be recomputed only when a `tickRevision`
counter changes (domain change or axis-unit change) — never unconditionally on every `render()`
call. `Canvas2DRenderer` MUST draw the labels held by the layout result and MUST NOT format label
text itself. The formatting MUST be locale-independent (no `toLocaleString`/`Intl`), so the same
strings feed both Canvas2D and the SVG exporter.

#### Scenario: Label formatting does not run on an unchanged tickRevision
- **GIVEN**: a renderer that has rendered once and formatted its tick labels
- **WHEN**: `render()` is called again with the domain and axis units unchanged
- **THEN**: the label-formatting routine is not invoked again

#### Scenario: A domain change bumps tickRevision and triggers reformatting
- **GIVEN**: the same renderer
- **WHEN**: `setDomain` changes the visible range and `render()` is called
- **THEN**: the label-formatting routine is invoked again, producing labels for the new ticks

#### Scenario: Canvas2D and SVG draw identical label strings
- **GIVEN**: one scene rendered through `Canvas2DRenderer` (fake context) and `exportToSvg`
- **WHEN**: the `fillText` strings and the SVG `<text>` contents are compared per axis
- **THEN**: they are equal in value and order

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

## ADDED Requirements

### Requirement: Each Registered Y Axis Is Drawn in Its Own Stacked Column
`Canvas2DRenderer` MUST draw axis `i` (registration order) with `drawLeftAxis`'s `columnOffset`
equal to the layout's column offset for that axis, so the innermost axis sits at `plotLeft` and
each further axis is one per-axis gutter to its left. Axes MUST NOT overlap. With one registered
axis the output is identical to the pre-change output.

#### Scenario: Two axes are drawn in distinct columns
- **GIVEN**: two registered axes and per-axis gutter `G` CSS px at `dpr: 2`
- **WHEN**: `render()` runs
- **THEN**: the first axis line is stroked at `x = plotLeft` and the second at `x = plotLeft - 2G`,
  with each axis's tick marks and labels in its own column

#### Scenario: Single axis is unchanged
- **GIVEN**: one registered axis
- **WHEN**: `render()` runs
- **THEN**: the axis call sequence equals the pre-change sequence

### Requirement: Axis Strokes Use an Explicit Line Width
`AxisLayout` MUST gain `axisLineWidthCss` (CSS px, default `1.5`, equal to the default trace width
so default figures are unchanged). Before stroking any axis line or tick mark, `Canvas2DRenderer`
MUST set `ctx.lineWidth = axisLineWidthCss * dpr`; axis strokes MUST NOT depend on the last trace's
`lineWidth`. `exportToSvg` MUST emit the same value as `stroke-width` (CSS px).

#### Scenario: Axis width is independent of trace width
- **GIVEN**: a single trace with `lineWidthCss: 4` and default `axisLineWidthCss`, `dpr: 2`
- **WHEN**: `render()` runs
- **THEN**: `ctx.lineWidth === 3` before the first axis `stroke`
