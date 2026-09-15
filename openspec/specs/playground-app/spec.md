# Capability: playground-app

## ADDED Requirements

### Requirement: apps/playground Is a Workspace-Protocol Vite + TypeScript App
`apps/playground` MUST be a Vite + TypeScript application consuming `@trace-kit/core` via the
pnpm workspace protocol, so playground changes exercise the real built artifact rather than a
copy. It MUST extend `tsconfig.base.json` and inherit its lint and typecheck tasks.

#### Scenario: The playground depends on the real built core artifact
- **GIVEN**: `apps/playground/package.json` declares `"@trace-kit/core": "workspace:*"`
- **WHEN**: `pnpm install` runs and the playground imports from `@trace-kit/core`
- **THEN**: the resolved module is the workspace package (verified by resolving to
  `packages/core`, not a registry copy)

#### Scenario: The playground extends the base tsconfig
- **GIVEN**: `apps/playground/tsconfig.json`
- **WHEN**: its `extends` field is inspected
- **THEN**: it points at the root `tsconfig.base.json`, and `tsc --noEmit -p apps/playground`
  enforces `strict` and `noUncheckedIndexedAccess`

### Requirement: No `any` in the Playground
The playground MUST NOT use `any` in any form banned by CLAUDE.md rule 1 (`: any`, `as any`,
`<any>`, `Record<string, any>` / `, any>`, `as never` used to suppress an error).

#### Scenario: Lint fails on a banned any-form fixture in the playground
- **GIVEN**: a fixture file under `apps/playground/src/` declaring `function f(x: any) {}`
- **WHEN**: `pnpm exec turbo run lint --filter=playground` runs
- **THEN**: the lint task exits non-zero and reports the violation

#### Scenario: Lint fails on every other banned any-form fixture in the playground
- **GIVEN**: four separate fixture files under `apps/playground/src/`, each declaring exactly
  one of the remaining banned forms: `const x = value as any;`, `const y = <any>value;`,
  `type Bad = Record<string, any>;`, and `const z = value as never;` used to silence a type
  mismatch
- **WHEN**: `pnpm exec turbo run lint --filter=playground` runs
- **THEN**: the lint task exits non-zero and reports a violation for each of the four fixture
  files, matching the coverage the `workspace-toolchain` base spec's "Mechanically Enforced `any`
  Ban" requirement already asserts for `packages/*`

### Requirement: The Playground Does Not Depend On Out-of-Scope Package or Module Surfaces
`apps/playground` MUST NOT declare a `package.json` dependency on `@trace-kit/renderers`,
`@trace-kit/vue` or `@trace-kit/react` (owned by changes 5, 10 and 11 respectively, none of which
this change depends on or creates), and MUST NOT import from `@trace-kit/core`'s
`transport/*` export surface (`DecimationPort`, `Lease`, `SettlementSink`,
`RawSampleRing`, `SyncDecimationPortConfig` and related transport types/functions — owned by
change 3, which this change explicitly does not depend on per the proposal's stated dependency
graph). `apps/playground` MUST NOT construct a `Worker` — change 8 owns worker construction, and
the `/core-math` view runs its algorithms synchronously on the main thread.

#### Scenario: No dependency on an unowned package is declared
- **GIVEN**: `apps/playground/package.json`'s `dependencies` and `devDependencies` at the end of
  this change
- **WHEN**: the keys are checked against `@trace-kit/renderers`, `@trace-kit/vue` and
  `@trace-kit/react`
- **THEN**: none of the three appears

#### Scenario: No source file imports from @trace-kit/core's transport surface
- **GIVEN**: the `apps/playground/src` tree at the end of this change
- **WHEN**: a source-level check inspects every `import` statement resolving to
  `@trace-kit/core` and the set of named imports each one requests
- **THEN**: no imported name is one exported from `@trace-kit/core`'s `transport/*` module group
  (as listed in `packages/core/src/index.ts`'s transport export block)

#### Scenario: No source file constructs a Worker
- **GIVEN**: the `apps/playground/src` tree at the end of this change
- **WHEN**: a source-level check searches for `new Worker(` anywhere under the tree
- **THEN**: no such construction is found

### Requirement: Playground Builds and Typechecks as a CI Gate
`apps/playground` MUST declare `build` and `typecheck` scripts, and CI MUST run them, so a
broken sandbox fails the pipeline.

#### Scenario: A typecheck error in the playground fails CI
- **GIVEN**: a deliberately broken fixture type error committed under `apps/playground/src/`
- **WHEN**: `pnpm exec turbo run typecheck` runs
- **THEN**: the command exits non-zero, naming the playground's error
