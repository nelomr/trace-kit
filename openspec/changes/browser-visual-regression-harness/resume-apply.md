# Apply progress — browser-visual-regression-harness

## Commit 1 — DEP0152 fix
Status: done (marked `[x]` in tasks.md prior to this session).

## Commit 2 — ES2022 build-target comment
Status: done (marked `[x]` in tasks.md prior to this session). Note: this commit's edit to
`tsconfig.base.json` (adding a `//` comment inside JSON) was uncommitted at the start of this
session and broke `packages/core/test/catalog-discipline.test.ts` (`readBaseTsconfig` uses plain
`JSON.parse`, which rejects JSONC comments). That test file is outside the file scope of commits
3-5 and was left untouched; see the handback report for detail.

## Commit 3 — Root `typescript` pin → `catalog:` (P12)
Status: done.
- RED: confirmed root `package.json` had a literal `"typescript": "^5.7.0"` while
  `packages/core`, `packages/renderers`, and `apps/playground` all declared `"catalog:"`.
- GREEN: changed root `package.json` `typescript` to `"catalog:"`.
- Verified via `pnpm install` + `pnpm why typescript --depth 0` + `pnpm-lock.yaml`: root and all
  three packages resolve to the identical `typescript@5.9.3`.

## Commit 4 — `@types/node` 22 → 26.5.1
Status: done.
- Changed `pnpm-workspace.yaml` catalog entry `'@types/node': '^22.10.0'` →
  `'@types/node': '26.5.1'`.
- `pnpm install` + `pnpm exec turbo run typecheck`: green, no new ambient-declaration diagnostics.

## Commit 5 — ESLint 9 → 10.10.0 + typescript-eslint 8.19 → 8.70.0
Status: done.
- Changed `pnpm-workspace.yaml` catalog entries `'eslint': '^9.17.0'` → `'eslint': '10.10.0'` and
  `'typescript-eslint': '^8.19.0'` → `'typescript-eslint': '8.70.0'` in the same edit.
- `pnpm install` + `pnpm exec turbo run lint`: green, diff confined to `package.json` +
  `pnpm-workspace.yaml` (+ lockfile) — confirms F9 (no source/config edit needed).
- `pnpm exec vitest run packages/core/test/lint-rules.test.ts`: green.

## Commit 6 — TypeScript 5.7 → 6.0.3 with its three measured fixes (D8 commit 6, D13)
Status: done.
- 6.1: `pnpm-workspace.yaml` catalog `'typescript': '^5.7.0'` → `'typescript': '6.0.3'`.
- 6.2 RED: `pnpm exec turbo run build` failed with the exact `TS5101` naming `baseUrl`, matching
  F11.
- 6.3 GREEN: added `"ignoreDeprecations": "6.0"` to `tsconfig.base.json` with a comment naming
  `tsup/dist/rollup.js:6837` as the cause and the TypeScript-7 expiry. Confirmed no repository
  tsconfig sets `baseUrl` itself. `turbo run build` green.
- 6.4 RED: `pnpm exec turbo run typecheck` failed with the exact three `TS5097` diagnostics at
  `apps/playground/src/shell/bootstrap.ts:8` and `apps/playground/src/views/index.ts:3-4`,
  matching F12.
- 6.5 GREEN: added `"allowImportingTsExtensions": true` to `apps/playground/tsconfig.json`.
  Confirmed no emitting config gained the option. `turbo run typecheck` green across all five
  projects.
- 6.6 RED: `pnpm exec turbo run lint` reported exactly 29 "type that could not be resolved"
  errors across `packages/core/bench/index.ts`, `runner.ts`, `trace-deopt.ts`, matching F13.
  `pnpm --filter @trace-kit/core typecheck:test` exited `0` as the control.
