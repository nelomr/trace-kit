# Technical Design: core-transport-contract

> Change 3 of 16. Prerequisite: change 2 (`core-decimation-math`).
> Input: `openspec/changes/core-transport-contract/proposal.md`.
> Evidence: `00-roadmap-decomposition/research.md` claims **C1**, **C4**, **C4b**, **C4c**, **C4d**.
> Exploration: `00-roadmap-decomposition/exploration.md` §1.1, §1.4, §1.5, §1.9, §2, §3, §7.
>
> This document resolves decisions. It does not restate the proposal's motivation.

---

## Context & Background

Claim **C1** (specification-level, primary) is the whole problem: a transferred `ArrayBuffer` is
detached in the sending realm, `byteLength` becomes `0`, pre-existing views fail, and **there is
no mechanism to un-detach in place**. Returning ownership requires transferring the buffer back,
and the buffer that comes back is a *new* `ArrayBuffer` object in the receiving realm — the
original views are dead forever.

Three consequences drive every decision below, and two of them are not in the proposal:

1. **Ownership must be observable, not assumed.** A consumer holding a stale view has no cheap
   way to know it is stale other than a failing read. The contract has to make the stale state
   unreachable rather than merely documented.
2. **The transfer path allocates `O(1)` objects per round trip, but that does not make the
   "zero scavenges" gate unachievable.** Because returned buffers are new objects, each
   settlement must re-mint typed-array views: `O(1)` objects per round trip, independent of
   sample count. An earlier draft of this design concluded from that fact that the proposal's
   "zero scavenges" gate is unachievable when read literally. **Measurement refutes that
   conclusion.** `O(1)` allocation and an observable scavenge are different things: a handful of
   short-lived young-generation view objects per round trip stays below the scavenge threshold
   at streaming rates.

   Measured (orchestrator gate check, probe committed at
   `openspec/changes/00-roadmap-decomposition/evidence/transfer-roundtrip-probe.mjs`, Node
   v20.20.0 under `--expose-gc`): a pooled round trip implemented with
   `structuredClone(payload, { transfer })` in both directions — real detach semantics in both
   realms — over 3,600 iterations, the equivalent of 60 seconds at 60 Hz:

   | `deltaSamples` | GC events | ms per round trip |
   |---|---|---|
   | 4,096 | **0** | 0.0219 |
   | 16,384 | **0** | 0.0560 |
   | 65,536 | **0** | 0.2011 |
   | 262,144 | **0** | 0.7455 |

   So the literal gate holds, and P5's invariance condition is confirmed in advance: GC events
   are flat at zero across a 64x range of payload size. The per-round-trip time scales with
   payload only because the probe's responder performs an `O(n)` copy over the buffer, which is
   the responder's own work and not transfer overhead.

   Consequence: **the gate stays strict.** The transfer-mode pass condition is zero scavenge
   events, not a relaxed `O(1)` budget, and change 2's spec must NOT weaken
   `allocation-free-hot-path` to "`O(1)` per round trip instead of zero" — it keeps zero. §D8's
   split into `sync` and `transfer` modes remains useful, and P5 remains valuable as a regression
   guard rather than as an open question; the `O(1)`-not-`O(n)` property is still the right
   falsifiable claim, it simply already passes.
3. **The authoritative CPU copy for GL restore (exploration §1.4) is not a change-7 concern that
   change 3 merely enables.** It is a *pool structural invariant*: if the pool can ever transfer
   the buffer the renderer re-uploads from, change 7 cannot be built at all. §D5 makes the
   retained/transit split load-bearing here.

---

## Goals & Non-Goals

**Goals**

- An ownership state machine in which reading a detached buffer is a compile error in TypeScript
  and a counted, non-throwing runtime event in plain JavaScript.
- A fixed-capacity pool whose steady-state allocation count is constant and whose saturation
  behaviour is drop-and-count, never allocate.
- A failure path that returns the pool to a known-good state after a responder dies holding
  buffers, with bounded re-minting and no acceptance of zombie replies.
- A `DecimationPort` interface whose synchronous in-thread implementation and change 8's
  asynchronous worker implementation are the *same* interface, with identical caller control
  flow, so change 8 is purely additive.
- A structural guarantee that the main-thread authoritative payload is never transferable.
- A frozen contract for incremental streaming decimation including domain-change invalidation.
- A `SharedArrayBuffer` seam that changes internals only, never the public surface.
- A prototype that can genuinely fail.

**Non-Goals** (owning change named)

- Any real `Worker`, any `workerFactory`, any actual cross-realm transfer — change 8.
- The `SharedArrayBuffer` SPSC ring implementation and `Atomics` control block — change 8.
- The *implementation* of incremental streaming decimation — change 8. Its **contract** is
  frozen here (§D6) because it determines the retained/transit split and transit capacity.
- Any renderer, `ViewportTransform`, GL restore code — changes 5, 7, 9.
- `setData` / `pushStreamData` as public engine API — change 9.
- Browser-side CDP profiling (claim **C4d**) — change 7.

---

## Architecture & Data Flow

Two disjoint buffer classes. This split is the spine of the design.

```text
  MAIN THREAD (authoritative, never transferred)          RESPONDER (worker, change 8)
  ---------------------------------------------           ------------------------------

  RETAINED CLASS                                          TRANSIT CLASS (pool-owned)
  +-------------------------------+                       +------------------------+
  | RawSampleRing  (Retained)     |                       |                        |
  |   capacity C, power of two    |                       |                        |
  |   overwrite-oldest            |                       |                        |
  +---------------+---------------+                       |                        |
                  | (1) set() delta, alloc-free           |                        |
                  v                                       |                        |
  +-------------------------------+   (2) submit: TRANSFER |                        |
  | TransitSlot[poolPairs]        |======================>| slot views re-created  |
  |   xTransit / yTransit / out   |                       | decimate in place      |
  |   <- DETACHED while in flight |<======================| TRANSFER ALL BACK      |
  +---------------+---------------+   (3) settle           +------------------------+
                  | (4) set() result into retained, alloc-free
                  v
  +-------------------------------+
  | SpectrumDataPayload (Retained)|  <-- the ONLY thing the renderer reads
  |   revision++                  |  <-- the authoritative CPU copy for GL restore
  +---------------+---------------+
                  |
                  v
        Canvas2D / WebGL2 (changes 5, 7)  --- webglcontextrestored --> re-upload from Retained
```

Lease lifecycle, one slot:

```text
                      acquire()                 submit(l)
   [Free] ---------------------------> [Acquired] ---------> [InFlight]
     ^                                     |  ^                   |
     |        release(l) (unused)          |  |                   | settle (generation match)
     +-------------------------------------+  |                   v
     |                                        |            [Settled]
     |          release(l) after read         +-----------------+
     +--------------------------------------------------------+
     |
     |  reportResponderFailure() | deadline sweep   (from InFlight only)
     +-- [Lost] --re-mint, generation++--> [Free]      (or -> [Degraded] at re-mint cap)
```

