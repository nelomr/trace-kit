# Toolchain probe: Vitest 3.2.7 → 5.0.1 config behaviour

Date: 2026-09-16
Class: local empirical evidence (first-party measurement, not a cited source)
Method: isolated scratch workspace, one package, one test writing `process.execArgv`,
`typeof globalThis.gc` and `process.cwd()` to a file. Identical config run against
`vitest@3.2.7` and `vitest@5.0.1` by reinstalling in place; only the version varied.

This probe was run because `proposal.md` risk R3 flagged two behaviours that the root
`vitest.config.ts` encodes as empirically-established facts about 3.2.7, and warned that a
silent regression in either would disable the zero-GC allocation gate (CLAUDE.md rule 2).
Both were re-measured rather than assumed.

## Behaviour 1 — `--expose-gc` delivery to the forked worker

| Config shape | 3.2.7 | 5.0.1 |
|---|---|---|
| `poolOptions.forks.execArgv` on a **project** entry | flag absent, `gc` undefined | flag absent, `gc` undefined |
| `poolOptions.forks.execArgv` on the **top-level** `test` object | flag present, `gc` is a function | **flag absent, `gc` undefined** |
| `test.execArgv` on the **top-level** `test` object | — | flag present, `gc` is a function |
| `test.execArgv` on a **project** entry | — | flag present, `gc` is a function |

Findings:

- **F1.** The root config's comment is accurate for 3.2.7: a project-scoped
  `poolOptions.forks.execArgv` is resolved but never reaches the forked worker, which is why
  `--expose-gc` is hoisted to the top-level `test` object.
- **F2.** Vitest 5 restructured pool configuration. `poolOptions` is gone from the config
  type; `pool` now accepts a `PoolRunnerInitializer` and `execArgv` is a direct member of the
  test config object. **The existing top-level hoist therefore stops working on 5.x** — the
  option is not renamed-with-warning, it is simply no longer read.
- **F3.** The migration is mechanical: `poolOptions: { forks: { execArgv: [...] } }` becomes
  `execArgv: [...]` on the same object.
- **F4.** The 3.2.7 limitation that forced the hoist is **fixed** in 5.x: a project-scoped
  `execArgv` now propagates correctly. The hoist is no longer required, so `--expose-gc` can
  be scoped to the projects that actually need it instead of being applied workspace-wide.
- **F5.** The regression would be **loud, not silent**. Repository tests assert the flag's
  effect directly rather than skipping without it — `packages/core/test/viewport/transform-allocation.test.ts:17`
  and `packages/core/test/decimation/allocation-gate.test.ts:20` assert
  `typeof globalThis.gc === "function"`, and `packages/renderers/test/node/allocation-gate.test.ts:66`
  throws `"run with --expose-gc"`. Proposal risk R3's "silently disable the gate" wording
  should be corrected: the gate fails the suite.

## Behaviour 2 — relative project `root` resolution

Config with `root: "pkg-a"` (relative), invoked with cwd set to `pkg-a` — the shape Turborepo
produces when running a per-package `"test": "vitest run"` script:

| | 3.2.7 | 5.0.1 |
|---|---|---|
| Result | `No test files found, exiting with code 1` | `Test Files 1 passed (1)` |

Findings:

- **F6.** The root config's second documented hazard is also accurate for 3.2.7: a relative
  project `root` resolves against the invocation cwd, doubling the path and matching zero test
  files. This is why every project `root` is built absolutely from `import.meta.url`.
- **F7.** 5.0.1 resolves the relative root correctly under the same invocation. The absolute-root
  construction is no longer load-bearing, though it remains harmless and self-documenting.
- **F8.** This failure mode is also loud — a non-zero exit, not a green vacuous pass.

## Consequences for this change

1. The Vitest upgrade must rewrite the root config's pool block, not merely bump the catalog
   version. This is a required, non-optional task. [F2, F3]
2. Both 3.2.7 workarounds the config carries become obsolete on 5.x. Whether to remove them or
   leave them in place is a design decision, but the long explanatory comments above them will
   otherwise describe behaviour that no longer exists. [F4, F7]
3. The browser project can carry its own `execArgv` and pool settings without disturbing the
   node projects, which removes the proposal's open question about how a browser project
   coexists with a workspace-wide `pool: "forks"` block. [F4]
4. Proposal risk R3 should be downgraded from "silent regression" to "loud failure with a
   known fix", on the evidence of F5 and F8.

