# Capability: vue-reactivity-isolation

> Defense-in-depth isolation between Vue 3's Proxy reactivity system and TraceKit's hot-path typed arrays and ES `#private`-field controllers, plus the dual 60 Hz in-place streaming seam.

## Requirements

### Requirement: Non-Reactive Storage of ES `#private`-Field Controllers (`markRaw` + `shallowRef`)
Every `SpectrumEngineController` and `ViewportInteractionController` created by `@trace-kit/vue` MUST be tagged immediately with Vue's `markRaw(...)` and MUST be stored exclusively in `shallowRef(...)` containers exposed as `Readonly<ShallowRef<... | null>>`. Neither controller instance MUST ever be wrapped in a Vue `Proxy`. Wrapping the composable return object or `{ controller, interaction }` inside Vue's `reactive(...)` (simulating Pinia stores or reactive parent state) MUST NOT proxy either controller and MUST NOT throw a `TypeError` when reading ES `#private`-backed getters or invoking imperative methods.

#### Scenario: Controller and interaction refs are shallow and hold non-proxied raw instances
- **GIVEN**: `useSpectrumEngine` mounted onto a host `HTMLElement` in Happy-DOM (`vue-dom`) with `interactive: true`
- **WHEN**: `isShallow`, `isProxy`, `isReactive`, and `toRaw` are evaluated on `controller` and `interaction`
- **THEN**: `isShallow(controller) === true`, `isShallow(interaction) === true`, `isProxy(controller.value) === false`, `isReactive(controller.value) === false`, `isProxy(interaction.value) === false`, `isReactive(interaction.value) === false`, `toRaw(controller.value) === controller.value`, and `toRaw(interaction.value) === interaction.value`

#### Scenario: Wrapping handle or controllers in reactive() survives ES `#private` field access
- **GIVEN**: a mounted `useSpectrumEngine` return handle whose `controller.value` and `interaction.value` are live instances using native ES `#private` fields
- **WHEN**: a consumer wraps `{ controller: handle.controller.value, interaction: handle.interaction.value }` and `{ handle }` in Vue's `reactive(...)` and reads `activeKind`, `domain`, `sampleCount`, `state`, and invokes `render()`, `requestRender()`, `setDomain(...)`, and `resetDomain()`
- **THEN**: zero `TypeError` exceptions are thrown (`Cannot read private member #...` never occurs), and `isProxy(store.controller) === false` and `isProxy(store.interaction) === false` remain true

### Requirement: Defensive Ingress `toRaw()` Unwrapping for Payloads, Traces, and Transport Ports
At every adapter ingress boundary where `data` (`SpectrumDataPayload`), `traces` (`TraceCollection`), `decimationPort` (`DecimationPort`), or `settlementSink` (`SettlementSink`) enters `@trace-kit/vue`, the adapter MUST defensively unwrap the incoming value with Vue's `toRaw(...)` before passing it to `SpectrumEngineController`. Because `SpectrumDataPayload` is intentionally mutable in place via `commitPayloadRevision()` and is NOT `Object.freeze`'d, the payload and its typed-array buffers (`Float32Array`, `Float64Array`, `Uint32Array`) delivered to `SpectrumEngineController` MUST satisfy `isProxy === false`, `isReactive === false`, and strict reference identity (`===`) with the original raw instances even when a consumer passes a `ref()`- or `reactive()`-wrapped object.

#### Scenario: Reactive ref()-wrapped SpectrumDataPayload is unwrapped via toRaw before reaching the controller
- **GIVEN**: a raw `SpectrumDataPayload` (with raw `Float32Array`/`Float64Array` `x` and `y` buffers) mistakenly wrapped inside Vue's deep `ref(payload)` and passed to `useSpectrumEngine` or `<TraceSpectrumViewer>` in `vue-dom`
- **WHEN**: the adapter forwards the payload to `SpectrumEngineController.setData(...)` (captured via an injectable `platform.createCanvas2DRenderer` spy)
- **THEN**: the payload received by the renderer satisfies `isProxy(received) === false`, `isReactive(received) === false`, `received === rawPayload`, `received.x === rawPayload.x`, `received.y === rawPayload.y`, `isProxy(received.x) === false`, and `isProxy(received.y) === false`

#### Scenario: Reactive-wrapped TraceCollection, DecimationPort, and SettlementSink are unwrapped via toRaw
- **GIVEN**: a `TraceCollection`, a `DecimationPort`, and a `SettlementSink` passed through `reactive(...)` / `ref(...)` wrappers into `useSpectrumEngine` in `vue-dom`
- **WHEN**: the controller mounts and renders
- **THEN**: the collection received by `setTraces(...)` satisfies `isProxy(received) === false`, `isReactive(received) === false`, `received === rawTraces`, every `received.entries[i].payload.x === rawTraces.entries[i].payload.x`, and `decimationPort`/`settlementSink` passed to `createSpectrumEngineController` are the unwrapped raw references (`isProxy === false`)

