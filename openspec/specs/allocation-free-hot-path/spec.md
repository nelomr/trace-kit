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
in the same test proving the gate is live. The gate MUST apply to the synchronous in-thread port
delivered by this change (`createSyncDecimationPort`) as well as to the transfer-mode probe.

#### Scenario: The transfer-mode probe reports zero scavenges at every payload size
- **GIVEN**: the committed `transfer-roundtrip-probe.mjs` re-run at `deltaSamples` values of
  `4_096`, `16_384`, `65_536`, and `262_144`
- **WHEN**: each run measures GC events over its iterations under `--expose-gc`
- **THEN**: every run reports `0` GC events
- **AND**: this is recorded as the zero-allocation gate holding at each size independently, and
  is **not** recorded as evidence of invariance across payload size — four measurements of a
  quantity pinned at `0` cannot distinguish constant allocation from allocation that scales with
  `deltaSamples`; invariance is asserted separately against the deterministic work count below

#### Scenario: The synchronous port's round trip reports zero GC events
- **GIVEN**: `createSyncDecimationPort` driven through 10,000 `acquire`/`submit`/`poll`/`release`
  cycles under `--expose-gc`, after a warm-up phase
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events during the measured
  window only
- **THEN**: the observed count is exactly `0`

#### Scenario: An allocating control variant proves the gate is live
- **GIVEN**: a deliberately allocating variant of the same round-trip logic in the same test run
  (for example, one that constructs a settlement object per call instead of reusing the
  caller-owned `SettlementSink`)
- **WHEN**: the same instrumentation measures it
- **THEN**: the observed GC event count is greater than `0`

### Requirement: View Re-Mint Count Is a Separate, Compatible Deterministic Assertion
The number of typed-array view objects re-created per settlement in transfer mode — an
unavoidable consequence of claim **C1**, since a transferred buffer returns as a new
`ArrayBuffer` object — MUST be asserted as a constant, deterministic work count. That assertion
MUST NOT be conflated with, or used to relax, the zero-GC-event gate above: the two are
independent measurements of different properties and both MUST hold simultaneously.

This work count is also the sole carrier of the **invariance-to-payload-size** claim (claim
**C1b**). Invariance MUST be asserted as exact equality of the per-settlement
view-construction count between `deltaSamples = 4_096` and `deltaSamples = 262_144`, **with no
tolerance applied**, in the identical terms used by requirement **P5** of the
`ownership-prototype-gate` capability. Invariance MUST NOT be asserted from, or inferred from,
agreement between scavenge counts: a scavenge count is a thresholded proxy saturated at `0` and
is structurally incapable of distinguishing constant allocation from allocation proportional to
`deltaSamples`.

#### Scenario: View re-mint count is constant while GC-event count stays zero
- **GIVEN**: a transfer-mode run of 3,600 round trips after warm-up
- **WHEN**: both the per-settlement view-construction count and the scavenge-event count are
  measured in the same run
- **THEN**: view-construction count is exactly `3` per settlement (X, Y, out — the run requests
  `DecimationKind.MinMaxEnvelope`, which emits no index buffer, so `viewIndices` never travels)
  and does not grow across the run, and scavenge-event count is `0`
- **AND**: an `DecimationKind.Lttb` segment in the same run reports exactly `4`, so the `3` above
  is read from a counter that tracks the transfer list actually built rather than a fixed
  constant

#### Scenario: The work count is exactly equal across a 64x payload range
- **GIVEN**: two transfer-mode runs of 3,600 round trips after warm-up, one at
  `deltaSamples = 4_096` and one at `deltaSamples = 262_144`
- **WHEN**: their per-settlement view-construction counts are compared
- **THEN**: the two counts are exactly equal with no tolerance applied, and the assertion fails
  on any difference including a difference of `1`

#### Scenario: A work count proportional to payload size fails while scavenges stay zero
- **GIVEN**: a fixture transfer-mode run in which per-settlement view construction is made
  proportional to `deltaSamples`, with both payload sizes still reporting `0` scavenge events
- **WHEN**: the invariance assertion is evaluated
- **THEN**: it fails on the view-construction comparison, and the two `0` scavenge counts neither
  waive nor soften that failure

#### Scenario: A rising view re-mint count does not relax the GC gate
- **GIVEN**: a fixture run in which view re-minting is deliberately made non-constant
- **WHEN**: the gate is evaluated
- **THEN**: the re-mint assertion fails on its own terms, and the zero-GC-event assertion is
  evaluated independently rather than being waived

### Requirement: `--trace-deopt` Freedom Across Hot Paths
Every function inside a hot path MUST maintain strict argument monomorphism, verified by a
`--trace-deopt` run reporting no deoptimization of the named functions.

