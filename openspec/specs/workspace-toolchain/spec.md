# Capability: workspace-toolchain

> Changes: `workspace-test-harness-bootstrap` (initial), `workspace-guard-scripts-cleanup` (enforcement
> mechanism update + new requirements for changelog and changeset scripts), `playground-shell`
> (extended catalog coverage and `tsconfig` rules to `apps/*` members, added the `turbo.json`
> `dev` task), `browser-visual-regression-harness` (Vitest 3→5 major upgrade, freshness policy,
> TypeScript 6 migration, deprecation fixes, root typescript pin, three TypeScript 6 edits, and
> eslint.config.js reshaping for TypeScript 6 projectService fix).

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

### Requirement: The Catalog-Pinned Vitest Line Moves From 3.x to 5.x
`pnpm-workspace.yaml`'s `catalog:` entries for `vitest` and `@vitest/coverage-v8` MUST move from
the `^3.0.0` line to a `5.x` version — specifically the exact target `5.0.0` named by
`preproposal.md` **P8**, not `5.0.1`, which fails the freshness window in
`Every Catalogued Dependency Tracks the Newest Stable Release at Least Two Days Old` below — and
every package that consumes `vitest: catalog:`
(currently `packages/core`, `packages/renderers`, `apps/playground`) MUST continue resolving
through `catalog:` rather than an independently pinned range. Browser-provider packages required
by Vitest 5's browser mode (e.g. the Playwright provider package) MUST be added to the catalog
under the same discipline.

#### Scenario: The catalog's vitest entry resolves to a 5.x version
- **GIVEN**: `pnpm-workspace.yaml`'s `catalog:` block after this change
- **WHEN**: the `vitest` entry is inspected
- **THEN**: its version specifier resolves to a `5.x` release, not `^3.0.0`

#### Scenario: Every existing vitest consumer still resolves via catalog:
- **GIVEN**: `packages/core/package.json`, `packages/renderers/package.json`, and
  `apps/playground/package.json`
- **WHEN**: their `vitest` devDependency entries are inspected
- **THEN**: each is exactly `catalog:`, and `pnpm install` resolves all three to the identical
  5.x version with no "not found in catalog" error

#### Scenario: The browser provider package is catalog-pinned, not independently ranged
- **GIVEN**: `packages/renderers/package.json`'s new Playwright-provider devDependency
- **WHEN**: its version specifier is inspected
- **THEN**: it is `catalog:`, resolving from an entry declared in `pnpm-workspace.yaml`

### Requirement: The `execArgv` Configuration Migrates From `poolOptions.forks.execArgv` to `test.execArgv`, Scoped Down
The root `vitest.config.ts`'s top-level `poolOptions.forks.execArgv: ["--expose-gc"]` hoist MUST
be rewritten as `test.execArgv` (or the equivalent project-scoped `execArgv` member Vitest 5
reads directly), and MUST be scoped only to the project(s) that require `--expose-gc` for their
zero-GC allocation gates, rather than applied workspace-wide. Reason: on Vitest 5, `poolOptions`
is removed from the config type and a top-level `poolOptions.forks.execArgv` hoist is silently
unread (**F2**); the 3.2.7 limitation that forced the workspace-wide hoist (a project-scoped
`execArgv` not propagating) is fixed on 5.x (**F4**), so the narrower, scoped form is both
required and now possible.

#### Scenario: No poolOptions.forks.execArgv hoist remains at the top level
- **GIVEN**: the root `vitest.config.ts` after this change
- **WHEN**: the top-level `test` object is inspected
- **THEN**: it contains no `poolOptions` field

#### Scenario: --expose-gc is scoped to the projects whose allocation gates need it
- **GIVEN**: the projects containing the zero-GC allocation-gate tests (
  `packages/core/test/viewport/transform-allocation.test.ts`,
  `packages/core/test/decimation/allocation-gate.test.ts`,
  `packages/renderers/test/node/allocation-gate.test.ts`)
- **WHEN**: each project's own configuration is inspected
- **THEN**: it declares `execArgv: ["--expose-gc"]` directly on that project entry

