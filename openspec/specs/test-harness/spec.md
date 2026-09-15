# Capability: test-harness

> Changes: `workspace-test-harness-bootstrap` (initial), `playground-shell` (added the
> DOM-capable second Vitest project entry).

## ADDED Requirements

### Requirement: Real Vitest Wiring
A root Vitest configuration MUST exist, every package MUST declare a `test` script that
`turbo run test` invokes as a real task, so that `pnpm run test` (which resolves to
`turbo run test`) executes at least one real test task instead of resolving to zero tasks, and
the workspace catalog MUST additionally pin `fast-check` as a devDependency available to any
package that writes property-based tests, so that `pnpm run test` executes real unit tests and
real property-based tests. **The root `vitest.config.ts`'s `test.projects` array now gains a
second entry** — the playground routing and instrumentation-panel teardown scenarios assert
listener, animation-frame-callback and observer counts after unmount, which require
`window`-shaped globals absent from `environment: "node"`. The `core` project's
`environment: "node"` configuration and its DOM-free isolation are UNCHANGED by this addition.

#### Scenario: turbo run test executes a real task
- **GIVEN**: `packages/core/package.json` declares `"test": "vitest run"`
- **WHEN**: `pnpm run test` runs at the repository root
- **THEN**: the command's output reports at least one test file executed and at least one test
  passed, and the process exits `0` only because real tests passed (not because zero tasks ran)

#### Scenario: fast-check is resolvable from the catalog
- **GIVEN**: `packages/core/package.json` declares `"devDependencies": { "fast-check":
  "catalog:" }`
- **WHEN**: `pnpm install` runs
- **THEN**: `fast-check` resolves without a "not found in catalog" error, and a property-based
  test importing `fast-check` runs successfully under `pnpm run test`

### Requirement: DOM-Capable Second Vitest Project for the Playground
`vitest.config.ts`'s `test.projects` array MUST gain a second project entry, named for the
playground, configured with a DOM-capable environment, whose `root` is an absolute path resolved
from the config file's own location — following the same rationale the existing `core` entry's
header comment already states: Vitest resolves a relative project `root` against the CLI's
invocation cwd, and Turborepo invokes a per-package `test` script with that package's directory
as cwd, so a bare relative `root` string would resolve against the wrong directory and silently
match zero test files. The choice of DOM implementation (jsdom, happy-dom, or Vitest's browser
mode) is not fixed by this requirement.

#### Scenario: A second project entry exists with an absolute, config-relative root
- **GIVEN**: `vitest.config.ts` as modified by this change
- **WHEN**: `test.projects` is inspected
- **THEN**: it contains exactly two entries — the pre-existing `core` entry and a new playground
  entry — and the new entry's `root` is computed via `path.join(rootDir, ...)` (or equivalent),
  not a bare relative string literal

#### Scenario: The playground project provides DOM-shaped globals
- **GIVEN**: the new playground Vitest project
- **WHEN**: a test file inside it references `window`, `addEventListener` and
  `requestAnimationFrame`
- **THEN**: none of these references throw a `ReferenceError`, unlike the same references
  evaluated under the `core` project's `environment: "node"`

#### Scenario: The core project's Node isolation is unchanged
- **GIVEN**: the `core` entry inside `test.projects` after this change
- **WHEN**: its `environment` field and its `root` are compared against the pre-change config
- **THEN**: `environment` is still exactly `"node"`, and no DOM global is available to a test
  running inside it — the second project is an added array entry, not a migration or relaxation
  of `core`'s existing isolation

#### Scenario: --expose-gc keeps applying workspace-wide and stays inert in the DOM project
- **GIVEN**: the top-level `test.pool: "forks"` / `test.poolOptions.forks.execArgv: ["--expose-gc"]`
  configuration, unmoved by this change
- **WHEN**: a `PerformanceObserver`-based GC-event-count test runs inside the playground's
  DOM-capable project
- **THEN**: `global.gc` remains callable (the flag still reaches the forked process, as it does
  for the `core` project), and no test inside the DOM-capable project relies on its absence or
  presence to pass — the flag being workspace-wide is harmless there, matching the existing
  top-level comment's own stated reasoning

#### Scenario: Determinism and GC-event tests stay in the Node-side project
- **GIVEN**: the Lorentzian generator's determinism test and its GC-event zero-allocation test
  (claim C4b)
- **WHEN**: these test files are placed under the workspace
- **THEN**: they run inside a Node-environment Vitest project (either the existing `core`
  project or an equivalently `environment: "node"`-configured playground-scoped test file group),
  not inside the DOM-capable project — pure-computation and GC-event-count assertions MUST NOT
  depend on a DOM-like environment's allocation behaviour

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
