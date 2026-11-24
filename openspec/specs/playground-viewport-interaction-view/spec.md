# Capability: playground-viewport-interaction-view

> Change: `viewport-interaction-controller` (Roadmap step `9.3`). Dedicated interactive `/viewport-interaction` playground workbench under `apps/playground/src/views/viewport-interaction/` (`register.ts`, `mount.ts`) showcasing drag-pan, cursor-anchored wheel zoom, axis-gutter single-axis gestures, Shift+drag box-zoom, double-click/button reset, programmatic zoom/pan controls, deep zoom near `1550.0001 nm`, single-axis logarithmic Y interaction (`Y_SCALE_KIND_LOG`), live debounced windowed/streaming re-decimation, and `canvas2d <-> webgl2` hysteresis deferral across active gestures.

## Requirements

### Requirement: Interactive Viewport Workbench with Dataset/Scale Presets, Programmatic Controls, and Re-Decimation Modes
The `/viewport-interaction` view in `apps/playground/src/views/viewport-interaction/mount.ts` MUST await `ensureDefaultFont()` prior to initial paint (matching `/engine-controller` and `/engine-parity`), mount a `SpectrumEngineController` inside `div[data-role="interaction-stage"]`, attach `createViewportInteractionController({ controller, ... })`, and MUST NOT import `@trace-kit/core/worker` or instantiate `new Worker(` (preserving `apps/playground/test/dom/no-transport-imports.test.ts`).

The view MUST expose interactive controls (`data-action` attributes) enabling:
1. **Dataset & scale presets (`data-action="preset-select"` or preset buttons):**
   - Linear broadband sweep (`"linear-broadband"`).
   - Single-axis logarithmic Y optical power sweep (`"log-y-power"`, configured with explicit single-entry `yAxes` using `Y_SCALE_KIND_LOG`).
   - Deep-zoom high-precision optical resonance preset near `xOrigin = 1550`, domain `[1550.0001, 1550.0002]` (`"deep-zoom-1550"`).
2. **Drag mode & wheel axis selectors:**
   - `data-action="drag-mode-select"` (`"pan"` vs. `"box-zoom"`).
   - `data-action="wheel-axis-select"` (`"xy"`, `"x"`, `"y"`).
3. **Sample-count hysteresis toggle (`data-action="sample-count-select"` or buttons):**
   - Switch between a below-threshold count (`10,000` samples $\to$ `"canvas2d"`) and an above-threshold count (`90,000` samples $\to$ `"webgl2"`), demonstrating mid-gesture deferral (`gestureActive === true`) and settled swap flushing.
4. **Live re-decimation mode toggle (`data-action="invalidation-mode-select"`):**
   - `"streaming-ring"`: wired to `createStreamingInvalidationAdapter` (`RawSampleRing` + `BucketAccumulator` Tier-3 gesture preview + settled Tier-1/2 rebuild).
   - `"windowed-port"`: wired to `createWindowDecimationAdapter` (`resolveSampleWindow` + `createSyncDecimationPort`).
   - `"direct"`: direct domain mutation on static payload.
5. **Programmatic viewport controls:**
   - `data-action="zoom-in"`, `data-action="zoom-out"`, `data-action="pan-left"`, `data-action="pan-right"`, `data-action="reset-domain"` calling `interaction.zoomByFactor(...)`, `interaction.panByFraction(...)`, and `interaction.resetDomain()`.

#### Scenario: Programmatic controls and presets mutate domain and survive scale switching
- **GIVEN**: the `/viewport-interaction` view mounted in Happy-DOM
- **WHEN**: the user triggers `data-action="zoom-in"`, then `data-action="pan-right"`, then `data-action="reset-domain"`, and then selects the `"log-y-power"` preset followed by `data-action="zoom-in"`
- **THEN**: `zoom-in` halves the visible span, `pan-right` shifts X right, `reset-domain` restores `homeDomain`, and switching to `"log-y-power"` renders a strictly positive logarithmic Y domain (`yMin > 0`) that zooms cleanly without throwing

#### Scenario: Deep-zoom 1550.0001 nm preset displays full float64 precision in the HUD
- **GIVEN**: the `/viewport-interaction` view mounted
- **WHEN**: the user activates the `"deep-zoom-1550"` preset
- **THEN**: `data-field="domain-x"` reports bounds near `1550.0001`..`1550.0002` with sub-picometre precision (at least 6 decimal places) and `controller.transform.xOrigin === 1550`

### Requirement: Live Interaction Telemetry HUD and Balanced Mount/Unmount Lifecycle
The `/viewport-interaction` view MUST render a live telemetry HUD (`div[data-role="interaction-hud"]`) exposing:
- `data-field="active-engine"` (`"canvas2d"` or `"webgl2"`),
- `data-field="domain-x"` (formatted float64 `[xMin, xMax]`),
- `data-field="domain-y"` (formatted `[yMin, yMax]`),
- `data-field="gesture-state"` (current `interaction.state`),
- `data-field="gesture-active"` (`"true"` or `"false"`),
- `data-field="pointer-region"` (last classified `PointerRegion`: `"plot"`, `"x-gutter"`, `"y-gutter"`, or `"outside"`),
- `data-field="invalidation-seq"` (monotonic invalidation sequence number),
- `data-field="invalidation-phase"` (`"idle"`, `"gesture"`, or `"settled"`), and
- `data-field="visible-samples"` (sample span count returned by `resolveSampleWindow` or active materialized count).

Unmounting `/viewport-interaction` MUST dispose `ViewportInteractionController`, dispose `SpectrumEngineController`, dispose any `DecimationPort` / adapter, remove all DOM listeners registered during mount, cancel any outstanding animation frames or timers, and clear the host element so net outstanding listeners, timers, canvases, and box-zoom overlays all equal `0`.

#### Scenario: HUD reflects live gesture state, invalidation counters, and active engine
- **GIVEN**: the mounted `/viewport-interaction` view
- **WHEN**: a `wheel` event is dispatched inside `div[data-role="interaction-stage"]` and settled
- **THEN**: `data-field="invalidation-seq"` increments to a positive integer, `data-field="invalidation-phase"` transitions to `"settled"`, and `data-field="domain-x"` reflects the zoomed bounds

#### Scenario: Unmounting disposes both controllers and leaves zero leaked listeners or DOM nodes
- **GIVEN**: the `/viewport-interaction` view mounted with instrumented `addEventListener`/`removeEventListener` and `requestAnimationFrame`/`cancelAnimationFrame`
- **WHEN**: the view's unmount function is called
- **THEN**: the host contains `0` `<canvas>` elements and `0` `[data-trace-kit-overlay="box-zoom"]` elements, and net listener and animation-frame registrations equal `0`
