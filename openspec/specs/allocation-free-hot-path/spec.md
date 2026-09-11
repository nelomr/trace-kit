# Capability: allocation-free-hot-path

> Change: `core-decimation-math`. New capability. Later changes inherit this capability rather
> than restating it.
>
> **Not applied here**: `core-transport-contract/design.md`'s numbered "Required Changes to
> `SpectrumDataPayload`" item 7 asks this capability to be weakened to "`O(1)` per round trip
> instead of zero" for the transport path. Claim **C1b** refutes the premise (zero GC events
> across 3,600 transfer round trips and across a 64x range of payload size), and the design
> document's own narrative text already agrees the gate "stays strict" / "keeps zero". This spec
> therefore states the gate at **zero**, unchanged, and the contradiction between the design's
> narrative and its own numbered list item 7 is recorded here and in `spectrum-data-payload`'s
> spec rather than silently resolved by transcription.

## ADDED Requirements

### Requirement: Banned Constructs in Every Hot Path
Every hot path in the workspace (numeric decimation loops, and — unweakened — the transport
round trip) MUST NOT use any of the following inside the loop body:

- object literals and array literals
- tuple returns
- `for...of` over typed arrays
- spread, rest parameters, `arguments`
- `.map`, `.filter`, `.slice`, and `.subarray`
- per-call closures
- template strings
- `Error` objects constructed on the hot path
- generators and `async`

Validation of inputs against this contract happens at the function boundary, before the loop;
the loop body itself does not throw.

#### Scenario: A source-level check rejects a banned construct inside a hot path
- **GIVEN**: a fixture hot-path function containing `arr.subarray(0, n)` inside its loop body
- **WHEN**: a repository lint rule or grep-based CI check scans
  `packages/core/src/decimation/**` and `packages/core/src/transport/**` for the banned
  constructs
- **THEN**: the check fails and names the fixture file and the offending construct

#### Scenario: The real implementation passes the same check
- **GIVEN**: the committed `minMaxEnvelope` and `lttb` implementations
- **WHEN**: the same check runs over `packages/core/src/decimation/**`
- **THEN**: the check reports no violation

### Requirement: Zero-Allocation Gate Stays at Zero for the Transport Round Trip
The transport round trip's zero-allocation gate MUST remain **zero** GC events per round trip
(never relaxed to an `O(1)`-per-round-trip budget), asserted by `PerformanceObserver`
`entryTypes: ['gc']` over N round trips under `--expose-gc`, with an allocating control variant
in the same test proving the gate is live.

#### Scenario: The transfer-mode probe demonstrates zero scavenges across payload sizes
- **GIVEN**: the committed `transfer-roundtrip-probe.mjs` re-run at `deltaSamples` values of
  `4_096`, `16_384`, `65_536`, and `262_144`
- **WHEN**: each run measures GC events over its iterations under `--expose-gc`
- **THEN**: every run reports `0` GC events, demonstrating invariance across a 64x range of
  payload size

#### Scenario: An allocating control variant proves the gate is live
- **GIVEN**: a deliberately allocating variant of the same round-trip logic in the same test run
- **WHEN**: the same instrumentation measures it
- **THEN**: the observed GC event count is greater than `0`

### Requirement: `--trace-deopt` Freedom Across Hot Paths
Every function inside a hot path MUST maintain strict argument monomorphism, verified by a
`--trace-deopt` run reporting no deoptimization of the named functions.

#### Scenario: A trace-deopt run reports no deopt for the decimation hot paths
- **GIVEN**: a benchmark script invoking `minMaxEnvelope` and `lttb` repeatedly with
  monomorphic arguments
- **WHEN**: `node --trace-deopt` runs the script
- **THEN**: no deoptimization entry names either function

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