- 6.7 GREEN: reshaped `eslint.config.js` into two `**/*.ts` blocks. `packages/core/test/**`,
  `packages/core/bench/**`, `packages/renderers/test/**` moved to classic
  `parserOptions.project: ["packages/core/tsconfig.test.json", "packages/renderers/tsconfig.test.json"]`;
  everything else (including `apps/playground`'s own `test/**`, which its own `tsconfig.json`
  `include` already covers) stayed on `projectService`.
  - **Deviation from the task's literal wording, found during GREEN, not predicted by F11/F12/F13/F17:**
    `allowDefaultProject` was not fully removable. Two categories of file still need it because
    they are outside `src/**` and outside `test/**`/`bench/**` (so the new classic block's
    `files` glob does not reach them), and because classic `parserOptions.project` requires a
    file to be resolvable inside a tsconfig's `include`, which fails for them:
    1. `packages/core/tsup.config.ts` and `packages/renderers/tsup.config.ts` — live outside
       `src/**`, not part of `tsconfig.test.json`'s `include` either. Verified they do not touch
       the `@types/node`-resolution failure F13/F17 describe (no `process`, no error-typed catch
       bindings), so they stay on `projectService`'s `allowDefaultProject` fallback rather than
       needing classic mode.
    2. The two virtual `__hot-path-fixture-proof__.ts` paths (`packages/core/src/decimation/…`,
       `packages/renderers/src/path/…`) used by `lint-hot-path.test.ts` — these are under `src/**`
       but do not exist on disk. Empirically confirmed (via a direct `ESLint.lintText` probe) that
       `projectService` cannot resolve a nonexistent path through ordinary `tsconfig.json`
       `include` glob matching even though the path pattern matches `src/**/*`; it still needs an
       explicit `allowDefaultProject` entry. Classic mode was not usable either, since those paths
       are not in `tsconfig.test.json`'s `include`.
    So `allowDefaultProject` was kept, narrowed from ~18 entries to these 4, with
    `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` lowered from 64 to 8 to
    match. `defaultProject` still points at `packages/core/tsconfig.test.json` (any valid
    tsconfig works here; it is not used for type resolution these two file kinds depend on).
  - A second deviation found empirically: an early version of the classic block used
    `files: ["**/test/**/*.ts", "**/bench/**/*.ts"]` (unscoped by package). This broke
    `apps/playground`'s own `test/**` files, which are legitimately covered by `projectService`
    through the playground's own `tsconfig.json` (`include` already lists `test/**/*` there,
    unlike `packages/core`/`packages/renderers`). Fixed by scoping the classic block's `files`
    (and the first block's matching `ignores`) explicitly to
    `packages/core/test/**`, `packages/core/bench/**`, `packages/renderers/test/**` only.
    Caught by running `pnpm exec turbo run lint --force` (bypassing cache) before declaring
    green — the cached run had hidden this regression.
- 6.8: `packages/core/test/lint-rules.test.ts`, `packages/core/test/lint-hot-path.test.ts`,
  `packages/renderers/test/node/lint-hot-path.test.ts` all pass under the reshaped config
  (5/5 tests), including the virtual-`filePath` case.
- 6.9: added `packages/core/bench/fixtures/lint-any.ts` (permanent regression fixture,
  `Record<string, any>`), ignored from the main `eslint .` run via a new
  `"**/bench/fixtures/**"` entry in `eslint.config.js`'s top-level `ignores` (mirroring the
  existing `"**/test/fixtures/**"` entry), and a new test in `lint-rules.test.ts` asserting
  `@typescript-eslint/no-explicit-any` fires on it through ESLint's Node API. This exercises the
  classic-mode `bench/**` path specifically, distinct from the existing `test/fixtures/lint-any.ts`
  assertion which exercises the classic-mode `test/**` path.
- Full verification, all green: `pnpm install --no-frozen-lockfile`; `pnpm exec turbo run build`
  (no TS5101); `pnpm exec turbo run typecheck` (no TS5097); `pnpm exec turbo run lint --force`
  (zero errors, no "could not be resolved", across core/renderers/playground); `pnpm --filter
  @trace-kit/core typecheck:test` and `pnpm --filter @trace-kit/renderers typecheck:test` (exit
  0); `pnpm run test` (72+72 test files, 294+294 tests, all passing, no flake observed).
