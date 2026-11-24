# Capability: decimation-invalidation

> Change: `viewport-interaction-controller` (Roadmap step `9.3`). Frame-budget-debounced domain-change invalidation scheduler in `@trace-kit/renderers/controller` coordinated with `SpectrumEngineController.setGestureActive(false)` hysteresis flushing, paired with pure DOM-free `@trace-kit/core` invalidation adapters for Change 8's `RawSampleRing` + `BucketAccumulator` (Tier 1/2/3) and `resolveSampleWindow` + `DecimationPort` with 1-slot scalar latest-wins superseding and stale-settlement rejection.

## Requirements

### Requirement: Two-Phase Frame-Budget-Debounced Invalidation Scheduler
`ViewportInteractionController` MUST coordinate domain-change invalidation with `SpectrumEngineController` through a two-phase lifecycle reported to the optional `onInvalidate(event: ViewportInvalidationEvent)` callback, where `event` carries `{ phase: "gesture" | "settled", domain: ViewportDomain, seq: number, reason: ViewportMutationReason }` and `seq` is a strictly monotonically increasing positive integer starting at `1`:
1. **Active gesture phase (`phase: "gesture"`):**
   - During drag-pan, 2-pointer pinch, or wheel bursts, `onInvalidate` with `phase: "gesture"` MUST be coalesced to at most **one** invocation per animation frame (`rAF`), invoked after `controller.setDomain(...)` and before `controller.requestRender()`.
   - High-frequency `pointermove` events or multiple wheel events arriving within the same animation frame MUST NOT invoke `onInvalidate` more than once per frame.
2. **Gesture settle phase (`phase: "settled"`):**
   - On drag-pan `pointerup` (`reason: "pan-end"`), pinch end (`reason: "pinch-end"`), box-zoom commit (`reason: "box-zoom"`), `resetDomain()` (`reason: "reset"`), or programmatic mutations (`reason: "programmatic"`), the scheduler MUST fire `onInvalidate` with `phase: "settled"` **immediately** (synchronously inside that completion step) with a fresh monotonic `seq`.
   - On wheel bursts (`reason: "wheel-settle"`), the scheduler MUST debounce settled invalidation by `settleDebounceMs` (default `120` ms) using the injectable `setTimeout`/`clearTimeout` seam so a continuous wheel burst fires **exactly one** trailing `phase: "settled"` callback after `settleDebounceMs` of idle time.
3. **Hysteresis coordination ordering:**
   - On gesture settlement, the controller MUST execute in exact order:
     1. Apply final domain via `controller.setDomain(...)` (if pending).
     2. Invoke `onInvalidate({ phase: "settled", domain, seq, reason })` (allowing the consumer to re-decimate / update payload `sampleCount` and `revision` before engine switching is evaluated).
     3. Call `controller.setGestureActive(false)` (synchronously flushing any deferred `canvas2d <-> webgl2` hysteresis swap based on the newly settled payload/domain).
     4. Call `controller.requestRender()`.
4. **No leaked callbacks after cancel/dispose:**
   - Cancelling a wheel debounce timer on `dispose()` or `resetDomain()` MUST guarantee that no stale `wheel-settle` callback fires afterward.

#### Scenario: Continuous wheel burst fires coalesced gesture previews and exactly one trailing settled invalidation
- **GIVEN**: a `ViewportInteractionController` with `settleDebounceMs = 120`, manual `rAF` and fake timer seams, and a spy on `onInvalidate`
- **WHEN**: `15` wheel events are dispatched over `200 ms` (`1` every `~14 ms`) across `12` animation frames, and then `120 ms` of idle time passes
- **THEN**: `onInvalidate` receives `<= 12` `"gesture"` events (at most `1` per frame), `0` `"settled"` events during the burst, and exactly `1` `"settled"` event (`reason: "wheel-settle"`) at `t = 320 ms`, with strictly increasing `seq` across all events

