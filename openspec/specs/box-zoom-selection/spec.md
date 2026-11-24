# Capability: box-zoom-selection

> Change: `viewport-interaction-controller` (Roadmap step `9.3`). Explicit 5-state machine (`idle` / `pending` / `active` / `committed` / `cancelled`) aligned with Change `13.3` (`range-selection-events`), pure 4-quadrant plot-clamped box domain calculation (`@trace-kit/core`), single reusable sibling `<div data-trace-kit-overlay="box-zoom">` preserving `SpectrumEngineController` DOM z-order across 1-canvas $\leftrightarrow$ 3-canvas swaps and updated exclusively via CSS `transform: translate3d(...)` + `width`/`height` with zero canvas repaints during drag.

## Requirements

### Requirement: Pure 4-Quadrant Plot-Clamped Box-Zoom Domain Calculation
`@trace-kit/core` MUST export `computeBoxZoomDomain(transform, startDeviceX, startDeviceY, endDeviceX, endDeviceY, axisMask, constraints, out)` as a pure, DOM-free, zero-allocation function writing the resulting domain into `out: MutableViewportDomain` and returning `true` iff a valid box domain was produced:
- Both corners `(startDeviceX, startDeviceY)` and `(endDeviceX, endDeviceY)` MUST be clamped into the plot rectangle `[plotLeft, plotLeft + plotWidth] x [plotTop, plotTop + plotHeight]`.
- Coordinates MUST be sorted regardless of drag direction (all 4 quadrants: top-left to bottom-right, bottom-right to top-left, top-right to bottom-left, bottom-left to top-right):
  - `leftPx = Math.min(clampedStartX, clampedEndX)`, `rightPx = Math.max(clampedStartX, clampedEndX)`
  - `topPx = Math.min(clampedStartY, clampedEndY)`, `bottomPx = Math.max(clampedStartY, clampedEndY)`
- Unproject via `unprojectX(transform, leftPx)` / `unprojectX(transform, rightPx)` for X when `AXIS_MASK_X` is set, and `unprojectY(transform, bottomPx)` (lower data Y) / `unprojectY(transform, topPx)` (upper data Y) for Y when `AXIS_MASK_Y` is set (automatically handling both `Y_SCALE_KIND_LINEAR` and `Y_SCALE_KIND_LOG`).
- If an enabled axis has zero clamped pixel extent (`rightPx <= leftPx` for X, or `bottomPx <= topPx` for Y), `computeBoxZoomDomain` MUST return `false` without mutating `out` to an inverted or zero-span domain.
- Apply `clampViewportDomain(out, transform.yScaleKind, constraints, false)` so float64 ULP span floor, log-Y positivity/exponent bounds, and caller `constraints` always hold.

#### Scenario: All four drag quadrants produce the identical sorted domain
- **GIVEN**: a `ViewportTransform` over `[0, 100] x [0, 50]` with `plotLeft = 0`, `plotTop = 0`, `plotWidth = 400`, `plotHeight = 200`
- **WHEN**: `computeBoxZoomDomain` is called for the four diagonal corners of `[100..300] x [50..150]`: `(100,50)->(300,150)`, `(300,150)->(100,50)`, `(300,50)->(100,150)`, and `(100,150)->(300,50)`
- **THEN**: all four calls return `true` and write the identical domain `xMin = 25`, `xMax = 75`, `yMin = 12.5`, `yMax = 37.5`

#### Scenario: Out-of-plot drag end coordinates clamp to the plot boundary
- **GIVEN**: a `ViewportTransform` over `[0, 100] x [1, 1000]` (`Y_SCALE_KIND_LOG`) with `plotLeft = 50`, `plotTop = 20`, `plotWidth = 400`, `plotHeight = 300`
- **WHEN**: `computeBoxZoomDomain` runs from `(250, 170)` to `(999, -100)` (outside right and top edges)
- **THEN**: the end corner clamps to `(450, 20)`, producing `xMin = 50`, `xMax = 100`, `yMin = Math.sqrt(1000)` (`10 ** 1.5`), and `yMax = 1000`, with `yMin > 0`

### Requirement: Explicit 5-State Box-Zoom State Machine (Change `13.3` Seam)
Box-zoom selection MUST be driven by an explicit 5-state machine with `BoxZoomState = "idle" | "pending" | "active" | "committed" | "cancelled"`, engaged whenever a primary `pointerdown` lands inside `"plot"` and either `dragMode === "box-zoom"` or `event.shiftKey === true`:
1. `"idle" -> "pending"`: on qualifying `pointerdown` inside `"plot"`; calls `controller.setGestureActive(true)`, records start coordinates, keeps the overlay hidden (`display: none`), sets `interaction.state = "box-pending"`.
2. `"pending" -> "active"`: on `pointermove` once pointer displacement exceeds `minBoxSizeCss` (default `4` CSS px: `Math.max(Math.abs(dxCss), Math.abs(dyCss)) >= minBoxSizeCss`); shows the overlay (`display: block`) and sets `interaction.state = "box-active"`.
3. `"pending" -> "cancelled" -> "idle"`: on `pointerup` before exceeding `minBoxSizeCss` (accidental click), without mutating `controller.domain`.
4. `"active" -> "committed" -> "idle"`: on `pointerup` when `computeBoxZoomDomain` produces a valid domain; hides the overlay, commits `controller.setDomain(...)`, invokes optional `onBoxSelect(event)`, triggers settled invalidation (`reason: "box-zoom"`), flips `controller.setGestureActive(false)`, and schedules `controller.requestRender()`. (If `computeBoxZoomDomain` returns `false`, transitions through `"cancelled" -> "idle"` instead.)
5. `"pending" | "active" -> "cancelled" -> "idle"`: on `Escape` `keydown`, `pointercancel`, `lostpointercapture`, `cancelGesture()`, `setEnabled(false)`, or `dispose()`; hides the overlay, leaves `controller.domain` unchanged, and flips `controller.setGestureActive(false)`.