---

# Toolchain probe, part 2: the P8 upgrade against the real repository

Date: 2026-09-16
Class: local empirical evidence (first-party measurement)
Method: detached `git worktree` at `HEAD` (`4cb0872`) in a scratch directory, so the working
repository was never modified. Catalogue entries edited, `pnpm install --no-frozen-lockfile`,
then `turbo run build`, `turbo run typecheck`, `turbo run lint` and `pnpm run test` at each step.
Variables changed one at a time to attribute each failure.

Run because `proposal.md` R10 recorded that the concrete edits ESLint 10 and the TypeScript major
would require were "only knowable by running the tools". They have now been run.

## Result summary

| Component | Verdict |
|---|---|
| `eslint` 9 → `10.10.0` + `typescript-eslint` `8.70.0` | **Clean.** Full `turbo run lint` green with no source or config edits. |
| `@types/node` 22 → `26.5.1` / `26.6.1` | **Clean.** Caused no failure at either version. |
| `typescript` 5.9.3 → `6.0.3` | **Three distinct failures**, all with fixes. See below. |
| `typescript` → `7.0.2` | **Rejected**, see part 1 and `preproposal.md` P8. |
| Test suite | **293 tests pass** under the upgraded toolchain. |

## Findings

- **F9 — ESLint 10 needs no work.** With `typescript@5.9.3` held constant, `eslint@10.10.0` plus
  `typescript-eslint@8.70.0` runs `turbo run lint` to completion with zero problems. None of the
  three new `eslint:recommended` rules fires on this codebase, and the flat config at
  `eslint.config.js` needs no migration. Risk R10's ESLint half is closed as a non-event.

- **F10 — `@types/node` 26 is not implicated in any failure.** Both `26.5.1` and `26.6.1` were
  installed; neither changed any outcome. The `26.6.1` variant is noted only because P7's
  two-day window excludes it (published 2026-09-15); `26.5.1` is the target and is sufficient.

- **F11 — `typescript@6.0.3` fails the build through `tsup`, not through repository config.**
  `turbo run build` fails with `error TS5101: Option 'baseUrl' is deprecated and will stop
  functioning in TypeScript 7.0`. No `tsconfig` in this repository sets `baseUrl`. The source is
  `tsup`'s bundled declaration build, which hardcodes it:
  `node_modules/.../tsup/dist/rollup.js:6837` — `baseUrl: compilerOptions.baseUrl || "."`.
  `tsup@8.5.1` is the newest published release (2025-11-12), so there is no upstream fix to wait
  for. Adding `"ignoreDeprecations": "6.0"` to `tsconfig.base.json` clears it and the build
  succeeds. That is a suppression with a shelf life: the same option stops functioning entirely
  in TypeScript 7.

- **F12 — `typescript@6.0.3` requires `allowImportingTsExtensions` in the playground.**
  `turbo run typecheck` fails with three instances of `error TS5097: An import path can only end
  with a '.ts' extension when 'allowImportingTsExtensions' is enabled`, at
  `apps/playground/src/shell/bootstrap.ts:8` and `apps/playground/src/views/index.ts:3-4`. Those
  imports are unchanged and pass under 5.9.3. Adding `"allowImportingTsExtensions": true` to
  `apps/playground/tsconfig.json` clears it and is legal there, since that config already sets
  `"noEmit": true`. Typecheck then passes across all five projects.

- **F13 — `typescript@6.0.3` breaks `typescript-eslint`'s `projectService` default-project
  fallback.** `turbo run lint` reports **29 errors** across `packages/core/bench/index.ts`,
  `runner.ts` and `trace-deopt.ts` — all of the form "Unsafe call of a type that could not be
  resolved" / "Unsafe member access `.argv` on a type that cannot be resolved", on ordinary Node
  globals. These are false positives from unresolved types, not real defects:

  - `tsc --noEmit -p packages/core/tsconfig.test.json` exits **0** under the same TypeScript
    6.0.3. The project compiles; only the linter's view of it is broken.
  - The same lint run under `typescript@5.9.3` is clean, with ESLint and `typescript-eslint` held
    constant. TypeScript is the only variable.
  - `typescript-eslint@8.70.0` declares `typescript: >=4.8.4 <6.1.0`, so 6.0.3 is *nominally*
    inside its supported range. The breakage is silent rather than refused — unlike 7.0.2, which
    refuses loudly.
  - **A fix exists and was verified.** Linting the same files through the classic
    `parserOptions.project` mode, pointed at `packages/core/tsconfig.test.json`, exits **0** under
    TypeScript 6.0.3. The failure is specific to `projectService`'s `defaultProject` fallback,
    which `eslint.config.js` currently relies on for every `test/**` and `bench/**` file.

