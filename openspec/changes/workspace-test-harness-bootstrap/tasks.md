# Tasks: workspace-test-harness-bootstrap

Strict TDD mode is active. Test runner: `pnpm run test`.
`[correction]` marks an edit to a file that already exists; `[new]` marks a new file.

**Layer order:** baseline capture → verification instrumentation → workspace config → build
pipeline → benchmark harness → CI gate → versioning → final verification.

## Revision history

This revision applies `design.md`'s reconciliation pass against the previous 41-task checklist
(written before the design existed). The design found 5 contradictions, 11 omissions and 4
pre-emptions; every one is applied below, which is why task numbers moved inside Groups 0–4.
Groups 5–6 and most of Group 7 are unchanged. See the per-delta confirmation table in this
phase's Return Envelope for the full mapping from design finding to task number.

## Why the instrumentation layer comes before the workspace config

An earlier revision of this checklist ordered the groups as workspace config → build → test →
bench → CI, which produced two structural defects. Both are fixed here.

1. **Time-travelled RED.** Several RED steps required observing the failing state of the
   *untouched* repository, but were scheduled after the group that destroys that state. The old
   task 5.1 read "with the repository still at its pre-1.x/3.x state (or by temporarily reverting
   to a scratch branch)", and the old 2.4 read "reorder locally if needed so the failing state is
   captured". An instruction to revert to a scratch branch at task 30 of 40 does not get
   executed — it gets skipped, and the RED degrades from observed to assumed. Assumed RED is
   precisely how this repository ended up with CI reporting green over work it never ran.
   **Fix:** Group 0 captures every pristine-repository observation first, once, with real command
   output committed to a versioned evidence file. No later group needs to travel backwards.
2. **Dependency inversion on the test runner.** The old tasks 2.4 and 2.5 verified `exports`
   resolution with Vitest, but Vitest was not wired until 3.1, so the task carried an unresolved
   "or run it as a plain Node script" fork inside itself. The test runner is the instrument every
   other group verifies with, so its wiring precedes them all.
   **Fix:** Group 1 wires Vitest and the lint tooling before any group that verifies through them.

## Lint tooling and the `any` ban are resolved in `design.md`

The previous revision of this checklist argued the entire linter decision here (tool choice, rule
set, rejected alternatives, fixture strategy). `design.md` §D1 interrogated that argument,
corrected two under-specified parts of it (the `no-restricted-syntax` selector list was missing
three of four escapes, and `no-explicit-any` needed `ignoreRestArgs: false` pinned explicitly), and
is now the authoritative source for this decision. Tasks 1.9–1.12 below implement it; they do not
re-argue it.

---

## 0. Baseline Evidence Capture (pristine repository — no behavior-affecting edits)

Every task here observes the repository as it stands today and records the real command output.
The one config file this group adds (0.4) is infrastructure required so the rest of this group's
own observations are measured for the right reason, not a behavior change — see 0.4's note. The
evidence file this group produces is the RED record that later groups' GREEN steps are measured
against.

- [x] 0.1 [new] Create `openspec/changes/workspace-test-harness-bootstrap/evidence/baseline.md`
  as the capture target. Every task in this group appends a section containing the exact command,
  its exit code, and its verbatim relevant output.
- [x] 0.2 Capture the vacuous-green lint baseline: run
  `pnpm exec turbo run lint --output-logs=full; echo "exit=$?"` and record the output, which is
  expected to contain `No tasks were executed as part of this run`, `0 successful, 0 total`, and
  `exit=0`. This is the central defect this change corrects.
- [x] 0.3 Capture the vacuous-green test baseline: run `pnpm run test; echo "exit=$?"` and record
  that it resolves to `turbo run test`, executes only the `build` dependency, reports no test
  task, and exits `0`.
