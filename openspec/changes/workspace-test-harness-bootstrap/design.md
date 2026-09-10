# Technical Design: workspace-test-harness-bootstrap

> Change 1 of 16. Inputs: `proposal.md`, the five delta specs under `specs/`,
> `openspec/changes/00-roadmap-decomposition/exploration.md` (§0 measured state, §7 confirmed
> decisions), `openspec/changes/00-roadmap-decomposition/research.md` (claim **C4b**).
>
> This document was written **after** `tasks.md`, out of dependency order. Section
> "Reconciliation With the Existing `tasks.md`" records every place the checklist contradicts,
> omits, or pre-empts a decision resolved here. `tasks.md` is not edited by this phase.

---

## Context & Background

The repository is a skeleton whose CI is **green by vacuity**. Measured again during this design
phase, on the tree as it stands:

```text
$ pnpm exec turbo run lint  --dry=json   # task listed, command "<NONEXISTENT>"
$ pnpm exec turbo run test  --dry=json   # core#build -> "tsc";  core#test -> "<NONEXISTENT>"
$ pnpm exec turbo --version              # 2.10.12   (root package.json pins "^2.3.0")
```

`turbo run <task>` exits `0` when every matched task is `<NONEXISTENT>`. So `openspec/config.yaml`
declares `strict_tdd: true` over a workspace that has no test runner, no linter, no dual-format
build, and a CI pipeline that reports success over work it never ran. Fifteen changes sit behind
this one; if the harness under-scopes, every downstream RED→GREEN cycle inherits false confidence.

This change builds **only** the harness. No domain code, no algorithms, no renderers.

### Applicability of the TraceKit core architecture constraints

The `sdd-design` skill requires every design to address zero-copy transfers, engine selection,
reactivity isolation, and decimation invariants. For this change all four are **structurally
non-applicable**, and that must be stated rather than silently skipped:

| Constraint | Status in this change | Owner |
|---|---|---|
| Zero-copy / `Transferable` buffer transfer, worker protocol | No buffers, no workers, no `postMessage`. This change supplies the *timing and JSON reporting machinery* that the ownership round-trip's regression budget will be measured with. | `core-transport-contract` (change 3) |
| Canvas2D `<80k` / WebGL2 `>80k` engine strategy, hysteresis | No renderer, no canvas, no GPU context. `packages/renderers` does not exist. | changes 5 / 7 / 9 |
| Vue `shallowRef` / `markRaw`, React `useRef` reactivity isolation | No framework adapter exists; `packages/vue` and `packages/react` are not created here. | changes 10 / 11 |
| LTTB / Min-Max envelope physics preservation | No decimation code. `packages/core/src/index.ts` stays a `VERSION` export. | `core-decimation-math` (change 2) |

What this change *does* owe those constraints is that the harness must be able to express their
assertions without re-migration. Two consequences are load-bearing and are decided below:
decision **D5** (a `projects`-shaped Vitest config, so a future `jsdom`/browser project for the
renderer and adapter packages is an addition rather than a migration) and decision **D6** (a
warm-up + median-of-N + p95 timing harness with a stable JSON schema, because per claim **C4b** a
cold first invocation runs interpreted before TurboFan tiering at 3–5x the warm steady state).

---

## Goals & Non-Goals

### Goals

1. `turbo run typecheck`, `turbo run lint` and `pnpm run test` each execute real work, and a
   guard makes zero-executed-tasks a **hard failure** rather than a pass.
2. CLAUDE.md rule 1 (`any` ban, all five forms) is enforced **mechanically** and the enforcement
   is itself covered by a test, so it cannot silently stop working.
3. `tsconfig.base.json` gains `noUncheckedIndexedAccess`, and no package can relax it.
4. `@trace-kit/core` builds dual ESM/CJS with declarations, declaration maps and sourcemaps,
   carries its own `exports` map, and has an audited `sideEffects` declaration.
5. One Node-environment isomorphism test exists and is structurally load-bearing for rule 5.
6. A benchmark harness exists with warm-up, median-of-N, p95 and a machine-readable result file,
   hard-separated from `turbo run test` and from any coverage job.
7. The catalog-only rule is enforced by a check that keeps working for packages that do not exist
   yet.

### Non-Goals (owner named)

- Any domain code, branded buffers, `SpectrumDataPayload`, `lttb`, `minMaxEnvelope` — change 2.
- **The GC-event zero-allocation gate itself** — change 2, per claim **C4b**. This change supplies
  only the timing/median/p95 machinery and the JSON schema that gate's budget half consumes.
  `evidence/gc-observer-probe.mjs` is referenced as the measurement-style reference, not copied in.
- `fast-check` property tests, determinism tests, `--trace-deopt` — change 2.
- `publint`, `are-the-types-wrong`, tree-shaking bundle fixture, Next.js SSR smoke app — change 12.
- Playwright, browser testing, CDP `HeapProfiler` gate — changes 5 and 7.
- Per-glob coverage thresholds and a pinned coverage provider — change 16.
- `apps/playground` (change 4), `apps/docs` (change 15).
- Any edit to `openspec/config.yaml`.

---

## Architecture & Data Flow

The "data flow" of this change is a verification graph, not a buffer pipeline. Two properties
matter: nothing may verify through an instrument that does not yet exist, and no gate may be able
to pass by executing nothing.

