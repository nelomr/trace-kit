# Capability: engine-hysteresis-policy

## Requirements

### Requirement: Engine Selection Modes and Strict Hysteresis Threshold Validation
`@trace-kit/renderers/controller` MUST export the types `EngineKind` (`FigureRendererKind`), `EngineSelectionMode` (`"auto" | "canvas2d" | "webgl2"`), `HysteresisBand` (`"below-down" | "deadband" | "above-up"`), `HysteresisConfig` (`upThreshold?: number`, `downThreshold?: number`), `ResolvedHysteresisConfig`, `HysteresisEvaluationInput`, `HysteresisEvaluationResult`, and `EngineChangeReason` (`"init" | "hysteresis-up" | "hysteresis-down" | "mode-change" | "gesture-end" | "webgl2-fallback" | "webgl2-retry"`), together with the concrete runtime exports `DEFAULT_HYSTERESIS_CONFIG` (`{ readonly upThreshold: 80_000; readonly downThreshold: 64_000 }`), `resolveHysteresisConfig`, `classifyHysteresisBand`, `computePayloadSampleCount`, `computeTracesSampleCount`, and `evaluateHysteresisTarget`.

The default `mode` MUST be `"auto"`. As the configurable default hysteresis policy, `DEFAULT_HYSTERESIS_CONFIG.upThreshold` MUST be `80_000` samples and `DEFAULT_HYSTERESIS_CONFIG.downThreshold` MUST be `64_000` samples (a 20% deadband). Both thresholds MUST be finite positive integers satisfying strict separation `0 < downThreshold < upThreshold`; providing a non-integer, non-finite number (`NaN`, `Infinity`, `-Infinity`), `downThreshold <= 0`, `upThreshold <= 0`, or `downThreshold >= upThreshold` (including `downThreshold === upThreshold`) MUST throw a `RangeError` synchronously in `resolveHysteresisConfig` and `createSpectrumEngineController`.

When `mode` is `"canvas2d"` or `"webgl2"`, the policy MUST select that pinned engine regardless of the sample count (unless `webgl2Fallback` is active, which forces `"canvas2d"`). Calling `setMode("webgl2")` on the controller MUST clear `webgl2Fallback` so WebGL2 is attempted once (re-latching `webgl2Fallback = true` on failure). `setMode(mode)` MUST synchronize revisions and sample count first; when `gestureActive === false`, it MUST execute any eligible swap synchronously immediately; when `gestureActive === true`, it MUST update `mode` and `pendingKind` and defer the swap until `setGestureActive(false)`.

#### Scenario: Default thresholds are 80,000 up and 64,000 down in auto mode
- **GIVEN**: `DEFAULT_HYSTERESIS_CONFIG`, `resolveHysteresisConfig()`, or a controller constructed with default options
- **WHEN**: the resolved mode and hysteresis configuration are inspected
- **THEN**: `mode` is `"auto"`, `upThreshold` is `80_000`, and `downThreshold` is `64_000`

#### Scenario: Invalid or equal threshold bounds throw RangeError synchronously
- **GIVEN**: invalid threshold configurations `{ upThreshold: 80_000, downThreshold: 80_000 }`, `{ upThreshold: 60_000, downThreshold: 80_000 }`, `{ upThreshold: 0, downThreshold: 0 }`, `{ upThreshold: -10, downThreshold: -20 }`, `{ upThreshold: 80_000.5, downThreshold: 64_000 }`, `{ upThreshold: Number.NaN, downThreshold: 64_000 }`, and `{ upThreshold: Number.POSITIVE_INFINITY, downThreshold: 64_000 }`
- **WHEN**: `resolveHysteresisConfig` or `createSpectrumEngineController` is called with each invalid configuration
- **THEN**: each call throws a `RangeError` synchronously before allocating any DOM element or renderer

#### Scenario: Explicit mode override pins the target engine synchronously when no gesture is active
- **GIVEN**: a controller with `gestureActive === false` holding a payload with `150_000` samples (`N >= upThreshold`)
- **WHEN**: `setMode("canvas2d")` is called, and then `setData` replaces the data with a `1_000`-sample payload (`N <= downThreshold`) followed by `setMode("webgl2")`
- **THEN**: `setMode("canvas2d")` immediately swaps to `"canvas2d"` at `150_000` samples with `reason === "mode-change"`, and `setMode("webgl2")` immediately swaps to `"webgl2"` at `1_000` samples with `reason === "mode-change"` without requiring an extra `render()` call

### Requirement: Two-Threshold Hysteresis Deadband in `"auto"` Mode
Because `0 < downThreshold < upThreshold` is strictly enforced, `classifyHysteresisBand(sampleCount, config)` MUST partition all sample counts into three strictly disjoint bands:
- `"below-down"` when `sampleCount <= downThreshold`,
- `"deadband"` when `downThreshold < sampleCount < upThreshold`, and
- `"above-up"` when `sampleCount >= upThreshold`.

