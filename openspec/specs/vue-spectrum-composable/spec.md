# Capability: vue-spectrum-composable

> Canonical `useSpectrumEngine(container, options)` composable providing reactive option diffing, fail-fast validation, deterministic `setTraces`-before-`setDomain` ordering, built-in `ViewportInteractionController` coordination, plain `snapshotDomain()` emissions with dual echo suppression, readonly shallow state, and safe no-op-guarded imperative controls.

## Requirements

### Requirement: Canonical `useSpectrumEngine(container, options)` API and Mount-Time Forwarding
`@trace-kit/vue` MUST export `useSpectrumEngine(container, options?)` accepting a `MaybeRefOrGetter<HTMLElement | null | undefined>` host container and optional `UseSpectrumEngineOptions`. Reactive options (`data`, `traces`, `revision`, `domain`, `mode`, `decimation`, `interactive`, `dragMode`, `homeDomain`) MUST accept `MaybeRefOrGetter<T>` values. Mount-time immutable options MUST be forwarded to `createSpectrumEngineController`: `figureStyle` (mapped to `style`), `axes`, `yAxes`, `hysteresis`, `decimationPort` (unwrapped via `toRaw`), `settlementSink` (unwrapped via `toRaw`), `autoResize` (default `true`), `initialWidth`, `initialHeight`, `initialDpr`, and grouped `platform` (`SpectrumEnginePlatformOptions`: `createCanvas2DRenderer`, `createWebGL2Renderer`, `createCanvas`, `resizeObserverFactory`, `getDevicePixelRatio`, `requestAnimationFrame`, `cancelAnimationFrame`).

#### Scenario: Mount-time options including figureStyle and grouped platform seams forward to createSpectrumEngineController
- **GIVEN**: a host `HTMLElement` in `vue-dom` and `useSpectrumEngine(containerRef, { figureStyle, axes, yAxes, hysteresis, autoResize: false, initialWidth: 640, initialHeight: 320, initialDpr: 2, platform })`
- **WHEN**: the component mounts
- **THEN**: `createSpectrumEngineController` receives `style: figureStyle`, `axes`, `yAxes`, `hysteresis`, `autoResize: false`, `initialWidth: 640`, `initialHeight: 320`, `initialDpr: 2`, and every injectable seam from `platform`, `isReady.value === true`, and `onReady` fires with `{ controller, interaction }`

### Requirement: Fail-Fast Mutual Exclusivity for `data` and `traces`, and Nullish `clear()` Semantics
`useSpectrumEngine` MUST enforce mutual exclusivity between `data` and `traces`: if both resolve to non-nullish (`!= null`) simultaneously — either during initial controller attachment or during a reactive update — the adapter MUST throw a synchronous `TypeError` rather than silently choosing one over the other. When an active controller transitions so that both `data` and `traces` are nullish (`null` or `undefined`), the adapter MUST invoke `controller.clear()` and synchronize `sampleCount.value` to `0`.

#### Scenario: Simultaneous non-nullish data and traces at mount throws synchronous TypeError
- **GIVEN**: a host `HTMLElement` in `vue-dom` and `useSpectrumEngine` configured with both a valid `SpectrumDataPayload` (`data`) and a valid `TraceCollection` (`traces`)
- **WHEN**: the component mounts and attaches the controller
- **THEN**: a synchronous `TypeError` is thrown identifying that `data` and `traces` cannot be provided simultaneously

#### Scenario: Reactive update making both data and traces non-nullish throws synchronous TypeError
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with `data = shallowRef(payload)` and `traces = shallowRef<TraceCollection | null>(null)`
- **WHEN**: `traces.value = collection` is assigned while `data.value` is still non-nullish and Vue flushes watchers
- **THEN**: a synchronous `TypeError` is thrown without corrupting the existing active state

