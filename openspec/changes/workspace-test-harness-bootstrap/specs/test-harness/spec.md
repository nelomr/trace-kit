# Capability: test-harness

> Change: `workspace-test-harness-bootstrap`. New capability.

## ADDED Requirements

### Requirement: Real Vitest Wiring
A root Vitest configuration MUST exist, and every package MUST declare a `test` script that
`turbo run test` invokes as a real task, so that `pnpm run test` (which resolves to
`turbo run test`) executes at least one real test task instead of resolving to zero tasks.

#### Scenario: turbo run test executes a real task
- **GIVEN**: `packages/core/package.json` declares `"test": "vitest run"`
- **WHEN**: `pnpm run test` runs at the repository root
- **THEN**: the command's output reports at least one test file executed and at least one test
  passed, and the process exits `0` only because real tests passed (not because zero tasks ran)

### Requirement: Node-Isomorphism Tripwire Test
A single committed test MUST import `@trace-kit/core` in a plain Node test environment (no
`jsdom`, no DOM globals configured) and assert that the module loads and evaluates without
throwing. This test is the load-bearing tripwire for CLAUDE.md rule 5: the first time any core
module references `document`, `window`, or `HTMLCanvasElement`, this test fails.

#### Scenario: The isomorphism test passes against the current core
- **GIVEN**: `packages/core/src/index.ts` exports only `VERSION` and no browser globals
- **WHEN**: `packages/core/test/isomorphism.test.ts` runs under Vitest's default `node`
  environment
- **THEN**: the test passes

#### Scenario: The isomorphism test fails if a browser global is introduced
- **GIVEN**: a fixture module under `packages/core/test/fixtures/` that references
  `document.createElement` at module scope
- **WHEN**: the fixture is imported from within the isomorphism test in the Node environment
- **THEN**: the import throws a `ReferenceError` for `document`, and the test fails,
  demonstrating the tripwire is live

### Requirement: Real `typecheck` and `lint` Tasks
Every package MUST declare a `typecheck` script (`tsc --noEmit`) and a `lint` script backed by
real configuration, so the existing CI steps (`turbo run typecheck`, `turbo run lint`) execute
genuine work rather than resolving to zero tasks.

#### Scenario: turbo run lint executes real work
- **GIVEN**: `packages/core/package.json` declares a `lint` script backed by a committed lint
  configuration file
- **WHEN**: `pnpm exec turbo run lint` runs
- **THEN**: the output reports at least one package's lint task as executed (not `0 successful,
  0 total`)
