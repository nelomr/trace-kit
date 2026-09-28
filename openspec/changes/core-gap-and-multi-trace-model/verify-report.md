# Verification Report: core-gap-and-multi-trace-model

## Summary

| Check | Status | Notes |
|---|---|---|
| Completeness | PASS WITH WARNINGS | 50/53 tasks done. 11.3, 11.4 blocked (goldens require Linux CI). 13.5 open (cross-check depends on 11.3/11.4). |
| Scenario Compliance | PASS WITH WARNINGS | All non-visual scenarios verified with real test execution. Visual golden scenarios (gapped-trace, overlay-two-axis) SKIP on this platform by design (`__TRACEKIT_VISUAL_IS_LINUX_CI__` gate), unverified until CI runs them. |
| Design Coherence | PASS WITH WARNINGS | D1-D6, D8-D10 implemented as designed. D7's literal text ("setData... internally builds a one-entry collection") is not implemented; `setData`/`setTraces` are mutually-exclusive parallel code paths instead. Behaviorally equivalent per tests, but a documented deviation. |
| TraceKit Architecture | PASS | Zero `any` (both grep patterns), zero-GC gates green for all touched hot paths, isomorphic core untouched, no DOM in `packages/core`. |
| Build & Tests | PASS | typecheck, lint, build, test all exit 0. 311/311 core tests, 101/101 renderer tests (9 visual tests skipped by platform gate), 45/45 playground tests. |

## Completeness Detail

- Total tasks: 53. Done: 50. Incomplete: 3 (`11.3`, `11.4`, `13.5`).
- `11.3`/`11.4` (golden PNG generation/comparison for `gapped-trace` and `overlay-two-axis`) cannot be completed locally: `packages/renderers/test/visual/canvas2d.visual.test.ts` uses `it.skipIf(!__TRACEKIT_VISUAL_IS_LINUX_CI__)`, confirmed by the live test run — the visual project reports "1 skipped (1)" / "9 skipped (9)" with zero executed, matching the repo's documented Linux-only golden generation policy. This is a genuine environment gate, not a shortcut; the implementing agent's claim is verified correct.
- `13.5` (cross-check every proposal.md Success Criterion against real output) is honestly left open because two of its inputs (zero-diff on new goldens) don't exist yet — it cannot be truthfully checked off until 11.3/11.4 run on CI. Not a defect; correctly left unchecked rather than falsely marked done.
- No task outside 11.3/11.4/13.5 was found falsely marked `[x]`; spot-checked task-to-test mapping for Phases 2, 3, 4, 6, 7, 9 against actual test file contents and all referenced tests exist and pass.

## Scenario Compliance Matrix

