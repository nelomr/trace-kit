# Capability: worker-decimation-port

## Requirements

### Requirement: DOM-Free Structural Worker Contracts
`@trace-kit/core` MUST export minimal, DOM-free structural interfaces `WorkerLike`,
`WorkerFactory = () => WorkerLike`, `WorkerMessageEndpoint`, and `WorkerMessageEventLike` without
referencing ambient DOM or WebWorker global types (`Worker`, `DedicatedWorkerGlobalScope`,
`MessageEvent`). `WorkerLike` MUST model only the `postMessage` overloads, event-listener
attachment/detachment (`message`, `error`, `messageerror`), and `terminate()` operations required
so native browser `Worker` instances and `adaptNodeWorker(...)` results are structurally assignable
with zero casts. `WorkerMessageEndpoint` MUST model only the worker-side `postMessage` and
`"message"` listener operations needed by `attachDecimationWorker`.

#### Scenario: Browser Worker and Node adapter both satisfy WorkerLike structurally
- **GIVEN**: a type fixture assigning a browser-shaped `Worker` mock and the return value of
  `adaptNodeWorker` to `WorkerLike`, and a `WorkerFactory` returning each
- **WHEN**: `tsc --noEmit` compiles `packages/core` under `"lib": ["ES2022"]` (no `DOM` or
  `WebWorker` lib)
- **THEN**: compilation succeeds with zero diagnostics and zero references to ambient `Worker`
  globals inside `packages/core/src/**`

### Requirement: Asynchronous Worker Port Factory
`@trace-kit/core` MUST export `createWorkerDecimationPort(config: WorkerDecimationPortConfig)`
returning a `DecimationPort` with `mode === PortMode.Asynchronous`. `WorkerDecimationPortConfig`
MUST require `workerFactory: WorkerFactory` and accept the optional pool parameters (`poolPairs`,
`transitCapacitySamples`, `leaseTimeoutMs`, `maxRemintEvents`, `stallDropThreshold`, and test-only
`now`). Construction MUST NOT call `new Worker(...)` directly; it MUST obtain every worker instance
exclusively by invoking `config.workerFactory()`.

#### Scenario: Port reports Asynchronous mode and constructs via workerFactory
- **GIVEN**: a counting `workerFactory` returning a fake or real `WorkerLike`
- **WHEN**: `createWorkerDecimationPort({ workerFactory })` is called and driven through one
  `acquire` -> `submit` -> `poll` -> `release` cycle
- **THEN**: `port.mode === PortMode.Asynchronous`, `workerFactory` was invoked at least once, and
  `poll(sink)` delivers the settled lease and exact `outCount`

#### Scenario: workerFactory is a required configuration field
- **GIVEN**: a type fixture calling `createWorkerDecimationPort({})` without `workerFactory`
- **WHEN**: `tsc --noEmit` compiles the fixture
- **THEN**: TypeScript reports a missing-property error for `workerFactory`

### Requirement: Pure, Effect-Free Worker Handler and Subpath Entry
`@trace-kit/core` MUST export `handleDecimationMessage`, `createDecimationWorkerHandler`,
`attachDecimationWorker`, and `attachCurrentDecimationWorker` from both the root `.` entry and
`@trace-kit/core/worker`. Importing either module MUST perform zero top-level side effects (no
listener registration, no global mutation, no `self` reference at module scope).
`attachDecimationWorker(endpoint)` MUST register the handler on `endpoint` and return a detach
function that removes the registered listener cleanly. `attachCurrentDecimationWorker()` MUST
structurally validate `globalThis` at call time (zero casts, zero module-scope global access) so
consumer/Vite worker files remain 2 lines without DOM-vs-WebWorker TypeScript lib conflicts. The
handler MUST execute `DecimationKind.MinMaxEnvelope`, `DecimationKind.Lttb`, and
`DecimationKind.MinMaxEnvelopeIndices` statelessly in place on the supplied transit buffers and
return the resulting `outCount`.

#### Scenario: Worker handler processes all three decimation kinds accurately
- **GIVEN**: a worker driven by `attachDecimationWorker` or `attachCurrentDecimationWorker` over a
  real thread (Node `worker_threads` or Playwright Chromium `Worker`)
