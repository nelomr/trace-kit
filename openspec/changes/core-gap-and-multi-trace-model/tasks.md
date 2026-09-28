# Tasks: core-gap-and-multi-trace-model

> Roadmap `order: 5.7`. Scope: `packages/core/src/decimation/**`, `packages/core/src/payload/**`,
> `packages/core/src/index.ts`, `packages/core/SIDE_EFFECTS_AUDIT.md`,
> `packages/renderers/src/path/**`, `packages/renderers/src/canvas2d/**`,
> `packages/renderers/src/figure-renderer.ts`, `packages/renderers/src/surface.ts`,
> `packages/renderers/src/style.ts`, `packages/renderers/src/fixtures/scenarios.ts`,
> `packages/core/test/**`, `packages/renderers/test/**` and its visual goldens, `.changeset/`.
> No file under `packages/vue`, `packages/react`, `apps/docs` is created or touched.
> `apps/playground` is touched only if a manual smoke check surfaces a wiring gap.

**TDD sequencing.** Every GREEN implementation task is preceded by a RED task that adds a failing
test first, run for real (not asserted in prose) before the paired GREEN task lands.

**Comment discipline (binding on every task below, carried into `sdd-apply`).** A code comment
written by any task in this file MUST explain the technical "why" directly — the numeric
reasoning, the invariant being protected, the failure mode being avoided. It MUST NOT cite
`design.md`, `proposal.md`, `tasks.md`, or a decision id (`D1`–`D10`) anywhere in production code.
This file itself references decision ids for traceability only; production comments may not.

**`any` discipline.** No `: any`, `as any`, `<any>`, `Record<string, any>`, nor `as never` used to
suppress a type error, anywhere in touched production code.

**Ordering constraint that governs every phase below.** Phase 1 captures gap-free fixtures before
any decimator edit, so the regression guard exists before the code it guards changes. Core
(decimators, then `TraceCollection`) lands before renderers, because `buildTracePath` and the
Canvas2D renderer consume the `-1` index contract and the collection shape core defines. Visual
goldens land last because they depend on every layer beneath them. Gap-free goldens MUST show zero
diff at every phase from Phase 5 onward.

---

## 1. Gap-Free Regression Fixtures (capture before any decimator edit)

- [x] 1.1 Add `packages/core/test/decimation/lttb-gapfree-golden.test.ts`: run the current
  (pre-change) `lttb` over the existing fixture signals and commit its output as JSON fixtures
  under `packages/core/test/decimation/__fixtures__/`. This test is green against the unmodified
  implementation and MUST stay green through every later task.
  Satisfies: `decimation-lttb` — Requirement "Gap-Free Input Is Bit-Identical to the Pre-Change
  Implementation" / Scenario "A gap-free golden fixture is unchanged".
  Verification: `pnpm run test -- lttb-gapfree-golden`.
- [x] 1.2 Capture current `minMaxEnvelope` and `minMaxEnvelopeIndices` outputs for the same fixture
  signals into committed JSON fixtures alongside 1.1, referenced by
  `packages/core/test/decimation/min-max-gaps.test.ts`'s gap-free-equivalence assertions (written
  in Phase 2).
  Satisfies: `decimation-min-max` — Requirement "Gap-Free Input Is Byte-Identical to the Pre-Change
  Implementation".
  Verification: `pnpm run test -- decimation`.

## 2. Core — `decimation-min-max` Gap Awareness

- [x] 2.1 (RED) Add `packages/core/test/decimation/min-max-gaps.test.ts`: mixed bucket (60 real +
  1 `NaN`) → `NaN`/`NaN`; all-`NaN` bucket → `NaN`/`NaN`; `+Infinity` in a gap-free bucket
  propagates unchanged; `+Infinity` + `NaN` in the same bucket → break takes precedence;
  instrumented read count equals `sampleCount`; property test (no mixed bucket's envelope silently
  absorbs its gap). Run and confirm failure against the current implementation.
  Satisfies: `decimation-min-max` — Requirements "A Mixed Bucket Never Silently Bridges a Gap Into
  Its Envelope", "The All-`NaN`-Bucket Rule Is Retained; `±Infinity` Propagates Only in Gap-Free
  Buckets", "Zero-Allocation and Determinism Hold Unchanged With Gap-Containing Input".
  Verification: `pnpm run test -- min-max-gaps` (expect failures).
