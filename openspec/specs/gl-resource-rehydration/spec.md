# Capability: gl-resource-rehydration

> Owns the package-internal in-place WebGL2 GPU resource rehydration seam on
> `WebGL2FigureRenderer` (`packages/renderers/src/webgl2/rehydrate.ts`), `Gl2Context.isContextLost()`
> guards, `slot.gpuDirty` zero-re-decimation re-upload, custom injected stub fallback, and
> deterministic Canvas2D fallback on rehydration failure.

## Requirements

### Requirement: Package-Internal `Symbol.for("trace-kit.webgl2.recovery")` Handle Preserving Frozen Surfaces and ESM/CJS Identity
`packages/renderers/src/webgl2/rehydrate.ts` MUST provide a package-internal recovery handle mechanism keyed by `Symbol.for("trace-kit.webgl2.recovery")`, resolved lazily inside helper functions so the module performs zero top-level side effects.

`WebGL2FigureRenderer`'s constructor MUST attach a recovery handle implementing `{ readonly isContextLost: () => boolean; readonly rehydrate: () => void }` to `this` via `Object.defineProperty` with `enumerable: false`, `writable: false`, and `configurable: false`.

`SpectrumEngineController` MUST look up the recovery handle via `Reflect.get` and validate its shape using an `unknown` runtime type guard (zero `any`, zero `as unknown as`, zero `as never`).

This seam MUST preserve every frozen public contract:
- `packages/renderers/src/webgl2/rehydrate.ts` MUST NOT be re-exported from `packages/renderers/src/webgl2/index.ts`.
- `FigureRenderer` (`packages/renderers/src/figure-renderer.ts`) and `WebGL2FigureRenderer.prototype` MUST remain strictly frozen at their exact 11 public members (`Object.getOwnPropertyNames(WebGL2FigureRenderer.prototype)` unchanged).
- `@trace-kit/renderers/webgl2` MUST retain its exact single runtime export `["WebGL2FigureRenderer"]`.
- Handle attachment and lookup MUST work identically across separate ESM and CJS `tsup` bundles (`splitting: false`), including when a caller imports `WebGL2FigureRenderer` from `@trace-kit/renderers/webgl2` and supplies it via `createWebGL2Renderer` to `createSpectrumEngineController` imported from `@trace-kit/renderers/controller`.
- `rehydrate.ts` and all `src/webgl2/*.ts` modules MUST NOT contain `addEventListener`, `webglcontextlost`, `drawImage`, `fillText`, `texImage2D`, or banned `any` patterns.

#### Scenario: Recovery handle is non-enumerable and keeps FigureRenderer and WebGL2FigureRenderer.prototype frozen at 11 members
- **GIVEN**: a constructed `WebGL2FigureRenderer` instance in Node (`packages/renderers/test/node/figure-renderer-shape.test.ts` and rehydration unit tests)
- **WHEN**: `Object.getOwnPropertyNames(WebGL2FigureRenderer.prototype)`, `Object.keys(renderer)`, and `Object.getOwnPropertyDescriptor(renderer, Symbol.for("trace-kit.webgl2.recovery"))` are inspected
- **THEN**: `WebGL2FigureRenderer.prototype` exposes the exact 11 public members (excluding `constructor`), `Object.keys(renderer)` does not expose the recovery handle, and the descriptor for `Symbol.for("trace-kit.webgl2.recovery")` has `enumerable: false`, `writable: false`, `configurable: false`, with `isContextLost` and `rehydrate` functions

#### Scenario: Symbol.for recovery handle resolves across separate built CJS and ESM bundles
- **GIVEN**: built `@trace-kit/renderers/webgl2` and `@trace-kit/renderers/controller` artifacts under both CJS (`require`) and ESM (`import`) in Node
- **WHEN**: a `WebGL2FigureRenderer` constructed from `@trace-kit/renderers/webgl2` is injected into `createSpectrumEngineController` from `@trace-kit/renderers/controller` via `createWebGL2Renderer` and a `webglcontextlost -> webglcontextrestored` cycle runs
- **THEN**: the controller locates the recovery handle via `Symbol.for("trace-kit.webgl2.recovery")` and performs in-place rehydration on the exact same `plot` canvas and renderer instance in both ESM and CJS runs

