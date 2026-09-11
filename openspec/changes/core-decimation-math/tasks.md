# Tasks: core-decimation-math

Strict TDD mode is active (`openspec/config.yaml`: `strict_tdd: true`). Every implementation
(GREEN) task is preceded by its failing-test (RED) task. Test runner: `pnpm run test`.
`[new]` marks a new file; `[correction]` marks an edit to a file that already exists.

**Layer order:** workspace wiring → branded buffers → `SpectrumDataPayload` → `minMaxEnvelope` →
`lttb` → allocation-free enforcement (lint + GC gate) → bench runner (`--trace-deopt`) → export
barrel + side-effects audit → changeset → final verification.

## Apply-budget work units

This repository's `sdd-apply` budget is **2 attempts, ~600 lines per attempt**. Groups are
labelled into two work units so an attempt boundary falls on a group boundary, not mid-algorithm:

- **Work Unit A** (attempt 1, target ≤600 lines): Groups 1–4 — workspace wiring, branded
  buffers, `SpectrumDataPayload`, `minMaxEnvelope`. This is the dependency floor every later
  group needs and is already substantial (brand module + payload module + one full algorithm
  with its unit, property, determinism and peak-fidelity tests).
- **Work Unit B** (attempt 2, target ≤600 lines): Groups 5–9 — `lttb`, the allocation-free
  enforcement instruments (lint + GC gate, shared by both algorithms), the bench runner
  (`--trace-deopt`), the export barrel + `SIDE_EFFECTS_AUDIT.md`, and the changeset.

If either unit threatens to exceed ~600 lines, split at the sub-group boundaries marked
`[attempt-split candidate]` below (Group 4's GC-gate tests, or Group 6's two enforcement
instruments), never inside a RED/GREEN pair.

## Reconciliation applied from design.md

`design.md`'s "Reconciliation With the Delta Specs" section reports 14 findings (R1–R14) against
the spec deltas. All 14 are already resolved in the spec files as read (flat positional
signatures, boundary preconditions, NaN-as-gap, absolute LTTB indices, first-wins tie-break, the
`xOrigin`/offset requirement, the export-surface and mutation-entry-point requirements, and the
benchmark-emission-only scope deferring the regression comparator to change 16). No spec
contradicts design.md as currently written, so tasks below implement the specs directly. One
residual note carried into Group 8: the committed probe at
`openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs` computes
`per = (src.length / buckets) | 0`, which silently drops up to `bucketCount - 1` trailing samples
on a non-divisible length — Group 4 and Group 5's real implementations use the exact integer
partition from design.md §D3/§D4 instead, and no task copies the probe's bucket math verbatim.

---

## 1. Workspace Wiring

- [x] 1.1 [correction] Add `'fast-check': '^4.0.0'` to the `catalog:` block in
  `pnpm-workspace.yaml` (design.md §D8). Verify: `pnpm install` exits `0` with no "not found in
  catalog" error.
- [x] 1.2 [correction] Add `"fast-check": "catalog:"` to `packages/core/package.json`
  `devDependencies`. Verify: `pnpm install` exits `0` and `pnpm why fast-check
  --filter=@trace-kit/core` shows resolution through the catalog entry (satisfies
  `test-harness` spec's "fast-check is resolvable from the catalog" scenario).
- [x] 1.3 [new] RED — write `packages/core/test/decimation/allocation-gate.test.ts` with only its
  first assertion: `expect(typeof globalThis.gc).toBe("function")`. Verify:
  `pnpm exec vitest run packages/core/test/decimation/allocation-gate.test.ts` fails, because
  `--expose-gc` is not yet wired into the `core` Vitest project (design.md §D6: `NODE_OPTIONS`
  and `poolOptions.threads.execArgv` cannot deliver a V8 flag; only `pool: 'forks'` +
  `poolOptions.forks.execArgv` works).
- [x] 1.4 [correction] GREEN — edit the root `vitest.config.ts`'s `core` project to add
  `pool: "forks"` and `poolOptions: { forks: { execArgv: ["--expose-gc"] } }`. Verify:
  `pnpm exec vitest run packages/core/test/decimation/allocation-gate.test.ts` now passes its
  single assertion.
- [x] 1.5 [new] `[design §D8]` Add `packages/core/test/setup/fast-check.ts` calling
  `fc.configureGlobal({ numRuns: 200, verbose: fc.VerbosityLevel.VeryVerbose })`, and register it
  via the `core` project's `setupFiles` in `vitest.config.ts`. Verify:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits `0` (the setup file
  type-checks) and `pnpm run test` still exits `0` with no test files yet exercising `fast-check`.
