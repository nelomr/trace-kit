---
"@trace-kit/renderers": patch
---

Implement WebGL2 context loss lifecycle management and in-place GPU resource rehydration in `SpectrumEngineController` and `WebGL2FigureRenderer`.

- Add controller-owned lifecycle management for `webglcontextlost` and `webglcontextrestored` on the active WebGL2 plot canvas with mandatory `event.preventDefault()`, render-loop suspension (`requestAnimationFrame` cancellation, idle wakeup suppression, safe `clear()`), `DecimationPort.poll(settlementSink)` buffer drainage preservation, and `contextLost` / `onContextLost` / `onContextRestored` observables (`WebGL2ContextLostEvent`, `WebGL2ContextRestoredEvent`).
- Implement package-internal in-place WebGL2 GPU resource rehydration seam via `Symbol.for("trace-kit.webgl2.recovery")` in `src/webgl2/rehydrate.ts` without expanding the frozen 11-member `FigureRenderer` interface or `@trace-kit/renderers/webgl2` export surface.
- Rebuild shader programs, re-query uniform locations, reconstruct VAOs/VBOs, and perform revision-aware GPU buffer re-upload via `slot.gpuDirty` directly from retained CPU data or scratch buffers without re-running decimation.
- Guard `WebGL2FigureRenderer.render()`, `clear()`, and `dispose()` with `Gl2Context.isContextLost()` to eliminate GL errors, Chromium `INVALID_OPERATION` warnings, and revision stamp poisoning on lost contexts.
- Harden the 5-step atomic swap with swap-scoped context-loss listener and post-Step-4 verification aborting into deterministic Canvas2D fallback before DOM mutation on mid-switch context loss.
- Add cross-platform Chromium Playwright visual regression probe for `WEBGL_lose_context` recovery alongside Node and DOM test suites.