- **WHEN**: separate leases are submitted for `MinMaxEnvelope`, `Lttb`, and
  `MinMaxEnvelopeIndices` on the same deterministic Lorentzian waveform
- **THEN**: for each kind, the settled buffer contents and `outCount` match the synchronous
  reference calls (`minMaxEnvelope`, `lttb`, `minMaxEnvelopeIndices`) bit-for-bit

#### Scenario: Detaching the worker handler removes its listener cleanly
- **GIVEN**: a `WorkerMessageEndpoint` spy recording `addEventListener` and `removeEventListener`
  calls
- **WHEN**: `const detach = attachDecimationWorker(endpoint)` is called and then `detach()` is
  invoked
- **THEN**: `removeEventListener` is called with the exact `"message"` listener registered during
  attach, leaving zero active listeners on `endpoint`

### Requirement: Pooled Transfer-Mode Round Trip With Kind-Specific Transfer Lists
When operating with `BufferBacking.Transfer`, `submit(lease)` MUST transfer only the `ArrayBuffer`s
required by the slot's configured `DecimationKind`, collected into a preallocated transfer list via
`collectTransferList`:
- `DecimationKind.MinMaxEnvelope`: exactly 3 buffers (`x`, `y`, `out`); `viewIndices` MUST NOT be
  transferred.
- `DecimationKind.MinMaxEnvelopeIndices`: exactly 3 buffers (`x`, `y`, `indices`); `viewOut` MUST
  NOT be transferred.
- `DecimationKind.Lttb`: exactly 4 buffers (`x`, `y`, `out`, `indices`).

Immediately after `submit(lease)`, the caller's pre-existing views over transferred buffers MUST
observe `byteLength === 0`. On reply, the port MUST re-mint views only for the transferred buffers
(preserving untransferred views in place), transition the slot `InFlight -> Settled`, and enqueue
`(lease, outCount)` for `poll(sink)` without ever exposing a detached buffer through a settled
accessor.

#### Scenario: Transfer list count matches DecimationKind and detaches only transferred buffers
- **GIVEN**: a `createWorkerDecimationPort` in `Transfer` backing wired to an instrumented
  `WorkerLike` (or real browser/Node worker)
- **WHEN**: one `MinMaxEnvelope` lease, one `MinMaxEnvelopeIndices` lease, and one `Lttb` lease are
  each submitted and settled
- **THEN**: the transfer list lengths passed to `postMessage` are `3`, `3`, and `4` respectively
- **AND**: immediately after `submit`, pre-existing views over transferred buffers report
  `byteLength === 0`, while the untransferred view (`viewIndices` for `MinMaxEnvelope`, `viewOut`
  for `MinMaxEnvelopeIndices`) retains its full `byteLength`
- **AND**: after `poll(sink)`, freshly obtained accessors (`viewX`, `viewY`, `viewOut`,
  `viewIndices`) all report their configured capacities

#### Scenario: Retained SpectrumDataPayload buffers are never detached across worker round trips
- **GIVEN**: a caller copying settled worker output into a `Retained` `SpectrumDataPayload` and
  rendering it in Playwright Chromium
- **WHEN**: 60 consecutive worker round trips complete in `Transfer` mode
- **THEN**: `payload.x.byteLength` and `payload.y.byteLength` remain constant and non-zero
  throughout, and `payload.revision` advances monotonically

### Requirement: Unified Failure Handling, Worker Termination, and Bounded Lazy Respawn
`createWorkerDecimationPort` MUST route `worker` `"error"` events (`FailureReason.WorkerError`),
worker-reported error messages (`{ type: "error", ... }` → `FailureReason.WorkerError`),
`"messageerror"` events (`FailureReason.MessageError`), explicit `reportResponderFailure(reason)`
calls, and lazy deadline timeouts (`leaseTimeoutMs`, checked inside `acquire()` and `poll()` with
zero timers; when any `InFlight` slot exceeds `leaseTimeoutMs`, all currently `InFlight` slots fail
together because terminating the hung single-threaded worker orphans every queued slot) through one
unified failure path.

