# Capability: vue-spectrum-component

> Canonical pure-TypeScript `<TraceSpectrumViewer>` component (`/*#__PURE__*/ defineComponent` + `h()`) featuring a strict two-layer VDOM/hydration-safe DOM host, sibling `#overlay` and `#default` scoped slots, non-colliding `figureStyle` prop, `v-model:domain`, typed `emits`, typed `expose` (`SpectrumEngineHandle`), and 1:1 symmetry with `@trace-kit/react`.

## Requirements

### Requirement: Pure-TypeScript `TraceSpectrumViewer` Component With `/*#__PURE__*/` Annotation
`@trace-kit/vue` MUST export `TraceSpectrumViewer` authored in 100% pure TypeScript using `/*#__PURE__*/ defineComponent(...)` and Vue's `h()` render function (zero `.vue` Single File Components). The component definition MUST provide full TypeScript and Volar template type safety via typed `props`, typed `emits`, Vue 3.3+ `SlotsType` (`overlay` and `default` scoped slots), and typed `expose` (`SpectrumEngineHandle`).

#### Scenario: TraceSpectrumViewer mounts cleanly with createApp and h() in Happy-DOM
- **GIVEN**: a Vue 3 application created with `createApp` rendering `h(TraceSpectrumViewer, { data, mode: "canvas2d", platform })` in `vue-dom`
- **WHEN**: the app mounts into a container element
- **THEN**: `TraceSpectrumViewer` renders without errors, attaches `SpectrumEngineController` onto its inner surface element, and paints the bound payload

### Requirement: Strict Two-Layer VDOM-Isolated DOM Topology and Sibling Slots (`#overlay`, `#default`)
`<TraceSpectrumViewer>` MUST render a strict two-layer host structure that isolates imperative controller DOM mutations from Vue VDOM reconciliation:
1. **Outer root `<div data-trace-kit-viewer>`**: applies base `position: relative` styling and receives native fallthrough attributes (`$attrs`, `class`, `style`, and ARIA/keyboard attributes reserved for Change `11.5`).
2. **Inner imperative surface `<div data-trace-kit-surface>`**: styled with `position: absolute; inset: 0; width: 100%; height: 100%;` and containing **zero Vue VNode children** on both server and client. It is owned exclusively by `SpectrumEngineController` (1 Canvas2D `<canvas>` or 3 stacked WebGL2 `<canvas>` elements) and `ViewportInteractionController` (`<div data-trace-kit-overlay="box-zoom">`).
3. **Optional sibling overlay wrapper `<div data-trace-kit-slot-overlay>`**: rendered **only** when `slots.overlay` is provided, styled with `position: absolute; inset: 0; pointer-events: none;`, placed as a DOM sibling **after** `data-trace-kit-surface` so consumer HUD readouts (and future Change `13` crosshair / Change `13.3` range overlays) paint above all canvas layers without blocking canvas pointer events (interactive children opt in via `pointer-events: auto`).
4. **Optional trailing `#default` scoped slot**: rendered as a sibling inside `<div data-trace-kit-viewer>` **after** `data-trace-kit-surface` (and after `data-trace-kit-slot-overlay` when present), providing the clean insertion seam for Change `11.5`'s visually-hidden accessibility table and `aria-live` region.

Both `#overlay` and `#default` scoped slots MUST receive a typed `TraceSpectrumViewerSlotProps` object exposing readonly reactive snapshot values (`isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`). Updating reactive state inside `#overlay` or `#default` MUST NOT remove, detach, or disturb imperative `<canvas>` children inside `data-trace-kit-surface`.

#### Scenario: Two-layer DOM structure omits slot-overlay wrapper when slots are not provided
- **GIVEN**: `<TraceSpectrumViewer>` mounted in `vue-dom` with no `#overlay` or `#default` slots
- **WHEN**: the rendered DOM tree under the mount target is inspected
- **THEN**: the root element is `<div data-trace-kit-viewer>` with `position: relative`, its sole Vue-rendered child is `<div data-trace-kit-surface>` with `position: absolute; inset: 0; width: 100%; height: 100%`, zero `[data-trace-kit-slot-overlay]` node exists, and `SpectrumEngineController`'s `<canvas>` node(s) live inside `[data-trace-kit-surface]`

#### Scenario: Overlay slot renders as pointer-events:none sibling after surface and preserves canvases across re-renders
- **GIVEN**: `<TraceSpectrumViewer>` mounted in `vue-dom` with an `#overlay` scoped slot rendering a reactive HUD readout (`count.value`) and an interactive button (`style="pointer-events: auto"`)
- **WHEN**: `count.value` increments multiple times and `nextTick()` completes
- **THEN**: `[data-trace-kit-slot-overlay]` is a sibling positioned immediately after `[data-trace-kit-surface]` with `pointer-events: none`, the HUD text updates to the new count, and the exact `<canvas>` DOM node(s) inside `[data-trace-kit-surface]` remain attached with identical DOM object references

