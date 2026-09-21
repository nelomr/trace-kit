# Apply progress — core-scale-transforms

## Status: PARTIAL — Phases 1–10 and 12 (minus the golden-dependent parts) complete and green.
## Phase 11 (visual goldens) is BLOCKED by the execution environment, not by the design/spec.

## What's done (real RED→GREEN→REFACTOR, all commands actually run)

- **Phase 1–3** (`packages/core/src/viewport/transform.ts`): `Y_SCALE_KIND_LINEAR`/`Y_SCALE_KIND_LOG`
  discriminants, `yLogDomainMin`/`yLogScale` fields (single object literal, shape-split guard
  verified by `Object.keys` equality test), log `projectY`/`unprojectY` branches, construction
  guards, relative round-trip bound test (with a self-test proving the helper rejects an
  absolute-tolerance-passing broken model). Tests:
  `packages/core/test/viewport/log-transform.test.ts` (32 tests).
- **Phase 2.5** (allocation gate): extended `packages/core/test/viewport/transform-allocation.test.ts`
  with a `yScaleKind: log` parameterization. Discovered and fixed a real measurement artifact: the
  original 20-iteration JIT warm-up was tuned for the old single-expression `projectY`; the new
  branched dispatch needed more warm-up calls before the optimizing compiler settles, otherwise the
  gate observed transient compiler-associated GC events and reported false positives on the
  **pre-existing linear-path test** (confirmed via `git stash` that this test passed unmodified
  before my change and failed after, then bisected to warm-up iteration count via a throwaway
  diagnostic file, not left in the tree). Fixed by raising warm-up to 500 iterations with two
  gc()+sleep passes; stable across repeated runs.
- **Phase 4** (`packages/core/src/viewport/ticks.ts`): `selectLogTicks` — decade floor by integer
  stepping, thinning/mantissa/sub-decade branches, unconditional non-empty floor (the d3-scale#44
  anti-defect guarantee), transcendental-free source scan. One design.md ambiguity resolved during
  implementation: "decadeCount" needed to mean *decade intervals* (boundary count − 1), not boundary
  count, for the mantissa-emission and thinning-stride conditions in D4's own worked examples
  (`[1,100], targetCount:12` and `[1e-3,1e6], targetCount:5`) to produce the outputs D4 itself
  specifies. Implemented that way; all of D4's worked examples pass as literal tests. Tests:
  `packages/core/test/viewport/log-ticks.test.ts` (10 tests).
- **Phase 5** (`packages/core/src/viewport/axes.ts`, new): `YAxisRegistration`, `AXIS_SIDE_LEFT`,
  `createAxisTransforms`. Barrel exports wired (`viewport/index.ts`, `src/index.ts`,
  `export-surface.test.ts` extended). Tests: `packages/core/test/viewport/multi-axis.test.ts`
  (11 tests).
