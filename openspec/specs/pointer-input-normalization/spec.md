# Capability: pointer-input-normalization

> Change: `viewport-interaction-controller` (Roadmap step `9.3`). Framework- and device-agnostic W3C Pointer Events and `WheelEvent` normalization attached to `SpectrumEngineController.container`, including reflow-free CSS-to-device coordinate mapping, plot vs. axis-gutter hit-testing, guarded pointer capture, 2-slot scalar pointer tracking, cross-browser wheel normalization, selective `preventDefault()`, `touch-action` restoration, and symmetric abnormal-termination cleanup.

## Requirements

### Requirement: Listeners Attach Exclusively to `controller.container` and Survive Engine Swaps
`createViewportInteractionController` MUST register all pointer, wheel, and double-click DOM listeners (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `lostpointercapture`, `wheel` with `{ passive: false }`, and `dblclick`) directly on `controller.container` and NEVER on any managed `<canvas>` child element. Active-gesture `Escape` cancellation (`keydown`) MUST be listened to on `container.ownerDocument` (or `container` when `ownerDocument` is unavailable) only while a gesture is active or attached cleanly and removed on `dispose()`. Because `SpectrumEngineController` mounts and swaps 1-canvas (`Canvas2DRenderer`) and 3-canvas (`WebGL2FigureRenderer`) stacks inside `controller.container` without replacing `controller.container`, every input listener MUST remain active across any number of engine switches with zero re-registration.

#### Scenario: Drag and wheel interactions continue working after a 1-canvas to 3-canvas engine swap
- **GIVEN**: a `ViewportInteractionController` attached to a `SpectrumEngineController` initially on `canvas2d` (`1` canvas)
- **WHEN**: the engine swaps to `webgl2` (`3` canvases) via `controller.setMode("webgl2")` and `controller.render()`, and a `wheel` event followed by a `pointerdown`/`pointermove`/`pointerup` sequence is dispatched on `controller.container`
- **THEN**: both the wheel zoom and drag pan mutate `controller.domain` normally without re-creating or re-attaching `ViewportInteractionController`

#### Scenario: Listener registration and removal are strictly balanced on dispose
- **GIVEN**: a `controller.container` whose `addEventListener` and `removeEventListener` calls are counted
- **WHEN**: `createViewportInteractionController({ controller })` is constructed and then `dispose()` is called twice
- **THEN**: after the first `dispose()`, every listener registered during construction has been removed once (`removeCount === addCount`), and the second `dispose()` call is an idempotent no-op that throws nothing and performs no additional removals

### Requirement: `touch-action: none` Save-and-Restore Lifecycle
When `manageTouchAction` is `true` (the default), attaching `ViewportInteractionController` MUST record the container's prior inline `container.style.touchAction` value, set `container.style.touchAction = "none"`, and restore the exact prior inline value on `dispose()`. When `manageTouchAction` is `false`, the controller MUST NOT modify `container.style.touchAction` on attach or `dispose()`.

#### Scenario: Existing inline touchAction is saved on attach and restored on dispose
- **GIVEN**: a `controller.container` with `container.style.touchAction = "pan-y"`
- **WHEN**: `createViewportInteractionController({ controller })` attaches and later `dispose()` is called
- **THEN**: `container.style.touchAction` equals `"none"` while attached and is restored to `"pan-y"` after `dispose()`

#### Scenario: manageTouchAction false leaves container style untouched
- **GIVEN**: a `controller.container` with `container.style.touchAction = "manipulation"`
- **WHEN**: `createViewportInteractionController({ controller, manageTouchAction: false })` attaches and later `dispose()` is called
- **THEN**: `container.style.touchAction` remains `"manipulation"` throughout attachment and after `dispose()`

