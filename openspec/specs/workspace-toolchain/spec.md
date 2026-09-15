# Capability: workspace-toolchain

> Changes: `workspace-test-harness-bootstrap` (initial), `workspace-guard-scripts-cleanup` (enforcement
> mechanism update + new requirements for changelog and changeset scripts), `playground-shell`
> (extended catalog coverage and `tsconfig` rules to `apps/*` members, added the `turbo.json`
> `dev` task).

## ADDED Requirements

### Requirement: Catalog-Pinned Dependency Versions
The workspace's pnpm catalog, declared in `pnpm-workspace.yaml`, MUST cover every runtime
dependency an `apps/*` member consumes, not only `packages/*` harness dependencies. **This change
adds `tweakpane`** — required by `playground-instrumentation-panel` — to the `catalog:` block,
and `apps/playground/package.json` MUST resolve it via `catalog:` rather than an independently
pinned version range, exactly as `packages/*` members already resolve `vitest`, `tsup` and the
other catalog entries.

#### Scenario: apps/playground resolves tweakpane from the catalog
- **GIVEN**: `pnpm-workspace.yaml`'s `catalog:` block declares a `tweakpane` entry
- **WHEN**: `apps/playground/package.json` declares a `dependencies.tweakpane` entry
- **THEN**: the entry's version specifier is exactly `catalog:`, not a bare semver range

#### Scenario: An apps/* member resolves a third-party dependency through the catalog exactly as a packages/* member does
- **GIVEN**: `pnpm-workspace.yaml`'s `packages:` globs match both `packages/*` and `apps/*`
  directories
- **WHEN**: `pnpm install` runs at the repository root with `apps/playground/package.json`
  declaring `tweakpane: catalog:`
- **THEN**: `pnpm install` resolves `tweakpane` for `apps/playground` from the same
  `catalog:` block used by every `packages/*` member, with no "not found in catalog" error and
  no `apps/*`-specific resolution path

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
add only `compilerOptions.paths` and package-local `include`/`exclude`, and it MUST NOT
redeclare or relax any strictness flag set by the base config. **This now explicitly includes
`apps/*` workspace members, not only `packages/*`, and an `apps/*` member is not published and
therefore carries no `exports` map and no `sideEffects` audit obligation.**

#### Scenario: apps/playground extends the base tsconfig like a package does
- **GIVEN**: `apps/playground/tsconfig.json`
- **WHEN**: its `extends` field and `compilerOptions` are inspected
- **THEN**: it extends `tsconfig.base.json`, adds only `paths`/`include`/`exclude`, and does not
  relax `strict` or `noUncheckedIndexedAccess`

#### Scenario: apps/playground carries no exports map obligation
- **GIVEN**: `apps/playground/package.json`
- **WHEN**: a repository lint/CI step that enforces the `package-build-pipeline` exports-map
  requirement runs
- **THEN**: it does not fail for `apps/playground` lacking an `exports` field, because that
  requirement is scoped to publishable `packages/*` members

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

### Requirement: Changelog Package List Derived from Workspace Globs
`scripts/sync-root-changelog.mjs` MUST derive the list of packages it checks for changelog
entries from `pnpm-workspace.yaml`'s `packages:` globs (resolving each matched directory's
`package.json` name), rather than from a hardcoded array of package names and paths.

#### Scenario: A newly added workspace package is picked up without editing the script
- **GIVEN**: `pnpm-workspace.yaml`'s `packages:` globs match a package directory not present in
  any hardcoded list inside `scripts/sync-root-changelog.mjs`
- **WHEN**: `node scripts/sync-root-changelog.mjs` runs after that package's `CHANGELOG.md` was
  modified by Changesets
- **THEN**: the script includes that package's changelog entry in the root `CHANGELOG.md`
  summary without requiring any change to `scripts/sync-root-changelog.mjs` itself

#### Scenario: A package matched by the workspace globs but without a CHANGELOG.md is skipped, not errored
- **GIVEN**: a directory matched by `pnpm-workspace.yaml`'s `packages:` globs that has no
  `CHANGELOG.md` yet
- **WHEN**: `node scripts/sync-root-changelog.mjs` runs
- **THEN**: the script completes without throwing, omitting that package from the summary

### Requirement: Changeset Message Is a Required Argument
`scripts/add-changeset.mjs` MUST require an explicit message argument and MUST NOT default to a
placeholder summary string. If invoked without a message argument, it MUST exit with a non-zero
status and print a usage message, and it MUST NOT write a `.changeset/*.md` file.

#### Scenario: Running without a message fails instead of writing a placeholder changeset
- **GIVEN**: the `.changeset/` directory in its current state
- **WHEN**: `node scripts/add-changeset.mjs` runs with no arguments
- **THEN**: the process exits with a non-zero status code, prints a usage message to stderr, and
  no new file is created under `.changeset/`

#### Scenario: Running with a message still writes the changeset as before
- **GIVEN**: the `.changeset/` directory in its current state
- **WHEN**: `node scripts/add-changeset.mjs "fix: correct decimation edge case" patch @trace-kit/core` runs
- **THEN**: the process exits `0` and a new `.changeset/*.md` file is written whose body is
  exactly `"fix: correct decimation edge case"`, with no placeholder text

### Requirement: turbo.json Gains a dev Task for Long-Running Dev Servers
`turbo.json` MUST declare a `dev` task suitable for a long-running process such as a Vite dev
server: persistent (does not terminate on its own) and uncached (its output is not a build
artifact to be cached across runs). `turbo.json` declares no `dev` task prior to this change.

#### Scenario: turbo.json declares a dev task shaped for a persistent, uncached process
- **GIVEN**: `turbo.json` as modified by this change
- **WHEN**: its `tasks` object is inspected
- **THEN**: it contains a `dev` entry whose configuration marks it as persistent and uncached
  (not sharing the `outputs`-based caching of `build`)