### Requirement: `Gl2Context.isContextLost()` Safety Guards on `render()`, `clear()`, `dispose()`, and Construction Failure
`Gl2Context` (`packages/renderers/src/webgl2/gl-context.ts`) MUST declare `isContextLost(): boolean` and MUST remain a strict structural subset of `WebGL2RenderingContext` (verified by `webgl2-shape.test-d.ts`).

`WebGL2FigureRenderer` MUST guard its lifecycle methods with `gl.isContextLost()`:
1. `WebGL2FigureRenderer.render()` MUST return immediately before releasing retired slots, drawing underlay/overlay, uploading buffers, or issuing GL draw calls whenever `gl.isContextLost() === true`, ensuring `slot.uploadedRevision` and other upload cache fields are never poisoned on a lost context (even when `WebGL2FigureRenderer` is used standalone outside `SpectrumEngineController`).
2. `WebGL2FigureRenderer.clear()` MUST return immediately without issuing GL or 2D surface clears whenever `gl.isContextLost() === true`.
3. `WebGL2FigureRenderer.dispose()` MUST check `if (!gl.isContextLost())` before calling `releaseTraceSlot` (`deleteBuffer`, `deleteVertexArray`), `deleteProgram`, and `gl.getExtension("WEBGL_lose_context")?.loseContext()`, preventing Chromium WebGL `INVALID_OPERATION` warnings while still freeing all JS references and setting `disposed = true`, and preserving the exact `delete*` and `loseContext()` call counts when disposing a healthy context.
4. The constructor's `createGlPrograms(gl)` `catch` cleanup MUST check `if (!gl.isContextLost())` before calling `gl.getExtension("WEBGL_lose_context")?.loseContext()`.

#### Scenario: Standalone WebGL2FigureRenderer.render() and clear() on a lost context emit zero GL calls and do not poison uploadedRevision
- **GIVEN**: a `WebGL2FigureRenderer` backed by `RecordingGl2Context` in Node with a new `SpectrumDataPayload` at `revision === 7` set via `setData(payload)` and the fake GL context flipped to `isContextLost() === true`
- **WHEN**: `renderer.render()` and `renderer.clear()` are called while `isContextLost() === true`, and then the context is restored and `rehydrate()` + `render()` execute
- **THEN**: zero `createBuffer`, `createVertexArray`, `bufferData`, `drawArraysInstanced`, or `clear` GL calls occur while lost, and once restored the payload at `revision === 7` uploads and draws completely (proving `uploadedRevision` was not poisoned while lost)

#### Scenario: dispose() skips delete and loseContext when context is already lost, but calls them when healthy
- **GIVEN**: two `WebGL2FigureRenderer` instances backed by `RecordingGl2Context` in Node after at least one rendered frame: renderer A with `isContextLost() === false` and renderer B with `isContextLost() === true`
- **WHEN**: `dispose()` is called on both renderers
- **THEN**: both report `disposed === true`; renderer A deletes its programs, buffers, and VAOs and calls `loseContext()` once; renderer B emits `0` `deleteBuffer`, `deleteVertexArray`, `deleteProgram`, and `loseContext` calls

#### Scenario: Constructor program failure skips loseContext when context is already lost
- **GIVEN**: a `RecordingGl2Context` configured to report `isContextLost() === true` during `WebGL2FigureRenderer` construction (causing `createGlPrograms` to throw)
- **WHEN**: `new WebGL2FigureRenderer(...)` is invoked
- **THEN**: construction throws the compilation/link error and invokes `loseContext()` `0` times (whereas a healthy context with a shader compile failure still invokes `loseContext()` once)

