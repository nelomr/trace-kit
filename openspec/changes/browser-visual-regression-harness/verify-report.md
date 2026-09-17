# Verification Report: browser-visual-regression-harness

## Summary

| Check | Status | Notes |
|---|---|---|
| Completeness | PASS | 57/60 tasks done; 3 deliberately open (10.13, 10.20, 10.21 — blocked on an outward-facing CI trigger the session did not take, per resume-apply.md) |
| Scenario Compliance | PASS WITH WARNINGS | All 6 spec deltas mapped to concrete evidence; 1 config drift (`turbo.json` `test:visual`) found against `design.md` D5 |
| Design Coherence | PASS WITH WARNINGS | D1–D9, D13 confirmed in code; D5 (turbo task shape) drifted from its documented spec |
| TraceKit Architecture | PASS | Zero `any` in `packages/*/src`, zero DOM refs in `packages/core/src`, `sideEffects: false` on both packages, zero-copy fixtures |
| Build & Tests | PASS | build/typecheck/lint/test all green; visual suite correctly skips off-Linux (5 skipped, not failed) |

## Commands Run (real output, this session)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Exit 0. Lockfile up to date, resolution skipped. (Used `--frozen-lockfile` because the lockfile was current — no fallback needed.) |
| `pnpm exec turbo run build` | Exit 0. 3/3 tasks successful (`core`, `renderers`, `playground` build). Full Turbo (cache hit on 2, fresh on core). |
| `pnpm exec turbo run typecheck` | Exit 0. 5/5 tasks successful. |
| `pnpm exec turbo run lint --force` | Exit 0. 6/6 tasks (cache bypassed as instructed — no hidden failures). |
| `pnpm run test` | Exit 0. `core`: 42 test files / 204 tests passed. `playground`: 18 files / 45 tests passed. `renderers` (node+dom): 14 files / 61 tests passed. `renderers:test:visual`: 1 file skipped (5 tests skipped) — expected: `it.skipIf(!__TRACEKIT_VISUAL_IS_LINUX_CI__)` correctly short-circuits on this non-Linux dev machine (`packages/renderers/test/visual/canvas2d.visual.test.ts:24-26`). |
| `pnpm --filter @trace-kit/core typecheck:test` | Exit 0, no diagnostics. |
| `pnpm --filter @trace-kit/renderers typecheck:test` | Exit 0, no diagnostics. |
| `node scripts/verify-turbo-ran.mjs test` | `OK: "test" is runnable.` Exit 0. |
| `node scripts/verify-turbo-ran.mjs test:visual` | `OK: "test:visual" is runnable.` Exit 0. |
| YAML parse of `ci.yml` and `update-visual-goldens.yml` | Both parse cleanly (Python `yaml.safe_load`). |

Known flake noted per instructions: `apps/playground/test/node/buffer-reuse.test.ts` ran green in this session's single pass; the documented ~1-in-4 intermittency was not triggered here but is not re-litigated per the maintainer's recorded decision.

## Compliance Matrix (condensed — full per-requirement detail gathered via delegated code reading)