```text
                       ROOT CONFIG (single source of truth)
  pnpm-workspace.yaml (catalog:)   tsconfig.base.json   eslint.config.js   vitest.config.ts
            |                             |                   |                  |
            |  catalog: only              | extends           | flat config       | projects[]
            v                             v                   v                  v
   +---------------------------- packages/core --------------------------------------+
   |  src/index.ts (VERSION only)                                                    |
   |  tsconfig.json      -> include src/**        (build/emit shape)                 |
   |  tsconfig.test.json -> include src + test    (typecheck + type-aware lint)      |
   |  tsup.config.ts     -> dist/index.js (ESM) + dist/index.cjs + .d.ts + .d.ts.map |
   |  test/  isomorphism.test.ts   exports-resolution.test.ts   lint-rules.test.ts   |
   |  test/fixtures/  (committed regression assets; excluded from the main lint run) |
   |  bench/ runner.ts  -> bench-results.json    (NOT in any turbo `test` chain)     |
   +---------------------------------------------------------------------------------+

  TASK GRAPH GUARD (the anti-vacuity mechanism)

    scripts/verify-turbo-ran.mjs <task>
        |
        +-- spawn: turbo run <task> --dry=json      (plans, executes nothing)
        |          stdout is pure JSON; the "• turbo <ver>" banner goes to stderr
        |
        +-- assert summary.version === "1"          -> else exit 2  SCHEMA DRIFT (loud)
        +-- assert Array.isArray(summary.tasks)     -> else exit 2  SCHEMA DRIFT (loud)
        +-- runnable = tasks.filter(t => t.command !== "<NONEXISTENT>")
        +-- runnable.length === 0                   -> exit 1  VACUOUS TASK (loud)
        +-- else                                    -> exit 0

  CI (ci.yml, existing shape preserved)

    install -> verify-turbo-ran typecheck -> turbo run typecheck
            -> verify-turbo-ran lint      -> turbo run lint
            -> verify-turbo-ran test      -> pnpm run test
    bench/  : absent from ci.yml entirely  (instrumentation distorts timing)
```

The ordering inside CI is deliberate: the guard is a **precondition** on the task graph, run
immediately before the task it guards. The task's own exit code remains the outcome check. Neither
step subsumes the other, and neither can be satisfied by the other's success.

---

## Technical Decisions

### D1 — Lint tooling and the mechanical `any` ban

`tasks.md` currently carries a section "Decisions resolved before apply" that settles this. That
section is design material sitting in a checklist; it is relocated here, and it is **interrogated
rather than transcribed**. The headline choice survives. Three parts of its mechanism do not.

**Decision.** ESLint 9 flat config plus `typescript-eslint` v8. Root `eslint.config.js`. Package
script `"lint": "eslint ."`. Type-aware linting enabled through `parserOptions.projectService`.
Amended in four respects (D1.a–D1.d below).

**Alternatives considered.**

- **Biome.** Fastest of the three and can express the purely syntactic half of the ban. Rejected:
  no type-aware rules. This workspace's ban list grows into type-aware territory the moment the
  renderer and adapter packages land — `no-unsafe-assignment` / `no-unsafe-argument` /
  `no-unsafe-member-access` over branded `Float32Array` wrappers, and `any` arriving through a
  third-party `.d.ts` rather than being written locally. A linter that cannot grow into that forces
  a second migration at change 5 or 10.
- **oxlint.** Same verdict, same reason, plus a smaller TypeScript rule surface today.
- **`grep`-based CI check only.** Rejected: it cannot distinguish `any` in a string literal, a
  comment, or a `.d.ts` from `any` in a type position, so it is simultaneously too loud and too
  quiet. It also cannot see inferred `any`. It survives only as a redundant belt in nobody's design.
- **No linter; rely on review.** Rejected by CLAUDE.md rule 1's own framing and by the repository's
  demonstrated failure mode: this codebase already proved that an unenforced assertion decays.

**D1.a — `no-explicit-any` genuinely covers four of the five forms; it covers them for one reason.**
`@typescript-eslint/no-explicit-any` reports the `TSAnyKeyword` AST node wherever it appears. All
four of `: any` (type annotation), `as any` (`TSAsExpression`), `<any>x` (`TSTypeAssertion`) and
`Record<string, any>` / the general `, any>` shape (a type argument) contain that same node, so all
four are caught by one rule. The `, any>` grep advice in CLAUDE.md rule 1 is guidance for a *human
verifying by grep*; it is not a second rule. Configure the rule with no relaxations:
`{ "fixToUnknown": false, "ignoreRestArgs": false }` — `ignoreRestArgs: true` would open
`(...args: any[])`, which is exactly the shape a hot-path callback would use.

**D1.b — the `as never` selector as written in `tasks.md` is too narrow. Corrected.** The proposed
selector `TSAsExpression > TSNeverKeyword` catches `x as never` and nothing else. It misses:

| Escape | Why it matters |
|---|---|
| `<never>x` | `TSTypeAssertion > TSNeverKeyword` — same suppression, different syntax |
| `x satisfies never` | `TSSatisfiesExpression > TSNeverKeyword` |
| `x as unknown as Foo` | The double assertion is the *most common* real suppression idiom and is not an `any` or a `never` at all |

The `as unknown as` chain is the important one: banning `as never` while leaving
`as unknown as` open bans the rarer escape and leaves the common one. Final `no-restricted-syntax`
selector list:

```text
TSAsExpression > TSNeverKeyword
TSTypeAssertion > TSNeverKeyword
TSSatisfiesExpression > TSNeverKeyword
TSAsExpression > TSUnknownKeyword
```

Each carries a message naming the intended remedy (a discriminated union, or a branded-type
constructor with a runtime check). As `tasks.md` correctly observes, this also flags legitimate
exhaustiveness narrowing (`const _exhaustive: never = value`) and legitimate `as unknown as`
bridging at a genuine external boundary. That is the intent: the author must justify it with an
inline `eslint-disable-next-line` carrying a reason, which is an auditable trail in the diff.
Keeping this rule deliberately over-broad is cheaper than the alternative, because a false negative
here is a silently-typed hot loop.

**D1.c — `projectService` has a cost and a trap, and the trap is the fixtures.** Type-aware linting
requires every linted file to belong to a TypeScript project. `packages/core/tsconfig.json` includes
only `src/**/*`. So the moment `eslint .` (or the meta-test) reaches `test/**`, `projectService`
errors with "file not found in any of the projects" — *before* any rule runs. `tasks.md` does not
account for this and would fail at task 1.7. Resolution: introduce
`packages/core/tsconfig.test.json` (`extends ./tsconfig.json`, `noEmit: true`,
`include: ["src/**/*", "test/**/*", "bench/**/*"]`) and let `projectService` discover it. The
fixtures are inside that project, so they are type-resolvable, and the *lint* exclusion of them
(D1.d) is a separate concern from their *type* project membership.

Cost: type-aware linting is roughly 3–10x slower than syntax-only because it builds a program.
Today, over one file, that is fractions of a second. It grows with the workspace, and the mitigation
is already present in the repository: Turborepo caches the `lint` task, so a warm CI run relints
only packages whose inputs changed. This is accepted, and it is the reason `lint` keeps
`"cache": true` in `turbo.json`.

