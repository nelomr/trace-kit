---
"@trace-kit/core": patch
"@trace-kit/renderers": patch
"@trace-kit/playground": patch
---

- Implement pure, DOM-free, allocation-free viewport interaction math (`computeZoomDomain`, `computePanDomain`, `computeBoxZoomDomain`, `clampViewportDomain`, `createPanGestureSnapshot`, `capturePanGestureSnapshot`, `computeUlpMinSpan`, `createMutableViewportDomain`) and decimation-invalidation bridge helpers (`createStreamingInvalidationAdapter`, `createWindowDecimationAdapter`) in `@trace-kit/core`.
- Implement Option 2A single-axis `yAxes.length === 1` `setDomain` support in `Canvas2DRenderer` and `WebGL2FigureRenderer`, preserving the frozen 11-member `FigureRenderer` contract and multi-axis registrations.
- Implement framework-agnostic `createViewportInteractionController` composing over `SpectrumEngineController` under `@trace-kit/renderers/controller` with pointer/wheel input normalization (`classifyPointerRegion`, `normalizeWheelDeltaPx`, `resolveWheelAxisMask`), CSS-composited sibling box-zoom overlay (`<div data-trace-kit-overlay="box-zoom">`) with 5-state machine, and frame-budget-debounced invalidation scheduler coordinating `gesture`/`settled` phases with `setGestureActive` hysteresis deferral.
- Add `/viewport-interaction` view to `@trace-kit/playground` demonstrating pan, cursor-anchored wheel zoom, axis-gutter gestures, Shift+drag box-zoom, deep zoom near 1550.0001 nm, single-axis log-Y interaction, live debounced re-decimation, and telemetry HUD.