- **Phase 6** (`packages/core/test/viewport/gpu-precision.test.ts`): f64 storage anti-regression,
  naive-vs-prescribed `Math.fround` error comparison. One design.md numeric claim corrected during
  implementation: at a telecom-band magnitude (~1550, the design's own worked example), IEEE-754
  float32's ~24-bit significand caps the worst-case rounding error at ~0.1–0.2 picometres — it can
  **never** exceed 1 picometre at that magnitude, contradicting task 6.3's literal ">1pm" assertion
  at that fixture. Verified by direct computation (documented inline in the test file). Per task
  6.4's own explicit fallback instruction ("the test's numeric fixture needs adjustment... not the
  assertion"), the fixture's absolute magnitude was raised (~50,000) purely to exercise the same
  underlying float32-rounding defect the obligation is about — the prescribed path's error still
  stays governed only by the visible span, independent of that magnitude choice, so the "prescribed
  stays sub-picometre" half of the proof is unaffected by which origin magnitude is used to
  demonstrate the naive failure.
- **Phase 7 checkpoint**: `turbo run typecheck --filter=@trace-kit/core` clean;
  `turbo run lint --filter=@trace-kit/core` clean (fixed two lint findings in the new test file:
  an unused import, an unnecessary type assertion); full `core` vitest project: **266/266 passing**;
  DOM-global grep clean (only false-positive substring matches inside the word "documented");
  `any`/`as never` greps clean. Also fixed `packages/core/SIDE_EFFECTS_AUDIT.md`, which has its own
  test asserting it lists every `src/` file — added the new `axes.ts` entry.
- **Phase 8** (`packages/renderers/src/canvas2d/axes.ts`): `computeAxisInsets(style, axes,
  yAxisCount)` widened — `insetLeft = yAxisCount * perAxisGutter`; every existing call site
  (renderer + tests) updated to pass `1` for the default single-axis case (byte-identical result).
- **Phase 9** (`packages/renderers/src/canvas2d/{axes,canvas2d-renderer}.ts`): split `drawGrid`/
  `drawAxes` into `drawXGridlines`/`drawYGridlines`/`drawBottomAxis`/`drawLeftAxis` (kept as thin
  compositions for the single-axis case, so the byte-identical-call-sequence test needed no
  change), added `selectYTicks` (dispatches `selectLogTicks`/`selectTicks` by
  `transform.yScaleKind`). `Canvas2DRenderer` gained an optional `yAxes` constructor option
  (`readonly YAxisRegistration[]`); default (`undefined`) synthesizes one implicit linear left axis
  from `setDomain`'s `yMin`/`yMax`, verified byte-identical to the pre-change call sequence by a
  direct two-renderer comparison test. Per-axis tick storage (`Float64Array(MAX_TICKS)` ×
  `yAxisCount`, allocated once at construction) and `render()` now iterates N transforms for
  gridlines/axis labels within the fixed background→gridlines→trace→axes pass order. Tests:
  extended `packages/renderers/test/node/axes-grid.test.ts` (+9 tests: 2 inset-scaling tests, 4
  N-axis rendering tests).
- **Phase 10 checkpoint**: `turbo run typecheck`/`lint --filter=@trace-kit/renderers` clean; full
  `renderers`+`renderers-dom` vitest projects: **67/67 passing**. Full workspace run (`core` +
  `renderers` + `renderers-dom` + `playground`): **378/378 passing**.
- **Phase 12** (bookkeeping): `openspec/roadmap.yaml`'s `scale-linear-transform` removal was already
  present in the working tree before this session (pre-existing uncommitted edit) — confirmed it
  matches task 12.6's requirement, no further edit needed. Added
  `.changeset/quiet-owls-scan.md` (patch bump, both packages). Full-workspace
  `turbo run typecheck`/`lint`/`build`: clean. Full-workspace `any`/`as never` grep: clean.

## What's NOT done — Phase 11 (visual goldens), and why

Task 11.1 explicitly requires running the visual suite "on `ubuntu-latest` or an equivalent pinned
environment." This apply session is running on **macOS (Darwin)**, confirmed via `uname -a`. The
visual test file itself (`packages/renderers/test/visual/canvas2d.visual.test.ts`) is written to
`it.skipIf(!__TRACEKIT_VISUAL_IS_LINUX_CI__)` — i.e. it **structurally skips everywhere except
Linux**, by the design this change itself is extending (`visual-golden-corpus`'s own
platform-skip requirement, carried over verbatim). This is not a gap in this environment's
tooling that could be worked around; it is the visual suite correctly refusing to run somewhere
its goldens are not valid, exactly as `design.md`/the spec require.

Concretely, this means tasks 11.1 through 11.7 cannot be executed for real in this session:
- 11.1/11.2/11.7 (zero-diff sweep over existing goldens) cannot run — no comparison happens on
  macOS, so there is nothing to observe pass or fail.
- 11.3/11.5 (new failing-golden test cases for log-axis and dual-axis figures) could be added as
  inert (always-skipped-here) test scaffolding, but doing so without ever seeing them fail for the
  right reason, or ever generating a real golden, would not satisfy the RED step honestly — and
  more importantly the visual test harness renders through `Canvas2DRenderer` constructed directly
  from `SCENARIO_FIXTURES` (`packages/renderers/src/fixtures/scenarios.ts`), which has no
  log-axis/dual-axis fixture today; adding one is itself real, reviewable production-adjacent work
  that deserves to be exercised, not written blind.
- 11.4/11.6 (generate and commit the golden PNGs via the designated golden-update invocation)
  categorically require a real Chromium render on `ubuntu-latest` — there is no way to produce a
  correct, committable golden from this session.

I did not fabricate a golden, did not disable the platform skip, and did not mark these tasks
done. Task 12.3's literal wording ("confirm all projects pass, including the visual suite's
goldens... on `ubuntu-latest`") and 12.8's cross-check against `visual-golden-corpus` are marked
`[~]` (partial) rather than `[x]` for the same reason — everything checkable from this machine is
green, but the visual-golden-corpus half of the contract needs a Linux CI run to close.

## Recommended next step

Run this same `sdd-apply` session (or a fresh one) on `ubuntu-latest` CI (or an equivalent Linux
box) to execute Phase 11 for real: 11.1/11.2 first (zero-diff regression gate on the two
pre-existing goldens, which must stay byte-identical since the linear-path coefficients and
expression are unchanged), then add the two new `SCENARIO_FIXTURES` entries (log-axis,
dual-axis) and their `canvas2d.visual.test.ts` cases, generate+commit their goldens via the
repository's designated golden-update invocation, then re-run 11.7 and the full 12.1–12.4
verification block on that platform before recommending archive.

## Phase 11 resumed (this session)

- 11.1 marked `[x]`: per the user's confirmation, the full Linux CI run at current `main` HEAD
  was green across all 5 pre-existing goldens (`axes-grid.png`, `decimation-minmax.png`,
  `noise-floor.png`, `resonance-peak.png`, `simple-trace.png`). This is the one task in this
  batch verified by an external CI run, not by this session directly — no local execution of the
  real comparison was possible (macOS host, `__TRACEKIT_VISUAL_IS_LINUX_CI__` false).
- 11.3 and 11.5 marked `[x]`: added two new RED cases to
  `packages/renderers/test/visual/canvas2d.visual.test.ts` —
  - `log-axis`: single `Y_SCALE_KIND_LOG` axis, domain `[1, 1000]` (3 decades), driven through
    `Canvas2DRenderer`'s real `yAxes` constructor option (not a hand-rolled mock), rendering a
    deterministic xorshift32 exponential-sweep payload so decade thinning and mantissa minors are
    both visible.
  - `dual-axis`: two left-stacked `YAxisRegistration`s (one `Y_SCALE_KIND_LOG` `[1,1000]`, one
    `Y_SCALE_KIND_LINEAR` `[-1,1]`) via `createAxisTransforms`'s real multi-axis entry point
    (through the renderer's `yAxes` option, never two single-axis transforms glued together by
    hand), proving the gutter-stacking arithmetic renders correctly.
  Both cases follow the file's existing `it.skipIf(!runsWhereGoldensAreValid)` house style
  exactly, no golden committed yet, confirmed locally to report **skipped**, not passed
  (`vitest run --project visual` → `7 skipped (7)`, up from 5).
- Verified locally: `pnpm exec turbo run typecheck --filter=@trace-kit/renderers` and
  `pnpm exec turbo run lint --filter=@trace-kit/renderers` both pass on the modified file. No
  `any`/`as never` introduced, no SDD-artifact-name references in the added comments.
- 11.2 left unchecked (its condition — a non-zero diff on 11.1 — did not occur, nothing to do).
- 11.4, 11.6, 11.7 left unchecked — they require the actual `ubuntu-latest`
  `workflow_dispatch`-triggered golden-generation run described below. Not attempted, not
  simulated.

### Exact next steps (GitHub Actions, in order)

1. Push this commit to `main`.
2. From the Actions tab, manually dispatch **Update Visual Goldens**
   (`.github/workflows/update-visual-goldens.yml`), entering a `reason` such as "generate
   log-axis and dual-axis goldens for core-scale-transforms".
3. Confirm that workflow's "Guard — the diff must touch only `__screenshots__/`" step passed
   (nothing outside the golden images changed).
4. Confirm the two new PNGs landed in
   `packages/renderers/test/visual/__screenshots__/` (expected stems: `log-axis`, `dual-axis`).
5. Re-run the ordinary `CI` workflow (the push already triggers it, or re-run manually) and
   confirm `Visual regression tests` passes clean — all 7 cases actually compared, not skipped.
6. Only then mark 11.4, 11.6, 11.7 (and 12.3/12.8) done and proceed toward `/sdd:verify`.
