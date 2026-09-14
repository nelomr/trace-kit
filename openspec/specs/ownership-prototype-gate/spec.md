# Capability: ownership-prototype-gate

> Change: `core-transport-contract`. New capability. Encodes design.md §D8 — the de-risking
> prototype, `packages/core/bench/ownership-prototype.mjs`, run before any renderer exists.

## ADDED Requirements

### Requirement: The Prototype Is Committed and Re-Runnable
The de-risking prototype MUST be committed at `packages/core/bench/ownership-prototype.mjs`,
invocable as `node --expose-gc --trace-gc packages/core/bench/ownership-prototype.mjs [flags]`,
and MUST be re-runnable on demand rather than a one-off exploratory script.

#### Scenario: The prototype runs standalone and produces a machine-readable result
- **GIVEN**: the committed prototype script
- **WHEN**: it is invoked with `node --expose-gc --trace-gc` and default flags
- **THEN**: it completes and writes a result covering both `sync` and `transfer` modes with the
  measured fields listed in design.md §D8

### Requirement: Sync-Mode Zero-Scavenge Gate (P1, P2)
Over 3,600 iterations (60 seconds at 60 Hz) in `sync` mode, after 200 warm-up iterations, the
prototype MUST observe exactly `0` scavenge events, and pool allocation count MUST be identical
at iteration 200 and iteration 3,600. The pool allocation count MUST additionally be reported as
non-zero at iteration 200, because a counter that never fires would satisfy the identity
comparison as `0 == 0` while proving nothing about steady-state allocation.

#### Scenario: Zero scavenges over the full sync-mode run
- **GIVEN**: `poolPairs = 3`, `transitCapacitySamples = 65_536`, sync mode, 3,600 iterations
  after 200 warm-up iterations
- **WHEN**: the prototype runs under `--expose-gc --trace-gc`
- **THEN**: the count of `gc` entries with `detail.kind` corresponding to a scavenge is exactly
  `0`

#### Scenario: Pool allocation count is constant across the run
- **GIVEN**: the same run
- **WHEN**: pool allocation count is sampled at iteration 200 and at iteration 3,600
- **THEN**: the two sampled counts are identical, by exact equality with no tolerance
- **AND**: the iteration-200 sample is greater than `0` (the pool allocated its
  `poolPairs`-worth of transit backing during warm-up), so the identity comparison above is made
  between two live readings rather than between two zeros from a counter that never fired

### Requirement: Zero Detached-Buffer Exceptions and Zero Ownership Violations (P3)
In both `sync` and `transfer` modes, the prototype MUST observe `0` detached-buffer exceptions
and `0` `ownershipViolations` over the full run. Both counters MUST be proven live by a
deliberate-violation control in the same prototype invocation, because a counter that is never
incremented reports `0` regardless of whether the protocol holds.

#### Scenario: No detached-buffer exception in either mode
- **GIVEN**: a full 3,600-iteration run in each mode
- **WHEN**: the run completes
- **THEN**: the count of thrown detached-buffer exceptions is `0` and
  `stats.counters[StatCounter.OwnershipViolations]` is `0` in both modes

#### Scenario: A deliberate-violation control proves both counters are live
- **GIVEN**: a control segment in the same prototype invocation that performs exactly `1`
  deliberate illegal read through a stale (already-submitted) lease, and exactly `1` deliberate
  read through a pre-existing view of a transferred buffer
- **WHEN**: the control segment's counters are read, separately from the gated run
- **THEN**: the control segment reports `stats.counters[StatCounter.OwnershipViolations] === 1`
  and a detached-buffer-access count of `1`, while the gated run reports `0` for both in the same
  invocation, and the control's counts are excluded from the P3 pass/fail determination