**D1.d — the negative fixtures, and a spec-wording conflict that must be resolved.** The fixtures
(`lint-any.ts`, `lint-as-never.ts`, `unchecked-index.ts`, `dom-reference.ts`) are committed
permanently as regression assets. `tasks.md` therefore has the main `eslint .` run `ignores`
`**/test/fixtures/**`, with enforcement asserted by a meta-test that drives ESLint's Node API
(`new ESLint({ … }).lintFiles([…])`) and asserts the exact rule IDs fire on the exact files. That
mechanism is right, and it is the only reason the fixtures can be committed at all.

But it collides head-on with the `workspace-toolchain` spec, whose scenario reads: *"WHEN
`pnpm exec turbo run lint` runs over the workspace including that fixture THEN the lint task exits
non-zero."* If fixtures are ignored, `turbo run lint` exits `0`, and that scenario reads as failed.
The two cannot both be literally true: a permanently-committed violating file and a green main lint
run are mutually exclusive by construction.

This design resolves it without weakening either intent, and **without re-deciding the spec**:

1. The main run ignores `**/test/fixtures/**` and `**/dist/**`. `turbo run lint` stays green.
2. The meta-test asserts, through ESLint's Node API against the same flat config with the ignore
   lifted, that `@typescript-eslint/no-explicit-any` fires on `lint-any.ts` and that
   `no-restricted-syntax` fires on `lint-as-never.ts`, by exact rule ID and file.
3. **Added, and missing from `tasks.md`:** a transient in-source RED observation. Insert
   `type Bad = Record<string, any>;` into `packages/core/src/index.ts`, run
   `pnpm exec turbo run lint`, record the non-zero exit and the rule/file/line, then revert. This is
   the observation that satisfies the spec scenario as written — real workspace lint, real
   non-linted-fixture path, exits non-zero — and it is a genuinely different assertion from (2),
   because it exercises the packaged `lint` script and the Turborepo task rather than the Node API.

The residual is a spec **wording** issue, not a design gap: the scenario's "including that fixture"
should read "including a file containing that pattern". Flagged for the orchestrator; not edited
here.

**Trade-offs.** Slower lint than Biome, bought deliberately for type-aware growth room. One extra
tsconfig per package. An over-broad `no-restricted-syntax` that will require occasional justified
disables. Accepted on all three counts.

---

### D2 — The vacuity guard's mechanism

**Decision.** `scripts/verify-turbo-ran.mjs <task>` spawns `turbo run <task> --dry=json`, parses
stdout as JSON, and fails when **no planned task has a runnable command**. The discriminator is the
per-task `command` field: measured on turbo 2.10.12 in this repository,

```text
turbo run lint --dry=json  ->  tasks[0] = { taskId: "@trace-kit/core#lint",
                                            task: "lint", command: "<NONEXISTENT>", … }
turbo run test --dry=json  ->  [ ("@trace-kit/core#build", "tsc"),
                                 ("@trace-kit/core#test",  "<NONEXISTENT>") ]
```

**This measurement invalidates the obvious implementation.** A guard that merely asserts
`tasks.length > 0` passes *today*, against the exact vacuous state this change exists to correct —
Turborepo lists the task in the plan even when the package declares no such script. The guard must
filter on `command !== "<NONEXISTENT>"`. `tasks.md` task 1.10 does not specify this and would ship a
guard that guards nothing. This is the single most important correction in this document.

Note also the second-order form: `turbo run test` plans a runnable `core#build` alongside a
nonexistent `core#test`. So the filter must additionally require that at least one runnable task's
`task` field equals the requested task name, or the `test` guard passes on the strength of the
`build` dependency alone.

**Alternatives considered.**

- **Parsing the human-readable summary** for `0 successful, 0 total` or `No tasks were executed as
  part of this run`. Rejected: unversioned presentation text, localizable, reflowed between minor
  releases, and mixed with task logs. It is the most brittle available surface.
- **`--summarize`, reading `.turbo/runs/<id>.json`.** A real machine-readable surface, and it has
  the advantage of describing an actual execution. Rejected as the primary instrument for three
  reasons: it requires executing the task before you can check whether the task exists, so a guard
  built on it cannot be a precondition; it needs run-file discovery (newest file in a directory) and
  cleanup, which is racy under concurrent CI jobs; and it writes into `.turbo/`, which is a cache
  directory the CI restores from, so a stale run file can be read as a fresh result.
- **A shell one-liner in `ci.yml`.** Rejected: not unit-testable, not reusable across the three
  tasks, and duplicated three times in YAML.

**Fail-loudly contract.** The guard is worthless if it degrades to a no-op when Turborepo's output
changes. Three assertions, each exiting `2` with a message distinct from the `1` used for a genuine
vacuous task:

1. The dry-run summary's `version` field must equal `"1"` (present in the measured output). Any
   other value is schema drift.
2. `tasks` must be an array. Absent or non-array is schema drift.
3. Every element must carry a string `command` and a string `task`. A missing `command` field means
   the discriminator vanished — the highest-risk drift, and the one that would otherwise turn the
   filter into a pass-everything.

The guard also asserts a supported `turboVersion` **major** (`2`) from the same summary, and
`turbo` is pinned to an exact version in the root `devDependencies` (replacing the current
`^2.3.0`, which today silently resolves to 2.10.12 — a seven-minor drift on the very tool the guard
parses). Exit `2` is reported by CI as a distinct failure from exit `1`, so "the guard broke" is
never confused with "the task set is empty".

**Does `FULL TURBO` count as executed?** Yes. A cached task is a real task whose recorded outcome is
a real pass over unchanged inputs; treating a cache hit as "did not run" would make the guard fail
on every warm CI run and it would be disabled within a week. This is also a non-question under the
chosen instrument: `--dry=json` describes the *plan*, and the plan is identical cached or not. The
guard answers "does this task exist and is it runnable"; the task's own exit code answers "did it
pass". Cache correctness is Turborepo's input-hashing concern, and `turbo.json` already declares
`inputs`/`outputs` for the relevant tasks.

**Trade-offs.** The guard costs one extra `turbo` process per task per CI run (a dry run, sub-second).
It proves the graph is non-vacuous, not that work executed — that is the paired task's job, and
splitting the two is what makes each one checkable.

