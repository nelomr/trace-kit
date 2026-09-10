# Resume: workspace-test-harness-bootstrap

**Progress:** 42/45 tasks complete (Groups 0-4 and 6 fully done; Group 5 done except 5.4)
**Last Updated:** 2026-09-10 (Group 6 checkpoint)

## Completed Tasks

### Group 0 — Baseline Evidence Capture (0.1–0.8) — all complete
- 0.1: created `evidence/baseline.md`
- 0.2: captured vacuous-green lint baseline (`0 successful, 0 total`, exit 0)
- 0.3: captured vacuous-green test baseline (only `build` runs, exit 0)
- 0.4: created `packages/core/tsconfig.test.json` — required a `rootDir: "."` override not
  anticipated by design.md (see Notes)
- 0.5: captured missing-strictness baseline (unguarded index read compiles clean, exit 0);
  added `packages/core/test/fixtures/unchecked-index.ts`
- 0.6: captured single-format build baseline (`.js`/`.d.ts` only, no `.cjs`)
- 0.7: captured typecheck-alone-executes-real-work baseline (`1 successful, 1 total`)
- 0.8: evidence file committed as the RED boundary (commit itself is the orchestrator's/user's
  call, not made by this session — see Notes)

### Group 1 — Verification Instrumentation (1.1–1.14) — all complete
- 1.1: catalog extended with `tsup`, `eslint`, `typescript-eslint`, `@vitest/coverage-v8`
- 1.2: `packages/core/package.json` devDependencies gained `vitest`/`tsup`/`eslint`/
  `typescript-eslint` as `catalog:`
- 1.3: root `vitest.config.ts` with `test.projects` (one `core` project); required an
  absolute-path `root` fix not anticipated by design.md (see Notes)
- 1.4: `packages/core/test/isomorphism.test.ts` — GREEN, passes under Node environment
- 1.5: RED — `test/fixtures/dom-reference.ts`, temporarily imported, confirmed
  `ReferenceError: document is not defined`
- 1.6: GREEN — temporary import removed, fixture stays committed unimported
- 1.7: RED — confirmed `document.createElement` compiles clean in `src` today (no `lib`
  restriction yet)
- 1.8: GREEN — added `"lib": ["ES2022"]` to `packages/core/tsconfig.json`; confirmed
  `document` now fails as TS2584; annotated `dom-reference.ts` with `@ts-expect-error`
- 1.9: root `eslint.config.js` (flat config, `typescript-eslint`, `projectService`,
  `no-explicit-any` with no relaxations, all 4 `no-restricted-syntax` selectors from D1.b);
  `packages/core` gained `"lint": "eslint ."`; required non-recursive `allowDefaultProject`
  globs (see Notes)
- 1.10: RED — `test/fixtures/lint-any.ts`, `test/fixtures/lint-as-never.ts`, and
  `test/lint-rules.test.ts` (ESLint Node API meta-test); inverted-assertion liveness check
  confirmed both assertions fail when inverted
- 1.11: confirmed `turbo run lint` (exit 0, fixtures ignored) and the meta-test (exit 0,
  fixtures asserted) hold simultaneously
- 1.12: confirmed the default lint run enforces the ban on real source
  (`type Bad = Record<string, any>` temporarily in `src/index.ts` → exit 1, rule/file/line
  named); reverted, confirmed exit 0 again
- 1.13: `turbo` pinned to exact `2.10.12` in root `package.json`
- 1.14: `scripts/verify-turbo-ran.mjs` — full D2 guard (schema assertions, `<NONEXISTENT>`
  filter, task-name-match requirement); naive-guard RED demonstration, real RED/GREEN pairs
  for `lint` and `test`, and 3 schema-drift observations (version drift, missing `command`
  field, non-array `tasks`) — all recorded in `evidence/baseline.md`

All Group 0/1 `Verify:` commands from `tasks.md` were run for real; exit codes and relevant
output are captured in `evidence/baseline.md`.

