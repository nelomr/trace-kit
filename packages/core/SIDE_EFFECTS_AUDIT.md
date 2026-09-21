# Side-Effects Audit — `@trace-kit/core`

`package.json` declares `"sideEffects": false`. That is a **correctness assertion**, not a
formality: a false claim here produces silently broken consumer builds once a bundler
tree-shakes modules on the assumption that importing them for side effects alone is safe to
elide. This file is the audit backing that assertion.

**Rule**: every file listed below must perform no top-level side effect — no code that runs
at module-evaluation time and has an externally observable effect (mutating a global, writing
to `console`, registering a listener, touching `process`, throwing, etc.) outside of defining
and exporting bindings.

`packages/core/test/side-effects-audit.test.ts` asserts **set equality in both directions**
between the file list below and the actual files under `src/`: a file removed from `src` but
left listed here fails the check, exactly as a file added to `src` but missing from this list
does. The audit cannot silently go stale in either direction.

## Audited files

| File | Side-effect-free? | Notes |
|---|---|---|
| `src/index.ts` | Yes | Pure public re-export barrel — every binding is `export … from './…js'`. No code runs at module-evaluation time. |
| `src/version.ts` | Yes | Declares and exports the `VERSION` constant only. No side effect at module scope. |
| `src/buffers/brand.ts` | Yes | `declare const … : unique symbol` brand tags plus pure functions (assert/narrow/allocate). No code runs at module-evaluation time. |
| `src/decimation/min-max.ts` | Yes | Exports the `minMaxEnvelope` function only. No code runs at module-evaluation time. |
| `src/decimation/lttb.ts` | Yes | Exports the `lttb` function only. No code runs at module-evaluation time. |
| `src/decimation/min-max-indices.ts` | Yes | Exports the `minMaxEnvelopeIndices` function only. No code runs at module-evaluation time. |
| `src/decimation/selection.ts` | Yes | Exports the `DecimationAlgorithm`/`DecimationSelection`/`LttbSelection`/`MinMaxSelection` types and the `resolveDecimationParameter` function only. No code runs at module-evaluation time. |
| `src/decimation/index.ts` | Yes | Internal re-export barrel for the decimation algorithms and selection types only. No code runs at module-evaluation time. |
| `src/payload/spectrum-data-payload.ts` | Yes | Exports the `SpectrumDataPayload` type and the `commitPayloadRevision`/`isCursorCurrent` functions. No code runs at module-evaluation time. |
| `src/transport/ownership.ts` | Yes | Exports lease pack/unpack functions and phantom-typed lease/enum declarations only. No code runs at module-evaluation time. |
| `src/transport/backpressure.ts` | Yes | Exports the stats-contract types, enums and pure functions (`createTransportStats`, `readStatsInto`, `deriveHealth`) only. No code runs at module-evaluation time. |
| `src/transport/capabilities.ts` | Yes | Exports `detectTransportCapabilities`/`selectBufferBacking` functions and the `BufferBacking` enum; every global reference lives inside a function body. No code runs at module-evaluation time. |
| `src/transport/decimation-port.ts` | Yes | Exports the `DecimationPort` interface family and enums only. No code runs at module-evaluation time. |
| `src/transport/buffer-pool.ts` | Yes | Exports the `createBufferPool` factory and its types only; all state lives inside the factory's closure, constructed on call. No code runs at module-evaluation time. |
| `src/transport/sync-port.ts` | Yes | Exports the `createSyncDecimationPort` factory only. No code runs at module-evaluation time. |
| `src/transport/streaming-contract.ts` | Yes | Exports frozen types, constants and pure factory/selection functions only. No code runs at module-evaluation time. |
| `src/transport/index.ts` | Yes | Pure public re-export barrel for the transport surface — every binding is `export … from './…js'`. No code runs at module-evaluation time. |
| `src/viewport/transform.ts` | Yes | Exports the `ViewportTransform`/`CreateViewportTransformOptions` types and the `createViewportTransform`/`projectX`/`projectY`/`unprojectX`/`unprojectY`/`isInsidePlotArea`/`transformMatchesPayload` functions only. No code runs at module-evaluation time. |
| `src/viewport/ticks.ts` | Yes | Exports the `selectTicks`/`selectLogTicks` functions only; the module-level `NICE_STEPS` array is a frozen-by-convention constant read, never mutated. No code runs at module-evaluation time beyond that literal's construction. |
| `src/viewport/axes.ts` | Yes | Exports the `YAxisRegistration`/`SharedViewportOptions` types, the `AXIS_SIDE_LEFT` constant, and the `createAxisTransforms` function only. No code runs at module-evaluation time. |
| `src/viewport/index.ts` | Yes | Internal re-export barrel for the viewport module only. No code runs at module-evaluation time. |
