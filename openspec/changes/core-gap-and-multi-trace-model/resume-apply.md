# Resume: core-gap-and-multi-trace-model

**Progress:** 50/52 tasks complete. Only 11.3 and 11.4 (golden PNG generation/verification) remain,
both explicitly gated to Linux CI by this project's own visual-regression design and therefore not
executable in this (macOS) environment.
**Last Updated:** 2026-09-28

## Completed Tasks — Blocks 1–10, 12, 13.1–13.4 (all [x] in tasks.md)

See the earlier checkpoint note (still accurate) for Blocks 1–4. Summary of everything landed
since then:

### Block 6 — `buildTracePath` break idiom
- `packages/renderers/src/path/build-trace-path.ts`: pen-state walk (D5) — `indices[i] < 0`
  (decimated break) or `y[j] !== y[j]` (direct-path gap) lifts the pen; gap-free input reduces to
  the archived one-`moveTo`-then-`n-1`-`lineTo` sequence byte-for-bit (confirmed via the file's
  own SHA-256 regression-guard hash in `work-counts.test.ts`, recaptured for the new body).
- Extended `build-trace-path.test.ts` (11 tests) and `allocation-gate.test.ts` (gapped-input
  zero-GC for both the decimated and direct-range paths).

### Block 7 — Isolated-sample markers (pure walk)
- New `packages/renderers/src/path/isolated-markers.ts`: `MarkerSink`, `countIsolatedSegments`,
  `buildIsolatedMarkers` per D10.
- New `isolated-markers.test.ts` (11 tests: direct/decimated/min-max isolation cases, exact
  `rect` geometry, zero-GC).

### Block 8 — `TraceDrawingContext` extensions
- `setLineDash(segments)` and `fill(path)` added to `packages/renderers/src/surface.ts`; every
  fake-context test double across the renderers test suite updated to implement them.
- `TRACE_PALETTE` (frozen, renderer-owned) added to `packages/renderers/src/style.ts` and
  exported from the package's `index.ts`.

### Block 9 — `Canvas2DRenderer` per-trace state and `setTraces`
- `FigureRenderer.setTraces(collection)` added to the interface (now 11 members); every fixture
  implementing it updated (`figure-renderer-shape.test{,-d}.ts`, `scenario-fixtures.test.ts`).
- `Canvas2DRenderer`: new `setTraces()` builds parallel per-trace columns (axis index, index
  buffers, decimated count, memo columns, resolved style, transforms with each trace's own
  `xOrigin`, isolated count) — all allocated in `setTraces`, never in `render()`. `setData()` is
  unchanged and mutually exclusive with `setTraces()` (each clears the other's state) rather than
  literally sharing one code path — a deliberate, lower-risk deviation from the design's "internal
  one-entry-collection" phrasing that keeps every pre-existing single-trace test and golden
  byte-for-bit unaffected while still satisfying the same observable contract.
- Per-trace `render()` loop: one `Path2D` per trace, per-trace `strokeStyle`/`lineWidth`/
  `setLineDash`, D3's infeasible-LTTB → `minMaxEnvelopeIndices` fallback (memoized under the same
  `lttb` key), conditional isolated-marker `Path2D` + `fill`.