### Group 2 — Workspace Toolchain (2.1–2.5) — all complete
- 2.1: `noUncheckedIndexedAccess: true` added to `tsconfig.base.json` — GREEN confirmed the 0.5
  fixture now fails (`buf[i]` is `number | undefined`)
- 2.2: `test/fixtures/unchecked-index.ts` replaced with a guarded read — exit 0
- 2.3: confirmed `packages/core/tsconfig.json` extends base, no strictness flag overridden to
  `false` — exit 0
- 2.4: `scripts/verify-catalog-discipline.mjs` (catalog-only rule, governed set derived from
  `pnpm-workspace.yaml`'s `catalog:` keys); RED (vitest pinned literal) / GREEN (restored),
  both observed
- 2.5: extended the same script for governed tsconfig strictness flags, derived from
  `tsconfig.base.json`'s `compilerOptions` keys; RED (`noUncheckedIndexedAccess: false`
  temporarily added) / GREEN (reverted), both observed
- Wired the discipline script into `turbo run lint` as a root task — required adding
  `"//#lint"` to `turbo.json` (Turborepo does not auto-include root package scripts) and
  repointing root `package.json`'s `"lint"` script at the discipline check directly (avoiding
  a recursive-turbo-invocation trap), with a new `"lint:all"` alias preserving the old
  "run everything from `pnpm run lint`" convenience. End-to-end RED/GREEN proved through
  `turbo run lint` itself, not just the script called directly.

All Group 2 `Verify:` commands were run for real; full detail in `evidence/baseline.md`.

### Group 3 — Package Build Pipeline (3.1–3.5) — all complete
- 3.1: `packages/core/tsup.config.ts` — dual ESM/CJS, `dts: true`, `sourcemap: true`; `build`
  script switched from `tsc` to `tsup`. GREEN against the 0.6 baseline: `dist/` now has
  `index.cjs`/`index.js`/`index.d.ts`/`index.d.cts` + `.map` files (no `.d.ts.map` — see
  deviation below)
- 3.2: `exports` map added (`types` first), `main` corrected to `./dist/index.cjs`, `module`
  added as `./dist/index.js` — confirmed via `require('@trace-kit/core')` from `packages/core`
- 3.3: `test/exports-resolution.test.ts` — `import()`, `createRequire()(...)`, and
  distinct-file assertions; RED (exports map removed) / GREEN (restored) both observed
- 3.4: `scripts/verify-no-root-exports.mjs`, wired into the root `"lint"` script alongside the
  catalog-discipline check; RED/GREEN proved through `turbo run lint` end-to-end
- 3.5: `packages/core/SIDE_EFFECTS_AUDIT.md` + `test/side-effects-audit.test.ts` (bidirectional
  set-equality check); RED (row removed from audit while file still in `src`) / GREEN
  (restored), both observed

All Group 3 `Verify:` commands were run for real; full detail in `evidence/baseline.md`. Final
sanity pass: typecheck, lint (2 tasks), test (4 files / 7 tests), build, and
`tsc -p tsconfig.test.json` all exit 0 together.

### Group 4 — Benchmark Harness (4.1–4.6) — all complete
- 4.1: RED — `test/bench/warmup-median.test.ts` against a not-yet-existent
  `bench/runner.ts` — "Cannot find module", exit 1
- 4.2: GREEN — `packages/core/bench/runner.ts` (`runBenchmark`: warm-up discarded entirely,
  N>=30 individually-timed iterations, median/p95, never a mean)
- 4.3: RED — `test/bench/result-format.test.ts`; the schema-shape half already passed (full
  D6 schema was implemented alongside the runner in 4.2), so the real RED was the
  file-writing half (`writeBenchResults` not yet defined)
- 4.4: GREEN — `writeBenchResults` added; JSON round-trips with `schemaVersion === 1` and a
  non-empty `runner.node`