### Requirement: In-Place Shader/Program Recompilation, Stale Handle Drop, and VAO/VBO Reconstruction
When the internal recovery handle's `rehydrate()` method is invoked on `WebGL2FigureRenderer`:
1. If `#disposed === true`, `#gl === null`, or `#gl.isContextLost() === true`, `rehydrate()` MUST throw an `Error` immediately without partially mutating programs or slots.
2. `rehydrate()` MUST clear `#retired` without calling `gl.deleteBuffer` or `gl.deleteVertexArray` on stale prior-generation handles.
3. `rehydrate()` MUST recompile and link both the line and isolated-marker shader programs and re-query all uniform locations via `createGlPrograms(gl)` (without calling `gl.deleteProgram` on prior-generation programs), updating `#programs` and `#frame.programs`.
4. For every active `TraceGpuSlot`, `rehydrate()` MUST null out `xBuffer`, `yBuffer`, `lineVao`, `markerXBuffer`, `markerYBuffer`, and `markerVao` (without calling `gl.delete*`) and set `slot.gpuDirty = true` while preserving `uploadedRevision`, `uploadedMode`, `uploadedAlgorithm`, `uploadedParameter`, `scratchX`, `scratchY`, `vertexCount`, `markerX`, `markerY`, and `markerCount`.
5. On the subsequent `render()` call, `ensureTraceUploaded` MUST recreate fresh `WebGLBuffer` and `WebGLVertexArrayObject` objects (`createBuffer`, `createVertexArray`), bind instanced vertex attributes, upload vertex data (and isolated-marker data when applicable) via `bufferData`, and reset `slot.gpuDirty = false`.

#### Scenario: In-place rehydration recompiles shaders, drops retired slots without deleting stale handles, and recreates VAOs and VBOs
- **GIVEN**: a `WebGL2FigureRenderer` backed by `RecordingGl2Context` in Node that rendered a multi-trace collection (including isolated samples and a prior retired trace set), followed by simulated context loss and restoration on the same `RecordingGl2Context`
- **WHEN**: the internal recovery handle's `rehydrate()` is invoked followed by `renderer.render()`
- **THEN**: `deleteProgram`, `deleteBuffer`, and `deleteVertexArray` call counts during `rehydrate()` + `render()` are `0`; `createShader`, `createProgram`, `linkProgram`, and `getUniformLocation` execute for both line and marker programs; fresh `createBuffer` and `createVertexArray` handles distinct from pre-loss handles are created for every active slot; `bufferData` uploads line and marker buffers; and `drawArraysInstanced` executes with the exact same instance counts as pre-loss

#### Scenario: Calling rehydrate() while context is still lost or renderer is disposed throws synchronously
- **GIVEN**: a `WebGL2FigureRenderer` backed by `RecordingGl2Context` in Node with either `gl.isContextLost() === true` or `renderer.dispose()` already called
- **WHEN**: the internal recovery handle's `rehydrate()` is called
- **THEN**: `rehydrate()` throws an `Error` synchronously

### Requirement: `slot.gpuDirty` Revision-Aware Zero-Re-Decimation Re-Upload and Allocation-Free Steady State
Inside `packages/renderers/src/webgl2/upload.ts`, `ensureTraceUploaded` MUST respect `slot.gpuDirty`:
1. When the upload cache key (`payload.revision`, effective upload mode `UPLOAD_FULL` vs. `UPLOAD_DECIMATED`, `algorithm`, and resolved `parameter`) matches the slot's preserved key and `slot.gpuDirty === false`, `ensureTraceUploaded` MUST return immediately with zero GL calls and zero allocations (preserving steady-state performance).
2. When the upload cache key matches the slot's preserved key and `slot.gpuDirty === true`:
   - `ensureTraceUploaded` MUST clear `slot.gpuDirty = false`.
   - If `slot.vertexCount === 0`, it MUST return with zero `bufferData` calls.
   - Otherwise, it MUST call `ensureLineObjects(gl, slot)` to allocate fresh line VBOs/VAO and re-upload directly from retained `payload.x`/`payload.y` (`UPLOAD_FULL`, zero copy, zero detachment check) or from preserved `slot.scratchX`/`slot.scratchY` (`UPLOAD_DECIMATED`), and when `markIsolated && slot.markerCount > 0` it MUST call `ensureMarkerObjects(gl, slot)` and re-upload directly from preserved `slot.markerX`/`slot.markerY`.
   - This fast-path restore MUST execute **zero re-decimation** (`decimateTraceIndices` MUST NOT be invoked) and **zero isolated-marker re-scan** (`countIsolatedSegments` and `collectIsolatedSampleIndices` MUST NOT be invoked).