### Requirement: Transfer-Mode View Re-Mint Count Is Constant Per Decimation Kind (P4)
In `transfer` mode, view re-mints per settlement MUST be a constant of the requested
`DecimationKind` and MUST NOT vary with `deltaSamples`: exactly `3` (X, Y, out) for
`DecimationKind.MinMaxEnvelope`, which emits no index buffer and therefore never transfers
`viewIndices`, and exactly `4` (X, Y, out, indices) for `DecimationKind.Lttb`, which does. The
§D8 gated run shape uses `MinMaxEnvelope`, so its gated value is `3`. The transfer list MUST be
built from what the request needs rather than from the slot's full view set.

#### Scenario: Exactly 3 view re-mints per settlement for a min/max run
- **GIVEN**: a transfer-mode run using `structuredClone(msg, { transfer })` with every request at
  `DecimationKind.MinMaxEnvelope`
- **WHEN**: per-settlement view-construction count is measured
- **THEN**: it equals exactly `3` for every settlement, with no growth across the run

#### Scenario: An LTTB run reports exactly 4, in the same invocation
- **GIVEN**: a second transfer-mode segment in the same prototype invocation with every request at
  `DecimationKind.Lttb`
- **WHEN**: its per-settlement view-construction count is measured
- **THEN**: it equals exactly `4` for every settlement
- **AND**: the min/max segment above reports exactly `3` in the same invocation, so the counts
  discriminate the two kinds — an implementation that transferred all four views unconditionally
  would report `4` for both and fail on the min/max segment

### Requirement: Transfer-Mode Allocation Is Invariant to Payload Size (P5)
The primary assertion MUST count allocation directly via the port's own deterministic work
counter — the per-settlement view-construction count defined by the stats contract in the
`allocation-free-hot-path` capability — and not via GC-event counts. The per-settlement
view-construction count in `transfer` mode at `deltaSamples = 4_096` MUST equal the count at
`deltaSamples = 262_144` by **exact equality, with no tolerance**: it is a deterministic work
count rather than a sampled measurement, so there is no noise to absorb and a difference of `1`
is a real change that MUST fail. The payload-size range MUST span the full 64x range that claim
**C1b** covers (`4_096` to `262_144`). Scavenge-count comparison is retained only as a secondary
corroborating measurement and MUST NOT substitute for this assertion, because a scavenge count
saturated at `0` cannot distinguish constant allocation from allocation that scales with sample
count.

#### Scenario: Per-settlement view-construction count is identical across a 64x payload range
- **GIVEN**: two transfer-mode runs, one with `deltaSamples = 4_096` and one with
  `deltaSamples = 262_144`, both 3,600 iterations after 200 warm-up iterations
- **WHEN**: the per-settlement view-construction counts of the two runs are compared
- **THEN**: they are exactly equal, with no tolerance applied, and the assertion fails on any
  difference including a difference of `1`

#### Scenario: A work count that scales with payload size fails even while scavenges stay zero
- **GIVEN**: a fixture transfer-mode run in which per-settlement view construction is made
  proportional to `deltaSamples`, with both runs still reporting `0` scavenge events
- **WHEN**: the P5 determination is computed
- **THEN**: P5 fails on the view-construction comparison, and the zero scavenge counts do not
  waive or soften that failure

#### Scenario: Scavenge counts corroborate as a secondary measurement
- **GIVEN**: the same two transfer-mode runs
- **WHEN**: their scavenge counts are compared as a secondary check
- **THEN**: both are reported and both are `0`, recorded as corroboration subordinate to the
  view-construction assertion rather than as the P5 determination itself

### Requirement: Backpressure Correctness Under Health Load (P6, P7, P8)
With a responder that keeps up, `chunksDropped` MUST be `0`. With an injected 10-frame stall,
`chunksDropped` MUST equal the stall length exactly, allocation count MUST be unchanged, and
`health` MUST never report `Stalled`. With an injected 200-frame stall, `health` MUST report
`Stalled` and MUST clear on the next accept.

#### Scenario: A keeping-up responder drops nothing
- **GIVEN**: a responder that never falls behind
- **WHEN**: the prototype runs 3,600 iterations
- **THEN**: `chunksDropped === 0`