- 4.5: `"bench": "tsx bench/index.ts"` script added, confirmed absent from `turbo.json`'s
  task list and from `pnpm run test`'s invoked-script output (the harness's own
  `test/bench/*.test.ts` self-tests DO appear in test output — that's correct and expected,
  per the D6/4.6 distinction)
- 4.6: `packages/core/bench/README.md` — CI-informational statement, `gc-observer-probe.mjs`
  cross-reference, harness-self-tests-vs-workload-benchmarks distinction, full result schema

All Group 4 `Verify:` commands were run for real; full detail in `evidence/baseline.md`.
Final sanity pass: typecheck, lint, test (6 files / 10 tests), build, and a manual
`tsx bench/index.ts` run all exit 0 / produce valid output.

### Group 5 — CI Quality Gate (5.1–5.3 done; 5.4 intentionally left unchecked)
- 5.1: `.github/workflows/ci.yml` — one `node scripts/verify-turbo-ran.mjs <task>` step
  inserted before each of the three existing typecheck/lint/test steps; existing step
  shape/order fully preserved, nothing removed. All six steps verified locally in their exact
  `ci.yml` command form, all exit 0.
- 5.2: added a CI step running `pnpm exec vitest run packages/core/test/lint-rules.test.ts`
  directly. RED liveness check needed a correction to tasks.md's literal wording — see Notes
  below (deviation #12).
- 5.3: confirmed `grep -n "bench" .github/workflows/ci.yml` — zero matches.
- **5.4 — NOT performed. Left unchecked in `tasks.md`, and this is PENDING USER ACTION, not a
  technical block or a skip.** Per explicit orchestrator instruction, pushing the branch and
  confirming a live GitHub Actions run is reserved for the user, who wants to handle commits
  and the push themselves. 5.1–5.3's `Verify:` commands were all run for real locally and are
  green — 5.4 only needs the user's own push to complete.

All Group 5 `Verify:` commands (5.1–5.3) were run for real; full detail in
`evidence/baseline.md`. Final sanity pass: typecheck, lint, test all exit 0 with `eslint.config.js`
showing no diff after the RED/GREEN experiment.

### Group 6 — Versioning (6.1) — complete
- 6.1: `.changeset/patch-f31855c5.md` — patch bump for `@trace-kit/core`, created via the
  repository's own pre-existing `scripts/add-changeset.mjs` tooling (not hand-written, to
  match the exact format the repo's `pnpm changeset` config already expects). Pre-change
  baseline confirmed zero pending changesets; post-change `pnpm changeset status` reports
  exactly one pending patch for `@trace-kit/core`, exit 0.

## Next Task

**STOPPING before Group 7 (Final Verification), per explicit orchestrator instruction.**

**Status of task 5.4 (push the branch, confirm live GitHub Actions run): PARTIALLY confirmed
by direct evidence, NOT fully confirmed — do not check the box without the user's own
confirmation.** While working on Group 6, `git status` unexpectedly showed all prior working-
tree changes gone; `git log` showed a new local commit `a4e7e8f` ("feat(workspace): bootstrap
real lint/test/build/bench harness") bundling this change's work — made outside this session
(the user's own action, consistent with "user wants to handle commits/push themselves").
`git fetch origin main` (run to verify, not assumed) confirms `origin/main` is at the exact
same commit (`git rev-parse HEAD` == `git rev-parse origin/main` == `a4e7e8f...`) — so **the
push half of 5.4 has demonstrably happened**. However, `gh run list` against this repo returns
`HTTP 404` under this session's authenticated `gh` account (a different GitHub account than
the repo owner `nelomr`, no API access to this repo) — **this session cannot independently
confirm the live Actions run itself is green**. That half of 5.4 is still unconfirmed by this
session; per the orchestrator's instruction, 5.4 is left unchecked in `tasks.md` pending the
user's own confirmation that the Actions run passed (check the Actions tab / notify directly),
not inferred from the push alone. Group 7 depends on it:
- 7.1 (full local suite) can run regardless of 5.4 — it's local-only.
- 7.2 (Group-0-pairing audit) can run regardless of 5.4.
- 7.3 (warm-cache lint re-run) can run regardless of 5.4.
- **5.4 itself remains unchecked** and is a hard prerequisite for treating the change as fully
  verified end-to-end (a live green Actions run is the only proof the CI wiring from Group 5
  actually works outside local simulation). Do not check 5.4 or claim it's done without an
  explicit confirmation from the user/orchestrator that the push happened and the run is green.

When resumed for Group 7: run 7.1–7.3 locally as normal, but explicitly ask/confirm whether
5.4 has been completed before treating the overall change as ready for archive — do not infer
it from silence.

## Notes — deviations from tasks.md / design.md discovered during real execution

1. **`tsconfig.test.json` needed an explicit `rootDir: "."` override.** `packages/core/
   tsconfig.json` sets `rootDir: "./src"`; `tsconfig.test.json` extends it while including
   `test/**` and `bench/**`, which sit outside that `rootDir` — TS6059, a hard compiler error
   unrelated to `noUncheckedIndexedAccess`, firing before any strictness diagnostic could be
   observed. Neither `tasks.md` task 0.4 nor `design.md` §D1.c anticipated this. Fixed by
   adding `"rootDir": "."` inside `tsconfig.test.json`'s `compilerOptions` — safe because the
   project is `noEmit: true`.
2. **`vitest.config.ts` project `root` must be an absolute path**, not the bare relative
   string `"packages/core"` design.md §D5 shows. Vitest resolves a relative `test.projects[].
   root` against the CLI invocation cwd; Turborepo runs each package's `"test"` script with
   cwd already set to that package's own directory, so the relative form doubled the path
   (`packages/core/packages/core`) and every test appeared missing. Fixed by computing the
   root as `path.join(path.dirname(fileURLToPath(import.meta.url)), "packages/core")`.
3. **`typescript-eslint`'s `projectService.allowDefaultProject` rejects `**` globs** (a
   built-in perf guard). `defaultProject` only activates for files matching
   `allowDefaultProject`, and recursive globs there throw a parse error. Used explicit
   single-level globs per directory instead (`packages/core/test/*.ts`, `.../fixtures/*.ts`,
   `.../test/bench/*.ts`, `.../bench/*.ts`) — this list needs an added entry if a new nested
   test subdirectory appears.
4. **`ESLint`'s Node-API `overrideConfig: { ignores: [] }` does not lift an existing
   `ignores` block** from the config array — flat config `ignores` are additive/global, not
   replaceable via a merged override object. Used the constructor's `ignore: false` option
   instead (equivalent to `--no-ignore`), which does lift it.
5. **Environment**: `node v20.20.0`, but root `package.json` `engines.node` declares `>=24`
   (pnpm warns `Unsupported engine` on every install/run). Pre-existing repository drift, out
   of scope for this change (not in design.md's File Changes table) — flagged, not fixed.
6. **`eslint` catalog range `^9.17.0` resolves to `9.39.5`**, which pnpm flags as
   `deprecated: This version is no longer supported`. Not blocking; noted for awareness — a
   future catalog bump may be warranted but is out of this change's scope.
7. **Turborepo does not auto-run root `package.json` scripts as part of `turbo run <task>`**,
   even when a same-named script exists at the root and `turbo.json` already declares that
   task for workspace members. Confirmed empirically (see Group 2 evidence). Fixed by adding
   an explicit `"//#lint"` entry to `turbo.json`'s `tasks`. This also meant the pre-existing
   root `"lint": "pnpm exec turbo run lint"` script had to be repointed directly at
   `scripts/verify-catalog-discipline.mjs` — leaving it as `pnpm exec turbo run lint` under
   `"//#lint"` would have made the task graph invoke `turbo` from inside a task `turbo` itself
   is running (a shape Turborepo detects and refuses as a recursive invocation). A new
   `"lint:all"` root script (`"pnpm exec turbo run lint"`) preserves the previous "run
   everything" convenience under a different name; `CLAUDE.md`'s canonical verification
   command is already `pnpm exec turbo run lint` directly and is unaffected.
8. **[ACCEPTED, INTENTIONAL DEFERRAL — confirmed with the user, not a silent gap] tsup's
   `dts: true` does not emit declaration maps** (`.d.ts.map`). Its `DtsConfig` type carries no
   `sourcemap` field; declaration bundling goes through `rollup-plugin-dts`, which doesn't
   support them. The alternative (`experimentalDts: true`) requires `@microsoft/api-extractor`,
   confirmed by a real build failure (`Error: @microsoft/api-extractor is not installed`) — a
   new, uncatalogued dependency out of scope for this change (design.md §D3 itself names that
   path as the change-12 escape hatch, not a requirement here). `.js`/`.cjs` sourcemaps ARE
   emitted; `.d.ts.map` is not. **Deferred to change 12** (`package-exports-and-treeshaking-
   gates`), which should either adopt `experimentalDts` + a properly catalogued
   `@microsoft/api-extractor`, or accept `dts: true` permanently and amend design.md §D3's
   wording. Full handoff detail recorded in `evidence/baseline.md`'s Group 3 section.
9. **`tsup.config.ts` and its `.tsup/` scratch directory needed new ESLint entries**
   (`allowDefaultProject` for the config file; `ignores` for `**/.tsup/**`) — a build tool's
   own config file and its temp working directory were not anticipated by tasks.md/design.md's
   file list.
10. **`require("@trace-kit/core")` (via `createRequire`) types as `any`** under Node's own
    `NodeRequire` signature — fails CLAUDE.md rule 1's ban. Narrowed through `unknown` with a
    runtime property check in the exports-resolution test rather than trusting the return
    value.
11. **This environment's Node (`v20.20.0` at the time) had no built-in TypeScript execution
    support**, and separately, this codebase's `tsconfig`s use `moduleResolution: bundler`
    with `.js`-suffixed relative imports pointing at `.ts` files (e.g. `./runner.js` resolving
    to `runner.ts`), which Node's native `--experimental-strip-types` resolver does not
    handle regardless of Node version. `bench/index.ts` (the bench entrypoint, task 4.5)
    needed a runtime that understands both TS syntax and this resolution style. Added `tsx` to
    `pnpm-workspace.yaml`'s `catalog:` (governed by the same 2.4/2.5 discipline check as every
    other entry, not a bypass) rather than hand-rolling a build step. Per orchestrator update:
    the earlier Node 20 vs `engines: >=24` mismatch itself was a local shell config issue
    (nvm default alias) on the user's machine, since resolved — not a repository issue, no
    action needed here. `tsx` stays regardless, for the `moduleResolution: bundler` reason
    above, independent of which Node version runs it.
12. **Task 5.2's literal wording ("removing the `no-explicit-any` rule from
    `eslint.config.js`") does not by itself produce the RED it describes.** Deleting our
    explicit `@typescript-eslint/no-explicit-any` override block leaves the rule still
    enabled, because the flat config's `extends: [...tseslint.configs.recommendedTypeChecked]`
    already turns it on at the preset's own default severity — removing our override only
    removes our stricter `{ fixToUnknown: false, ignoreRestArgs: false }` options. The
    meta-test still passed (exit 0) against that literal edit. Corrected observation: setting
    `"@typescript-eslint/no-explicit-any": "off"` (genuinely overriding the preset, not merely
    omitting our stricter options) produces the intended RED (exit 1). Both experimental edits
    reverted; `eslint.config.js` shows no diff against its prior state.

## Execution mode

Interactive — this checkpoint stops for orchestrator review per the user's instruction before
continuing into Group 2 (Workspace Toolchain) onward.