- [x] 2.2 (GREEN) Implement D4 in `packages/core/src/decimation/min-max.ts`: a `sawGap` register
  set by `if (value !== value) sawGap = true` on the already-read value; collapse `lo = hi = NaN`
  before the existing pinned write lines when `sawGap`; output length stays `2 * bucketCount`.
  Satisfies: same requirements as 2.1.
  Verification: `pnpm run test -- min-max-gaps decimation-min-max`; `pnpm exec turbo run typecheck`.
- [x] 2.3 (RED) Add `[-1, -1]` scenarios to `packages/core/test/decimation/min-max-gaps.test.ts`:
  all-`NaN` bucket emits `[-1, -1]` (not `[start, start]`); mixed bucket emits `[-1, -1]`; gap-free
  buckets unchanged. Run and confirm failure.
  Satisfies: `decimation-min-max` — Requirement "`minMaxEnvelopeIndices` Emits `[-1, -1]` for Any
  Bucket Containing a Gap".
  Verification: `pnpm run test -- min-max-gaps` (expect failures).
- [x] 2.4 (GREEN) Implement the same `sawGap` register in
  `packages/core/src/decimation/min-max-indices.ts`; a gap bucket writes `[-1, -1]`, replacing the
  unspecified `[start, start]` fallback.
  Satisfies: same requirement as 2.3.
  Verification: `pnpm run test -- min-max-gaps min-max-indices`; `pnpm exec turbo run typecheck`.
- [x] 2.5 (RED) Add the zero-GC gate for gapped input (5% `NaN`, fixed pattern) at the archived
  `small` configuration to `packages/core/test/decimation/allocation-gate.test.ts` for both
  `minMaxEnvelope` and `minMaxEnvelopeIndices`. Run and confirm it fails only if 2.2/2.4 allocate
  (it should already pass structurally; treat as GREEN-carrying if so, otherwise fix).
  Satisfies: `decimation-min-max` — Requirement "Zero-Allocation and Determinism Hold Unchanged
  With Gap-Containing Input" / Scenario "Zero GC events hold for gap-containing input".
  Verification: `pnpm run test -- allocation-gate`.
- [x] 2.6 (REFACTOR) Confirm the single-pass, one-read-per-sample bound holds with gaps present
  (instrumented read-count assertion from 2.1); tidy `sawGap` naming/comments per the comment
  discipline (state the invariant — no interpolation across a gap — not a decision id).
  Verification: `pnpm run test -- min-max`; `pnpm exec turbo run lint`.

## 3. Core — `decimation-lttb` Gap Awareness

- [x] 3.1 (REFACTOR, pure) Extract `lttbCore(x, y, start, count, out, cursor, k)` from the existing
  `lttb` loop body verbatim, with the accumulation read changed to
  `const v = y[i]!; if (v !== v) return ABORT; sumY += v;` (same operands, same summation order —
  bit-identical arithmetic); self-compare `y[sourceOffset]` and `y[lastIndex]` before the loop.
  `lttb` calls `lttbCore` over the whole range first; on gap-free input nothing else runs.
  Guarded by the Phase 1 fixtures, which MUST stay green.
  Satisfies: `decimation-lttb` — Requirement "Gap-Free Input Is Bit-Identical to the Pre-Change
  Implementation".
  Verification: `pnpm run test -- lttb-gapfree-golden`; `pnpm exec turbo run typecheck`.
- [x] 3.2 (RED) Add `packages/core/test/decimation/lttb-gaps.test.ts`: no emitted bucket spans a
  source gap; each finite segment's own first/last sample retained; property check (no candidate
  pair straddles a randomly placed gap, `fast-check`). Run and confirm failure (no gapped path
  exists yet).
  Satisfies: `decimation-lttb` — Requirement "Bucketing Never Crosses a Gap, and Segment Endpoints
  Are Retained".
  Verification: `pnpm run test -- lttb-gaps` (expect failures).