- [x] 1.6 [new] `[design §D5]` Add a new config object to the root `eslint.config.js`, scoped to
  `files: ["packages/core/src/decimation/**/*.ts"]`, carrying the loop-scoped
  `no-restricted-syntax` selectors from design.md §D5 (object/array literals, template literals,
  `NewExpression`, arrow/function expressions, `SpreadElement`, and the banned
  `.map`/`.filter`/`.slice`/`.subarray`/`.reduce`/`.reduceRight`/`.forEach`/`.flatMap`/`.concat`/
  `.entries`/`.keys`/`.values`/`.toSorted`/`.toReversed`/`.with` and banned transcendental
  `Math.*` member-expression selectors, all nested under
  `:matches(ForStatement, WhileStatement, DoWhileStatement)`), plus the unscoped
  `ForOfStatement`, `RestElement`, `Identifier[name="arguments"]`, `YieldExpression`,
  `AwaitExpression`, `FunctionDeclaration[async=true]`, `FunctionDeclaration[generator=true]`
  selectors applied across the same glob, each with a message naming the remedy. This task adds
  only the config block; no source file exists yet under `src/decimation/` for it to check.
  Verify: `pnpm exec turbo run lint` exits `0` (nothing under the new glob exists yet, so the
  rule cannot fire).

## 2. Branded Buffers (D1)

- [x] 2.1 [new] RED — write `packages/core/test/buffers/brand-erasure.test.ts` asserting, for a
  value produced by a not-yet-existing `asXBuffer`: `Object.getPrototypeOf(value) ===
  Float32Array.prototype`, `value instanceof Float32Array`, and
  `Object.getOwnPropertyNames(value)` / `Object.getOwnPropertySymbols(value)` both equal those of
  a plain `new Float32Array(n)` of the same length (branded-buffers spec, "runtime-identical"
  scenario). Verify: `pnpm exec vitest run packages/core/test/buffers/brand-erasure.test.ts`
  fails with a module-not-found error.