---

## Technical Decisions

### D1. The ownership state machine — enforced by both types and runtime

**Decision.** Ownership is tracked per slot as a five-state machine, and ownership is *never*
expressed as "here is your `ArrayBuffer`". The public currency is an opaque **lease handle**: a
branded `number` packing a slot index and a generation counter. Views are reached only through
port accessors that validate the lease.

```ts
declare const LeaseBrand: unique symbol;
declare const LeaseState: unique symbol;

/** Opaque lease. Phantom-typed by ownership state; a plain number at runtime. */
export type Lease<S extends LeasePhase> = number & {
  readonly [LeaseBrand]: 'trace-kit.transit-lease';
  readonly [LeaseState]: S;
};

export type LeasePhase = 'acquired' | 'inflight' | 'settled';

/** Returned by acquire() at saturation. No throw, no allocation. */
export const SATURATED = -1 as const;
export type Saturated = typeof SATURATED;

export const enum SlotState {
  Free = 0,
  Acquired = 1,
  InFlight = 2,
  Settled = 3,
  Lost = 4,
}
```

Legal transitions, and what an illegal one does:

| From | Operation | To | Illegal-use outcome |
|---|---|---|---|
| `Free` | `acquire()` | `Acquired` | none possible; `acquire` on an exhausted pool returns `SATURATED` |
| `Acquired` | `viewX/viewY/viewOut` | `Acquired` | — (legal, writable) |
| `Acquired` | `submit(l)` | `InFlight` | double `submit` → generation mismatch, ignored, `stats.ownershipViolations++` |
| `Acquired` | `release(l)` | `Free` | — |
| `InFlight` | accessor call | `InFlight` | **compile error** in TS; in JS returns the pre-allocated zero-length sentinel view and `stats.ownershipViolations++` |
| `InFlight` | `settle` (generation match) | `Settled` | generation mismatch → `stats.staleSettlements++`, message discarded |
| `InFlight` | failure / deadline | `Lost` | — |
| `Settled` | accessor call | `Settled` | — (legal, readable) |
| `Settled` | `release(l)` | `Free` | double `release` → generation mismatch, ignored, counted |
| `Lost` | re-mint | `Free` (generation++) | at re-mint cap → `Degraded`, `acquire` returns `SATURATED` permanently |

**Both, not either — and here is the exact division of labour.**