- [x] 3.3 (GREEN) Implement the D2 gapped path in `packages/core/src/decimation/lttb.ts`: on
  `lttbCore` abort, run the counting scan (`S`, `F`, `M`), compute budget `B`, detect infeasibility
  (`M > B` → return `0`), apportion via the cumulative-floor idiom (`k_s`), and per segment write
  its only index (`k_s === 1`), its two endpoints (`k_s === 2`), or run `lttbCore` with threshold
  `k_s` (`k_s >= 3`). All integer locals; no allocation.
  Satisfies: same requirement as 3.2.
  Verification: `pnpm run test -- lttb-gaps`; `pnpm exec turbo run typecheck`.
- [x] 3.4 (RED) Add break-encoding scenarios to `lttb-gaps.test.ts`: a consumer detects a break
  without re-scanning source `y` (`-1` sentinel); break representation deterministic across
  repeated runs. Run and confirm failure.
  Satisfies: `decimation-lttb` — Requirement "The Emitted Index Stream Carries a Detectable Break".
  Verification: `pnpm run test -- lttb-gaps` (expect failures).
- [x] 3.5 (GREEN) Write `-1` into the output slot between the last index of one finite segment and
  the first index of the next (D1); never a leading break for a leading gap.
  Satisfies: same requirement as 3.4.
  Verification: `pnpm run test -- lttb-gaps`.
- [x] 3.6 (RED) Add return-count and apportionment scenarios to `lttb-gaps.test.ts`: short segments
  padded with trailing `-1` breaks up to `threshold`; leading gap emits no leading break; infeasible
  fragmentation returns `0`; a single-sample segment is emitted once as an isolated point, never
  dropped; apportionment is proportional and sums exactly to the budget `B`; golden cases —
  segments `[0,40)` + `[45,200)` retain `0, 39, 45, 199`; single interior gap; leading gap;
  trailing gap; `y = [1, NaN, NaN, NaN, 2]`, `threshold = 5` → `[0, -1, 4, -1, -1]`; alternating
  finite/`NaN` at `threshold = 64` over 1,000 samples → returns `0`. Run and confirm failure where
  not already covered by 3.3/3.5.
  Satisfies: `decimation-lttb` — Requirements "Return-Count and Index-Content Contract",
  "Threshold Apportionment".
  Verification: `pnpm run test -- lttb-gaps` (expect failures where new).
- [x] 3.7 (GREEN) Close any remaining gap between 3.3/3.5 and the 3.6 scenarios (padding write,
  apportionment edge cases).
  Satisfies: same requirements as 3.6.
  Verification: `pnpm run test -- lttb-gaps`; `pnpm exec turbo run typecheck`.
- [x] 3.8 (RED) Add all-`NaN` and peak-fidelity scenarios: all-`NaN` input does not throw and
  selects no real point (all `-1`, returns `threshold`); a narrow peak adjacent to a gap survives
  decimation. Run and confirm failure where uncovered.
  Satisfies: `decimation-lttb` — Requirements "All-`NaN` Input Is Defined", "Zero-Allocation,
  Determinism, and Peak-Fidelity Hold Unchanged With `NaN` Input".
  Verification: `pnpm run test -- lttb-gaps` (expect failures where new).
- [x] 3.9 (GREEN) Handle the all-`NaN` case explicitly in the counting scan (`S = 0` → all-`-1`
  output, no throw); confirm peak-adjacent-to-gap fidelity holds under the segment-local LTTB core.
  Satisfies: same requirements as 3.8.
  Verification: `pnpm run test -- lttb-gaps`.
- [x] 3.10 (RED) Add the zero-GC gate for gapped input (5% `NaN`, fixed pattern) at the `small`
  configuration to `packages/core/test/decimation/allocation-gate.test.ts` for `lttb`, plus the
  positive-control allocation case. Run and confirm the negative-control gate passes only once GC
  guarantees hold.
  Satisfies: `decimation-lttb` — Requirement "Zero-Allocation, Determinism, and Peak-Fidelity Hold
  Unchanged With `NaN` Input" / Scenario "Zero GC events hold for a gapped input at the small
  configuration".
  Verification: `pnpm run test -- allocation-gate`.
- [x] 3.11 (REFACTOR) Tidy `lttb.ts`: JSDoc the return contract (`threshold` on every feasible
  case, `0` on infeasible, contents unspecified on `0`), name the counting-scan and apportionment
  locals for the invariant they protect (not a decision id); confirm read-count bound (≤ 2 reads
  gap-free, ≤ 6 reads worst case gapped) via the existing instrumented test.
  Verification: `pnpm run test -- lttb`; `pnpm exec turbo run lint typecheck`.

