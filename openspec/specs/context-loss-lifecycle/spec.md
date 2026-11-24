# Capability: context-loss-lifecycle

> Owns DOM `webglcontextlost` and `webglcontextrestored` lifecycle orchestration inside
> `SpectrumEngineController` (`packages/renderers/src/controller/engine-controller.ts`), keeping
> `packages/renderers/src/webgl2/*.ts` completely DOM-listener-free.

## Requirements

### Requirement: Controller-Owned `webglcontextlost` and `webglcontextrestored` Listeners and Target Guarding
`SpectrumEngineController` (`packages/renderers/src/controller/engine-controller.ts`) MUST exclusively own all `webglcontextlost` and `webglcontextrestored` DOM event listener registration and removal. Every file under `packages/renderers/src/webgl2/*.ts` MUST remain free of DOM event listeners and MUST NOT contain the literal substrings `addEventListener`, `webglcontextlost`, `drawImage`, `fillText`, `texImage2D`, or banned `any` / `as unknown as` / `as never` patterns (including in comments and JSDoc), as enforced by `packages/renderers/test/node/webgl2-lifecycle.test.ts`.

Whenever `controller.activeKind === "webgl2"`, the controller MUST attach `webglcontextlost` and `webglcontextrestored` listeners exclusively to the active WebGL2 `plot` canvas (`controller.canvases[1]`) and record it as the active bound plot canvas. The controller MUST NOT attach context-loss listeners to `underlay` (`canvases[0]`), `overlay` (`canvases[2]`), `controller.container`, or any `"canvas2d"` canvas.

Both event handlers MUST validate at entry that `disposed === false`, `activeKind === "webgl2"`, and `event.target === boundPlotCanvas`; any event failing this guard MUST be ignored with zero state mutations and zero callbacks.

#### Scenario: Active WebGL2 plot canvas receives context listeners while sibling canvases and container do not
- **GIVEN**: a `SpectrumEngineController` mounted in Happy-DOM with `mode: "webgl2"` and instrumented canvas `addEventListener` spies on `container`, `canvases[0]` (`underlay`), `canvases[1]` (`plot`), and `canvases[2]` (`overlay`)
- **WHEN**: the controller finishes initial mount in `"webgl2"` mode
- **THEN**: `webglcontextlost` and `webglcontextrestored` listeners are registered exclusively on `canvases[1]` (`plot`), and zero context-loss listeners are registered on `canvases[0]`, `canvases[2]`, `container`, or any Canvas2D canvas

#### Scenario: Context events from non-bound targets, Canvas2D mode, or disposed controllers are ignored
- **GIVEN**: a `SpectrumEngineController` in Happy-DOM on `"webgl2"` with `onContextLost` and `onContextRestored` spies, plus an unrelated detached `<canvas>` and `canvases[0]` (`underlay`)
- **WHEN**: cancelable `webglcontextlost` and `webglcontextrestored` events are dispatched on `canvases[0]` and on the unrelated canvas, or dispatched on the former `plot` canvas after switching to `"canvas2d"` or calling `dispose()`
- **THEN**: `event.defaultPrevented` remains `false`, `controller.contextLost` remains `false`, and neither `onContextLost` nor `onContextRestored` is invoked

#### Scenario: WebGL2 source modules remain free of DOM listeners and banned substrings
- **GIVEN**: all `.ts` files under `packages/renderers/src/webgl2/`
- **WHEN**: `packages/renderers/test/node/webgl2-lifecycle.test.ts` scans every file's source text
- **THEN**: no file contains `addEventListener`, `webglcontextlost`, `drawImage`, `fillText`, `texImage2D`, a `Canvas2DRenderer` import, or banned `any`/`as unknown as`/`as never` patterns

