# Proposal: core-decimation-math

> Change 2 of the 16-change decomposition in
> `openspec/changes/00-roadmap-decomposition/exploration.md` (§2 inventory, §3 graph).
> Hard prerequisite: **change 1 — `workspace-test-harness-bootstrap`** — satisfied; that change is
> archived and its five capabilities are merged into `openspec/specs/`.

## Problem / Motivation

TraceKit's entire value proposition is physics-preserving decimation of massive sweeps, and
today `packages/core/src/index.ts` exports exactly one thing: `export const VERSION = '0.0.0'`.
There is no buffer type, no payload type, and no algorithm. Every one of the fourteen changes
that follow this one — both renderers, the transport contract, the SVG exporter, both framework
adapters, the wafer map — consumes the types and functions this change creates. It is the first
change in the plan that writes domain code.

Its hard prerequisite — change 1, `workspace-test-harness-bootstrap` — is **archived**, and the
harness it delivered is on disk now: a root `vitest.config.ts` using `test.projects` with a
single `core` project pinned to the `node` environment, seven real test files under
`packages/core/test/` (including the Node-isomorphism tripwire), real `typecheck` and `lint`
Turborepo tasks, and a benchmark runner at `packages/core/bench/` (`runner.ts` + `index.ts`)
emitting `bench-results.json` with warm-up, median and p95. `openspec/config.yaml` declares
`strict_tdd: true`, and a RED step is now writable — which is precisely what change 1 unblocked.

Three gaps in that harness are this change's problem to close, and they are why the two
MODIFIED capabilities below exist:

- **`fast-check` is not installed anywhere.** It is absent from the workspace catalog, the root
  `package.json` and `packages/core/package.json`. The property-based tests this change depends
  on cannot be written until it is pinned.
- **The benchmark runner has no real consumer.** `packages/core/bench/index.ts` benchmarks a
  `placeholderWorkload()` whose own comment names this change as its replacement, and it carries
  no declared reference-hardware record.
- **There is no `--trace-deopt` invocation mode** in the runner.

This change is therefore the first consumer of both the test harness and the benchmark runner,
because it is the first change in the plan carrying a performance criterion — and the first that
writes domain code against them.

Two definitional gaps in the input brief have to be closed here, and both are corrections rather
than transcriptions:

- **`SpectrumDataPayload` is referenced by the brief's `FigureRenderer` but never defined
  anywhere in the brief.** Exploration §3.11 settles where it belongs: in `@trace-kit/core`,
  beside the branded buffers it wraps. `packages/renderers` imports the type and consumes it
  structurally in `setData()`, never constructing or mutating a payload. CLAUDE.md rule 5 and the
  package layout are explicit that renderers must not own the domain model.
- **LTTB's output shape in the brief is wrong.** The brief emits a `Float32Array(threshold)` per
  axis. Per exploration §3.11 this change emits an **`Int32Array` of selected indices** instead.
  That removes an allocation, avoids duplicating the sample data, lets the renderer index the
  original buffers directly, and makes the property tests trivially expressible (subset of
  input, strictly increasing indices).

A third correction concerns how this change is allowed to prove anything. The brief's memory
and timing criteria are unverifiable as written (exploration §1.5). `performance.memory` cannot
prove zero allocation — claim **C4** confirms it is non-standard, Chromium-only, quantized at
roughly 100 KB granularity as a Spectre-class mitigation, and reflects post-GC state, so any
young-generation allocation scavenged before the next sample leaves no trace at all. The
replacement is measured and reproducible, not theoretical: claim **C4b** records 0 GC events for
an allocation-free Min-Max variant against 17 events for an allocating control over identical
iteration counts on Node v20.20.0. The discrimination is total.

## Proposed Approach

Pure isomorphic numeric code in `@trace-kit/core`. No DOM, no `Worker`, no transport, no
dependencies.

1. **Branded typed buffers.** Branded wrappers over `Float32Array` / `Float64Array` /
   `Int32Array` so an X buffer, a Y buffer and an index buffer are not mutually assignable.
   Branding is type-level only and erases at runtime — zero wrapper objects, zero runtime cost,
   satisfying CLAUDE.md rule 2. No `any` in the brand machinery (CLAUDE.md rule 1); generics and
   unique-symbol brands only.

2. **`SpectrumDataPayload`.** The domain model: the branded X and Y buffers plus the metadata the
   renderers and the transport need. Defined here, in the core. Consumers read it structurally.

3. **`minMaxEnvelope`.** Bucketed min/max envelope over the input, writing into a
   **caller-preallocated** output buffer. Preallocation is not an optimisation detail; it is the
   only shape in which the zero-allocation gate can pass.

4. **`lttb`.** Single O(n) pass emitting an `Int32Array` of selected indices into a
   caller-preallocated output buffer. For declared determinism, bucket averages accumulate in
   `number` (f64, the native width) and the implementation avoids implementation-dependent `Math`
   functions; basic IEEE-754 operations are deterministic across platforms (exploration §3.11).

