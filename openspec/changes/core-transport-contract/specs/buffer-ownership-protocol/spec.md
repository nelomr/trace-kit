# Capability: buffer-ownership-protocol

> Change: `core-transport-contract`. New capability. Encodes design.md §D1, §D2, §D5.

## ADDED Requirements

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
- **THEN**: the call is a no-op due to a generation mismatch, `stats.ownershipViolations`
  increments by exactly `1`, and no exception is thrown by default

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

#### Scenario: The same slot's buffer is reused across repeated round trips
- **GIVEN**: 100 consecutive acquire/submit/poll/release cycles on `poolPairs = 3`
- **WHEN**: the slot index backing each successive lease is recorded
- **THEN**: the same 3 slot indices repeat cyclically, and total distinct `ArrayBuffer`
  identities created for transit backing after warm-up is constant (not growing with cycle
  count)

### Requirement: Failure-Path-Only Re-Minting
Buffers MUST be re-minted only on the failure path (`onerror`, `onmessageerror`, or deadline
timeout) where the responder has died holding them. Steady-state operation MUST NOT re-mint.

#### Scenario: No re-minting occurs during a clean run
- **GIVEN**: 3,600 round trips with a healthy responder and no injected failure
- **WHEN**: `stats.counters[StatCounter.RemintEvents]` is read after the run
- **THEN**: it equals `0`

#### Scenario: Re-minting occurs only after an injected failure
- **GIVEN**: one injected responder failure via `reportResponderFailure`
- **WHEN**: the pool recovers
- **THEN**: `stats.counters[StatCounter.RemintEvents]` equals exactly `poolPairs`, and no
  re-minting occurred before the injected failure

### Requirement: Explicit Buffer-Consumption Contract on the Public API
The public transport API MUST state, in its type-level shape and its documentation, that
submitting a lease consumes the caller's acquired-phase handle; a caller reading a buffer it has
already submitted is a documented contract violation, not an implicit assumption.

#### Scenario: submit's type signature consumes the acquired-phase lease
- **GIVEN**: `submit(lease: Lease<'acquired'>): Lease<'inflight'>`
- **WHEN**: a fixture calls `port.viewX(acquiredLease)` again after already passing
  `acquiredLease` to `submit`, without using the returned in-flight lease
- **THEN**: `tsc --noEmit` reports a type error, because `acquiredLease`'s declared phase alone
  does not satisfy the accessor after the developer is expected to discard it post-submit (the
  documentation explicitly names this as a caller error class)

### Requirement: Pool Sizing on the Streaming Delta, Not the Dataset
The pool MUST default to `poolPairs = 3`, clamped to `[1, 8]`, and MUST size transit slot
capacity via `transitCapacitySamples` (default `65_536`) independent of total dataset size. A
`setData` bulk load exceeding transit capacity MUST be chunked across successive leases rather
than growing the pool.

#### Scenario: Pool memory footprint does not scale with dataset size
- **GIVEN**: a payload of `1_000_000` samples and a payload of `10_000_000` samples, both loaded
  through `setData`
- **WHEN**: the pool's total allocated transit bytes are measured after each load completes
- **THEN**: the pool's allocated transit byte count is identical in both cases (determined by
  `transitCapacitySamples`, not by the dataset size)

#### Scenario: A bulk load exceeding transit capacity is chunked
- **GIVEN**: `transitCapacitySamples = 65_536` and a `setData` call with `200_000` samples
- **WHEN**: the load is processed
- **THEN**: it is dispatched across at least `4` successive lease acquisitions rather than a
  single oversized lease, and the pool is not resized