3. When the upload cache key changed while the context was lost (due to `payload.revision` change, `resize()` changing `plotWidth` and resolved decimation target, or `setDecimation()` change), `ensureTraceUploaded` MUST clear `slot.gpuDirty = false` and execute the standard upload path against freshly created VBOs/VAOs (re-decimating and re-scanning isolated markers as needed).
4. Steady-state rendering (`slot.gpuDirty === false` after restoration) MUST preserve `0` GC events across 1,000 steady-state frames in `packages/renderers/test/node/webgl2-allocation-gate.test.ts` and full compliance with the hot-path ESLint allocation rules on `src/webgl2/{frame,upload,precision,float-bits}.ts`.

#### Scenario: Restore with unchanged payload revision under default full-resolution mode re-uploads without re-decimation or marker re-scan
- **GIVEN**: a `WebGL2FigureRenderer` (`decimation: undefined`) backed by `RecordingGl2Context` in Node rendered with a payload at `revision === 5` containing an isolated sample (`markIsolated: true`) and spies on `decimateTraceIndices` and `countIsolatedSegments`
- **WHEN**: the context is lost, restored, `rehydrate()` runs, and `renderer.render()` executes with the same payload (`revision === 5`)
- **THEN**: fresh line and marker VBOs/VAOs are created and uploaded via `bufferData` from `payload.x`/`payload.y` and preserved `slot.markerX`/`slot.markerY`, `decimateTraceIndices` call count increases by `0`, and `countIsolatedSegments` call count increases by `0`

#### Scenario: Restore with unchanged revision under explicit lttb or min-max decimation re-uploads preserved scratch with zero re-decimation
- **GIVEN**: a `WebGL2FigureRenderer` configured with explicit `{ algorithm: "lttb", threshold: 128 }` (and a second case with `{ algorithm: "min-max", bucketCount: 64 }`) on a `20_000`-sample payload at `revision === 3`, rendered once pre-loss, with spies on `decimateTraceIndices` and `countIsolatedSegments`
- **WHEN**: context loss and `rehydrate()` + `render()` occur with unchanged `revision === 3`, unchanged decimation selection, and unchanged `plotWidth`
- **THEN**: `decimateTraceIndices` and `countIsolatedSegments` call counts increase by `0`, fresh VBOs/VAOs are populated directly from preserved `slot.scratchX`/`slot.scratchY`, and `drawArraysInstanced` draws the exact same `vertexCount - 1` instances as pre-loss

#### Scenario: Restore after payload revision, decimation, or plotWidth changed while lost executes full re-upload and re-decimation
- **GIVEN**: a `WebGL2FigureRenderer` configured with `{ algorithm: "lttb" }` (viewport-derived threshold) on `RecordingGl2Context` in Node
- **WHEN**: while the context is lost, either `commitPayloadRevision` increments `payload.revision`, `setDecimation({ algorithm: "min-max", bucketCount: 64 })` is called, or `resize()` changes `plotWidth`, and then `rehydrate()` + `render()` execute
- **THEN**: `slot.gpuDirty` clears to `false`, the standard upload path executes `decimateTraceIndices` with the updated inputs, uploads the newly computed stream to fresh VBOs/VAOs, and stamps the updated upload key

#### Scenario: Post-restore steady-state rendering preserves the zero-GC allocation gate
- **GIVEN**: the `packages/renderers/test/node/webgl2-allocation-gate.test.ts` harness executing 1,000 steady-state `render()` frames (including after a `rehydrate()` cycle)
- **WHEN**: the allocation gate test runs under `--expose-gc`
- **THEN**: steady-state frames record `0` GC events and `src/webgl2/{frame,upload,precision,float-bits}.ts` pass the allocation-free ESLint ruleset

