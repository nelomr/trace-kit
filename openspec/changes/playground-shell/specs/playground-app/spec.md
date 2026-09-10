# Capability: playground-app

> Change: `playground-shell`. New capability.

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

### Requirement: Playground Builds and Typechecks as a CI Gate
`apps/playground` MUST declare `build` and `typecheck` scripts, and CI MUST run them, so a
broken sandbox fails the pipeline.

#### Scenario: A typecheck error in the playground fails CI
- **GIVEN**: a deliberately broken fixture type error committed under `apps/playground/src/`
- **WHEN**: `pnpm exec turbo run typecheck` runs
- **THEN**: the command exits non-zero, naming the playground's error
