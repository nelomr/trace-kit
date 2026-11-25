# Capability: vue-ssr-and-lifecycle

> Strict SSR isomorphism under Node `vue/server-renderer` (`renderToString`), zero-warning client hydration (`createSSRApp`), component vs standalone `effectScope()` mounting semantics, guaranteed `interaction.dispose()` -> `controller.dispose()` teardown ordering, idempotent disposal, and multi-cycle leak freedom.

## Requirements

### Requirement: Zero DOM Global Access at Module Import Time and During `setup()` / Node SSR
Evaluating `import("@trace-kit/vue")` or `require("@trace-kit/vue")` in a plain Node process where `window`, `document`, `ResizeObserver`, `HTMLCanvasElement`, and `requestAnimationFrame` are all `undefined` MUST succeed without throwing and MUST NOT access or mutate any DOM global. Executing `setup()` for `<TraceSpectrumViewer>` or invoking `useSpectrumEngine` during server-side rendering via `vue/server-renderer`'s `renderToString` MUST NOT access `window`, `document`, `ResizeObserver`, `HTMLCanvasElement`, or `requestAnimationFrame`, and MUST leave `controller.value === null`, `interaction.value === null`, and `isReady.value === false`.

#### Scenario: Importing @trace-kit/vue in plain Node with zero DOM globals succeeds cleanly
- **GIVEN**: a Vitest test running in the `vue` (`environment: "node"`) project where `typeof window === "undefined"`, `typeof document === "undefined"`, `typeof ResizeObserver === "undefined"`, `typeof HTMLCanvasElement === "undefined"`, and `typeof requestAnimationFrame === "undefined"`
- **WHEN**: `@trace-kit/vue` is imported dynamically
- **THEN**: the import resolves without throwing and exports `useSpectrumEngine`, `TraceSpectrumViewer`, and `snapshotDomain`

#### Scenario: renderToString renders deterministic static HTML in Node without touching DOM globals
- **GIVEN**: a `createSSRApp` rendering `<TraceSpectrumViewer class="ssr-chart" style="height: 300px" :data="payload" />` inside the `vue` (`environment: "node"`) project
- **WHEN**: `renderToString(app)` executes in Node with zero DOM globals
- **THEN**: `renderToString` resolves without throwing and produces deterministic HTML containing `<div data-trace-kit-viewer=""` (preserving `class="ssr-chart"` and `position:relative` + `height:300px`), a childless `<div data-trace-kit-surface=""`, zero `<canvas>` elements, and zero `[data-trace-kit-slot-overlay]` elements when no `#overlay` slot is provided

#### Scenario: renderToString renders sibling slot-overlay and default slot markup deterministically in Node
- **GIVEN**: a `createSSRApp` rendering `<TraceSpectrumViewer>` with both `#overlay` (displaying static/initial slot props where `isReady === false`) and `#default` slots inside the `vue` (`environment: "node"`) project
- **WHEN**: `renderToString(app)` executes
- **THEN**: the returned HTML contains `<div data-trace-kit-surface=""` (empty), followed by `<div data-trace-kit-slot-overlay=""` containing the `#overlay` content, followed by the `#default` slot content inside `<div data-trace-kit-viewer=""`

### Requirement: Zero-Warning Client Hydration (`createSSRApp`)
Server-rendered HTML produced by `renderToString` for `<TraceSpectrumViewer>` — both without slots and with `#overlay` / `#default` slots — MUST hydrate cleanly on the client via `createSSRApp(...).mount(host)` with zero Vue hydration mismatch warnings (`app.config.warnHandler` invoked `0` times and zero `console.warn`/`console.error` hydration diagnostics). Imperative controller mounting and `<canvas>` insertion MUST occur strictly post-hydration inside `onMounted()`.

#### Scenario: SSR markup hydrates cleanly via createSSRApp with zero warnings and mounts canvases post-hydration
- **GIVEN**: an SSR HTML string rendered via `renderToString` for `<TraceSpectrumViewer>` (tested both bare and with `#overlay` + `#default` slots) injected into a Happy-DOM container (`vue-dom`), with `app.config.warnHandler` and `console.warn` spied
- **WHEN**: `createSSRApp(...)` hydrates onto that container and `nextTick()` completes
- **THEN**: `warnHandler` is called `0` times, zero hydration warnings are logged, `isReady.value === true`, and `SpectrumEngineController`'s `<canvas>` node(s) are mounted inside `[data-trace-kit-surface]`

### Requirement: Dual Lifecycle Modes — Component (`onMounted` / `v-if` Rebind / `onBeforeUnmount`) vs Standalone `effectScope()`
`useSpectrumEngine` MUST detect whether it is invoked inside a Vue component instance (`getCurrentInstance() !== null`) or inside a standalone `effectScope()` (`getCurrentInstance() === null`):
- **Inside a Vue component**: Controller creation MUST wait strictly until `onMounted()`. After mount, a post-flush watcher on `containerRef` MUST handle dynamic attach/detach transitions (such as `v-if` toggling the host element off and back on, or swapping to a different `HTMLElement`): detaching to `null` MUST dispose the active controllers immediately, and re-attaching a new `HTMLElement` MUST construct and synchronize fresh controllers and emit `onReady`. Unmounting MUST tear down deterministically in `onBeforeUnmount()` with an idempotent `onScopeDispose()` safety net.
- **Inside a standalone `effectScope()`**: When `typeof document !== "undefined"`, `useSpectrumEngine` MUST mount via `watch(containerRef, ..., { immediate: true, flush: "post" })` and tear down automatically when `scope.stop()` triggers `onScopeDispose()`. When `typeof document === "undefined"` (Node SSR), it MUST stay cleanly inert (`controller.value === null`, `interaction.value === null`, `isReady.value === false`) without throwing.