| Capability | Requirement/Scenario | Result | Evidence |
|---|---|---|---|
| browser-visual-regression | Real-browser rasterizer, Chromium only, no `environment` key on browser project | PASS | `vitest.config.ts:92-144` (`visual` project, `browser.instances: [{browser:"chromium"}]`, no `environment` key) |
| browser-visual-regression | Mismatch-ratio comparison, not byte equality | PASS | `vitest.config.ts:119-124`: `pixelmatch`, `threshold:0.1`, `allowedMismatchedPixelRatio:0.001` — matches design D2 |
| browser-visual-regression | Failing comparison writes a named diff artifact | GAP (known/deliberate) | Config path exists (`resolveDiffPath`, `vitest.config.ts:131-139`; CI upload step in `ci.yml`), but never exercised against a real committed golden — task 10.13 explicitly `[ ]` for the reason stated in the brief |
| ci-quality-gate | Visual suite resolving to 0 tests fails CI (anti-vacuity) | PASS | `.github/workflows/ci.yml` step parses `--reporter=json`, exits 1 if `numPassedTests+numFailedTests===0` |
| ci-quality-gate | Playwright browser installed non-best-effort, cached | PASS | `ci.yml`: `actions/cache@v6` on `~/.cache/ms-playwright` + `playwright install --with-deps chromium`, no `continue-on-error` |
| ci-quality-gate | `pnpm run test` reaches the visual suite | PASS | `turbo.json`: `"test": {"dependsOn":["build","test:visual"]}` |
| ci-quality-gate | No repo-caused deprecation warnings leak into CI | PASS | `ci.yml` greps `[DEP####]`, allowlists only `DEP0169` (pnpm's own, unrelated to this change) |
| render-scenario-fixtures | Exactly 5 backend-agnostic fixtures, importable via `@trace-kit/renderers/fixtures` | PASS | `packages/renderers/src/fixtures/scenarios.ts:43-54` (no backend field), `scenario-fixtures.test.ts` asserts `length === 5` |
| render-scenario-fixtures | Fixture table matches design D7 exactly (ids/viewport/dpr) | PASS | See dedicated section below — exact match, no discrepancy |
| test-harness | Fifth vitest project added, four pre-existing unchanged | PASS | `vitest.config.ts` has exactly 5 projects; `core`/`playground`/`renderers`/`renderers-dom` environments (`node`/`happy-dom`/`node`/`happy-dom`) unchanged; only `visual` lacks `environment` |
| visual-golden-corpus | Goldens are CI-generated only, no local `--update` path | PASS | Repo-wide grep for `--update` hits only `.github/workflows/update-visual-goldens.yml` (executable) plus prose in `design.md`/`tasks.md`/`resume-apply.md` |
| visual-golden-corpus | Self-hosted default font | PASS | `packages/renderers/src/style.ts:39`: `font: '10px "TraceKit Inter"'` |
| visual-golden-corpus | Off-Linux skip with explicit message | PASS | `canvas2d.visual.test.ts:24-26`, driven by `__TRACEKIT_VISUAL_IS_LINUX_CI__` Vite `define` |
| visual-golden-corpus | Flat filenames, no OS/browser token | PASS | `vitest.config.ts` `resolveScreenshotPath`/`resolveDiffPath` build `<dir>/__screenshots__/${arg}${ext}` with no platform interpolation |
| visual-golden-corpus | Golden update is an explicit, reviewable act (D6) | PASS | `update-visual-goldens.yml`: `workflow_dispatch` + required `reason` input recorded in the commit message, inline `--update`, `git diff --exit-code` guard restricted to non-golden paths, pushed as one bot-authored, fixed-message commit — distinct from any ordinary test invocation. No PR/CODEOWNERS gate: superseded after the maintainer stated this repository has no PR-review workflow at all until 1.0.0, and the requirement's own scenarios ask for a separate, attributable invocation, not a mandatory approval step. |
| workspace-toolchain | Dependency bumps per D9/freshness policy | PASS (narrative, not independently re-run) | `resume-apply.md` commits 1-8 document exact exit criteria per bump; `scripts/check-dependency-freshness.mjs` present and new |

Requirement-level counts: all 33 requirements across the six spec files were traced to concrete evidence except the diff-artifact scenario under `browser-visual-regression`, which is config-verified only (consistent with the three deliberately open tasks) — 32/33 fully evidenced, 1 config-only/deferred-to-CI.

## D7 Fixture Table Cross-Check

`design.md` lines 708-712 specify the five-fixture table. `packages/renderers/src/fixtures/scenarios.ts:142-183` matches exactly:

| id | viewport | dpr | Match |
|---|---|---|---|
| `simple-trace` | 800×400 | 2 | ✓ |
| `axes-grid` | 800×400 | 2 | ✓ |
| `resonance-peak` | 800×400 | 2 | ✓ |
| `noise-floor` | 800×400 | 2 | ✓ |
| `decimation-minmax` | 800×400 | 1 (the one exception) | ✓ |

No mismatch found.

## TraceKit Non-Negotiables

- **Zero `any`**: `grep -rnE ': any\b|as any\b|<any>|, any>|as never' packages/core/src packages/renderers/src` — no matches (excluding generated `.d.ts`). PASS.
- **Isomorphic core**: `grep -rnE '\bdocument\b|\bwindow\b|HTMLCanvasElement' packages/core/src` — no matches. PASS.
- **`sideEffects: false`**: present in both `packages/core/package.json:10` and `packages/renderers/package.json:10`. PASS.
- **Zero-copy fixtures**: `scenarios.ts` builds each `SpectrumDataPayload` once at module load via `createSpectrumDataPayload`/typed arrays, no per-import re-allocation (module-level `const`, single evaluation). PASS.

## Issues Identified

- **WARNING — `turbo.json` `test:visual` task drifted from `design.md` D5.**
  `design.md` §D5 specifies:
  ```json
  "test:visual": { "dependsOn": ["build"], "inputs": ["src/**", "test/visual/**", "../../vitest.config.ts", "../../pnpm-workspace.yaml"], "outputs": [] }
  ```
  with explicit rationale: *"`outputs: []` is deliberate: the only file a visual run writes is a failure diff, and a failing task is never cached."*
  The actual `turbo.json` (read directly, lines 14-17) is:
  ```json
  "test:visual": { "dependsOn": ["build"], "outputs": ["test/visual/__screenshots__/__diffs__/**"] }
  ```
  This has no `inputs` array at all (design specified four literal entries) and declares the diff directory as a cacheable *output* — the opposite of D5's own stated intent. `resume-apply.md`'s commit-10 narrative mentions wiring `test:visual` into `test`'s `dependsOn` but is silent on `inputs`/`outputs`, so the drift was never called out or reconciled against the design decision it should implement. This does not currently break CI (no test failure was observed from it, and Turbo still runs the task), but it is a real inconsistency between an approved design decision and the shipped config, and should be reconciled — either fix `turbo.json` to match D5, or update `design.md` to reflect the intentional change and explain why.

- No other CRITICAL or WARNING findings. The three open tasks (10.13, 10.20, 10.21) are correctly left unchecked and are legitimately blocked on an outward-facing CI action (triggering `update-visual-goldens.yml` via `workflow_dispatch` and pushing/committing the resulting goldens), not on any defect in this session's work.

## Final Verdict: PASS WITH WARNINGS

The implementation satisfies all six capability spec deltas with concrete, traceable evidence; all live verification commands (install, build, typecheck, lint --force, test, typecheck:test ×2, verify-turbo-ran ×2, YAML parse ×2) pass with exit code 0. The three open tasks are a documented, legitimate blocker outside this session's authority, not a defect. One real drift was found — `turbo.json`'s `test:visual` task does not match `design.md` D5's `inputs`/`outputs` specification — and should be reconciled before or shortly after archive.

---

## Post-verification resolution (same session, after this report was written)

Both issues this report raised were investigated and closed. Neither was waved through.

### 1. `turbo.json` D5 drift — **real defect, fixed**

The report was right, and the defect was worse than cosmetic. The implemented task was:

```jsonc
"test:visual": { "dependsOn": ["build"], "outputs": ["test/visual/__screenshots__/__diffs__/**"] }
```

against D5's specified:

```jsonc
"test:visual": {
  "dependsOn": ["build"],
  "inputs": ["src/**", "test/visual/**", "../../vitest.config.ts", "../../pnpm-workspace.yaml"],
  "outputs": []
}
```

The missing `inputs` was the substantive half. `../../vitest.config.ts` lives **outside** the
package, so Turborepo's default input hashing — which is package-scoped — never saw it. A change
to the `visual` project's own configuration (its comparator thresholds, its `define`, its browser
provider) would not have busted the `test:visual` cache.