#### Scenario: Default scoped slot renders as trailing sibling inside outer viewer and receives typed slot props
- **GIVEN**: `<TraceSpectrumViewer>` mounted in `vue-dom` with both `#overlay` and `#default` scoped slots
- **WHEN**: the children of `[data-trace-kit-viewer]` and the props received by `#default` are inspected
- **THEN**: `[data-trace-kit-viewer]` child order is `[data-trace-kit-surface]`, `[data-trace-kit-slot-overlay]`, then the `#default` slot node(s), and `#default` receives `isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, and `gestureState`

### Requirement: Non-Colliding `figureStyle` Prop, `$attrs` Fallthrough, and Grouped `platform` Seam
`<TraceSpectrumViewer>` MUST name its renderer styling prop `figureStyle?: Partial<FigureStyle>` rather than `style` so native HTML `style` and `class` attributes (plus `role`, `aria-label`, `tabindex`, and DOM event listeners) fall through cleanly onto the outer `<div data-trace-kit-viewer>` in full symmetry with Change `11` (`@trace-kit/react`). Low-level injectable engine seams (`createCanvas2DRenderer`, `createWebGL2Renderer`, `createCanvas`, `resizeObserverFactory`, `getDevicePixelRatio`, `requestAnimationFrame`, `cancelAnimationFrame`) MUST be grouped under a single optional `platform?: SpectrumEnginePlatformOptions` prop rather than cluttering top-level component props.

#### Scenario: HTML style, class, and ARIA attributes fall through to outer viewer while figureStyle configures the renderer
- **GIVEN**: `<TraceSpectrumViewer class="my-viewer" style="height: 320px; width: 640px" role="region" aria-label="Optical Spectrum" :figureStyle="{ backgroundColor: '#111111' }" :platform="platform" />` mounted in `vue-dom`
- **WHEN**: the rendered DOM root and renderer factory call options are inspected
- **THEN**: `[data-trace-kit-viewer]` has class `"my-viewer"`, preserves `position: relative` alongside `height: 320px` and `width: 640px`, carries `role="region"` and `aria-label="Optical Spectrum"`, does NOT leak `figureStyle` as a DOM attribute, and the renderer factory receives `style: { backgroundColor: "#111111" }`

### Requirement: `v-model:domain`, Full Typed `emits`, and Typed `expose` Handle (`SpectrumEngineHandle`)
`<TraceSpectrumViewer>` MUST declare and emit the complete 10-event contract aligned 1:1 with `@trace-kit/renderers/controller` and Change `11` (`@trace-kit/react`):
- `ready`: `(event: SpectrumEngineReadyEvent)` (`{ controller, interaction }`, both `markRaw`)
- `update:domain`: `(domain: ViewportDomain)` (plain `snapshotDomain()` for `v-model:domain`)
- `domainChange`: `(domain: ViewportDomain, reason: ViewportMutationReason)`
- `invalidate`: `(event: ViewportInvalidationEvent)`
- `boxSelect`: `(event: BoxSelectEvent)`
- `gestureStateChange`: `(event: GestureStateChangeEvent)`
- `engineChange`: `(event: EngineChangeEvent)`
- `webgl2Fallback`: `(event: WebGL2FallbackEvent)`
- `contextLost`: `(event: WebGL2ContextLostEvent)`
- `contextRestored`: `(event: WebGL2ContextRestoredEvent)`

`<TraceSpectrumViewer>` MUST expose the full `SpectrumEngineHandle` via Vue's `expose(...)` (matching `UseSpectrumEngineReturn`: raw `controller` and `interaction` refs, readonly shallow state refs, and all 11 no-op-guarded imperative methods including zero-VDOM `requestRender()`).

#### Scenario: v-model:domain binds bidirectionally with plain snapshots and zero echo loops
- **GIVEN**: a parent Vue component in `vue-dom` binding `domain` and `onUpdate:domain` (`v-model:domain`) onto `<TraceSpectrumViewer>`
- **WHEN**: (1) an interactive pan/wheel gesture mutates the viewport, and (2) the parent updates `parentDomain.value = { xMin: 15, xMax: 35, yMin: -40, yMax: 10 }` externally
- **THEN**: (1) `update:domain` emits a fresh plain non-proxied `ViewportDomain` snapshot that updates `parentDomain` without causing echo `setDomain` calls or snap-back, and (2) the external parent update applies `controller.setDomain(15, 35, -40, 10)` and schedules `controller.requestRender()`
- **GIVEN**: `<TraceSpectrumViewer>` mounted in `vue-dom` with listeners attached for all 10 declared events (`ready`, `update:domain`, `domainChange`, `invalidate`, `boxSelect`, `gestureStateChange`, `engineChange`, `webgl2Fallback`, `contextLost`, `contextRestored`)
- **WHEN**: mount, box-zoom selection, pan gesture, WebGL2 fallback, and context loss/restoration are exercised via injectable seams
- **THEN**: every event emits its exact typed payload, and the `ready` event's `controller` and `interaction` both satisfy `isProxy === false` and `isReactive === false`

#### Scenario: Component template ref exposes SpectrumEngineHandle with working imperative methods
- **GIVEN**: a parent component holding a template `ref<SpectrumEngineHandle | null>(null)` attached to `<TraceSpectrumViewer>` in `vue-dom`
- **WHEN**: after mount the parent accesses `viewerRef.value`
- **THEN**: `viewerRef.value` exposes `controller`, `interaction`, `isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`, and all 11 imperative methods (`render`, `requestRender`, `clear`, `setDomain`, `resize`, `retryWebGL2`, `resetDomain`, `zoomByFactor`, `panByFraction`, `cancelGesture`, `dispose`), and calling `viewerRef.value.requestRender()` repaints in-place payload revisions with zero Vue re-renders