#### Scenario: Transitioning data or traces to nullish invokes controller.clear()
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` actively displaying `data = shallowRef(payload)` with `sampleCount.value > 0`
- **WHEN**: `data.value = null` is assigned (while `traces` is nullish) and `nextTick()` completes
- **THEN**: `controller.clear()` is invoked on the active controller and `sampleCount.value` becomes `0`

### Requirement: Deterministic `setTraces`/`setData`-Before-`setDomain` Sync Ordering and Explicit `requestRender()`
Because `SpectrumEngineController.setTraces(collection)` overwrites `effectiveDomain.xMin`/`xMax` with `collection.xDomainMin`/`collection.xDomainMax` and controller mutators do not auto-schedule frames, `useSpectrumEngine` MUST always apply `setTraces(...)` or `setData(...)` **before** applying an explicit `domain` — both on initial mount and whenever `traces`/`data` and `domain` change in the same reactive flush. After syncing reactive updates (`data`, `traces`, `domain`, `mode`, `decimation`), `useSpectrumEngine` MUST call `controller.requestRender()` so `SpectrumEngineController`'s single-slot rAF coalescing merges same-flush updates into a single frame.

#### Scenario: Initial mount with both traces and explicit domain preserves explicit domain
- **GIVEN**: a `TraceCollection` whose `xDomainMin` is `0` and `xDomainMax` is `100`, paired with an explicit `domain = { xMin: 20, xMax: 40, yMin: -60, yMax: 0 }` passed to `useSpectrumEngine` in `vue-dom`
- **WHEN**: the component mounts and flushes its initial rAF
- **THEN**: `controller.setTraces(rawTraces)` executes before `controller.setDomain(20, 40, -60, 0)`, and both `controller.domain` and reactive `domain.value` equal `{ xMin: 20, xMax: 40, yMin: -60, yMax: 0 }`

#### Scenario: Combined same-flush reactive update of traces and explicit domain preserves domain and coalesces to one render
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with an injectable rAF counter
- **WHEN**: in the same tick the caller updates `traces.value = nextCollection` (`xDomainMin: 0, xDomainMax: 500`) AND `domainRef.value = { xMin: 100, xMax: 200, yMin: -80, yMax: -10 }`, then awaits `nextTick()` and flushes rAF
- **THEN**: `controller.setTraces` runs before `controller.setDomain`, the resulting `controller.domain` is `{ xMin: 100, xMax: 200, yMin: -80, yMax: -10 }`, and only `1` coalesced rAF render frame executes

#### Scenario: Reactive mode and decimation updates forward to controller and schedule requestRender
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with reactive `mode = shallowRef<EngineSelectionMode>("auto")` and `decimation = shallowRef<DecimationSelection | undefined>(undefined)`
- **WHEN**: `mode.value = "canvas2d"` and `decimation.value = { algorithm: "lttb", threshold: 1024 }` are updated and `nextTick()` completes
- **THEN**: `controller.setMode("canvas2d")` and `controller.setDecimation({ algorithm: "lttb", threshold: 1024 })` are called, reactive `mode.value` updates to `"canvas2d"`, and `controller.requestRender()` is scheduled

### Requirement: Built-In `ViewportInteractionController` Coordination (`interactive = true` Default)
`useSpectrumEngine` MUST integrate `createViewportInteractionController` by default (`interactive` defaults to `true`):
- When `interactive` is omitted or `true` at mount, `useSpectrumEngine` MUST construct `ViewportInteractionController` over the active `SpectrumEngineController`, tag it with `markRaw(...)`, pass `dragMode` (default `"pan"`), `homeDomain`, and `interactionOptions` (`TraceViewportInteractionOptions`), and wire `onDomainChange`, `onInvalidate`, `onBoxSelect`, and `onGestureStateChange`.
- When `interactive` is `false` at mount, `useSpectrumEngine` MUST instantiate **zero** `ViewportInteractionController` (`interaction.value === null`), attach zero pointer/wheel listeners, insert zero `<div data-trace-kit-overlay="box-zoom">`, and leave container `style.touchAction` untouched.
- When `interactive` transitions from `false` to `true` at runtime, `useSpectrumEngine` MUST lazily construct and attach a single `ViewportInteractionController` using the current `dragMode`, `homeDomain`, and `interactionOptions`. Subsequent `true <-> false` transitions MUST delegate to `interaction.setEnabled(next)` without disposing and recreating the controller.
- Reactive changes to `dragMode` and `homeDomain` MUST forward to `interaction.setDragMode(next)` and `interaction.setHomeDomain(xMin, xMax, yMin, yMax)` when an interaction controller is attached (and be honored if lazily attached later).

#### Scenario: Default interactive=true attaches ViewportInteractionController and forwards interaction callbacks
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with default `interactive` and callbacks `onDomainChange`, `onInvalidate`, `onBoxSelect`, and `onGestureStateChange`
- **WHEN**: a user performs a drag-pan or wheel-zoom interaction on the host container
- **THEN**: `interaction.value` is a live `markRaw` `ViewportInteractionController`, container `style.touchAction` is `"none"`, `gestureState.value` tracks transitions, and `onDomainChange`, `onInvalidate`, and `onGestureStateChange` fire with expected payloads

#### Scenario: interactive=false at mount instantiates zero ViewportInteractionController and preserves touch-action
- **GIVEN**: a host container with `container.style.touchAction = "pan-y"` and `useSpectrumEngine` configured with `interactive: false` in `vue-dom`
- **WHEN**: the component mounts
- **THEN**: `interaction.value === null`, `onReady` receives `{ controller, interaction: null }`, zero `[data-trace-kit-overlay="box-zoom"]` element exists inside the container, and `container.style.touchAction` remains `"pan-y"`

#### Scenario: Runtime interactive toggle lazily attaches once and reuses setEnabled without churn
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` initialized with `interactive = shallowRef(false)`
- **WHEN**: `interactive.value = true` (flush), then `interactive.value = false` (flush), then `interactive.value = true` (flush)
- **THEN**: on the first `false -> true`, a single `ViewportInteractionController` instance `I` is created (`interaction.value === I`, `I.enabled === true`); on `true -> false`, `interaction.value` remains `I` with `I.enabled === false`; on the second `false -> true`, `interaction.value` is still the exact same instance `I` with `I.enabled === true`

