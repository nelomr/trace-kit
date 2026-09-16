# Capability: canvas2d-axes-grid

> Change: `renderers-canvas2d`. New capability.
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

### Requirement: The Axis Layout Owns the Plot-Area Insets
Inset computation (left, right, top, bottom gutters in CSS pixels) MUST be a pure function of
the style/layout configuration (font size, tick length, label gutter, per-axis visibility only),
never of the data. It MUST run on `resize` and `setDomain` and MUST feed
`createViewportTransform` as its `insetLeft`/`insetRight`/`insetTop`/`insetBottom` options. No
other code path in the renderer MUST independently compute or override an inset value.

#### Scenario: Insets are derived only from configuration, not from data
- **GIVEN**: two payloads with different data but the same style/layout configuration
- **WHEN**: the renderer computes insets for each
- **THEN**: the two computed inset sets are identical

#### Scenario: Insets feed the transform's construction options directly
- **GIVEN**: a renderer configured with a known style/layout
- **WHEN**: `resize` runs and `transform` is inspected
- **THEN**: `transform.plotLeft === computedInsetLeft * dpr` (and correspondingly for the other
  three insets), matching the `viewport-transform` capability's inset-conversion requirement

#### Scenario: Insets recompute on setDomain as well as resize
- **GIVEN**: a renderer with per-axis visibility that could change formatted label width
- **WHEN**: `setDomain` changes the visible range
- **THEN**: the inset computation runs again and `transform` reflects the recomputed insets

### Requirement: Tick Values Are Computed by Core's `selectTicks`, Never Duplicated in the Renderer
The renderer MUST obtain tick values by calling `selectTicks` from `@trace-kit/core`, writing
into a preallocated `Float64Array` of fixed capacity `MAX_TICKS`, and MUST NOT implement its own
nice-number tick selection algorithm.

#### Scenario: The renderer calls core's selectTicks rather than reimplementing it
- **GIVEN**: `packages/renderers/src/canvas2d/axes.ts`
- **WHEN**: its source and imports are inspected
- **THEN**: it imports `selectTicks` from `@trace-kit/core` and contains no independently
  implemented nice-number or logarithmic tick-selection loop

#### Scenario: Tick values are written into a fixed-capacity preallocated buffer
- **GIVEN**: the renderer's tick storage
- **WHEN**: its allocation site is inspected
- **THEN**: the `Float64Array` used for tick values is allocated once (at construction or
  `resize`) to a fixed `MAX_TICKS` capacity, not reallocated per `render()` call

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