| Capability | Scenario | Result | Test Reference |
|---|---|---|---|
| decimation-lttb | Gap-free bit-identical to pre-change | PASS | `packages/core/test/decimation/lttb-gapfree-golden.test.ts` |
| decimation-lttb | Bucketing never crosses a gap; segment endpoints retained | PASS | `packages/core/test/decimation/lttb-gaps.test.ts` |
| decimation-lttb | `-1` break sentinel, deterministic | PASS | `packages/core/test/decimation/lttb-gaps.test.ts` |
| decimation-lttb | Return-count/apportionment contract, infeasible → 0 | PASS | `packages/core/test/decimation/lttb-gaps.test.ts` |
| decimation-lttb | All-`NaN` input defined; peak-adjacent-to-gap fidelity | PASS | `packages/core/test/decimation/lttb-gaps.test.ts` |
| decimation-lttb | Zero-GC gapped (small config) | PASS | `packages/core/test/decimation/allocation-gate.test.ts` (14 tests, 0 GC events confirmed) |
| decimation-min-max | Mixed/all-`NaN` bucket → `NaN`/`NaN`, `±Infinity` precedence | PASS | `packages/core/test/decimation/min-max-gaps.test.ts` |
| decimation-min-max | `minMaxEnvelopeIndices` emits `[-1,-1]` for any gap bucket | PASS | `packages/core/test/decimation/min-max-gaps.test.ts` |
| decimation-min-max | Zero-allocation/determinism with gaps | PASS | `packages/core/test/decimation/allocation-gate.test.ts` |
| trace-collection-payload | Frozen collection, revision bump, validation, no core palette | PASS | `packages/core/test/payload/trace-collection.test.ts` (14 tests) |
| trace-collection-payload | New exports incl. `BREAK_INDEX` | PASS | `packages/core/test/export-surface.test.ts` |
| gap-sentinel-semantics | X out-of-contract documented (JSDoc only) | PASS | `packages/core/src/payload/spectrum-data-payload.ts` (inspected, no runtime check by design) |
| canvas2d-trace-rendering | Pen-state `moveTo`/`lineTo` per segment, gap-free unchanged | PASS | `packages/renderers/test/node/build-trace-path.test.ts` (11 tests) |
| canvas2d-trace-rendering | Isolated-sample marker geometry and counting | PASS | `packages/renderers/test/node/isolated-markers.test.ts` (11 tests) |
| canvas2d-trace-rendering | `TraceDrawingContext.setLineDash`/`fill` | PASS | `packages/renderers/test/node/surface-types.test.ts` |
| canvas2d-trace-rendering | One `Path2D` per trace; per-trace transform/style; `setTraces` | PASS | `packages/renderers/test/node/figure-renderer-shape.test.ts`, `canvas2d-renderer.test.ts` (12 tests) |
| canvas2d-trace-rendering | Per-trace memo; infeasible-LTTB fallback to min-max | PASS | `packages/renderers/test/node/work-counts.test.ts` (17 tests) |
| canvas2d-trace-rendering | Two-trace zero-GC, with/without markers | PASS | `packages/renderers/test/node/allocation-gate.test.ts`, `canvas2d-renderer.test.ts` |
| visual-golden-corpus | Gapped-trace figure golden | SKIP (platform-gated) | `packages/renderers/test/visual/canvas2d.visual.test.ts` — `skipIf` on non-Linux-CI, confirmed skipped in this run |
| visual-golden-corpus | Overlay two-axis figure golden | SKIP (platform-gated) | same file, same gate |
| visual-golden-corpus | Zero diff on pre-existing goldens | SKIP (platform-gated) | same file, same gate — cannot be confirmed off-CI |

## Design Coherence Detail

Verified against `design.md` D1-D10:
- D1 (`-1` sentinel), D2 (return-count/apportionment), D3 (min-max fallback), D4 (min-max break encoding), D5 (pen-state walk), D6 (`TraceCollection` shape), D9 (reactivity note, no adapter code touched), D10 (isolated markers) — all implemented as specified and covered by passing tests.
- **D7 deviation (flagged, open):** design.md states "`setData(payload)` is retained and internally builds a one-entry collection bound to the first registered axis id." The actual implementation in `packages/renderers/src/canvas2d/canvas2d-renderer.ts` (lines 202-258, 300-350) does not do this: `setData` sets `#payload`/`#xOrigin` and nulls `#traceCollection`; `setTraces` sets `#traceCollection` and nulls `#payload`. `render()` branches `if (this.#traceCollection !== null) { this.#renderTraces(...) } else { /* legacy single-payload path using this.#payload, this.#indices, this.#decimatedCount, this.#style.traceColor */ }`. This is two parallel, mutually-exclusive rendering code paths, not "`setData` as the one-entry-collection case" as the design's literal architecture text describes.
  - The delta spec (`canvas2d-trace-rendering/spec.md`, lines 53-59) is worded as a **behavioral** equivalence ("For a single-trace collection... this reduces exactly to the archived one-`Path2D`-per-`render()` behavior"), not as an implementation mandate that `setData` must construct a `TraceCollection` object. Under that reading the implementation satisfies the spec text even though it diverges from design.md's stated mechanism.
  - Verdict: **not a spec violation**, but **is a design.md deviation**. It is an acceptable engineering choice (avoids allocating a `TraceCollection` + `Int32Array` axis-resolution on every `setData` call, keeping the legacy single-trace path allocation-shaped exactly as before) but was not called out in design.md's Decision Status table, and the two-path structure duplicates line-width/style resolution logic (`this.#style.traceColor` vs. per-trace `#traceStroke` palette resolution) that D7 intended to unify. Flagging as a WARNING: either amend design.md to record this as the actual D7 mechanism, or refactor `setData` to build a one-entry collection as originally specified, before this change is treated as fully closed.