5. **The allocation-free loop discipline.** Zero allocation in a numeric loop is achievable —
   numbers stay unboxed in locals and typed arrays — but only under an explicit ban list. Per
   exploration §1.5, the following are **banned inside these hot paths**:

   - object literals and array literals
   - tuple returns
   - `for...of` over typed arrays (allocates an iterator object)
   - spread, rest parameters, `arguments`
   - `.map`, `.filter`, `.slice` — **and `.subarray`**, which allocates a view object
   - per-call closures
   - template strings
   - `Error` objects constructed on the hot path
   - generators and `async`

   Validation is by input contract at the boundary, before the loop; the loop itself does not
   throw. Additionally, a loop **deopt** materialises numbers to the heap and defeats the whole
   exercise, so the implementation maintains strict argument monomorphism and the bench includes
   a **`--trace-deopt` check** over the hot paths.

6. **Property-based tests with `fast-check`.** Exploration §1.5 is blunt that coverage proves
   nothing here — a zero-allocation numeric loop reaches 95% line coverage from a single call.
   The real gate is properties: output length equals the threshold; the first and last points are
   always retained; indices are strictly increasing; the output is a subset of the input; and per
   bucket, the emitted min/max bound every sample in that bucket.

7. **The determinism test.** Repeated invocation over identical input yields byte-identical
   output, and the recorded golden output is stable.

8. **The peak-fidelity test.** CLAUDE.md rule 6 requires that decimation mathematically preserve
   critical resonance peaks, optical dips and noise-floor baselines, and forbids naive uniform
   sub-sampling. The test randomises peak position and peak width across the domain and asserts
   the peak survives decimation — a property, not a single fixture.

9. **The zero-allocation gate.** A `PerformanceObserver` with `entryTypes: ['gc']` asserting
   **zero GC events over N iterations**, plus `v8.getHeapStatistics()` under `--expose-gc`. The
   working probe already exists and is re-runnable at
   `openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs`; this change adapts
   it into a committed CI gate. Each observed entry carries `detail.kind` and `detail.flags`
   against the `NODE_PERFORMANCE_GC_*` constants (claim **C4b**).

## Capabilities (Contract for `sdd-spec`)

Exactly seven capabilities, matching `openspec/roadmap.yaml` order 2 one-for-one: five ADDED and
two MODIFIED. Each has a delta directory under `specs/` in this change.

### New Capabilities

- `branded-buffers`: the branded typed-buffer types, their construction and narrowing contract,
  and the guarantee that branding is type-level only with no runtime representation.
- `spectrum-data-payload`: the `SpectrumDataPayload` domain model owned by `@trace-kit/core`,
  including the rule that downstream packages consume it structurally and never construct or
  mutate it.
- `decimation-min-max`: `minMaxEnvelope` — bucketed min/max envelope into a caller-preallocated
  output buffer, with the per-bucket bounding property as its correctness contract.
- `decimation-lttb`: `lttb` — single-pass Largest-Triangle-Three-Buckets emitting an
  `Int32Array` of selected indices into a caller-preallocated output buffer, with subset,
  strict-monotonicity, endpoint-retention and determinism as its correctness contract.
- `allocation-free-hot-path`: the ban list above, stated as a normative constraint on every hot
  path in the workspace, together with the GC-event gate and the `--trace-deopt` check that
  enforce it. Later changes inherit this capability rather than restating it.

### Modified Capabilities

Both baselines exist in `openspec/specs/`, merged by change 1's archive, so each MODIFIED delta
has a real requirement to modify:

- `test-harness` — modifies the archived requirement **Real Vitest Wiring**
  (`openspec/specs/test-harness/spec.md`), extending it so the workspace catalog additionally
  pins `fast-check`, and establishing the property-based-testing conventions used by every later
  numeric change. The baseline's other two requirements (Node-Isomorphism Tripwire Test; Real
  `typecheck` and `lint` Tasks) are untouched.
- `benchmark-harness` — modifies the archived requirement **Warm-Up and Median-of-N Reporting**
  (`openspec/specs/benchmark-harness/spec.md`), replacing the placeholder workload in
  `packages/core/bench/index.ts` with its first real consumer and adding the declared
  reference-hardware record. It additionally introduces a **new** requirement, `--trace-deopt`
  Invocation Mode, which has no baseline counterpart and is net-new behaviour on an
  already-existing capability. The baseline's other two requirements (Machine-Readable Result
  Format; Isolated From CI Coverage and Shared Runners) are untouched.

## Impact on TraceKit Packages

- `packages/core`: the whole of this change. New buffer types, `SpectrumDataPayload`,
  `minMaxEnvelope`, `lttb`, their tests, their benchmarks and their gates. Remains 100%
  isomorphic — zero references to `document`, `window`, `HTMLCanvasElement`, `Worker`, `self` or
  any other browser global (CLAUDE.md rule 5). Zero runtime dependencies; in particular **no
  `d3-*` of any kind**, per exploration §1.10, which is also why exploration §4 lists "d3
  reintroduced into the core because it is convenient" as a Medium risk owned partly by this
  change.