#### Scenario: The allocation-gate tests still pass with the scoped configuration
- **GIVEN**: the rewritten configuration
- **WHEN**: `packages/core/test/viewport/transform-allocation.test.ts` and
  `packages/core/test/decimation/allocation-gate.test.ts` run
- **THEN**: `typeof globalThis.gc === "function"` holds true inside them, and they pass exactly
  as they did under the 3.2.7 workspace-wide hoist

#### Scenario: A project that does not need --expose-gc does not declare it
- **GIVEN**: a project entry with no allocation-gate test (e.g. the new browser-mode project)
- **WHEN**: its configuration is inspected
- **THEN**: it declares no `execArgv: ["--expose-gc"]` entry

### Requirement: The Obsolete Relative-Root Workaround Comment Is Rewritten, Not the Construction Itself
Every project's absolute `root` construction (via `path.join(rootDir, ...)` from
`import.meta.url`) MUST be retained unchanged in behavior. The explanatory comment above it,
which currently describes the 3.2.7 hazard where a relative `root` resolves against the wrong
invocation cwd, MUST be rewritten to state that the underlying 3.2.7 hazard no longer reproduces
on 5.x (**F7**) and that the absolute construction is retained as a harmless, self-documenting
practice rather than a required workaround.

#### Scenario: Absolute root construction is unchanged in behavior
- **GIVEN**: any project entry's `root` field
- **WHEN**: it is inspected
- **THEN**: it is still computed via `path.join(rootDir, ...)` (or equivalent) from
  `import.meta.url`, not a bare relative string literal

#### Scenario: The comment no longer describes a live 3.2.7-only hazard as current behavior
- **GIVEN**: the comment block above the `root` construction in `vitest.config.ts`
- **WHEN**: its text is read
- **THEN**: it does not assert, as a property of the currently installed Vitest version, that a
  relative `root` silently resolves against the wrong cwd — it states that this was a 3.2.7
  behavior, fixed on 5.x, and that the absolute construction is now a defensive default rather
  than a required fix

### Requirement: The Vitest 3 → 5 Upgrade Crosses Only the Breaking Changes Concentrated on Browser Mode
The upgrade MUST account for the v4 breaking changes that land on browser mode specifically
(**C4**): browser provider packages split into separate packages, a provider factory replacing a
provider string, and `environment: "browser"` becoming forbidden. No other workspace project's
`environment` configuration (`node` for `core`/`renderers`, `happy-dom` for
`renderers-dom`/`playground`) MUST change as a consequence of this upgrade.

#### Scenario: Non-browser projects' environment values are unaffected by the major upgrade
- **GIVEN**: the `core`, `playground`, `renderers`, and `renderers-dom` project entries after the
  Vitest 5 upgrade lands
- **WHEN**: their `environment` fields are compared against their pre-upgrade values
- **THEN**: no difference is found; only the new browser-mode project is shaped by the v4
  breaking changes

### Requirement: Every Catalogued Dependency Tracks the Newest Stable Release at Least Two Days Old
Every entry in `pnpm-workspace.yaml`'s `catalog:` block, and every direct dependency version
declared in the root `package.json`, MUST resolve to the newest **stable** release of that package
that was published at least **two days** before the change's declared version cutoff. A
prerelease, release candidate or beta dist-tag MUST NOT be selected for any entry. A release
younger than the two-day window MUST NOT be selected even when it is the newest stable release;
the newest qualifying release is selected instead.

#### Scenario: No catalogued version is a prerelease
- **GIVEN**: `pnpm-workspace.yaml`'s `catalog:` block and the root `package.json` after this
  change
- **WHEN**: every declared version specifier is inspected
- **THEN**: none contains a prerelease identifier — no `-rc.`, `-beta`, `-alpha`, `-next` or
  `-dev` segment appears in any of them

#### Scenario: A stable release younger than two days is not selected
- **GIVEN**: the `vitest` catalogue entry, where `5.0.1` is the newest stable release but was
  published 2026-09-15, less than two days before this change's 2026-09-14 cutoff, and `5.0.0`
  was published 2026-09-03