- *Types* catch the only mistake that matters at authoring time: reading a buffer after handing
  it to the port. `submit(l: Lease<'acquired'>): Lease<'inflight'>` consumes the acquired-phase
  handle and hands back an in-flight-phase one; the accessors accept only
  `Lease<'acquired'> | Lease<'settled'>`. Passing the in-flight handle to `viewX` does not
  type-check. This is the mechanism that satisfies proposal item 4 ("buffer consumption stated
  as an explicit API contract") *in the types* and not only in prose.
- *Runtime* catches everything types cannot see: plain-JS consumers, a handle smuggled through a
  `number[]`, a zombie responder's late reply, and TypeScript's own escape hatches. The check is
  an integer compare of the lease's packed generation against the slot's current generation —
  no allocation, no string, no `Error`.

**Cost, stated plainly.**

- Phantom state does not survive a widening to `number`. A caller who stores leases in a plain
  `number[]` loses the compile-time guarantee (the runtime guard still holds). The port
  therefore keeps its own leases in preallocated `Int32Array` slots and consumers are documented
  to pass leases positionally, not to collect them.
- Illegal reads are **silent by default**: they return a frozen zero-length sentinel view and
  increment a counter. Throwing on the hot path is forbidden — exploration §1.5 bans hot-path
  `Error` construction, and a throw in a render loop is worse than a blank frame. The escape is
  an opt-in `assertions: boolean` config flag (default `false`) hoisted to a module-local
  constant-ish field; when set, the port throws **pre-constructed, reused** error instances so
  even the diagnostic path allocates nothing. Development turns it on; production does not.
- A sentinel view means an ownership bug can surface as an empty trace rather than a stack
  trace. Mitigation: `ownershipViolations` is part of the observable stats contract (§D2) and
  the prototype gate (§D8) asserts it is exactly zero.

**Alternatives rejected.**

- *Types only.* Rejected: the library is published to JavaScript consumers, and claim **C1**'s
  failure mode is a silent empty read, not a loud one. A guarantee that evaporates at the
  `.d.ts` boundary is not a guarantee for a protocol thirteen changes depend on.
- *Runtime only.* Rejected: it converts an authoring-time error into a production counter. The
  single most likely consumer mistake — read the buffer you just submitted — is exactly the one
  the type system can eliminate for free.
- *Handing out an owning wrapper object per lease* (`{ x, y, out, state }`). Rejected: one object
  per round trip at 60 Hz, plus the closures typically attached to it. Directly on exploration
  §1.5's ban list and it defeats the very gate this change ships.
- *`Proxy`-based revoked views.* Rejected: a `Proxy` around a typed array destroys element
  access performance in every engine and allocates per lease.
- *A `WeakRef`/`FinalizationRegistry` ownership tracker.* Rejected: non-deterministic timing,
  useless for a per-frame protocol, and it allocates.

### D2. Pool sizing and the backpressure policy

**Decision: `poolPairs` defaults to 3**, configurable, clamped to `[1, 8]`. Slots are minted once
at construction and never again outside the failure path.

Why three:

- **1 pair** is not double buffering: the producer cannot write frame *n+1* while the responder
  holds frame *n*. Every responder latency above one frame period drops. It is a stall by design.
- **2 pairs** is classic double buffering and tolerates exactly one frame of responder latency.
  It drops on *any* single late frame — and a minor GC inside the worker realm is a routine
  single-frame spike, so a 2-pair pool would report drops during healthy operation, destroying
  the health signal in §D2's discrimination rule below.
- **3 pairs** absorbs a two-frame latency spike (≈33 ms at 60 Hz), which covers worker-side minor
  GC and scheduler jitter, while bounding worst-case display staleness to three frames (≈50 ms)
  and memory to 3×.
- **4+ pairs** buys nothing. At steady state the pool is either draining — in which case depth is
  irrelevant, the responder is faster than the producer — or saturated, in which case extra depth
  only lengthens the queue: the frames displayed get older without any more of them arriving.
  Deeper pools trade latency for a drop counter nobody wanted to reduce. The upper clamp of 8
  exists for offline/batch callers, not for the 60 Hz path.

**Capacity, and the sizing insight that matters more than the pair count.** Transit slots are
sized on the **streaming delta**, not on the dataset. Per §D6 only new samples travel:

| Sizing basis | Per-pair bytes (f32, X+Y+out at 2× buckets) | 3 pairs |
|---|---|---|
| Full dataset, `C = 1e6` | ≈ 8 MB + output | ≈ 24–30 MB |
| Delta window, `C = 65 536` | ≈ 0.5 MB + output | ≈ 1.6 MB |

The pool is therefore configured with `transitCapacitySamples` (default `65_536`) which is
independent of dataset size. A `setData` bulk load exceeding it is chunked across successive
leases rather than forcing a larger pool — the pool's memory footprint must not scale with the
user's dataset.

**Saturation policy.** `acquire()` returns `SATURATED` (`-1`). The ingest path drops the chunk.
Nothing is queued, nothing is allocated, nothing throws.

**What is counted.** A fixed-shape stats block, backed by preallocated typed arrays so every
increment is a typed-array store:

```ts
export interface TransportStatsView {
  /** Int32Array, length = TRANSPORT_STAT_COUNT_I32 */
  readonly counters: Int32Array;
  /** Float64Array, length = TRANSPORT_STAT_COUNT_F64 */
  readonly gauges: Float64Array;
}

export const enum StatCounter {
  ChunksAccepted = 0,
  ChunksDropped = 1,
  ConsecutiveDrops = 2,      // reset to 0 on every accept
  MaxConsecutiveDrops = 3,   // high-water mark, never reset
  SamplesDropped = 4,
  LeasesOutstanding = 5,
  PoolExhaustionEvents = 6,  // transitions into the saturated condition
  StaleSettlements = 7,
  OwnershipViolations = 8,
  RemintEvents = 9,
  ResponderFailures = 10,
  DomainRebuilds = 11,
  DomainShifts = 12,
  Health = 13,               // TransportHealth
}

export const enum StatGauge {
  LastAcceptMs = 0,
  LastSubmitMs = 1,
  OldestInFlightMs = 2,
}

export const enum TransportHealth {
  Ready = 0,
  Saturated = 1,   // dropping, but still accepting
  Stalled = 2,     // no accept for stallDropThreshold consecutive drops
  Recovering = 3,
  Degraded = 4,    // re-mint cap reached; terminal
}
```

**How it is surfaced.** `port.readStats(out: TransportStatsView): void` copies into a
caller-owned view with `set()`. No object is returned, no object is created, and there is no
event, callback or `Promise` — all four would allocate per read at 60 Hz. The playground HUD
(change 4) and the adapters (10, 11) poll it once per frame into a single long-lived view.

**Healthy dropping versus a pathological stall — the discrimination rule.** Two counters, read
together:

- *Healthy steady-state dropping*: `ChunksAccepted` is strictly increasing between reads **and**
  `ConsecutiveDrops <= poolPairs`. This is a producer that is simply faster than the responder;
  the display is current, some chunks never render, and that is the intended behaviour.
- *Pathological stall*: `ConsecutiveDrops >= stallDropThreshold` (default `120`, i.e. two
  seconds at 60 Hz — an order of magnitude beyond any legitimate jitter) **while**
  `ChunksAccepted` has not moved. `Health` flips to `Stalled`, and that flip is what arms the
  §D3 failure path. `MaxConsecutiveDrops` preserves the evidence for a HUD or a bug report even
  if the stall then clears.

The distinction is deliberately *not* a rate or a wall-clock threshold: exploration §1.5 and
confirmed decision 3 rule out wall-clock gates, and `ConsecutiveDrops` is a deterministic work
count that behaves identically on a shared CI runner and on reference hardware.

**Alternatives rejected.**

- *Grow the pool under pressure.* Rejected: allocation under load is the exact failure mode
  CLAUDE.md rule 2 exists to prevent, and it makes the drop counter — the only honest load
  signal — unreachable.
- *Queue chunks and coalesce.* Rejected: a queue is either preallocated and therefore just a
  deeper pool (see "4+ pairs"), or dynamic and therefore allocating.
- *Drop the oldest in-flight instead of the newest arrival.* Rejected: in-flight buffers are
  detached; there is nothing to reclaim without a responder round trip (claim **C1**). "Cancel"
  is not expressible over a transfer protocol.
- *Throw at saturation.* Rejected: hot-path `Error` construction is banned, and saturation is a
  normal operating condition, not an exception.

### D3. The failure path

**Decision.** Detection is two-channel, sweeping is lazy, recovery is bounded re-minting behind a
generation counter, and the re-mint budget is capped.

*Detection channel 1 — explicit.* The adapter that owns the `Worker` (change 8) wires `onerror`
and `onmessageerror` to `port.reportResponderFailure(reason: FailureReason)`. The core never
touches a worker event; it exposes the entry point. `FailureReason` is a numeric enum, not a
string, so reporting allocates nothing.

*Detection channel 2 — deadline.* A hung responder emits no event at all. Each `submit` stamps
`gauges[StatGauge.LastSubmitMs]` and the slot's own dispatch timestamp (a `Float64Array` field).
A sweep compares the oldest in-flight timestamp against `leaseTimeoutMs` (default `1000` — ≈60
frames, far beyond any legitimate jitter, still a sub-second recovery). The sweep runs **lazily,
inside `acquire()` and `poll()`**: no `setInterval`, no `setTimeout`, no timer handle. That is
not only an allocation decision — a timer in the isomorphic core would need `globalThis`
scheduling semantics that differ between Node and the browser, and it would keep the event loop
alive after `dispose()`.

*Re-minting and the generation guard.* On detection, every `InFlight` slot moves to `Lost`. Lost
slots get a fresh `ArrayBuffer` and fresh views, and the slot's `generation` is incremented. The
generation increment is the load-bearing half: a zombie responder that later posts a reply for
the pre-failure lease carries a stale generation, so `settle` discards it and increments
`StaleSettlements`. Without it, a crashed-then-respawned worker's late message would write into
a slot that has already been re-leased — silent data corruption across frames, and the single
worst bug this protocol could ship. `Health` moves `Recovering` → `Ready` when the last lost
slot is re-minted.

*The cap.* `maxRemintEvents` (default `8`). Beyond it, `Health` becomes `Degraded`, `acquire()`
returns `SATURATED` permanently, and no further memory is minted. A crash-looping responder is
thereby prevented from becoming an unbounded allocation source, and change 9's permanent
degradation to Canvas2D (exploration §1.4) has a deterministic trigger to read.

**Why re-minting does not violate the zero-allocation rule.** CLAUDE.md rule 2 governs
*continuous render loops and pan/zoom sweeps* — the steady-state path. The failure path is none
of those things:

1. It is not steady state. It fires when the responder is already dead; by definition no further
   round trip is in progress on that slot.
2. Claim **C1** makes re-minting the only option that exists. The memory is in a dead realm.
   There is no un-detach in place, and no message can come back to return it. The alternatives
   are re-mint, or shrink the pool permanently on every worker crash until the transport stops
   working — which converts a recoverable fault into a terminal one.
3. It is bounded twice over: at most `poolPairs` re-mints per failure event, and at most
   `maxRemintEvents` events for the lifetime of the port. Total failure-path allocation is
   therefore a constant fixed at construction, not a function of runtime or data volume.
4. It is observable: `RemintEvents` is in the stats contract, and the prototype (§D8) asserts
   the count is exactly `poolPairs` after one injected failure and zero during a clean run.

**Alternatives rejected.**

- *Pre-mint spare slots to cover failures.* Rejected: it pays the memory unconditionally to avoid
  an allocation that only occurs on an exceptional path, and it does not remove the need to
  re-mint on the *second* failure.
- *Recreate the whole port on failure.* Rejected: it discards the retained authoritative payload
  and the raw ring along with the pool, which is precisely the state that must survive a
  responder crash so the chart keeps rendering the last good frame.
- *Trust `onerror` alone.* Rejected: a hung responder — an infinite loop in a decimation kernel,
  a blocked `Atomics.wait` — never fires it. Without the deadline sweep the pool leaks slots
  until permanent saturation, which the stats would report as a stall with no cause.
- *A watchdog timer.* Rejected for the isomorphism and lifecycle reasons above.

### D4. The `DecimationPort` surface and the async injection seam

**Decision.** One interface, pull-based settlement, numeric handles, no `Promise` and no callback
in the hot path.

```ts
export const enum DecimationKind { MinMaxEnvelope = 0, Lttb = 1 }
export const enum PortMode { Synchronous = 0, Asynchronous = 1 }
export const enum FailureReason { WorkerError = 0, MessageError = 1, Timeout = 2, Disposed = 3 }

/** Per-lease request parameters, written in place into slot-resident storage. */
export interface DecimationRequestWriter {
  setKind(lease: Lease<'acquired'>, kind: DecimationKind): void;
  setSampleCount(lease: Lease<'acquired'>, count: number): void;
  setBucketCount(lease: Lease<'acquired'>, buckets: number): void;
  setDomain(lease: Lease<'acquired'>, min: number, max: number): void;
}

export interface DecimationPort extends DecimationRequestWriter {
  readonly mode: PortMode;
  readonly poolPairs: number;
  readonly transitCapacitySamples: number;

  /** Claims a free slot, or SATURATED. Runs the lazy deadline sweep. Never throws, never allocates. */
  acquire(): Lease<'acquired'> | Saturated;

  /** Writable views onto the claimed slot. Illegal phases are a compile error. */
  viewX(lease: Lease<'acquired'> | Lease<'settled'>): Float32Array;
  viewY(lease: Lease<'acquired'> | Lease<'settled'>): Float32Array;
  viewOut(lease: Lease<'acquired'> | Lease<'settled'>): Float32Array;
  viewIndices(lease: Lease<'acquired'> | Lease<'settled'>): Int32Array;

  /** Hands ownership to the responder. The acquired-phase handle is consumed. */
  submit(lease: Lease<'acquired'>): Lease<'inflight'>;

  /** Drains settled leases into a caller-owned sink. Returns how many were drained. */
  poll(sink: SettlementSink): number;

  /** Returns the slot to the pool. Mandatory after reading a settled lease. */
  release(lease: Lease<'acquired'> | Lease<'settled'>): void;

  reportResponderFailure(reason: FailureReason): void;
  readStats(out: TransportStatsView): void;
  dispose(): void;
}

/** Implemented by the caller; instance is long-lived, so no per-settlement allocation. */
export interface SettlementSink {
  onSettled(lease: Lease<'settled'>, outCount: number): void;
}
```

**The synchronous default.** `createSyncDecimationPort(config): DecimationPort` runs
`minMaxEnvelope` / `lttb` from change 2 inline on the calling thread. Crucially it does **not**
short-circuit the state machine: `submit` moves the slot to `InFlight`, performs the work, moves
it to `Settled`, and pushes the lease into a preallocated settlement ring. `poll` drains that
ring. The synchronous port therefore exercises the same states, the same generation guard and the
same stats as a worker port — the only difference is that `InFlight` is not observable from
outside and no buffer is ever detached.

**The seam that makes change 8 additive.** The caller's loop is byte-identical for both modes:

```ts
// This loop is unchanged when change 8 swaps in the worker port.
const lease = port.acquire();
if (lease !== SATURATED) {
  ring.copyDeltaInto(port.viewX(lease), port.viewY(lease));
  port.setKind(lease, DecimationKind.MinMaxEnvelope);
  port.setSampleCount(lease, delta);
  port.submit(lease);
}
port.poll(sink);   // sync: drains this frame's work. async: drains an earlier frame's.
```

Three properties make that true, and each is a decision:

1. **Settlement is pull-based, never push-based.** A callback or `Promise` per settlement would
   allocate (and `async` is on the exploration §1.5 ban list), and it would give the sync and
   async ports different control flow — the caller would have to be rewritten in change 8.
   `poll` returning `0` is a legal, expected outcome in async mode and a normal outcome in sync
   mode when nothing was submitted.
2. **Ownership is expressed identically in both modes.** The sync port never detaches anything,
   yet the accessors still reject an in-flight lease. A consumer written against the sync port is
   therefore already correct against the worker port; it cannot have accidentally depended on the
   sync port's non-detaching behaviour, because the type system forbade the shape that would have
   let it.
3. **Construction is the only difference.** `createWorkerDecimationPort({ ...config,
   workerFactory })` is a *new export* in change 8. `DecimationPort` does not change; no existing
   signature changes; nothing becomes optional that was required. Additive by construction.

**Capability detection.** Lazy, inside a function body, never at module scope — exploration §1.9:

```ts
export interface TransportCapabilities {
  readonly sharedMemory: boolean;
  readonly workerConstructor: boolean;
  readonly crossOriginIsolated: boolean;
}

export function detectTransportCapabilities(): TransportCapabilities {
  // Every global reference lives inside this body. No module-scope global access anywhere
  // in @trace-kit/core (CLAUDE.md rule 5, exploration §1.9). Result is NOT cached at module
  // scope either: a cached module-level value would be captured at import time, which is the
  // same SSR hazard in a different disguise.
  const g: typeof globalThis = globalThis;
  return {
    sharedMemory: typeof g.SharedArrayBuffer !== 'undefined',
    workerConstructor: typeof g.Worker !== 'undefined',
    crossOriginIsolated: 'crossOriginIsolated' in g && g.crossOriginIsolated === true,
  };
}
```

`@trace-kit/core` constructs no `Worker` anywhere, and a source-level CI gate asserts no
`Worker`/`self` reference at module scope (proposal's isomorphism criteria).

**Alternatives rejected.**

- *`Promise<DecimationResult>` per request.* Rejected: two allocations per frame minimum
  (promise + result), `async` is banned in hot paths, and it forces every consumer to be
  rewritten between change 3 and change 8.
- *An `EventTarget` / `MessagePort`-shaped port.* Rejected: `dispatchEvent` allocates an event
  object per settlement and drags a DOM-shaped API into the isomorphic core.
- *Request objects passed to `submit(request)`.* Rejected: one object per frame. Slot-resident
  parameter storage written through `setKind`/`setSampleCount`/... allocates nothing.
- *Two separate interfaces (`SyncDecimationPort` / `AsyncDecimationPort`).* Rejected: it pushes
  the mode into every consumer's type signature, so change 8 would be a breaking change for
  changes 5, 9, 10 and 11 — exactly the outcome this change exists to prevent.
- *A `workerFactory?` optional field on this change's config, unused until change 8.* Rejected:
  dead configuration invites a module-scope `Worker` type reference and lies about what is
  implemented. Change 8 adds a new factory function instead.

### D5. The authoritative CPU copy for GL restore

**Decision.** The authoritative main-thread copy lives in the **retained class**, and the retained
class is structurally incapable of being transferred. Two brands over the same underlying typed
arrays, and a transfer list whose element type admits only one of them:

```ts
declare const OwnershipClass: unique symbol;

/** Main-thread authoritative. MUST NOT appear in any transfer list. Never detached. */
export type Retained<T extends ArrayBufferView> = T & {
  readonly [OwnershipClass]: 'retained';
};

/** Pool-owned, transferable, detached while in flight. */
export type Transit<T extends ArrayBufferView> = T & {
  readonly [OwnershipClass]: 'transit';
};

/** The only type the transfer list accepts. A Retained buffer cannot be passed here. */
export type TransferableBacking = Transit<Float32Array> | Transit<Int32Array>;
export function collectTransferList(
  slot: number,
  out: readonly TransferableBacking[],
): readonly ArrayBufferLike[];
```

**How the pool guarantees the authoritative copy is never the transferred instance.** Three
mechanisms, in increasing bluntness:

1. **Type-level.** The transfer-list builder accepts `Transit<...>` only. `Retained<Float32Array>`
   is not assignable to it. There is no code path in `@trace-kit/core` that widens a retained
   buffer to `TransferableBacking`.
2. **Structural.** Retained buffers and transit buffers are minted from **separate**
   `ArrayBuffer`s at construction. No retained view ever shares a backing store with a transit
   view, so a transfer cannot detach a retained view as a side effect. This is the mechanism that
   actually matters: brands erase at runtime, separate backing stores do not.
3. **Data flow.** Results move transit → retained by `retainedOut.set(transitOut, 0)` when the
   lengths match, and otherwise by an explicit indexed loop over an offset and a count. Never by
   `.subarray`, which allocates a view object and is on the exploration §1.5 ban list. Either
   permitted form allocates nothing. The retained buffer's `revision` is then incremented.

**What the renderer contract may therefore assume** — this is the coupling that makes change 7
possible:

- A renderer's `setData` receives only `Retained` buffers. **A renderer never sees a transferable
  buffer and never participates in the transfer protocol at all.**
- Every buffer a renderer holds is readable at every instant of the renderer's lifetime.
  `byteLength` is never `0`; a pre-existing view never fails. Therefore on
  `webglcontextrestored`, `bufferData` from the retained buffers is unconditionally valid, and
  exploration §1.4's "genuinely unrecoverable: vertex data that was transferred away" case is
  eliminated by construction rather than mitigated.
- `revision` is monotonic, so the renderer can distinguish "same data, restore the context" from
  "new data, re-upload" with an integer compare and no dirty-flag protocol.
- The copy cost is bounded by the *decimated* output size (≈2× viewport width, ≈4–8 k values),
  not by the dataset. One `set()` of 8 k floats is single-digit microseconds and allocation-free.

**Alternatives rejected.**

- *Renderer reads transit buffers directly (zero-copy all the way to the GPU).* Rejected: it
  saves a microsecond-scale `set()` and forfeits GL restore entirely. The renderer would hold
  views that detach on the next submit, which is exactly claim **C1**'s permanently-blank-chart
  failure. This is the single most tempting wrong answer in the change and it is why the
  retained class exists.
- *Re-copy from raw samples on restore instead of retaining the decimated output.* Rejected: it
  requires the raw ring to still span the displayed domain (not guaranteed for a streaming
  window) and requires re-running decimation during a context-loss event, when the main thread is
  already recovering. Restore must be a pure upload.
- *`buffer.slice(0)` before each submit.* Rejected in the proposal already: 4 MB/frame at 60 Hz
  is 240 MB/s of garbage. Note that the retained copy above is **not** this: it copies the small
  decimated output once, not the large input per frame.
- *Keep the authoritative copy in the worker.* Rejected: GL restore runs on the main thread, and
  a worker round trip during context recovery is both slow and unavailable if the worker is the
  thing that died.

### D6. Incremental streaming decimation, and the domain-change case

**Correction to the proposal first.** The proposal defers incremental decimation wholly to change
8. Its *implementation* can be deferred; its **contract cannot**, because the retained/transit
split (§D5) and the transit capacity (§D2) are both derived from the fact that only a *delta*
travels. If change 3 froze the contract assuming full-window transfers, change 8 would either
re-open the ownership protocol or ship a 24 MB pool. This section therefore freezes the data
structures and the invalidation policy; change 8 writes the code.

**The ring.**

```ts
export interface RawSampleRing {
  readonly capacity: number;          // power of two
  readonly x: Retained<Float32Array>; // capacity elements
  readonly y: Retained<Float32Array>;
  /** Monotonic count of samples ever written. Never wraps in f64 at any realistic rate. */
  totalWritten: number;
  writeIndex: number;                 // totalWritten & (capacity - 1)
}
```

Overwrite-oldest, masked indexing (`i & (capacity - 1)`), no modulo, no branch. Retained, so it
survives every responder failure and every context loss.

**The accumulator.** For a bucket layout over the current domain, with `bucketCount = min(
bucketOversample * viewportWidthPx, maxBuckets)` and `bucketOversample` default `2`:

```ts
export interface BucketAccumulator {
  readonly bucketCount: number;
  readonly min: Retained<Float32Array>;   // bucketCount
  readonly max: Retained<Float32Array>;   // bucketCount
  readonly count: Retained<Int32Array>;   // bucketCount, 0 = empty bucket
  /** Circular origin so an aligned pan is a rotation, not a rebuild. */
  bucketOrigin: number;
  domainMin: number;
  invBucketWidth: number;
  /** Oldest sample sequence represented; compared against ring.totalWritten - capacity. */
  coveredFromSeq: number;
  revision: number;
}
```

Ingest is `O(new samples)`, with no allocation:

```ts
// per new sample: two compares, one store-if, one increment. No object, no closure.
const b = (((x - domainMin) * invBucketWidth) | 0);
if (b >= 0 && b < bucketCount) {
  const s = (b + bucketOrigin) & bucketMask;
  if (count[s] === 0) { min[s] = y; max[s] = y; }
  else { if (y < min[s]) min[s] = y; if (y > max[s]) max[s] = y; }
  count[s]++;
}
```

This works because **min/max is a semilattice**: idempotent, commutative, associative, and
therefore incrementally updatable and mergeable. It is not invertible — you cannot remove a
sample's contribution — and that single algebraic fact is what makes the domain-change case hard.

**The hard case: the viewport domain changes, so bucket boundaries are invalidated.** Three tiers,
selected by what actually changed.

*Tier 1 — aligned pan (the streaming steady state).* The zoom is unchanged and the new
`domainMin` differs by an exact integer multiple `k` of the current bucket width. Then no bucket
boundary moves; the window slides. Rotate `bucketOrigin` by `k`, reset the `k` vacated buckets
(`fill(0)` over a contiguous or two-part span — allocation-free), and re-scan from the retained
ring only the samples that fall into the newly exposed span. Cost `O(k + newly exposed samples)`.
A live sweep advancing its right edge is exactly this case, which is why it is tier 1 rather than
an optimisation. `DomainShifts` counts it.

*Tier 2 — zoom change, or a non-aligned pan, with the gesture settled.* Boundaries genuinely
move; min/max cannot be un-mixed. Full rebuild: `min.fill(0)`, `max.fill(0)`, `count.fill(0)`,
recompute `domainMin`/`invBucketWidth`, reset `bucketOrigin = 0`, then one pass over the ring
samples inside the new domain, into the **same preallocated arrays**. Allocation-free (`fill` and
an indexed loop allocate nothing). Cost is one min/max pass — ≈1.7 ms per 1e6 samples per claim
**C4b** — and it happens **once per settled domain change**, not once per frame. `DomainRebuilds`
counts it.

*Tier 3 — during a continuous gesture, do not rebuild at all.* Rebuilding per frame during a
pinch-zoom is the `O(n)`-per-frame trap in a new costume. Instead, render from the *existing*
accumulator:

- **Zoom out** is exact. Merging adjacent buckets is `min(merge) = min(min_i)` and
  `max(merge) = max(max_i)` — the semilattice property again. No fidelity loss whatsoever.
- **Zoom in** is exact up to the `bucketOversample` factor (default 2×): the existing buckets are
  finer than the new viewport needs, so re-indexing them is sufficient. Beyond 2× the envelope
  becomes bucket-quantised — visibly blockier for the duration of the gesture.

The honest fidelity statement, against CLAUDE.md rule 6: a merged or re-indexed min/max bucket
still **bounds every sample it contains**. No peak is lost, no dip is lost, no value is
fabricated, and no interpolation occurs. The degradation is *resolution*, not *correctness*.
The gesture-end rebuild is therefore mandatory, not best-effort, and change 9's "switch only on
gesture end" rule (exploration §1.3) is the same trigger.

*History underrun.* If the requested domain reaches before `ring.totalWritten - capacity`, the
rebuild cannot fabricate the missing span. It sets a `partialHistory` flag and leaves the
uncovered buckets with `count === 0`. Empty buckets render as a gap, never as an interpolated
line. Consumers must treat `count[s] === 0` as "no data", which is why `count` is part of the
frozen contract rather than an implementation detail.

**Alternatives rejected.**

- *Re-decimate the full window every frame.* Rejected: exploration §1.1 — `O(n)` per frame cannot
  sustain 60 Hz at 1e6 points, and it is the brief's actual omission.
- *A removable-aggregate structure (per-bucket monotonic deque, or a segment tree over the ring)
  so pans need no re-scan.* Rejected: a deque allocates nodes per sample; a segment tree is
  `O(log n)` per sample plus `2n` memory and only pays off for arbitrary sliding-window removal,
  which tier 1's aligned rotation already handles at `O(k)`. Complexity without a matching win.
- *Fixed bucket boundaries in data space, independent of the viewport.* Rejected: the whole point
  of decimating to ≈2× viewport width is that buckets track device pixels. Data-space buckets
  either over-decimate when zoomed in (losing peaks — rule 6) or under-decimate when zoomed out.
- *Recompute in the worker on every domain change.* Rejected: it puts a user gesture behind a
  round trip and a possible saturation drop, so a zoom could visibly fail to respond.

### D7. `SharedArrayBuffer` as an optional path

**Decision.** The backing store is an internal enum; the public interface does not know it exists.

```ts
export const enum BufferBacking { Transfer = 0, Shared = 1 }
```

Because the public currency is a lease handle plus accessors (§D1) and never a raw `ArrayBuffer`,
the shared path changes only internals:

| Aspect | `Transfer` backing (built now) | `Shared` backing (change 8) |
|---|---|---|
| `submit` | posts with a transfer list; slot views detach | writes an `Atomics` sequence; nothing detaches |
| Settlement | new `ArrayBuffer`, views re-minted (`O(1)`/round trip) | views are stable forever; **genuinely zero allocation** |
| `generation` | incremented per re-mint and on failure | never incremented on the happy path |
| Detached reads | possible; guarded by §D1 | structurally impossible |
| `poll` | drains a settlement ring filled by `onmessage` | drains an SPSC ring read with `Atomics.load` |
| Public API | `DecimationPort` | **identical `DecimationPort`** |

This yields a second, principled reason for the shared path that the proposal does not state:
it is not only lower latency, it is the only backing under which the round trip is *literally*
zero-allocation, because it never detaches and therefore never re-mints a view (§D1 cost, §D8
mode T). That strengthens confirmed decision 4 rather than weakening it — the pooled transfer
path remains the default precisely because it works on GitHub Pages and inside StackBlitz, and
`O(1)`-per-round-trip allocation is an acceptable price for universal deployability.

Capability detection is `detectTransportCapabilities()` (§D4), lazy and in-function-body, and
`crossOriginIsolated` is read for reporting only.

**Normative, and asserted by tests in this change:** no TraceKit feature may be gated on
`crossOriginIsolated`, `SharedArrayBuffer`, or COOP/COEP. Every ownership invariant passes with
`SharedArrayBuffer` absent, and a test runs the full suite in an environment where the global is
deleted. Claim **C4c** independently rules out `measureUserAgentSpecificMemory` for the same
isolation reason, so no instrumentation reintroduces the requirement through the back door.

**Deliberately not built now:** the SPSC ring itself, the `Atomics` control-block layout,
`Atomics.wait`/`waitAsync` blocking handoff, growable `SharedArrayBuffer`, any Node
`worker_threads` adapter, and any documentation that recommends serving COOP/COEP headers.

**Alternatives rejected.**

- *Shared-by-default with a transfer fallback.* Rejected: it makes the fallback the untested path
  while the tested path is unavailable on the actual deployment target. Confirmed decision 4.
- *A separate `SharedDecimationPort` type.* Rejected: it forks the public API, which is the exact
  outcome the seam exists to prevent, and it would make backing choice a consumer concern.
- *Expose the backing in the config as a required field.* Rejected: it leaks an internal decision
  into every call site and every documented example. It is an internal optimisation selected by
  detection, with an optional override for benchmarking only.

### D8. The de-risking prototype, and how it can fail

**Location.** `packages/core/bench/ownership-prototype.mjs`, run as
`node --expose-gc --trace-gc packages/core/bench/ownership-prototype.mjs [flags]`, committed and
re-runnable, modelled directly on the working
`00-roadmap-decomposition/evidence/gc-observer-probe.mjs` (same `PerformanceObserver({ entryTypes:
['gc'] })` instrumentation, same warm-up-then-measure structure, same allocating control).

**Two modes, because the proposal's single gate is not achievable as written.**

- **Mode `sync`** — the pool, lease state machine, backpressure accounting and stats driven
  in-thread with no transfer. This is where "zero scavenges" is a real, achievable gate: nothing
  detaches, so nothing is re-minted, and any GC event is the pool's own bookkeeping allocating.
- **Mode `transfer`** — real detach semantics without a `Worker`, via
  `structuredClone(msg, { transfer: [...] })`, which performs the standardised transfer steps
  in-process. This genuinely detaches (claim **C1**) and genuinely hands back new `ArrayBuffer`
  objects, so it exercises the generation guard, the accessor sentinel, and the view re-mint —
  the parts of the protocol that only exist because of transfer. Here the gate is **not** zero
  scavenges — measurement in claim **C1b** shows zero scavenges is in fact achievable and is
  therefore retained as the pass condition — it is *additionally* that allocation is `O(1)` per
  round trip and invariant to payload size.

**Run shape.** 3,600 iterations (60 s at 60 Hz), `poolPairs = 3`,
`transitCapacitySamples = 65_536`, synthetic Lorentzian stream, `deltaSamples` configurable.
Warm-up of 200 iterations, `globalThis.gc()`, then measurement — cold interpreted execution
before TurboFan tiering would otherwise dominate (exploration §1.5).

**Measured.** GC entries split by `detail.kind` against `NODE_PERFORMANCE_GC_*` (scavenges
isolated from major GCs, per claim **C4b**); detached-access exception count; `ownershipViolations`;
`staleSettlements`; `remintEvents`; `chunksAccepted` / `chunksDropped` / `maxConsecutiveDrops`;
pool allocation count after warm-up; and the per-settlement view-construction count.

**Pass conditions.**

| # | Mode | Assertion |
|---|---|---|
| P1 | sync | **0** scavenge events over 3,600 iterations after warm-up |
| P2 | sync | pool allocation count constant; identical at iteration 200 and 3,600 |
| P3 | both | **0** detached-buffer exceptions; **0** `ownershipViolations` |
| P4 | transfer | view re-mints per settlement exactly `3` (X, Y, out) — a constant |
| P5 | transfer | scavenge count at `deltaSamples = 4_096` equals that at `65_536` within ±1 |
| P6 | both | with a responder that keeps up: `chunksDropped === 0` |
| P7 | both | with an injected 10-frame stall: `chunksDropped` equals the injected stall length exactly, allocation count unchanged, `health` never `Stalled` (10 < 120) |
| P8 | both | with an injected 200-frame stall: `health === Stalled`, and it clears on the next accept |
| P9 | both | after one injected responder failure: `remintEvents === poolPairs`, health returns to `Ready`, and a replayed stale settlement is rejected (`staleSettlements === 1`) with no slot corruption |
| P10 | both | an allocating control variant in the same run reports non-zero scavenges, proving the gate is live and not vacuous (the **C4b** discipline: 0 versus 17) |

**What would falsify the design — as opposed to merely inconveniencing it.**

- **P5 fails** (scavenges scale with `deltaSamples`): the transfer path allocates proportionally
  to payload. The `O(1)` claim in §D1 is wrong, the retained/transit split is not buying what it
  claims, and the pooled-transfer default must be re-derived — most likely by promoting the
  shared-memory path from optional to recommended, which collides head-on with confirmed decision
  4 and would have to be escalated as a product decision, not patched.
- **P3 fails** (any detached read reaches a consumer): the generation guard is insufficient. The
  fallback is a per-lease owning wrapper, which costs one object per frame and reopens the entire
  zero-allocation premise. This is the assertion most worth trusting.
- **P1 fails**: the pool's own bookkeeping allocates. The lease-handle-as-branded-number design
  has failed on its own terms and §D1 must be re-derived before anything downstream is built.
- **P9 fails** (more than `poolPairs` re-mints, or a stale settlement accepted): the failure state
  machine is unsound and §D3's generation guard does not do what it claims. A zombie reply
  corrupting a re-leased slot is a silent cross-frame data corruption, the worst outcome in the
  document.
- **P7 fails** in the direction of drops during a healthy run: pool sizing or the accounting is
  wrong, and §D2's health discrimination rule is unusable — which would make every downstream
  consumer blind to real backpressure.
- **P10 fails** (the allocating control reports zero): the instrumentation is not measuring
  anything and no other result in the run may be believed. This is the gate on the gate.

**What would *not* falsify it, stated so the prototype cannot be argued into passing or failing
on the wrong evidence:** absolute millisecond figures (informational, change 16); a scavenge
attributable to the harness itself (excluded by measuring only between markers, after warm-up —
the **C4b** probe measured a 32 KB heap delta from observer bookkeeping alone); major-GC events
(counted separately and not gated, since a major GC can be triggered by anything in the process);
and any result from a run without the warm-up phase.

---

## File Changes

| Action | File Path | Description |
|---|---|---|
| NEW | `packages/core/src/transport/index.ts` | Public barrel for the transport surface; effect-free re-exports only |
| NEW | `packages/core/src/transport/ownership.ts` | `Lease`, `LeasePhase`, `SlotState`, `SATURATED`, `Retained`/`Transit` brands, `TransferableBacking`, lease packing/unpacking |
| NEW | `packages/core/src/transport/decimation-port.ts` | `DecimationPort`, `DecimationRequestWriter`, `SettlementSink`, `PortMode`, `DecimationKind`, `FailureReason` |
| NEW | `packages/core/src/transport/buffer-pool.ts` | Fixed-capacity slot pool, state machine, generation guard, lazy deadline sweep, bounded re-minting, re-mint cap |
| NEW | `packages/core/src/transport/backpressure.ts` | `TransportStatsView`, `StatCounter`, `StatGauge`, `TransportHealth`, allocation-free increments, health discrimination |
| NEW | `packages/core/src/transport/sync-port.ts` | `createSyncDecimationPort` — full state machine, work performed inline, settlement ring |
| NEW | `packages/core/src/transport/capabilities.ts` | `detectTransportCapabilities`, `BufferBacking`; every global reference inside a function body |
| NEW | `packages/core/src/transport/streaming-contract.ts` | `RawSampleRing`, `BucketAccumulator`, tier-1/2/3 invalidation contract, `partialHistory`; types and invariants frozen here, implementation in change 8 |
| MODIFY | `packages/core/src/index.ts` | Re-export the transport surface; no module-scope globals, `sideEffects`-safe |
| NEW | `packages/core/test/transport/ownership-invariants.test.ts` | Exactly-one-owner over a round trip; `byteLength === 0` after submit and restored after settle; buffer identity preserved; pre-existing view fails (asserted as expected behaviour) |
| NEW | `packages/core/test/transport/pool-lifecycle.test.ts` | Every legal transition; every illegal transition counted and non-throwing; assertions mode throws pre-constructed errors |
| NEW | `packages/core/test/transport/backpressure.test.ts` | Drop-and-count at saturation, allocation count unchanged, healthy-vs-stalled discrimination |
| NEW | `packages/core/test/transport/failure-path.test.ts` | `onerror`/`onmessageerror`/timeout detection, bounded re-mint, stale settlement rejection, re-mint cap → `Degraded` |
| NEW | `packages/core/test/transport/retained-isolation.test.ts` | Retained and transit never share a backing store; retained `byteLength` never `0`; `revision` monotonic |
| NEW | `packages/core/test/transport/capabilities.test.ts` | Full suite passes with `SharedArrayBuffer` deleted; no path requires `crossOriginIsolated`; detection is lazy |
| NEW | `packages/core/test/transport/isomorphism.test.ts` | Source-level gate: no `Worker`/`self` at module scope, no `Worker` construction anywhere in `packages/core` |
| NEW | `packages/core/bench/ownership-prototype.mjs` | The §D8 harness, both modes, all ten pass conditions, allocating control |
| NEW | `packages/core/bench/gc-gate.mjs` | Shared `PerformanceObserver` GC-event helper adapted from the committed C4b probe |
| MODIFY | `packages/core/package.json` | `bench:ownership` script with `--expose-gc --trace-gc`; no new runtime dependency |
| NEW | `.changeset/*.md` | `patch` bump for `@trace-kit/core` (CLAUDE.md rule 8) |

No file outside `packages/core` and `.changeset/` is touched. `packages/renderers`, `packages/vue`,
`packages/react` and `apps/playground` are not created and not modified.

---

## Required Changes to `SpectrumDataPayload` (change 2 must absorb these)

Change 2's spec is not yet written, so these belong there rather than as a later breaking change.
Each is a direct consequence of a decision above.

1. **Payload buffers are `Retained`, normatively.** §D5. A payload MUST NOT appear in any
   transfer list, and its buffers MUST NOT share a backing store with any transit buffer. The
   payload is not the transport unit; a lease is.
2. **Add the `Retained` / `Transit` brand distinction** to the branded-buffer capability, so the
   transfer-list builder cannot type-check a payload buffer.
3. **Add `revision: number`,** monotonic, incremented on every authoritative mutation. §D5 needs
   it for GL-restore re-upload detection and renderer dirty-checking; nothing in change 2
   currently provides it.
4. **Add `sampleCount: number`** as the valid-prefix length, distinct from buffer capacity.
   Pooled and preallocated buffers are capacity-sized and only partially filled; without this,
   every consumer would use `buffer.length` and read uninitialised tail values as real samples.
5. **`lttb` index buffers are only valid against the `revision` they were produced from.** The
   `Int32Array` of indices points into the retained buffers; state this pairing normatively so no
   consumer caches indices across a revision bump.
6. **`minMaxEnvelope` and `lttb` MUST accept an explicit output offset and count** (write into a
   caller-supplied window of a larger preallocated array), because §D6's circular
   `bucketOrigin` and §D5's transit→retained copy both write into sub-ranges — and `.subarray`
   is on the exploration §1.5 ban list, so a view cannot be handed in instead.
7. **`allocation-free-hot-path` extends to the transport path, and the gate stays at zero.**
   The transfer round trip allocates `O(1)` view objects, independent of sample count, and the
   failure path may re-mint (§D3) — but per claim **C1b** that `O(1)` allocation does not produce
   an observable scavenge at streaming rates (0 GC events over 3,600 round trips, flat across a
   64x range of payload size). So the pass condition change 2 inherits is **zero scavenge
   events**, unrefined.

   An earlier revision of this item asked change 2 to weaken the gate to "`O(1)` per round trip
   instead of zero". That is **withdrawn** and must not be applied; it contradicted §Context
   item 2 of this same document. The measurable properties this change adds are: allocation
   bounded and invariant to payload size (P5, now a regression guard), and re-minting confined
   to the bounded failure path.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| The transfer path is `O(1)`-allocating, not zero-allocating, contradicting a literal reading of the proposal's gate | Split gate (§D8 modes sync/transfer); P5 asserts invariance to payload size; recorded here as a proposal correction rather than absorbed silently |
| Illegal reads are silent by default (sentinel view) and could ship as an empty trace | `ownershipViolations` is in the stats contract; P3 asserts zero; opt-in `assertions` mode throws pre-constructed errors in development |
| Phantom lease state erodes when leases pass through plain `number` containers | Runtime generation guard always active; documented ergonomic constraint; port keeps its own leases in typed slots |
| Zombie responder reply corrupting a re-leased slot | Per-slot generation incremented on re-mint; stale settlements discarded and counted; P9 replays a stale settlement explicitly |
| Hung responder never fires `onerror`, leaking slots to permanent saturation | Lazy deadline sweep inside `acquire`/`poll`, `leaseTimeoutMs` default 1000 ms, no timers |
| Crash-looping responder becomes an unbounded allocation source | `maxRemintEvents` cap → terminal `Degraded`, which is also change 9's degradation trigger |
| Change 8 needs an interface change, breaking changes 5/9/10/11 | Pull-based `poll`, numeric handles, no `Promise`; change 8 adds a new factory only, `DecimationPort` unchanged (§D4) |
| A future contributor lets a renderer read a transit buffer for "true zero-copy" | Separate backing stores make it structurally impossible, not merely discouraged (§D5); `retained-isolation.test.ts` asserts it |
| Per-frame rebuild during a gesture reintroduces `O(n)` per frame | Tier 3 renders from the existing accumulator; rebuild only on gesture end; `DomainRebuilds` counter makes a regression visible |
| Bucket-quantised envelope during an aggressive zoom-in read as lost fidelity | Merged min/max still bounds every sample — resolution degrades, correctness does not (CLAUDE.md rule 6); mandatory gesture-end rebuild; `bucketOversample` configurable |
| History underrun silently rendering as interpolated data | `count[s] === 0` is normative "no data"; `partialHistory` flag; empty buckets render as a gap |
| `SharedArrayBuffer` detection creeping to module scope and breaking SSR | `detectTransportCapabilities` is the single entry point, uncached at module scope; `isomorphism.test.ts` is a source-level gate |
| The prototype passing vacuously | P10 allocating control in the same run, mirroring the C4b 0-versus-17 discrimination; a zero control invalidates the whole run |