### Requirement: Reflow-Free CSS-to-Device Coordinate Mapping with Headless Fallback
The input normalizer MUST map client pointer/wheel coordinates `(clientX, clientY)` to device pixels `(deviceX, deviceY)` against `controller.transform` (`t`) using:
- `cssX = event.clientX - rect.left`, `cssY = event.clientY - rect.top`
- If `rect.width > 0`: `deviceX = (cssX / rect.width) * t.deviceWidth`; otherwise (e.g., `0 x 0` layout box in `happy-dom` or headless DOM): `deviceX = cssX * t.dpr`
- If `rect.height > 0`: `deviceY = (cssY / rect.height) * t.deviceHeight`; otherwise: `deviceY = cssY * t.dpr`

The controller MUST cache `container.getBoundingClientRect()` on `pointerdown` (and refresh on `wheel`, `dblclick`, or whenever `controller.width` or `controller.height` changes) and MUST NOT invoke `container.getBoundingClientRect()` inside `pointermove` event handlers.

#### Scenario: High-frequency pointermove burst performs zero getBoundingClientRect layout reads
- **GIVEN**: a mounted `ViewportInteractionController` whose `container.getBoundingClientRect` is spied upon and returns `{ left: 20, top: 10, width: 400, height: 200 }`
- **WHEN**: `pointerdown` fires once followed by `50` consecutive `pointermove` events and `pointerup`
- **THEN**: `getBoundingClientRect` is called at most once (on `pointerdown`) and `0` times across all `50` `pointermove` events

#### Scenario: Non-zero rect scales fractional DPR and CSS-scaled containers accurately
- **GIVEN**: a container rect `{ left: 100, top: 50, width: 400, height: 200 }` and a `ViewportTransform` with `deviceWidth = 600`, `deviceHeight = 300`, `dpr = 1.5`
- **WHEN**: an event arrives at `clientX = 300`, `clientY = 150`
- **THEN**: the normalized device coordinates equal `deviceX = 300` and `deviceY = 150`

#### Scenario: Zero-sized headless rect falls back cleanly to css * dpr
- **GIVEN**: a `happy-dom` container whose `getBoundingClientRect()` returns `{ left: 0, top: 0, width: 0, height: 0 }` and a `ViewportTransform` with `dpr = 2`
- **WHEN**: an event arrives at `clientX = 120`, `clientY = 80`
- **THEN**: the normalized device coordinates equal `deviceX = 240` and `deviceY = 160` with no `NaN` or `Infinity`

### Requirement: Plot-Interior vs. Axis-Gutter Hit-Testing
`classifyPointerRegion(transform, deviceX, deviceY)` MUST partition device-pixel coordinates into four mutually disjoint regions of type `PointerRegion = "plot" | "x-gutter" | "y-gutter" | "outside"`:
1. `"plot"`: `isInsidePlotArea(transform, deviceX, deviceY)` is `true` (`plotLeft <= deviceX <= plotLeft + plotWidth` and `plotTop <= deviceY <= plotTop + plotHeight`).
2. `"x-gutter"`: `deviceY > plotTop + plotHeight` and `deviceY <= deviceHeight` and `plotLeft <= deviceX <= plotLeft + plotWidth`.
3. `"y-gutter"`: `deviceX >= 0` and `deviceX < plotLeft` and `plotTop <= deviceY <= plotTop + plotHeight`.
4. `"outside"`: all remaining coordinates (including the bottom-left corner intersection `deviceX < plotLeft && deviceY > plotTop + plotHeight`, top/right margins outside the plot, or negative/out-of-bounds coordinates).

Events classified as `"outside"` MUST be ignored: they MUST NOT start a drag, MUST NOT mutate the domain, and MUST NOT call `event.preventDefault()`.

#### Scenario: Coordinates in each of the four regions classify unambiguously
- **GIVEN**: a `ViewportTransform` with `deviceWidth = 800`, `deviceHeight = 400`, `plotLeft = 80`, `plotTop = 20`, `plotWidth = 700`, `plotHeight = 330`
- **WHEN**: `classifyPointerRegion` is evaluated at `(400, 180)`, `(400, 370)`, `(40, 180)`, `(40, 370)`, and `(790, 180)`
- **THEN**: the results are `"plot"`, `"x-gutter"`, `"y-gutter"`, `"outside"`, and `"outside"` respectively

