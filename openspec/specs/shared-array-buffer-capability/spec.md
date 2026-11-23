# Capability: shared-array-buffer-capability

> Change: `core-transport-contract`. New capability. Encodes design.md §D7 and confirmed
> decision 4.

## Requirements

### Requirement: SharedArrayBuffer Is an Internal-Only Backing Enum
`SharedArrayBuffer` support MUST be represented internally as a `BufferBacking` enum
(`Transfer` | `Shared`) and MUST NOT appear anywhere in the public `DecimationPort` surface. The
public interface MUST be identical regardless of which backing is selected internally.

#### Scenario: The public DecimationPort type does not reference BufferBacking
- **GIVEN**: the `DecimationPort` interface declaration
- **WHEN**: a source-level check inspects its exported method signatures and properties
- **THEN**: no method or property is typed with `BufferBacking`, `SharedArrayBuffer`, or any
  shared-memory-specific type

### Requirement: No Feature May Require Cross-Origin Isolation
No TraceKit feature may be gated on `crossOriginIsolated`, `SharedArrayBuffer`, or COOP/COEP.
Every ownership invariant from `buffer-ownership-protocol` MUST pass with `SharedArrayBuffer`
absent from the global environment.

#### Scenario: The full ownership-invariant suite passes with SharedArrayBuffer deleted
- **GIVEN**: a test environment where `globalThis.SharedArrayBuffer` is deleted before the suite
  runs
- **WHEN**: the `buffer-ownership-protocol` test suite runs in this environment
- **THEN**: every test in that suite passes

#### Scenario: crossOriginIsolated changes the reported field and nothing else observable
- **GIVEN**: two ports constructed and driven through the identical round-trip sequence, one with
  `globalThis.crossOriginIsolated === false` and one with `crossOriginIsolated === true`, with
  `SharedArrayBuffer` absent in both
- **WHEN**: the two runs' observable outcomes are compared field by field — settled lease count,
  every `StatCounter` value, every `StatGauge` value, the selected `BufferBacking`, and the
  `Health` sequence
- **THEN**: every compared field is exactly equal between the two runs, so no operation was gated
  or degraded by the value
- **AND**: the `crossOriginIsolated` field of `detectTransportCapabilities()` differs between the
  two runs (`false` versus `true`), proving the value was genuinely observed by the port and the
  field-by-field equality above is not an artifact of the flag never being read

### Requirement: Runtime Detection Selects the Backing, With an Override for Benchmarking Only
The `BufferBacking` value MUST be selected from the result of `detectTransportCapabilities()`
evaluated at port-construction time, with realm-aware gating so a non-isolated browser realm never
attempts an illegal cross-worker `SharedArrayBuffer` transfer:
- In a **browser realm** (where `"crossOriginIsolated" in globalThis` is `true` or
  `capabilities.workerConstructor === true`), `selectBufferBacking` MUST select
  `BufferBacking.Shared` **only** when `capabilities.sharedMemory === true`,
  `capabilities.crossOriginIsolated === true`, AND `typeof Atomics !== "undefined"`; otherwise it
  MUST select `BufferBacking.Transfer`.
- In a **Node realm** (where `"crossOriginIsolated" in globalThis` is `false` and
  `capabilities.workerConstructor === false`), `selectBufferBacking` MUST select
  `BufferBacking.Shared` when `capabilities.sharedMemory === true` AND
  `typeof Atomics !== "undefined"`; otherwise it MUST select `BufferBacking.Transfer`.
- Whenever detection is negative or ambiguous, `selectBufferBacking` MUST select
  `BufferBacking.Transfer`. An explicit backing override MAY exist for benchmarking/testing only,
  MUST NOT be a required configuration field, and MUST NOT appear in any documented consumer
  example.

#### Scenario: Non-isolated browser realm with SharedArrayBuffer defined still selects Transfer
- **GIVEN**: a realm where `SharedArrayBuffer` and `Atomics` exist, `"crossOriginIsolated" in
  globalThis` is `true`, and `globalThis.crossOriginIsolated === false`
- **WHEN**: `selectBufferBacking(detectTransportCapabilities())` is evaluated
- **THEN**: it returns `BufferBacking.Transfer`

#### Scenario: Cross-origin-isolated browser realm selects Shared
- **GIVEN**: a Playwright Chromium page served with test-only COOP/COEP headers where
  `crossOriginIsolated === true`, `typeof SharedArrayBuffer !== "undefined"`, and
  `typeof Atomics !== "undefined"`
- **WHEN**: `selectBufferBacking(detectTransportCapabilities())` is evaluated
- **THEN**: it returns `BufferBacking.Shared`

#### Scenario: Node realm selects Shared when SharedArrayBuffer and Atomics are present
- **GIVEN**: a plain Node environment where `"crossOriginIsolated" in globalThis` is `false` and
  `SharedArrayBuffer` and `Atomics` are available
- **WHEN**: `selectBufferBacking(detectTransportCapabilities())` is evaluated
- **THEN**: it returns `BufferBacking.Shared`

#### Scenario: Detection negative selects Transfer backing
- **GIVEN**: a port constructed in an environment with `globalThis.SharedArrayBuffer` deleted
- **WHEN**: the internally selected backing is inspected through a test-only accessor
- **THEN**: it is `BufferBacking.Transfer`, and the port operates normally

#### Scenario: The backing is not a required configuration field
- **GIVEN**: the port configuration types (`SyncDecimationPortConfig`,
  `WorkerDecimationPortConfig`)
- **WHEN**: a fixture constructs each port supplying no backing-related field at all
- **THEN**: `tsc --noEmit` reports no error for those fixtures, while a control fixture omitting a
  required field (`workerFactory` on `WorkerDecimationPortConfig`) produces a `tsc --noEmit` error

### Requirement: COOP/COEP Is Never Documented as a Requirement
No committed documentation, example, or template in this change may instruct a consumer to serve
`Cross-Origin-Opener-Policy: same-origin` or `Cross-Origin-Embedder-Policy: require-corp` in
order to use TraceKit. GitHub Pages deployment and third-party embedding MUST remain supported
deployment targets.

#### Scenario: A documentation check finds no COOP/COEP requirement text
- **GIVEN**: every Markdown file and JSDoc block added or modified by this change
- **WHEN**: a check scans for `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, and
  `crossOriginIsolated` presented as a prerequisite
- **THEN**: no occurrence presents cross-origin isolation as required; any occurrence describes
  it only as an optional, detected fast path

### Requirement: Init-Time `DataCloneError` Defensive Fallback to Transfer
If `createWorkerDecimationPort` initially selects `BufferBacking.Shared` and posting the one-time
`init-sab` handshake message throws a `DataCloneError` (or any structured-clone error rejecting
`SharedArrayBuffer` transfer), the port MUST catch the error, fall back cleanly to
`BufferBacking.Transfer` with plain `ArrayBuffer`-backed slots, and complete construction without
throwing.

#### Scenario: Structured-clone error on init-sab downgrades to Transfer without failing construction
- **GIVEN**: a `WorkerLike` whose `postMessage` throws a `DOMException(..., "DataCloneError")` (or
  clone `Error`) on the `init-sab` message carrying a `SharedArrayBuffer`
- **WHEN**: `createWorkerDecimationPort` is constructed and driven through a full round trip
- **THEN**: construction succeeds without throwing, the port's internal backing switches to
  `BufferBacking.Transfer`, and the round trip settles cleanly over transferable `ArrayBuffer`s
