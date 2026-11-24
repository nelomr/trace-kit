# Capability: renderer-lifecycle-manager

## Requirements

### Requirement: `SpectrumEngineController` Surface, Dimension Validation, and Frozen `FigureRenderer` Preservation
`@trace-kit/renderers/controller` MUST export `createSpectrumEngineController(options: SpectrumEngineControllerOptions): SpectrumEngineController` along with the TypeScript types `SpectrumEngineController`, `SpectrumEngineControllerOptions`, `ViewportDomain`, `EngineChangeEvent`, `EngineChangeReason`, `WebGL2FallbackEvent`, `WebGL2ContextLostEvent`, `WebGL2ContextRestoredEvent`, `ResizeObserverLike`, `ResizeObserverEntryLike`, and `ResizeObserverCallbackLike`. `FigureRenderer` (`packages/renderers/src/figure-renderer.ts`) MUST remain strictly unchanged at its frozen 11 members (`kind`, `disposed`, `transform`, `setData`, `setTraces`, `setDomain`, `resize`, `render`, `clear`, `setDecimation`, `dispose`).

`SpectrumEngineControllerOptions` MUST additionally accept optional lifecycle callbacks:
- `readonly onContextLost?: (event: WebGL2ContextLostEvent) => void`
- `readonly onContextRestored?: (event: WebGL2ContextRestoredEvent) => void`

where:
- `WebGL2ContextLostEvent` is `{ readonly activeKind: "webgl2"; readonly sampleCount: number; readonly mode: EngineSelectionMode; readonly statusMessage: string }`
- `WebGL2ContextRestoredEvent` is `{ readonly activeKind: "webgl2"; readonly sampleCount: number; readonly mode: EngineSelectionMode; readonly restoreCount: number }`

