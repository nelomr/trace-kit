# Capability: figure-scene-layout

> Change: `svg-vector-export` (roadmap `order: 6`). New capability.
>
> Source: `proposal.md` Problem 3, Approach 3. Extracts axis-gutter, per-axis transform, tick and
> label computation out of `packages/renderers/src/canvas2d/axes.ts` into one backend-neutral
> module that `Canvas2DRenderer` and `exportToSvg` both consume, so backends cannot drift.

## ADDED Requirements

### Requirement: Layout Is Computed Once Per Scene by One Backend-Neutral Module
A single layout module under `packages/renderers/src/` (outside `canvas2d/`, `svg/` and `webgl2/`)
MUST compute, from a scene description (CSS-px width/height, device pixel ratio, visible domain,
Y-axis registrations, style/layout configuration), a layout result containing: plot-area insets, the
plot rectangle, one `ViewportTransform` per registered Y axis, per-axis tick values, per-axis
decade gridline positions for log axes, X tick values and gridline positions, and formatted tick
labels. `Canvas2DRenderer`, `WebGL2FigureRenderer` (for its axes, grid and labels overlay) and
`exportToSvg` MUST obtain these values exclusively from this module. No backend MAY independently
compute an inset, tick value, gridline position or label string. The module MUST NOT import from
`canvas2d/`, `svg/` or `webgl2/` and MUST NOT reference browser globals.

#### Scenario: Every backend imports the layout module
- **GIVEN**: the sources of `canvas2d/`, `svg/` and `webgl2/`
- **WHEN**: their imports are inspected
- **THEN**: each imports the layout module and none contains its own inset, tick-selection or
  label-formatting implementation (no `selectTicks`/`selectLogTicks` call outside the layout
  module)

#### Scenario: The layout module has no backend or DOM dependency
- **GIVEN**: the layout module's sources
- **WHEN**: its imports and identifiers are inspected
- **THEN**: it imports no `canvas2d/`, `svg/` or `webgl2/` module and references no `document`,
  `window` or canvas type

#### Scenario: The same scene yields identical layout for every backend
- **GIVEN**: one scene description
- **WHEN**: layout is computed through the Canvas2D path and through the SVG path (at `dpr = 1`)
- **THEN**: insets, plot rectangle, X and Y tick values and label strings are equal

### Requirement: Insets Are a Pure Function of Configuration and Axis Count, for N Left-Stacked Axes
`computeAxisInsets(style, axes, yAxisCount)` MUST live in the layout module with the semantics
fixed by `canvas2d-axes-grid`: `insetLeft` is the sum of `yAxisCount` per-axis gutters
(`tickLength + labelGutter + fontSizeCss`) when `axes.showLeftAxis` is true and `0` otherwise;
`insetRight` and `insetTop` are `0`; `insetBottom` is unchanged. It MUST depend on nothing else
(not data, not backend).

#### Scenario: Insets ignore data
- **GIVEN**: two scenes with different payloads but identical configuration and `yAxisCount`
- **WHEN**: layout is computed
- **THEN**: both insets are equal

#### Scenario: Insets scale with the axis count
- **GIVEN**: `showLeftAxis: true`
- **WHEN**: layout is computed with `yAxisCount` `1` and `2`
- **THEN**: the second `insetLeft` is exactly twice the first

#### Scenario: Zero axes
- **GIVEN**: `yAxisCount: 0`
- **WHEN**: layout is computed
- **THEN**: `insetLeft === 0`

### Requirement: One `ViewportTransform` per Registered Axis Shares Plot Geometry
Layout MUST build one `ViewportTransform` per registered Y axis via core's
`createViewportTransform` / `createAxisTransforms`, all constructed from the identical summed
inset values (shared plot-geometry invariant of `multi-axis-viewport`), so `plotLeft`,
`plotTop`, `plotWidth` and `plotHeight` are equal across all N transforms and `yScaleKind` is
per axis.

#### Scenario: All transforms share plot geometry
- **GIVEN**: two registered axes, one linear and one log
- **WHEN**: layout is computed
- **THEN**: both transforms have equal `plotLeft`, `plotTop`, `plotWidth`, `plotHeight`, and
  their `yScaleKind` values are linear and log respectively

#### Scenario: Device scaling follows the scene dpr
- **GIVEN**: a scene with `dpr: 2` and inset-left `L` CSS px
- **WHEN**: layout is computed
- **THEN**: each transform's `plotLeft === L * 2`, and with `dpr: 1` it equals `L`

### Requirement: Tick Values Come Only From Core's `selectTicks` and `selectLogTicks`
Layout MUST obtain tick values per axis with `selectTicks` (linear) or `selectLogTicks` (log),
chosen by that axis's `ViewportTransform.yScaleKind`, writing into a preallocated
`Float64Array` of capacity `MAX_TICKS`. X ticks MUST be obtained with `selectTicks` over the
layout's X domain, which is absolute physical X (`viewport-transform`); the X tick values and
their labels therefore show absolute X, never offsets from any payload's `xOrigin`. Layout MUST NOT
implement its own nice-number or logarithmic selection algorithm and MUST NOT call `Math.log10` or
`Math.pow` for tick selection.