- [x] 2.2 [new] GREEN — implement `packages/core/src/buffers/brand.ts`: `declare const AxisTag:
  unique symbol`, `declare const OwnershipTag: unique symbol`, `BufferAxis`, `OwnershipClass`,
  `Branded<TView, TAxis, TOwnership>`, `Retained<T>`, `Transit<T>`, `XBuffer`, `YBuffer`,
  `IndexBuffer`, `TransitXBuffer`, `TransitYBuffer`, `TransitIndexBuffer`, `TransferableBacking`,
  `assertUsableBuffer` (throws on `byteLength === 0 && length > 0`), `assertCapacity` (throws on
  negative or non-integer capacity), `asXBuffer`/`asYBuffer`/`asIndexBuffer` (narrowing
  constructors, single `as XBuffer` assertion, no `as unknown as`), and
  `allocateXBuffer`/`allocateYBuffer`/`allocateIndexBuffer` (allocating constructors). No `any`
  in any form (CLAUDE.md rule 1). Verify: `pnpm exec vitest run
  packages/core/test/buffers/brand-erasure.test.ts` passes; `pnpm exec turbo run lint
  --filter=@trace-kit/core` reports no violation for `brand.ts` (branded-buffers spec's "No any
  in Brand Machinery" scenario).
- [x] 2.3 [new] RED — write `packages/core/test/buffers/brand-types.test-d.ts`: a fixture function
  `acceptsXBuffer(buf: XBuffer): void` called with a value typed `YBuffer` (must fail to
  compile); a fixture `submitToPool(buf: Transit<Float32Array>): void` called with a
  `Retained<Float32Array>` value (must fail); a fixture `readFromPayload(buf:
  Retained<Float32Array>): void` called with a `Transit<Float32Array>` value (must fail). Verify:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` reports exactly these three type
  errors (RED, since the brand types already exist from 2.2 but the fixture is written to prove
  the errors fire — record the three diagnostics).
- [x] 2.4 [new] GREEN — comment each failing line in `brand-types.test-d.ts` with
  `// @ts-expect-error` and a one-line reason. Verify: `pnpm exec tsc --noEmit -p
  packages/core/tsconfig.test.json` exits `0` (branded-buffers spec's "Mutually incompatible
  buffer brands are not assignable" and both Retained/Transit scenarios pass as `@ts-expect-error`
  assertions).
- [x] 2.5 [new] RED — write `packages/core/test/buffers/construction.test.ts`: a detached
  `Float32Array` (`byteLength === 0`, `length > 0` via a transferred `ArrayBuffer`) passed to
  `asXBuffer` must throw; `allocateXBuffer(1024)` must return a value with `.length === 1024`
  satisfying the `XBuffer` type. Verify against the already-implemented 2.2 code: this test
  should already pass — run it once, confirm both assertions pass, and treat this task as the
  scenario coverage for "Construction and Narrowing Contract" (branded-buffers spec) rather than
  new RED. If either assertion fails, fix `brand.ts` before proceeding.

## 3. `SpectrumDataPayload` (D2)

- [x] 3.1 [new] RED — write `packages/core/test/payload/payload.test.ts` covering: a payload
  built only via `createSpectrumDataPayload` satisfies the `SpectrumDataPayload` structural type
  with branded `Retained<XBuffer>`/`Retained<YBuffer>` fields; `x.length === y.length ===
  capacity`; a payload with capacity `1024` and `600` written samples reports `sampleCount ===
  600` while `x.length === 1024`; `revision` starts at `0`; a fixed `xOrigin` set with
  `xOrigin = 1550.0` and an absolute value `1550.123456` stored as the offset
  `1550.123456 - 1550.0` reconstructs via `xOrigin + x[i]` to instrument resolution. Verify:
  `pnpm exec vitest run packages/core/test/payload/payload.test.ts` fails (module not found).
- [x] 3.2 [new] GREEN — implement `packages/core/src/payload/spectrum-data-payload.ts`:
  `SpectrumDataPayload` (readonly `x: Retained<XBuffer>`, `y: Retained<YBuffer>`, `capacity`,
  `xOrigin: number`, `xUnit: string`, `yUnit: string`, `sampleCount`, `revision`, `xMin`, `xMax`,
  `yMin`, `yMax`), the internal (non-exported) `MutableSpectrumDataPayload`,
  `createSpectrumDataPayload(...)`, and `DecimationResultCursor { indices: IndexBuffer; count:
  number; sourceRevision: number }` with `isCursorCurrent(cursor, payload): boolean`. Verify:
  `pnpm exec vitest run packages/core/test/payload/payload.test.ts` passes.
- [x] 3.3 [new] RED — extend `payload.test.ts` (or add
  `packages/core/test/payload/commit-revision.test.ts`) asserting: `commitPayloadRevision(payload,
  600)` on a `revision === 0` payload sets `revision === 1` and `sampleCount === 600`; a second
  call sets `revision === 2`; `xMin`/`xMax`/`yMin`/`yMax` are recomputed over the new
  `[0, sampleCount)` prefix, not the previous revision's data; `xOrigin` is unchanged by the call.
  Verify: fails (function not yet implemented / not exported).
- [x] 3.4 [new] GREEN — implement and export `commitPayloadRevision(payload:
  MutableSpectrumDataPayload, sampleCount: number): void` in the same file: validates
  `sampleCount` against `capacity`, writes `sampleCount`, recomputes the four extents over
  `[0, sampleCount)`, increments `revision` by exactly `1`. Verify: the 3.3 test passes.
- [x] 3.5 [new] RED — write `packages/core/test/payload/transit-disjointness.test-d.ts` and
  `packages/core/test/payload/transit-disjointness.test.ts`: a type fixture passing a payload's
  `Retained<Float32Array>` X buffer to a function typed `(buf: TransferableBacking) => void` must
  fail `tsc --noEmit` (annotate `@ts-expect-error` once confirmed); a runtime test constructing a
  payload's Y buffer and a separately allocated transit Y buffer asserts
  `payload.y.buffer === transitSlot.buffer` is `false`. Verify: run once without the
  `@ts-expect-error` annotation to confirm the compiler error fires (RED), then annotate.
- [x] 3.6 [new] GREEN — confirm both files pass: `pnpm exec tsc --noEmit -p
  packages/core/tsconfig.test.json` exits `0`; `pnpm exec vitest run
  packages/core/test/payload/transit-disjointness.test.ts` exits `0` (spectrum-data-payload
  spec's "Payload Buffers Are Retained, Never Transferable" scenarios).

## 4. `minMaxEnvelope` (D3)

- [x] 4.1 [new] RED — write `packages/core/test/decimation/min-max.test.ts` covering: the
  signature `minMaxEnvelope(y, sourceOffset, sampleCount, out, outputOffset, bucketCount):
  number` writes into the caller's buffer only over `[outputOffset, outputOffset +
  bucketCount * 2)` and returns `bucketCount * 2` (per the worked example: `sourceOffset=1024,
  sampleCount=2048, outputOffset=512, bucketCount=256` returns `512`, writes only
  `[512, 1024)`); `bucketCount > sampleCount` throws `RangeError` before writing to `out`;
  `bucketCount === sampleCount` (the equality boundary) completes with one sample per bucket; a
  bucket of 99 finite samples + 1 NaN reports the finite min/max; an all-NaN bucket reports
  `NaN`/`NaN`, never `±Infinity`; a bucket whose only sample is finite `+Infinity` reports
  `+Infinity`/`+Infinity`; two runs over the same input produce byte-identical output buffers.
  Verify: `pnpm exec vitest run packages/core/test/decimation/min-max.test.ts` fails (module not
  found).
- [x] 4.2 [new] GREEN — implement `packages/core/src/decimation/min-max.ts`: the exact-integer
  bucket partition (`start = sourceOffset + (((b * sampleCount) / bucketCount) | 0)`, `end =
  sourceOffset + ((((b + 1) * sampleCount) / bucketCount) | 0)`), the NaN-skipping min/max loop
  with the per-bucket `lo === Infinity` emptiness test collapsing to `NaN`/`NaN`, boundary
  validation (`bucketCount <= sampleCount`, `sourceOffset >= 0`, `sampleCount >= 0`, all
  arguments non-negative integers in `[0, 2^31)`) throwing `RangeError` before the loop, no `x`
  parameter, flat positional signature, no object literal anywhere, no `.subarray`. Verify:
  `pnpm exec vitest run packages/core/test/decimation/min-max.test.ts` passes.
- [x] 4.3 [new] RED — write `packages/core/test/arbitraries.ts` (`arbFloat32Series`,
  `arbFloat32SeriesWithGaps`, `arbBucketCount(sampleCount)` respecting
  `bucketCount <= sampleCount`, `arbThreshold(sampleCount)`, `arbLorentzianPeak()`, per
  design.md §D8; lengths deliberately include values not divisible by `bucketCount`), then write
  `packages/core/test/decimation/min-max.property.test.ts` asserting: the per-bucket bounding
  property (`min[b] <= sample.y <= max[b]` for every sample in bucket `b`, over random
  non-divisible lengths — the case the committed probe's `(n/B)|0` math would fail); output
  length equals `bucketCount * 2` regardless of input size; a sub-window write never touches
  `out` outside `[outputOffset, outputOffset + bucketCount * 2)`. Verify: run against a
  deliberately reintroduced `per = (sampleCount / bucketCount) | 0` bucket-math variant of 4.2
  and confirm the bounding property fails on a non-divisible length (recording the counterexample
  as evidence that the property test — not the unit test — is what catches the probe's bug); then
  restore the exact-partition implementation.
- [x] 4.4 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/decimation/min-max.property.test.ts` passes against the real 4.2
  implementation.
- [x] 4.5 [new] RED — write `packages/core/test/decimation/peak-fidelity.property.test.ts` for
  `minMaxEnvelope`: a randomised Lorentzian peak (random position and width, superimposed on a
  noise floor) via `arbLorentzianPeak()` must have at least one bucket whose `[min, max]` range
  covers the peak's half-maximum window, for every generated case (CLAUDE.md rule 6). Verify:
  fails against a naive uniform-subsample stand-in (temporarily swap in a stride-`N` sampler in
  place of `minMaxEnvelope` to confirm the property is falsifiable), then point the test back at
  the real `minMaxEnvelope`.
- [x] 4.6 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/decimation/peak-fidelity.property.test.ts` passes against the real
  `minMaxEnvelope`.
- [x] 4.7 [new] RED — write `packages/core/test/decimation/determinism.test.ts`'s min-max half:
  a committed golden fixture `packages/core/test/fixtures/golden/min-max.json` (input series +
  expected bucketed output) must match `minMaxEnvelope`'s output exactly. Verify: fails before
  the fixture is generated (file not found).
- [x] 4.8 [new] GREEN — generate and commit `min-max.json` from a real run of the 4.2
  implementation. Verify: `pnpm exec vitest run
  packages/core/test/decimation/determinism.test.ts` passes for the min-max half.
- [x] 4.9 [new] RED `[attempt-split candidate]` — extend
  `packages/core/test/decimation/allocation-gate.test.ts` (started in 1.3) with the min-max
  half: a `beforeAll` running `minMaxEnvelopeAllocating` (to be added in
  `packages/core/test/decimation/allocating-control.ts`) at both the `small` (`sampleCount=4096,
  bucketCount=512, iterations=10000`) and `large` (`sampleCount=1_000_000, bucketCount=1000,
  iterations=200`) configurations, asserting `events.length > 0` for each, and throwing from the
  `beforeAll` if either reports `0` (the control-first discipline: a zero control invalidates the
  whole file). Verify: fails (the allocating control and the observer plumbing do not exist yet).
- [x] 4.10 [new] GREEN — implement `packages/core/test/decimation/allocating-control.ts`
  (`minMaxEnvelopeAllocating`, building a `{ lo, hi }` object per bucket into a growing array —
  test-only, never under `src/`) and the `PerformanceObserver({ entryTypes: ["gc"] })` plumbing
  in `allocation-gate.test.ts` (capture `detail.kind`/`detail.flags` against
  `perf_hooks.constants.NODE_PERFORMANCE_GC_*` for failure diagnostics; `globalThis.gc()` +
  30ms drain before each measured window; `describe.sequential`; no `it.skipIf`). Verify:
  `pnpm exec vitest run packages/core/test/decimation/allocation-gate.test.ts` passes the
  control-reports-nonzero assertions for both configurations.
- [x] 4.11 [new] RED — add the real-variant assertions to `allocation-gate.test.ts`: `
  minMaxEnvelope` invoked `10,000` times at the `small` configuration and `200` times at the
  `large` configuration, after warm-up, reports exactly `0` GC events in each measured window.
  Verify: run once against a deliberately allocating stand-in (e.g. temporarily call
  `minMaxEnvelopeAllocating` in place of `minMaxEnvelope`) to confirm the assertion fails loudly,
  then point the assertions back at the real `minMaxEnvelope`.
- [x] 4.12 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/decimation/allocation-gate.test.ts` passes all four min-max assertions
  (small/large × real/control) against the real 4.2 implementation. Capture the run's output into
  `openspec/changes/core-decimation-math/evidence/gc-gate.txt` (min-max half; the lttb half is
  appended in Group 5).

---

## 5. `lttb` (D4)

- [ ] 5.1 [new] RED — write `packages/core/test/decimation/lttb.test.ts` covering: the signature
  `lttb(x, y, sourceOffset, sampleCount, out, outputOffset, threshold): number` writes exactly
  `threshold` absolute indices into `Int32Array` `out` over `[outputOffset, outputOffset +
  threshold)` and returns `threshold` (worked example: `sourceOffset=1000, sampleCount=5000,
  outputOffset=0, threshold=64` returns `64`, every index in `[1000, 6000)`); `threshold < 2`
  throws `RangeError` before writing; `threshold > sampleCount` throws `RangeError`; `threshold
  === 2` writes only `[sourceOffset, sourceOffset + sampleCount - 1]` with no interior-bucket
  division; two runs over identical input produce element-wise identical `Int32Array` output. Verify:
  `pnpm exec vitest run packages/core/test/decimation/lttb.test.ts` fails (module not found).
- [ ] 5.2 [new] GREEN — implement `packages/core/src/decimation/lttb.ts`: the `threshold === 2`
  guard before the bucket loop; the interior exact-integer partition over
  `[1, sampleCount - 2)` mirroring §D3's math; the single forward traversal accumulating each
  bucket's mean (f64 locals, ascending-index summation, no `Math.fround`) while evaluating each
  sample as a triangle-area candidate in its own bucket (`(ax - cx) * (by - ay) - (ax - bx) *
  (cy - ay)`, magnitude via `area < 0 ? -area : area`, no `Math.*` call); strict `>` first-wins
  tie-break; unconditional endpoint assignment (`out[outputOffset] = sourceOffset`,
  `out[outputOffset + threshold - 1] = sourceOffset + sampleCount - 1`) outside the bucket loop;
  boundary validation (`threshold >= 2`, `threshold <= sampleCount`, `sampleCount >= 2`,
  `sourceOffset >= 0`, `out.length >= outputOffset + threshold`, all arguments non-negative
  integers in `[0, 2^31)`) throwing `RangeError` before any output write; no banned transcendental
  `Math.*` call anywhere in the file; no object literal, no `.subarray`. Verify:
  `pnpm exec vitest run packages/core/test/decimation/lttb.test.ts` passes.
- [ ] 5.3 [new] RED — extend `packages/core/test/arbitraries.ts` if needed, then write
  `packages/core/test/decimation/lttb.property.test.ts` asserting, for random X/Y series, a
  random valid `sourceOffset >= 0`, and a random valid `threshold`: output length equals
  `threshold`; every index lies in `[sourceOffset, sourceOffset + sampleCount)`; indices are
  strictly increasing; index `sourceOffset` and index `sourceOffset + sampleCount - 1` are
  present. Verify: fails against a deliberately window-relative-index stand-in (temporarily strip
  the `sourceOffset` addition from 5.2's output) to confirm the property catches the offset bug,
  then restore the correct implementation.
- [ ] 5.4 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/decimation/lttb.property.test.ts` passes against the real 5.2
  implementation.
- [ ] 5.5 [new] RED — write `packages/core/test/decimation/peak-fidelity.property.test.ts`'s
  `lttb` half (same file as 4.5, or a sibling case in the same describe block): a randomised
  Lorentzian peak must have at least one selected index whose Y sample lies within the peak's
  half-maximum width, for every generated case. Verify: fails against a naive uniform-stride
  stand-in, then point back at the real `lttb`.
- [ ] 5.6 [new] GREEN — confirm the `lttb` peak-fidelity case passes against the real
  implementation.
- [ ] 5.7 [new] RED — extend `packages/core/test/decimation/determinism.test.ts` with the `lttb`
  half plus a tie-break case: a committed golden fixture
  `packages/core/test/fixtures/golden/lttb.json`; and a flat (constant-Y) input segment within
  one bucket where every candidate index shares the same (zero) triangle area — the selected
  index must be the lowest in the bucket's range, stable across repeated runs. Verify: fails
  before the golden fixture is generated and before the tie-break assertion is checked against
  the real implementation.
- [ ] 5.8 [new] GREEN — generate and commit `lttb.json` from a real run of the 5.2
  implementation. Verify: `pnpm exec vitest run
  packages/core/test/decimation/determinism.test.ts` passes for both the `lttb` golden case and
  the tie-break case.
- [ ] 5.9 [new] RED — write `packages/core/test/decimation/read-count.test.ts`: an instrumented
  `x`/`y` pair whose element accessors count reads asserts `lttb`'s total read count is at most
  `2 * sampleCount` (never asserted equal to `sampleCount` — that is `minMaxEnvelope`'s
  work-count property, per design.md §D4/finding R5, and must not be conflated with it). Verify:
  fails (instrumentation and assertion not yet written).
- [ ] 5.10 [new] GREEN — confirm the read-count assertion passes against the real `lttb`
  implementation, and add a companion assertion (same file or `min-max.test.ts`) that
  `minMaxEnvelope` reads exactly `sampleCount` times (one pass, one read per sample) so the two
  distinct work-count properties are both pinned and cannot be swapped by a future edit. Verify:
  `pnpm exec vitest run packages/core/test/decimation/read-count.test.ts` passes both halves.
- [ ] 5.11 [new] RED `[attempt-split candidate]` — extend `allocation-gate.test.ts` and
  `allocating-control.ts` with the `lttb` half: `lttbAllocating` (using `.slice()` per bucket
  average) added to `allocating-control.ts`; a `beforeAll` assertion that it reports `> 0` GC
  events at both the `small` (`sampleCount=4096, threshold=512, iterations=10000`) and `large`
  (`sampleCount=1_000_000, threshold=1000, iterations=200`) configurations. Verify: fails (the
  `lttb` control does not exist yet).
- [ ] 5.12 [new] GREEN — implement `lttbAllocating` and confirm the control-side assertions
  pass. Verify: `pnpm exec vitest run packages/core/test/decimation/allocation-gate.test.ts`
  passes the `lttb` control assertions for both configurations.
- [ ] 5.13 [new] RED — add the `lttb` real-variant assertions: `10,000` iterations at `small` and
  `200` at `large`, after warm-up, report exactly `0` GC events. Verify: run once against
  `lttbAllocating` substituted in place of the real `lttb` to confirm the assertion fails loudly,
  then restore.
- [ ] 5.14 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/decimation/allocation-gate.test.ts` passes all eight assertions (min-max
  and lttb, small and large, real and control). Append the `lttb` half to
  `openspec/changes/core-decimation-math/evidence/gc-gate.txt` (zero for both real variants,
  non-zero for both controls, per claim C4b's 0-vs-17 discrimination discipline).

---

## 6. Allocation-Free Enforcement — Lint Instrument Proven Live

The GC-event runtime instrument was built alongside each algorithm in Groups 4–5. This group
proves the source-level lint instrument from 1.6 is live, closing design.md §D5's three-instrument
enforcement graph (source / runtime / codegen).

- [ ] 6.1 [new] `[attempt-split candidate]` RED — write
  `packages/core/test/fixtures/hot-path-violation.ts` containing two permanent regression
  fixtures ignored by the main lint run: a function using `src.subarray(start, end)` inside a
  `for` loop body, and a second function containing an object literal (`{ lo, hi }`) inside a
  `for` loop body. Write `packages/core/test/lint-hot-path.test.ts` driving the ESLint Node API
  against the same flat config with `**/test/fixtures/**` lifted, asserting the exact
  `no-restricted-syntax` rule fires on the exact file and line for each fixture (mirroring
  `lint-rules.test.ts`'s existing pattern for `no-explicit-any`). Verify: the assertions fail
  before the 1.6 config block is scoped to also catch these two selectors — run once with the
  lint config block's `MemberExpression[property.name=...]` selector temporarily removed and
  confirm the `.subarray` assertion fails, then restore it.
- [ ] 6.2 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/lint-hot-path.test.ts` passes both fixture assertions against the 1.6
  config, and that `pnpm exec turbo run lint` still exits `0` (fixtures ignored by the main run —
  `allocation-free-hot-path` spec's "source-level check rejects a banned construct" and "the real
  implementation passes the same check" scenarios).
- [ ] 6.3 [new] RED — temporarily insert a banned construct (an object literal inside a `for`
  loop) into `packages/core/src/decimation/min-max.ts`. Verify: `pnpm exec turbo run lint`
  exits non-zero, naming the rule, file and line. Record the output as evidence that the default
  lint run enforces the ban on real source, then revert the insertion and confirm
  `pnpm exec turbo run lint` exits `0` again.
- [ ] 6.4 [new] Confirm `--trace-deopt` freedom is deferred to Group 7 (it requires the bench
  runner's supervisor mode, built there) — no action here; this task exists only to record in
  the checklist that design.md §D5's third instrument (codegen level) is Group 7's
  responsibility, not this group's, so Group 6 is not mistaken for complete enforcement on its
  own.

## 7. Bench Runner: Real Consumers + `--trace-deopt` (D7)

- [ ] 7.1 [correction] Replace `placeholderWorkload()` in `packages/core/bench/index.ts` with
  real benchmark entries for `minMaxEnvelope` (`sampleCount = 1_000_000`, `bucketCount` sized so
  `bucketCount * 2` approximates a realistic viewport vertex count) and `lttb` (`sampleCount =
  1_000_000`, a representative `threshold`), each built with a `Float32Array`/`Int32Array` source
  and output constructed once outside the timed loop, run through `runBenchmarkSuite` with
  `warmup: 20, iterations: 30` (satisfying design.md §D6's warm-up-before-tier-up need). Verify:
  `pnpm run bench --filter=@trace-kit/core` (or `pnpm exec tsx packages/core/bench/index.ts` from
  the package directory) exits `0` and `bench-results.json` contains a `minMaxEnvelope` entry and
  an `lttb` entry, each with `median`, `p95`, and `iterations` fields (benchmark-harness spec's
  "harness produces a baseline record" scenario).
- [ ] 7.2 [new] `[design §D7]` Add `packages/core/bench/deopt-workload.ts`: imports
  `minMaxEnvelope`/`lttb` from `../src/decimation/*.ts` (source, not `dist`, so trace names match
  authored names), warms each to tier-up with monomorphic `Float32Array`/`Int32Array` arguments,
  then runs `injectedDeoptFixture` — a function `injectedDeoptFixture(shape: { a: number }):
  number { return shape.a + 1; }` warmed 100,000+ times against `{ a: 1 }` then called once with
  `{ a: 1, b: 2 }` to force a reliable map-transition deopt (not the rejected
  `Float32Array`-then-`Float64Array` polymorphic-IC fixture shape, per finding R10).
- [ ] 7.3 [new] Add `packages/core/bench/trace-deopt.ts`: `spawnSync(process.execPath,
  ["--trace-deopt", tsxLoaderArgs, "bench/deopt-workload.ts"])`, capturing stdout+stderr, parsing
  `/\[(?:deoptimizing|bailout)[^\n]*<JSFunction (\w+)/g`; if any match names `minMaxEnvelope` or
  `lttb`, exit `1`; if no match names `injectedDeoptFixture` (the sentinel), exit `2`; otherwise
  exit `0`. Wire argv dispatch in `packages/core/bench/index.ts` (`--trace-deopt` routes to this
  module instead of `runBenchmarkSuite`) and add `"bench:deopt": "tsx bench/index.ts
  --trace-deopt"` to `packages/core/package.json` scripts.
- [ ] 7.4 [new] RED — temporarily remove the `injectedDeoptFixture` call from
  `deopt-workload.ts`. Verify: `pnpm run bench:deopt --filter=@trace-kit/core` exits `2` (sentinel
  not detected — proves exit 2 is reachable and distinct from exit 1). Restore the call.
- [ ] 7.5 [new] GREEN — run `pnpm run bench:deopt --filter=@trace-kit/core` with the fixture
  restored and with clean `minMaxEnvelope`/`lttb` implementations. Verify: exits `0` (no
  deoptimization entry names either target function; the sentinel fires as expected but is not
  itself a failure condition since it is not a named target). Capture the run's output into
  `openspec/changes/core-decimation-math/evidence/trace-deopt.txt`.
- [ ] 7.6 [new] Confirm `packages/core/bench/index.ts --trace-deopt` and `bench:deopt` do not
  appear in `.github/workflows/ci.yml` or any `turbo.json` task (benchmark-harness spec's
  "trace-deopt mode is not invoked by CI" scenario). Verify: grepping the workflow and
  `turbo.json` for `trace-deopt` and `bench:deopt` yields zero matches.
- [ ] 7.7 [correction] Update `packages/core/bench/README.md` with the declared reference-hardware
  record (machine identity, a real `runner` block from a 7.1 run), the 4 ms / 12 ms figures
  marked explicitly informational and non-gating (per the `decimation-min-max` and
  `decimation-lttb` specs' "Informational Reference-Hardware Benchmark" requirements), and
  documentation of the `--trace-deopt` mode's two exit codes and its local-only (non-CI) status.

## 8. Export Barrel + Side-Effects Audit (D9)

- [ ] 8.1 [new] `[design §D9]` Move `VERSION` out of `packages/core/src/index.ts` into a new
  `packages/core/src/version.ts` (`export const VERSION = '0.0.0';` unchanged value). Add
  `packages/core/src/decimation/index.ts` as an internal barrel re-exporting `minMaxEnvelope` and
  `lttb`. Verify: `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits `0`.
- [ ] 8.2 [correction] Rewrite `packages/core/src/index.ts` as the pure public barrel per
  design.md §D9: `export { VERSION } from './version.js'`; `export type { BufferAxis,
  OwnershipClass, Branded, XBuffer, YBuffer, IndexBuffer, Retained, Transit, TransitXBuffer,
  TransitYBuffer, TransitIndexBuffer, TransferableBacking }` and `export { asXBuffer, asYBuffer,
  asIndexBuffer, allocateXBuffer, allocateYBuffer, allocateIndexBuffer }` from
  `'./buffers/brand.js'`; `export type { SpectrumDataPayload, DecimationResultCursor }` and
  `export { createSpectrumDataPayload, commitPayloadRevision, isCursorCurrent }` from
  `'./payload/spectrum-data-payload.js'`; `export { minMaxEnvelope }` from
  `'./decimation/min-max.js'`; `export { lttb }` from `'./decimation/lttb.js'`. Every type-only
  re-export uses `export type` (branded-buffers spec's "Type-only exports use export type"
  scenario, required by `isolatedModules: true`). Explicitly does not export
  `MutableSpectrumDataPayload`, `assertUsableBuffer`, `assertCapacity`, or any bucket-boundary
  helper. Verify: `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits `0` with no
  `isolatedModules` error.
- [ ] 8.3 [new] RED — write `packages/core/test/export-surface.test.ts` asserting: importing
  `@trace-kit/core` exposes `VERSION`, `asXBuffer`, `asYBuffer`, `asIndexBuffer`,
  `allocateXBuffer`, `allocateYBuffer`, `allocateIndexBuffer`, `createSpectrumDataPayload`,
  `commitPayloadRevision`, `isCursorCurrent`, `minMaxEnvelope`, `lttb`; and does NOT expose
  `assertUsableBuffer`, `assertCapacity`, or any `MutableSpectrumDataPayload`-shaped binding
  (`branded-buffers` spec's "Internal boundary validators are not exported" and
  `spectrum-data-payload` spec's "mutable payload type is not part of the public export surface"
  scenarios). Verify: fails against the pre-8.2 barrel (module resolution or missing-export
  errors).
- [ ] 8.4 [new] GREEN — confirm `pnpm exec vitest run
  packages/core/test/export-surface.test.ts` passes against the 8.2 barrel.
- [ ] 8.5 [correction] `[design §D9]` Add rows to `packages/core/SIDE_EFFECTS_AUDIT.md` for every
  new file under `src/`: `src/version.ts`, `src/buffers/brand.ts`,
  `src/payload/spectrum-data-payload.ts`, `src/decimation/min-max.ts`, `src/decimation/lttb.ts`,
  `src/decimation/index.ts` — each marked side-effect-free with a one-line note. Verify:
  `pnpm exec vitest run packages/core/test/side-effects-audit.test.ts` passes (the existing
  both-directions set-equality test fails the build otherwise).

## 9. Versioning

- [ ] 9.1 [new] Add a Changesets entry under `.changeset/` describing a `patch` bump for
  `@trace-kit/core` (CLAUDE.md rule 8's low-velocity `0.0.x` pacing). Verify: `pnpm changeset
  status` reports exactly one pending patch changeset for `@trace-kit/core`.

## 10. Final Verification

- [ ] 10.1 Run the full local suite in order, recording each exit code: `pnpm install`,
  `pnpm exec turbo run typecheck`, `pnpm exec turbo run lint`, `pnpm run test`,
  `pnpm exec turbo run build`.
- [ ] 10.2 Confirm every scenario in the seven delta specs
  (`allocation-free-hot-path`, `benchmark-harness`, `branded-buffers`, `decimation-lttb`,
  `decimation-min-max`, `spectrum-data-payload`, `test-harness`) maps to at least one passing
  test executed in 10.1, and note any gap for `/sdd:verify` to re-check against the compliance
  matrix.
- [ ] 10.3 Confirm no `: any`, `as any`, `<any>`, or `, any>` pattern appears anywhere under
  `packages/core/src/` (CLAUDE.md rule 1, both grep forms). Verify:
  `grep -rnE '(: *any\b|as any\b|<any>|, *any>)' packages/core/src` reports zero matches.
  Separately confirm the deliberate `@ts-expect-error` fixtures from Group 2/3 are the only
  suppressions in `test/`, each with a documented reason.
- [ ] 10.4 Confirm `pnpm exec turbo run build --filter=@trace-kit/core` output still contains no
  `.subarray`, no banned-transcendental `Math.*` call, and no object/array literal inside
  `src/decimation/**`'s emitted `dist/decimation/*.js` (a build-output spot check complementing
  the source-level lint gate from Group 6).