Every state transition MUST invoke the optional `onGestureStateChange(event)` callback in exact transition order so Change `13.3` (`range-selection-events`) can observe and reuse the state machine cleanly.

#### Scenario: Shift+drag sweep transitions through idle -> pending -> active -> committed -> idle
- **GIVEN**: a `ViewportInteractionController` (default `dragMode: "pan"`) recording `onGestureStateChange` and `onBoxSelect` events
- **WHEN**: `pointerdown` (`shiftKey: true`) fires at `(150, 80)`, `pointermove` moves `2` px to `(152, 81)` (sub-threshold), `pointermove` moves to `(350, 180)` (exceeds `minBoxSizeCss = 4`), and `pointerup` releases at `(350, 180)`
- **THEN**: recorded `boxState` transitions follow `["pending", "active", "committed", "idle"]`, `onBoxSelect` fires once with the committed domain, `controller.domain` updates to the unprojected box domain, and `controller.gestureActive` returns to `false`

#### Scenario: Sub-threshold click cancels without mutating domain
- **GIVEN**: a `ViewportInteractionController` with `dragMode: "box-zoom"` and `minBoxSizeCss: 4` on domain `[0, 100] x [0, 50]`
- **WHEN**: `pointerdown` fires at `(200, 100)`, `pointermove` moves to `(202, 101)`, and `pointerup` fires at `(202, 101)`
- **THEN**: `boxState` transitions `["pending", "cancelled", "idle"]`, `onBoxSelect` is NOT called, `controller.domain` remains `[0, 100] x [0, 50]`, and `controller.gestureActive` is `false`

#### Scenario: Pressing Escape mid-sweep cancels the active box-zoom cleanly
- **GIVEN**: a `ViewportInteractionController` in `"box-active"` state with the overlay visible (`display: block`)
- **WHEN**: a `keydown` event with `key: "Escape"` is dispatched
- **THEN**: `boxState` transitions to `"cancelled"` then `"idle"`, the overlay hides (`display: none`), `controller.domain` is unchanged, `controller.gestureActive` becomes `false`, and a subsequent `pointerup` is a no-op

### Requirement: Single Reusable CSS-Composited Sibling Overlay with Zero Canvas Repaints During Drag
On attach, `ViewportInteractionController` MUST append exactly one reusable sibling `<div data-trace-kit-overlay="box-zoom">` directly to `controller.container` with initial `happy-dom`-compatible inline styles:
- `position: absolute`
- `left: 0`
- `top: 0`
- `pointer-events: none`
- `will-change: transform`
- `display: none`
- `box-sizing: border-box`

(The controller MUST use explicit `left: 0` and `top: 0` rather than shorthand `inset: 0`.)

Because `SpectrumEngineController` mounts and swaps managed `<canvas>` elements before existing children (`insertBefore`), `<div data-trace-kit-overlay="box-zoom">` MUST remain positioned after all managed `<canvas>` elements in DOM order across both `canvas2d` (`1` canvas) and `webgl2` (`3` canvases) topologies.

During an active box-zoom sweep (`"box-active"`):
- The overlay's visual geometry MUST be updated exclusively via `style.transform = "translate3d(" + xCss + "px, " + yCss + "px, 0)"`, `style.width = wCss + "px"`, `style.height = hCss + "px"`, and `style.display = "block"`, clamped visually to the plot area CSS bounds.
- Sweeping the box-zoom rectangle MUST issue **zero** calls to `controller.render()`, `controller.requestRender()`, or `controller.setDomain(...)` until `pointerup` commits the selection.
- On `dispose()`, `<div data-trace-kit-overlay="box-zoom">` MUST be removed from `controller.container`.

#### Scenario: Box-zoom sweep updates transform: translate3d without repainting the canvas
- **GIVEN**: a `ViewportInteractionController` with `dragMode: "box-zoom"` and spied `controller.render`, `controller.requestRender`, and `controller.setDomain`
- **WHEN**: `pointerdown` fires inside `"plot"` and `30` consecutive `pointermove` events sweep across the plot area
- **THEN**: `div[data-trace-kit-overlay="box-zoom"]` has `style.display === "block"`, `style.transform` matching `translate3d(...px, ...px, 0)`, positive `style.width` and `style.height`, and call counts for `controller.render`, `controller.requestRender`, and `controller.setDomain` are all `0` until `pointerup`

#### Scenario: Overlay stays after managed canvases across engine swaps and is removed on dispose
- **GIVEN**: a `ViewportInteractionController` attached to a `SpectrumEngineController`
- **WHEN**: the controller switches `canvas2d -> webgl2 -> canvas2d` and finally `interaction.dispose()` runs
- **THEN**: throughout both `1`-canvas and `3`-canvas topologies, `container.querySelectorAll('[data-trace-kit-overlay="box-zoom"]').length === 1` and its DOM index is strictly greater than every managed `<canvas>` element; after `dispose()`, `container.querySelector('[data-trace-kit-overlay="box-zoom"]')` is `null`