### Requirement: Mandatory `event.preventDefault()`, Idempotent `contextLost` Transition, and `rAF` Cancellation
When a guarded `webglcontextlost` event fires on the bound WebGL2 `plot` canvas:
1. The handler MUST unconditionally call `event.preventDefault()` so the browser schedules context restoration.
2. The handler MUST cancel any pending scheduled animation frame via `cancelAnimationFrame`.
3. If `contextLost` was `false`, the controller MUST transition `contextLost` to `true` and invoke `onContextLost?.(event)` exactly once with `{ activeKind: "webgl2", sampleCount, mode, statusMessage }`, where `statusMessage` is a non-empty descriptive string.
4. If `contextLost` is already `true` (duplicate `webglcontextlost` event), the handler MUST still call `event.preventDefault()` and cancel any pending `rAF`, and MUST NOT invoke `onContextLost` a second time.
5. `onContextLost` invocation MUST be re-entrancy safe: if the callback synchronously invokes `controller.dispose()` or `controller.setMode("canvas2d")`, the controller MUST preserve the callback's resulting state (`disposed === true` or `activeKind === "canvas2d"` with `contextLost === false`) and MUST NOT overwrite `contextLost` back to `true`.

#### Scenario: Cancelable webglcontextlost calls preventDefault, sets contextLost, cancels rAF, and fires onContextLost
- **GIVEN**: a `SpectrumEngineController` in Happy-DOM active on `"webgl2"` with a pending `requestRender()` frame in a manual `rAF` queue and an `onContextLost` spy
- **WHEN**: a cancelable `new Event("webglcontextlost", { cancelable: true })` is dispatched on `controller.canvases[1]`
- **THEN**: `event.defaultPrevented === true`, `controller.contextLost === true`, `cancelAnimationFrame` is called once for the pending handle, and `onContextLost` is called once with `{ activeKind: "webgl2", sampleCount: controller.sampleCount, mode: controller.mode, statusMessage: expect.any(String) }` where `statusMessage.length > 0`

#### Scenario: Duplicate webglcontextlost while already lost is idempotent
- **GIVEN**: a WebGL2 controller already in `contextLost === true` after an initial `webglcontextlost` event
- **WHEN**: a second cancelable `new Event("webglcontextlost", { cancelable: true })` is dispatched on `controller.canvases[1]`
- **THEN**: the second event has `event.defaultPrevented === true`, `controller.contextLost` remains `true`, and total `onContextLost` invocations remain `1`

#### Scenario: Re-entrant dispose or setMode("canvas2d") inside onContextLost is respected cleanly
- **GIVEN**: two WebGL2 controllers in Happy-DOM where controller A's `onContextLost` synchronously calls `controllerA.dispose()` and controller B's `onContextLost` synchronously calls `controllerB.setMode("canvas2d")`
- **WHEN**: `webglcontextlost` is dispatched on each controller's `canvases[1]`
- **THEN**: controller A ends with `disposed === true`, `contextLost === false`, and `canvases.length === 0`; controller B ends with `activeKind === "canvas2d"`, `contextLost === false`, and `1` live Canvas2D canvas mounted

### Requirement: Listener Detachment Prior to Every Intentional `dispose()` and Engine Swap
In `controller.dispose()`, outgoing WebGL2 replacement inside `#commitDomAndSwap()`, and partial-swap failure unwinds, the controller MUST remove active `webglcontextlost` and `webglcontextrestored` listeners and clear the bound plot canvas reference (`boundPlotCanvas = null`) **before** invoking `outgoing.dispose()` or `incoming.dispose()`.

Intentional teardown (where `WebGL2FigureRenderer.dispose()` calls `gl.getExtension("WEBGL_lose_context")?.loseContext()`) MUST NOT set `contextLost = true` and MUST NOT invoke `onContextLost`.

Calling `controller.dispose()` while `contextLost === true` MUST detach listeners first, reset `contextLost = false`, dispose the active renderer without throwing, and ignore any late `webglcontextrestored` event dispatched on the detached canvas.