## TraceKit Non-Negotiables Audit

- **No `any`:** `grep -rnE ': any|as any|<any>' packages/core/src packages/renderers/src` → 0 matches. `grep -rn ', any>' packages/core/src packages/renderers/src` → 0 matches.
- **Zero-copy/zero-GC in hot paths:** all `allocation-gate.test.ts` suites (core decimators, renderer `buildTracePath`, renderer per-trace `render()` with/without markers) pass with 0 GC events reported for the non-allocating variants and >0 for the positive controls — the gate is proven discriminating, not trivially green.
- **Isomorphic core:** `packages/core/test/isomorphism.test.ts` and `no-worker-references.test.ts`-equivalent checks pass; `trace-collection.ts` runs under the `node` Vitest environment per task 4.1.
- **Physics-preserving decimation:** peak-adjacent-to-gap fidelity scenario present and green in `lttb-gaps.test.ts`; gap-free bit-identical output confirmed via `lttb-gapfree-golden.test.ts`.

## Out-of-Scope Ripple Fix

Two `apps/playground` DOM test fixtures (`test/dom/core-math-controls.test.ts`, `test/dom/core-math-teardown.test.ts`) received `setLineDash`/`fill` stubs to keep typechecking after `TraceDrawingContext` was widened (task 8.2). This is outside the change's declared scope (`apps/playground` is scoped as "touched only if a manual smoke check surfaces a wiring gap") but is a mechanical, necessary consequence of a MODIFIED interface, not a functional change. Confirmed: `apps/playground` typecheck and full test suite (45/45) pass.

## Issues Identified

- **WARNING**: `design.md` D7's literal "setData... internally builds a one-entry collection" mechanism is not implemented; the renderer instead has two mutually-exclusive code paths (`#payload` vs. `#traceCollection`). Does not violate the delta spec's wording, but should be reconciled — either update design.md or refactor toward the originally specified single-path mechanism.
- **WARNING**: Tasks `11.3`, `11.4` (new visual goldens for `gapped-trace` and `overlay-two-axis`, plus zero-diff confirmation on existing goldens) are blocked pending a Linux CI run; genuinely un-runnable on macOS per the repo's own `__TRACEKIT_VISUAL_IS_LINUX_CI__` gate, verified live (visual test project reports all its tests skipped in this environment). Task `13.5` is correctly left open as a consequence.
- No CRITICAL issues found. No `any` introduced. No allocation regressions. No spec requirement found unimplemented or falsely marked done.

## Final Verdict: PASS WITH WARNINGS

Rationale: every runnable check (typecheck, lint, build, 457 total tests across core/renderers/playground) is green, zero `any`, zero-GC gates hold, and every scenario that can execute off Linux CI is verified with real test references. The only gaps are (1) an environment-gated golden-generation step that is structurally impossible to complete on this platform and correctly reported as such rather than faked, and (2) a real but non-spec-breaking deviation from design.md's D7 mechanism that should be reconciled before archive. Recommend resolving the D7 note (update design.md or refactor) and running 11.3/11.4/13.5 on Linux CI before archiving; neither blocks a `PASS WITH WARNINGS` verdict.