`SpectrumEngineController` MUST expose:
- `readonly activeKind: EngineKind`
- `readonly mode: EngineSelectionMode`
- `readonly hysteresis: ResolvedHysteresisConfig`
- `readonly pendingKind: EngineKind | null`
- `readonly gestureActive: boolean`
- `readonly webgl2Fallback: boolean`
- `readonly contextLost: boolean`
- `readonly sampleCount: number`
- `readonly disposed: boolean`
- `readonly container: HTMLElement`
- `readonly canvases: readonly HTMLCanvasElement[]`
- `readonly transform: ViewportTransform` (delegating to the active internal renderer's `transform`)
- `readonly domain: ViewportDomain` (`{ readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number }`)
- `readonly decimation: DecimationSelection | undefined`
- `readonly width: number`
- `readonly height: number`
- `readonly dpr: number`
- Methods: `setData(payload)`, `setTraces(collection)`, `setDomain(xMin, xMax, yMin, yMax)`, `resize(width, height, dpr)`, `setDecimation(selection)`, `setMode(mode)`, `setGestureActive(active)`, `retryWebGL2()`, `render()`, `requestRender()`, `clear()`, and `dispose()`.

`initialWidth`, `initialHeight`, and `initialDpr` (when provided in `SpectrumEngineControllerOptions`) and `controller.resize(width, height, dpr)` MUST validate that every value is finite (`Number.isFinite`) and strictly positive (`> 0`); providing any non-finite or `<= 0` value MUST throw a `RangeError` synchronously without mutating dimensions or allocating DOM elements or renderers.

#### Scenario: FigureRenderer remains at 11 members while SpectrumEngineController exposes the orchestration and context-loss contract
- **GIVEN**: the compiled `@trace-kit/renderers` and `@trace-kit/renderers/controller` declarations
- **WHEN**: `FigureRenderer` and `SpectrumEngineController` are inspected
- **THEN**: `FigureRenderer` has the exact 11 members tested by `figure-renderer-shape.test.ts`, and `SpectrumEngineController` exposes `readonly contextLost: boolean` alongside the exact state getters, `onContextLost` / `onContextRestored` option hooks, and lifecycle methods listed above

#### Scenario: Initial controller creation in auto mode mounts a single Canvas2D surface
- **GIVEN**: a host `container` `div` and `createSpectrumEngineController({ container })`
- **WHEN**: the controller finishes construction
- **THEN**: `controller.activeKind` is `"canvas2d"`, `controller.contextLost` is `false`, `controller.canvases` has length `1`, `container.querySelectorAll("canvas")` has length `1`, and `controller.disposed` is `false`

#### Scenario: Invalid initial dimensions or resize arguments throw RangeError synchronously
- **GIVEN**: invalid dimension inputs `{ initialWidth: 0 }`, `{ initialHeight: -100 }`, `{ initialDpr: Number.NaN }`, `{ initialWidth: Number.POSITIVE_INFINITY }`, and a live controller with `width === 640`, `height === 400`, `dpr === 2`
- **WHEN**: `createSpectrumEngineController` is called with each invalid initial dimension or `controller.resize(width, height, dpr)` is called with `0`, `-1`, `Number.NaN`, or `Number.POSITIVE_INFINITY`
- **THEN**: each call throws a `RangeError` synchronously, failed construction allocates zero `<canvas>` elements in `container`, and failed `resize` leaves `controller.width === 640`, `controller.height === 400`, `controller.dpr === 2` unchanged

### Requirement: Stable Outer Host Container, Managed `<canvas>` Topology, and DOM Z-Order Preservation
`createSpectrumEngineController` MUST mount and swap all managed `<canvas>` elements as children inside the caller-supplied `container: HTMLElement`, never replacing `container` itself and never removing or detaching event listeners or non-managed child elements attached to `container`. If `container.style.position` is empty (and computed position is `"static"` when `getComputedStyle` is available), the controller MUST set `container.style.position = "relative"` so child canvases stack within `container`. Every managed `<canvas>` MUST be styled with `position: absolute; inset: 0; width: 100%; height: 100%; display: block`.
- When `activeKind === "canvas2d"`, `canvases` MUST contain exactly 1 `<canvas>` carrying `data-trace-kit-engine="canvas2d"` and `data-trace-kit-layer="canvas2d"`.
- When `activeKind === "webgl2"`, `canvases` MUST contain exactly 3 distinct `<canvas>` elements mounted in DOM order `[underlay, plot, overlay]`, each carrying `data-trace-kit-engine="webgl2"` and `data-trace-kit-layer` set to `"underlay"`, `"plot"`, and `"overlay"` respectively (with `overlay.style.pointerEvents = "none"`).
- On initial mount, managed `<canvas>` elements MUST be inserted before `container.firstChild` (`container.insertBefore(canvas, container.firstChild)`). On every subsequent swap, incoming `<canvas>` elements MUST be inserted immediately before the first outgoing managed `<canvas>` element's DOM position (`container.insertBefore(canvas, outgoingAnchor)`) before removing the outgoing managed canvases, so non-managed sibling overlays appended after controller creation always remain after (visually above) the managed canvases in DOM order.

#### Scenario: Host container listeners and non-managed sibling nodes survive 1-canvas to 3-canvas swaps
- **GIVEN**: a `container` element containing a non-managed overlay child `<div data-role="overlay">`, a `pointerdown` listener attached directly to `container`, and a controller starting on `"canvas2d"` (`1` child `<canvas>`)
- **WHEN**: the controller switches to `"webgl2"` (`3` child `<canvas>` elements) and a synthetic `pointerdown` event is dispatched on the active plot `<canvas>` (bubbling to `container`)
- **THEN**: `controller.container` is the exact same `HTMLElement` reference, the non-managed `<div data-role="overlay">` remains in `container`, `container.querySelectorAll("canvas")` has length `3` in order `["underlay", "plot", "overlay"]`, and the `pointerdown` listener on `container` fires without re-registration

#### Scenario: Sibling overlay DOM z-order is preserved across round-trip swaps
- **GIVEN**: a controller mounted in `container` on `"canvas2d"`, after which the caller appends a non-managed sibling `<div data-role="overlay">` to `container` so `Array.from(container.children)` is `[canvas2d, overlayDiv]`
- **WHEN**: the controller switches `"canvas2d" -> "webgl2"` and then `"webgl2" -> "canvas2d"`
- **THEN**: in `"webgl2"` state `Array.from(container.children)` is `[underlayCanvas, plotCanvas, overlayCanvas, overlayDiv]`, and after switching back to `"canvas2d"`, `Array.from(container.children)` is `[newCanvas2d, overlayDiv]` with `overlayDiv` remaining last in DOM order throughout

#### Scenario: Managed canvases carry deterministic data-trace-kit-engine and data-trace-kit-layer attributes
- **GIVEN**: a controller that switches from `"canvas2d"` to `"webgl2"` and back to `"canvas2d"`
- **WHEN**: the mounted `<canvas>` elements are inspected in both states
- **THEN**: in `"canvas2d"` state the single canvas has `getAttribute("data-trace-kit-engine") === "canvas2d"` and `getAttribute("data-trace-kit-layer") === "canvas2d"`, in `"webgl2"` state the three canvases have `getAttribute("data-trace-kit-engine") === "webgl2"` and `getAttribute("data-trace-kit-layer")` equal to `"underlay"`, `"plot"`, `"overlay"`, and every managed canvas has `style.position === "absolute"`

### Requirement: Zero-Flicker Five-Step Synchronous Atomic Swap, Authoritative State Replay, and Partial Swap Cleanup
The controller MUST maintain an authoritative `effectiveDomain` (exposed via `controller.domain`):
- Initialized from explicit initial domain options when provided; otherwise `xMin = 0, xMax = 1` and `yMin/yMax` seeded from `options.yAxes[0].domainMin` / `options.yAxes[0].domainMax` when `options.yAxes` is non-empty, or `[-1, 1]` otherwise.
- `controller.setDomain(xMin, xMax, yMin, yMax)` MUST update all four fields of `effectiveDomain` and forward `setDomain` to the active internal renderer.
- `controller.setTraces(collection)` MUST update `effectiveDomain.xMin` / `effectiveDomain.xMax` from `collection.xDomainMin` / `collection.xDomainMax` while preserving `effectiveDomain.yMin` / `effectiveDomain.yMax` (seeded from `options.yAxes[0]` if non-empty, else `[-1, 1]`, or the last `setDomain`).
- Steady-state `controller.setData(payload)` with a changed `payload.xOrigin` MUST propagate `xOrigin` through to the active internal renderer so `controller.transform.xOrigin` and `controller.transform.xOffsetMin` reflect the new payload's `xOrigin`.

Every engine transition between `"canvas2d"` and `"webgl2"` MUST execute synchronously within a single JavaScript task in five ordered steps:
1. **Stage fresh unmounted `<canvas>` element(s)** for the incoming engine (`1` canvas for `"canvas2d"`, `3` canvases for `"webgl2"`). A `<canvas>` that has ever been passed to a previous renderer MUST NOT be reused. For an incoming `"webgl2"` engine, the controller MUST immediately attach a temporary swap-scoped `webglcontextlost` listener to the staged `incomingCanvases[1]` (`plot`) canvas before Step 2.
2. **Construct the incoming `FigureRenderer`** (`Canvas2DRenderer` or `WebGL2FigureRenderer`, or via the injected `createCanvas2DRenderer` / `createWebGL2Renderer` factory seam) with the retained `style`, `axes`, `yAxes`, and `decimation` configuration.
3. **Replay authoritative retained state** onto the incoming renderer in exact order:
   - `incoming.resize(width, height, dpr)`,
   - `incoming.setData(payload)` (if single-trace data is active) or `incoming.setTraces(collection)` (if a multi-trace collection is active),
   - **unconditional** `incoming.setDomain(effectiveDomain.xMin, effectiveDomain.xMax, effectiveDomain.yMin, effectiveDomain.yMax)`,
   - `incoming.setDecimation(decimation)`.
4. **Pre-swap paint and mid-switch loss verification**: When data/traces are present (or during a `render()` pass), call `incoming.render()` synchronously so the incoming canvas backing store(s) contain the complete rendered frame *before* any DOM mutation occurs. For an incoming `"webgl2"` engine, immediately after Step 4 and **before** Step 5 DOM mutation, the controller MUST verify both that the swap-scoped `incomingLost` flag is `false` and that the incoming renderer's recovery handle (when present) reports `isContextLost() === false`. If either indicates context loss, the controller MUST abort the swap by removing the swap-scoped listener and entering the deterministic partial-swap unwind path (disposing `incoming`, discarding the 3 unmounted canvases, keeping any mounted Canvas2D canvas live and painted or mounting fallback Canvas2D on initial mount, latching `webgl2Fallback = true`, and invoking `onWebGL2Fallback`, without mutating `contextLost` to `true` and without invoking `onContextLost`).
5. **Atomic DOM replacement, listener handoff, and outgoing teardown**: Detach any active outgoing WebGL2 context listeners and clear `boundPlotCanvas = null` (and clear `contextLost = false`) **before** disposing outgoing. Insert the incoming `<canvas>` element(s) into `container` immediately before the outgoing canvases' DOM anchor (`insertBefore`), remove the outgoing managed `<canvas>` element(s) from `container`, invoke `outgoing.dispose()` (releasing WebGL2 GPU objects and calling `WEBGL_lose_context.loseContext()` when outgoing is a healthy WebGL2 renderer), update the active internal renderer, `activeKind`, and `canvases`, replace the temporary swap-scoped listener with the active `#boundPlotCanvas` `webglcontextlost`/`webglcontextrestored` listeners (when incoming is `"webgl2"`), and **then** invoke `onEngineChange?.({ previousKind, activeKind, sampleCount, mode, reason })` so even a re-entrant `webglcontextlost` inside `onEngineChange` is captured cleanly.

If `incoming` was constructed in Step 2 and any subsequent replay, pre-render, or post-Step-4 context-loss check fails, the controller MUST remove any temporary swap-scoped listener and call `incoming.dispose()` before discarding the staged unmounted `<canvas>` elements and falling back or preserving the outgoing engine.

#### Scenario: Incoming renderer finishes replay and render() before DOM replacement and outgoing dispose()
- **GIVEN**: a controller configured with recording renderer fakes (`createCanvas2DRenderer`, `createWebGL2Renderer`) in happy-dom that log every lifecycle call and DOM mutation into a shared ordered event log
- **WHEN**: `setData` with `80_000` samples and `render()` triggers a `"canvas2d" -> "webgl2"` swap
- **THEN**: the shared log records, in exact order: `incoming:construct`, `incoming:resize`, `incoming:setData`, `incoming:setDomain`, `incoming:setDecimation`, `incoming:render`, `dom:swap`, `outgoing:dispose`, `callback:onEngineChange`

#### Scenario: Mid-switch context loss during Steps 2-4 aborts swap before DOM mutation and preserves live Canvas2D
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` configured with an injected `createWebGL2Renderer` where either (a) a `webglcontextlost` event fires on staged `surfaces.plot` during `incoming.render()`, or (b) the incoming `WebGL2FigureRenderer`'s `RecordingGl2Context` transitions to `isContextLost() === true` between Step 2 and Step 4
- **WHEN**: `setData` with `80_000` samples and `render()` attempt a `"canvas2d" -> "webgl2"` swap
- **THEN**: the swap aborts before Step 5 DOM mutation, `incoming.dispose()` is called once, the 3 staged WebGL2 canvases are never inserted into `container`, the existing `"canvas2d"` canvas remains mounted and painted (zero blank flicker), `controller.activeKind === "canvas2d"`, `controller.webgl2Fallback === true`, `controller.contextLost === false`, `onWebGL2Fallback` fires once, and `onContextLost` fires `0` times

#### Scenario: Re-entrant webglcontextlost inside onEngineChange is captured by newly bound listeners
- **GIVEN**: a controller upgrading `"canvas2d" -> "webgl2"` in Happy-DOM whose `onEngineChange` callback synchronously dispatches a cancelable `webglcontextlost` event on `controller.canvases[1]`
- **WHEN**: the swap completes Step 5
- **THEN**: the active plot-canvas listeners were already bound before `onEngineChange` ran, `event.defaultPrevented === true`, `controller.contextLost === true`, and `onContextLost` fires once

#### Scenario: Authoritative effectiveDomain, traces, size, real transform properties, and xOrigin are preserved across swaps and steady-state setData
- **GIVEN**: a controller initialized with custom `style`/`axes` and `yAxes: [{ id: "power", scaleKind: 0, domainMin: -80, domainMax: 0, side: 0 }]`, `resize(640, 400, 2)`, and a `TraceCollection` spanning `xDomainMin: 1550`, `xDomainMax: 1560` whose entry payload has `xOrigin: 1550`
- **WHEN**: the controller switches `"canvas2d" -> "webgl2"` and back `"webgl2" -> "canvas2d"`, and subsequently switches to steady-state `setData(payloadWithOrigin2000)` on `"canvas2d"` with `setDomain(2000, 2010, -80, 0)`
- **THEN**: after `setTraces` and after each round-trip swap, `controller.width === 640`, `controller.height === 400`, `controller.dpr === 2`, `controller.domain` is `{ xMin: 1550, xMax: 1560, yMin: -80, yMax: 0 }`, `controller.transform` has `deviceWidth === 1280`, `deviceHeight === 800`, `dpr === 2`, `xDomainMin === 1550`, `xDomainMax === 1560`, `yDomainMin === -80`, `yDomainMax === 0`, `xOrigin === 1550`, and every newly mounted `<canvas>` has backing dimensions `1280 x 800`; after steady-state `setData(payloadWithOrigin2000)` + `setDomain(2000, 2010, -80, 0)`, `controller.transform.xOrigin === 2000` and `controller.transform.xOffsetMin === 0`

#### Scenario: Partial swap failure after construction disposes incoming renderer before fallback
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` configured with an injected `createWebGL2Renderer` whose constructed renderer throws an `Error` inside `incoming.render()` (or `incoming.setDomain()`)
- **WHEN**: `setData` is called with `80_000` samples and `render()` runs
- **THEN**: `incoming.dispose()` is called exactly once, the staged WebGL2 `<canvas>` elements are never inserted into `container`, the existing `"canvas2d"` `<canvas>` remains mounted and active, `controller.activeKind === "canvas2d"`, `controller.webgl2Fallback === true`, and `onWebGL2Fallback` is invoked once with the thrown error

#### Scenario: Canvas elements from a disposed engine are never reused on subsequent swaps
- **GIVEN**: a controller that switches `"canvas2d" -> "webgl2" -> "canvas2d" -> "webgl2"`
- **WHEN**: the `canvases` references from the first `"canvas2d"` and `"webgl2"` activations are compared with those from the second activations
- **THEN**: every `<canvas>` reference in the second activations is a distinct, freshly allocated `HTMLCanvasElement`

### Requirement: Deterministic Fallback to `Canvas2DRenderer` When WebGL2 Is Unavailable
If constructing, replaying state onto, pre-rendering, detecting mid-switch context loss on, or rehydrating `WebGL2FigureRenderer` fails (including `getContext("webgl2")` returning `null`, context exhaustion, mid-switch context loss in Steps 2–4, or shader/program compilation failure during initial construction, engine switch, or `webglcontextrestored` rehydration) in either `"auto"` or `"webgl2"` mode:
1. If an incoming `WebGL2FigureRenderer` instance was constructed before the failure, the controller MUST detach any swap-scoped listener and call `incoming.dispose()`. The controller MUST discard the unmounted WebGL2 `<canvas>` elements without modifying the currently mounted DOM children.
2. The controller MUST latch `webgl2Fallback = true` and ensure `contextLost = false`. When an existing `Canvas2DRenderer` is already active, the controller MUST retain it and render the frame on `"canvas2d"`. When failing on initial `"webgl2"` mount or during `webglcontextrestored` rehydration, the controller MUST construct the fallback `Canvas2DRenderer`, replay authoritative state (`resize`, `setData`/`setTraces`, `setDomain`, `setDecimation`), render if data is present, and mount its `<canvas>` into `container` BEFORE invoking `onWebGL2Fallback` or `onEngineChange`.
3. Only after the fallback `"canvas2d"` surface is fully active and mounted, the controller MUST invoke `onWebGL2Fallback?.({ error, attemptedMode, sampleCount })`. On initial mount fallback, the controller MUST also emit `onEngineChange` once with `{ previousKind: null, activeKind: "canvas2d", sampleCount, mode: "webgl2", reason: "webgl2-fallback" }`. On post-restore rehydration fallback, the controller MUST emit `onEngineChange` once with `{ previousKind: "webgl2", activeKind: "canvas2d", sampleCount, mode, reason: "webgl2-fallback" }`.
4. While `webgl2Fallback === true` in `"auto"` mode, subsequent data updates or renders with `sampleCount >= upThreshold` MUST NOT re-attempt `WebGL2FigureRenderer` construction on every frame.
5. Calling `controller.setMode("webgl2")` MUST clear `webgl2Fallback` so WebGL2 is attempted once (re-latching `webgl2Fallback = true` on failure). Calling `controller.retryWebGL2(): boolean` MUST clear `webgl2Fallback` to `false`, synchronize live payload/trace revisions and `sampleCount`, and—when `"webgl2"` is eligible and `gestureActive === false`—attempt the swap synchronously immediately (returning `true` if and only if `activeKind === "webgl2"` and `contextLost === false` after the attempt, or re-latching `webgl2Fallback = true` and returning `false` if WebGL2 creation/replay/render throws; returning `false` without swapping or tearing down listeners when `"webgl2"` is ineligible, `gestureActive === true`, or `activeKind === "webgl2"` with `contextLost === true`).

#### Scenario: WebGL2 construction failure during auto upgrade falls back to Canvas2D and latches webgl2Fallback
- **GIVEN**: a controller in `"auto"` mode on `"canvas2d"` where the injected `createWebGL2Renderer` throws a `TypeError` (or in Chromium, `getContext("webgl2")` returns `null`)
- **WHEN**: `setData` is called with `100_000` samples and `render()` runs
- **THEN**: no unhandled exception is thrown, `controller.activeKind` remains `"canvas2d"`, `controller.webgl2Fallback` is `true`, `container.querySelectorAll("canvas")` still contains the `1` live Canvas2D canvas, and `onWebGL2Fallback` is called once with `{ error, attemptedMode: "auto", sampleCount: 100_000 }`

#### Scenario: Fallback latch prevents per-frame WebGL2 retry thrashing until retryWebGL2 or setMode("webgl2") is called
- **GIVEN**: a controller in `"auto"` mode with `webgl2Fallback === true` after a failed WebGL2 upgrade at `100_000` samples
- **WHEN**: `render()` is called 10 additional times at `100_000` samples, and then `retryWebGL2()` is called after WebGL2 becomes available
- **THEN**: zero WebGL2 construction attempts occur during the 10 renders while latched, and calling `retryWebGL2()` synchronously returns `true`, clears `webgl2Fallback` to `false`, and upgrades `activeKind` to `"webgl2"` with `reason === "webgl2-retry"`

#### Scenario: Initial construction in webgl2 mode mounts fallback Canvas2D before firing fallback and change events
- **GIVEN**: an environment where WebGL2 creation throws, and event listeners recording `controller.activeKind`, `container.querySelectorAll("canvas").length`, `onWebGL2Fallback`, and `onEngineChange` in order
- **WHEN**: `createSpectrumEngineController({ container, mode: "webgl2", onWebGL2Fallback, onEngineChange })` is called
- **THEN**: construction succeeds without throwing, the fallback `Canvas2DRenderer` is constructed, replayed, and mounted (`1` canvas in `container`) BEFORE either callback runs, `onWebGL2Fallback` is invoked once, `onEngineChange` is invoked once with `{ previousKind: null, activeKind: "canvas2d", sampleCount: 0, mode: "webgl2", reason: "webgl2-fallback" }`, `controller.activeKind` is `"canvas2d"`, and `controller.webgl2Fallback` is `true`

#### Scenario: Real Chromium browser swap and WebGL2 fallback produce painted non-blank frames
- **GIVEN**: the Chromium Playwright visual/browser test suite (`packages/renderers/test/visual/engine-controller.visual.test.ts`) running against real `Canvas2DRenderer` and `WebGL2FigureRenderer` without injected renderer fakes
- **WHEN**: a controller in `"auto"` mode renders `10_000` samples (`1` canvas, `"canvas2d"`), crosses to `80_000` samples (`3` stacked canvases, `"webgl2"`), returns to `64_000` samples (`1` canvas, `"canvas2d"`), and a second controller with `HTMLCanvasElement.prototype.getContext` returning `null` for `"webgl2"` attempts `mode: "webgl2"`
- **THEN**: both `"canvas2d"` and `"webgl2"` topologies paint non-blank trace pixels in Chromium with preserved domain and dimensions, and the forced-null WebGL2 controller falls back cleanly to a live painted `"canvas2d"` frame with `webgl2Fallback === true`

### Requirement: Preservation of `setDecimation(undefined)` Backend Defaults and Optional `DecimationPort` Drainage
The controller MUST store the caller's exact `decimation: DecimationSelection | undefined` passed via constructor options or `controller.setDecimation(selection)` and replay that exact value to `incoming.setDecimation(decimation)` on every engine swap:
- When `controller.decimation === undefined`, `Canvas2DRenderer` applies its native default (LTTB at `min(sampleCount, max(2, ceil(plotWidth * 2)))`) and `WebGL2FigureRenderer` applies its native default (full payload `[0, sampleCount)` with zero CPU decimation).
- When `controller.decimation` is an explicit `DecimationSelection` (`{ algorithm: "lttb", threshold? }` or `{ algorithm: "min-max", bucketCount? }`), both engines receive and execute that explicit selection identically.

When `decimationPort?: DecimationPort` is supplied in `SpectrumEngineControllerOptions`:
1. `settlementSink` MUST also be supplied; constructing a controller with `decimationPort` and without `settlementSink` MUST throw a `TypeError` synchronously before allocating any DOM element or renderer.
2. The controller MUST invoke `decimationPort.poll(settlementSink)` at the start of every `render()` pass before checking payload revisions, evaluating hysteresis, and rendering — **including while `contextLost === true`** so streaming worker transit leases continue draining back to the buffer pool instead of deadlocking backpressure while GPU drawing is suspended.
3. The caller retains ownership of `decimationPort.dispose()` and async frame wakeup (`controller.requestRender()`); `controller.dispose()` MUST NOT call `decimationPort.dispose()`.

All source files under `packages/renderers/src/controller/**` MUST comply with `no-worker-references.test.ts` and `payload-consumption.test.ts`.

#### Scenario: undefined decimation replays undefined to each backend so each uses its native default
- **GIVEN**: a controller created with `decimation: undefined`
- **WHEN**: the controller renders `20_000` samples on `"canvas2d"`, switches to `"webgl2"` at `80_000` samples, and switches back to `"canvas2d"` at `50_000` samples
- **THEN**: `controller.decimation` remains `undefined` throughout, the WebGL2 renderer receives `setDecimation(undefined)` (drawing full resolution `[0, 80_000)`), and the replacement Canvas2D renderer receives `setDecimation(undefined)` (restoring viewport-derived LTTB)

#### Scenario: Explicit DecimationSelection replays identically across engine swaps
- **GIVEN**: a controller with `controller.setDecimation({ algorithm: "min-max", bucketCount: 512 })`
- **WHEN**: the controller switches from `"canvas2d"` to `"webgl2"`
- **THEN**: the incoming `WebGL2FigureRenderer` receives `setDecimation({ algorithm: "min-max", bucketCount: 512 })` before `incoming.render()` runs

#### Scenario: Providing decimationPort without settlementSink throws TypeError synchronously
- **GIVEN**: a valid `DecimationPort` instance and `settlementSink: undefined`
- **WHEN**: `createSpectrumEngineController({ container, decimationPort })` is called
- **THEN**: a `TypeError` is thrown synchronously and zero `<canvas>` elements are mounted in `container`

#### Scenario: Attached DecimationPort is polled before each render pass (including while contextLost) and is not disposed by controller.dispose
- **GIVEN**: a controller configured with an instrumented `DecimationPort` and `settlementSink`
- **WHEN**: `controller.render()` runs while healthy and again while `contextLost === true`, and subsequently `controller.dispose()` is called
- **THEN**: `decimationPort.poll(settlementSink)` executes before revision evaluation on both passes (while `activeRenderer.render()` is skipped during `contextLost === true`), and `decimationPort.dispose()` is called `0` times by `controller.dispose()`

### Requirement: Explicit Mutator Contract, Zero-Allocation Steady-State `render()`, `ResizeObserver` Integration, `rAF` Frame Coalescing, and Idempotent `dispose()`
The controller MUST enforce explicit, deterministic mutator and scheduling semantics:
1. `setData`, `setTraces`, `setDomain`, and `setDecimation` MUST NOT auto-schedule `requestRender()` and MUST NOT draw. `setData` and `setTraces` synchronously update `sampleCount` and revision snapshots; engine swaps driven by data changes execute on `render()` (or the scheduled `requestRender()` frame).
2. `controller.resize(width, height, dpr)` and `controller.render()` MUST execute synchronously. If `controller.render()` is called while a `requestRender()` animation frame is pending, the pending frame MUST be cancelled so the same state is not rendered twice.
3. Steady-state `controller.render()` calls with unchanged inputs (no revision change, no threshold or mode switch) MUST execute without allocating hysteresis wrapper objects, TypedArrays, or per-frame closures.
4. `controller.requestRender()` MUST schedule at most one pending frame via `requestAnimationFrame` (or an injected `requestAnimationFrame` seam); multiple mutations before the frame callback fires MUST coalesce into a single hysteresis evaluation and render pass. While `contextLost === true`, `requestRender()` MUST suppress scheduling unless a non-gesture-blocked transition to `"canvas2d"` is pending.
5. When `autoResize !== false` and `ResizeObserver` is available (via `globalThis.ResizeObserver` or an injected `resizeObserverFactory`), the controller MUST observe `container`, read positive CSS dimensions and `dpr` (via an injectable `getDevicePixelRatio` defaulting to `window.devicePixelRatio || 1`), apply `resize(cssWidth, cssHeight, dpr)`, and call `requestRender()`.
6. `controller.dispose()` MUST be idempotent: it MUST detach any active WebGL2 context listeners and clear `boundPlotCanvas = null` and `contextLost = false` **before** calling `dispose()` on the active internal renderer, cancel any pending scheduled frame via `cancelAnimationFrame`, disconnect the `ResizeObserver`, remove all managed `<canvas>` elements from `container` (setting `controller.canvases` to an empty array), and set `disposed = true`. After `dispose()`, every mutating and rendering method on `SpectrumEngineController` MUST be a no-op that never throws, schedules frames, or allocates contexts.

#### Scenario: Data, domain, and decimation mutators do not draw or auto-schedule requestRender
- **GIVEN**: a controller with injected recording renderer fakes and an injected manual `requestAnimationFrame` queue
- **WHEN**: `setData(payload)`, `setDomain(0, 10, -1, 1)`, and `setDecimation({ algorithm: "lttb" })` are called without calling `render()` or `requestRender()`
- **THEN**: `requestAnimationFrame` call count is `0`, the active renderer's `render()` call count is `0`, and `controller.sampleCount` already reflects `payload.sampleCount`

#### Scenario: Multiple mutations within one frame coalesce into a single render pass
- **GIVEN**: a controller with an injected manual `requestAnimationFrame` / `cancelAnimationFrame` queue
- **WHEN**: `setData(payloadA)`, `setDomain(0, 10, -1, 1)`, `setDecimation({ algorithm: "lttb" })`, and `setData(payloadB)` are called with `requestRender()` before flushing the frame queue
- **THEN**: `requestAnimationFrame` was scheduled exactly once, and flushing the frame queue executes the active renderer's `render()` exactly once with the final coalesced state (`payloadB`)

#### Scenario: Steady-state render executes without hysteresis wrapper object allocations
- **GIVEN**: a controller in `"auto"` mode with a settled payload and unchanging revision, using an injected spy/instrumented renderer
- **WHEN**: `controller.render()` is invoked repeatedly across 100 steady-state frames
- **THEN**: no engine swap occurs, no `<canvas>` is created, and the controller's steady-state path bypasses per-frame hysteresis result wrapper allocation

#### Scenario: ResizeObserver updates container size and schedules a coalesced render
- **GIVEN**: a controller constructed with an injected `resizeObserverFactory`, `getDevicePixelRatio: () => 2`, and manual `requestAnimationFrame` queue
- **WHEN**: the observed `container` emits a resize entry with `800 x 500` CSS pixels and the frame queue flushes
- **THEN**: `controller.width === 800`, `controller.height === 500`, `controller.dpr === 2`, `controller.transform.deviceWidth === 1600`, `controller.transform.deviceHeight === 1000`, `controller.transform.dpr === 2`, the mounted canvas backing store is `1600 x 1000`, and the active renderer's `render()` runs once

#### Scenario: dispose detaches GL listeners, cancels pending frame, disconnects ResizeObserver, removes canvases, and makes subsequent calls no-ops
- **GIVEN**: a live WebGL2 controller with a pending `requestRender()` frame, an active `ResizeObserver`, and an instrumented renderer factory
- **WHEN**: `controller.dispose()` is called twice, followed by `setData`, `setTraces`, `setDomain`, `resize`, `setDecimation`, `setMode`, `setGestureActive`, `retryWebGL2`, `render`, `requestRender`, and `clear`
- **THEN**: active GL context listeners are removed before `activeRenderer.dispose()`, `cancelAnimationFrame` is called once, `ResizeObserver.disconnect()` is called once, the active renderer's `dispose()` is called once, `controller.canvases` has length `0`, `container.querySelectorAll("canvas")` has length `0`, `controller.disposed` is `true`, `controller.contextLost` is `false`, and none of the post-dispose calls throws or schedules a frame

### Requirement: Exiting Context-Lost State via Mode Switching, Hysteresis-Down, Gesture Interoperability, and Timer-Free Permanent Loss
While `controller.activeKind === "webgl2"` and `controller.contextLost === true`:
1. **Explicit mode exit (`setMode("canvas2d")`)**:
   - When `gestureActive === false`, calling `controller.setMode("canvas2d")` MUST immediately detach WebGL2 context listeners, clear `contextLost = false`, dispose the lost WebGL2 renderer safely, and mount a live painted `Canvas2DRenderer` (emitting `onEngineChange` with `reason: "mode-change"`). Any late `webglcontextrestored` event dispatched on the detached old `plot` canvas MUST be ignored.
   - When `gestureActive === true`, calling `controller.setMode("canvas2d")` MUST defer the swap (`pendingKind === "canvas2d"`) and flush cleanly to live `"canvas2d"` with `contextLost === false` when `controller.setGestureActive(false)` is called (`reason: "gesture-end"`).
2. **Hysteresis-down exit (`mode === "auto"`)**:
   - When `sampleCount` drops to `<= downThreshold` in `"auto"` mode while `contextLost === true` and `gestureActive === false`, `controller.requestRender()` MUST NOT suppress scheduling the transition frame, and `controller.render()` MUST detach WebGL2 listeners, clear `contextLost = false`, dispose the lost WebGL2 renderer safely, and mount a live painted `Canvas2DRenderer` (`reason: "hysteresis-down"`).
3. **Mid-gesture interoperability (`ViewportInteractionController` & `setGestureActive`)**:
   - Because `ViewportInteractionController` captures pointer events on `controller.container` (not child canvases) and `setDomain()` remains live while `contextLost === true`, active pan, wheel-zoom, and box-zoom gestures MUST continue updating `controller.domain` and `controller.transform` without throwing.
   - If `webglcontextrestored` arrives while `gestureActive === true`, in-place rehydration MUST keep the exact same `<canvas>` elements mounted in `container` and repaint the active gesture's latest `domain` immediately without breaking pointer capture or executing a deferred engine-kind switch.
4. **Timer-free permanent-loss policy and `retryWebGL2()` while lost**:
   - The controller MUST NOT schedule any internal recovery timeout timer (`setTimeout` / `setInterval`) while `contextLost === true`. Host applications needing a timeout or status indicator observe `onContextLost` and may invoke `controller.setMode("canvas2d")` on demand.
   - Calling `controller.retryWebGL2()` while `activeKind === "webgl2"` and `contextLost === true` MUST NOT throw, MUST NOT tear down or detach the pending `webglcontextrestored` listener, and MUST return `false` (reflecting that WebGL2 is not currently operational).

#### Scenario: setMode("canvas2d") while contextLost exits immediately into live Canvas2D and ignores late restore
- **GIVEN**: a `SpectrumEngineController` in Happy-DOM active on `"webgl2"` with `contextLost === true`, `gestureActive === false`, `oldPlot = controller.canvases[1]`, and `onEngineChange` / `onContextRestored` spies
- **WHEN**: `controller.setMode("canvas2d")` is called and subsequently `new Event("webglcontextrestored")` is dispatched on `oldPlot`
- **THEN**: `controller.activeKind === "canvas2d"`, `controller.contextLost === false`, `controller.canvases` holds `1` live Canvas2D canvas, `onEngineChange` fires once with `{ previousKind: "webgl2", activeKind: "canvas2d", reason: "mode-change", ... }`, and the late `webglcontextrestored` on `oldPlot` fires `onContextRestored` `0` times

#### Scenario: setMode("canvas2d") while contextLost and mid-gesture defers cleanly until setGestureActive(false)
- **GIVEN**: a WebGL2 controller in Happy-DOM with `contextLost === true` and `gestureActive === true`
- **WHEN**: `controller.setMode("canvas2d")` is called, followed by `controller.setGestureActive(false)`
- **THEN**: while `gestureActive === true`, `controller.activeKind` remains `"webgl2"`, `controller.pendingKind === "canvas2d"`, and `controller.contextLost === true`; on `setGestureActive(false)`, the controller transitions to `activeKind === "canvas2d"`, `pendingKind === null`, `contextLost === false`, with `onEngineChange` emitting `reason: "gesture-end"`

#### Scenario: Hysteresis-down below downThreshold while contextLost switches to live Canvas2D
- **GIVEN**: a controller in `"auto"` mode (`upThreshold: 80_000`, `downThreshold: 64_000`) active on `"webgl2"` with `contextLost === true` and `gestureActive === false`, using a manual `rAF` queue
- **WHEN**: `setData(payloadWith30kSamples)` and `requestRender()` are called and the single scheduled `rAF` frame flushes
- **THEN**: `requestRender()` schedules a frame for the pending `"canvas2d"` transition, flushing executes the swap to `activeKind === "canvas2d"` with `contextLost === false`, detaches the old WebGL2 listeners, and emits `onEngineChange` with `reason: "hysteresis-down"`

#### Scenario: ViewportInteractionController gestures survive context loss and mid-gesture in-place restore
- **GIVEN**: a `SpectrumEngineController` on `"webgl2"` paired with `createViewportInteractionController({ controller })` in Happy-DOM, with an active pointer-drag pan (`gestureActive === true`)
- **WHEN**: `webglcontextlost` fires mid-drag, additional `pointermove` events pan `controller.domain` while `contextLost === true`, and `webglcontextrestored` fires before `pointerup`
- **THEN**: zero errors are thrown, `controller.domain` updates continuously during the lost window, `controller.canvases[1]` remains the exact same `HTMLCanvasElement` reference after restore (pointer capture on `container` unbroken), the restored WebGL2 frame paints the panned domain, and `pointerup` completes the gesture cleanly (`gestureActive === false`)

#### Scenario: Permanent context loss starts zero timers and retryWebGL2() returns false without removing the restore listener
- **GIVEN**: a WebGL2 controller in Happy-DOM with fake timers enabled (`vi.useFakeTimers()`), currently in `contextLost === true`
- **WHEN**: `vi.advanceTimersByTime(60_000)` runs, `controller.retryWebGL2()` is called, and subsequently `new Event("webglcontextrestored")` is dispatched on `controller.canvases[1]`
- **THEN**: advancing timers triggers `0` automatic mode changes or fallbacks, `retryWebGL2()` returns `false` without throwing and leaves `controller.contextLost === true`, and the later `webglcontextrestored` event still restores the controller to `contextLost === false` with `onContextRestored` firing `restoreCount: 1`