In `"auto"` mode:
1. Prior to data ingestion (`sampleCount === 0`) or when starting with `sampleCount < upThreshold`, the selected engine MUST be `"canvas2d"` so empty and sub-threshold figures do not claim a browser WebGL2 context.
2. When `activeKind === "canvas2d"` and `sampleCount >= upThreshold`, `evaluateHysteresisTarget` MUST return `targetKind: "webgl2"`, `shouldSwitch: true`, and `band: "above-up"`, and the controller MUST transition to `"webgl2"` with `reason === "hysteresis-up"`.
3. When `activeKind === "webgl2"` and `sampleCount <= downThreshold`, `evaluateHysteresisTarget` MUST return `targetKind: "canvas2d"`, `shouldSwitch: true`, and `band: "below-down"`, and the controller MUST transition to `"canvas2d"` with `reason === "hysteresis-down"`.
4. When `downThreshold < sampleCount < upThreshold` (`band === "deadband"`), `evaluateHysteresisTarget` MUST return `targetKind: activeKind` and `shouldSwitch: false`, and the controller MUST NOT trigger an engine switch.

#### Scenario: Initial engine is canvas2d below upThreshold
- **GIVEN**: a controller created in `"auto"` mode with no data (`sampleCount === 0`) or with a `79_999`-sample payload
- **WHEN**: `activeKind` is inspected
- **THEN**: `activeKind` is `"canvas2d"` and zero WebGL2 contexts have been requested

#### Scenario: Ascending to upThreshold transitions from canvas2d to webgl2
- **GIVEN**: a controller in `"auto"` mode currently on `"canvas2d"` at `50_000` samples
- **WHEN**: `setData` is called with a `79_999`-sample payload and `render()` runs, and then `setData` is called with an `80_000`-sample payload and `render()` runs
- **THEN**: `activeKind` stays `"canvas2d"` at `79_999` samples (`classifyHysteresisBand(controller.sampleCount, controller.hysteresis) === "deadband"`) and switches to `"webgl2"` at `80_000` samples (`classifyHysteresisBand(controller.sampleCount, controller.hysteresis) === "above-up"`) with `reason === "hysteresis-up"`

#### Scenario: Descending into the deadband preserves webgl2 without thrashing
- **GIVEN**: a controller in `"auto"` mode currently on `"webgl2"` after rendering `80_000` samples
- **WHEN**: `setData` is called sequentially with `79_999`, `72_000`, and `64_001` samples and `render()` runs after each update
- **THEN**: `activeKind` remains `"webgl2"` and `classifyHysteresisBand(controller.sampleCount, controller.hysteresis)` is `"deadband"` across all three renders, with zero engine switches

#### Scenario: Descending to or below downThreshold transitions from webgl2 to canvas2d
- **GIVEN**: a controller in `"auto"` mode currently on `"webgl2"` at `64_001` samples
- **WHEN**: `setData` is called with a `64_000`-sample payload and `render()` runs
- **THEN**: `activeKind` transitions from `"webgl2"` to `"canvas2d"` (`classifyHysteresisBand(controller.sampleCount, controller.hysteresis) === "below-down"`) with `reason === "hysteresis-down"`

#### Scenario: Oscillating inside the deadband causes zero engine switches
- **GIVEN**: a controller in `"auto"` mode starting on `"canvas2d"` (or `"webgl2"`)
- **WHEN**: sample counts oscillate 20 times between `64_001` and `79_999` across consecutive `render()` calls
- **THEN**: `activeKind` remains unchanged for all 20 renders and no post-init `onEngineChange` transition is emitted

### Requirement: Total Sample-Count Evaluation Across Single Payloads, Multi-Trace Collections, and In-Place Revision Advances
The authoritative sample count $N$ evaluated against the hysteresis thresholds MUST be:
- `computePayloadSampleCount(payload)` (`Math.max(0, payload.sampleCount | 0)`) when data is supplied via `setData(payload)`.
- `computeTracesSampleCount(collection)` ($\sum_{i=0}^{\text{entries.length}-1} \max(0, \text{entries}[i].\text{payload.sampleCount} \mid 0)$) when data is supplied via `setTraces(collection)`.
- `0` before any data is supplied.

`setData(payload)` and `setTraces(collection)` MUST synchronously update `controller.sampleCount` and the controller's revision snapshots without drawing and without auto-scheduling `requestRender()`; engine swaps driven by data changes execute on `render()` (or on the scheduled `requestRender()` frame).