#### Scenario: Settled invalidation runs before setGestureActive(false) flushes a deferred hysteresis swap
- **GIVEN**: a `SpectrumEngineController` in `"auto"` mode initially on `"canvas2d"` (`10,000` samples) and a `ViewportInteractionController` whose `onInvalidate` callback updates the payload to `90,000` samples on `phase: "settled"`
- **WHEN**: the user performs a drag pan (during which `controller.gestureActive === true`) and releases on `pointerup`
- **THEN**: `onInvalidate({ phase: "settled", reason: "pan-end" })` executes first, bumping the payload to `90,000` samples, then `controller.setGestureActive(false)` runs and transitions `controller.activeKind` to `"webgl2"` (`3` canvases) cleanly on gesture end without swapping mid-drag

### Requirement: Pure DOM-Free Streaming Ring/Accumulator Invalidation Adapter (`@trace-kit/core`)
`@trace-kit/core` MUST export `createStreamingInvalidationAdapter(options: StreamingInvalidationAdapterOptions): StreamingInvalidationAdapter` (under `packages/core/src/transport/window-invalidation.ts`, re-exported from `@trace-kit/core`) that bridges `(phase, xMin, xMax)` directly into Change 8's `RawSampleRing` + `BucketAccumulator` + `Tier3ProjectionTarget` + `Retained` `SpectrumDataPayload` with zero DOM references and zero steady-state allocations:
- Converts absolute physical bounds `(xMin, xMax)` into ring-offset space `(xMin - effectiveOrigin, xMax - effectiveOrigin)` where `effectiveOrigin = options.ringXOrigin ?? options.payload.xOrigin`.
- When `phase === "gesture"`:
  - Invokes `projectTier3(accumulator, offsetMin, offsetMax, tier3Target)` and `materializeTier3ToPayload(...)` into `options.payload`.
  - Sets `lastTier = 3`, MUST NOT mutate `accumulator` (`accumulator.revision` unchanged), and returns the emitted vertex count.
- When `phase === "settled"`:
  - Evaluates `selectTier(accumulator, offsetMin, offsetMax, false)` (which MUST resolve to Tier `1` or Tier `2`), calls `applyDomainChange(ring, accumulator, offsetMin, offsetMax, false)`, and calls `materializeBucketsToPayload(accumulator, options.payload, effectiveOrigin)`.
  - Records `lastTier` (`1` or `2`), increments `accumulator.revision` by `1` via `applyDomainChange`, bumps `payload.revision` via `materializeBucketsToPayload`, and returns the emitted vertex count.

#### Scenario: Streaming adapter uses non-mutating Tier 3 during gesture and mandatory Tier 1 or Tier 2 on settle
- **GIVEN**: a populated `RawSampleRing` (`16,384` samples, `xOrigin = 1550`), a `BucketAccumulator` (`256` buckets, initial `revision = 1`), a `Tier3ProjectionTarget`, and a preallocated `Retained` `SpectrumDataPayload` wired to `createStreamingInvalidationAdapter`
- **WHEN**: `adapter.invalidate("gesture", 1550.2, 1550.6)` is called `5` times, followed by `adapter.invalidate("settled", 1550.2, 1550.6)`
- **THEN**: during all `5` `"gesture"` calls `adapter.lastTier === 3` and `accumulator.revision` remains `1` while `payload.revision` increments with bounded Tier-3 preview vertices; on the `"settled"` call `adapter.lastTier` is `1` or `2`, `accumulator.revision` becomes `2`, and `payload` reflects full-resolution buckets for `[1550.2, 1550.6]`

### Requirement: Pure DOM-Free Windowed `DecimationPort` Invalidation Adapter with Latest-Wins Superseding (`@trace-kit/core`)
`@trace-kit/core` MUST export `createWindowDecimationAdapter(options: WindowDecimationAdapterOptions): WindowDecimationAdapter` (under `packages/core/src/transport/window-invalidation.ts`, re-exported from `@trace-kit/core`) that bridges settled domain changes into `resolveSampleWindow` + `DecimationPort` with zero DOM references, zero queue growth, and deterministic stale-settlement rejection:
- `request(xMin, xMax, seq)` MUST record `latestRequestedSeq = seq`.
  - If a lease is currently in flight OR `port.acquire()` returns `SATURATED`, `request(...)` MUST NOT allocate a queue; it MUST overwrite a single preallocated scalar pending slot (`pendingXMin`, `pendingXMax`, `pendingSeq`, `hasPending = true`) — **latest-wins superseding** — and return `false`.
  - Otherwise, it MUST resolve the visible source index slice `[span.start, span.end)` via `resolveSampleWindow(sourcePayload, xMin, xMax, preallocatedSpan, { includeNeighbours })` (default `includeNeighbours: true`), copy up to `Math.min(spanLen, port.transitCapacitySamples)` samples into `port.viewX(lease)` and `port.viewY(lease)` using an allocation-free indexed loop, configure `port.setKind`, `port.setSampleCount`, `port.setBucketCount`, and `port.setDomain(lease, xMin - sourcePayload.xOrigin, xMax - sourcePayload.xOrigin)`, and call `port.submit(lease)` (recording `activeSeq = seq`).