#### Scenario: Selector is chosen per axis kind
- **GIVEN**: one linear and one log axis
- **WHEN**: layout is computed
- **THEN**: `selectTicks` is called for the linear axis and `selectLogTicks` for the log axis

#### Scenario: No reimplementation
- **GIVEN**: the layout module's source
- **WHEN**: it is inspected
- **THEN**: it imports both selectors from `@trace-kit/core` and has no local tick loop

#### Scenario: X ticks and labels are absolute for a non-zero origin
- **GIVEN**: a scene whose payload has `xOrigin: 1550`, with the X domain `[1550, 1551]`
- **WHEN**: layout is computed
- **THEN**: every X tick value lies in `[1550, 1551]`, the first X label parses to a number
  `>= 1550`, and no X label shows a value near `0` or `1` (the offsets)

#### Scenario: X ticks do not depend on the payload origin
- **GIVEN**: two scenes with the same X domain `[0, 299]`, one holding a payload with `xOrigin: 0`
  and one holding a payload with `xOrigin: 1000`
- **WHEN**: layout is computed for both
- **THEN**: the X tick values and X label strings are equal

### Requirement: Decade Gridline Positions Are Computed Once and Shared
For a log axis the layout result MUST expose one gridline position per `selectLogTicks` value,
equal to `projectY(transform, tickValue)` for that axis's transform. For linear axes it MUST
expose one position per `selectTicks` value likewise. X gridline and tick positions MUST be the
device X of each absolute X tick value on the layout's absolute X domain, that is
`plotLeft + (tickValue - xDomainMin) * xScale`, computed so that they do not depend on the
`xOrigin` of the transform used to derive them: the position of an X tick equals the device X that
`projectX` gives, through any trace's own transform, to a sample whose `xOrigin + x[i]` equals the
tick value. Backends MUST draw gridlines at these positions only.

#### Scenario: Gridline positions match projection
- **GIVEN**: a log axis and its tick values
- **WHEN**: layout is computed
- **THEN**: the `i`-th gridline position equals `projectY(transform, ticks[i])` for every `i`

#### Scenario: An X gridline coincides with the sample at the same absolute X
- **GIVEN**: a scene with X domain `[1550, 1551]`, a trace transform with `xOrigin: 1550`, and an X
  tick at `1550.5`
- **WHEN**: layout is computed
- **THEN**: the tick's gridline position equals `projectX(traceTransform, 0.5)` within f64
  tolerance

#### Scenario: An X gridline is independent of the layout transform's origin
- **GIVEN**: two layouts of the same scene geometry and X domain `[0, 299]`, built with layout
  origins `0` and `1000`
- **WHEN**: X gridline positions are compared
- **THEN**: the position arrays are equal element by element

### Requirement: Tick Labels Are Formatted Once, Cached by `tickRevision`, and Are Locale-Independent
Label strings MUST be formatted in the layout module (not in `@trace-kit/core`) into a
preallocated `string[MAX_TICKS]` per axis and MUST be recomputed only when `tickRevision`
changes (domain or axis-unit change). The formatting MUST be a pure function of the tick value and
axis unit: no `toLocaleString`, no `Intl`, `.` as decimal separator, no host-locale dependence.
Identical input MUST yield identical strings on every platform.

#### Scenario: No reformat on unchanged revision
- **GIVEN**: a layout computed once
- **WHEN**: layout is requested again with the domain and units unchanged
- **THEN**: the formatting routine is not invoked again

#### Scenario: Domain change reformats
- **GIVEN**: the same layout
- **WHEN**: the domain changes
- **THEN**: the formatting routine runs and labels reflect the new ticks

#### Scenario: Locale does not change labels
- **GIVEN**: a host locale with `,` decimal separator
- **WHEN**: labels are formatted
- **THEN**: they are identical to those under `en-US`

### Requirement: Layout Exposes Per-Axis Column Offsets
The layout result MUST expose, for each registered Y axis `i` (registration order), a column
offset equal to `i * (tickLength + labelGutter + fontSizeCss) * dpr` device pixels, the same
per-axis gutter `computeAxisInsets` sums. Both backends MUST place axis `i`'s line at
`plotLeft - offset[i]` and its ticks and labels in that column.

#### Scenario: Offsets follow registration order
- **GIVEN**: two registered axes, gutter `G` CSS px, `dpr: 2`
- **WHEN**: layout is computed
- **THEN**: offsets are `0` and `G * 2`

### Requirement: Layout Allocates Nothing in Render Hot Paths
Layout results consumed by `Canvas2DRenderer.render()` MUST be reused across frames: layout MUST
run on `resize`, `setDomain` or axis registration changes only, and MUST NOT allocate objects,
arrays or strings inside a per-frame `render()` call at a fixed `tickRevision`.

#### Scenario: Sixty unchanged renders allocate no layout objects
- **GIVEN**: a rendered scene, under `--expose-gc` after warm-up
- **WHEN**: `render()` is called 60 times with no state change
- **THEN**: layout is computed zero additional times and no GC event is attributable to it
