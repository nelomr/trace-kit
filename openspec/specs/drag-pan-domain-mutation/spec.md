# Capability: drag-pan-domain-mutation

> Change: `viewport-interaction-controller` (Roadmap step `9.3`). Snapshot-from-`pointerdown` drift-free drag-pan math (`@trace-kit/core`), rAF-coalesced drag execution with zero per-`pointermove` allocations and zero per-`pointermove` renders, linear and logarithmic-Y decade translation, span-preserving bounds clamping, `homeDomain` reset semantics, and the allocation-free imperative programmatic API serving Change `11.5` (`keyboard-viewport-control`).

## Requirements

### Requirement: Snapshot-at-`pointerdown` Drift-Free Drag-Pan Math
`@trace-kit/core` MUST export `createPanGestureSnapshot()`, `capturePanGestureSnapshot(transform, startDeviceX, startDeviceY, out)`, and `computePanDomain(snapshot, currentDeviceX, currentDeviceY, axisMask, constraints, out)` as pure, DOM-free, zero-allocation functions.

`capturePanGestureSnapshot` MUST record `startDeviceX`, `startDeviceY`, `startXMin`, `startXMax`, `startYMin`, `startYMax`, `startPlotWidth`, `startPlotHeight`, `startYScaleKind`, `startYLogMin`, and `startYLogMax` into a preallocated `PanGestureSnapshot` once at gesture start. `computePanDomain` MUST compute every update directly from total displacement $\Delta p_x = \text{currentDeviceX} - \text{startDeviceX}$ and $\Delta p_y = \text{currentDeviceY} - \text{startDeviceY}$ (NEVER by integrating incremental frame-to-frame deltas):
- **Linear X**: when `AXIS_MASK_X` is set and `startPlotWidth > 0` and `startXMax > startXMin`:
  $$\Delta x = -\Delta p_x \cdot \frac{\text{startXMax} - \text{startXMin}}{\text{startPlotWidth}}, \qquad x'_{\min} = \text{startXMin} + \Delta x, \qquad x'_{\max} = \text{startXMax} + \Delta x$$
- **Linear Y** (`startYScaleKind === Y_SCALE_KIND_LINEAR`): when `AXIS_MASK_Y` is set and `startPlotHeight > 0` and `startYMax > startYMin`:
  $$\Delta y = +\Delta p_y \cdot \frac{\text{startYMax} - \text{startYMin}}{\text{startPlotHeight}}, \qquad y'_{\min} = \text{startYMin} + \Delta y, \qquad y'_{\max} = \text{startYMax} + \Delta y$$
- **Logarithmic Y** (`startYScaleKind === Y_SCALE_KIND_LOG`): when `AXIS_MASK_Y` is set and `startPlotHeight > 0` and `startYLogMax > startYLogMin`:
  $$\Delta L = +\Delta p_y \cdot \frac{\text{startYLogMax} - \text{startYLogMin}}{\text{startPlotHeight}}, \qquad L'_{\min} = \text{startYLogMin} + \Delta L, \qquad L'_{\max} = \text{startYLogMax} + \Delta L$$
  clamped in decade space into `[LOG_EXPONENT_MIN, LOG_EXPONENT_MAX]` (`[-300, +300]`) preserving decade span, then exponentiated ($y'_{\min} = 10^{L'_{\min}}$, $y'_{\max} = 10^{L'_{\max}}$).

#### Scenario: Dragging right and back to the start pixel produces zero cumulative drift
- **GIVEN**: a `PanGestureSnapshot` captured on `xDomain = [1550.0001, 1550.0002]`, `yDomain = [-10, 10]`, `startDeviceX = 300`, `startDeviceY = 200`
- **WHEN**: `computePanDomain` is evaluated across `200` intermediate arbitrary pointer positions and finally at `(300, 200)`
- **THEN**: the final `out` domain equals `[1550.0001, 1550.0002] x [-10, 10]` bit-for-bit (`out.xMin === 1550.0001`, `out.xMax === 1550.0002`, `out.yMin === -10`, `out.yMax === 10`)