- **WHEN**: the selected version is inspected
- **THEN**: it is `5.0.0` — the newest stable release satisfying the two-day window — and it is
  not `5.0.1`

#### Scenario: The newest stable release is not read off the `latest` dist-tag
- **GIVEN**: the `@types/node` catalogue entry, for a package whose published `latest` dist-tag
  is `22.20.3` while stable `26.x` releases exist
- **WHEN**: the selected version is inspected
- **THEN**: it is a `26.x` release, not the `latest`-tagged `22.20.3` — establishing that the
  policy is over published stable releases, not over the `latest` dist-tag

### Requirement: The Catalogue Resolves to the Declared P8 Target Versions
`pnpm-workspace.yaml`'s `catalog:` block MUST resolve each of the following packages to the
version named in `preproposal.md` **P8**: `@types/node` `26.5.1`, `typescript` `6.0.3`, `eslint`
`10.10.0`, `vitest` `5.0.0`, `@vitest/coverage-v8` `5.0.0`, `typescript-eslint` `8.70.0`, `vite`
`8.3.0`, `happy-dom` `20.14.5`, `fast-check` `4.10.0`, `playwright` `1.63.0`,
`@vitest/browser-playwright` `5.0.0` and `pixelmatch` `7.2.0`; the root `package.json`'s `turbo`
dependency MUST resolve to `2.10.13`. The repository's Node version declarations
(`engines.node`, `.nvmrc`, and `node-version` in `.github/workflows/ci.yml` and
`.github/workflows/release.yml`) MUST remain at their current, already-consistent value of 24 and
MUST NOT be changed by this work.

#### Scenario: pnpm resolves each catalogued package to its declared target
- **GIVEN**: the repository after `pnpm install --frozen-lockfile`
- **WHEN**: `pnpm ls --depth 0 --json` (or `pnpm-lock.yaml`) is inspected for each package named
  above
- **THEN**: each resolves to exactly the version named for it, with no package resolving to a
  version from its previous major line

#### Scenario: Node version declarations are untouched
- **GIVEN**: `package.json`'s `engines.node`, `.nvmrc`, and the `node-version` inputs in
  `.github/workflows/ci.yml` and `.github/workflows/release.yml`
- **WHEN**: they are diffed against their pre-change values
- **THEN**: no difference is found; all four still declare Node 24

#### Scenario: The workspace builds, typechecks, lints and tests at the target versions
- **GIVEN**: the workspace with every target version installed
- **WHEN**: `pnpm exec turbo run typecheck`, `pnpm exec turbo run lint`, `pnpm run test` and
  `pnpm exec turbo run build` are each run
- **THEN**: each exits `0`

### Requirement: The `ES2022` Build Target Is Documented as a Downstream-Browser Contract
`tsconfig.base.json`'s `target: "ES2022"` MUST be retained at `ES2022` and MUST NOT be raised to
match the Node 24 build and test toolchain. A comment MUST be present at that setting stating
that the target governs the JavaScript syntax level downstream **browsers** must support, which
is a distinct question from the Node version that builds and tests the repository. No `tsup`
configuration MUST introduce a `target` override that contradicts it.

#### Scenario: The target is still ES2022 and carries an explanatory comment
- **GIVEN**: `tsconfig.base.json` after this change
- **WHEN**: the `target` setting and the lines adjacent to it are read
- **THEN**: the value is `"ES2022"` and a comment adjacent to it states the browser-support
  rationale and the distinction from the Node toolchain version

#### Scenario: No tsup config overrides the target
- **GIVEN**: `packages/core/tsup.config.ts` and `packages/renderers/tsup.config.ts`
- **WHEN**: each is inspected for a `target` field
- **THEN**: neither declares one, so the emitted JavaScript syntax level remains the one
  `tsconfig.base.json` states

#### Scenario: The documented target survives the TypeScript 6 upgrade
- **GIVEN**: `packages/core/tsconfig.json` (`lib: ["ES2022"]`) and
  `packages/renderers/tsconfig.json` (`lib: ["ES2022", "DOM"]`) under `typescript@6.0.3`