#### Scenario: Reactive dragMode and homeDomain forward to ViewportInteractionController
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with reactive `dragMode = shallowRef<InteractionDragMode>("pan")` and `homeDomain = shallowRef<ViewportDomain>({ xMin: 0, xMax: 10, yMin: -1, yMax: 1 })`
- **WHEN**: `dragMode.value = "box-zoom"` and `homeDomain.value = { xMin: 5, xMax: 25, yMin: -50, yMax: 0 }` update and `nextTick()` completes
- **THEN**: `interaction.value?.dragMode === "box-zoom"` and `interaction.value?.homeDomain` equals `{ xMin: 5, xMax: 25, yMin: -50, yMax: 0 }`

### Requirement: Plain `snapshotDomain()` Emission and Dual Echo Suppression Guard
`@trace-kit/vue` MUST export the pure helper `snapshotDomain(domain: ViewportDomain): ViewportDomain` which returns a fresh, plain `{ xMin, xMax, yMin, yMax }` object copying the four scalar coordinates from `domain`. `@trace-kit/vue` MUST NEVER emit `controller.domain` (the live `#domainView` getter reference) into Vue reactive state, `onDomainChange`, `update:domain`, or `domainChange`. Instead, whenever interaction or programmatic mutation updates the domain, the adapter MUST:
1. Create a fresh snapshot `S = snapshotDomain(domain)`.
2. Record `S` in the adapter's emitted-snapshot tracker (e.g. `WeakSet<ViewportDomain>` / `lastEmittedDomain`) prior to emission.
3. Update shallow reactive `domain.value = S`.
4. Notify `onDomainChange(S, reason)` (and emit `update:domain(S)` / `domainChange(S, reason)` on `<TraceSpectrumViewer>`).

When an incoming reactive `domain` option/prop updates, the watcher MUST suppress echo feedback using **both** guards:
- **Guard 1 (Emitted reference identity echo)**: If `next` is a snapshot previously emitted by this adapter instance, ignore the update completely — preventing stale-frame snap-back when asynchronous Vue parent flushes deliver frame $k$'s emitted snapshot while an active 60 FPS gesture has already advanced `controller.domain` to frame $k+1$.
- **Guard 2 (4-scalar coordinate equality echo)**: If `next.xMin === cur.xMin && next.xMax === cur.xMax && next.yMin === cur.yMin && next.yMax === cur.yMax` against `controller.domain`, ignore the update — preventing redundant `setDomain()` + `requestRender()` loops when a consumer clones the emitted object (e.g., `parentDomain.value = { ...d }`).
- Only when both guards pass (a genuine external domain mutation) MUST the adapter call `controller.setDomain(next.xMin, next.xMax, next.yMin, next.yMax)`, refresh `domain.value = snapshotDomain(controller.domain)`, and call `controller.requestRender()`.

#### Scenario: snapshotDomain emits a detached immutable plain object immune to subsequent pan mutations
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with `onDomainChange` capturing emitted snapshots
- **WHEN**: two consecutive pan moves fire `onDomainChange` producing snapshots `S1` and `S2`
- **THEN**: `S1 !== controller.value?.domain`, `S1 !== S2`, `isProxy(S1) === false`, and `S1`'s `xMin`/`xMax`/`yMin`/`yMax` coordinates remain unchanged after `S2` is produced