On responder failure:
1. The port MUST immediately detach listeners from and call `terminate()` on the failed or hung
   worker instance.
2. Every `InFlight` slot MUST transition to `Lost` and `StatCounter.ResponderFailures` MUST
   increment by `1`.
3. If `remintEventCount < maxRemintEvents`, the port MUST re-mint fresh transit backing for every
   `Lost` slot, increment each slot's generation, return the slots to `Free`, and **lazily respawn**
   a replacement worker by invoking `workerFactory()` on the next `acquire()` or `submit()`.
4. If `remintEventCount >= maxRemintEvents`, the port MUST NOT re-mint or invoke `workerFactory()`
   again; `Health` MUST transition permanently to `TransportHealth.Degraded` and every subsequent
   `acquire()` MUST return `SATURATED`.

#### Scenario: Worker error terminates the crashed worker and lazily respawns on next acquire
- **GIVEN**: a `createWorkerDecimationPort` with `maxRemintEvents = 3` and one `InFlight` lease
- **WHEN**: the worker throws an uncaught error (`"error"` event fires) or replies with an error
  message
- **THEN**: the crashed worker's `terminate()` is called immediately, `ResponderFailures` increments
  by `1`, `workerFactory` is NOT invoked until the next `acquire()` (or `submit()`), and the next
  round trip succeeds on the newly spawned worker

#### Scenario: Hung worker is terminated by lazy deadline sweep without timers
- **GIVEN**: a `createWorkerDecimationPort` backed by a worker that never replies, with an injected
  clock advanced to `>= leaseTimeoutMs`, and `setTimeout`/`setInterval` spied on
- **WHEN**: `acquire()` or `poll()` is called
- **THEN**: the hung worker's `terminate()` is called, `ResponderFailures` increments by `1`, all
  in-flight slots are re-minted with incremented generations, and `setTimeout`/`setInterval` record
  `0` calls

#### Scenario: Exceeding maxRemintEvents degrades terminally without further respawn
- **GIVEN**: a port with `maxRemintEvents = 2` whose worker crashes on every submission
- **WHEN**: failures occur until `remintEventCount` reaches the cap and one additional failure fires
- **THEN**: `Health` becomes `TransportHealth.Degraded`, `workerFactory` is never called again, and
  subsequent `acquire()` calls return `SATURATED`

### Requirement: Generation-Guarded Stale Settlement Rejection
Any reply received from a terminated worker (`workerEpoch` mismatch), from a previous slot
generation, for a slot not in `SlotState.InFlight`, or after `dispose()` MUST be discarded cleanly
without re-minting views, mutating slot state, or notifying `SettlementSink`, and MUST increment
`StatCounter.StaleSettlements` by `1`.

#### Scenario: Late zombie reply after timeout is dropped and counted
- **GIVEN**: a lease that timed out and was recovered (incrementing the slot's generation and
  worker epoch)
- **WHEN**: a delayed reply carrying the pre-timeout packed lease or stale `workerEpoch` arrives
- **THEN**: `StatCounter.StaleSettlements` increments by exactly `1`, `poll(sink)` drains `0`
  settlements for that reply, and the current live slot buffers remain untouched

### Requirement: Terminal, Idempotent Disposal
`port.dispose()` MUST detach all worker listeners, terminate the active worker (if any), transition
all non-`Free` slots to `Lost`, mark `Health` permanently as `TransportHealth.Degraded`, leave zero
open handles or timers, and return `SATURATED` from every subsequent `acquire()`. Calling
`dispose()` a second time MUST be a complete no-op: it MUST NOT invoke `terminate()` again and MUST
NOT change any `StatCounter` entry.

#### Scenario: Calling dispose twice terminates once and leaves all counters unchanged
- **GIVEN**: an active `createWorkerDecimationPort` with one `InFlight` lease and an instrumented
  `WorkerLike`
- **WHEN**: `port.dispose()` is called twice and `readStats` is compared before and after the
  second call
- **THEN**: `worker.terminate()` was called exactly once, `Health === TransportHealth.Degraded`,
  every `StatCounter` value is identical before and after the second `dispose()`, and a subsequent
  `acquire()` returns `SATURATED`
