# Capability: figure-scene-layout

> Change: `svg-vector-export` (roadmap `order: 6`). New capability.
>
> Source: `proposal.md` Problem 3, Approach 3. Extracts axis-gutter, per-axis transform, tick and
> label computation out of `packages/renderers/src/canvas2d/axes.ts` into one backend-neutral
> module that `Canvas2DRenderer` and `exportToSvg` both consume, so backends cannot drift.

## ADDED Requirements

### Requirement: Layout Is Computed Once Per Scene by One Backend-Neutral Module
A single layout module under `packages/renderers/src/` (outside `canvas2d/` and `svg/`) MUST
compute, from a scene description (CSS-px width/height, device pixel ratio, visible domain, Y-axis
registrations, style/layout configuration), a layout result containing: plot-area insets, the plot
rectangle, one `ViewportTransform` per registered Y axis, per-axis tick values, per-axis decade
gridline positions for log axes, and formatted tick labels. Both `Canvas2DRenderer` and
`exportToSvg` MUST obtain these values exclusively from this module. Neither backend MAY
independently compute an inset, tick value, gridline position or label string. The module MUST NOT
import from `canvas2d/` or `svg/` and MUST NOT reference browser globals.

#### Scenario: Both backends import the layout module
- **GIVEN**: the sources of `canvas2d/` and `svg/`
- **WHEN**: their imports are inspected
- **THEN**: both import the layout module and neither contains its own inset, tick-selection or
  label-formatting implementation

#### Scenario: The layout module has no backend or DOM dependency
- **GIVEN**: the layout module's sources
- **WHEN**: its imports and identifiers are inspected
- **THEN**: it imports no `canvas2d/` or `svg/` module and references no `document`, `window` or
  canvas type

#### Scenario: The same scene yields identical layout for both backends
- **GIVEN**: one scene description
- **WHEN**: layout is computed through the Canvas2D path and through the SVG path (at `dpr = 1`)
- **THEN**: insets, plot rectangle, tick values and label strings are equal

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
`Float64Array` of capacity `MAX_TICKS`. It MUST NOT implement its own nice-number or logarithmic
selection algorithm and MUST NOT call `Math.log10` or `Math.pow` for tick selection.

#### Scenario: Selector is chosen per axis kind
- **GIVEN**: one linear and one log axis
- **WHEN**: layout is computed
- **THEN**: `selectTicks` is called for the linear axis and `selectLogTicks` for the log axis

#### Scenario: No reimplementation
- **GIVEN**: the layout module's source
- **WHEN**: it is inspected
- **THEN**: it imports both selectors from `@trace-kit/core` and has no local tick loop

### Requirement: Decade Gridline Positions Are Computed Once and Shared
For a log axis the layout result MUST expose one gridline position per `selectLogTicks` value,
equal to `projectY(transform, tickValue)` for that axis's transform. For linear axes it MUST
expose one position per `selectTicks` value likewise. Backends MUST draw gridlines at these
positions only.

#### Scenario: Gridline positions match projection
- **GIVEN**: a log axis and its tick values
- **WHEN**: layout is computed
- **THEN**: the `i`-th gridline position equals `projectY(transform, ticks[i])` for every `i`

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

### Requirement: Extraction Changes Canvas2D Output Only by the Declared Cross-Backend Fixes
After extraction, `Canvas2DRenderer` output MUST be unchanged except for exactly three declared
fixes that align it with `exportToSvg`: (1) each registered Y axis is drawn in its own stacked
column (`canvas2d-axes-grid`), (2) axis strokes use the explicit `AxisLayout.axisLineWidthCss`
instead of inheriting the last trace's `lineWidth` (`canvas2d-axes-grid`), and (3) a single-payload
trace paints isolated-sample markers (`canvas2d-trace-rendering`). Every fake-context call-sequence
expectation not asserting one of these three behaviors MUST pass unedited. Of the committed pixel
goldens, only `dual-axis.png`, `overlay-two-axis.png` and `gapped-trace.png` MAY be regenerated
(through the CI-only update path of `visual-golden-corpus`); every other golden MUST pass without
regeneration. Any other edited expectation or golden is a defect.

#### Scenario: Unrelated call-sequence tests pass unedited
- **GIVEN**: the Canvas2D test suite as at the parent commit
- **WHEN**: it runs against the refactored renderer
- **THEN**: every test that does not assert axis column position, axis line width or single-payload
  markers passes with no expectation modified in this change's diff

#### Scenario: Only the three declared pixel goldens change
- **GIVEN**: this change's diff
- **WHEN**: the pixel golden directory is inspected
- **THEN**: the only modified images are `dual-axis.png`, `overlay-two-axis.png` and
  `gapped-trace.png`, and no image is added

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