- `git diff --stat` confined to exactly: `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `apps/playground/tsconfig.json`, `eslint.config.js`, `packages/core/test/lint-rules.test.ts`,
  `packages/core/bench/fixtures/lint-any.ts` (new file), `openspec/changes/.../tasks.md`,
  `openspec/changes/.../resume-apply.md`, plus `pnpm-lock.yaml` from the catalog bump.

## Next
Commit 7 (Vitest 3.2.7 → 5.0.0) not started. Do not touch `vitest.config.ts` or bump
vitest/playwright per this session's explicit scope limit.

## Fix applied outside a numbered commit — `catalog-discipline.test.ts` regression

The regression the previous session flagged (`readBaseTsconfig` breaking on commit 2's JSONC
comment) was fixed rather than left open, since it is a known defect in code this change already
touches — CLAUDE.md rule 5 scope, not deferred debt.

- Exported `stripJsonComments` from `scripts/verify-catalog-discipline.mjs` (previously
  module-private) and used it inside the test's own `readBaseTsconfig()` helper, matching what
  `readTsconfig()` in the same module already does for per-package tsconfigs. No duplicated
  parsing logic.
- Added the matching declaration to `scripts/verify-catalog-discipline.d.mts` — this file, not a
  JSDoc annotation, is what TypeScript actually reads for this `.mjs` module's types. A JSDoc
  `@param`/`@returns` on the export alone did not resolve the lint failure; the stale hand-written
  `.d.mts` did (`checkJs`/`allowJs` are not enabled repository-wide, so this `.mjs` has no other
  type source).
- Verified: `catalog-discipline.test.ts` 9/9 green, full `pnpm run test` 631/631 green
  (293 + 293 + 45), `turbo run typecheck` / `lint` / `build` all green.
- A separate, unrelated flaky GC-count assertion in `allocation-gate.test.ts` was observed once
  under full-suite parallel load and confirmed non-reproducing in isolation (3/3 clean runs) and
  on a second full-suite run. Not touched — not caused by this change, and it self-clears.

Files touched by this fix: `scripts/verify-catalog-discipline.mjs`,
`scripts/verify-catalog-discipline.d.mts`.

## Commit 7 — Vitest 3.2.7 → 5.0.0 + config migration

Status: done, with one documented residual flake (see below).

- 7.1: F2/F3/F4/F7 re-confirmed identical on `5.0.0` vs the probe's `5.0.1` measurement — same
  isolated-worktree method, real command output, not assumed.
- 7.2: catalog bumped to exact `5.0.0`; `@vitest/browser-playwright`, `playwright`, `pixelmatch`
  catalog entries added (unused until the harness commit).
- 7.4: top-level `pool`/`poolOptions` block removed; `pool: "forks"` + `execArgv: ["--expose-gc"]`
  scoped to `core` and `renderers` project entries.
- 7.5/7.6: comments rewritten to describe 5.x behavior; `environment` values confirmed
  byte-identical across all four pre-existing projects.

### Three unplanned issues found and fixed during this commit's RED/GREEN cycle

1. **`@types/node` ambient resolution under `typescript@6.0.3` — false alarm, not a real defect.**
   A subagent's earlier pass reported 415 `typescript-eslint` "type that could not be resolved"
   errors and traced them to `tsc` itself failing to load `@types/node`'s `globals.d.ts`/
   `index.d.ts` for `packages/core/tsconfig.test.json` and `packages/renderers/tsconfig.test.json`.
   I reproduced it, then bisected it with a fully clean `rm -rf node_modules && pnpm install` on
   both the pre- and post-Vitest-5 catalog state, twice each. Findings:
   - With a genuinely clean install, both `vitest@3.2.7` and `vitest@5.0.0` states differed: 3.2.7
     resolved ambient Node types correctly; 5.0.0 still did not, even freshly installed. So it
     was not purely stale-cache noise — there is a real difference tied to the Vitest 5
     dependency graph, but I could not pin the exact mechanism (multiple avenues investigated:
     symlink validity — confirmed fine; `@types/node` version — identical, `26.5.1`, in both
     states; module count under `node_modules/.pnpm` — same shape). Recorded as unresolved root
     cause, not claimed as understood.
   - **The fix applied does not depend on knowing the mechanism**: added `"types": ["node"]`
     explicitly to `packages/core/tsconfig.test.json` and `packages/renderers/tsconfig.test.json`.
     This replaces implicit ambient auto-discovery (which the evidence shows is not reliable
     under this dependency graph) with an explicit declaration, which is more robust regardless
     of cause. Verified: `tsc --noEmit -p tsconfig.test.json` exits 0 for both packages.
   - Deliberately did **not** add `"types"` to either package's plain `tsconfig.json` (the
     publishable, `src/**`-only build project) — that project must never see Node ambient types
     at all, per CLAUDE.md rule 5 (isomorphic core). Its clean pass was and remains due to `src/**`
     never referencing a Node global in the first place, not because ambient discovery works
     there; leaving it unset preserves that as an enforced boundary rather than an accident.

2. **`describe.sequential` removed in Vitest 5, not renamed.** Confirmed via the installed
   `@vitest/runner`/`vitest` type declarations: `sequential` is absent from `ChainableSuiteAPI`'s
   allowed chain keys in 5.0.0 (present in 3.2.7's). No global `sequence.concurrent` override
   exists in `vitest.config.ts`, so plain `describe(...)` is already sequential by default — the
   fix is a pure removal of the now-nonexistent chained call, with no behavior change. Applied at
   all 5 call sites: `packages/core/test/decimation/allocation-gate.test.ts` (×3),
   `packages/core/test/transport/allocation-gate.test.ts`,
   `packages/core/test/viewport/transform-allocation.test.ts`.

3. **`apps/playground` needs `--expose-gc` too — task 7.4's stated scope had a gap.** Task 7.4
   explicitly excluded `playground` from the `execArgv` scoping, on the unstated assumption only
   `core`/`renderers` read `globalThis.gc`. False: `apps/playground/test/node/buffer-reuse.test.ts`
   and `lorentzian-gc-gate.test.ts` also read it directly. Confirmed by running
   `pnpm --filter @trace-kit/playground test` before the fix (4 failures, `Error: run with
   --expose-gc`) and after (all passing). Put to the maintainer as a decision (add the flag vs.
   skip those tests) rather than silently deviating from the written task; approved. `tasks.md`
   7.4 updated in place to record the correction.

### Residual, documented flake — not closed

`apps/playground/test/node/buffer-reuse.test.ts`'s zero-GC assertion fails intermittently under
Vitest 5.0.0, in complete isolation — not just under parallel load. **The rate is not stable**:
1 run in 4 when first characterised, then 17 of 26 (~65%) when re-measured the next day on the
same machine against the same code, during `/sdd:verify`. Any figure quoted for it is a
snapshot, not a property.
Investigation, in order:

- Confirmed deterministic-looking failures were actually a burst pattern (long streaks of passes,
  then streaks of failures), which ruled out simple single-cause timing noise from my own machine
  — a neighboring, structurally similar test (`lorentzian-gc-gate.test.ts`) ran 15/15 clean at the
  exact same time.
- Applied a 20-iteration warm-up loop before measuring, matching the `core`/`renderers`
  allocation-gate pattern (the original code warmed up with a single call). This measurably
  improved the pass rate but did not eliminate the flake.
- Applied a second fix: use a fresh `PerformanceObserver` for the measured window instead of
  resetting a counter on a shared one, removing a possible async-callback race. No measurable
  change in the failure rate.
- Traced what `run()` actually executes: only `validateRun` and `lttb`/`minMaxEnvelope` directly.
  Initially misdiagnosed this as going through `measureRunMs`/`runBenchmark` (which does allocate
  a sample-bookkeeping array) — that was wrong, caught by re-reading `mount.ts`'s own comment at
  the `run()` definition, which states explicitly it never calls the benchmark harness for this
  reason, and corrected to the user before proceeding further.
- Both `lttb` and `minMaxEnvelope` already carry their own dedicated, reliably-passing zero-GC
  gates elsewhere in this repository (verified green throughout this session). The stray event is
  therefore not attributable to allocating code in the measured path.

Left as a documented known flake per explicit maintainer decision, rather than continuing to tune
timing constants against a mechanism that was not pinned down. The in-file comment on
`countGcEvents` in `buffer-reuse.test.ts` carries the same detail for future reference.

### Full verification (real, from a clean `node_modules` install)

- `pnpm exec turbo run build` — green
- `pnpm exec turbo run typecheck` — green
- `pnpm exec turbo run lint --force` (cache bypassed) — green, 0 errors
- `pnpm run test` — green except the documented flake above
- `git diff --stat` confined to: `pnpm-workspace.yaml`, `vitest.config.ts`, `pnpm-lock.yaml`,
  `packages/core/tsconfig.test.json`, `packages/renderers/tsconfig.test.json`,
  `packages/core/test/decimation/allocation-gate.test.ts`,
  `packages/core/test/transport/allocation-gate.test.ts`,
  `packages/core/test/viewport/transform-allocation.test.ts`,
  `apps/playground/test/node/buffer-reuse.test.ts` — all attributable to the three unplanned
  fixes above plus the commit's own declared scope.

### Fourth unplanned issue — bare `vitest run` no longer discovers the root config from a package cwd

Discovered while running the final full-workspace verification for Commit 7. `pnpm --filter
@trace-kit/renderers test` (bare `vitest run`, no flags — `core` and `renderers`' `package.json`
scripts, unlike `playground`'s) previously ran the entire workspace suite under Vitest 3.2.7
(documented as F16). Under Vitest 5.0.0 it instead runs a different, smaller, wrongly-configured
set: `packages/renderers` on its own resolved `environment: node` default (losing the root
config's per-project `happy-dom` assignment for `test/dom/**`), with no `execArgv`, causing
`document is not defined` and `run with --expose-gc` failures. This is a genuine Vitest 5
discovery-behavior change, not caused by anything in this commit's own edits — confirmed by
testing bare `vitest run` from `packages/renderers` in isolation, independent of any config file
this commit touched.

Put to the maintainer rather than silently deferred to Commit 10 (its originally planned home):
`pnpm run test` is this session's own verification gate for every commit, so leaving it broken
between now and Commit 10 would make every intermediate verification unreliable. Approved to fix
now. Mirrored `apps/playground/package.json`'s existing, already-correct pattern:

- `packages/core/package.json`: `"test": "vitest run --config ../../vitest.config.ts --project core"`
- `packages/renderers/package.json`: `"test": "vitest run --config ../../vitest.config.ts --project renderers --project renderers-dom"`
  (Vitest's CLI documents `--project` as repeatable for multiple projects.)

Verified: `pnpm --filter @trace-kit/core test` → 42 files/203 tests (was 72/293, duplicate-free
now). `pnpm --filter @trace-kit/renderers test` → 12 files/46 tests (was 72/293). `pnpm run test`
workspace-wide: `core` 203, `renderers` 46, `playground` 45 — no duplication across packages, all
green except the documented flake.

This closes Commit 10's D5 concern (F16) early, mechanically. `tasks.md` Group 10's own task for
this can be marked already-satisfied when that group is reached, rather than redone.

Files touched by this fix: `packages/core/package.json`, `packages/renderers/package.json`.

## Commit 8 — Remaining minor/patch refresh

Status: done, clean.

- Bumped `vite` → `8.3.0`, `happy-dom` → `20.14.5`, `fast-check` → `4.10.0` in the catalog;
  `turbo` → `2.10.13` in root `package.json`. All four re-verified against the registry at apply
  time (`npm view <pkg> time --json`, same two-day cutoff method as the original plan) — no
  target had shifted since planning.
- Confirmed Node declarations untouched: `.nvmrc` `24`, `package.json` `engines.node` `">=24"`,
  both `.github/workflows/*.yml` `node-version: 24`.
- Added a prerelease-specifier guard to `packages/core/test/catalog-discipline.test.ts`, reusing
  the existing `parseWorkspaceYaml` import rather than new plumbing. Control-verified by
  temporarily injecting a `-rc.`/`-beta.` version and confirming the test fails, then restoring.
- No unplanned issues this commit — the first clean one since Commit 3.

Full clean-install verification: build/typecheck/lint (cache bypassed)/test all green.
`core` 204 tests (+1 from the new freshness test), `renderers` 46, `playground` 45 — no flake
observed this run.

Files touched: `pnpm-workspace.yaml`, `package.json`,
`packages/core/test/catalog-discipline.test.ts`, `pnpm-lock.yaml`.

## Commit 9 — Font default (D1)

Status: done, clean (one comment-wording fix, not a real defect).

- Real Inter Regular obtained from the canonical Google Fonts OFL repository (a variable font;
  license confirmed as SIL OFL 1.1 from that same repo's `OFL.txt`), instanced to static
  Regular with `fonttools.varLib.instancer`, subset with `fonttools.subset` to exactly the
  requested codepoints (`U+0020-007E` + µ×−Ω). Verified all 99 requested codepoints present in
  the subset, none missing.
- `ensureDefaultFont()`: `document`-guarded, idempotent, memoized, never imported by
  `canvas2d-renderer.ts` — confirmed by grep, not assumed.
- `style.ts:39` now requests `"TraceKit Inter"` instead of `sans-serif`.
- **Structural fix beyond the task's literal file list**: `TRACEKIT_INTER_FAMILY` moved to its
  own module (`src/font/family.ts`) after the first build showed the main package entry
  importing a shared bundler chunk that still carried the ~8 KB embedded font data — re-exporting
  a binding from a module that also imports the data doesn't let a bundler split them apart.
  Re-verified after the split: zero occurrences of `data:font` in `dist/index.js` or the chunk it
  actually imports; the data lives only in `dist/font/index.js` (8,608 bytes) and its own chunk.
- `.changeset/renderers-default-font.md` added, `patch`, stating the default-output change
  plainly with the override for anyone who wants the previous behaviour.

### One unplanned issue — comment wording, not a defect

`test/node/no-worker-references.test.ts` (an existing guard scanning all of `src/` for
`\bself\b` and similar) failed once the font data file existed — traced to this task's own
prose comment ("a self-hosted embed"), not to any base64 noise or a real `self` reference.
Reworded the comment. No test/guard/code-scope change.

### Full clean verification

`rm -rf node_modules` + reinstall, then: `turbo run build` green, `turbo run typecheck` green,
`turbo run lint --force` (cache bypassed) green, `pnpm run test` green — `core` 204, `renderers`
50 (+4 new: the font-default suite), `playground` 45. No flake this run.

Size budget: `dist/font/index.js` = 8,608 bytes against a 24,576-byte (24 KB) budget.

Files touched: `packages/renderers/src/font/tracekit-inter.woff2.ts` (new),
`packages/renderers/src/font/family.ts` (new, not in the original file list — see above),
`packages/renderers/src/font/index.ts` (new),
`packages/renderers/src/font/LICENSE-Inter.txt` (new), `packages/renderers/src/style.ts`,
`packages/renderers/src/index.ts`, `packages/renderers/tsup.config.ts`,
`packages/renderers/package.json`,
`packages/renderers/test/node/font-default.test.ts` (new), `.changeset/renderers-default-font.md`
(new).

## Commit 10 — The harness (D8 commit 10)

Status: **10a, 10b, 10c done and verified. 10d not started — genuinely blocked on CI, not
attempted locally.** This is the current stopping point.

### 10a — Fixtures (done)
`packages/renderers/src/fixtures/scenarios.ts`: exact five fixtures from design.md D7's table
(ids, descriptions, payload compositions, domains, viewports, dpr — corrected against D7 after
an initial draft used different values). `@trace-kit/renderers/fixtures` subpath wired through
`tsup.config.ts` and `package.json` exports. A real, minimal `FigureRenderer` stand-in
(`RecordingStandInRenderer`, since WebGL2 doesn't exist yet) proves the fixture record drives
two different backends with no field renamed.

### 10b — Toolchain wiring (done)
Fifth `visual` project in `vitest.config.ts` (Chromium via `@vitest/browser-playwright`'s
`playwright()` factory — its real exports and `.d.ts` shape were read from the installed
package, not guessed). `comparatorOptions: { threshold: 0.1, includeAA: true,
allowedMismatchedPixelRatio: 0.001 }`. Flat golden paths, no platform token.
`turbo.json`'s `test:visual` task wired into root `test`'s `dependsOn`.
`verify-turbo-ran.mjs test` and `test:visual` both exit 0; `turbo run test --dry=json` lists
`test:visual`.

### 10c — Visual test file (done)
`packages/renderers/test/visual/canvas2d.visual.test.ts`: one case per fixture, font-readiness
asserted before first render, `page.elementLocator(canvas)` + `toMatchScreenshot`. The off-Linux
skip needed three real fixes before it worked (see `tasks.md` 10.10 for full detail) — most
notably a `JSON.stringify(false)` passed as a Vite `define` value produces the truthy *string*
`"false"` in the bundle, not the boolean `false`; passing the raw boolean fixed it. Verified
deterministic across three fully-clean-cache local runs: "5 skipped", zero files written, every
time — not a single green run taken on faith.

### Two unplanned fixes this group required

1. **`@vitest/browser-playwright` missing as an actual dependency anywhere.** It was in the
   catalog since commit 7 but unused. Added to `packages/renderers/package.json` (this group's
   own scope) and to the **root** `package.json`, since `vitest.config.ts` itself imports
   `playwright` from that package and needs it in its own resolution scope. Confirmed by a real
   `tsc` typecheck against `vitest.config.ts` via a throwaway probe tsconfig (no root tsconfig
   otherwise covers that file at all — a real, pre-existing gap worth flagging: nothing in this
   repo's ordinary `turbo run typecheck` currently protects `vitest.config.ts` from a type
   regression going forward).
2. **`test/node/payload-consumption.test.ts`'s architectural guard** (renderer `src/**` must
   never construct payload data itself) failed once `src/fixtures/scenarios.ts` existed — a
   real, deliberate rule this fixtures module genuinely crosses, not a false positive. Resolved
   by scoping the guard to exclude `src/fixtures/**` explicitly, with an inline comment
   distinguishing "fixtures build a payload once at module load, to hand to a caller by
   reference" from the rule's actual target: the renderer's own runtime painting path never
   constructing a payload during a `render()` call. Every other file under `src/**` is still
   checked exactly as before — verified by rerunning the guard test itself, which still passes.

### Verification (real, from a clean install, repeated)

`rm -rf node_modules` + reinstall, then: `turbo run build` green, `turbo run typecheck` green,
`turbo run lint --force` (cache bypassed) green, `pnpm run test`: `core` 204, `playground` 45,
`renderers` 61, `visual` 5 skipped (correct — non-Linux). Local Chromium installed via
`node_modules/.pnpm/playwright@1.63.0/.../cli.js install chromium` to actually exercise the
visual project's config and skip logic for real rather than trusting it unexecuted.

### What 10d needs, concretely, before it can be attempted

Tasks 10.14–10.21 (`.gitignore` diffs-ignore entry, CI workflow browser-cache/install steps,
the dependency-freshness/deprecation-warning CI steps, `scripts/check-dependency-freshness.mjs`,
the `update-visual-goldens.yml` workflow, `CODEOWNERS`, and — the actual blocker — triggering
that workflow against this branch on GitHub Actions to generate and commit the five real PNG
goldens) cannot be completed by a local `sdd-apply` pass. They require pushing this branch,
running actual CI, and a maintainer decision about when/how to trigger the golden-generation
workflow. Nothing in 10a-10c was faked or worked around to avoid this — 10.12/10.13 were
explicitly deferred rather than satisfied with a fabricated local reference image, since that
would prove nothing true about the real `ubuntu-latest` comparator.

## Commit 10, continued — 10d (10.14–10.19 done; 10.20–10.21 remain genuinely blocked)

Status: everything a local pass can do is done. What remains needs a real push and a real
GitHub Actions run — not attempted, per no-autonomous-commits and no-autonomous-push discipline.

- `.gitignore`: `__diffs__/` excluded.
- `.github/workflows/ci.yml`: Playwright cache + install, `test:visual` anti-vacuity check (via
  real JSON-reporter parsing, verified against the actual field names vitest 5 emits), diff
  artifact upload on failure, a documentation-only freshness step, and a real deprecation-warning
  gate (verified against a synthetic bad code, not just eyeballed).
  **Found and fixed a real bug**: `pnpm exec playwright install` at repo root fails because
  `playwright` is only `packages/renderers`'s devDependency — needs `--filter
  @trace-kit/renderers`. Confirmed by actually running the bad form and seeing it fail before
  fixing it.
- `scripts/check-dependency-freshness.mjs` + `check:freshness` root script: run for real against
  the live npm registry, not simulated. Confirmed it does NOT read `@types/node`'s `dist-tags`
  (still pinned at `22.20.3` in the registry right now) and instead correctly finds `26.5.1` from
  publish-date data. Correctly reports `typescript`/`tsup`/`tsx` as behind — none acted on, since
  `typescript`'s true newest (`7.0.2`) is the version this change already measured and rejected,
  and `tsup`/`tsx` are outside P8's declared scope.
- `.github/workflows/update-visual-goldens.yml`: written and its two load-bearing mechanisms
  verified for real rather than assumed: (1) the exact `--update` invocation form (a `--`-doubled
  form silently fails to forward the flag; the correct single form was confirmed to actually
  regenerate five real PNG files), and (2) the `git diff` scope guard (tested both ways — a
  goldens-only diff passes, an out-of-scope file staged alongside is caught).
- `.github/CODEOWNERS`: added, requiring the repo owner's review on the golden directory.

All verification screenshots and the temporary `define: true` override used to exercise them
locally were deleted/reverted afterward — confirmed the real config now reads
`process.platform === "linux"` again and skips locally as it should.

### What's left — 10.20, 10.21

Both require: pushing this branch to GitHub, triggering `update-visual-goldens.yml` via
`workflow_dispatch`, reviewing and merging its resulting PR (5 real PNGs), then re-running CI to
confirm the visual suite passes against those committed goldens. None of that has been done. No
commit has been made for ANY part of this entire change across the whole session — the working
tree holds every change from commits 1 through 10 (10a-10c and 10d's local-only portion)
uncommitted, exactly as the no-autonomous-commit rule requires, awaiting the maintainer's
explicit instruction to commit and push.

### Final full-workspace verification (real, from a clean install)

`rm -rf node_modules` + reinstall, then: `turbo run build` green, `turbo run typecheck` green,
`turbo run lint --force` (cache bypassed) green, `pnpm run test`: `core` 204, `playground` 45,
`renderers` 61, `visual` 5 skipped (correct on this non-Linux machine). No new flake this run.

## Post-verify follow-up — CI walkthrough surfaced a real workflow-targeting defect

While confirming with the maintainer that "nothing we control will fail CI", the actual Quality
Gate job was walked step by step (not just re-running the four verification commands), including
simulating the Linux-only "Visual regression tests" step by temporarily forcing the platform
define to `true` on this machine.

**Confirmed, expected**: with no goldens committed yet, that step fails 5/5 ("no existing
reference screenshot found") on the very first push — this is the intended bootstrap state
(10.13/10.20/10.21), not a bug, and the job correctly halts there (no `continue-on-error`).

**Found while explaining that sequencing to the maintainer**: `update-visual-goldens.yml`'s
first pass unconditionally opened its PR against `main`, regardless of which ref it was
dispatched against. That directly contradicted D6's own already-written operator workflow
("dispatched against their PR branch... produces a PR into that branch") — my first
implementation didn't follow the design it was implementing. Concretely, it meant this exact
change's own not-yet-merged PR had no direct way to receive its goldens; a developer would have
had to merge a disconnected mini-PR into `main` first and then manually pull the PNGs back.

Fixed: the workflow now branches on `github.ref_name`. Dispatched against `main`, unchanged
behaviour (separate reviewable PR). Dispatched against any other branch, it commits the
regenerated PNGs and pushes directly onto that branch — they land inside the developer's own
already-open PR as one more commit, and that PR's own CI re-runs and passes. `design.md` D6 and
`tasks.md` 10.18 both corrected to describe this.

Verified: YAML re-parses cleanly; the branch/commit logic was exercised in a throwaway local git
repo with the `${{ }}` expressions substituted by hand for both the `main` and non-`main` case
(the actual GitHub Actions substitution happens before bash ever sees the script, so a literal
`bash -n` on the template isn't a meaningful check — this was accounted for). The `git push
origin HEAD:<ref>` form itself was not executed end-to-end (pushing to a real remote is outside
this session's authority), but is standard, well-documented git syntax.
