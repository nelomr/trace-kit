# Capability: workspace-toolchain

> Change: `workspace-test-harness-bootstrap`. New capability.

## ADDED Requirements

### Requirement: Catalog-Pinned Dependency Versions
The workspace MUST declare a single pnpm catalog in `pnpm-workspace.yaml` covering every
harness dependency (`vitest`, `tsup`, the chosen linter, and the benchmark-harness
dependencies), and every package MUST resolve these dependencies via `catalog:` protocol rather
than an independently pinned version range.

#### Scenario: A package resolves vitest from the catalog
- **GIVEN**: `pnpm-workspace.yaml` declares `vitest` in its `catalog`
- **WHEN**: `packages/core/package.json` declares a `devDependencies.vitest` entry
- **THEN**: the entry's version specifier is exactly `catalog:`, verified by a repository lint
  script (`pnpm run lint`) that fails if any workspace package pins its own `vitest`,
  `tsup`, or linter version instead of `catalog:`

#### Scenario: The catalog is complete before any consumer needs it
- **GIVEN**: this change adds `tsup` and the benchmark-harness dependencies as new workspace
  needs
- **WHEN**: `pnpm install` runs at the repository root
- **THEN**: `pnpm install` succeeds with no "not found in catalog" resolution error for any
  dependency referenced by a package as `catalog:`

### Requirement: Completed Base TypeScript Configuration
`tsconfig.base.json` MUST retain its existing options (`target: ES2022`, `module: ESNext`,
`moduleResolution: bundler`, `strict: true`, `declaration`, `declarationMap`, `sourceMap`,
`isolatedModules`) and MUST add `noUncheckedIndexedAccess: true`, because every downstream
change in this plan indexes typed arrays where an unchecked index silently produces `undefined`
inside a numeric hot loop.

> Scenario corrected against measured repository state. `packages/core/tsconfig.json` declares
> `"include": ["src/**/*"]`, so `tsc --noEmit -p packages/core` never reads anything under
> `test/`. The previous wording would have been satisfied by an `exit 0` obtained for the wrong
> reason — the compiler not seeing the fixture at all — which is indistinguishable from a genuine
> pass by exit code alone. The fixture must be compiled through a config that includes it.

#### Scenario: noUncheckedIndexedAccess rejects an unchecked typed-array read
- **GIVEN**: a fixture file under `packages/core/test/fixtures/` that reads `buf[i]` from a
  `Float32Array` and assigns the result to a `number` (not `number | undefined`) without a guard,
  and a `packages/core/tsconfig.test.json` that extends the package config and whose `include`
  covers `test/**/*`
- **WHEN**: `tsc --noEmit -p packages/core/tsconfig.test.json` runs
- **THEN**: the compiler reports a type error on that exact file and line, because the indexed
  access is typed as `number | undefined`

#### Scenario: The fixture is genuinely in the compiled file set
- **GIVEN**: the same `tsconfig.test.json`
- **WHEN**: `tsc -p packages/core/tsconfig.test.json --listFiles` runs
- **THEN**: the fixture's path appears in the listed file set. This MUST be asserted separately,
  because an absent file and a clean file both produce `exit 0`.

### Requirement: Per-Package tsconfig Extension Pattern
Every package `tsconfig.json` MUST extend `tsconfig.base.json` at the repository root and MUST
add only `compilerOptions.paths`, output-location options (`outDir`, `rootDir`) and
package-local `include`/`exclude`; it MUST NOT redeclare or relax any strictness flag set by the
base config. (`outDir` and `rootDir` are named explicitly because `packages/core/tsconfig.json`
already sets both, and an earlier wording that allowed "only `paths`/`include`/`exclude`"
contradicted the file it describes.)

#### Scenario: A package tsconfig cannot relax strict
- **GIVEN**: `packages/core/tsconfig.json` extends `../../tsconfig.base.json`
- **WHEN**: a reviewer inspects `packages/core/tsconfig.json` for a `compilerOptions.strict` or
  `compilerOptions.noUncheckedIndexedAccess` override
- **THEN**: a repository CI step (`pnpm exec turbo run lint`) fails if any package
  `tsconfig.json` sets `strict: false` or `noUncheckedIndexedAccess: false`

### Requirement: Mechanically Enforced `any` Ban
The lint configuration MUST mechanically reject every form of `any` banned by CLAUDE.md rule 1
— `: any`, `as any`, `<any>`, `Record<string, any>` (and the general `, any>` shape), and
`as never` used to suppress a type error — rather than relying on manual review.

> Scenario mechanism corrected against `design.md` §D1. An earlier revision of these scenarios
> asserted that `pnpm exec turbo run lint` over the workspace "including that fixture" exits
> non-zero. That is not satisfiable together with keeping the fixtures committed: the design
> excludes `**/test/fixtures/**` from the main run precisely so the negative fixtures do not make
> every ordinary lint invocation fail. The enforcement is asserted instead through ESLint's Node
> API against the exact fixture files, and the main run is asserted clean. Both halves are
> required — the ban must be provably live, and it must not break ordinary linting.

#### Scenario: The `any` ban fires on a `Record<string, any>` fixture
- **GIVEN**: a committed fixture file `packages/core/test/fixtures/lint-any.ts` declaring
  `type Bad = Record<string, any>;`, and the root `eslint.config.js` excluding
  `**/test/fixtures/**` from the default run
- **WHEN**: the lint meta-test invokes ESLint's Node API (`new ESLint({ ... }).lintFiles([...])`)
  against that exact file path
- **THEN**: the returned result reports at least one error whose `ruleId` is
  `@typescript-eslint/no-explicit-any`, naming that file and line

#### Scenario: The suppression ban fires on `as never` and on `as unknown as`
- **GIVEN**: committed fixture files performing `(value as never)` to silence a type mismatch,
  and `(value as unknown as Target)` to launder an incompatible type
- **WHEN**: the lint meta-test invokes ESLint's Node API against those exact file paths
- **THEN**: each reports at least one error whose `ruleId` is `no-restricted-syntax`. Banning
  `as never` while leaving `as unknown as` reachable would prohibit the rare escape and permit
  the common one, so both MUST be covered.

#### Scenario: The meta-test is provably live rather than vacuous
- **GIVEN**: the lint meta-test as written
- **WHEN**: the `@typescript-eslint/no-explicit-any` rule is temporarily removed from
  `eslint.config.js`
- **THEN**: the meta-test fails. A gate that cannot fail asserts nothing, and this repository's
  starting state (CI reporting green over tasks it never executed) is what that failure mode
  looks like in practice.

#### Scenario: The main lint run enforces the ban on real source
- **GIVEN**: the fixture exclusion in place, so the Node-API meta-test covers only
  `packages/core/test/fixtures/**`
- **WHEN**: `type Bad = Record<string, any>;` is temporarily inserted into
  `packages/core/src/index.ts` and `pnpm exec turbo run lint` runs
- **THEN**: it exits non-zero, naming `@typescript-eslint/no-explicit-any`, the file and the
  line; and on reverting the insertion it exits `0` again. The meta-test proves the RULES are
  live against fixtures, and this scenario proves the DEFAULT RUN is live against real source —
  excluding the fixtures must not silently exclude enforcement everywhere.

#### Scenario: Ordinary linting stays clean with the fixtures committed
- **GIVEN**: every negative fixture committed under `packages/core/test/fixtures/`
- **WHEN**: `pnpm exec turbo run lint` runs over the workspace
- **THEN**: it exits `0` and reports at least one executed lint task — the fixtures are excluded
  from the default run, so they neither fail it nor make it vacuous