---

### D3 — Build topology

**Decision.** `tsup` owns emission for `@trace-kit/core`: dual ESM (`dist/index.js`, since the
package is `type: module`) + CJS (`dist/index.cjs`), `dts: true`, `sourcemap: true`, and
declaration maps. `packages/core/package.json` `"build"` changes from `tsc` to `tsup`.

**`typecheck` keeps `dependsOn: ["^build"]`.** Interrogated, and kept. The argument for dropping it
is that with `tsup` owning `dts`, `tsc --noEmit` no longer needs to emit anything itself. That
argument confuses *emitting* with *resolving*. `@trace-kit/core`'s `exports.types` points at
`dist/index.d.ts`; when `packages/renderers` lands at change 5 and typechecks against
`@trace-kit/core`, the compiler resolves that specifier through the published `types` condition,
which means upstream `dist/*.d.ts` must exist. Dropping `^build` would make change 5's typecheck
fail on a cold clone — an intermittent, ordering-dependent failure, the worst kind. Keeping the
dependency costs a cached upstream build. The alternative (TypeScript project references with
`composite: true`) is a real option that would let `typecheck` resolve through source, but it
requires `outDir`/`rootDir`/`tsBuildInfoFile` discipline in every package and interacts awkwardly
with `moduleResolution: bundler`; it is deferred, and noted as the migration to consider if cold
build time becomes a problem after change 5.

**Do `tsc --noEmit` and `tsup --dts` duplicate work?** Yes, partially and deliberately. `tsup`'s
`dts` step runs its own TypeScript pass to produce declarations; `tsc --noEmit -p tsconfig.test.json`
checks a strictly larger file set (`src` + `test` + `bench`, which `tsup` never sees) and is the
only step whose failure means "the code is wrong" rather than "the build broke". Removing either
loses coverage:

- Drop `typecheck` → tests and benchmarks are never type-checked, and `noUncheckedIndexedAccess`
  stops being enforced on exactly the fixture that proves it is on.
- Drop `dts` → no declarations ship.

The duplication is one extra program build on a package with one source file, and Turborepo caches
both tasks independently. Accepted. Revisit at change 12 if `dts` becomes the build's bottleneck
(`tsup`'s `experimentalDts`/rollup-based dts path is the escape hatch).

**Interaction with `turbo.json`.** No change required: `build` already declares
`outputs: ["dist/**"]` and `dependsOn: ["^build"]`, which is correct for `tsup`. `tsup` writes only
under `dist/`, so the existing output globbing keeps the cache honest. `packages/core/tsconfig.json`'s
`outDir`/`rootDir` become vestigial once `tsup` emits, but they are retained because
`tsconfig.test.json` extends this file and `rootDir` still constrains `src` layout; they are
harmless under `noEmit`.

---

### D4 — Package entry points

**Decision.** Per-package `exports` map on `@trace-kit/core`, with `types` first:

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  }
}
```

**Condition ordering is semantic, not cosmetic.** `exports` conditions are matched in declaration
order, first match wins. `types` must precede `import` and `require`, or a TypeScript resolver
under `moduleResolution: node16`/`nodenext` matches `import` first, gets a `.js` path, and resolves
types only by the adjacent-`.d.ts` fallback — which happens to work here and will stop working the
moment a subpath's declaration filename diverges from its JavaScript filename. Ordering it correctly
now costs nothing and removes a latent trap for changes 10–12, where `./vue` and `./react` subpaths
appear.

**A correction to the current manifest.** `packages/core/package.json` today has
`"main": "./dist/index.js"`, which under `"type": "module"` points a CJS-era resolver at an ESM file.
With dual output landing, `main` must point at `./dist/index.cjs` and `module` at the ESM entry.
`tasks.md` task 3.2 says to keep `main` and `types` "as fallback fields for older resolvers" without
saying that `main`'s *value* must change. Left as-is, the fallback path is actively wrong.

**No root `exports` map.** The root `package.json` is `private: true` and is never published, so npm
never reads an `exports` field there. The brief's root-level `exports["./vue"]` pointing into
`packages/*/dist` is dead configuration (exploration §1.11/§3.11). The model is independently
published packages, each owning its own `exports` map and its own Changesets version — no umbrella
package. A guard asserts the root never gains an `exports` field, because this is the kind of
plausible-looking configuration a future contributor adds in good faith and nobody notices is inert.

**`publint` and `are-the-types-wrong`.** `publint` checks manifest/artifact agreement: `exports`
targets that exist on disk, `main`/`module`/`types` consistency, correct file extensions for the
declared `type`, and `files` coverage. `are-the-types-wrong` checks that types resolve under every
consumer resolution mode (`node10`, `node16`-CJS, `node16`-ESM, `bundler`) and catches the "masquerading
ESM/CJS" and "missing types on the `require` condition" classes. Both **belong to change 12**, per
the proposal's explicit deferral. They are the right tools and they are not deferred out of doubt:
they are deferred because their value is proportional to the number of packages and subpaths, and
here there is one package with one subpath, where the `exports`-resolution test in D5 covers the same
ground for a fraction of the setup. This change establishes the *pattern*; change 12 installs the
*gate*.

---

### D5 — Test harness topology

**Decision.** A root `vitest.config.ts` that uses the `test.projects` field from the outset, with a
single project today:

```text
vitest.config.ts
  test.projects = [
    { extends: true, test: { name: "core", root: "packages/core",
                             environment: "node", include: ["test/**/*.test.ts"] } }
  ]