#### Scenario: A trace-deopt run reports no deopt for the decimation hot paths
- **GIVEN**: a benchmark script invoking `minMaxEnvelope` and `lttb` repeatedly with
  monomorphic arguments
- **WHEN**: `node --trace-deopt` runs the script
- **THEN**: no deoptimization entry names either function

---


### Requirement: The Banned-Construct Scope Extends to the Renderer's Trace-Path Module
The banned-construct check (object/array literals, tuple returns, `for...of` over typed arrays,
spread/rest/`arguments`, `.map`/`.filter`/`.slice`/`.subarray`, per-call closures, template
strings, hot-path `Error` construction, generators, and `async`) MUST additionally scope over
`packages/renderers/src/path/**`. It MUST NOT scope over the rest of `packages/renderers/src/**`
(axis label formatting and other cold-path style/layout code MAY construct strings and objects
freely).

#### Scenario: A source-level check rejects a banned construct in the trace-path module
- **GIVEN**: a fixture variant of `packages/renderers/src/path/build-trace-path.ts` containing an
  array literal inside its loop body
- **WHEN**: the repository's hot-path ESLint rule block scans `packages/renderers/src/path/**`
- **THEN**: the check fails and names the fixture file and the offending construct

#### Scenario: The committed trace-path implementation passes the check
- **GIVEN**: the committed `buildTracePath` implementation
- **WHEN**: the same check runs over `packages/renderers/src/path/**`
- **THEN**: the check reports no violation

#### Scenario: Axis label formatting outside the trace-path module is exempt
- **GIVEN**: `packages/renderers/src/canvas2d/axes.ts`, which formats tick labels into strings
- **WHEN**: the hot-path ESLint rule block runs across the workspace
- **THEN**: it does not scope over `packages/renderers/src/canvas2d/**`, and a string-building
  call in that file produces no violation

### Requirement: Exactly One `Path2D` Per Frame Is Permitted; Per-Point Allocation Is Not
The zero-allocation rule for the renderer's hot path is stated per point, not per frame:
`render()` constructing exactly one `Path2D` instance per call is explicitly permitted and MUST
NOT be flagged as a violation of the allocation-free-hot-path capability. Allocation occurring
inside the loop body that populates that `Path2D` via `moveTo`/`lineTo` calls remains banned
without exception.

#### Scenario: One Path2D per render call is not a violation
- **GIVEN**: the committed `Canvas2DRenderer.render()` implementation constructing exactly one
  `new Path2D()` per call, outside the per-point loop
- **WHEN**: the zero-allocation GC-event gate measures a run of multiple `render()` calls with a
  fixed decimated point count
- **THEN**: the per-frame `Path2D` construction does not, by itself, cause the gate to report a
  non-zero GC event count attributable to the point loop; the loop-scoped ESLint check (above)
  passes independently of this per-frame allocation

#### Scenario: An allocation inside the per-point loop is still banned
- **GIVEN**: a fixture variant of `buildTracePath` that constructs a new `Path2D` or object
  literal once per point inside the loop, rather than once per frame outside it
- **WHEN**: the hot-path ESLint check scans `packages/renderers/src/path/**`
- **THEN**: the check fails and names the offending construct, distinguishing this from the
  permitted once-per-frame construction above

### Requirement: The Zero-GC Guarantee Binds Decimation Selection Resolution, Not a New Walk Mode
The zero-GC allocation gate MUST cover `minMaxEnvelopeIndices` and `resolveDecimationParameter`
under `packages/core/src/decimation/**`, in addition to the existing `lttb` and `minMaxEnvelope`
coverage. `packages/renderers/src/path/build-trace-path.ts` MUST NOT be modified to add a
value-based, envelope-specific, or algorithm-conditional walk branch; the guarantee over that file
established by `canvas2d-trace-rendering` extends unchanged, over the identical committed function.

#### Scenario: minMaxEnvelopeIndices and resolveDecimationParameter pass the zero-GC gate
- **GIVEN**: `minMaxEnvelopeIndices` and `resolveDecimationParameter`, each driven over a warmed-up
  run under `--expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures each run
- **THEN**: zero GC events are reported for both

#### Scenario: build-trace-path.ts carries no new branch for the selected algorithm
- **GIVEN**: `packages/renderers/src/path/build-trace-path.ts` as committed under
  `canvas2d-trace-rendering`
- **WHEN**: the file is inspected after `selectable-decimation` lands
- **THEN**: it contains no conditional branch on `DecimationAlgorithm` and no second scratch-buffer
  type; both algorithms are consumed through the one existing `(Int32Array indices, count)` shape

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
