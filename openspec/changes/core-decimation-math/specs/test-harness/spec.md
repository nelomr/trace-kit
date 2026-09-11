# Capability: test-harness

> Change: `core-decimation-math`. Modified capability — base introduced and archived by
> `workspace-test-harness-bootstrap`; delta applies against
> `openspec/specs/test-harness/spec.md`.

## MODIFIED Requirements

### Requirement: Real Vitest Wiring
A root Vitest configuration MUST exist, every package MUST declare a `test` script that
`turbo run test` invokes as a real task, **and the workspace catalog MUST additionally pin
`fast-check` as a devDependency available to any package that writes property-based tests**, so
that `pnpm run test` executes real unit tests and real property-based tests.

#### Scenario: turbo run test executes a real task
- **GIVEN**: `packages/core/package.json` declares `"test": "vitest run"`
- **WHEN**: `pnpm run test` runs at the repository root
- **THEN**: the command's output reports at least one test file executed and at least one test
  passed

#### Scenario: fast-check is resolvable from the catalog
- **GIVEN**: `packages/core/package.json` declares `"devDependencies": { "fast-check":
  "catalog:" }`
- **WHEN**: `pnpm install` runs
- **THEN**: `fast-check` resolves without a "not found in catalog" error, and a property-based
  test importing `fast-check` runs successfully under `pnpm run test`