```

**Alternatives considered.**

- **A flat root config with a global `include` glob** (`packages/*/test/**`). Simplest today.
  Rejected: it forces one environment for the whole workspace. `packages/renderers` (change 5) and
  the Vue/React adapters (changes 10/11) need `jsdom` or a browser-mode project while `core` must
  stay in pristine Node — that is not a preference, it is CLAUDE.md rule 5. Under a flat config,
  the first arriving DOM test forces a migration of the whole harness, at exactly the moment the
  isomorphism tripwire matters most.
- **A per-package `vitest.config.ts` in every package, no root config.** Rejected: five copies of
  the same coverage, reporter and alias settings drifting independently, and no single command that
  runs everything with one reporter.
- **`vitest.workspace.ts` (the separate workspace file).** Rejected: deprecated in favour of
  `test.projects` inside the root config in the Vitest 3 line the catalog pins (`^3.0.0`). Choosing
  it would mean a migration inside this change's own lifetime.

`projects` with one entry is deliberately more structure than today needs. It is the shape that will
not require re-migration at change 4 or 5: those changes add an array element with a different
`environment`, and `core`'s Node isolation is unaffected. Per-package `"test": "vitest run"` scripts
remain, so `turbo run test` retains per-package caching and filtering.

**Where the Node-isomorphism guarantee is enforced structurally, not by one test.** The proposal
calls the isomorphism test "the tripwire", and `tasks.md` implements exactly that one test. One test
asserting `VERSION` is a string is weak: it passes even if a DOM reference sits in an unimported
module, and it would pass under a `jsdom` environment where `document` exists. Three layers, in
increasing order of structural strength:

1. **Project-level environment pinning.** The `core` project hard-sets `environment: "node"` and
   configures no `jsdom`, no `happy-dom`, no `globals`. A future DOM project is a *different* array
   entry; it cannot leak into `core`.
2. **`dom-reference.ts`, committed and unimported.** The RED observation (import it, watch
   `ReferenceError: document is not defined`) proves the environment is DOM-free; the file stays as
   a documented regression asset. `tasks.md` gets this right.
3. **The type layer, which `tasks.md` omits and which is the actually structural one.**
   `packages/core/tsconfig.json` must set `"lib": ["ES2022"]` and **must not** include `"DOM"`, and
   must not pull `@types/dom`. With no `DOM` lib, `document.createElement` is a *compile* error in
   `packages/core/src`, caught by `turbo run typecheck` on every file whether or not any test
   imports it. A runtime tripwire only fires on the code paths a test executes; the `lib` restriction
   fires on all of them. `tsconfig.test.json` inherits it, which is why `dom-reference.ts` must be
   marked with a scoped `@ts-expect-error` (correct and self-documenting: the file's *purpose* is to
   be invalid) rather than being excluded from the type project.

Layer 3 is where CLAUDE.md rule 5 actually lives. Layers 1 and 2 catch what the type system cannot:
a browser global reached indirectly (`globalThis['document']`) or through an untyped dependency.

---

### D6 — Benchmark harness boundaries

**Decision.** A dependency-free runner at `packages/core/bench/runner.ts`, excluded from the
published build (not under `src/`, so `tsup` never sees it; covered by `tsconfig.test.json` for
typecheck and lint).

Measurement contract:

- **Warm-up**: a configurable, non-zero count of untimed iterations executed before the first timed
  sample. Non-negotiable per claim **C4b**: the cold first invocation of a numeric pass runs
  interpreted before TurboFan tiering and can be 3–5x slower than the warm steady state, which alone
  blows any millisecond budget. A harness reporting a single cold sample is a defect, not a
  measurement.
- **N measured iterations**, `N >= 30`, each timed individually with
  `performance.now()`. **Not** a total-divided-by-N mean: the mean is exactly the statistic a single
  slow outlier destroys, which is the failure mode being designed against.
- **Median** as the reported central value, and **p95** alongside it. The median answers "did the
  steady state regress"; p95 answers "did the tail get worse", which is the statistic a
  pathological deopt or an unexpected GC pause moves first. Reporting the median alone would hide
  precisely the regressions this project cares about.
- **Result JSON schema** (`bench-results.json`, one entry per named benchmark), the contract later
  changes consume:

```text
{
  "schemaVersion": 1,
  "createdAt":     <ISO-8601 string>,
  "runner":        { "node": <process.version>, "platform": …, "arch": …, "cpuModel": … },
  "benchmarks": {
    "<name>": { "median": <finite ms>, "p95": <finite ms>, "min": …, "max": …,
                "iterations": <int>, "warmup": <int>, "unit": "ms" }
  }
}
```

  `schemaVersion` exists so a change-16 consumer can refuse an unrecognized file loudly instead of
  reading `undefined` as `0`. The `runner` block exists because confirmed decision 3 makes every
  performance criterion a **self-calibrating relative budget measured on the executing runner** — a
  baseline is meaningless without knowing which machine produced it, and comparing a laptop median
  to a CI-runner median is the mistake the field records against. Both fields are absent from
  `tasks.md`'s result-format tasks. `iterations` and `warmup` are recorded because a median over
  N=3 and a median over N=1000 are not comparable numbers.

**Hard separation from `test` and from coverage.** The script is `"bench"`, deliberately not `test`
or `test:unit`; no `turbo.json` task named `bench` is added, and no `test`/`test:unit` `dependsOn`
references it. Coverage instrumentation (`@vitest/coverage-v8`) rewrites the code under measurement
and distorts timing (exploration §1.5), so a benchmark inside a coverage job produces a number that
looks precise and means nothing. `bench` also appears nowhere in `ci.yml`.

One wrinkle `tasks.md` walks into: tasks 4.1–4.4 put the harness's own tests under
`packages/core/test/bench/*.test.ts`, i.e. inside the `test` glob. That is **correct and must stay** —
those tests verify the harness's *logic* (that the median excludes the cold sample, that the JSON
carries finite fields) and are fast, deterministic and coverage-safe. What must never enter the test
run is a *real workload* benchmark asserting a wall-clock budget. The distinction is worth stating
explicitly in `bench/README.md`, because "no benchmarks in the test run" read literally would delete
the harness's own tests.

**What this change explicitly does NOT build.** The **GC-event zero-allocation gate belongs to
`core-decimation-math` (change 2)**, per claim **C4b**. This change ships no `PerformanceObserver`,
no `entryTypes: ['gc']` subscription, no `--expose-gc` invocation and no GC assertion.
`evidence/gc-observer-probe.mjs` is cross-referenced from `bench/README.md` as the worked reference
whose measurement style change 2 follows. Likewise absent: the CDP `HeapProfiler` browser gate
(claim **C4d**, changes 5/7), any baseline-comparison or regression-budget *computation* (change 16
owns the stored baseline and the comparison), and any CI merge gate on timing. `bench/README.md`
states that timing output is informational on shared CI runners and is never a merge gate there.

---

### D7 — Catalog discipline

**Decision.** A single check, `scripts/verify-catalog-discipline.mjs`, wired into the lint task
(a root-package `lint` script that turbo executes alongside the package lint tasks), enforcing a
**deny-by-default** rule over an enumerated dependency set.

The mechanism matters more than the rule, because the rule has to keep working for `renderers`,
`vue`, `react`, `docs` and `playground` — packages that do not exist yet and that nobody will
remember to register.

- **Enumerate the *governed dependencies*, never the packages.** The check globs every
  `package.json` matched by `pnpm-workspace.yaml` (reading the globs from that file rather than
  hardcoding `packages/*` and `apps/*`, so adding a glob does not silently shrink coverage) and
  inspects `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`.
- **The governed set is derived, not listed.** Every key present in `pnpm-workspace.yaml`'s
  `catalog:` is governed. So the day `tsup` is added to the catalog it becomes governed everywhere,
  with no second edit — and a new package that pins `vitest: "^3.1.0"` fails on arrival. This is the
  key difference from `tasks.md` task 2.4, which hardcodes the list
  `vitest | tsup | eslint | typescript-eslint | typescript`: a hardcoded list is a list that goes
  stale, and it goes stale silently in the passing direction.
- **The rule**: for a governed dependency name, the specifier must be exactly `catalog:`.
  Anything else — a range, `catalog:named`, `workspace:*` — fails, naming the package, the field
  and the offending specifier. Internal `@trace-kit/*` cross-dependencies use `workspace:*` and are
  never governed, since they are not catalog entries.
- **The same script carries the tsconfig-strictness check** (D1/spec `workspace-toolchain`): every
  package `tsconfig.json` must `extends` the root base and must not set `strict: false`,
  `noUncheckedIndexedAccess: false`, or any other `false` override of a base-enabled strictness flag.
  Deriving the governed flag list from `tsconfig.base.json`'s own `compilerOptions` keys — rather
  than hardcoding two names — makes this grow with the base config for free. That generalization is
  absent from `tasks.md` task 2.5.

**Alternatives considered.** A `pnpm` `.npmrc` setting or a lifecycle hook — rejected: no pnpm
setting expresses "catalog-only for these names", and a `preinstall` hook is skippable with
`--ignore-scripts`. A `syncpack`/`manypkg` dependency — rejected as an extra dependency for a
20-line check whose exact rule is repository-specific. A `pnpm dedupe --check` in CI — rejected:
it detects duplicate resolutions, not catalog bypass.

**Trade-offs.** One bespoke script to maintain. It runs in the `lint` task, so it participates in
the anti-vacuity guard and in Turborepo caching. It is deny-by-default over a derived set, so the
failure mode when someone adds a package is a *loud failure on a real violation*, never a silent
gap.

---

## File Changes

| Action | File Path | Description |
|--------|-----------|-------------|
| MODIFY | `pnpm-workspace.yaml` | Catalog gains `tsup`, `eslint`, `typescript-eslint`, `@vitest/coverage-v8`. Globs unchanged. |
| MODIFY | `tsconfig.base.json` | Add `noUncheckedIndexedAccess: true`. Every existing option retained. |
| MODIFY | `package.json` (root) | Pin `turbo` to an exact version (replacing `^2.3.0`); add root `lint` script running the discipline checks. **No `exports` field, ever.** |
| NEW | `eslint.config.js` | Flat config per D1: `typescript-eslint` + `projectService`, `no-explicit-any` (no relaxations), the four-selector `no-restricted-syntax`, `ignores` for `**/test/fixtures/**` and `**/dist/**`. |
| NEW | `vitest.config.ts` | Root config using `test.projects` with one `core` project, `environment: "node"` (D5). |
| NEW | `scripts/verify-turbo-ran.mjs` | Vacuity guard per D2: `--dry=json`, `command !== "<NONEXISTENT>"`, schema assertions, exit 1 vs exit 2. |
| NEW | `scripts/verify-catalog-discipline.mjs` | D7: catalog-only over the derived governed set, plus tsconfig strictness overrides, plus the no-root-`exports` assertion. |
| MODIFY | `packages/core/package.json` | `build: tsup`; add `test`, `lint`, `bench`; `exports` map with `types` first; `main` corrected to `./dist/index.cjs`, `module` added; devDeps as `catalog:`. |
| MODIFY | `packages/core/tsconfig.json` | Add `"lib": ["ES2022"]` (no `DOM`) per D5 layer 3. |
| NEW | `packages/core/tsconfig.test.json` | `extends ./tsconfig.json`, `noEmit`, includes `src` + `test` + `bench` — required by `projectService` (D1.c) and by fixture typechecking. |
| NEW | `packages/core/tsup.config.ts` | Dual ESM/CJS, `dts: true`, declaration maps, sourcemaps (D3). |
| NEW | `packages/core/test/isomorphism.test.ts` | Node-environment tripwire. |
| NEW | `packages/core/test/exports-resolution.test.ts` | `import()` and `createRequire()` both resolve; ESM and CJS entries are distinct files. |
| NEW | `packages/core/test/lint-rules.test.ts` | ESLint Node API meta-test asserting exact rule IDs on exact fixtures (D1.d). |
| NEW | `packages/core/test/fixtures/{lint-any,lint-as-never,unchecked-index,dom-reference}.ts` | Permanent regression assets; ignored by the main lint run, inside the type project. |
| NEW | `packages/core/bench/runner.ts` | Warm-up + N-iteration + median/p95 runner (D6). Not published. |
| NEW | `packages/core/bench/README.md` | Informational-on-CI statement; `gc-observer-probe.mjs` cross-reference; the "harness self-tests are not workload benchmarks" distinction. |
| NEW | `packages/core/SIDE_EFFECTS_AUDIT.md` | Names every file under `src`, asserts no import-time side effect, backing `sideEffects: false`. |
| MODIFY | `.github/workflows/ci.yml` | Insert `verify-turbo-ran.mjs <task>` before each of the three existing task steps. Existing step shape and order preserved. |
| NEW | `.changeset/*.md` | One `patch` bump for `@trace-kit/core` (CLAUDE.md rule 8). |
| NEW | `openspec/changes/workspace-test-harness-bootstrap/evidence/baseline.md` | Group 0 pristine-state capture. |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **The guard guards nothing.** `tasks.length > 0` passes against today's vacuous state, because Turborepo plans `<NONEXISTENT>` tasks. | **High** — it would ship the exact defect this change corrects, wearing a green check. | D2: filter on `command !== "<NONEXISTENT>"` **and** require a runnable task whose `task` equals the requested name. Verified by RED/GREEN against the captured baseline. |
| Turborepo changes `--dry=json`'s shape or drops `<NONEXISTENT>`, and the guard degrades to a pass. | High | D2 fail-loudly: assert `version === "1"`, `turboVersion` major `2`, `tasks` is an array, every task has string `command` and `task`. Exit code `2` (schema drift) is distinct from `1` (vacuous). `turbo` pinned exactly. |
| `projectService` errors "file not found in any of the projects" on `test/**`, and lint fails before any rule runs. | Medium — blocks the first lint task. | D1.c: `packages/core/tsconfig.test.json` covering `src` + `test` + `bench`. |
| Fixtures are simultaneously required to be committed and to make `turbo run lint` fail — mutually exclusive. | Medium — reads as a spec-scenario failure at verify time. | D1.d three-part resolution: ignore in the main run, Node-API meta-test for the fixtures, plus a transient in-source RED observation that satisfies the scenario. Spec wording flagged, not edited. |
| The isomorphism test is weak: it passes with an unimported DOM reference present. | Medium — the tripwire silently stops being load-bearing. | D5 layer 3: `"lib": ["ES2022"]` with no `DOM`, making a browser global a compile error across all of `src`, not just executed paths. |
| `main: "./dist/index.js"` under `type: module` points a CJS resolver at ESM. | Medium — broken consumer builds, invisible until a real consumer exists. | D4: `main` → `./dist/index.cjs`, `module` → ESM entry, `types` first in `exports`. |
| Hardcoded catalog/strictness lists go stale silently as packages 3–7 land. | Medium — enforcement decays in the passing direction. | D7: derive the governed set from `catalog:` keys and the governed flags from `tsconfig.base.json` keys; read workspace globs from `pnpm-workspace.yaml`. |
| Type-aware lint time grows with the workspace. | Low | Turborepo `lint` caching, already configured with `cache: true`; revisit at change 10 if warm CI lint exceeds a minute. |
| A wall-clock benchmark leaks into `turbo run test` or a coverage job, producing precise-looking noise. | Low here, High downstream | D6: `bench` is not a turbo task and appears nowhere in `ci.yml`; `bench/README.md` distinguishes harness self-tests from workload benchmarks. |
| Group 0's baseline evidence is skipped and RED degrades from observed to assumed. | Medium | `tasks.md` Group 0 already handles this correctly and commits the evidence file as the RED boundary. Retained without change. |

---

## Reconciliation With the Existing `tasks.md`

`tasks.md` (41 tasks, 8 groups) was written before this design. Its **layer ordering is sound** —
Group 0's pristine-baseline capture and Group 1's instruments-before-consumers rule both correctly
diagnose real defects in an earlier revision, and this design keeps them. The deltas below are
therefore surgical, not a rewrite. **Not applied here**; the orchestrator applies them.

### A. Contradictions

| # | Task(s) | Contradiction | Required change |
|---|---|---|---|
| A1 | **1.10** | The guard is specified as "runs `turbo run <task> --summarize` (or parses `--output-logs=full` summary output)" — an unresolved fork, and both branches are rejected by D2. Worse, neither branch names the `<NONEXISTENT>` discriminator, so the guard as written passes against the vacuous baseline it is meant to catch. | Respecify per D2: `--dry=json`, filter `command !== "<NONEXISTENT>"`, require a runnable task whose `task` matches the requested name, plus the four schema assertions with exit `2` for drift. Add a RED sub-observation that a naive `tasks.length > 0` guard passes on the pristine baseline, proving the discriminator is load-bearing. |
| A2 | **0.4, 2.1, 2.2** | These run `pnpm exec tsc --noEmit -p packages/core` and expect a diagnostic on `packages/core/test/fixtures/unchecked-index.ts`. Measured: `packages/core/tsconfig.json` has `"include": ["src/**/*"]`, so that file is not in the project and **no diagnostic is possible** — 0.4 would record `exit=0` for the wrong reason and 2.1's GREEN would never fire. | Insert a task creating `packages/core/tsconfig.test.json` (D1.c) before 0.4, and repoint all three tasks at it (or at a `typecheck` script that runs both projects). |
| A3 | **1.7, 1.9** vs `workspace-toolchain` spec | 1.7/1.9 make the main lint run ignore `**/test/fixtures/**` and assert `turbo run lint` exits `0`; the spec scenario requires `turbo run lint` over the workspace to exit **non-zero** on the `Record<string, any>` pattern. As written the two cannot both hold. | Keep the ignore. Add the transient in-source RED observation from D1.d(3) as a new task after 1.7: insert `Record<string, any>` into `packages/core/src/index.ts`, record the non-zero exit with rule/file/line, revert. Report the spec **wording** issue ("including that fixture" → "including a file containing that pattern") to `sdd-spec`. |
| A4 | **7.3** | Asserts "a cached result must never be able to satisfy the vacuity guard" and re-runs lint with `--force`. D2 decides the opposite: a cache hit **is** an executed task, and the chosen instrument (`--dry=json`) does not execute at all, so `--force` is irrelevant to the guard. | Restate 7.3 as a Turborepo-cache-correctness check (a warm re-run still reports the task and still passes), and delete the "cached must not satisfy the guard" premise. |
| A5 | **2.3** vs `workspace-toolchain` spec | 2.3 asks to confirm `packages/core/tsconfig.json` "adds only local `include`/`exclude`/`paths`"; the file actually sets `outDir` and `rootDir`. Confirmed as written, the task fails on a benign, intentional difference. | Amend 2.3 to permit `outDir`/`rootDir`/`lib` and to check what the spec actually forbids: no `false` override of a base-enabled strictness flag. |

