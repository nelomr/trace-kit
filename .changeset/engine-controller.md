---
"@trace-kit/renderers": patch
"@trace-kit/playground": patch
---

Implement the dual-engine controller (`@trace-kit/renderers/controller`) and the `/engine-controller` interactive view in `@trace-kit/playground`.

**Renderers (`@trace-kit/renderers`).**

- **Controller subpath & lifecycle management:** Add `SpectrumEngineController` and `createSpectrumEngineController` in a dedicated, tree-shakable `@trace-kit/renderers/controller` entry point (keeping root `"."` free of WebGL2 and `./controller` free of `./svg` and `./font` bundles), supporting `"auto" | "canvas2d" | "webgl2"` modes, `setData` / `setTraces` with in-place `payload.revision` tracking and `xOrigin` reconciliation, zero-allocation `setDomain`, `setDecimation(undefined)` backend-default preservation, optional `DecimationPort.poll(settlementSink)` drainage, `ResizeObserver` auto-resizing, `requestAnimationFrame` coalescing, and idempotent `dispose()`.
- **Hysteresis policy & gesture deferral:** Export pure hysteresis helpers (`DEFAULT_HYSTERESIS_CONFIG`, `resolveHysteresisConfig`, `classifyHysteresisBand`, `evaluateHysteresisTarget`, `computePayloadSampleCount`, `computeTracesSampleCount`) with configurable two-threshold deadband (`upThreshold = 80_000`, `downThreshold = 64_000`, `0 < downThreshold < upThreshold`) and `setGestureActive(boolean)` mid-gesture switch deferral.
- **Zero-flicker atomic DOM swap & leak-free WebGL2 fallback:** Stage incoming 1-canvas (`Canvas2DRenderer`) or 3-stacked-canvas (`WebGL2FigureRenderer`) surfaces off-DOM, replay authoritative state (`resize` -> `setData`/`setTraces` -> `setDomain` -> `setDecimation`), pre-render synchronously, swap DOM nodes preserving sibling overlay z-order via `insertBefore`, and dispose the outgoing renderer synchronously; on WebGL2 construction, replay, or pre-render failure, dispose any partial incoming renderer, latch `webgl2Fallback`, mount `Canvas2DRenderer`, and notify `onWebGL2Fallback` / `onEngineChange`.

**Playground (`@trace-kit/playground`).**

- **Interactive `/engine-controller` view:** Register `/engine-controller` via the additive route registry with sample-count presets (`10k`–`250k`) and slider across the `64k ↔ 80k` hysteresis deadband, mode override (`auto` / `canvas2d` / `webgl2`), decimation controls, gesture-lock deferral toggle, simulated WebGL2 failure fallback toggle, and a live 9-field telemetry HUD.
