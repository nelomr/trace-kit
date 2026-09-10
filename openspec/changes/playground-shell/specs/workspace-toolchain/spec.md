# Capability: workspace-toolchain

> Change: `playground-shell`. Modified capability — base introduced by
> `workspace-test-harness-bootstrap` (not yet archived into `openspec/specs/`; delta applies
> against that change's `specs/workspace-toolchain/spec.md`).

## MODIFIED Requirements

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
