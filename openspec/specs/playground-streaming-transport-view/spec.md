# Capability: playground-streaming-transport-view

## Requirements

### Requirement: Live Browser-Worker Streaming and Incremental Pipeline Showcase
The `/streaming-transport` view MUST drive synthetic Lorentzian streaming data through:
1. A real browser module Web Worker created via
   `new Worker(new URL('./streaming.worker.ts', import.meta.url), { type: 'module' })` whose entry
   calls `attachCurrentDecimationWorker()` (from `@trace-kit/core/worker`), wrapped in
   `createWorkerDecimationPort`.
2. The incremental streaming primitives (`RawSampleRing`, `BucketAccumulator`, `ingestBatch`,
   `applyDomainChange` / `rebuildDomain` / `projectTier3`, and `materializeBucketsToPayload` /
   `materializeTier3ToPayload`).
3. An existing renderer (`Canvas2DRenderer`) displaying the materialized `Retained`
   `SpectrumDataPayload` without wrapping typed arrays or payloads in any reactive proxy.

#### Scenario: Mounting the view starts streaming and renders into a canvas
- **GIVEN**: the `/streaming-transport` view mounted with an injected fake or real `WorkerFactory`
  and `Canvas2DRenderer`
- **WHEN**: streaming frames advance and settlements are polled via `port.poll(sink)`
- **THEN**: the canvas renders materialized streaming output, `payload.revision` advances
  monotonically, and `Retained` payload buffers remain intact (non-zero `byteLength`)

### Requirement: Interactive Controls for Streaming Rate, Navigation Tiers, and Failure Injection
The view MUST expose interactive controls (via the playground instrumentation panel) allowing the
user to:
- Start/pause streaming and adjust delta batch size and decimation mode (`MinMaxEnvelope`, `Lttb`,
  `MinMaxEnvelopeIndices`).
- Trigger Tier-1 aligned pan, Tier-2 zoom/rebuild, and Tier-3 in-gesture preview against the live
  `RawSampleRing` and `BucketAccumulator`.
- Inject a synthetic responder stall (verifying saturation/stall/timeout recovery) and a synthetic
  responder crash (verifying worker termination, slot re-minting, and bounded lazy respawn).

#### Scenario: Injecting a responder crash updates failure telemetry and recovers streaming
- **GIVEN**: the mounted `/streaming-transport` view with streaming active
- **WHEN**: the user triggers the "Inject Crash" control
- **THEN**: `ResponderFailures` and `RemintEvents` increment visibly in the telemetry HUD, the
  retained rendered trace remains visible without clearing or detaching, and streaming resumes on a
  respawned worker

#### Scenario: Triggering Tier-1 pan and Tier-2 zoom updates domain telemetry
- **GIVEN**: the mounted `/streaming-transport` view with samples ingested into `RawSampleRing`
- **WHEN**: the user triggers an aligned pan control and then a zoom rebuild control
- **THEN**: `DomainShifts` increments on the aligned pan and `DomainRebuilds` increments on the
  zoom rebuild

### Requirement: Live TransportStatsView Telemetry HUD
The view MUST read transport telemetry via a preallocated, reused `TransportStatsView` passed to
`port.readStats(view)` and display at least: current `TransportHealth` state, detected backing
indicator (`Transfer` vs `Shared`, derived from capabilities/runtime without requiring COOP/COEP),
`ChunksAccepted`, `ChunksDropped`, `LeasesOutstanding`, `ResponderFailures`, `RemintEvents`,
`StaleSettlements`, `DomainShifts`, `DomainRebuilds`, and `OldestInFlightMs`.

#### Scenario: Telemetry HUD reuses one TransportStatsView and displays live counters
- **GIVEN**: the mounted `/streaming-transport` view
- **WHEN**: multiple streaming frames render
- **THEN**: the HUD text reflects live non-zero `ChunksAccepted` and current `Health` state while
  reusing the same `TransportStatsView` typed arrays across frames

### Requirement: Balanced Mount/Unmount Lifecycle and Vite Build Compatibility
Unmounting `/streaming-transport` MUST cancel any active `requestAnimationFrame` callback, remove
every DOM/window listener registered by the view, dispose the `DecimationPort` (terminating the
worker cleanly), dispose the renderer, and leave no `<canvas>` in the host container. The view and
its module worker entry MUST bundle cleanly under `apps/playground`'s production `vite build`.

#### Scenario: Unmount terminates the worker, disposes the port and renderer, and nets listeners to zero
- **GIVEN**: the `/streaming-transport` view mounted with instrumented
  `addEventListener`/`removeEventListener`, `requestAnimationFrame`/`cancelAnimationFrame`, and a
  spied `WorkerFactory`
- **WHEN**: the view is unmounted
- **THEN**: `worker.terminate()` is called, listener and animation-frame counts net to `0`, and the
  host contains no `<canvas>`

#### Scenario: Playground production Vite build bundles the module worker cleanly
- **GIVEN**: `apps/playground` containing `src/views/streaming-transport/streaming.worker.ts`
- **WHEN**: `pnpm --filter @trace-kit/playground run build` executes
- **THEN**: Vite exits `0` and emits the built application and worker bundle without unresolved
  `node:*` imports or bundler errors
