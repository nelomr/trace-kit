# Capability: playground-app

## Requirements

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
`apps/playground` MUST NOT declare a `package.json` dependency on `@trace-kit/vue` or
`@trace-kit/react` (owned by Changes 10 and 11 respectively, which do not exist yet).
`apps/playground` MAY import `@trace-kit/core` transport and streaming exports (including
`@trace-kit/core/worker`) and MAY construct browser module `Worker` instances inside its streaming
transport showcase view (`apps/playground/src/views/streaming-transport/`), while keeping
`/core-math` and other non-transport views free of unrequested worker construction.

#### Scenario: No dependency on unowned framework adapter packages is declared
- **GIVEN**: `apps/playground/package.json`'s `dependencies` and `devDependencies`
- **WHEN**: the keys are checked against `@trace-kit/vue` and `@trace-kit/react`
- **THEN**: neither appears

#### Scenario: Streaming transport view is permitted to import transport exports and construct a Worker
- **GIVEN**: `apps/playground/src/views/streaming-transport/` importing `createWorkerDecimationPort`,
  streaming primitives, and `@trace-kit/core/worker`, and constructing a module `Worker`
- **WHEN**: the playground scope guard test (`apps/playground/test/node/no-transport-imports.test.ts`)
  and `pnpm exec turbo run typecheck --filter=@trace-kit/playground` run
- **THEN**: both pass while continuing to reject any dependency on `@trace-kit/vue` or
  `@trace-kit/react`

### Requirement: Playground Builds and Typechecks as a CI Gate
`apps/playground` MUST declare `build` and `typecheck` scripts, and CI MUST run them, so a
broken sandbox fails the pipeline.

#### Scenario: A typecheck error in the playground fails CI
- **GIVEN**: a deliberately broken fixture type error committed under `apps/playground/src/`
- **WHEN**: `pnpm exec turbo run typecheck` runs
- **THEN**: the command exits non-zero, naming the playground's error