#### Scenario: Dragging right shifts the X window left and dragging down shifts the Y window up
- **GIVEN**: a `PanGestureSnapshot` on `[0, 100] x [0, 50]` with `startPlotWidth = 400`, `startPlotHeight = 200`, `startDeviceX = 200`, `startDeviceY = 100`
- **WHEN**: `computePanDomain` runs with `currentDeviceX = 240` (`+40` px right) and `currentDeviceY = 140` (`+40` px down)
- **THEN**: `out.xMin === -10`, `out.xMax === 90` (shifted `-10` units), and `out.yMin === 10`, `out.yMax === 60` (shifted `+10` units)

#### Scenario: Logarithmic Y drag pan translates linearly in decade space and never produces yMin <= 0
- **GIVEN**: a `PanGestureSnapshot` with `yScaleKind = Y_SCALE_KIND_LOG`, `yDomain = [1, 1000]` ($3$ decades), `startPlotHeight = 300`, `startDeviceY = 150`
- **WHEN**: `computePanDomain` runs with `currentDeviceY = 250` (`+100` px down = `+1` decade) and then with `currentDeviceY = -50000` (extreme drag up)
- **THEN**: at `+100` px down `out.yMin` equals `10` and `out.yMax` equals `10000` within `1e-12` relative error; at `-50000` px `out.yMin >= 1e-300`, `out.yMax > out.yMin`, and `createViewportTransform` does not throw

### Requirement: Span-Preserving Bounds Clamping During Drag Pan
When `constraints.bounds` specifies any of `xMin`, `xMax`, `yMin`, or `yMax`, `computePanDomain` MUST clamp the translated window while preserving the current domain span (or decade span on log Y):
- If `x'Min < bounds.xMin`, slide the window to `[bounds.xMin, bounds.xMin + spanX]`.
- If `x'Max > bounds.xMax`, slide the window to `[bounds.xMax - spanX, bounds.xMax]`.
- If `spanX >= bounds.xMax - bounds.xMin`, clamp cleanly to `[bounds.xMin, bounds.xMax]`.
- Apply the exact same rule to Y (in linear units for linear Y, and in positive value / log10 decade space for log Y).

#### Scenario: Panning past bounds.xMin slides to the wall without compressing zoom level
- **GIVEN**: a snapshot on `[20, 40]` (`span = 20`) with `constraints = { bounds: { xMin: 0, xMax: 100 } }`
- **WHEN**: `computePanDomain` pans left past `xMin = 0` to raw `[-50, -30]`
- **THEN**: `out.xMin === 0` and `out.xMax === 20` (span `20` preserved intact, never collapsed to `[0, 0]`)

#### Scenario: Panning back off a clamped wall re-engages smoothly without grab-point jump
- **GIVEN**: a snapshot on `[10, 30]` with `bounds = { xMin: 0, xMax: 100 }`
- **WHEN**: the pointer drags far right (clamping to `[0, 20]`) and then returns to `startDeviceX`
- **THEN**: because displacement is computed from the `pointerdown` snapshot rather than incremental deltas, returning to `startDeviceX` restores `[10, 30]` exactly