#### Scenario: Events in the outside region neither start a gesture nor call preventDefault
- **GIVEN**: a mounted `ViewportInteractionController`
- **WHEN**: a `pointerdown` and a cancelable `wheel` event are dispatched in the bottom-left corner (`"outside"`)
- **THEN**: `controller.gestureActive` remains `false`, `controller.domain` is unchanged, and `wheelEvent.defaultPrevented` is `false`

### Requirement: Guarded Pointer Capture and 2-Slot Scalar Pointer Tracking
The controller MUST guard calls to `container.setPointerCapture(pointerId)` and `container.releasePointerCapture(pointerId)` with feature checks and `try/catch` so synthetic `PointerEvent` dispatches in `happy-dom` or headless harnesses (where `setPointerCapture` may be absent or throw `NotFoundError`) never throw an uncaught exception.

Active pointers MUST be tracked strictly in two preallocated scalar pointer slots (`#p1Id`, `#p1X`, `#p1Y` and `#p2Id`, `#p2X`, `#p2Y`) with NO `Map`, `Set`, array, or per-pointer object allocations:
- Only primary-button drags (`event.button === 0` for mouse, or any touch/pen contact) may initiate a pointer gesture; secondary/context-menu mouse clicks (`event.button !== 0`) MUST be ignored.
- When 1 pointer is active in an interactive region, the gesture enters pan or box-zoom mode.
- When a 2nd pointer lands while 1 pointer is active (e.g., two-finger touch pinch), the controller MUST transition seamlessly to 2-pointer pinch-to-zoom anchored at the midpoint of the two pointers, scaling proportionally to the ratio of current inter-pointer distance to previous/snapshot distance (with zero division when distance is `0`).
- Any 3rd or subsequent simultaneous pointer (`pointerId` matching neither slot) MUST be ignored cleanly without corrupting the 2 active slots.

#### Scenario: Missing or throwing setPointerCapture never breaks synthetic drag gestures
- **GIVEN**: a `controller.container` whose `setPointerCapture` throws `DOMException("No active pointer", "NotFoundError")`
- **WHEN**: a synthetic `pointerdown`, `pointermove`, `pointerup` drag sequence is dispatched on `controller.container`
- **THEN**: no exception is thrown and the drag pan completes and mutates `controller.domain` normally

#### Scenario: Secondary mouse button click is ignored
- **GIVEN**: a mounted `ViewportInteractionController`
- **WHEN**: a `pointerdown` with `pointerType: "mouse"` and `button: 2` is dispatched inside the plot area
- **THEN**: `controller.gestureActive` stays `false` and `interaction.state` stays `"idle"`

#### Scenario: Two-finger touch pinch zooms around midpoint while a 3rd pointer is ignored
- **GIVEN**: a mounted `ViewportInteractionController` on a linear domain `[0, 100] x [0, 100]`
- **WHEN**: touch pointer `1` presses at `(200, 200)`, touch pointer `2` presses at `(400, 200)` (initial distance `200`, midpoint `(300, 200)`), touch pointer `3` presses at `(500, 200)`, and pointer `1` moves to `(100, 200)` and pointer `2` moves to `(500, 200)` (distance doubles to `400`, same midpoint `(300, 200)`) followed by an animation frame flush
- **THEN**: pointer `3` is ignored, the visible span halves around the physical coordinate at device pixel `(300, 200)` (pinch-out zooms in by `2x`), and releasing both pointers ends the pinch and clears `controller.gestureActive` to `false`

### Requirement: Cross-Browser `WheelEvent` Normalization and Selective `preventDefault()`
`normalizeWheelDeltaPx(deltaX, deltaY, deltaMode, shiftKey, pageHeightCss)` MUST normalize browser wheel inputs deterministically:
1. Dominant-axis selection: when `shiftKey === true`, select `Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX` (compensating for macOS remapping vertical `Shift + Wheel` onto `deltaX` with `deltaY === 0`); when `shiftKey === false`, read `deltaY`.
2. Unit conversion by `deltaMode`:
   - `0` (`DOM_DELTA_PIXEL`): raw value (`* 1`).
   - `1` (`DOM_DELTA_LINE`): multiply by `DEFAULT_WHEEL_LINE_HEIGHT_PX` (`32`).
   - `2` (`DOM_DELTA_PAGE`): multiply by `pageHeightCss > 0 && Number.isFinite(pageHeightCss) ? pageHeightCss : DEFAULT_WHEEL_PAGE_FALLBACK_PX` (`800`).