- `packages/renderers`, `packages/vue`, `packages/react`: not created and not touched (changes 5,
  10, 11). They will import the types this change defines.
- `apps/playground`: not touched here. Change 4 builds the shell and the `/core-math` view that
  exercises these two algorithms interactively; change 4 depends on this change but does not
  belong to it.

## Acceptance Criteria Model

Per confirmed decision 3, every literal number the brief attached to this work is rewritten.
`sdd-spec` MUST apply this shape rather than transcribing the brief's numbers.

**Zero allocation** — asserted by **GC-event count** (claim **C4b**): zero `gc` entries observed
by a `PerformanceObserver` over N iterations of each hot path under `--expose-gc`, with an
allocating control variant in the same test file demonstrating non-zero events so the gate is
proven live rather than vacuous. Never `performance.memory` (claim **C4**), never
`measureUserAgentSpecificMemory` (claim **C4c**), never a total-heap delta, and never an
absolute-magnitude assertion.

**Deopt freedom** — a `--trace-deopt` run over the hot paths reports no deoptimisation of the
named functions. Deterministic and hardware-independent.

**Deterministic work-count assertions** — hardware-independent and CI-safe: `minMaxEnvelope`
performs exactly one pass over the input and writes exactly `bucketCount * 2` output values;
`lttb` performs a single O(n) pass and writes exactly `threshold` indices; neither function's
allocation count varies with input size; output buffers are written in place with no reallocation
regardless of point count.

**Relative regression budget** — the benchmark harness measures each algorithm warm, median-of-N,
against a baseline recorded on the same runner, and fails on a relative regression beyond the
declared tolerance. This is the self-calibrating half and it is the only timing gate that blocks.

**Informational benchmarks (do not block CI)** — the split budgets from exploration §1.5, on
**declared reference hardware**, **warm**, **median-of-N**, and explicitly **not gated on shared
CI runners** (GitHub Actions runners have unpredictable CPU steal and are 3–5x slower):

- Min-Max envelope over 1e6 samples: **under 4 ms**
- LTTB over 1e6 samples: **under 12 ms**

These replace the brief's single undifferentiated 15 ms figure. The local probe behind claim
**C4b** measured an allocation-free Min-Max pass over 1e6 samples at **~1.72 ms**, inside the
predicted 1–3 ms band, which corroborates the 4 ms budget as achievable with real headroom.
Claim **C4b** is also why warm-up is mandatory: the cold first invocation runs interpreted before
TurboFan tiering and can be 3–5x slower, enough to blow the budget on its own.

**Correctness gates (all deterministic)** — the `fast-check` properties, the determinism test and
the randomised peak-fidelity test. Coverage percentage is explicitly **not** an acceptance
criterion for this change; exploration §1.5 records that it is unfalsifiable for numeric loops.

## Scope & Non-Goals

Deliberately deferred, with the owning change named:

- **Any transport concern** — `DecimationPort`, the pooled single-ownership buffer protocol,
  backpressure, `ArrayBuffer` transfer: change 3 (`core-transport-contract`). This separation is
  deliberate per exploration §3: change 2 is pure math with no transport concerns, and change 3's
  ownership protocol needs streaming and rendering requirements that only exist once the math is
  fixed.
- **Any `Worker`** — real or injected: change 8 (`worker-streaming-transport`). The core never
  constructs a `Worker` at all (exploration §1.9).
- **Incremental O(new samples) streaming decimation over a raw-sample ring buffer**: change 8.
  This change ships the full-pass O(n) algorithms only.
- **Any rendering, projection or device-space transform**: changes 5 and 7.
- **`d3-scale` axis and tick projection**: the framework adapters, changes 10 and 11. It is
  overlay-specific and does not belong in the isomorphic core.
- **Curve interpolation of any kind**: permanently out of scope for TraceKit, not merely
  deferred. It fabricates data between samples, in direct conflict with CLAUDE.md rule 6. This
  is also why `d3-shape` is dropped entirely (exploration §1.10).
- **Browser-side allocation profiling via CDP `HeapProfiler`** (claim **C4d**): first needed by
  change 7, where the render loop lives. This change's paths are Node-side and covered by
  **C4b**.
- **Coverage thresholds per glob and a pinned coverage provider**: change 16.

Package scope is `@trace-kit/*`. The brief's `@optic-vis/*` is a stale template leftover
(exploration §3.11).

## Delivery

Delivery strategy is **`exception-ok`**, explicitly accepted by the user: one PR for this
change, and the 400-line review budget is **not** a blocker. Property-based tests plus a
determinism test plus a peak-fidelity test plus a GC gate plus benchmarks will exceed it, and
splitting the algorithms from the tests that prove them would defeat `strict_tdd: true`.

Versioning follows CLAUDE.md rule 8: a Changesets `patch` bump within the `0.0.x` series.