- [x] 0.4 [new] `[design §D1.c, A2, B1]` Create `packages/core/tsconfig.test.json`
  (`extends: "./tsconfig.json"`, `noEmit: true`,
  `include: ["src/**/*", "test/**/*", "bench/**/*"]`). **This is placed here, before 0.5, rather
  than deferred into Group 1, because without it the 0.5 baseline capture below would be
  measuring the wrong project.** `packages/core/tsconfig.json` only includes `src/**/*`; a fixture
  added under `test/fixtures/` is invisible to a `tsc -p packages/core` invocation, so that
  command would report `exit=0` for a reason unrelated to `noUncheckedIndexedAccess` being absent.
  Adding this file changes no compiler option and enforces nothing new by itself — it only makes
  `test/**` type-checkable at all — so it does not compromise this group's "no behavior-affecting
  edits" boundary. Verify: `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits `0`
  against the current (still-empty) `test/` tree.
- [x] 0.5 Capture the missing-strictness baseline: add
  `packages/core/test/fixtures/unchecked-index.ts` containing an unguarded
  `const v: number = buf[i];` read from a `Float32Array`, then run
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json; echo "exit=$?"` and record
  `exit=0` — proving `noUncheckedIndexedAccess` is absent today, measured through the project that
  actually contains the fixture. Note in the evidence file that this fixture is a deliverable of
  Group 2, not a scratch artifact.
- [x] 0.6 Capture the single-format build baseline: run
  `pnpm exec turbo run build --filter=@trace-kit/core` and record that `packages/core/dist/`
  contains only single-format `.js` / `.d.ts` output, with no `.cjs` entry and no `.d.ts.map`.
- [x] 0.7 Capture the typecheck baseline for contrast: run
  `pnpm exec turbo run typecheck; echo "exit=$?"` and record that this task alone executes real
  work (1 successful, 1 total), establishing that the vacuity is specific to `lint` and `test`
  rather than a global misconfiguration.
- [x] 0.8 Commit the evidence file. Verify: `openspec/changes/workspace-test-harness-bootstrap/evidence/baseline.md`
  exists and contains a captured section for each of 0.2 through 0.7, each with a recorded exit
  code. This commit is the RED boundary — from here the repository state changes.

## 1. Verification Instrumentation

Wires the two instruments every later group verifies through: the test runner and the linter.

- [x] 1.1 [correction] Extend the `pnpm-workspace.yaml` catalog with `tsup`, `eslint`,
  `typescript-eslint`, and `@vitest/coverage-v8`. Verify: `pnpm install` at the repository root
  exits `0` with no "not found in catalog" resolution error.
- [x] 1.2 [correction] Add `vitest`, `tsup`, `eslint` and `typescript-eslint` to
  `packages/core/package.json` `devDependencies`, each specified as exactly `catalog:`. Verify:
  `pnpm install` succeeds and `pnpm why vitest --filter=@trace-kit/core` shows resolution through
  the catalog entry.
- [x] 1.3 [new] `[design §D5, C2]` Add a root `vitest.config.ts` using the `test.projects` shape
  from the outset (not a flat config): a single project today, `{ extends: true, test: { name:
  "core", root: "packages/core", environment: "node", include: ["test/**/*.test.ts"] } }`. This is
  deliberate over a simpler flat config: `packages/renderers` and the framework adapters will need
  a `jsdom`/browser project later, and under `test.projects` that is an added array element, not a
  migration of `core`'s Node isolation. Add `"test": "vitest run"` to `packages/core/package.json`.
  Verify: `pnpm run test; echo "exit=$?"` now reports at least one executed test task rather than
  `0 total` — it may still fail for lack of test files, which is acceptable here; the assertion is
  that the task graph is no longer empty.
- [x] 1.4 [new] GREEN for isomorphism — write `packages/core/test/isomorphism.test.ts` importing
  `@trace-kit/core` under the `node` environment and asserting `VERSION` is a defined string, with
  no DOM globals configured. Verify: `pnpm run test` exits `0` and its output names this file with
  at least one passing test.
- [x] 1.5 [new] RED for the DOM tripwire — add
  `packages/core/test/fixtures/dom-reference.ts` referencing `document.createElement` at module
  scope, and temporarily import it from `isomorphism.test.ts`. Verify:
  `pnpm exec vitest run packages/core/test/isomorphism.test.ts` fails with
  `ReferenceError: document is not defined`, proving the Node environment has no DOM and the
  tripwire is live. Record the output. (Do not add a `@ts-expect-error` annotation yet — see 1.8,
  which needs this file to fail typecheck first as its own RED observation.)
- [x] 1.6 [new] GREEN — remove the temporary import from `isomorphism.test.ts`, keeping
  `test/fixtures/dom-reference.ts` committed as a permanent, unimported regression asset. Verify:
  `pnpm exec vitest run packages/core/test/isomorphism.test.ts` exits `0`.
- [x] 1.7 [new] `[design §D5 layer 3, B4]` RED for the structural DOM ban — with
  `packages/core/tsconfig.json` unchanged, temporarily add `document.createElement('div');` at
  module scope to `packages/core/src/index.ts`. Verify:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits `0` — proving that today a
  DOM global compiles cleanly inside `src`, i.e. the runtime tripwire from 1.4–1.6 is the *only*
  DOM guard and it only fires on executed code paths, not on all of `src`. Record the output, then
  revert the temporary line.
- [x] 1.8 [new] `[design §D5 layer 3, B4]` GREEN — add `"lib": ["ES2022"]` to
  `packages/core/tsconfig.json`, explicitly with no `"DOM"` entry. Re-add the temporary
  `document.createElement('div');` line from 1.7 and confirm
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` now exits non-zero naming
  `document` as an unresolved name; record this, then revert the temporary line again. Finally,
  annotate `packages/core/test/fixtures/dom-reference.ts` (added in 1.5) with a scoped
  `// @ts-expect-error` comment noting it is an intentionally invalid DOM reference kept as a
  regression asset — required because `tsconfig.test.json` now type-checks `test/**` under the
  same DOM-free `lib`. Verify: `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits
  `0` with the fixture included and annotated, and with no temporary edits left in `src`.
- [x] 1.9 [new] `[design §D1, D1.a, D1.b, B2, B3]` Add the root `eslint.config.js`: flat config,
  `typescript-eslint` with `parserOptions.projectService` (resolving through
  `packages/core/tsconfig.test.json` so `test/**` and `bench/**` are inside a discoverable
  project — see 0.4), `@typescript-eslint/no-explicit-any: ["error", { "fixToUnknown": false,
  "ignoreRestArgs": false }]`, and `no-restricted-syntax` with all four selectors from §D1.b, each
  carrying its own message naming the remedy:
  ```text
  TSAsExpression > TSNeverKeyword
  TSTypeAssertion > TSNeverKeyword
  TSSatisfiesExpression > TSNeverKeyword
  TSAsExpression > TSUnknownKeyword
  ```
  Add `ignores` covering `**/test/fixtures/**` and `**/dist/**`. Add `"lint": "eslint ."` to
  `packages/core/package.json`. Verify: `pnpm exec turbo run lint --output-logs=full` now reports
  `1 successful, 1 total` and exits `0` against clean source — the direct correction of the 0.2
  baseline.
- [x] 1.10 [new] RED for the ban list — add `packages/core/test/fixtures/lint-any.ts` containing
  `type Bad = Record<string, any>;` and `packages/core/test/fixtures/lint-as-never.ts` containing
  an `as never` used to silence a type mismatch. Write
  `packages/core/test/lint-rules.test.ts` invoking ESLint's Node API over exactly those two files
  and asserting that `@typescript-eslint/no-explicit-any` fires on the first and
  `no-restricted-syntax` fires on the second (matching the `TSAsExpression > TSNeverKeyword`
  selector from 1.9). Verify: the test **fails** if the assertions are inverted to expect zero
  errors — run it once inverted, record the failure, then restore it. This proves the gate is
  live rather than vacuous.
- [x] 1.11 [new] GREEN — confirm the fixtures do not affect the main run: `pnpm exec turbo run lint`
  exits `0` (fixtures ignored) while `pnpm exec vitest run packages/core/test/lint-rules.test.ts`
  exits `0` (fixtures asserted). Both must hold simultaneously.
- [x] 1.12 [new] `[design §D1.d(3), A3]` Prove the DEFAULT lint run enforces the ban on real
  source, not just the fixtures. The Node-API meta-test in 1.10 covers only
  `packages/core/test/fixtures/**`, so on its own it would still pass if the exclusion were
  widened until nothing real was linted. Temporarily insert `type Bad = Record<string, any>;`
  into `packages/core/src/index.ts`. Verify: `pnpm exec turbo run lint; echo "exit=$?"` exits
  non-zero and the recorded output names `@typescript-eslint/no-explicit-any`, the file and the
  line. Revert the insertion and confirm `pnpm exec turbo run lint` exits `0` again. Record both
  observations in the evidence file. This satisfies the `workspace-toolchain` spec scenario "The
  main lint run enforces the ban on real source".

- [x] 1.13 [correction] `[design §D2, B9]` Pin `turbo` in the root `package.json` to the exact
  installed major.minor.patch (replacing the current `^2.3.0`, which floats to whatever satisfies
  the range). Verify: `pnpm install` exits `0`, and `grep '"turbo"' package.json` shows no `^` or
  `~` prefix.
- [x] 1.14 [new] `[design §D2, A1, C3]` Add `scripts/verify-turbo-ran.mjs <task>`, which spawns
  `turbo run <task> --dry=json` (stdout is pure JSON; the `• turbo <ver>` banner goes to stderr),
  and:
  - asserts `summary.version === "1"`, else exits `2` (schema drift);
  - asserts `Array.isArray(summary.tasks)`, else exits `2`;
  - asserts every element carries a string `command` and a string `task`, else exits `2`;
  - asserts the summary's `turboVersion` major equals `2`, else exits `2`;
  - computes `runnable = tasks.filter(t => t.command !== "<NONEXISTENT>")` and requires at least
    one element of `runnable` whose `task` field equals the requested task name — otherwise exits
    `1` (vacuous task). A bare `runnable.length === 0` check is not sufficient: `turbo run test`
    plans a runnable `core#build` alongside a nonexistent `core#test`, so the guard must confirm
    the *requested* task itself is runnable, not merely that something in the graph is.
  - else exits `0`.

  RED sub-observation (proves the discriminator is load-bearing, per A1): first write a naive
  version asserting only `summary.tasks.length > 0` and run it against the pristine 0.2 baseline
  for `lint` — record that it incorrectly exits `0` (passes) against the exact vacuous state this
  change exists to correct. Discard the naive version.

  RED/GREEN for the real guard: with `packages/core`'s `lint` script temporarily removed,
  `node scripts/verify-turbo-ran.mjs lint` exits `1`; with it restored, exits `0`. Separately, with
  `packages/core`'s `test` script temporarily removed but `build` still present,
  `node scripts/verify-turbo-ran.mjs test` still exits `1` (proving the task-name-match
  requirement, not just "something is runnable"); with `test` restored, exits `0`.

  Schema-drift observation: temporarily feed the script a malformed JSON payload (e.g. pipe a
  truncated or `version: "2"` fixture through a test seam) and confirm it exits `2`, distinctly
  from the `1` used above. All observations recorded in the evidence file.

## 2. Workspace Toolchain

- [x] 2.1 [correction] `[design §A2]` GREEN for strictness — edit `tsconfig.base.json` to add
  `"noUncheckedIndexedAccess": true`, retaining every existing option (`target: ES2022`,
  `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `declaration`, `declarationMap`,
  `sourceMap`, `isolatedModules`, `esModuleInterop`, `skipLibCheck`,
  `forceConsistentCasingInFileNames`, `resolveJsonModule`). Verify:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` now exits non-zero on the 0.5
  fixture, reporting `buf[i]` as `number | undefined` — measured through `tsconfig.test.json`
  (not `tsconfig.json`), since the fixture lives under `test/` and is invisible to the package
  build project.
- [x] 2.2 [correction] Replace the unguarded read in
  `packages/core/test/fixtures/unchecked-index.ts` with a guarded version so the fixture compiles
  clean and stays committed as a regression asset rather than a permanently broken file. Verify:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exits `0`.
- [x] 2.3 [correction] `[design §A5]` Confirm `packages/core/tsconfig.json` extends
  `../../tsconfig.base.json` and does not set any base-enabled strictness flag (`strict`,
  `noUncheckedIndexedAccess`, or any other) to `false`. `outDir`, `rootDir` and the `lib`
  restriction added in 1.8 are expected local additions and are not violations. Verify:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.json` exits `0`.
- [x] 2.4 [new] `[design §D7, B6]` Add `scripts/verify-catalog-discipline.mjs`, wired into a root
  `"lint"` script that turbo executes alongside package `lint` tasks. It reads
  `pnpm-workspace.yaml`'s `catalog:` keys to derive the **governed dependency set** (never a
  hardcoded list — the day a new tool is added to the catalog it becomes governed with no second
  edit), reads the workspace package globs from the same file (never hardcoded `packages/*` /
  `apps/*`), and fails when any matched `package.json`'s `dependencies` / `devDependencies` /
  `peerDependencies` / `optionalDependencies` specifies a governed name as anything other than
  exactly `catalog:`. RED: temporarily pin `vitest` to a literal version in
  `packages/core/package.json`, run the check, observe a non-zero exit naming the package, the
  field and the offending specifier. GREEN: restore `catalog:`, observe `0`.
- [x] 2.5 [new] `[design §D7, B7]` Extend the same script to derive the **governed strictness
  flags** from `tsconfig.base.json`'s own `compilerOptions` keys (never a hardcoded two-name list)
  and fail when any package `tsconfig.json` sets a governed flag to `false`. RED: temporarily add
  `"noUncheckedIndexedAccess": false` to `packages/core/tsconfig.json`, run the check, observe
  failure naming the flag and the file. GREEN: revert, observe pass.

## 3. Package Build Pipeline

- [x] 3.1 [new] Add `packages/core/tsup.config.ts` configuring dual ESM + CJS output, `dts: true`
  with declaration maps, and sourcemaps. Change `packages/core/package.json` `"build"` from `tsc`
  to `tsup`. Verify against the 0.6 baseline:
  `pnpm exec turbo run build --filter=@trace-kit/core` exits `0` and `packages/core/dist/` now
  contains an ESM entry, a `.cjs` entry, a `.d.ts` and a `.d.ts.map` for each.
- [x] 3.2 [correction] `[design §D4, B5]` Add a per-package `exports` map to
  `packages/core/package.json`, with `types` **first** in condition order (order is semantic —
  a resolver matches the first satisfied condition, and `import`/`require` matching before `types`
  can silently fall back to an adjacent-file guess that stops working the moment a subpath's
  declaration filename diverges from its source filename):
  `exports["."] = { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" }`.
  Correct the existing fallback fields: `main` changes from `./dist/index.js` to
  `./dist/index.cjs` (today it points a CJS-era resolver at an ESM file under `"type": "module"`),
  and add `"module": "./dist/index.js"`. Do **not** add any `exports` field to the root
  `package.json` — the root is `private: true`, so an `exports` map there is dead configuration
  that npm never reads. Verify: `node -e "console.log(require('@trace-kit/core'))"` resolves
  through the corrected `main`/`require` condition without error.
- [x] 3.3 [new] Write `packages/core/test/exports-resolution.test.ts` asserting that both a
  dynamic `import()` and a `createRequire(import.meta.url)('@trace-kit/core')` resolve against the
  built `dist/` output, and that the resolved CJS and ESM entries are distinct files. Verify:
  `pnpm exec vitest run packages/core/test/exports-resolution.test.ts` exits `0`. RED evidence:
  run it once with the `exports` map from 3.2 temporarily removed and record the `require()`
  resolution failure, then restore the map. (This is now runnable because Vitest was wired in
  Group 1 — the old checklist had this task depending on a group that came later.)
- [x] 3.4 [new] Add a guard that fails if the root `package.json` gains an `exports` field. RED:
  temporarily add a dummy `exports` field to the root and observe failure. GREEN: revert and
  observe pass.
- [x] 3.5 [new] `[design §B11]` Write `packages/core/SIDE_EFFECTS_AUDIT.md` naming every file under
  `packages/core/src` and stating that none performs a top-level side effect, so that
  `"sideEffects": false` is a documented audit rather than an unverified claim. Verify with a test
  that asserts **set equality in both directions** between the audit's listed paths and the actual
  files under `src` — a file removed from `src` but left in the audit must fail the check just as
  a file added to `src` but missing from the audit does, so the audit cannot silently go stale in
  either direction. RED: temporarily remove one file's entry from the audit while the file still
  exists in `src`, observe the test fail; restore the entry.

## 4. Benchmark Harness

- [x] 4.1 [new] RED — write `packages/core/test/bench/warmup-median.test.ts` defining a function
  deliberately ~4x slower on its first call than on later calls (the pre-tiering cost claim
  **C4b** records), call it through a harness that does not exist yet, and assert the reported
  median is not inflated by the cold sample. Verify: the test fails (module not found).
- [x] 4.2 [new] `[design §D6, C4]` GREEN — implement the harness at `packages/core/bench/runner.ts`
  with a configurable warm-up count, N >= 30 measured iterations (each timed individually with
  `performance.now()`, never a total-divided-by-N mean), and median plus p95 computation. Mechanism
  that keeps it out of the published build: `bench/` lives outside `src/`, so `tsup.config.ts`
  (from 3.1), which only globs `src/**`, never sees it; it is nonetheless typechecked and linted,
  because `packages/core/tsconfig.test.json` (0.4) includes `bench/**/*`. Verify:
  `pnpm exec vitest run packages/core/test/bench/warmup-median.test.ts` exits `0` with the median
  in the steady-state range.
- [x] 4.3 [new] `[design §D6, B8]` RED — write `packages/core/test/bench/result-format.test.ts`
  asserting a run of N >= 30 iterations yields a result carrying the full D6 schema: `median`,
  `p95`, `min`, `max`, `iterations`, `warmup`, `unit`, plus the top-level `schemaVersion`,
  `createdAt` and a `runner` block (`node`, `platform`, `arch`, `cpuModel`) — not just
  `median`/`p95`/`iterations`, because a baseline without recorded machine identity is not
  comparable across runs, and an unversioned schema cannot be refused loudly by a future
  consumer reading `undefined` as `0`. Verify it fails before the result-writing code exists.
- [x] 4.4 [new] GREEN — implement machine-readable result output (`bench-results.json`, one entry
  per named benchmark) matching the full schema above. Verify: the 4.3 test exits `0`, the JSON
  parses with `schemaVersion === 1`, and `runner.node` is a non-empty string.
- [x] 4.5 [new] Add a `"bench"` script to `packages/core/package.json`, deliberately **not** named
  `test` and **not** in any `turbo.json` `test` `dependsOn` chain, so benchmarks never run inside
  `turbo run test` or a coverage job (instrumentation distorts timing). Verify: `turbo.json`'s
  `test` task `dependsOn` does not reference a bench task, and `pnpm run test` output contains no
  bench log marker.
- [x] 4.6 [new] `[design §B10]` Write `packages/core/bench/README.md` stating that timing output is
  informational on shared CI runners and is never a merge gate there, cross-referencing
  `openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs` as the worked
  reference this harness's measurement style follows, **and** explicitly distinguishing the
  harness's own self-tests (4.1–4.4, living under `packages/core/test/bench/`, which are fast,
  deterministic and coverage-safe and therefore legitimately run inside `turbo run test`) from a
  real-workload benchmark asserting a wall-clock budget (which must never enter the test run or
  `ci.yml`). Read literally, "no benchmarks in the test run" would delete 4.1–4.4; this file states
  the distinction so it doesn't. Note that GC-event zero-allocation gating itself belongs to
  `core-decimation-math` per claim **C4b**; this change supplies only the warm-up / median / p95
  timing and the JSON format that later gate consumes.

## 5. CI Quality Gate

The guard's own RED/GREEN pair was proven in task 1.14 against the captured baseline. This group
only wires it and demonstrates a live run.

- [x] 5.1 [correction] Edit `.github/workflows/ci.yml` to invoke `scripts/verify-turbo-ran.mjs`
  for each of `typecheck`, `lint` and `test`, so the job fails if any required task executes zero
  package tasks. Keep every existing step's shape and ordering; remove nothing.
- [x] 5.2 [new] Add a CI step asserting the fixture-based lint meta-test
  (`packages/core/test/lint-rules.test.ts`) runs and passes, so the `any` ban cannot silently stop
  being enforced. Verify locally that removing the `no-explicit-any` rule from
  `eslint.config.js` makes this test fail; record the observation, then restore the rule.
- [x] 5.3 [new] Confirm the bench script from 4.5 appears nowhere in `.github/workflows/ci.yml`.
  Verify: grepping the workflow for the bench script name yields zero matches.
- [ ] 5.4 [correction] Push the branch and confirm a live GitHub Actions run of `ci.yml` is green
  end to end, with the `Unit tests` step naming `packages/core/test/isomorphism.test.ts` as passed
  and the new verification steps passing for all three tasks. Record the run URL in the evidence
  file.

## 6. Versioning

- [x] 6.1 [new] Add a Changesets entry under `.changeset/` describing a `patch` bump for
  `@trace-kit/core`, per CLAUDE.md rule 8's low-velocity `0.0.x` pacing. Verify:
  `pnpm changeset status` reports exactly one pending patch changeset for `@trace-kit/core`.

## 7. Final Verification

- [ ] 7.1 Run the full local suite in order, recording each exit code: `pnpm install`,
  `pnpm exec turbo run typecheck`, `pnpm exec turbo run lint`, `pnpm run test`,
  `pnpm exec turbo run build`.
- [ ] 7.2 Confirm every task in Group 0 has a corresponding GREEN observation later in the
  checklist, and that each GREEN was **observed** rather than assumed. Specifically: 0.2 pairs
  with 1.9 and 1.14, 0.3 pairs with 1.3 and 1.4, 0.4 pairs with 1.8 and 1.9 (the type project it
  creates is what makes both possible), 0.5 pairs with 2.1 and 2.2, 0.6 pairs with 3.1, and 0.7
  needs no correction.
- [ ] 7.3 [correction] `[design §A4]` Re-run `pnpm exec turbo run lint` with a warm Turborepo
  cache (no `--force`) and confirm `node scripts/verify-turbo-ran.mjs lint` still exits `0`. This
  replaces the earlier "a cached result must never satisfy the guard" premise, which
  `design.md` §D2 rules incorrect: a cache hit is a real executed task over unchanged inputs, and
  the chosen instrument (`--dry=json`) describes the task *plan*, which is identical whether or
  not the run is served from cache — so cache state is irrelevant to what this guard checks, and
  asserting otherwise would make the guard fail on every warm CI run. What this task actually
  verifies is Turborepo cache correctness: a warm re-run still reports `lint` as a runnable task
  whose `task` field matches, and the guard still passes.