Fixed to match D5 exactly, then verified by measurement rather than by reading:

- `pnpm exec turbo run test:visual --filter=@trace-kit/renderers` twice → `cache miss, executing`
  then `cache hit, replaying logs`, establishing the baseline.
- Appending one line to `vitest.config.ts` → `cache miss, executing`. Before the fix this would
  have been a hit. The probe line was then removed.
- `node scripts/verify-turbo-ran.mjs test:visual` still exits 0; `turbo run test --dry=json` still
  lists the task with `outputs: None` (i.e. `[]` applied).

### 2. Second drift, found while reconciling the first — **design amended, not the code**

`ci.yml` installs Chromium with `pnpm --filter @trace-kit/renderers exec playwright install
--with-deps chromium`, while D5 specified the bare `pnpm exec playwright install --with-deps
chromium`. Here the **implementation is correct and the design was wrong**: `playwright` is a
devDependency of `packages/renderers` only, so the bare root form fails with
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "playwright" not found` — reproduced directly during
apply, which is why the `--filter` form was written. `design.md` D5 has been amended to record the
correction and its evidence, so the two no longer disagree.

### 3. A documented figure found to be stale — **corrected**

Not raised by this report, but found while re-running the suite afterwards. The known
`buffer-reuse.test.ts` zero-GC flake was documented as "~1 run in 4". Re-measured on the same
machine against the same code: **17 of 26 runs failed (~65%)**. The rate is not a stable property
of the test. Every place that quoted the old figure (the test's own comment, `tasks.md`,
`resume-apply.md`) now records both measurements and states plainly that any quoted rate is a
snapshot. The maintainer's decision to leave the flake documented rather than chased further
stands; only the false figure was corrected.

### Verification state after these changes

`turbo run build`, `turbo run typecheck`, `turbo run lint --force`: all green.
`pnpm run test`: green except the documented `buffer-reuse.test.ts` flake above.
Task count unchanged: 57/60, with 10.13/10.20/10.21 still genuinely blocked on a real CI run.

### 4. Full deprecation/warning sweep, at the maintainer's request — **clean, nothing to fix**

Re-ran every verification command with a fully cleared cache and inspected raw output for any
`warn`/`Warning`/`[DEP####]` string, plus a dedicated `pnpm install --frozen-lockfile` check:

| Command | Warnings found |
|---|---|
| `pnpm exec turbo run build --force` | none |
| `pnpm exec turbo run typecheck --force` | none |
| `pnpm exec turbo run lint --force` | none |
| `pnpm run test` | none |
| `pnpm install --frozen-lockfile` | `DEP0169` only |

`DEP0169` is the one already known, already-allowlisted case (P9's own CI gate names it
explicitly): it fires from pnpm 9.15.4's own internal `url.parse()` usage, confirmed by locating
the pnpm binary itself (`/Users/nelo/.nvm/versions/node/v24.16.0/bin/pnpm`, a standalone install
outside this repo's `node_modules`) — not repository code, and it never appears during
typecheck/lint/build/test, only during `install`.

The only way to remove it would be bumping pnpm itself — checked, the current release line is
`12.4.x`, three majors ahead of the pinned `9.15.4`. That is out of scope for this change
(a package-manager major bump is its own decision, with its own lockfile-format risk) and was not
done.

**Conclusion: nothing further was fixable within this change's scope.** The workspace is clean of
every warning this session's tooling can produce, beyond the one already-documented, already
-allowlisted, non-repository case.

### 5. Full CI job walkthrough (not just the four commands) — one real defect found, fixed

The maintainer asked to confirm CI would not fail on anything within our control, which prompted
walking `.github/workflows/ci.yml` step by step rather than re-running the four verification
commands alone.

**Confirmed, expected**: the "Visual regression tests" step will fail 5/5 on the very first push
of this branch, since no golden PNGs are committed yet (10.20 is genuinely blocked). Simulated by
temporarily forcing the platform `define` to `true` locally; the anti-vacuity check's own logic
(`numPassedTests + numFailedTests > 0`) would correctly pass if reached, but the job halts one
step earlier since "Visual regression tests" carries no `continue-on-error`. This is the intended
bootstrap sequencing, not a defect.

**Real defect found while explaining that sequencing**: `update-visual-goldens.yml` always opened
its resulting PR against `main`, regardless of which branch it was dispatched against — which
contradicted D6's own already-written operator workflow and left this exact change's own open PR
with no direct path to receive its goldens. Fixed: the workflow now branches on `github.ref_name`
— dispatched against `main`, unchanged (separate PR); dispatched against any other branch, it
pushes the regenerated PNGs directly onto that branch. `design.md` D6 and `tasks.md` 10.18
corrected to match. See `resume-apply.md`'s "Post-verify follow-up" section for full detail.

**Not verifiable locally, flagged rather than assumed**: `playwright install --with-deps`
invokes `apt-get` under the hood, a Linux-only code path that cannot be exercised on this
(macOS) machine. It is the standard, widely-documented invocation for GitHub-hosted
`ubuntu-latest` runners; risk is assessed as low but this specific path was not executed.

### 6. Maintainer stated the project's real delivery practice — golden-update mechanism simplified again

While explaining the CI sequencing above, the maintainer stated plainly: this repository commits
directly to `main` with no PR-review workflow at all, until 1.0.0. That is new information this
change's own artifacts didn't have — `preproposal.md`'s delivery strategy (`exception-ok`, single
PR) describes how *this specific change* lands, not the project's ongoing steady-state practice.

Two things built against an assumed PR workflow were corrected to match:

- `update-visual-goldens.yml` now always pushes the regenerated PNGs directly onto whichever ref
  it was dispatched against (`main` included) — no PR, ever. The earlier `main`-vs-`branch`
  distinction (section 5, above) is now moot; both paths behave identically.
- `.github/CODEOWNERS` was removed. A required-review entry has nothing to attach to with no PR
  to open — it would have been decorative.

Checked against the spec itself before removing anything: `visual-golden-corpus`'s "A Golden
Update Is an Explicit, Reviewable Act" requirement asks for a separate, attributable invocation
distinguishable from an ordinary test run — not a mandatory human-approval gate. Both of its
scenarios remain satisfied: the ordinary `test:visual` path still cannot write a golden, and
`update-visual-goldens.yml` is still the one, separately-named, `workflow_dispatch`-only path
that can. `design.md` D6, its File Changes table, and its R5' risk row updated; `tasks.md` 10.18
and 10.19 updated (10.19 now records CODEOWNERS as written-then-reversed, with why).