## 4. Core — `TraceCollection`

- [x] 4.1 (RED) Add `packages/core/test/payload/trace-collection.test.ts` under the `node` Vitest
  environment: two-trace collection holds independent payloads under one shared X domain; the
  collection and its entries are frozen (assignment has no effect or throws in strict mode);
  unknown `yAxisId` rejected at construction (`RangeError`); duplicate trace `id` rejected
  (`RangeError`); a valid collection with distinct ids and known axis ids constructs successfully;
  a member payload's data update does not bump the collection revision; rebinding a trace's
  `yAxisId` bumps the collection revision; per-trace style is a frozen object resolved once;
  `markIsolatedSamples` carried as an optional boolean; core exposes no default color palette;
  `yAxisId` resolves to a transform index once per collection revision, never per point or per
  frame (no `Map` read in a loop fixture); module has no DOM import; factory runs under plain
  Node.js. Run and confirm failure (module does not exist yet).
  Satisfies: `trace-collection-payload` — all ADDED requirements.
  Verification: `pnpm run test -- trace-collection` (expect failures).
- [x] 4.2 (GREEN) Create `packages/core/src/payload/trace-collection.ts` per D6: `TraceStyle`,
  `TraceEntry`, `TraceCollection` interfaces; `createTraceCollection`, `withTraceAxis`,
  `withTraceStyle`, `resolveTraceAxisIndices`. Validation (unknown `yAxisId`, duplicate `id`) runs
  before freezing, using a local `Set`. `resolveTraceAxisIndices` writes into a caller-owned
  `Int32Array` via a nested linear scan, no `Map`. No default palette or line width.
  Satisfies: same requirements as 4.1.
  Verification: `pnpm run test -- trace-collection`; `pnpm exec turbo run typecheck`.
- [x] 4.3 Export the collection API, types, and the `BREAK_INDEX = -1` constant from
  `packages/core/src/index.ts`; update `packages/core/test/export-surface.test.ts` (RED then GREEN)
  to assert the new exports and assert no palette export.
  Satisfies: `trace-collection-payload` — Requirement "Per-Trace Style Is a Frozen Plain Object,
  Core-Owned Defaults Excluded" / Scenario "Core exposes no default color palette".
  Verification: `pnpm run test -- export-surface`.
- [x] 4.4 Add JSDoc-only amendments to `packages/core/src/payload/spectrum-data-payload.ts`: the X
  buffer is a finite-at-every-index producer contract; `NaN` in Y denotes a gap. Add the
  corresponding row to `packages/core/SIDE_EFFECTS_AUDIT.md` for `trace-collection.ts`.
  Satisfies: `gap-sentinel-semantics` — Requirement "`NaN` in the X Buffer Is Out of Contract" /
  Scenario "X-buffer validity is documented as a producer contract, not a runtime guarantee".
  Verification: `pnpm exec turbo run typecheck lint`.

## 5. Core Layer Gate

- [x] 5.1 Run the full core verification suite before moving to renderers: `pnpm exec turbo run
  typecheck`, `pnpm exec turbo run lint`, `pnpm run test` (scoped to `packages/core`), confirm the
  Phase 1 gap-free fixtures are still byte-identical, and grep the touched core files for `any`
  (`: any|as any|<any>` and `, any>`, per CLAUDE.md — run both patterns separately).
  Verification: `pnpm exec turbo run typecheck lint`; `pnpm run test`; `grep -rnE ': any|as any|<any>' packages/core/src`; `grep -rn ', any>' packages/core/src`.

## 6. Renderers — `buildTracePath` Break Idiom

- [x] 6.1 (RED) Extend `packages/renderers/test/node/build-trace-path.test.ts`: gap-free input
  still issues exactly one `moveTo` and `n - 1` `lineTo` (500-point case, 1/499 call count); a
  single interior gap splits the sequence into two `moveTo`-led segments (2/497); a decimated
  stream with `-1` and trailing padding; all-`NaN` input (0/0); leading and trailing gaps;
  coordinates still match the transform's projection within a segment. Run and confirm failure for
  the gap cases (current implementation cannot express a break).
  Satisfies: `canvas2d-trace-rendering` — Requirement "`buildTracePath` Issues One `moveTo` Per
  Finite Segment, `lineTo` Within Segments, None Across a Gap".
  Verification: `pnpm run test -- build-trace-path` (expect failures).
