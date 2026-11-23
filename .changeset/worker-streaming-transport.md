---
"@trace-kit/core": patch
"@trace-kit/playground": patch
---

Implement the asynchronous off-thread worker decimation transport (`Transfer` and optional `SharedArrayBuffer` + `Atomics` SPSC fast path) and the incremental `O(new samples)` streaming pipeline.

**Core (`@trace-kit/core`).**

- **Worker decimation port & subpaths:** Add `createWorkerDecimationPort`, DOM-free `WorkerLike`/`WorkerFactory`/`WorkerMessageEndpoint` contracts, the effect-free `@trace-kit/core/worker` subpath (`handleDecimationMessage`, `attachDecimationWorker`, `attachCurrentDecimationWorker`), and the isolated `@trace-kit/core/node` `node:worker_threads` adapter (`adaptNodeWorker`, `createNodeParentPortEndpoint`) with compile-time Node type isolation (`tsconfig.node.json`) and zero `node:*` leakage into browser bundles.
- **Dual backing (`Transfer` + optional `Shared` SPSC):** Add realm-aware `crossOriginIsolated` gating in `selectBufferBacking()` with defensive `DataCloneError` fallback to `Transfer` (zero COOP/COEP requirement for consumers), kind-specific 3-vs-4 buffer Transfer round-trips, and an internal 704-byte cache-line-separated Control SAB + 64-byte-aligned Data SAB SPSC ring with bounded 50 ms `Atomics.wait` teardown, cross-epoch `sabEpoch` safety, unified timeout/crash termination + bounded lazy respawn up to `maxRemintEvents`, and terminal idempotent `dispose()`.
- **Pool & telemetry updates:** Add `DecimationKind.MinMaxEnvelopeIndices = 2`, enlarge `BufferPool.viewIndices` to `MAX_BUCKETS * 2` (`16,384`), enforce terminal `SATURATED` on `acquire()` after `TransportHealth.Degraded` across all `poolPairs`, track live `LeasesOutstanding` and `OldestInFlightMs`, and convert public transport enums from `const enum` to `enum` (`/* @__PURE__ */`) for `isolatedModules: true` consumers.
- **Incremental streaming pipeline:** Implement `ingestSample`, `ingestBatch`, Tier 1/2/3 invalidation (`rebuildDomain`, `applyDomainChange`, `projectTier3`), sticky `NaN` gap poisoning (`count[s] = -1`), `xOrigin` offset alignment, and allocation-free `materializeBucketsToPayload` / `materializeTier3ToPayload`.
- **Dual browser & Node verification:** Add Node `worker_threads` (`--expose-gc` 0-GC) suites plus two headless Playwright Chromium projects (`core-worker-transfer` non-isolated and `core-worker-shared` test-only COOP/COEP) wired into Turborepo and CI.

**Playground (`@trace-kit/playground`).**

- Add the interactive `/streaming-transport` view backed by a real ES module Web Worker (`attachCurrentDecimationWorker`), incremental streaming + `Canvas2DRenderer`, reused `TransportStatsView` HUD, Tier 1/2/3 controls, and stall/crash fault injection, lifting the temporary Change 4 ban on transport imports and `new Worker(`.