#### Scenario: Direct shallowRef/markRaw payload preserves zero-copy typed-array identity
- **GIVEN**: a `SpectrumDataPayload` held in `shallowRef(markRaw(payload))` and bound to `<TraceSpectrumViewer :data="payload">` in `vue-dom`
- **WHEN**: the component mounts and paints a frame
- **THEN**: the renderer receives the exact original `SpectrumDataPayload` and typed-array buffers (`===`), zero clones are created, and `isProxy(payload.value) === false`

### Requirement: Zero Deep Watchers and Shallow Readonly Reactive Metadata
No module under `packages/vue/src/**` MUST invoke `watch(...)` with `{ deep: true }` or traverse `SpectrumDataPayload`, `TraceCollection`, or typed-array elements for Vue dependency tracking. Every reactive state ref exposed by `useSpectrumEngine` and `<TraceSpectrumViewer>` (`isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`) MUST be backed by `shallowRef(...)` and exposed as `readonly(...)` (or shallow readonly view) containing only scalar primitives or plain non-proxied `ViewportDomain` snapshots (`isProxy === false`, `isReactive === false`).

#### Scenario: Static source audit confirms zero deep watchers across packages/vue/src
- **GIVEN**: all `.ts` files under `packages/vue/src/`
- **WHEN**: a Node test under the `vue` project scans every source file for `deep\s*:\s*true`
- **THEN**: zero matches are found across `packages/vue/src/**/*.ts`

#### Scenario: Exposed reactive metadata refs are shallow and hold non-proxied snapshots
- **GIVEN**: a mounted `useSpectrumEngine` instance in `vue-dom`
- **WHEN**: `isShallow` is checked on `isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, and `gestureState`, and `isProxy`/`isReactive` are checked on `domain.value`
- **THEN**: every exposed metadata ref satisfies `isShallow(ref) === true` and `isProxy(domain.value) === false` and `isReactive(domain.value) === false`

### Requirement: Dual 60 Hz In-Place Streaming Seam (`requestRender()` Hot Path and Scalar `revision` Prop)
`@trace-kit/vue` MUST support two non-allocating update paths for in-place `SpectrumDataPayload` mutations committed via `commitPayloadRevision(payload, nextSampleCount)`:
1. **Path A (Imperative 60 Hz hot path)**: Invoking `requestRender()` on the `useSpectrumEngine` return handle or `<TraceSpectrumViewer>` `expose` handle MUST forward directly to `controller.requestRender()` so `SpectrumEngineController`'s single-slot rAF coalescing and `#syncRevisionsAndSampleCount()` observe the incremented `payload.revision`, update `sampleCount`, evaluate hysteresis, and repaint with zero `setData()` re-calls, zero payload cloning, and zero Vue component render-function executions.
2. **Path B (Declarative scalar binding)**: Updating the optional scalar `revision?: number` prop/option MUST invoke `controller.requestRender()` through a shallow scalar watcher without calling `setData()`, without replacing or cloning the `SpectrumDataPayload`, and MUST synchronize `sampleCount` after the scheduled frame renders.

#### Scenario: Path A imperative requestRender repaints in-place commitPayloadRevision mutations with zero Vue re-renders
- **GIVEN**: a mounted `<TraceSpectrumViewer :data="payload">` in `vue-dom` with an injectable synchronous rAF seam, a spy counting parent/viewer render invocations, and an initial frame rendered with `sampleCount = 128`
- **WHEN**: the producer writes new values into `payload.y`, calls `commitPayloadRevision(payload, 256)`, and calls `viewerRef.value?.requestRender()`, then flushes the single scheduled rAF callback
- **THEN**: the renderer draws the mutated `256`-sample data in place (`setData` is NOT called a second time), the exact same `payload` and `Float32Array` buffer references are observed by the renderer, reactive `sampleCount.value` reflects `256`, and zero additional Vue component re-renders occur

#### Scenario: Path B scalar revision prop triggers controller.requestRender without payload replacement
- **GIVEN**: a mounted `<TraceSpectrumViewer :data="payload" :revision="rev">` in `vue-dom` with `rev = ref(0)` and an initial render completed
- **WHEN**: the producer mutates `payload` in place via `commitPayloadRevision(payload, 512)`, increments `rev.value = payload.revision`, awaits `nextTick()`, and flushes the scheduled rAF callback
- **THEN**: `controller.requestRender()` is scheduled once, `setData` is NOT called again, the payload is NOT cloned or proxied, and the renderer draws the updated `512`-sample frame