Because callers and streaming materializers (`materializeBucketsToPayload`) may mutate a `Retained` `SpectrumDataPayload` in place and advance `payload.revision` without calling `setData` or `setTraces` again, the controller MUST compare the live `payload.revision` (or each collection entry's live `payload.revision`) against its revision snapshot at the start of every `render()` pass and at the entry of `setMode()`, `setGestureActive(false)`, and `retryWebGL2()`, recomputing $N$ and re-evaluating the hysteresis policy whenever any revision has changed since the previous evaluation.

#### Scenario: setData and setTraces update sampleCount synchronously without drawing or swapping until render
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` with `upThreshold = 80_000`
- **WHEN**: `setTraces(collection)` is called with 4 trace entries of `25_000` samples each (`total = 100_000`)
- **THEN**: immediately after `setTraces`, `controller.sampleCount` is `100_000`, `activeKind` is still `"canvas2d"`, and no frame was scheduled or rendered; once `render()` runs, `activeKind` transitions to `"webgl2"`

#### Scenario: In-place payload revision advance crossing upThreshold switches engine on render
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` holding a `Retained` payload with initial `sampleCount === 40_000` and `revision === 1`
- **WHEN**: the payload is mutated in place to `sampleCount === 90_000` with `revision === 2` (via `commitPayloadRevision` or `materializeBucketsToPayload` in `@trace-kit/core`) and `controller.render()` is called without calling `setData` again
- **THEN**: `controller.sampleCount` updates to `90_000` and the controller transitions from `"canvas2d"` to `"webgl2"` before drawing the frame

#### Scenario: In-place collection entry revision advance crossing downThreshold switches engine on render
- **GIVEN**: a controller in `"auto"` mode on `"webgl2"` holding a 2-trace `TraceCollection` whose payloads initially total `90_000` samples (`45_000` each at `revision === 1`)
- **WHEN**: both entry payloads are updated in place to `25_000` samples each (`total = 50_000 <= 64_000`) at `revision === 2` and `controller.render()` is called without calling `setTraces` again
- **THEN**: `controller.sampleCount` updates to `50_000` and the controller transitions from `"webgl2"` to `"canvas2d"` before drawing the frame

### Requirement: Mid-Gesture Engine-Switch Deferral (`setGestureActive`)
The controller MUST expose `readonly gestureActive: boolean` (initially `false`), `readonly pendingKind: EngineKind | null` (initially `null`), and `setGestureActive(active: boolean): void`.

While `gestureActive === true`, any eligible engine transition (whether from `"auto"` hysteresis evaluation or from `setMode(mode)`) MUST NOT replace the mounted `<canvas>` elements or dispose the active internal renderer; instead, `evaluateHysteresisTarget` MUST return `{ targetKind: activeKind, desiredKind, pendingKind: desiredKind, shouldSwitch: false }` (with `pendingKind: null` when `desiredKind === activeKind`), `controller.pendingKind` MUST reflect that deferred target, and the controller MUST continue rendering with the currently mounted engine so active pointer gestures never lose pointer capture.

When `setGestureActive(false)` is called, the controller MUST first synchronize live payload/trace revisions and `sampleCount` (capturing any mid-gesture in-place `payload.revision` advances), then immediately re-evaluate the policy: if a switch is warranted, it MUST execute the atomic engine swap synchronously with `reason === "gesture-end"` and clear `pendingKind` to `null`; if a switch is no longer warranted, it MUST clear `pendingKind` to `null` without swapping.

#### Scenario: Threshold crossing during an active gesture defers the swap until gesture end
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` with `setGestureActive(true)`
- **WHEN**: `setData` is called with `100_000` samples and `render()` runs while `gestureActive === true`, and then `setGestureActive(false)` is called
- **THEN**: during `gestureActive === true`, `activeKind` remains `"canvas2d"`, `pendingKind` is `"webgl2"`, and the mounted `<canvas>` element is unchanged; upon `setGestureActive(false)`, the controller atomically swaps to `"webgl2"` synchronously with `reason === "gesture-end"` and `pendingKind` becomes `null`

#### Scenario: Returning to the original band before gesture end cancels the deferred switch
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` with `setGestureActive(true)` that rendered `100_000` samples (`pendingKind === "webgl2"`)
- **WHEN**: `setData` updates the payload back to `50_000` samples while `gestureActive === true`, and `setGestureActive(false)` is subsequently called
- **THEN**: `pendingKind` clears to `null`, `activeKind` remains `"canvas2d"`, and zero engine swaps occur

#### Scenario: Mid-gesture in-place payload revision advance is synchronized and flushed on setGestureActive(false)
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` holding a `Retained` payload with `40_000` samples at `revision === 1` and `setGestureActive(true)` active
- **WHEN**: the payload is mutated in place to `95_000` samples at `revision === 2` while `gestureActive === true`, and `setGestureActive(false)` is called directly without an intervening `setData` or `render`
- **THEN**: `setGestureActive(false)` detects the revision advance, updates `controller.sampleCount` to `95_000`, and synchronously swaps to `"webgl2"` with `reason === "gesture-end"`

#### Scenario: setMode during an active gesture defers the swap until setGestureActive(false)
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` with `setGestureActive(true)` and `10_000` samples
- **WHEN**: `setMode("webgl2")` is called while `gestureActive === true`, and then `setGestureActive(false)` is called
- **THEN**: immediately after `setMode("webgl2")`, `controller.mode` is `"webgl2"`, `controller.activeKind` remains `"canvas2d"`, `controller.pendingKind` is `"webgl2"`, and the mounted `<canvas>` is unchanged; upon `setGestureActive(false)`, the controller synchronously swaps to `"webgl2"` with `reason === "gesture-end"` and `pendingKind` becomes `null`