#### Scenario: Component lifecycle mounts strictly in onMounted, rebinds across v-if container toggles, and disposes on unmount
- **GIVEN**: a Vue component in `vue-dom` using `useSpectrumEngine(containerRef, options)` whose template toggles the host `<div>` with `v-if="showHost"`
- **WHEN**: (1) `setup()` runs before mount, (2) the component mounts with `showHost = true`, (3) `showHost` toggles `false` and flushes, (4) `showHost` toggles back to `true` and flushes, and (5) the app unmounts
- **THEN**: (1) during `setup()`, `controller.value === null` and `isReady.value === false`; (2) after mount, `controller1` is active and `isReady.value === true`; (3) on `showHost = false`, `controller1.disposed === true` and `controller.value === null` and `isReady.value === false`; (4) on `showHost = true`, a fresh `controller2 !== controller1` attaches and `isReady.value === true`; (5) on unmount, `controller2.disposed === true` and `controller.value === null`

#### Scenario: Standalone effectScope mounts in Happy-DOM and disposes cleanly on scope.stop()
- **GIVEN**: a standalone `effectScope()` in `vue-dom` calling `useSpectrumEngine(shallowRef(hostElement), { platform })` outside any Vue component
- **WHEN**: `nextTick()` flushes and then `scope.stop()` is called
- **THEN**: before `scope.stop()`, `controller.value !== null` and `isReady.value === true`; after `scope.stop()`, both `interaction.disposed === true` and `controller.disposed === true`, `controller.value === null`, `interaction.value === null`, and `isReady.value === false`

#### Scenario: Standalone effectScope stays cleanly inert in Node SSR without throwing
- **GIVEN**: a standalone `effectScope()` inside the `vue` (`environment: "node"`) project calling `useSpectrumEngine(shallowRef(null))`
- **WHEN**: the scope runs and then `scope.stop()` is called
- **THEN**: zero errors are thrown, `controller.value === null`, `interaction.value === null`, and `isReady.value === false`

### Requirement: Strict Teardown Ordering (`interaction.dispose()` Before `controller.dispose()`), Idempotency, and Multi-Cycle Leak Freedom
Every teardown path (`onBeforeUnmount`, `onScopeDispose`, `containerRef` detachment, and explicit `dispose()`) MUST dispose `ViewportInteractionController` **strictly before** disposing `SpectrumEngineController` so `#releaseGestureActive()` executes against a live controller and inline `container.style.touchAction` is restored cleanly. After disposal:
- `controller.value` MUST be `null`, `interaction.value` MUST be `null`, `isReady.value` MUST be `false`, and `gestureState.value` MUST be `"idle"`.
- Calling `dispose()` multiple times MUST be completely idempotent (zero double-dispose errors, zero repeated teardown side effects).
- Running at least 20 consecutive mount/unmount cycles MUST leave zero active `ResizeObserver` subscriptions, zero pending `requestAnimationFrame` handles, zero retained `<canvas>` or `[data-trace-kit-overlay="box-zoom"]` nodes inside the host container, every created controller and interaction controller marked `disposed === true`, and container inline `touch-action` restored to its pre-mount value on every cycle.

#### Scenario: Teardown invokes interaction.dispose() strictly before controller.dispose() and is idempotent
- **GIVEN**: a mounted `useSpectrumEngine` in `vue-dom` with `interactive: true`, an active drag gesture in progress (`controller.gestureActive === true`), `container.style.touchAction = "auto"` prior to mount, and call-order spies on `interaction.dispose` and `controller.dispose`
- **WHEN**: the component unmounts (and `handle.dispose()` is additionally called twice afterward)
- **THEN**: `interaction.dispose()` executes strictly before `controller.dispose()`, `controller.setGestureActive(false)` ran while the controller was still alive, `container.style.touchAction` is restored to `"auto"`, `controller.value === null`, `interaction.value === null`, `isReady.value === false`, and the repeated `dispose()` calls are safe no-ops

#### Scenario: 20 consecutive mount/unmount cycles leak zero observers, rAF handles, DOM nodes, or touch-action mutations
- **GIVEN**: a test harness in `vue-dom` with injectable `platform.resizeObserverFactory`, `platform.requestAnimationFrame`, and `platform.cancelAnimationFrame` tracking live observer count and pending rAF handle count
- **WHEN**: `<TraceSpectrumViewer :data="payload" :interactive="true" :platform="platform" />` is mounted, receives a resize and a `requestRender()`, and is unmounted across `20` consecutive cycles
- **THEN**: after cycle `20`, active `ResizeObserver` count is `0`, pending `requestAnimationFrame` count is `0`, all `20` created `SpectrumEngineController` and `ViewportInteractionController` instances report `disposed === true`, the mount container has `0` lingering `<canvas>` or overlay `<div>` children, and pre-mount `touch-action` is restored cleanly