- **F14 — the upgraded toolchain passes the suite.** `pnpm run test` reports 293 tests passing
  under `typescript@6.0.3`, `eslint@10.10.0`, `typescript-eslint@8.70.0` and
  `@types/node@26.6.1`.

- **F15 — the root `package.json` pins `typescript` outside the catalogue.** It declares
  `"typescript": "^5.7.0"` literally while every workspace package uses `"typescript": "catalog:"`.
  The root therefore does not follow the catalogue and can drift from it silently; the first
  install of this probe left the root on 5.9.3 while the catalogue said 6.0.3. Changing it to
  `"catalog:"` fixes it. This is a pre-existing defect, unrelated to the upgrade, found while
  performing it.

- **F16 — D5's premise reconfirmed independently.** `pnpm run test` reports `@trace-kit/core` and
  `@trace-kit/renderers` each running **72 test files / 293 tests** — identical totals, because
  both execute the entire workspace suite. This is the same finding D5's `--project` filters
  address, observed here from a different angle.

## Consequence

The ESLint 10 and `@types/node` 26 halves of P8 are free. The TypeScript 6 half is not: it costs a
`tsconfig` suppression with a known expiry (F11), one compiler-option addition (F12), and a
rework of how `eslint.config.js` associates `test/**` and `bench/**` with a TypeScript project
(F13). None is a blocker; together they are a decision, and it is recorded in `design.md`.

---

# Toolchain probe, part 3: testing D13's alternatives

Date: 2026-09-16
Method: same detached worktree, `typescript@6.0.3`, `eslint@10.10.0`,
`typescript-eslint@8.70.0`. D13 offered three shapes for giving `test/**` and `bench/**` a
TypeScript project. Two were unmeasured. They were measured.

## F17 — `projectService` fails under TypeScript 6.0.3 regardless of how the project is supplied

A real `tsconfig.json` was added inside `packages/core/bench/`, extending the package's own
config, so ordinary upward discovery would find it — D13's second alternative.

- With the stale `packages/core/bench/*.ts` entry still in `allowDefaultProject`, the service
  reports the new config as a conflict: *"was included by allowDefaultProject but also was found
  in the project service. Consider removing it from allowDefaultProject"*. The tsconfig **is**
  discovered.
- With that entry removed, so the files reach the service only through the discovered tsconfig,
  the result is **the identical 29 errors** on the identical lines.

The variable is not how the project is provided. It is `projectService` itself: under
`typescript@6.0.3` it constructs a program that cannot resolve `@types/node`, whether the project
comes from `defaultProject`, from `allowDefaultProject`, or from a discovered `tsconfig.json`.

**Consequence for D13.** The second alternative (a `tsconfig.json` per tree) is not merely
unmeasured, it is **refuted**. The third (extending each package's `tsconfig.json` `include`) uses
the same discovery mechanism this test exercised and falls to the same cause, without needing its
own run. Classic `parserOptions.project` — which exits `0` under the same compiler (part 2, F13) —
is the only shape that works, so D13 is not a choice between three options. It has one answer.

## F18 — classic `parserOptions.project` is not deprecated

`ParserOptions.project` carries no `@deprecated` tag in the installed
`@typescript-eslint/types` declarations, while a neighbouring option in the same interface does.
The "legacy mode upstream is moving away from" cost recorded against the recommendation is a
stated direction, not a deprecation, and the recommendation should not be discounted for it.

## Bearing on the eventual TypeScript 7 upgrade

TypeScript 7 is blocked by two things, neither of which D13 touches: `tsup` hardcoding `baseUrl`
(F11), and `typescript-eslint` refusing TypeScript 7 outright (part 1). Whichever shape this
change adopts must be revisited when the second is fixed, since a `projectService` repaired for
TypeScript 7 is the natural destination. The classic-mode change is confined to
`eslint.config.js`'s `languageOptions.parserOptions` block, so that return trip is a single block
swap — the smallest carry-forward of the three shapes, and the only one that works today.