- New `packages/renderers/test/node/canvas2d-renderer.test.ts` (12 tests): Path2D-per-trace
  count, single `setTransform`/frame, per-trace memo isolation (a revision bump on one trace
  doesn't re-decimate its sibling; 60 unchanged renders → 1 `lttb` call per trace), the D3
  fallback (1 `minMaxEnvelopeIndices` call, memoized on the next frame), marker call-sequence
  and opt-out scenarios, two-trace zero-GC including markers.

### Block 10 — Renderers layer gate
- `typecheck`/`lint`/`test` all green for `@trace-kit/renderers`; `any` grep clean.

### Block 11 — Visual goldens (PARTIAL — see below)
- 11.1 done: `gapped-trace` fixture (leading/interior/trailing gap + one isolated sample) added
  to `packages/renderers/src/fixtures/scenarios.ts`; `scenario-fixtures.test.ts` updated to 6
  entries.
- 11.2 done: `overlay-two-axis` scenario (two traces, two Y axes — linear + log, distinct colors,
  one dashed, distinct `xOrigin`s) added to `packages/renderers/test/visual/canvas2d.visual.test.ts`,
  following the file's existing one-off-scenario pattern (`log-axis`/`dual-axis`).
- **11.3/11.4 NOT done.** This repo's own visual-regression design (`vitest.config.ts`'s
  `__TRACEKIT_VISUAL_IS_LINUX_CI__` define, and every visual test's `it.skipIf`) restricts golden
  generation and comparison to `ubuntu-latest` CI specifically because Chromium's font/AA
  rasterization is not byte-identical across host OSes — generating a golden on this (macOS)
  machine would silently create a non-matching reference nobody else's CI run would ever match,
  which the codebase explicitly calls out as the failure mode this restriction exists to prevent.
  I confirmed the visual test file collects and runs cleanly (`vitest --project visual` → 9 tests,
  all correctly skipped locally, no collection/type errors), so the new scenarios are load-bearing
  and ready, but the actual PNG generation and zero-diff confirmation must happen in CI.

### Block 12 — Changeset
- `.changeset/core-gap-and-multi-trace-model.md`: patch bump for `@trace-kit/core` and
  `@trace-kit/renderers`. `pnpm exec changeset status` confirms it resolves correctly.

### Block 13 — Final verification gate (13.1–13.4 done; 13.5 partial, see below)
- 13.1: `grep -rnE ': any|as any|<any>'` and `grep -rn ', any>'` both empty across
  `packages/core/src` and `packages/renderers/src`.
- 13.2: `allocation-gate` tests green across the whole repo (core + renderers).
- 13.3: `lttb-gaps min-max-gaps lttb-gapfree-golden build-trace-path` all green.
- 13.4: `pnpm exec turbo run typecheck` / `lint` / `pnpm run test` / `pnpm exec turbo run build`
  all green across the full monorepo (core 311 tests, renderers 101 tests + 9 correctly-skipped
  visual, playground 45 tests). One ripple fix was needed outside this change's stated file scope:
  two `apps/playground` DOM test fixtures (`core-math-controls.test.ts`,
  `core-math-teardown.test.ts`) implement `TraceDrawingContext` and needed `setLineDash`/`fill`
  stubs added to keep typechecking after the Block 8 interface widening — a required, mechanical
  ripple fix, not a scope violation.
  Note: a single full-repo `pnpm run test` run showed 3 transient failures (two ESLint
  child-process meta-test timeouts, one GC-flake in a gapped-input allocation gate) under full
  concurrent CPU load; both the core suite alone and a second full-repo run immediately after came
  back 100% green, confirming these were environmental flakiness (the allocation-gate test file's
  own comments already document exactly this risk under full-monorepo concurrency), not a
  regression from this change.
- 13.5 (manual cross-check against `proposal.md` Success Criteria): all criteria are met except
  the golden-image ones, which are blocked on CI per the above:
  - [x] No decimator output or rendered path segment spans a source `NaN` — property-tested
    (`lttb-gaps.test.ts`, `min-max-gaps.test.ts`, `build-trace-path.test.ts`).
  - [x] Gap-free LTTB/min-max output is identical to the pre-change output — golden-fixture tests.
  - [x] Two traces with distinct X grids render against one X domain on two Y axes — proven by
    unit test (`canvas2d-renderer.test.ts`) and by the CI-gated overlay visual scenario using two
    distinct `xOrigin`s.
  - [x] Zero-GC gate passes for gapped input in both decimators and the per-trace render loop.
  - [x] Every isolated sample is visible as a marker by default; gap-free draws none.
  - [ ] Existing goldens show zero diff; new gapped/overlay goldens added — **blocked on CI**.
  - [x] `pnpm exec turbo run typecheck lint build` and `pnpm run test` pass; no `any` introduced.

## Next Task

None from this agent's side pending CI. On a Linux CI run (or a maintainer's Linux machine): run
the `visual` vitest project to generate `gapped-trace` and `overlay-two-axis` goldens plus confirm
every pre-existing golden is zero-diff, then check off 11.3/11.4.

## Notes

- Comment discipline followed throughout: no `design.md`/`proposal.md`/`tasks.md`/D-id references
  in production code comments anywhere in this change; every comment states the invariant or
  failure mode directly.
- No `any` introduced anywhere (grepped clean, both patterns, every touched package).
- The `setData`/`setTraces` mutual-exclusion design (noted above under Block 9) is the one
  deliberate implementation detail that diverges from design.md's literal wording ("setData
  internally builds a one-entry collection") while preserving its full observable contract; flagged
  here for visibility in case a future change wants the literal unification.