3. Per-event clamping: clamp the resulting CSS pixel delta to `[-MAX_WHEEL_DELTA_PX, +MAX_WHEEL_DELTA_PX]` (`[-400, +400]`), returning `0` for non-finite inputs.

When a `wheel` event lands in an interactive region (`"plot"`, `"x-gutter"`, or `"y-gutter"`) while the controller is `enabled` and not `disposed`:
- The controller MUST call `event.preventDefault()` (including when `event.ctrlKey === true` for trackpad pinch-to-zoom, preventing browser full-page zoom).
- When `event.ctrlKey === true`, the controller MUST use `pinchSensitivity` (default `wheelSensitivity * 4`) instead of `wheelSensitivity`.
- When the controller is disabled (`enabled === false`) or the event lands in `"outside"`, the controller MUST NOT call `event.preventDefault()`.

#### Scenario: DOM_DELTA_LINE and DOM_DELTA_PAGE normalize consistently and clamp spikes
- **GIVEN**: `pageHeightCss = 500`
- **WHEN**: `normalizeWheelDeltaPx` is called with `(0, 3, 1, false, 500)`, `(0, 1, 2, false, 500)`, and `(0, -900, 0, false, 500)`
- **THEN**: the results are `96`, `400` (clamped from `500` to `MAX_WHEEL_DELTA_PX`), and `-400` (clamped from `-900` to `-MAX_WHEEL_DELTA_PX`)

#### Scenario: macOS Shift + Wheel deltaX remap is preserved instead of reading zero
- **GIVEN**: a `wheel` event with `shiftKey: true`, `deltaX: -120`, `deltaY: 0`, `deltaMode: 0` inside `"plot"`
- **WHEN**: `normalizeWheelDeltaPx(-120, 0, 0, true, 400)` executes
- **THEN**: it returns `-120` (not `0`), and the wheel zoom zooms the Y axis only

#### Scenario: Trackpad pinch with ctrlKey prevents default page zoom and applies pinchSensitivity
- **GIVEN**: a mounted `ViewportInteractionController` with `wheelSensitivity: 0.001` and `pinchSensitivity: 0.004`
- **WHEN**: a cancelable `wheel` event with `ctrlKey: true`, `deltaY: -10`, `deltaMode: 0` is dispatched inside `"plot"`
- **THEN**: `event.defaultPrevented` is `true` and the resulting zoom factor matches `Math.exp(-10 * 0.004)` rather than `Math.exp(-10 * 0.001)`

### Requirement: Symmetric Cleanup on Abnormal Termination
Every abnormal exit path — `pointercancel`, `lostpointercapture`, active-gesture `Escape`, `cancelGesture()`, `setEnabled(false)`, and `dispose()` — MUST execute the unified gesture teardown path that unconditionally:
- clears both scalar pointer slots,
- cancels any pending animation-frame callback and wheel settle debounce timer,
- hides any visible box-zoom overlay,
- transitions `interaction.state` to `"idle"`, and
- resets `controller.setGestureActive(false)` so deferred engine hysteresis swaps can never starve.

#### Scenario: pointercancel and lostpointercapture release gestureActive and clear pointer slots
- **GIVEN**: a `ViewportInteractionController` mid-drag (`controller.gestureActive === true`, `interaction.state === "panning"`)
- **WHEN**: `pointercancel` (or `lostpointercapture`) is dispatched on `controller.container`
- **THEN**: `controller.gestureActive` becomes `false`, `interaction.state` becomes `"idle"`, and a subsequent `pointermove` without a new `pointerdown` does not mutate `controller.domain`
