# Capability: decimation-port

> Change: `core-transport-contract`. New capability. Encodes design.md §D4.

## ADDED Requirements

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
`createSyncDecimationPort` MUST run `minMaxEnvelope` and `lttb` synchronously on the calling
thread, without referencing any browser global, so it is trivially Node- and SSR-safe. It MUST
still drive the slot through `InFlight` -> `Settled` rather than short-circuiting the state
machine.

#### Scenario: The sync port runs to completion in a plain Node environment
- **GIVEN**: `createSyncDecimationPort` invoked from a Vitest test running in Vitest's `node`
  environment (no jsdom)
- **WHEN**: `acquire` -> `submit` -> `poll` runs
- **THEN**: the call completes with a settled lease and no `ReferenceError` for any browser
  global

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
`packages/core` MUST NOT construct a `Worker` anywhere, and MUST NOT reference `Worker` or
`self` at module scope in any file. The asynchronous transport delivered by change 8 MUST be
injected as a `workerFactory: () => Worker` supplied by an adapter or host application, so the
dual-format (ESM + CJS) build is never broken by a
`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` form.

#### Scenario: A source-level gate rejects Worker construction in the core
- **GIVEN**: a grep- or AST-based CI check over `packages/core/src/**`
- **WHEN**: it scans for `new Worker(`, and for `Worker` or `self` references outside a function
  body
- **THEN**: the check reports no match, and the check itself is proven live by a fixture file
  containing such a reference that the same check flags

#### Scenario: No workerFactory field is declared in this change
- **GIVEN**: the transport module's exported types and the port configuration type
- **WHEN**: they are enumerated
- **THEN**: no `workerFactory` field, no `Worker`-typed member, and no `Worker` type reference
  appears anywhere in them — design.md §D4 rejects a `workerFactory?` field on this change's
  config outright ("dead configuration invites a module-scope `Worker` type reference and lies
  about what is implemented"), so declaring one would both contradict the design and defeat the
  no-`Worker`-at-module-scope gate above
- **AND**: the seam is instead the factory-function boundary: `createSyncDecimationPort` is the
  only port factory this change exports, and a fixture consumer written against `DecimationPort`
  compiles unchanged against a second factory added later, proving change 8 is additive without
  any seam field existing now

### Requirement: The Core Loads and Runs With No DOM Globals
`@trace-kit/core` MUST load and the synchronous port MUST run an `acquire`/`submit`/`poll`/
`release` cycle to completion in a plain Node environment where `window`, `document`,
`HTMLCanvasElement`, `Worker`, and `SharedArrayBuffer` are all absent.

#### Scenario: A no-globals isomorphism test drives the sync port end to end
- **GIVEN**: a Vitest `node`-environment test that deletes `globalThis.SharedArrayBuffer` and
  asserts `window`, `document`, and `Worker` are undefined
- **WHEN**: `createSyncDecimationPort` is constructed and driven through a full round trip
- **THEN**: the cycle completes with a settled lease and no `ReferenceError` is thrown