- [x] 6.2 (GREEN) Implement the D5 pen-state walk in
  `packages/renderers/src/path/build-trace-path.ts`: signature unchanged; `j < 0` (decimated break)
  or `y[j] !== y[j]` (direct-path gap) drops the pen; otherwise `moveTo` if pen is up, else
  `lineTo`; return value stays `n`. Gap-free input reduces to exactly one `moveTo` then `n - 1`
  `lineTo` with identical arguments.
  Satisfies: same requirement as 6.1.
  Verification: `pnpm run test -- build-trace-path`; `pnpm exec turbo run typecheck`.
- [x] 6.3 (RED) Add a zero-allocation assertion for `buildTracePath`'s point loop (per trace) to
  the renderers allocation gate, gap-free and gapped. Run and confirm it fails only if 6.2
  allocates.
  Satisfies: `canvas2d-trace-rendering` — Requirement "All Other Archived Requirements Hold
  Unchanged for Gap-Free, Single-Trace Input" / Scenario "`buildTracePath`'s point loop remains
  zero-allocation per trace".
  Verification: `pnpm run test -- allocation-gate`.

## 7. Renderers — Isolated-Sample Markers (pure walk)

- [x] 7.1 (RED) Add `packages/renderers/test/node/isolated-markers.test.ts` against a counting
  `MarkerSink` fake: direct path `[1, NaN, 5, NaN, 2, 3]` → 1 marker at the index for `5`; decimated
  stream with an LTTB singleton (`k_s === 1`) → 1 marker; min-max `[-1,-1, 7,7, -1,-1]` → 1 marker;
  gap-free input → 0 markers; a `[5, 3]` segment (two distinct indices) → 0 markers; exact `rect`
  arguments `(px - s/2, py - s/2, s, s)` with `s = 2 * lineWidthCss * dpr`; zero allocation under
  `--expose-gc`. Run and confirm failure (module does not exist yet).
  Satisfies: `canvas2d-trace-rendering` — Requirement "Isolated Samples Are Painted as Filled
  Square Markers by Default" (marker geometry and count scenarios).
  Verification: `pnpm run test -- isolated-markers` (expect failures).
- [x] 7.2 (GREEN) Create `packages/renderers/src/path/isolated-markers.ts` per D10: `MarkerSink`
  interface (`{ rect(x, y, w, h): void }`); `countIsolatedSegments(x, y, indices, decimatedCount,
  directCount): number` (integer locals only, cold-path counting walk); `buildIsolatedMarkers(sink,
  t, x, y, indices, decimatedCount, directCount, halfSide): number` (same pen-state rules as D5,
  tracks the current segment's first index and a distinct flag, calls `sink.rect(...)` on an
  isolated segment close).
  Satisfies: same requirement as 7.1.
  Verification: `pnpm run test -- isolated-markers`; `pnpm exec turbo run typecheck`.

## 8. Renderers — `TraceDrawingContext` Extensions

- [x] 8.1 (RED) Add call-sequence assertions to the renderer surface tests: `TraceDrawingContext`
  gains `setLineDash(segments: number[]): void` and `fill(path: Path2D): void`; the fake context
  records both in the same ordered call log as `stroke`. Run and confirm failure.
  Satisfies: `canvas2d-trace-rendering` — Requirements "Exactly One `Path2D` Is Constructed Per
  Trace Per `render()` Call", "Isolated Samples Are Painted as Filled Square Markers by Default".
  Verification: `pnpm run test -- surface` (expect failures).
- [x] 8.2 (GREEN) Add `setLineDash` and `fill` to `TraceDrawingContext` in
  `packages/renderers/src/surface.ts` and its fake implementation.
  Satisfies: same requirements as 8.1.
  Verification: `pnpm run test -- surface`; `pnpm exec turbo run typecheck`.