### Requirement: rAF-Coalesced Drag Execution with Zero Per-`pointermove` Draws
During an active drag pan (primary drag inside `"plot"` when `dragMode === "pan"` without `Shift`, or primary drag inside `"x-gutter"` / `"y-gutter"` when `gutterInteraction === true`):
- `pointerdown` MUST call `controller.setGestureActive(true)`, capture the `PanGestureSnapshot` into preallocated fields, and set `interaction.state` to `"panning"`.
- `pointermove` handlers MUST ONLY update preallocated scalar fields (`#pendingDeviceX`, `#pendingDeviceY`, `#hasPendingMove = true`) and schedule at most ONE pending animation frame via the injectable `requestAnimationFrame` seam; `pointermove` MUST NEVER call `controller.setDomain(...)` or `controller.render()` synchronously.
- When the animation frame fires, the controller MUST compute the mutated domain into `#scratchDomain`, call `controller.setDomain(...)`, invoke the optional `phase: "gesture"` invalidation hook, and call `controller.requestRender()`.
- On `pointerup`, the controller MUST flush any unapplied pending pointermove displacement once, invoke the `phase: "settled"` invalidation hook, set `interaction.state` to `"idle"`, call `controller.setGestureActive(false)`, and call `controller.requestRender()`.
- Dragging inside `"x-gutter"` (with `gutterInteraction === true`) MUST pan X-only (`AXIS_MASK_X`); dragging inside `"y-gutter"` MUST pan Y-only (`AXIS_MASK_Y`).

#### Scenario: 20 rapid pointermove events within one frame produce zero synchronous renders and at most one setDomain call per rAF
- **GIVEN**: a `ViewportInteractionController` with an injectable manual `requestAnimationFrame` queue and spied `controller.setDomain` / `controller.render`
- **WHEN**: `pointerdown` fires inside `"plot"`, followed by `20` `pointermove` events before any rAF callback executes
- **THEN**: `controller.setDomain` call count is `0` and `controller.render` call count is `0` prior to rAF execution, and flushing the single queued rAF executes `controller.setDomain` exactly once at the latest pointer position

#### Scenario: Axis-gutter drag restricts pan to the corresponding single axis
- **GIVEN**: a mounted `ViewportInteractionController` on `[0, 100] x [0, 50]` with `gutterInteraction: true`
- **WHEN**: a diagonal drag (`dx = +40`, `dy = +40`) starts inside `"x-gutter"` and completes on `pointerup`
- **THEN**: `controller.domain.xMin` and `xMax` shift while `controller.domain.yMin === 0` and `yMax === 50` remain strictly unchanged

### Requirement: `homeDomain` Tracking and Double-Click / Programmatic Reset
`ViewportInteractionController` MUST maintain a readonly `homeDomain: ViewportDomain`:
- On construction, if `options.homeDomain` is supplied, `homeDomain` MUST be initialized from it (validating all four bounds are finite); otherwise `homeDomain` MUST be auto-captured from `controller.domain` at attach time.
- `setHomeDomain(xMin, xMax, yMin, yMax)` MUST validate that all four bounds are finite (throwing `RangeError` if any bound is non-finite) and update `homeDomain`, except after `dispose()` when it MUST be a safe no-op.
- `resetDomain()` MUST cancel any active gesture, apply `homeDomain` via `controller.setDomain(...)` (subject to valid finite bounds), fire `onInvalidate` with `phase: "settled"` and `reason: "reset"`, fire `onDomainChange`, ensure `controller.setGestureActive(false)`, and call `controller.requestRender()`.
- When `doubleClickReset` is `true` (default) and `enabled` is `true`, a `dblclick` event landing inside `"plot"` MUST invoke `resetDomain()`. When `doubleClickReset` is `false` or the `dblclick` lands in `"outside"`, it MUST be a no-op.

#### Scenario: Double-click inside plot restores homeDomain and fires settled reset invalidation
- **GIVEN**: a `ViewportInteractionController` attached with initial domain `[0, 100] x [-10, 10]`, subsequently panned and zoomed to `[25, 45] x [-2, 4]`
- **WHEN**: a `dblclick` event is dispatched inside `"plot"`
- **THEN**: `controller.domain` is restored to `[0, 100] x [-10, 10]`, `onInvalidate` fires with `{ phase: "settled", reason: "reset" }`, and `controller.requestRender()` is scheduled