- `poll(onAccepted)` MUST drain `port.poll(internalSink)`:
  - If the settled lease's `activeSeq < latestRequestedSeq` (meaning a newer zoom/pan superseded it while in flight), the adapter MUST increment `droppedStaleCount`, call `port.release(lease)`, and MUST NOT invoke `onAccepted`.
  - If `activeSeq === latestRequestedSeq`, the adapter MUST invoke `onAccepted(lease, outCount, activeSeq)` and release `lease` (`port.release(lease)`) inside a `finally` block so the lease never leaks even if `onAccepted` throws.
  - Immediately after releasing an in-flight lease, if `hasPending === true` and the adapter is not disposed, the adapter MUST automatically submit the single latest pending scalar domain `(pendingXMin, pendingXMax, pendingSeq)` and clear `hasPending`.
- `dispose()` MUST mark the adapter disposed, clear any pending slot, and prevent further submissions.

#### Scenario: Windowed DecimationPort adapter slices only the visible window at full resolution
- **GIVEN**: a `sourcePayload` with `100,000` samples over `xOrigin = 1550`, offsets `[0..10]` (`x` in `[1550, 1560]`), and a `createSyncDecimationPort` wired to `createWindowDecimationAdapter({ sourcePayload, port, kind: DecimationKind.Lttb, bucketCount: 256 })`
- **WHEN**: `adapter.request(1555.0, 1555.1, 1)` is called (a `1%` zoomed window containing `~1,000` samples) and `adapter.poll(onAccepted)` drains the settlement
- **THEN**: `onAccepted` is invoked once with `seq === 1`, the submitted transit sample count equals the windowed slice length (with neighbour bracketing, `~1,002` samples, NOT `100,000`), and the decimated output spans `[1555.0, 1555.1]` at full `bucketCount` density

#### Scenario: Superseded in-flight settlement is discarded and latest pending domain auto-submits
- **GIVEN**: a `createWindowDecimationAdapter` backed by an asynchronous stub `DecimationPort` (`poolPairs = 1`)
- **WHEN**: `request(0, 100, 1)` submits lease `L1` (in flight), then `request(10, 90, 2)` arrives (stashed in pending slot), then `request(40, 60, 3)` arrives (overwriting pending slot with seq `3`), and then `L1` settles and `adapter.poll(onAccepted)` runs
- **THEN**: `L1` (seq `1 < 3`) is discarded (`droppedStaleCount === 1`, `onAccepted` NOT called, `L1` released), the pending slot automatically submits seq `3` (`[40, 60]`, never submitting superseded seq `2`), and when seq `3` settles `adapter.poll(onAccepted)` delivers seq `3` to `onAccepted`

### Requirement: Renderer Lock-Down Hygiene for Invalidation Modules
No file under `packages/renderers/src/controller/` MUST reference any of the 5 banned worker tokens (`/\bWorker\b/`, `/\bpostMessage\b/`, `/\btransferControlToOffscreen\b/`, `/\bstructuredClone\b/`, `/\bself\b/` — including comments) or call `createSpectrumDataPayload` or `commitPayloadRevision`. All payload buffer construction and revision commits MUST remain strictly inside `@trace-kit/core`.

#### Scenario: Existing renderer lock-down audits pass with all new controller files present
- **GIVEN**: all new interaction and invalidation files committed under `packages/renderers/src/controller/`
- **WHEN**: `packages/renderers/test/node/no-worker-references.test.ts` and `packages/renderers/test/node/payload-consumption.test.ts` run
- **THEN**: both test suites pass with zero violations
