# Capability: decimation-port

> Change: `core-transport-contract`. New capability. Encodes design.md §D4.

## Requirements

### Requirement: DecimationPort Interface With Pull-Based Settlement
`DecimationPort` MUST expose `acquire`, `viewX`/`viewY`/`viewOut`/`viewIndices`, `submit`,
`poll`, `release`, `reportResponderFailure`, `noteDroppedSamples`, `readStats`, and `dispose`,
and MUST extend `DecimationRequestWriter`, contributing `setKind`, `setSampleCount`,
`setBucketCount`, and `setDomain` — the caller loop calls those four between `acquire` and
`submit`, so omitting them from the required surface would leave the loop unwritable. Settlement
MUST be
pull-based via `poll(sink)`; the interface MUST NOT use a `Promise` or a callback for
per-settlement notification, so change 8's asynchronous worker implementation is purely
additive against the same interface.

#### Scenario: The synchronous port's caller loop is unchanged in shape from the async contract
- **GIVEN**: the caller loop `acquire` -> `viewX/viewY` -> `setKind/setSampleCount` -> `submit`
  -> `poll(sink)`
- **WHEN**: the loop runs against `createSyncDecimationPort`
- **THEN**: it completes with no `Promise`, `await`, or callback registration anywhere in the
  loop body, and `poll` returns a count of drained settlements

#### Scenario: The required member set is present and complete
- **GIVEN**: the emitted `.d.ts` for `DecimationPort`
- **WHEN**: its members are enumerated
- **THEN**: the enumeration contains exactly `mode`, `poolPairs`, `transitCapacitySamples`,
  `acquire`, `viewX`, `viewY`, `viewOut`, `viewIndices`, `submit`, `poll`, `release`,
  `reportResponderFailure`, `noteDroppedSamples`, `readStats`, `dispose`, `setKind`,
  `setSampleCount`, `setBucketCount`, and `setDomain`
- **AND**: a fixture consumer written against exactly that enumeration compiles with
  `tsc --noEmit` and zero diagnostics, while the same fixture with any one member removed from the
  declared interface fails — so the enumeration is checked against a compiling consumer rather than
  against a list restating itself

#### Scenario: Disposal is terminal and idempotent
- **GIVEN**: a port with at least one lease in flight
- **WHEN**: `dispose()` is called twice and then `acquire()` is called
- **THEN**: after the first call every non-`Free` slot is `Lost`,
  `stats.counters[StatCounter.Health]` equals `TransportHealth.Degraded`, and `acquire()` returns
  `SATURATED`
- **AND**: the second `dispose()` changes no counter value at all — every `StatCounter` entry is
  exactly equal before and after it — and a settlement delivered after disposal increments
  `StaleSettlements` by exactly `1`, so the idempotence is read from counters that are observably
  moving in the same run

#### Scenario: No Promise or callback appears in the public interface
- **GIVEN**: the `DecimationPort` type declaration
- **WHEN**: a source-level check inspects its method signatures
- **THEN**: no method returns `Promise<...>` and no method accepts a function parameter for
  per-call, per-settlement notification (the long-lived `SettlementSink` passed once to `poll`
  is not a per-call callback)

### Requirement: Synchronous In-Thread Default Implementation
`createSyncDecimationPort` MUST run `minMaxEnvelope`, `lttb`, and `minMaxEnvelopeIndices`
synchronously on the calling thread, without referencing any browser global, so it is trivially
Node- and SSR-safe. It MUST still drive the slot through `InFlight` -> `Settled` rather than
short-circuiting the state machine.

#### Scenario: The sync port executes all three DecimationKind values in plain Node
- **GIVEN**: `createSyncDecimationPort` invoked in Vitest's `node` environment (no jsdom)
- **WHEN**: separate `acquire` -> `setKind` -> `submit` -> `poll` -> `release` cycles run for
  `DecimationKind.MinMaxEnvelope`, `DecimationKind.Lttb`, and
  `DecimationKind.MinMaxEnvelopeIndices`
- **THEN**: every cycle completes with a settled lease, no `ReferenceError`, and outputs matching
  direct calls to `minMaxEnvelope`, `lttb`, and `minMaxEnvelopeIndices`

#### Scenario: The sync port exercises every state transition
- **GIVEN**: a lease acquired from the sync port
- **WHEN**: `submit` is called and then `poll` is called
- **THEN**: an instrumented state observer records the slot transitioning
  `Free -> Acquired -> InFlight -> Settled`, not `Free -> Acquired -> Settled` directly

### Requirement: Lazy, In-Function-Body Capability Detection
`detectTransportCapabilities()` MUST read every global (`SharedArrayBuffer`, `Worker`,
`crossOriginIsolated`) from inside its own function body, and its result MUST NOT be cached at
module scope.

#### Scenario: No global reference exists at module scope
- **GIVEN**: `packages/core/src/transport/capabilities.ts`
- **WHEN**: a source-level check (grep/AST) inspects top-level (module-scope) statements
- **THEN**: no reference to `SharedArrayBuffer`, `Worker`, `self`, or `crossOriginIsolated`
  appears outside a function body

