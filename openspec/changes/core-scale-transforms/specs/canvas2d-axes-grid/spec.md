# Capability: canvas2d-axes-grid

> Change: `core-scale-transforms` (roadmap `order: 5.6`). MODIFIED delta against the archived
> baseline at `openspec/specs/canvas2d-axes-grid/spec.md`.
>
> Source: `design.md` D5 (`computeAxisInsets`/`computeYAxisGutterOffsets` generalize to N axes;
> `packages/renderers/src/canvas2d/axes.ts`), D4 (`selectLogTicks` substituted per axis scale
> kind). Requirements not listed here (paint order, full-repaint idempotency, label-formatting
> cache) are unaffected by this change and hold verbatim from the archived baseline.

## MODIFIED Requirements

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
