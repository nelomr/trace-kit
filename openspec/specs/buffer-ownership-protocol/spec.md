# Capability: buffer-ownership-protocol

> Change: `core-transport-contract`. New capability. Encodes design.md §D1, §D2, §D5.

## Requirements

### Requirement: Five-State Per-Slot Ownership Machine Over an Opaque Lease
Each transit slot MUST be tracked as a five-state machine (`Free`, `Acquired`, `InFlight`,
`Settled`, `Lost`) over an opaque, generation-packed numeric lease handle. The public currency
MUST be the lease handle plus port accessors; the protocol MUST NOT hand out a raw `ArrayBuffer`
or an owning wrapper object as the unit of ownership.

#### Scenario: Every legal transition is exercised
- **GIVEN**: a fresh pool with `poolPairs = 3`
- **WHEN**: a lease is acquired, viewed, submitted, and released after being read post-settle
- **THEN**: the observed slot-state sequence is exactly
  `Free -> Acquired -> InFlight -> Settled -> Free`

#### Scenario: A double submit is rejected without allocating or throwing
- **GIVEN**: a lease already moved to `InFlight` via `submit`
- **WHEN**: `submit` is called again with the same (now stale) lease value
- **THEN**: the call is a no-op due to a generation mismatch, it returns `SATURATED`,
  `stats.ownershipViolations` increments by exactly `1`, and no exception is thrown by default

### Requirement: Compile-Time Phase Enforcement Plus Runtime Generation Guard
Reading a buffer through an `InFlight`-phase lease MUST be a TypeScript compile error, and MUST
additionally be guarded at runtime by an integer generation compare so a plain-JavaScript
consumer or a smuggled lease value cannot bypass the type-level guarantee.

#### Scenario: Passing an in-flight lease to an accessor does not type-check
- **GIVEN**: `const inflight: Lease<'inflight'> = port.submit(acquired);`
- **WHEN**: `port.viewX(inflight)` is written in a fixture (accessors accept only
  `Lease<'acquired'> | Lease<'settled'>`)
- **THEN**: `tsc --noEmit` reports a type error for the fixture

#### Scenario: A runtime-only consumer is still rejected by the generation guard
- **GIVEN**: a lease's generation-packed number is copied into a plain `number` and then used to
  call `port.viewX` after that same slot has been submitted
- **WHEN**: the call executes
- **THEN**: the returned view is the pre-allocated zero-length sentinel view, and
  `stats.ownershipViolations` increments by `1`, with no exception thrown