#### Scenario: Detection re-evaluates on every call rather than using a cached module value
- **GIVEN**: two calls to `detectTransportCapabilities()` within one test, with
  `globalThis.SharedArrayBuffer` deleted between calls
- **WHEN**: both calls execute
- **THEN**: the second call's `sharedMemory` result reflects the deletion (`false`), proving no
  module-scope cache masked the change

### Requirement: The Core Never Constructs a Worker
`packages/core` MUST NOT construct a `Worker` anywhere, MUST NOT reference `Worker` or `self` at
module scope in any file, and MUST NOT reference ambient DOM/WebWorker `Worker` global types in
`packages/core/src/**`. The asynchronous port factory `createWorkerDecimationPort` MUST accept a
caller-supplied, DOM-free `workerFactory: WorkerFactory` (`() => WorkerLike`) so the dual-format
(ESM + CJS) build is never broken by a
`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` form.

#### Scenario: A source-level gate rejects Worker construction and module-scope globals in core
- **GIVEN**: a grep- or AST-based CI check over `packages/core/src/**`
- **WHEN**: it scans for `new Worker(`, and for `Worker` or `self` value references outside a
  function body
- **THEN**: the check reports zero matches across `packages/core/src/**`, and flags a live control
  fixture containing such a reference

#### Scenario: WorkerDecimationPortConfig uses DOM-free WorkerFactory with no ambient Worker type
- **GIVEN**: `packages/core/tsconfig.json` configured with `"lib": ["ES2022"]` (no `DOM` or
  `WebWorker` lib)
- **WHEN**: `tsc --noEmit` compiles `packages/core` and the emitted `.d.ts` for
  `WorkerDecimationPortConfig` is inspected
- **THEN**: compilation succeeds with zero diagnostics, `WorkerDecimationPortConfig` declares
  `workerFactory: WorkerFactory`, and `SyncDecimationPortConfig` remains free of `workerFactory`

### Requirement: The Core Loads and Runs With No DOM Globals
`@trace-kit/core` MUST load and the synchronous port MUST run an `acquire`/`submit`/`poll`/
`release` cycle to completion in a plain Node environment where `window`, `document`,
`HTMLCanvasElement`, `Worker`, and `SharedArrayBuffer` are all absent.

#### Scenario: A no-globals isomorphism test drives the sync port end to end
- **GIVEN**: a Vitest `node`-environment test that deletes `globalThis.SharedArrayBuffer` and
  asserts `window`, `document`, and `Worker` are undefined
- **WHEN**: `createSyncDecimationPort` is constructed and driven through a full round trip
- **THEN**: the cycle completes with a settled lease and no `ReferenceError` is thrown

### Requirement: `DecimationKind` Includes `MinMaxEnvelopeIndices`
`DecimationKind` MUST include `MinMaxEnvelopeIndices = 2` alongside `MinMaxEnvelope = 0` and
`Lttb = 1`. When a lease is submitted with `DecimationKind.MinMaxEnvelopeIndices`, both
`createSyncDecimationPort` and `createWorkerDecimationPort` MUST run `minMaxEnvelopeIndices` on
`(viewX, viewY, sampleCount, bucketCount)` writing into `viewIndices`, and MUST report the emitted
index count as `outCount` to `SettlementSink.onSettled`.

#### Scenario: MinMaxEnvelopeIndices produces renderer-compatible indices through sync and worker ports
- **GIVEN**: a 200,000-sample waveform processed with `DecimationKind.MinMaxEnvelopeIndices` and
  `bucketCount = 800` through both `createSyncDecimationPort` and `createWorkerDecimationPort`
- **WHEN**: `poll(sink)` delivers the settled leases
- **THEN**: both ports report identical `outCount` and bit-exact identical `viewIndices[0..outCount-1]`
  matching `minMaxEnvelopeIndices` directly

### Requirement: Asynchronous Worker Port Satisfies the Unchanged `DecimationPort` Surface
`createWorkerDecimationPort` MUST return a value assignable to the exact, unchanged 19-member
`DecimationPort` interface (`mode`, `poolPairs`, `transitCapacitySamples`, `acquire`, `viewX`,
`viewY`, `viewOut`, `viewIndices`, `submit`, `poll`, `release`, `reportResponderFailure`,
`noteDroppedSamples`, `readStats`, `dispose`, `setKind`, `setSampleCount`, `setBucketCount`,
`setDomain`) with `mode === PortMode.Asynchronous`, zero `Promise` return types, and zero per-call
settlement callbacks.

#### Scenario: Consumer function typed against DecimationPort runs identically on sync and worker ports
- **GIVEN**: one generic caller loop typed strictly against `DecimationPort` (no `Promise`, no
  per-call callback, no `BufferBacking` reference)
- **WHEN**: the identical function executes against `createSyncDecimationPort` and against
  `createWorkerDecimationPort`
- **THEN**: `tsc --noEmit` succeeds with zero diagnostics and both runs produce identical decimated
  outputs