#### Scenario: Intentional controller.dispose() detaches listeners before renderer.dispose() and never fires onContextLost
- **GIVEN**: a `SpectrumEngineController` in Happy-DOM active on `"webgl2"` with an `onContextLost` spy and an injected WebGL2 renderer whose `dispose()` synchronously dispatches a cancelable `webglcontextlost` event on `surfaces.plot` (modeling Chromium's `WEBGL_lose_context.loseContext()`)
- **WHEN**: `controller.dispose()` is called
- **THEN**: `controller.disposed === true`, `controller.contextLost === false`, `onContextLost` is called `0` times, and the dispatched event's `defaultPrevented` is `false`

#### Scenario: Switching from WebGL2 to Canvas2D detaches listeners before outgoing.dispose()
- **GIVEN**: a WebGL2 controller in Happy-DOM with an `onContextLost` spy whose outgoing WebGL2 renderer's `dispose()` dispatches `webglcontextlost` on its `plot` canvas
- **WHEN**: `controller.setMode("canvas2d")` runs
- **THEN**: `controller.activeKind === "canvas2d"`, `controller.contextLost === false`, and `onContextLost` is called `0` times

#### Scenario: Disposing while contextLost is true resets contextLost and ignores late restoration events
- **GIVEN**: a WebGL2 controller in Happy-DOM currently in `contextLost === true` with reference `oldPlotCanvas = controller.canvases[1]` and an `onContextRestored` spy
- **WHEN**: `controller.dispose()` is called and subsequently `new Event("webglcontextrestored")` is dispatched on `oldPlotCanvas`
- **THEN**: `controller.disposed === true`, `controller.contextLost === false`, `onContextRestored` is called `0` times, and no error is thrown

### Requirement: Render-Loop Suspension, Continued Authoritative Mutators, and `DecimationPort.poll` Drainage While Lost
While `controller.contextLost === true`:
1. `controller.render()` MUST cancel any pending `rAF` handle, MUST continue invoking `decimationPort.poll(settlementSink)` when a `DecimationPort` is attached (preventing streaming worker transit-buffer pool starvation/backpressure deadlock and keeping the authoritative payload current), MUST synchronize payload/trace revisions and `sampleCount`, MUST evaluate hysteresis if dirty (immediately swapping to live `"canvas2d"` when `desired === "canvas2d"` and `gestureActive === false`), and MUST otherwise return cleanly without invoking `activeRenderer.render()` (zero GL draw calls, zero throws).
2. `controller.requestRender()` MUST suppress `requestAnimationFrame` scheduling (zero idle 60 Hz wakeups) unless `pendingKind === "canvas2d"` and `gestureActive === false`.
3. `controller.clear()` MUST be a safe no-op that performs zero GL calls and never throws.
4. `setData`, `setTraces`, `setDomain`, `resize`, `setDecimation`, and `ResizeObserver` callbacks MUST continue updating authoritative controller state (`domain`, `transform`, `width`, `height`, `dpr`, `sampleCount`, `decimation`) and forwarding to `activeRenderer` without invoking any GL commands or throwing.

#### Scenario: Suspended render, requestRender, and clear execute zero GL calls and zero idle rAF wakeups while lost
- **GIVEN**: a WebGL2 controller with a manual `rAF` queue and a spy/recording `WebGL2FigureRenderer` (`RecordingGl2Context`) currently in `contextLost === true`
- **WHEN**: `controller.requestRender()` is called 5 times, `controller.render()` is called 3 times, and `controller.clear()` is called twice while `contextLost === true`
- **THEN**: `requestAnimationFrame` is called `0` times, `activeRenderer.render()` and `activeRenderer.clear()` are called `0` times, zero GL calls occur, and zero exceptions are thrown

#### Scenario: Attached DecimationPort continues polling during render() while contextLost is true
- **GIVEN**: a WebGL2 controller configured with an instrumented `DecimationPort` and `settlementSink` whose next poll commits a new payload revision, currently in `contextLost === true`
- **WHEN**: `controller.render()` is called while `contextLost === true`
- **THEN**: `decimationPort.poll(settlementSink)` is invoked once, `controller.sampleCount` updates to reflect the settled payload revision, and `activeRenderer.render()` is invoked `0` times

#### Scenario: Authoritative state mutators and ResizeObserver remain live and coherent while contextLost is true
- **GIVEN**: a WebGL2 controller in Happy-DOM with an injected `resizeObserverFactory` and `getDevicePixelRatio: () => 2`, currently in `contextLost === true`
- **WHEN**: `setData(updatedPayload)`, `setDomain(1552, 1558, -60, -10)`, `setDecimation({ algorithm: "lttb", threshold: 256 })`, and a `ResizeObserver` entry of `960 x 540` CSS pixels are delivered while `contextLost === true`
- **THEN**: zero throws and zero GL calls occur, `requestAnimationFrame` is called `0` times, `controller.domain` is `{ xMin: 1552, xMax: 1558, yMin: -60, yMax: -10 }`, `controller.width === 960`, `controller.height === 540`, `controller.dpr === 2`, `controller.decimation` equals `{ algorithm: "lttb", threshold: 256 }`, and `controller.transform` reflects `deviceWidth === 1920`, `deviceHeight === 1080`, `xDomainMin === 1552`, `xDomainMax === 1558`

### Requirement: `webglcontextrestored` Recovery, Synchronous Post-Restore Paint, and `onContextRestored` Delivery
When a guarded `webglcontextrestored` event fires on the bound WebGL2 `plot` canvas:
1. If `contextLost === false` (spurious restore without prior loss), the handler MUST return immediately as an idempotent no-op without calling rehydration, `render()`, or `onContextRestored`.
2. If `contextLost === true`, the controller MUST clear `contextLost = false`, run WebGL2 GPU resource rehydration (per `gl-resource-rehydration`), synchronize payload/trace revisions and `sampleCount`, and invoke `render()` synchronously so the restored surface immediately paints the latest authoritative state (including any mutations received while lost).
3. Only if rehydration and initial post-restore `render()` succeed without error and the controller remains non-disposed, active on `"webgl2"`, with `contextLost === false` and unchanged transition sequence, the controller MUST increment its per-controller monotonic `restoreCount` (starting at `1` on the first successful restore) and invoke `onContextRestored?.({ activeKind: "webgl2", sampleCount, mode, restoreCount })`.
4. Subsequent `requestRender()` and `render()` calls MUST resume normal `rAF` coalescing and WebGL2 drawing immediately after restoration.

#### Scenario: Spurious webglcontextrestored while not lost is ignored as an idempotent no-op
- **GIVEN**: a healthy WebGL2 controller (`contextLost === false`) in Happy-DOM with `onContextRestored` and `activeRenderer.render` spies
- **WHEN**: `new Event("webglcontextrestored")` is dispatched on `controller.canvases[1]`
- **THEN**: `activeRenderer.render` is called `0` additional times, `onContextRestored` is called `0` times, and `controller.contextLost` remains `false`

#### Scenario: Valid webglcontextrestored rehydrates, paints synchronously with latest mutations, and delivers onContextRestored
- **GIVEN**: a WebGL2 controller in Happy-DOM with `contextLost === true`, mutated via `setDomain(1551, 1559, -50, 0)` while lost, and an `onContextRestored` spy
- **WHEN**: `new Event("webglcontextrestored")` is dispatched on `controller.canvases[1]`
- **THEN**: `controller.contextLost === false`, rehydration and synchronous `render()` execute before `onContextRestored`, `onContextRestored` is called once with `{ activeKind: "webgl2", sampleCount: controller.sampleCount, mode: controller.mode, restoreCount: 1 }`, and subsequent `requestRender()` calls schedule `rAF` normally

#### Scenario: Repeated lose and restore cycles monotonically increment restoreCount
- **GIVEN**: a WebGL2 controller in Happy-DOM with `onContextLost` and `onContextRestored` spies
- **WHEN**: two consecutive `webglcontextlost -> webglcontextrestored` event pairs are dispatched on `controller.canvases[1]`
- **THEN**: `onContextLost` is called twice, `onContextRestored` is called twice with `restoreCount: 1` and `restoreCount: 2` respectively, and `controller.contextLost` ends at `false`