#### Scenario: setHomeDomain updates the target restored by resetDomain
- **GIVEN**: a mounted `ViewportInteractionController`
- **WHEN**: `interaction.setHomeDomain(1540, 1560, -80, 0)` is called, the user zooms to `[1549, 1551]`, and `interaction.resetDomain()` is called
- **THEN**: `controller.domain` becomes `[1540, 1560] x [-80, 0]`

### Requirement: Imperative Programmatic Viewport API (Change `11.5` Seam)
`ViewportInteractionController` MUST expose readonly inspection state and allocation-free imperative methods sharing the exact same `@trace-kit/core` float64/log clamp math and settled invalidation pipeline:
- Readonly properties: `state: InteractionGestureState`, `dragMode: InteractionDragMode`, `enabled: boolean`, `disposed: boolean`, `homeDomain: ViewportDomain`.
- `zoomByFactor(factorX: number, factorY: number, normX?: number, normY?: number): boolean` — zooms around normalized plot coordinates `(normX ?? 0.5, normY ?? 0.5)` (`normX in [0, 1]` left-to-right, `normY in [0, 1]` bottom-to-top) using `computeZoomDomain`, applying both linear and log-Y rules and `constraints`. Commits domain, fires `phase: "settled"` invalidation with `reason: "programmatic"`, schedules `controller.requestRender()`, and returns `true` iff the domain changed.
- `panByFraction(fractionX: number, fractionY: number): boolean` — translates the current domain by `fractionX * xSpan` on X and `fractionY * ySpan` on linear Y (or `fractionY * logDecadeSpan` on log Y), clamped with span-preserving `constraints.bounds`. Commits domain, fires `phase: "settled"` invalidation with `reason: "programmatic"`, schedules `controller.requestRender()`, and returns `true` iff the domain changed.
- `commitBoxDomain(xMin: number, xMax: number, yMin: number, yMax: number): boolean` — clamps the requested box domain via `clampViewportDomain`, commits it, fires `phase: "settled"` invalidation with `reason: "box-zoom"`, schedules `controller.requestRender()`, and returns `true` iff valid and applied.
- `setDragMode(mode: InteractionDragMode): void` — switches default primary drag behavior between `"pan"` and `"box-zoom"`.
- `setEnabled(enabled: boolean): void` — toggles pointer/wheel/dblclick handling; setting `false` cancels any active gesture cleanly.
- `cancelGesture(): void` — aborts any active gesture immediately, releasing `gestureActive` and hiding any box overlay.
- `dispose(): void` — terminal and idempotent; every imperative method after `dispose()` MUST be a safe no-op returning `false` (for boolean methods) and never throwing.

#### Scenario: zoomByFactor and panByFraction apply identical log-Y and bounds clamping as pointer gestures
- **GIVEN**: a `ViewportInteractionController` over a single-axis `Y_SCALE_KIND_LOG` figure with domain `[0, 100] x [1, 1000]` and `constraints = { bounds: { xMin: 0, xMax: 100 } }`
- **WHEN**: `interaction.zoomByFactor(0.5, 0.5, 0.5, 0.5)` is called, followed by `interaction.panByFraction(-2, 1/3)`
- **THEN**: after `zoomByFactor`, domain is `[25, 75] x [10 ** 0.75, 10 ** 2.25]`; after `panByFraction(-2, 1/3)`, X clamps with preserved span `50` to `[0, 50]` and Y shifts upward by `+0.5` decades (one-third of its `1.5`-decade span) with `yMin > 0`, and each call fires a `phase: "settled"`, `reason: "programmatic"` invalidation

#### Scenario: Imperative methods after dispose are safe no-ops
- **GIVEN**: a disposed `ViewportInteractionController`
- **WHEN**: `zoomByFactor(0.5, 0.5)`, `panByFraction(0.1, 0)`, `commitBoxDomain(0, 10, 0, 10)`, `resetDomain()`, `setDragMode("box-zoom")`, `setEnabled(true)`, `cancelGesture()`, and `dispose()` are called
- **THEN**: none throws, boolean methods return `false`, and `controller.setDomain` is not called