### Requirement: Custom Injected Stub Reconstruction Fallback and Deterministic Canvas2D Fallback on Rehydration Failure
When `SpectrumEngineController` handles `webglcontextrestored`:
1. If `getRecoveryHandle(activeRenderer)` returns `null` (e.g., an injected test fake or custom `FigureRenderer` returned by `createWebGL2Renderer`), the controller MUST transparently recover by staging 3 fresh unmounted `<canvas>` elements (`[underlay, plot, overlay]`), constructing a replacement WebGL2 renderer via `createWebGL2Renderer`, replaying authoritative retained state (`resize`, `setData`/`setTraces`, `setDomain`, `setDecimation`), calling `incoming.render()`, detaching old listeners before `outgoing.dispose()`, swapping DOM atomically in place of the outgoing canvases, binding active GL listeners to the new `plot` canvas, and invoking `onContextRestored` **without** invoking `onEngineChange`.
2. If in-place `handle.rehydrate()`, stub reconstruction, or the initial post-restore `render()` throws an error — or if `handle.isContextLost()` remains `true` immediately after rehydration/render — the controller MUST:
   - Detach WebGL2 listeners and clear `boundPlotCanvas = null`.
   - Latch `webgl2Fallback = true` and keep `contextLost = false`.
   - Construct and mount a fallback `Canvas2DRenderer` with full authoritative state replay (`resize`, `setData`/`setTraces`, `setDomain`, `setDecimation`) and synchronous initial paint.
   - Dispose the broken WebGL2 renderer safely.
   - Invoke `onWebGL2Fallback?.({ error, attemptedMode: mode, sampleCount })` followed by `onEngineChange?.({ previousKind: "webgl2", activeKind: "canvas2d", sampleCount, mode, reason: "webgl2-fallback" })`.
   - MUST NOT invoke `onContextRestored`.

#### Scenario: Custom injected FigureRenderer stub without recovery handle restores via 3 fresh canvases without emitting onEngineChange
- **GIVEN**: a `SpectrumEngineController` in Happy-DOM with `mode: "webgl2"`, an injected `createWebGL2Renderer` returning a plain 11-member `FigureRenderer` stub (no `Symbol.for("trace-kit.webgl2.recovery")` handle), and `onEngineChange` / `onContextRestored` spies
- **WHEN**: `webglcontextlost` and `webglcontextrestored` are dispatched on `controller.canvases[1]`
- **THEN**: `createWebGL2Renderer` is called a second time with 3 fresh `<canvas>` elements, authoritative state (`resize`, `setData`/`setTraces`, `setDomain`, `setDecimation`, `render`) is replayed, DOM swaps atomically to the 3 new canvases, the old stub's `dispose()` is called once, `onContextRestored` fires with `restoreCount: 1`, and `onEngineChange` fires `0` times after initial mount

#### Scenario: Rehydration shader failure falls back deterministically to a live painted Canvas2DRenderer
- **GIVEN**: a `SpectrumEngineController` in Happy-DOM/Node active on `"webgl2"` whose `RecordingGl2Context` fails shader compilation (`GL_COMPILE_STATUS === false`) during `rehydrate()` (or whose post-restore `render()` throws an `Error`), with `onWebGL2Fallback`, `onEngineChange`, and `onContextRestored` spies
- **WHEN**: `webglcontextlost` followed by `webglcontextrestored` is dispatched on `controller.canvases[1]`
- **THEN**: no unhandled exception escapes, `controller.activeKind === "canvas2d"`, `controller.webgl2Fallback === true`, `controller.contextLost === false`, `controller.canvases` holds `1` mounted Canvas2D canvas with authoritative state replayed and painted, the broken WebGL2 renderer's `dispose()` is called once, `onWebGL2Fallback` fires once, `onEngineChange` fires once with `{ previousKind: "webgl2", activeKind: "canvas2d", sampleCount, mode, reason: "webgl2-fallback" }`, and `onContextRestored` fires `0` times