#### Scenario: A 10-frame stall drops exactly 10 chunks without tripping Stalled
- **GIVEN**: an injected 10-frame responder stall mid-run
- **WHEN**: the run completes
- **THEN**: `chunksDropped === 10`, allocation count is unchanged from before the stall, and
  `health` never equals `Stalled` during the run

#### Scenario: A 200-frame stall trips Stalled and clears
- **GIVEN**: an injected 200-frame responder stall mid-run
- **WHEN**: the run completes
- **THEN**: `health === Stalled` is observed during the stall, and `health` equals exactly
  `Ready` after the next accepted chunk

### Requirement: Bounded Failure-Path Recovery (P9)
After one injected responder failure, `remintEvents` MUST equal exactly `poolPairs`, health MUST
return to `Ready`, and a replayed stale settlement MUST be rejected (`staleSettlements === 1`)
with no slot corruption.

#### Scenario: One injected failure re-mints exactly poolPairs slots and rejects a zombie reply
- **GIVEN**: one injected responder failure via `reportResponderFailure`, followed by a replayed
  (stale-generation) settlement message for a pre-failure lease
- **WHEN**: the prototype processes recovery and then the replayed message
- **THEN**: `remintEvents === poolPairs`, `health` returns to `Ready`, the replayed settlement is
  discarded, `staleSettlements === 1`, and no slot's data is overwritten by the stale message

### Requirement: The Gate Is Proven Live, Not Vacuous (P10)
An allocating control variant run in the same prototype execution MUST report non-zero
scavenges, proving the instrumentation is capable of detecting allocation (mirroring the C4b
0-versus-17 discrimination).

#### Scenario: The allocating control variant reports non-zero scavenges
- **GIVEN**: a deliberately allocating control path run in the same prototype invocation as the
  P1 measurement
- **WHEN**: the control path's scavenge count is compared to the zero-allocation path's
- **THEN**: the control path reports greater than `0` scavenges while the zero-allocation path
  reports `0`, in the same run

### Requirement: Cold-Run and Non-Marker Measurements Do Not Count
A scavenge attributable to the harness's own observer bookkeeping, a major-GC event, or any
measurement taken without the warm-up phase MUST NOT be counted toward the pass/fail
determination for P1-P5.

#### Scenario: Major GC events are recorded separately and not gated
- **GIVEN**: a run in which a major GC is triggered by unrelated process activity
- **WHEN**: results are tabulated
- **THEN**: the major-GC count is reported in a separate field and does not affect the P1-P5
  pass/fail outcome

#### Scenario: A run without warm-up is rejected as invalid evidence
- **GIVEN**: an invocation with `warmupIterations = 0`
- **WHEN**: the prototype is asked to report a pass/fail verdict
- **THEN**: it reports the run as invalid for gating purposes rather than emitting a pass or
  fail verdict

### Requirement: Relative Throughput Regression Budget, Never a Literal Wall-Clock Gate
Per confirmed decision 3, round-trip throughput of the synchronous port MUST be reported as a
warm, median-of-N measurement compared against a baseline recorded on the same runner, expressed
as a relative budget. The prototype MUST NOT emit a pass/fail verdict from any absolute
millisecond, FPS, or byte threshold; absolute per-round-trip figures are informational
benchmarks recorded by change 16.

#### Scenario: The verdict is computed from a relative comparison, not an absolute threshold
- **GIVEN**: a prototype run that records median-of-N round-trip time after warm-up
- **WHEN**: its pass/fail determination is inspected
- **THEN**: the determination references a baseline recorded on the same runner and a relative
  budget, and no absolute millisecond constant appears in any gating comparison

#### Scenario: Absolute timings are reported but not gated
- **GIVEN**: the prototype's machine-readable result
- **WHEN**: its fields are enumerated
- **THEN**: absolute median round-trip time is present as an informational field and is excluded
  from the P1-P10 pass/fail computation
