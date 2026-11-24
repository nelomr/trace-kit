# Capability: playground-engine-controller-view

## Requirements

### Requirement: Interactive Hysteresis Traversal, Mode Pinning, Gesture Lock, and Fallback Simulation
The `/engine-controller` view in `apps/playground` MUST mount a `SpectrumEngineController` over a dedicated figure stage container (`div[data-role="controller-stage"]`) using a preallocated `Retained` `SpectrumDataPayload` (up to `250,000` samples) without wrapping any payload or typed array in a reactive proxy. The view MUST provide interactive controls (`data-action` attributes) allowing the user to:
1. Adjust the total sample count $N$ via a continuous range slider (`data-action="sample-count-slider"`) and preset buttons covering all three hysteresis zones: below `downThreshold` (`10,000`, `50,000`, `64,000`), inside the deadband (`72,000`), and at or above `upThreshold` (`80,000`, `150,000`, `250,000`).
2. Switch `mode` between `"auto"`, `"canvas2d"`, and `"webgl2"` (`data-action="mode-select"`).
3. Toggle `gestureActive` (`data-action="gesture-toggle"`, calling `controller.setGestureActive(!controller.gestureActive)`) to demonstrate mid-gesture switch deferral and flush on release.
4. Select `decimation` (`data-action="decimation-select"`: `"default"` / `undefined` backend default, `"lttb"`, or `"min-max"`).
5. Toggle simulated WebGL2 context acquisition failure (`data-action="simulate-webgl2-failure"`) to demonstrate zero-crash fallback to `Canvas2DRenderer` and recovery via `retryWebGL2()`.

#### Scenario: Traversing sample-count presets across the 64k-80k deadband switches 1-canvas and 3-canvas DOM topologies
- **GIVEN**: the `/engine-controller` view mounted in `"auto"` mode
- **WHEN**: the user activates preset buttons `samples-10000` -> `samples-80000` -> `samples-72000` -> `samples-64000`
- **THEN**: at `10,000` the figure stage holds `1` `<canvas>` (`activeKind === "canvas2d"`), at `80,000` it atomically swaps to `3` stacked `<canvas>` elements (`activeKind === "webgl2"`), at `72,000` (inside the deadband) it stays at `3` `<canvas>` elements (`"webgl2"`), and at `64,000` it swaps back to `1` `<canvas>` (`"canvas2d"`)

#### Scenario: Toggling gesture lock defers threshold switch until released
- **GIVEN**: the `/engine-controller` view mounted in `"auto"` mode at `10,000` samples (`"canvas2d"`)
- **WHEN**: the user activates the `gesture-toggle` control, selects the `samples-150000` preset, and then deactivates the `gesture-toggle` control
- **THEN**: while `gestureActive` is `true`, `activeKind` remains `"canvas2d"` and the HUD reports `data-field="pending-engine"` as `"webgl2"`; when `gestureActive` is toggled back to `false`, `activeKind` immediately transitions to `"webgl2"` (`3` canvases) and `pending-engine` updates to `"none"`

#### Scenario: Simulating WebGL2 failure latches fallback to Canvas2D and recovers when disabled
- **GIVEN**: the `/engine-controller` view mounted in `"auto"` mode at `10,000` samples
- **WHEN**: the user enables the `simulate-webgl2-failure` control and selects the `samples-150000` preset, and subsequently disables the `simulate-webgl2-failure` control
- **THEN**: on the failed upgrade the view remains live on `"canvas2d"` (`1` canvas) with `data-field="webgl2-fallback"` equal to `"true"` in the HUD (capturing fallback diagnostics via `onWebGL2Fallback`), and upon disabling simulated failure, `webgl2-fallback` clears to `"false"` and the view upgrades to `"webgl2"` (`3` canvases)

### Requirement: Live Engine Controller Telemetry HUD and Balanced Mount/Unmount Lifecycle
The `/engine-controller` view MUST render a live telemetry HUD (`div[data-role="controller-hud"]`) exposing:
- `data-field="active-engine"` (`"canvas2d"` or `"webgl2"`),
- `data-field="selection-mode"` (`"auto"`, `"canvas2d"`, or `"webgl2"`),
- `data-field="sample-count"` (current $N$ from `controller.sampleCount`),
- `data-field="hysteresis-band"` (`"below-down"`, `"deadband"`, or `"above-up"`, computed via `classifyHysteresisBand(controller.sampleCount, controller.hysteresis)`),
- `data-field="canvas-count"` (`"1"` when Canvas2D is mounted, `"3"` when WebGL2 is mounted),
- `data-field="pending-engine"` (`"none"`, `"canvas2d"`, or `"webgl2"`),
- `data-field="gesture-active"` (`"true"` or `"false"`),
- `data-field="webgl2-fallback"` (`"true"` or `"false"`), and
- `data-field="switch-count"` (monotonic count of post-initialization `onEngineChange` transitions).

The view MUST derive telemetry strictly from the public `SpectrumEngineController` contract (`classifyHysteresisBand(controller.sampleCount, controller.hysteresis)` for band classification and the `onWebGL2Fallback` callback for fallback error tracking). Unmounting `/engine-controller` MUST call `controller.dispose()`, remove all event listeners registered during mount, cancel any outstanding animation frame or observer, and clear the host container.

#### Scenario: Telemetry HUD reports live DOM canvas count, computed hysteresis band, and switch count
- **GIVEN**: the mounted `/engine-controller` view starting at `10,000` samples
- **WHEN**: the sample count is changed to `72,000` and then to `80,000`
- **THEN**: `data-field="hysteresis-band"` updates from `"below-down"` to `"deadband"` (remaining on `1` canvas, `switch-count` still `"0"`) and then to `"above-up"` (`canvas-count` `"3"`, `active-engine` `"webgl2"`, `switch-count` `"1"`)

#### Scenario: Unmounting the view disposes the controller and nets listeners and canvases to zero
- **GIVEN**: the `/engine-controller` view mounted with instrumented `addEventListener`/`removeEventListener` and `requestAnimationFrame`/`cancelAnimationFrame`
- **WHEN**: the view's unmount function is called
- **THEN**: the controller is disposed, the host element contains `0` `<canvas>` elements, and net listener and animation-frame registrations equal `0`