- [x] 8.3 Add the frozen `TRACE_PALETTE` to `packages/renderers/src/style.ts` (renderer-owned
  default colors, no default in core).
  Satisfies: `canvas2d-trace-rendering` — Requirement "The Renderer Resolves Per-Trace Style and
  Per-Trace `ViewportTransform` From the Collection" / Scenario "A trace without explicit style
  receives the renderer's default palette color".
  Verification: `pnpm exec turbo run typecheck lint`.

## 9. Renderers — `Canvas2DRenderer` Per-Trace State and `setTraces`

- [x] 9.1 (RED) Extend `packages/renderers/test/node/figure-renderer-shape.test.ts` and
  `figure-renderer-shape.test-d.ts`: `FigureRenderer` interface and `Canvas2DRenderer` both expose
  `setTraces(collection: TraceCollection): void`; `setData(payload)` is retained. Run and confirm
  failure.
  Satisfies: `canvas2d-trace-rendering` — Requirement "The Renderer Resolves Per-Trace Style and
  Per-Trace `ViewportTransform` From the Collection".
  Verification: `pnpm run test -- figure-renderer-shape` (expect failures).
- [x] 9.2 (GREEN) Add `setTraces(collection)` to `packages/renderers/src/figure-renderer.ts` and
  implement it on `Canvas2DRenderer` in `packages/renderers/src/canvas2d/canvas2d-renderer.ts` per
  D7: `setData(payload)` internally builds a one-entry collection bound to the first registered
  axis id. On `setTraces` (or collection reference/revision change), allocate the parallel
  per-trace columns (`#traceAxisIndex`, `#traceIndices`, `#traceDecimatedCount`, memo columns,
  resolved style columns, `#traceTransforms` built with each trace's own `xOrigin`,
  `#traceIsolatedCount`, marker-flag column). All allocation happens in `setTraces`, never in
  `render()`. Collection `xDomainMin/xDomainMax` seed the view X domain on `setTraces`.
  Satisfies: same requirement as 9.1; `canvas2d-trace-rendering` — Requirement "All Other Archived
  Requirements Hold Unchanged for Gap-Free, Single-Trace Input".
  Verification: `pnpm run test -- figure-renderer-shape canvas2d-renderer`; `pnpm exec turbo run typecheck`.
- [x] 9.3 (RED) Extend `packages/renderers/test/node/work-counts.test.ts`: per-trace memo counts —
  a revision bump on one trace does not re-decimate the other traces; 60 unchanged renders across a
  multi-trace collection invoke `lttb` once per trace; infeasible LTTB (`0`) triggers exactly one
  `minMaxEnvelopeIndices` call per stale trace, and the memo records the fallback under the `lttb`
  key so it does not re-run on unchanged frames; isolated count is not recomputed on unchanged
  frames. Run and confirm failure.
  Satisfies: `canvas2d-trace-rendering` — Requirements "Decimation Memoization Is Keyed Per Trace",
  "Infeasible LTTB Falls Back to `minMaxEnvelopeIndices`".
  Verification: `pnpm run test -- work-counts` (expect failures).