### B. Omissions

| # | Task(s) | Omission | Required change |
|---|---|---|---|
| B1 | Group 1 / 2 | No task creates `packages/core/tsconfig.test.json`. Without it, `projectService` fails on `test/**` (D1.c) and A2 cannot be fixed. | New task in Group 1, before 1.7. |
| B2 | **1.7** | The `no-restricted-syntax` selector list is a single selector. D1.b shows it misses `<never>x`, `satisfies never`, and — most importantly — the `as unknown as` double assertion, the commonest suppression idiom. | Extend to the four selectors in D1.b, each with its own message. |
| B3 | **1.7** | `no-explicit-any` is configured bare. `ignoreRestArgs` defaults matter: left permissive, `(...args: any[])` passes. | Specify `{ "fixToUnknown": false, "ignoreRestArgs": false }`. |
| B4 | Group 2 / D5 | No task sets `"lib": ["ES2022"]` (excluding `DOM`) in `packages/core/tsconfig.json`. This is the *structural* enforcement of CLAUDE.md rule 5; 1.4–1.6 supply only the runtime tripwire. | New task in Group 2 with a RED/GREEN pair: `document.createElement` in `src` is a **compile** error, not just a runtime one. |
| B5 | **3.2** | Says to keep `main`/`types` as fallbacks but not that `main`'s value must change. Today it is `./dist/index.js` under `type: module` — a CJS resolver pointed at ESM. Also omits `module`. | Amend to `main: "./dist/index.cjs"`, add `module: "./dist/index.js"`, and state explicitly that `types` must be the **first** condition in the `exports` object (order is semantic). |
| B6 | **2.4** | The governed dependency list is hardcoded (`vitest \| tsup \| eslint \| typescript-eslint \| typescript`) and the workspace globs are implicit. Both go stale silently in the passing direction as packages 3–7 land. | Derive the governed set from `pnpm-workspace.yaml`'s `catalog:` keys and the package set from its globs (D7). |
| B7 | **2.5** | Hardcodes `strict: false` / `noUncheckedIndexedAccess: false`. | Derive the governed flags from `tsconfig.base.json`'s `compilerOptions` keys (D7). |
| B8 | **4.3, 4.4** | The result schema is `median` / `p95` / `iterations` only. D6 requires `schemaVersion` (so change 16 can refuse an unknown file loudly) and a `runner` block (confirmed decision 3's budget is *self-calibrating on the executing runner*; a baseline without machine identity is not comparable), plus `warmup`. | Extend both tasks to the D6 schema and assert `schemaVersion` and `runner.node` are present. |
| B9 | Group 5 / D2 | No task pins `turbo` to an exact version, yet the guard parses turbo's output. Root `package.json` says `^2.3.0`; installed is **2.10.12**. | New task pinning `turbo` exactly and asserting the guard's `turboVersion` check fires on an unsupported major. |
| B10 | **4.6** | `bench/README.md` covers the CI-informational rule and the C4b cross-reference, but not the distinction that the harness's **own** tests (4.1–4.4, under `test/bench/`) legitimately live in the test run while workload benchmarks never may. Read literally, "no benchmarks in the test run" deletes 4.1–4.4. | Add that distinction to the 4.6 content list. |
| B11 | **3.5** | The side-effects audit test compares the audit against files under `src`. It does not assert the reverse direction, so a file *removed* from `src` but left in the audit passes. | Amend to assert set equality in both directions. |

### C. Pre-emptions (design decided inside the checklist)

| # | Task(s) | Pre-emption | Required change |
|---|---|---|---|
| C1 | `tasks.md` §"Decisions resolved before apply" | The entire linter decision — tool choice, rule set, rejected alternatives, fixture strategy — is argued in `tasks.md`. That is design material in a task list, and it is where A1's under-specified guard and B2/B3's rule gaps hid. | **Delete the section**, replacing it with a one-line pointer: "Lint tooling and the `any` ban are resolved in `design.md` §D1 (with the `as never` selector corrected and extended)." Tasks 1.7–1.9 then reference D1 rather than restating it. |
| C2 | **1.3** | Chooses "a root `vitest.config.ts` with the `node` environment", pre-empting the harness topology. D5 selects a `test.projects`-shaped config specifically so changes 4/5/10/11 add an array entry instead of migrating. | Amend 1.3 to specify the `projects` shape with a single `core` entry, citing D5. |
| C3 | **1.10** | "(or parses `--output-logs=full` summary output)" leaves a genuine instrument choice unresolved inside a task — the same defect the checklist's own preamble criticises in the old 2.4/2.5. | Remove the fork; D2 decides it. |
| C4 | **4.2** | "Keep it out of the published build" states the constraint without the mechanism. | Specify the mechanism: `bench/` lives outside `src/`, so `tsup` never sees it; it is typechecked and linted via `tsconfig.test.json`. |

### D. Confirmed sound — retain unchanged

Group 0 in full (the pristine-baseline evidence commit and its RED-boundary framing); the
instruments-before-consumers ordering of Group 1; 1.4–1.6 (the DOM tripwire RED/GREEN with the
fixture kept committed and unimported); 1.8's inverted-assertion trick for proving the meta-test is
not vacuous; 3.1; 3.3 and its RED evidence; 3.4 (no root `exports`); 4.1/4.2's cold-sample RED;
4.5's `bench`-is-not-`test` separation; 5.1–5.4; 6.1; 7.1; and 7.2's Group-0-pairing audit.

---

## Return Envelope

**Status**: success
**Summary**: Wrote `design.md` resolving all seven open decisions (lint tooling and the `any` ban,
the vacuity guard, build topology, entry points, test-harness topology, benchmark boundaries,
catalog discipline), relocating and correcting the linter decision that was living in `tasks.md`,
and reconciled the design against the pre-existing 41-task checklist. Measurement during design
found that a naive vacuity guard passes against the exact defect this change corrects.
**Artifacts**: `openspec/changes/workspace-test-harness-bootstrap/design.md`
**Next Recommended**: `sdd-tasks` (to apply the 20 reconciliation deltas), then `sdd-apply`.
**Risks**: The guard's `<NONEXISTENT>` discriminator is the load-bearing correction and depends on
an undocumented Turborepo dry-run field — mitigated by loud schema assertions and an exact `turbo`
pin. One spec **wording** conflict (`workspace-toolchain`, the `Record<string, any>` fixture
scenario) needs `sdd-spec` attention; the design satisfies its intent without editing it.