- **WHEN**: `pnpm exec turbo run typecheck` and `pnpm exec turbo run build` are run
- **THEN**: both exit `0`, with no "cannot find lib definition" diagnostic and no change to
  either package's `lib` array

### Requirement: The TypeScript 6 `baseUrl` Deprecation Is Suppressed With a Documented Cause and Expiry
`tsconfig.base.json` MUST declare `"ignoreDeprecations": "6.0"` in its `compilerOptions`, because
`tsup`'s bundled declaration build hardcodes `baseUrl` (`tsup/dist/rollup.js:6837`) and
`typescript@6.0.3` reports that as `error TS5101`, failing `pnpm exec turbo run build`
(**F11**). No `tsconfig` in this repository MUST set `baseUrl` itself. The suppression MUST be
adjacent to a comment that (a) names `tsup` as the external cause, and (b) states that
`ignoreDeprecations` stops functioning entirely in TypeScript 7, so the suppression has a known
expiry and is not a repository-owned preference.

#### Scenario: The build passes at the target TypeScript version
- **GIVEN**: the workspace with `typescript` resolved to `6.0.3`
- **WHEN**: `pnpm exec turbo run build` is run
- **THEN**: it exits `0` and emits no `TS5101` diagnostic

#### Scenario: Removing the suppression reproduces the failure
- **GIVEN**: the same workspace with the `ignoreDeprecations` entry deleted from
  `tsconfig.base.json`
- **WHEN**: `pnpm exec turbo run build` is run
- **THEN**: it exits non-zero with `error TS5101` naming `baseUrl` — establishing that the entry
  is load-bearing and not decorative

#### Scenario: The suppression carries its cause and its expiry
- **GIVEN**: `tsconfig.base.json` after this change
- **WHEN**: the lines adjacent to `"ignoreDeprecations"` are read
- **THEN**: they name `tsup` as the reason the option is present, and state that the option stops
  functioning in TypeScript 7

#### Scenario: No repository tsconfig sets baseUrl
- **GIVEN**: `tsconfig.base.json`, `packages/core/tsconfig.json`,
  `packages/core/tsconfig.test.json`, `packages/renderers/tsconfig.json` and
  `apps/playground/tsconfig.json`
- **WHEN**: each is inspected for a `baseUrl` compiler option
- **THEN**: none declares one, so the suppressed deprecation is attributable entirely to `tsup`

### Requirement: The Playground Config Permits Its Existing `.ts` Import Specifiers
`apps/playground/tsconfig.json` MUST declare `"allowImportingTsExtensions": true`. Three imports
in that app carry an explicit `.ts` extension — `apps/playground/src/shell/bootstrap.ts:8` and
`apps/playground/src/views/index.ts:3-4` — which `typescript@6.0.3` rejects with
`error TS5097`, failing `pnpm exec turbo run typecheck` (**F12**). The option MUST NOT be added
to any config that emits: it is legal in this one only because it already sets `"noEmit": true`,
and that setting MUST be retained.

#### Scenario: Typecheck passes across every project at the target TypeScript version
- **GIVEN**: the workspace with `typescript` resolved to `6.0.3`
- **WHEN**: `pnpm exec turbo run typecheck` is run
- **THEN**: it exits `0` and emits no `TS5097` diagnostic

#### Scenario: The option is paired with noEmit in the same config
- **GIVEN**: `apps/playground/tsconfig.json`
- **WHEN**: its `compilerOptions` are inspected
- **THEN**: `allowImportingTsExtensions` is `true` and `noEmit` is `true` in that same object

#### Scenario: No emitting config gains the option
- **GIVEN**: `tsconfig.base.json`, `packages/core/tsconfig.json` and
  `packages/renderers/tsconfig.json`, none of which sets `noEmit`
- **WHEN**: each is inspected
- **THEN**: none declares `allowImportingTsExtensions`

