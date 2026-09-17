# Capability: workspace-toolchain

> Change: `browser-visual-regression-harness` (roadmap order 5.5). Modified capability — base
> merged at `openspec/specs/workspace-toolchain/spec.md` by `workspace-test-harness-bootstrap`,
> `workspace-guard-scripts-cleanup`, and `playground-shell`.
>
> Source: `proposal.md` §"Modified Capabilities" (`workspace-toolchain`), decisions **P2**
> (upgrade), **P3** (config migration), **P7** (dependency freshness), **P8** (toolchain
> modernisation), **P10** (`ES2022` build target), **P11** (the three TypeScript 6.0.3 fixes) and
> **P12** (the root `typescript` pin); research **C4**; `toolchain-probe.md` **F2**–**F8**
> (part 1) and **F9**–**F16** (part 2).

## ADDED Requirements

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