### Requirement: Exactly-One-Owner Invariant Across a Round Trip
For every buffer, at every observable point in the protocol, there MUST be exactly one owner.
After a buffer is handed to the port, the sender's pre-existing view MUST observe `byteLength ===
0`; after ownership returns, `byteLength` MUST be restored to the original value and reads
through a freshly obtained view MUST succeed.

#### Scenario: Sender observes detachment after transfer
- **GIVEN**: a transit buffer transferred as part of `submit` in transfer mode
- **WHEN**: the sender reads `byteLength` on its pre-existing view immediately after `submit`
- **THEN**: `byteLength === 0`

#### Scenario: Ownership is restored after settlement
- **GIVEN**: the same buffer, now settled and returned
- **WHEN**: a fresh view is obtained via `port.viewOut(settledLease)` and its `byteLength` is read
- **THEN**: `byteLength` equals the original configured capacity, and reading through it
  succeeds

#### Scenario: A pre-existing view fails after transfer, and this is expected behavior
- **GIVEN**: a view obtained before `submit` was called
- **WHEN**: a read is attempted through that same (now stale) view object after `submit`
- **THEN**: the read fails (throws or reads zero-length), and the port's documented API contract
  states this is expected, not a bug

### Requirement: Buffer Identity Preserved Across the Pooled Round Trip
For the pooled case, the buffer instance returned after settlement MUST be recognizable as
belonging to the same pool slot as the one submitted — not a value the caller must treat as an
unrelated new allocation from the caller's perspective.

#### Scenario: Slot view capacities are fixed by configuration, not by the request
- **GIVEN**: a port at `transitCapacitySamples = 65_536`, driven with requests at
  `bucketCount` of `1` and then `8192`
- **WHEN**: `viewX(lease).length`, `viewOut(lease).length`, and `viewIndices(lease).length` are
  read after each request
- **THEN**: they are exactly `65_536`, `16_384`, and `16_384` in both cases, unchanged by
  `bucketCount`
- **AND**: the `outCount` reported to the settlement sink differs between the two requests, so the
  unchanged lengths are read from a run where the request demonstrably varied

#### Scenario: The same slot's buffer is reused across repeated round trips
- **GIVEN**: 100 consecutive acquire/submit/poll/release cycles on `poolPairs = 3`
- **WHEN**: the slot index backing each successive lease is recorded
- **THEN**: the same 3 slot indices repeat cyclically, and the count of distinct `ArrayBuffer`
  identities created for transit backing after warm-up is exactly `0`
- **AND**: the count of distinct `ArrayBuffer` identities created during warm-up is exactly the
  configured per-slot buffer count times `poolPairs`, so the `0` above is read from a live
  identity tracker rather than from one that never recorded anything

### Requirement: Failure-Path-Only Re-Minting
Buffers MUST be re-minted only on the failure path (`onerror`, `onmessageerror`, explicit
`reportResponderFailure`, or deadline timeout) where the responder has died or hung holding them.
Steady-state operation MUST NOT re-mint. Direct `createBufferPool(config)` invocations (without
internal `BufferPoolInternalOptions`) MUST allocate and re-mint plain `ArrayBuffer` views by
default so standalone pools and `createSyncDecimationPort` remain unaffected by `SharedArrayBuffer`
availability. When `createWorkerDecimationPort` supplies internal `BufferPoolInternalOptions`
(`backing`, `allocateSlotViews`, `onResponderFailure`), failure-path recovery (`remintEventCount <
maxRemintEvents`) MUST allocate fresh backing matching the active `BufferBacking`: fresh
`ArrayBuffer`s in `BufferBacking.Transfer` mode, or fresh `SharedArrayBuffer` backing in
`BufferBacking.Shared` mode so no zombie thread can alias a newly recovered slot.

#### Scenario: No re-minting occurs during a clean run
- **GIVEN**: 3,600 round trips with a healthy responder and no injected failure
- **WHEN**: `stats.counters[StatCounter.RemintEvents]` is read after the run
- **THEN**: it equals `0`
- **AND**: an injected-failure test in the same suite observes a non-zero `RemintEvents`, proving
  the counter is live

#### Scenario: Direct createBufferPool allocates ArrayBuffers while Shared worker port re-mints SharedArrayBuffers
- **GIVEN**: a direct `createBufferPool({ poolPairs: 2 })` in Node, a `Transfer`-backed worker
  port, and a `Shared`-backed worker port, each subjected to one injected responder failure while
  slots are `InFlight`
- **WHEN**: each recovers
- **THEN**: the direct pool's views remain `ArrayBuffer`-backed before and after failure; the
  `Transfer` port re-mints distinct `ArrayBuffer` views; the `Shared` port re-mints distinct
  `SharedArrayBuffer` views; and in each case `RemintEvents` increments by the count of failed
  slots

### Requirement: Explicit Buffer-Consumption Contract on the Public API
The public transport API MUST state, in its type-level shape and its documentation, that
submitting a lease consumes the caller's acquired-phase handle; a caller reading a buffer it has
already submitted is a documented contract violation, not an implicit assumption.

#### Scenario: submit's type signature consumes the acquired-phase lease
- **GIVEN**: `submit(lease: Lease<'acquired'>): Lease<'inflight'> | Saturated`, mirroring
  `acquire(): Lease<'acquired'> | Saturated` — an invalid submit is reported through the same
  `Saturated` sentinel as a saturated pool, never through a type-dishonest reinterpretation of
  the caller's stale handle
- **WHEN**: a fixture passes the same `acquiredLease` value to `submit` a second time
- **THEN**: `tsc --noEmit` reports no error (the declared phase still matches), so the type
  system alone is insufficient here and the runtime generation guard is the enforcing mechanism:
  the second `submit` is a no-op, it returns `SATURATED`, and
  `stats.counters[StatCounter.OwnershipViolations]` increments by exactly `1`

#### Scenario: Reading through a retained acquired-phase handle after submit is caught at runtime
- **GIVEN**: `const inflight = port.submit(acquiredLease);` where the caller has kept
  `acquiredLease` instead of discarding it
- **WHEN**: `port.viewX(acquiredLease)` is called
- **THEN**: the generation compare fails, the returned view is the preallocated zero-length
  sentinel, `stats.counters[StatCounter.OwnershipViolations]` increments by exactly `1`, and no
  exception is thrown

#### Scenario: The consumption contract is documented on the public API
- **GIVEN**: the published JSDoc for `submit`, `viewX`, `viewY`, `viewOut`, and `viewIndices`
- **WHEN**: the documentation is inspected
- **THEN**: it states that `submit` consumes the caller's acquired-phase handle, that the caller
  MUST discard it and use the returned in-flight lease, and that reading through a submitted
  handle is a caller contract violation reported via `OwnershipViolations` rather than a bug in
  the port

### Requirement: Pool Sizing on the Streaming Delta, Not the Dataset
The pool MUST default to `poolPairs = 3`, clamped to `[1, 8]`, and MUST size transit slot
capacity via `transitCapacitySamples` (default `65_536`) independent of total dataset size. A
bulk load exceeding transit capacity MUST be chunked across successive leases rather
than growing the pool. Per-slot element capacities MUST be fixed at construction as
`viewX`/`viewY` = `transitCapacitySamples`, `viewOut` = `MAX_BUCKETS * 2` (`16,384` floats: two
values per bucket for a min/max envelope), and `viewIndices` = `MAX_BUCKETS * 2` (`16,384` ints:
supporting up to `MAX_BUCKETS` min/max index pairs for `DecimationKind.MinMaxEnvelopeIndices` on
4K viewports as well as `Lttb`), so the pool's footprint is a constant of the configuration with
no term mentioning the dataset.

#### Scenario: Pool memory footprint does not scale with dataset size
- **GIVEN**: a payload of `1_000_000` samples and a payload of `10_000_000` samples, both driven
  through the port's chunked acquire/submit loop
- **WHEN**: the pool's total allocated transit bytes are measured after each load completes
- **THEN**: the pool's allocated transit byte count is identical in both cases (determined by
  `transitCapacitySamples`, not by the dataset size)

#### Scenario: viewIndices supports MAX_BUCKETS MinMaxEnvelopeIndices output without overflow
- **GIVEN**: a port configured at default capacities and a request with
  `DecimationKind.MinMaxEnvelopeIndices` and `bucketCount = MAX_BUCKETS` (`8_192`)
- **WHEN**: `viewIndices(lease).length` is inspected and the request settles
- **THEN**: `viewIndices(lease).length === MAX_BUCKETS * 2` (`16_384`), and the request completes
  without throwing a `RangeError`

#### Scenario: A bulk load exceeding transit capacity is chunked
- **GIVEN**: `transitCapacitySamples = 65_536` and a bulk load of `200_000` samples driven through
  the port's `acquire`/`submit`/`poll`/`release` loop (`setData` as a public engine API belongs to
  change 9 and is not exercised here)
- **WHEN**: the load is processed
- **THEN**: it is dispatched across exactly `4` successive lease acquisitions —
  `ceil(200_000 / 65_536) = 4`, a deterministic count with no tolerance — and the pool's allocated
  transit byte count is exactly equal before and after

### Requirement: Kind-Specific Partial View Replacement in `BufferPool`
`BufferPool`'s internal `ReplacementViews` contract passed to `settle(lease, outCount,
replacement?)` MUST allow partial view replacement (`x`, `y`, `out?`, `indices?`) so only views
backed by actually transferred `ArrayBuffer`s are replaced on settlement:
- `DecimationKind.MinMaxEnvelope`: replaces `x`, `y`, `out` (3 views); preserves existing
  `viewIndices` reference (`===`).
- `DecimationKind.MinMaxEnvelopeIndices`: replaces `x`, `y`, `indices` (3 views); preserves
  existing `viewOut` reference (`===`).
- `DecimationKind.Lttb`: replaces `x`, `y`, `out`, `indices` (4 views).

#### Scenario: Partial replacement preserves untransferred views without re-minting
- **GIVEN**: a `BufferPool` slot whose pre-submit `viewIndices` and `viewOut` references are
  recorded
- **WHEN**: `settle` is invoked with `{ x, y, out }` (omitting `indices`) for `MinMaxEnvelope`, and
  in a subsequent cycle with `{ x, y, indices }` (omitting `out`) for `MinMaxEnvelopeIndices`
- **THEN**: `viewIndices` remains strictly reference-identical (`===`) across the `MinMaxEnvelope`
  cycle, and `viewOut` remains strictly reference-identical (`===`) across the
  `MinMaxEnvelopeIndices` cycle

### Requirement: Live Tracking of `LeasesOutstanding` and `OldestInFlightMs`
`BufferPool` MUST maintain `StatCounter.LeasesOutstanding` and `StatGauge.OldestInFlightMs`
accurately across the slot lifecycle:
- `LeasesOutstanding` MUST equal the exact number of slots currently in `Acquired`, `InFlight`, or
  `Settled` state (incremented on successful `acquire()`, decremented on valid `release()`,
  decremented for failed slots in `failSlots()`, and reset to `0` on `dispose()`).
- `OldestInFlightMs` MUST be updated during `sweepDeadlines()` and `readStats(out)` to the elapsed
  milliseconds (`max(0, now() - min(dispatchTimestamps[slot]))`) across all slots currently in
  `SlotState.InFlight`, or `0` when zero slots are `InFlight` or after `dispose()`.

#### Scenario: LeasesOutstanding tracks acquire, submit, release, failure, and dispose accurately
- **GIVEN**: a fresh pool with `poolPairs = 3`
- **WHEN**: two leases are acquired, one is submitted and settled, one is released, then the
  remaining in-flight lease fails via `reportResponderFailure`, and finally `dispose()` is called
- **THEN**: `LeasesOutstanding` reads `0` initially, `2` after both acquires, `1` after releasing
  one, `0` after the in-flight slot fails/recovers, and `0` after `dispose()`

#### Scenario: OldestInFlightMs reflects the oldest InFlight dispatch age and resets to 0 when idle
- **GIVEN**: a pool with an injected clock starting at `t = 100`
- **WHEN**: slot `0` is submitted at `t = 100`, slot `1` is submitted at `t = 140`, `readStats` is
  called at `t = 250`, slot `0` settles and releases, and `readStats` is called at `t = 300`, then
  slot `1` settles and releases and `readStats` is called at `t = 320`
- **THEN**: `OldestInFlightMs` reads `150` at `t = 250`, `160` at `t = 300`, and `0` at `t = 320`