### Requirement: The Root `package.json` Declares `catalog:` For Every Catalogued Dependency
No dependency declared in the root `package.json` MUST duplicate, as a literal version range, a
package that `pnpm-workspace.yaml`'s `catalog:` block already declares. Every such dependency MUST
be declared as exactly `catalog:`. The root currently violates this with
`"typescript": "^5.7.0"` while every workspace package declares `"typescript": "catalog:"`, so the
root silently drifts from the catalogue — observed during the probe, where the first install left
the root on `5.9.3` while the catalogue already said `6.0.3` (**F15**). A dependency that is
deliberately root-only and has no catalogue entry (for example the Changesets tooling and `husky`)
is unaffected by this requirement.

#### Scenario: The root typescript declaration follows the catalogue
- **GIVEN**: the root `package.json` after this change
- **WHEN**: its `devDependencies.typescript` value is inspected
- **THEN**: it is exactly `catalog:`, not `^5.7.0` or any other literal range

#### Scenario: No root dependency duplicates any catalogue entry
- **GIVEN**: the set of package names declared in `pnpm-workspace.yaml`'s `catalog:` block and the
  union of the root `package.json`'s `dependencies` and `devDependencies`
- **WHEN**: every name present in both sets is examined
- **THEN**: each one's root specifier is exactly `catalog:` — no name appears in both the
  catalogue and the root with a literal version range

#### Scenario: The root resolves to the same version as the workspace packages
- **GIVEN**: the repository after `pnpm install --frozen-lockfile`
- **WHEN**: the `typescript` version resolved for the workspace root is compared against the
  version resolved for `packages/core`, `packages/renderers` and `apps/playground`
- **THEN**: all four are identical and equal to the catalogue's declared target

### Requirement: Type-Aware Lint Coverage of `test/**` and `bench/**` Survives the TypeScript 6 Upgrade
`eslint.config.js` MUST continue to lint every `.ts` file under each package's `test/**` and
`bench/**` trees with full type information, at the target `typescript` version. This coverage is
the mechanism that enforces CLAUDE.md rule 1 across those trees, and MUST NOT be narrowed,
downgraded to untyped linting, or waived with per-file or per-directory rule disables in order to
make the upgrade pass. `typescript@6.0.3` breaks `typescript-eslint`'s `projectService`
`defaultProject` fallback, on which the current config relies for exactly those trees, producing
29 "type that could not be resolved" errors across `packages/core/bench/index.ts`, `runner.ts` and
`trace-deopt.ts` (**F13**); the association between those trees and a TypeScript project MUST
therefore be reshaped rather than the coverage reduced.

#### Scenario: Lint is green at the target TypeScript version
- **GIVEN**: the workspace with `typescript` resolved to `6.0.3`, `eslint` to `10.10.0` and
  `typescript-eslint` to `8.70.0`
- **WHEN**: `pnpm exec turbo run lint` is run
- **THEN**: it exits `0`, with no "could not be resolved" diagnostic on any file under
  `packages/core/bench/`

#### Scenario: The reported errors were never real type errors
- **GIVEN**: the same workspace
- **WHEN**: `pnpm --filter @trace-kit/core typecheck:test` is run (the package's existing
  `tsc -p tsconfig.test.json --noEmit` script)
- **THEN**: it exits `0` — the project compiles under the same compiler, so any diagnostic of that
  form from the linter is a configuration defect and MUST be fixed in `eslint.config.js`, not by
  editing the bench sources

#### Scenario: Type-aware rules still fire inside the test and bench trees
- **GIVEN**: `eslint.config.js` after the reshaping, and a file placed under a package's `test/`
  or `bench/` tree containing an explicit `any` annotation
- **WHEN**: ESLint is run over that file
- **THEN**: it reports `@typescript-eslint/no-explicit-any`, proving the file is linted with type
  information rather than skipped or linted untyped

#### Scenario: The existing lint meta-test stays green
- **GIVEN**: `packages/core/test/lint-rules.test.ts`, the repository's own proof that the `any`
  and `as never` bans fire
- **WHEN**: it is run under the upgraded toolchain
- **THEN**: it passes, and `pnpm run test` reports the full suite passing (**F14**)