#### Scenario: Guard 1 prevents stale-frame snap-back when async parent flush echoes an earlier emitted snapshot
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` bound to a reactive `domainRef` updated asynchronously from `onDomainChange`
- **WHEN**: rapid gesture frame `k` emits snapshot `S_k`, then before Vue flushes `domainRef`, gesture frame `k+1` advances `controller.domain` and emits `S_{k+1}`, and subsequently the delayed parent flush sets `domainRef.value = S_k` (and later `S_{k+1}`)
- **THEN**: neither `S_k` nor `S_{k+1}` triggers `controller.setDomain(...)`, and `controller.domain` remains at `S_{k+1}` without snapping backwards

#### Scenario: Guard 2 suppresses redundant setDomain and requestRender when parent clones the emitted domain
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` where `onDomainChange` sets `parentDomain.value = { ...snapshot }` (a new object with identical 4 scalars)
- **WHEN**: a pan or zoom gesture updates the domain and `nextTick()` flushes the `domain` watcher
- **THEN**: `controller.setDomain` is NOT called a second time and no redundant `controller.requestRender()` loop is triggered

#### Scenario: Genuine external domain change applies setDomain, refreshes reactive domain, and schedules requestRender
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` currently at `{ xMin: 0, xMax: 100, yMin: -1, yMax: 1 }`
- **WHEN**: the consumer sets `domainRef.value = { xMin: 10, xMax: 50, yMin: -20, yMax: 5 }` and `nextTick()` completes
- **THEN**: `controller.setDomain(10, 50, -20, 5)` is invoked once, `domain.value` equals `{ xMin: 10, xMax: 50, yMin: -20, yMax: 5 }`, and `controller.requestRender()` is called

### Requirement: Readonly Reactive State, All Lifecycle Callbacks, and No-Op-Guarded Imperative Handle
`useSpectrumEngine` MUST return a `UseSpectrumEngineReturn` object exposing:
- Raw refs: `controller`, `interaction` (`Readonly<ShallowRef<... | null>>`).
- Readonly shallow state refs: `isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`.
- Imperative methods: `render()`, `requestRender()`, `clear()`, `setDomain(xMin, xMax, yMin, yMax)`, `resize(width, height, dpr?)`, `retryWebGL2()`, `resetDomain()`, `zoomByFactor(factorX, factorY, normX?, normY?)`, `panByFraction(fractionX, fractionY)`, `cancelGesture()`, and `dispose()`.

Every imperative method MUST be safe to invoke before mount (`controller.value === null`) or after `dispose()`: void methods MUST no-op without throwing, and boolean-returning methods (`retryWebGL2`, `zoomByFactor`, `panByFraction`) MUST return `false`. Controller callbacks (`onEngineChange`, `onWebGL2Fallback`, `onContextLost`, `onContextRestored`) and interaction callbacks (`onDomainChange`, `onInvalidate`, `onBoxSelect`, `onGestureStateChange`) MUST update the corresponding reactive state refs before invoking consumer-provided callbacks.

#### Scenario: Imperative handle methods no-op safely before mount and after dispose
- **GIVEN**: a `useSpectrumEngine` return handle evaluated before mount (`containerRef.value === null`) and again after calling `dispose()` in `vue-dom`
- **WHEN**: every imperative method (`render`, `requestRender`, `clear`, `setDomain`, `resize`, `retryWebGL2`, `resetDomain`, `zoomByFactor`, `panByFraction`, `cancelGesture`, `dispose`) is called
- **THEN**: zero methods throw, and `retryWebGL2()`, `zoomByFactor(0.5, 1)`, and `panByFraction(0.1, 0)` each return `false`

#### Scenario: Controller lifecycle callbacks synchronize reactive state refs and forward events
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with `onEngineChange`, `onWebGL2Fallback`, `onContextLost`, and `onContextRestored` callbacks and injectable Canvas2D/WebGL2 seams
- **WHEN**: WebGL2 initialization triggers fallback, or WebGL2 switches via hysteresis, or `webglcontextlost` followed by `webglcontextrestored` fires on the WebGL2 plot canvas
- **THEN**: `activeKind.value`, `webgl2Fallback.value`, `contextLost.value`, and `sampleCount.value` update accurately to match `controller` state and each corresponding user callback fires with the exact event payload

#### Scenario: Imperative handle methods delegate to active controller and interaction controller
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with `interactive: true` and an initial domain `{ xMin: 0, xMax: 100, yMin: -10, yMax: 10 }`
- **WHEN**: the caller invokes `resize(900, 450, 2)`, `zoomByFactor(0.5, 0.5, 0.5, 0.5)`, `panByFraction(0.1, 0)`, `resetDomain()`, `cancelGesture()`, and `retryWebGL2()`
- **THEN**: each call delegates to the corresponding method on `controller` or `interaction`, updates reactive `domain.value` via `snapshotDomain(...)`, and returns the delegated boolean result
