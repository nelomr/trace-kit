# Capability: allocation-free-hot-path

> Change: `core-transport-contract`. Modified capability — base introduced (as new) by
> `core-decimation-math` in this same spec batch (not yet archived; delta applies against that
> change's `specs/allocation-free-hot-path/spec.md`).
>
> **Contradiction, recorded rather than silently resolved**: the proposal's own Capabilities
> section states this capability is "extended from single-threaded numeric loops to the
> transport path, where the no-allocation rule is what forces the drop-on-saturation policy,"
> and `core-transport-contract/design.md`'s numbered "Required Changes to `SpectrumDataPayload`"
> item 7 explicitly asks for the gate to be refined to "`O(1)`-allocation rather than zero" for
> the transfer round trip. Per the orchestrator's explicit instruction and per claim **C1b**
> (zero GC events across 3,600 transfer round trips, invariant across a 64x payload-size range —
> the same data the design's own §Context section cites to reach "the gate stays strict... it
> keeps zero"), this modification does **not** weaken the gate to `O(1)`. The extension below is
> the part of the proposal's intent that evidence supports: the transport path is now *in scope*
> for the allocation-free discipline, at the **same zero-events bar**, not a relaxed one. The
> `O(1)`-per-round-trip *object count* (view re-minting) is tracked as its own deterministic
> work-count assertion (`ownership-prototype-gate` P4), which is a different, compatible claim
> from "GC events observed," and does not require relaxing the GC-event gate.

## MODIFIED Requirements

### Requirement: Zero-Allocation Gate Extended to the Transport Round Trip
The zero-allocation discipline (banned constructs, GC-event-count assertion) now applies to the
transport round trip in addition to the single-threaded numeric loops, **at the same zero-GC-
events bar**, because CLAUDE.md rule 2 forces the saturation policy in `transport-backpressure`
to drop rather than allocate, and because claim **C1b** demonstrates the bar is achievable at
this strictness.

#### Scenario: The synchronous port's round trip reports zero GC events
- **GIVEN**: `createSyncDecimationPort` driven through 10,000 acquire/submit/poll/release cycles
  under `--expose-gc`, after warm-up
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events during the measured
  window
- **THEN**: the observed count is exactly `0`

#### Scenario: An allocating control variant on the transport path proves the gate is live
- **GIVEN**: a deliberately allocating variant of the round-trip loop (e.g. one that constructs
  a settlement object per call instead of reusing the sink) run in the same test file
- **WHEN**: the same observer measures it
- **THEN**: the observed GC event count is greater than `0`

### Requirement: View Re-Mint Count Is a Separate, Compatible Deterministic Assertion
The number of typed-array view objects re-created per settlement in transfer mode (an
unavoidable consequence of claim **C1** — a transferred buffer returns as a new `ArrayBuffer`
object) MUST be asserted as a constant, deterministic work count (`ownership-prototype-gate` P4),
and this assertion MUST NOT be conflated with, or used to relax, the GC-event-count gate above.

#### Scenario: View re-mint count is constant while GC-event count stays zero
- **GIVEN**: a transfer-mode run of 3,600 round trips
- **WHEN**: both the per-settlement view-construction count and the scavenge-event count are
  measured
- **THEN**: view-construction count is exactly `3` per settlement (constant), and scavenge-event
  count is `0` — both hold simultaneously, demonstrating the two are compatible, not competing,
  constraints

---

## Contradiction Resolution (closed upstream)

The contradiction recorded above has been **resolved at the source**, after this spec was
written. `core-transport-contract/design.md` item 7 no longer asks for the weakening: it now
reads that the gate stays at zero, states explicitly that the earlier "`O(1)` per round trip
instead of zero" wording is **withdrawn and must not be applied**, and notes that it contradicted
the same document's §Context item 2. The `§D8` line that framed the gate as "not about scavenges"
was corrected in the same pass.

The design and this spec are therefore now in agreement, and the position this spec took —
following claim **C1b** and holding the gate at zero — is the design's own position. The note is
retained as an audit record of how the discrepancy was found and settled, not as an open issue.
No requirement or scenario in this file changes as a result.