- [x] 9.4 (GREEN) Implement per-trace memo staleness (payload revision, algorithm, parameter, or
  that trace's bound X/Y domain) and the D3 fallback: when `lttb` returns `0`, immediately call
  `minMaxEnvelopeIndices` with `bucketCount = max(1, floor(threshold / 2))` into the same index
  buffer and record the result under the `lttb` memo key. Refresh `#traceIsolatedCount[i]` only
  when that trace's memo recomputes, via `countIsolatedSegments`.
  Satisfies: same requirements as 9.3.
  Verification: `pnpm run test -- work-counts`; `pnpm exec turbo run typecheck`.
- [x] 9.5 (RED) Extend `packages/renderers/test/node/canvas2d-renderer.test.ts` (or the relevant
  renderer test file): exactly one `Path2D` per trace per `render()`; a single-entry collection
  reduces to the archived one-per-render behavior; `setTransform` called exactly once per frame
  regardless of trace count; two traces on two axes drawn with their own resolved transform;
  `lineWidth` derived per-trace from that trace's style and the injected `dpr`; 3-trace `Path2D`
  count with `dpr: 2`. Run and confirm failure.
  Satisfies: `canvas2d-trace-rendering` — Requirements "Exactly One `Path2D` Is Constructed Per
  Trace Per `render()` Call", "The Renderer Resolves Per-Trace Style and Per-Trace
  `ViewportTransform` From the Collection", "All Other Archived Requirements Hold Unchanged for
  Gap-Free, Single-Trace Input".
  Verification: `pnpm run test -- canvas2d-renderer` (expect failures).
- [x] 9.6 (GREEN) Implement the per-trace `render()` loop: for each trace, resolve the memoized
  index buffer (re-decimating only if stale), construct one `Path2D`, call `buildTracePath`, set
  `strokeStyle`/`lineWidth`/`setLineDash` from the pre-resolved columns, `stroke(path)`; if
  `isolatedCount[i] > 0` and the trace's `markIsolatedSamples` flag is on, construct a second
  `Path2D` via `buildIsolatedMarkers`, set `fillStyle` to the trace's stroke color, `fill(markers)`.
  `setTransform` remains called once per frame outside the trace loop.
  Satisfies: same requirements as 9.5.
  Verification: `pnpm run test -- canvas2d-renderer`; `pnpm exec turbo run typecheck`.
- [x] 9.7 (RED) Extend `packages/renderers/test/node/allocation-gate.test.ts`: two-trace render is
  zero-GC; zero-GC holds with markers present (a gapped trace with one isolated sample). Run and
  confirm failure only if 9.6 allocates.
  Satisfies: `canvas2d-trace-rendering` — Requirement "Isolated Samples Are Painted as Filled
  Square Markers by Default" / Scenario "Marker rendering is zero-allocation and memoized".
  Verification: `pnpm run test -- allocation-gate`.
- [x] 9.8 (RED) Add marker call-sequence scenarios to the renderer test suite: a gapped trace with
  one isolated sample records `stroke` then `fillStyle`, `fill` for that trace only, and constructs
  one extra `Path2D`; gap-free input and `markIsolatedSamples: false` record no `fill` and no extra
  `Path2D`; an isolated sample on the direct path produces one marker; an isolated sample on the
  decimated path produces one marker; a segment of two distinct samples produces no marker;
  gap-free input produces no marker and an unchanged call sequence; the per-trace flag disables
  markers. Run and confirm failure.
  Satisfies: `canvas2d-trace-rendering` — Requirement "Isolated Samples Are Painted as Filled
  Square Markers by Default" (remaining scenarios).
  Verification: `pnpm run test -- canvas2d-renderer` (expect failures).
- [x] 9.9 (GREEN) Close any remaining gap between 9.6 and the 9.8 scenarios (conditional marker
  path construction, `fillStyle`/`fill` call ordering, per-trace opt-out wiring).
  Satisfies: same requirements as 9.8.
  Verification: `pnpm run test -- canvas2d-renderer work-counts allocation-gate`; `pnpm exec turbo run typecheck`.
- [x] 9.10 (REFACTOR) Tidy `canvas2d-renderer.ts`: name per-trace columns and the fallback branch
  for the invariant they protect; confirm `setData` still reduces to the archived single-trace
  path bit-for-bit in call sequence.
  Verification: `pnpm run test -- canvas2d-renderer`; `pnpm exec turbo run lint typecheck`.

## 10. Renderers Layer Gate

- [x] 10.1 Run the full renderers verification suite: `pnpm exec turbo run typecheck`, `pnpm exec
  turbo run lint`, `pnpm run test` (scoped to `packages/renderers`), and grep touched renderer
  files for `any` (both patterns, per CLAUDE.md).
  Verification: `pnpm exec turbo run typecheck lint`; `pnpm run test`; `grep -rnE ': any|as any|<any>' packages/renderers/src`; `grep -rn ', any>' packages/renderers/src`.

## 11. Visual Goldens

- [x] 11.1 Add gapped-trace and overlay scenarios to `packages/renderers/src/fixtures/scenarios.ts`:
  a gapped trace with leading, interior, and trailing gaps plus one isolated sample; an overlay of
  two traces on two axes (linear + log Y scale), distinct colors, one dashed.
  Satisfies: `visual-golden-corpus` — Requirements "The Golden Corpus Includes a Gapped-Trace
  Figure", "The Golden Corpus Includes an Overlaid Two-Trace, Two-Axis Figure".
  Verification: `pnpm exec turbo run typecheck`.
- [x] 11.2 (RED) Extend `packages/renderers/test/visual/canvas2d.visual.test.ts` with the two new
  scenarios; run against the existing goldens directory (no new goldens committed yet) and confirm
  it fails (missing golden images).
  Satisfies: same requirements as 11.1.
  Verification: `pnpm run test -- canvas2d.visual` (expect failure — missing goldens).
- [x] 11.3 Generate the new goldens on CI (or the project's documented golden-generation command)
  for the gapped-trace figure (visible breaks, not bridging lines, with the isolated-sample marker
  visible) and the overlay figure; commit the generated images alongside the test.
  Satisfies: same requirements as 11.1; `visual-golden-corpus` — Requirement "A Golden Update Is an
  Explicit, Reviewable Act, Including for Existing Goldens After This Change".
  Verification: `pnpm run test -- canvas2d.visual`. Deferred by design to the Linux CI run
  (`__TRACEKIT_VISUAL_IS_LINUX_CI__` gate) rather than generated locally on macOS; this repo's own
  visual-regression design forbids generating a reference image on a platform other than the one
  that renders it in CI, to avoid committing a non-matching golden.
- [x] 11.4 Confirm every pre-existing golden shows zero diff after this change (no regeneration of
  unrelated goldens).
  Satisfies: `visual-golden-corpus` — Requirement "A Golden Update Is an Explicit, Reviewable Act,
  Including for Existing Goldens After This Change" / Scenario "Every pre-existing golden shows
  zero diff after this change".
  Verification: `pnpm run test -- canvas2d.visual` on the Linux CI run that generates 11.3's
  goldens — same run confirms zero diff on every pre-existing golden.

## 12. Changeset

- [x] 12.1 Add a `.changeset/*.md` patch bump for `@trace-kit/core` and `@trace-kit/renderers`
  describing the gap semantics and multi-trace collection addition, per the project's low-velocity
  versioning pacing (CLAUDE.md rule 8).
  Verification: `pnpm exec changeset status` (or the project's documented changeset check).

## 13. Final Verification Gate

- [x] 13.1 Grep the full diff (all touched files across `packages/core` and `packages/renderers`)
  for `any` using both required patterns separately, per CLAUDE.md: `: any|as any|<any>` and
  `, any>` (the `Record<string, any>` form). Zero matches required in production code (test files
  follow the same rule unless explicitly typed).
  Verification: `grep -rnE ': any|as any|<any>' packages/core/src packages/renderers/src`;
  `grep -rn ', any>' packages/core/src packages/renderers/src`.
- [x] 13.2 Confirm zero-GC gates pass for every hot path touched by this change: `lttb`,
  `minMaxEnvelope`, `minMaxEnvelopeIndices` under gapped input; `buildTracePath`'s per-trace point
  loop; the per-trace `render()` loop with and without markers.
  Verification: `pnpm run test -- allocation-gate`.
- [x] 13.3 Confirm no decimator output or rendered path segment spans a source `NaN` (property
  tests from Phases 2, 3, and 6) and that gap-free LTTB/min-max output is byte-identical to the
  pre-change fixtures (Phase 1).
  Verification: `pnpm run test -- lttb-gaps min-max-gaps lttb-gapfree-golden build-trace-path`.
- [x] 13.4 Run the complete project verification suite in order and confirm all green:
  `pnpm exec turbo run typecheck`, `pnpm exec turbo run lint`, `pnpm run test`, `pnpm exec turbo
  run build`.
  Verification: `pnpm exec turbo run typecheck`; `pnpm exec turbo run lint`; `pnpm run test`;
  `pnpm exec turbo run build`.
- [x] 13.5 Confirm every Success Criterion in `proposal.md` is checked off against real test
  output (not asserted in prose): no spanning `NaN`; gap-free identity; two traces on two axes;
  zero-GC gates; isolated-sample visibility default; zero golden diff plus new goldens; full
  command suite green; no `any` introduced.
  Verification: manual cross-check against `proposal.md` Success Criteria using the test/lint/build
  output from 13.1–13.4. All criteria confirmed except the golden-diff criterion, which resolves
  on the Linux CI run per 11.3/11.4.
