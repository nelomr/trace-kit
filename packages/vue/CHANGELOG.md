# @trace-kit/vue

## 0.0.1

### Patch Changes

- [`dd9467f`](https://github.com/nelomr/trace-kit/commit/dd9467f42b447faee29e23593e197ac747063014) Thanks [@nelomr](https://github.com/nelomr)! - Implement `@trace-kit/vue` zero-proxy, SSR-safe Vue 3 adapter for TraceKit spectrum visualization:
  - Export canonical `useSpectrumEngine` composable and `TraceSpectrumViewer` component (`/*#__PURE__*/ defineComponent`) alongside `snapshotDomain` helper.
  - Enforce defense-in-depth reactivity isolation with `markRaw()` on `SpectrumEngineController` and `ViewportInteractionController`, `shallowRef()` / `shallowReadonly(shallowRef)` state, defensive `toRaw()` unwrapping at adapter boundaries, and zero deep watchers.
  - Support dual 60 Hz streaming seam via zero-VDOM imperative `requestRender()` hot path and declarative scalar `:revision` trigger for in-place `commitPayloadRevision()` mutations.
  - Implement bidirectional `v-model:domain` synchronization using plain `snapshotDomain` objects and dual echo guard (emitted-reference identity via `WeakSet<ViewportDomain>` / reference check and 4-scalar coordinate equality) to eliminate 60 FPS drag snap-back and cloned-object render loops.
  - Deliver two-layer DOM topology with outer `<div data-trace-kit-viewer>` receiving attributes, style, and class, inner childless `<div data-trace-kit-surface>` owned exclusively by engine and interaction controllers, optional `#overlay` slot with `pointer-events: none` container, and trailing `#default` slot.
  - Provide non-colliding `figureStyle` prop (`Partial<FigureStyle>`) avoiding collisions with native HTML `style` fallthrough.
  - Ensure strict SSR isomorphism with zero DOM access at module evaluation or setup time, deterministic `renderToString` markup, zero-warning client hydration, and deterministic teardown ordering (`interaction.dispose()` before `controller.dispose()`).
  - Declare `"peerDependencies": { "vue": "^3.4.0" }` with catalog discipline peer dependency exemption.
