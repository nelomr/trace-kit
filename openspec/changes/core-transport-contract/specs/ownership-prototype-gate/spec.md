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
at iteration 200 and iteration 3,600.

#### Scenario: Zero scavenges over the full sync-mode run
- **GIVEN**: `poolPairs = 3`, `transitCapacitySamples = 65_536`, sync mode, 3,600 iterations
  after 200 warm-up iterations
- **WHEN**: the prototype runs under `--expose-gc --trace-gc`
- **THEN**: the count of `gc` entries with `detail.kind` corresponding to a scavenge is exactly
  `0`

#### Scenario: Pool allocation count is constant across the run
- **GIVEN**: the same run
- **WHEN**: pool allocation count is sampled at iteration 200 and at iteration 3,600
- **THEN**: the two sampled counts are identical

### Requirement: Zero Detached-Buffer Exceptions and Zero Ownership Violations (P3)
In both `sync` and `transfer` modes, the prototype MUST observe `0` detached-buffer exceptions
and `0` `ownershipViolations` over the full run.

#### Scenario: No detached-buffer exception in either mode
- **GIVEN**: a full 3,600-iteration run in each mode
- **WHEN**: the run completes
- **THEN**: the count of thrown detached-buffer exceptions is `0` and
  `stats.counters[StatCounter.OwnershipViolations]` is `0` in both modes

### Requirement: Transfer-Mode View Re-Mint Count Is Constant (P4)
In `transfer` mode, view re-mints per settlement MUST equal exactly `3` (X, Y, out), constant
across the run.

#### Scenario: Exactly 3 view re-mints per settlement in transfer mode
- **GIVEN**: a transfer-mode run using `structuredClone(msg, { transfer })`
- **WHEN**: per-settlement view-construction count is measured
- **THEN**: it equals exactly `3` for every settlement, with no growth across the run

### Requirement: Transfer-Mode Allocation Is Invariant to Payload Size (P5)
Scavenge count in `transfer` mode at `deltaSamples = 4_096` MUST equal scavenge count at
`deltaSamples = 65_536` within a tolerance of `±1`.

#### Scenario: Scavenge count is flat across a payload-size range
- **GIVEN**: two transfer-mode runs, one with `deltaSamples = 4_096` and one with
  `deltaSamples = 65_536`, both 3,600 iterations after warm-up
- **WHEN**: scavenge counts are compared
- **THEN**: the two counts differ by no more than `1`

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
- **THEN**: `health === Stalled` is observed during the stall, and `health` returns to a
  non-`Stalled` value after the next accepted chunk

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
