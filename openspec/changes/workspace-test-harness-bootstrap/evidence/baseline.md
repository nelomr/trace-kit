# Baseline Evidence — workspace-test-harness-bootstrap

Captured on the pristine repository, before any behavior-affecting edit (Group 0). This file is
the RED boundary: everything below this commit is the pre-harness state; everything after is
measured against it.

Environment: `node v20.20.0`, `pnpm 9.15.4`, `turbo 2.10.12` (root `package.json` pins
`^2.3.0` — see task 1.13 note below). Root `package.json` `engines.node` declares `>=24`; the
actual environment used to capture this baseline is `v20.20.0` (pnpm emits
`WARN Unsupported engine` on every invocation, visible in 0.3's output below). This is a
pre-existing repository drift, out of scope for this change (not listed in `design.md`'s File
Changes table), and is flagged here for visibility rather than corrected.

## 0.2 — Vacuous-green lint baseline

```
$ pnpm exec turbo run lint --output-logs=full; echo "exit=$?"
• turbo 2.10.12

   • Packages in scope: @trace-kit/core
   • Running lint in 1 packages
   • Remote caching disabled

 WARNING  No tasks were executed as part of this run.

 Tasks:    0 successful, 0 total
Cached:    0 cached, 0 total
  Time:    102ms

exit=0
```

Confirms the proposal's central claim: `lint` resolves to zero tasks and still exits `0`. CI is
green by vacuity on this axis.

## 0.3 — Vacuous-green test baseline

```
$ pnpm run test; echo "exit=$?"
 WARN  Unsupported engine: wanted: {"node":">=24"} (current: {"node":"v20.20.0","pnpm":"9.15.4"})

> trace-kit@0.0.1 test
> pnpm exec turbo run test

• turbo 2.10.12
   • Packages in scope: @trace-kit/core
   • Running test in 1 packages
   • Remote caching disabled

@trace-kit/core:build: cache miss, executing ca5c42902ce21433
@trace-kit/core:build: > @trace-kit/core@0.0.1 build
@trace-kit/core:build: > tsc

 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    1.784s

exit=0
```

`test` resolves through `dependsOn: ["build"]` — only `build` executes, no test task exists,
and the run still reports success (`1 successful, 1 total` describes `build`, not `test`).

## 0.4 — `tsconfig.test.json` infrastructure (not a behavior change)

Created `packages/core/tsconfig.test.json` (`extends: "./tsconfig.json"`, `noEmit: true`,
`include: ["src/**/*", "test/**/*", "bench/**/*"]`) so 0.5's fixture is measured through the
project that actually contains it.

**Deviation from tasks.md/design.md, discovered here:** `packages/core/tsconfig.json` sets
`rootDir: "./src"`. `tsconfig.test.json` inherits it (via `extends`) while including
`test/**` and `bench/**`, which sit outside that `rootDir` — this is TS6059
("File is not under 'rootDir'"), a **hard compiler error unrelated to
`noUncheckedIndexedAccess`**, and it fires before any strictness diagnostic can be observed.
Neither `tasks.md` task 0.4 nor `design.md` §D1.c anticipates this. Resolution: override
`rootDir: "."` inside `tsconfig.test.json` — safe because the file is `noEmit: true`, so
`rootDir` only affects the compiler's output-layout validation, never emitted paths.

```
$ pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json; echo "exit=$?"
exit=0
```

(Against the still-empty `test/`/`bench/` trees, before 0.5's fixture is added — confirms the
new project file changes no compiler option and enforces nothing new by itself.)

## 0.5 — Missing-strictness baseline

Added `packages/core/test/fixtures/unchecked-index.ts` with an unguarded
`const v: number = buf[i]` read from a `Float32Array`.

```
$ pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json; echo "exit=$?"
exit=0
```

Confirms `noUncheckedIndexedAccess` is absent today — the read typechecks clean despite being
unguarded. Measured through `tsconfig.test.json` per the 0.4 correction above (the fixture is
invisible to `tsconfig.json`, which only includes `src/**`). This fixture is a deliverable of
Group 2 (tasks 2.1/2.2 turn this into a GREEN observation), not a scratch artifact — it stays
committed.

## 0.6 — Single-format build baseline

```
$ pnpm exec turbo run build --filter=@trace-kit/core; echo "exit=$?"
 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    1.771s
exit=0

$ ls -la packages/core/dist/
index.d.ts
index.d.ts.map
index.js
index.js.map
```

Confirms single-format (`tsc`) output: an ESM `index.js`, its `.d.ts`, and sourcemaps. No
`.cjs` entry exists. (Note: `declarationMap`/`sourceMap` are already `true` in
`tsconfig.base.json`, so `.d.ts.map`/`.js.map` are already present pre-change; the defect this
change corrects is specifically the missing CJS output and the missing `exports` map, not
missing sourcemaps.)

## 0.7 — Typecheck baseline for contrast

```
$ pnpm exec turbo run typecheck; echo "exit=$?"
 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    1.853s
exit=0
```

Confirms `typecheck` alone executes real work (`1 successful, 1 total`) — the vacuity observed
in 0.2/0.3 is specific to `lint` and `test`, not a global misconfiguration.

## 0.8 — Commit boundary

This file, together with `packages/core/tsconfig.test.json` and
`packages/core/test/fixtures/unchecked-index.ts`, marks the RED boundary. From the commit that
includes this file forward, the repository state changes per Groups 1–7.

## Group 1 — Verification Instrumentation observations

### Deviation: `vitest.config.ts` project `root` must be an absolute path

Discovered while implementing task 1.3/1.4. Vitest resolves a relative `test.projects[].root`
against the CLI's invocation cwd, not against the config file's own directory. Turborepo runs
each package's `"test"` script with cwd set to that package's directory
(`packages/core`), so a bare `root: "packages/core"` doubled the path
(`packages/core/packages/core`) and `pnpm run test` reported "No test files found" even
though the file existed and the correct `core` project was loaded. Fixed by computing the
project's `root` as `path.join(path.dirname(fileURLToPath(import.meta.url)), "packages/core")`
inside `vitest.config.ts` — an absolute path derived from the config file's own location,
invocation-cwd-independent. Confirmed both `cd packages/core && vitest run` and
`pnpm run test` (via `turbo`, cwd = `packages/core`) now find and run
`test/isomorphism.test.ts`.

### Deviation: `typescript-eslint`'s `projectService.allowDefaultProject` rejects `**` globs

Discovered while implementing task 1.9. `defaultProject` alone does not make `projectService`
discover `packages/core/tsconfig.test.json` for `test/**` files — it only activates as a
fallback for files matching `allowDefaultProject` glob patterns, and those patterns reject
`**` (perf guard: "Having many files run with the default project is known to cause
performance issues"). Fixed with explicit single-level globs per directory
(`packages/core/test/*.ts`, `packages/core/test/fixtures/*.ts`,
`packages/core/test/bench/*.ts`, `packages/core/bench/*.ts`) rather than one recursive
pattern. This list will need a new entry if a new nested test subdirectory appears later
(flagged for Group 4's bench harness, which is already covered by `test/bench/*.ts`).

### 1.9 — Main lint run wired, exits 0 against clean source

```
$ pnpm exec turbo run lint --output-logs=full; echo "exit=$?"
 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
exit=0
```

### 1.10 — RED for the ban list: inverted-assertion liveness check

With the two `toContain` assertions in `test/lint-rules.test.ts` temporarily inverted to
`not.toContain`:

```
$ pnpm exec vitest run packages/core/test/lint-rules.test.ts; echo "exit=$?"
 × fires @typescript-eslint/no-explicit-any on lint-any.ts
   → expected [ Array(1) ] to not include '@typescript-eslint/no-explicit-any'
 × fires no-restricted-syntax on lint-as-never.ts
   → expected [ 'no-restricted-syntax', …(1) ] to not include 'no-restricted-syntax'
exit=1
```

Both assertions fail when inverted — proves the meta-test is genuinely exercising the rules,
not vacuously passing. Restored to the original (non-inverted) assertions immediately after.

### 1.11 — Both hold simultaneously

```
$ pnpm exec turbo run lint; echo "exit=$?"
exit=0   (fixtures ignored by the main run)

$ pnpm exec vitest run packages/core/test/lint-rules.test.ts; echo "exit=$?"
exit=0   (fixtures asserted directly via ESLint's Node API)
```

### 1.12 — Default lint run enforces the ban on real source

With `type Bad = Record<string, any>;` temporarily inserted into `packages/core/src/index.ts`:

```
$ pnpm exec turbo run lint --output-logs=full; echo "exit=$?"
packages/core/src/index.ts
  8:6   error  'Bad' is defined but never used           @typescript-eslint/no-unused-vars
  8:27  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
✖ 2 problems (2 errors, 0 warnings)
exit=1
```

Names the rule (`@typescript-eslint/no-explicit-any`), the file (`packages/core/src/index.ts`)
and the line (8). Reverted; `pnpm exec turbo run lint` confirmed back at `exit=0`
(`FULL TURBO`, cache hit).

### 1.14 — `scripts/verify-turbo-ran.mjs` RED/GREEN and schema-drift observations

Real `--dry=json` shape measured against the now-wired `lint` task (confirms design.md §D2's
recorded shape): `version: "1"`, `turboVersion: "2.10.12"`, each task carries string
`command`/`task` fields.

**RED sub-observation (naive guard, per A1):** a synthetic dry-run payload shaped like the
pristine pre-1.9 vacuous-lint state (`command: "<NONEXISTENT>"`, matching the 0.2 baseline)
fed to a naive `tasks.length > 0` check:

```
naive guard (tasks.length > 0) exit code against vacuous lint state: 0
CONFIRMED DEFECT: naive guard incorrectly passes (exit 0) against the exact vacuous state
this change exists to correct.
```

**Real guard RED/GREEN — lint script removed/restored:**

```
$ node scripts/verify-turbo-ran.mjs lint   # packages/core "lint" script removed
VACUOUS TASK: no runnable "lint" task in the plan (planned tasks: lint=<NONEXISTENT>).
exit=1

$ node scripts/verify-turbo-ran.mjs lint   # "lint" script restored
OK: "lint" is runnable.
exit=0
```

**Task-name-match requirement — test script removed, build still present:**

```
$ node scripts/verify-turbo-ran.mjs test   # packages/core "test" script removed, "build" present
VACUOUS TASK: no runnable "test" task in the plan (planned tasks: build=tsc, test=<NONEXISTENT>).
exit=1

$ node scripts/verify-turbo-ran.mjs test   # "test" script restored
OK: "test" is runnable.
exit=0
```

Confirms the guard checks that the *requested* task itself is runnable, not merely that
something in the graph is (the `core#build` dependency alone does not satisfy `verify-turbo-
ran.mjs test`).

**Schema-drift observations, via the exported `evaluateDrySummary`:**

```
version drift ("2" instead of "1"):        exit=2  SCHEMA DRIFT: expected summary.version === "1", got "2".
missing `command` field on a task:         exit=2  SCHEMA DRIFT: every planned task must carry a string `command` and a string `task` field.
tasks not an array:                        exit=2  SCHEMA DRIFT: summary.tasks is not an array.
```

All three schema-drift cases exit `2`, distinct from the `1` used for a genuine vacuous task,
confirming the fail-loudly contract from design.md §D2.

## Group 2 — Workspace Toolchain observations

### 2.1 — GREEN for strictness

Added `"noUncheckedIndexedAccess": true` to `tsconfig.base.json`.

```
$ pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json; echo "exit=$?"
packages/core/test/fixtures/unchecked-index.ts(7,7): error TS2322: Type 'number | undefined'
  is not assignable to type 'number'.
  Type 'undefined' is not assignable to type 'number'.
exit=2
```

### 2.2 — Guarded fixture, GREEN

Replaced the unguarded read in `unchecked-index.ts` with an `undefined`-checked read.

```
$ pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json; echo "exit=$?"
exit=0
```

### 2.3 — `packages/core/tsconfig.json` confirmed compliant

Extends `../../tsconfig.base.json`; only local additions are `outDir`, `rootDir`, `lib` — no
base-enabled strictness flag set to `false`.

```
$ pnpm exec tsc --noEmit -p packages/core/tsconfig.json; echo "exit=$?"
exit=0
```

### 2.4 — `scripts/verify-catalog-discipline.mjs`, catalog-only rule

Governed dependency set and workspace package globs both derived from `pnpm-workspace.yaml`
(no hardcoded list — design.md §D7/B6).

**RED — `vitest` temporarily pinned to a literal version in `packages/core/package.json`:**

```
$ node scripts/verify-catalog-discipline.mjs; echo "exit=$?"
Catalog/strictness discipline violations:
  - packages/core/package.json: "devDependencies"."vitest" = "3.2.7" — must be exactly "catalog:"
exit=1
```

**GREEN — restored to `catalog:`:**

```
$ node scripts/verify-catalog-discipline.mjs; echo "exit=$?"
OK: catalog and tsconfig-strictness discipline hold across 1 workspace package(s).
exit=0
```

### 2.5 — Governed strictness flags, derived from `tsconfig.base.json`

**RED — `"noUncheckedIndexedAccess": false` temporarily added to `packages/core/tsconfig.json`:**

```
$ node scripts/verify-catalog-discipline.mjs; echo "exit=$?"
Catalog/strictness discipline violations:
  - packages/core/tsconfig.json: compilerOptions."noUncheckedIndexedAccess" = false —
    governed strictness flags may not be overridden to false
exit=1
```

**GREEN — reverted:**

```
$ node scripts/verify-catalog-discipline.mjs; echo "exit=$?"
OK: catalog and tsconfig-strictness discipline hold across 1 workspace package(s).
exit=0
```

### Deviation: wiring the discipline script into `turbo run lint` (root task)

`tasks.md` 2.4 asks for the script to be "wired into a root `lint` script that turbo executes
alongside package lint tasks", and design.md §D7 states the mechanism matters. Empirically
determined (not specified by tasks.md/design.md) that:

1. Turborepo does **not** automatically run the root package's own `package.json` scripts as
   part of `turbo run <task>`, even when a script of that name exists at the root and
   `turbo.json` already declares a task with that name for workspace members. Confirmed by
   temporarily setting root `"lint": "echo ROOT_LINT_RAN"` and observing `turbo run lint`
   still reported only `@trace-kit/core#lint` — the root script never ran.
2. Explicitly adding a `"//#lint"` entry under `turbo.json`'s `tasks` key is required to opt
   the root workspace (`//`) into the `lint` task graph. Confirmed this makes
   `turbo run lint` execute both `//:lint` and `@trace-kit/core:lint`.
3. The pre-existing root `package.json` `"lint"` script was `"pnpm exec turbo run lint"` —
   if left as the root's own task body under `"//#lint"`, this would make the task graph
   invoke `turbo` from inside a task `turbo` itself is running (Turborepo explicitly guards
   against and errors on this "recursive invocation" shape). Resolved by repointing root
   `"lint"` directly at `node scripts/verify-catalog-discipline.mjs` (the discipline check
   itself, no recursion) and adding a separate `"lint:all"` convenience script
   (`"pnpm exec turbo run lint"`) for the previous top-level meaning. This does not regress
   `CLAUDE.md`'s documented canonical verification command, which is already
   `pnpm exec turbo run lint` directly, not `pnpm run lint`.

**End-to-end proof the wiring is load-bearing** (not just the script called directly):

```
$ # vitest temporarily pinned to a literal version in packages/core/package.json
$ pnpm exec turbo run lint --force; echo "exit=$?"
//:lint: Catalog/strictness discipline violations:
//:lint:   - packages/core/package.json: "devDependencies"."vitest" = "3.2.7" — must be
    exactly "catalog:"
Failed:    //#lint
exit=1

$ # restored
$ pnpm exec turbo run lint --force; echo "exit=$?"
Tasks:    2 successful, 2 total
exit=0
```

`node scripts/verify-turbo-ran.mjs lint` still reports `OK: "lint" is runnable.` / exit `0`
with the two-task shape (`//#lint` + `@trace-kit/core#lint`).

### Full sanity pass at the end of Group 2

```
$ pnpm exec turbo run typecheck   -> 1 successful, 1 total, exit 0
$ pnpm run test                   -> 2 files, 3 tests passed, 2 successful, 2 total, exit 0
$ pnpm exec turbo run lint --force -> 2 successful, 2 total, exit 0
```

## Group 3 — Package Build Pipeline observations

### ACCEPTED, INTENTIONAL DEFERRAL (not a silent gap): tsup's `dts` bundling does not emit declaration maps

**Status: confirmed with the user — deferred to change 12 (`package-exports-and-treeshoot-
ing-gates`), no action needed in this change.** Recorded here so change 12 picks it up.

Discovered while implementing task 3.1. Design.md §D3 calls for `dts: true` "with declaration
maps" alongside sourcemaps. tsup's `DtsConfig` type (v8.5.1) carries no `sourcemap` field at
all — its declaration bundling goes through `rollup-plugin-dts`, which does not support
`.d.ts.map` output. The alternative `experimentalDts: true` path requires
`@microsoft/api-extractor` (confirmed: build fails with `Error: @microsoft/api-extractor is
not installed`), a new, uncatalogued dependency out of scope for this change — design.md's own
§D3 names `experimentalDts` as "the escape hatch to consider... if `dts` becomes the build's
bottleneck" at change 12, not a requirement here. This change ships `dts: true` as written;
`.js`/`.cjs` sourcemaps ARE emitted (tsup supports those natively); `.d.ts.map` is not, and
that gap is accepted rather than worked around. Full `dist/` output after 3.1: `index.js`,
`index.js.map`, `index.cjs`, `index.cjs.map`, `index.d.ts`, `index.d.cts` (no `.d.ts.map`).

**Handoff for change 12**: when `package-exports-and-treeshaking-gates` wires `publint` /
`are-the-types-wrong` and revisits the build pipeline, it should either (a) adopt
`experimentalDts: true` plus `@microsoft/api-extractor` as a properly catalogued dependency, or
(b) accept `dts: true` permanently and update design.md §D3's "with declaration maps"
requirement to reflect the tool's real capability. Either way this is a known, tracked gap —
not something change 12 needs to rediscover.

### 3.1 — Dual ESM/CJS build, GREEN against the 0.6 baseline

```
$ pnpm exec turbo run build --filter=@trace-kit/core; echo "exit=$?"
DTS dist/index.d.ts  141.00 B
DTS dist/index.d.cts 141.00 B
 Tasks:    1 successful, 1 total
exit=0

$ ls packages/core/dist/
index.cjs  index.cjs.map  index.d.cts  index.d.ts  index.js  index.js.map
```

Compared with 0.6's single-format baseline (`index.js`, `index.d.ts` only) — now dual-format
with both a `.cjs` entry and both a `.d.ts`/`.d.cts` declaration pair.

Wiring note: `tsup.config.ts` and tsup's `.tsup/` scratch directory needed new entries in
`eslint.config.js` (`allowDefaultProject` for `tsup.config.ts`; `ignores` for `**/.tsup/**`) —
`.tsup/` is a temp declaration-bundling working directory tsup creates and cleans up, not
anticipated by tasks.md/design.md.

### 3.2 — `exports` map, `main`/`module` correction

```
$ cd packages/core && node -e "console.log(require('@trace-kit/core'))"
{ VERSION: [Getter] }
```

(Run with cwd = `packages/core`, where pnpm's self-link resolves the package's own name — the
repo root has no consumer depending on `@trace-kit/core`, so it is not linked into root
`node_modules`.) Confirms `main` now resolves through the corrected `./dist/index.cjs`.

### 3.3 — `test/exports-resolution.test.ts`

GREEN: `pnpm exec vitest run packages/core/test/exports-resolution.test.ts` → 3 tests passed,
exit 0.

**RED — `exports` map temporarily removed from `packages/core/package.json`:**

```
Error: Cannot find package '@trace-kit/core' imported from
  '.../packages/core/test/exports-resolution.test.ts'
1 failed | 2 passed (3)
exit=1
```

Note: the failure surfaced on the `import()` assertion rather than the `require()` assertion
tasks.md's wording anticipated — Vitest's Vite-SSR resolver requires the `exports` field for
ESM resolution of a `type: module` package whose `main` points at a `.cjs` file; `require()`
still succeeded via the legacy `main` fallback. Still solid evidence the `exports` map is
load-bearing (the `import()` path is the one real consumers of an ESM package will use).
Restored; confirmed exit 0 again.

A follow-up fix was needed after the fixture was written: `require("@trace-kit/core")` returns
`any` by Node's own `NodeRequire` type signature, which fails CLAUDE.md rule 1's ban under
`@typescript-eslint/no-unsafe-assignment`/`no-unsafe-member-access`. Narrowed through
`unknown` with a runtime property check instead of trusting the untyped return value.

### 3.4 — No-root-`exports` guard

New `scripts/verify-no-root-exports.mjs`, wired into the root `"lint"` script alongside the
catalog-discipline check (`node scripts/verify-catalog-discipline.mjs && node
scripts/verify-no-root-exports.mjs`).

**RED — dummy `exports` field temporarily added to root `package.json`, proved through
`turbo run lint` end-to-end (not just the script called directly):**

```
$ pnpm exec turbo run lint --force; echo "exit=$?"
//:lint: root package.json must not declare an "exports" field — the root is private:true
  and is never published, so npm never reads it there (design.md §D4).
Failed:    //#lint
exit=1
```

**GREEN — reverted:**

```
$ pnpm exec turbo run lint --force; echo "exit=$?"
Tasks:    2 successful, 2 total
exit=0
```

### 3.5 — `SIDE_EFFECTS_AUDIT.md`, bidirectional set-equality test

GREEN: `pnpm exec vitest run packages/core/test/side-effects-audit.test.ts` → 1 test passed,
exit 0.

**RED — `src/index.ts`'s row temporarily removed from `SIDE_EFFECTS_AUDIT.md` while the file
still exists in `src`:**

```
AssertionError: expected [ 'src/index.ts' ] to deeply equal []
  (missingFromAudit)
exit=1
```

Restored; confirmed exit 0 again.

### Full sanity pass at the end of Group 3

```
$ pnpm exec turbo run typecheck  -> 1 successful, 1 total, exit 0
$ pnpm exec turbo run lint --force -> 2 successful, 2 total, exit 0
$ pnpm run test                  -> 4 files, 7 tests passed, 2 successful, 2 total, exit 0
$ pnpm exec turbo run build --filter=@trace-kit/core --force -> 1 successful, 1 total, exit 0
$ pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json -> exit 0
```

## Group 4 — Benchmark Harness observations

### 4.1 — RED, harness module does not exist yet

```
$ pnpm exec vitest run packages/core/test/bench/warmup-median.test.ts; echo "exit=$?"
Error: Cannot find module '../../bench/runner.js' imported from
  '.../packages/core/test/bench/warmup-median.test.ts'
exit=1
```

The cold-first-call fixture is a deterministic call-counter-driven function (not real,
nondeterministic V8 tiering behavior) so the RED/GREEN pair is reproducible regardless of host
engine warm-up characteristics.

### 4.2 — GREEN, `packages/core/bench/runner.ts`

```
$ pnpm exec vitest run packages/core/test/bench/warmup-median.test.ts; echo "exit=$?"
✓ bench runner warm-up + median > does not let the cold first sample inflate the reported median
exit=0
```

Also confirmed: `pnpm exec tsc --noEmit -p packages/core/tsconfig.test.json` exit 0,
`pnpm exec turbo run lint --force` exit 0 (after a fix: destructuring-to-discard the `name`
key from `BenchmarkResult` for `runBenchmarkSuite`'s per-entry map tripped
`@typescript-eslint/no-unused-vars`; rewritten as an explicit field-by-field object literal
instead of `const { name: _name, ...rest } = ...`).

### 4.3 — RED, result-writing code does not exist yet

The schema-shape assertions (task 4.3's first half) already passed against 4.2's
`runBenchmarkSuite`, since the full D6 schema (`schemaVersion`/`runner`/etc.) was implemented
together with the runner in 4.2 rather than deferred. The genuine RED is the file-writing half:

```
$ pnpm exec vitest run packages/core/test/bench/result-format.test.ts; echo "exit=$?"
× bench result format > writes a bench-results.json file that round-trips the same schema
  → (0 , writeBenchResults) is not a function
1 failed | 1 passed (2)
exit=1
```

### 4.4 — GREEN, `writeBenchResults`

```
$ pnpm exec vitest run packages/core/test/bench/result-format.test.ts; echo "exit=$?"
Test Files  1 passed (1)
     Tests  2 passed (2)
exit=0
```

JSON parses with `schemaVersion === 1` and `runner.node` a non-empty string (asserted
directly by the test).

### Deviation: no built-in TypeScript execution in this Node runtime — `tsx` added to the catalog

Discovered while implementing task 4.5. This environment's Node (`v20.20.0`) has no
`--experimental-strip-types`-equivalent flag (`node --help` shows nothing matching
`strip-types`/`type-strip`), so `bench/index.ts` cannot be run with plain `node`. Rather than
hand-roll a build step for the bench entrypoint, `tsx` (a standard, widely-used dev tool for
exactly this) was added to `pnpm-workspace.yaml`'s `catalog:` (governed by the same 2.4/2.5
discipline check as every other catalog entry — it is not a bypass) and to
`packages/core/package.json`'s `devDependencies` as `catalog:`. `"bench": "tsx bench/index.ts"`.

### 4.5 — `bench` script kept out of the `test` chain

```
$ cd packages/core && pnpm exec tsx bench/index.ts; echo "exit=$?"
Wrote .../packages/core/bench/bench-results.json
{ "schemaVersion": 1, "createdAt": "...", "runner": {...}, "benchmarks": {...} }
exit=0
```

`bench-results.json` added to root `.gitignore` (machine/run-specific artifact, not a
committed asset — design.md §D6 describes it as output, not a checked-in fixture).

```
$ python3 -c "import json; d=json.load(open('turbo.json')); print('bench' in d['tasks'])"
False

$ pnpm run test 2>&1 | grep -i "tsx bench|pnpm run bench|> bench"
(no output — exit 1, confirming absence)
```

`pnpm run test`'s output does mention "bench" — but only as the path of the harness's own
legitimate self-tests (`test/bench/warmup-median.test.ts`, `test/bench/result-format.test.ts`),
never as an invocation of the `bench` npm script. This is the D6/4.6 distinction, confirmed by
observation rather than assumed.

### 5.3 preview — confirmed nowhere in `ci.yml` (re-confirmed formally in Group 5)

```
$ grep -n "bench" .github/workflows/ci.yml; echo "exit=$?"
exit=1
```

### 4.6 — `bench/README.md`

Written per design.md §D6/§B10: CI-informational statement, `gc-observer-probe.mjs`
cross-reference, and the explicit "harness self-tests (4.1–4.4) are not workload benchmarks"
distinction, plus the full result schema and the change-2/5/7/16 ownership boundaries.

### Full sanity pass at the end of Group 4

```
$ pnpm exec turbo run typecheck  -> 1 successful, 1 total, exit 0
$ pnpm exec turbo run lint --force -> 2 successful, 2 total, exit 0
$ pnpm run test                  -> 6 files, 10 tests passed, 2 successful, 2 total, exit 0
$ pnpm exec turbo run build --filter=@trace-kit/core --force -> 1 successful, 1 total, exit 0
$ cd packages/core && pnpm exec tsx bench/index.ts -> exit 0, valid D6-schema JSON written
```

## Group 5 — CI Quality Gate observations (5.1–5.3; 5.4 deferred to the user)

### 5.1 — `verify-turbo-ran.mjs` wired into `ci.yml`

Inserted one `node scripts/verify-turbo-ran.mjs <task>` step immediately before each of the
three existing task steps (typecheck/lint/test); every existing step's shape and order
preserved, nothing removed. All six steps verified locally, in the exact command form they run
in `ci.yml`:

```
$ node scripts/verify-turbo-ran.mjs typecheck   -> OK: "typecheck" is runnable.   exit=0
$ pnpm exec turbo run typecheck                 -> 1 successful, 1 total          exit=0
$ node scripts/verify-turbo-ran.mjs lint        -> OK: "lint" is runnable.        exit=0
$ pnpm exec turbo run lint                      -> 2 successful, 2 total          exit=0
$ node scripts/verify-turbo-ran.mjs test        -> OK: "test" is runnable.        exit=0
$ pnpm run test                                 -> 6 files, 10 tests passed       exit=0
```

### 5.2 — CI step for the lint-rules meta-test

Added `pnpm exec vitest run packages/core/test/lint-rules.test.ts` as its own CI step.

**RED observation — a genuine liveness check, with a correction to tasks.md's literal
wording.** Task 5.2 says "removing the `no-explicit-any` rule from `eslint.config.js`" should
make the meta-test fail. Tested literally first:

```
$ # our @typescript-eslint/no-explicit-any override block deleted entirely from eslint.config.js
$ pnpm exec vitest run packages/core/test/lint-rules.test.ts
✓ 2 tests passed
exit=0   <- test still PASSES — does not demonstrate the intended RED
```

This is because the flat config `extends: [...tseslint.configs.recommendedTypeChecked]`
already enables `@typescript-eslint/no-explicit-any` at its own default severity; deleting our
override block only removes our stricter `{ fixToUnknown: false, ignoreRestArgs: false }`
options, it does not disable the rule. The rule is still enforced by the preset underneath.
Corrected observation — genuinely disabling the rule (`"@typescript-eslint/no-explicit-any":
"off"`, overriding the preset rather than merely omitting our stricter options):

```
$ pnpm exec vitest run packages/core/test/lint-rules.test.ts
× fires @typescript-eslint/no-explicit-any on lint-any.ts
  → expected [] to include '@typescript-eslint/no-explicit-any'
1 failed | 1 passed (2)
exit=1
```

This is the real liveness proof; reverted both experimental edits, confirmed
`pnpm exec vitest run packages/core/test/lint-rules.test.ts` back at exit `0` /
`eslint.config.js` shows no diff against its Group 1/3/4 state.

### 5.3 — `bench` confirmed absent from `ci.yml`

```
$ grep -n "bench" .github/workflows/ci.yml; echo "grep exit=$?"
grep exit=1
```

Zero matches — consistent with Group 4's earlier informal check of the same file.

### 5.4 — NOT performed in this session (user action pending, not blocked/skipped for a
technical reason)

Per explicit orchestrator instruction: pushing the branch and confirming a live GitHub Actions
run is left to the user, who wants to handle commits and the push themselves. Task 5.4 in
`tasks.md` is left **unchecked**. All of 5.1–5.3's `Verify:` commands were run for real
locally (above) and are green; 5.4 is the only remaining live-CI confirmation and has no
technical blocker — it is simply reserved for the user's own commit/push workflow.

### Full sanity pass at the end of Group 5 (5.1–5.3)

```
$ pnpm exec turbo run typecheck --force -> 1 successful, 1 total, exit 0
$ pnpm exec turbo run lint --force      -> 2 successful, 2 total, exit 0
$ pnpm run test                         -> 2 successful, 2 total (6 files/10 tests), exit 0
```
