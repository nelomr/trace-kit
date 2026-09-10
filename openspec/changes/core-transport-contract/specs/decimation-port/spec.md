# Capability: decimation-port

> Change: `core-transport-contract`. New capability. Encodes design.md §D4.

## ADDED Requirements

### Requirement: DecimationPort Interface With Pull-Based Settlement
`DecimationPort` MUST expose `acquire`, `viewX`/`viewY`/`viewOut`/`viewIndices`, `submit`,
`poll`, `release`, `reportResponderFailure`, `readStats`, and `dispose`. Settlement MUST be
pull-based via `poll(sink)`; the interface MUST NOT use a `Promise` or a callback for
per-settlement notification, so change 8's asynchronous worker implementation is purely
additive against the same interface.

#### Scenario: The synchronous port's caller loop is unchanged in shape from the async contract
- **GIVEN**: the caller loop `acquire` -> `viewX/viewY` -> `setKind/setSampleCount` -> `submit`
  -> `poll(sink)`
- **WHEN**: the loop runs against `createSyncDecimationPort`
- **THEN**: it completes with no `Promise`, `await`, or callback registration anywhere in the
  loop body, and `poll` returns a count of drained settlements

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
