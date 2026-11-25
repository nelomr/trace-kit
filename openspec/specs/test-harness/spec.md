# Capability: test-harness

> Changes: `workspace-test-harness-bootstrap` (initial), `playground-shell` (added the
> DOM-capable second Vitest project entry), `browser-visual-regression-harness` (added the
> browser-mode fifth Vitest project entry), `worker-streaming-transport` (added the
> `core-worker-transfer` and `core-worker-shared` Playwright Chromium worker projects).

## Requirements

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

### Requirement: A Fifth Vitest Project Rasterizes in a Real Browser
`vitest.config.ts`'s `test.projects` array MUST gain a fifth entry — a browser-mode project
using the Playwright provider — rooted at `packages/renderers`, alongside the existing `core`,
`playground`, `renderers`, and `renderers-dom` entries. This is the first project in the
workspace capable of producing an actual rasterized pixel; the other four remain call-sequence,
DOM-shape, or pure-computation projects and produce no pixel.

#### Scenario: test.projects contains exactly five entries after this change
- **GIVEN**: `vitest.config.ts` as modified by this change
- **WHEN**: `test.projects` is inspected
- **THEN**: it contains exactly five entries — the four pre-existing ones (`core`, `playground`,
  `renderers`, `renderers-dom`) plus one new browser-mode entry

#### Scenario: The new entry is the only one that can produce a rasterized pixel
- **GIVEN**: the five `test.projects` entries
- **WHEN**: each is inspected for whether it can call `getContext("2d")` and obtain a non-null,
  rasterizing context
- **THEN**: only the new browser-mode entry can; `core` runs `environment: "node"` with no
  canvas at all, and `renderers-dom`'s `happy-dom` returns `null` from `getContext("2d")`

### Requirement: The Four Pre-Existing Projects' Configuration Is Unchanged
The `core`, `playground`, `renderers`, and `renderers-dom` project entries' `environment`,
`root`, and isolation configuration MUST be byte-identical to their pre-change values. The new
browser-mode entry MUST be the sole project among the five that declares no `environment` key
(per `browser-visual-regression`); every other entry keeps whatever `environment` value it had
before this change.

#### Scenario: The four pre-existing entries' environment fields are untouched
- **GIVEN**: the four pre-existing `test.projects` entries
- **WHEN**: their `environment` and `root` fields are diffed against their pre-change values
- **THEN**: no difference is found

#### Scenario: Only the new entry omits environment
- **GIVEN**: all five `test.projects` entries after this change
- **WHEN**: each is checked for the presence of an `environment` field
- **THEN**: exactly one (the new browser-mode entry) has none; the other four each declare one

### Requirement: Real-Browser Worker Test Projects Verify `Transfer` and `Shared` Backings
`vitest.config.ts`'s `test.projects` array MUST add two Playwright Chromium browser-mode projects
rooted at `packages/core` (using absolute config-relative paths):
1. **`core-worker-transfer` (non-isolated worker project)**: default Vite dev server with **no**
   COOP/COEP headers (`crossOriginIsolated === false`), proving real browser `new Worker(...)`
   execution auto-selects `BufferBacking.Transfer`, detaches/returns buffers cleanly, recovers from
   worker errors/timeouts, and hands materialized `Retained` payloads to renderers without
   detachment.
2. **`core-worker-shared` (cross-origin-isolated worker project)**: dedicated test-only Vite
   server plugin setting `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` strictly on this test project, proving
   `crossOriginIsolated === true`, automatic `BufferBacking.Shared` selection, real Chromium
   `SharedArrayBuffer` + `Atomics` SPSC worker round trips, and clean non-hanging `dispose()`.

The COOP/COEP headers MUST be scoped strictly to `core-worker-shared` and MUST NOT be added to
`apps/playground/vite.config.ts`, any consumer template, or any other project.

#### Scenario: Non-isolated Chromium project verifies Transfer backing with real Web Worker
- **GIVEN**: the `core-worker-transfer` Playwright Chromium project in `vitest.config.ts`
- **WHEN**: the browser transfer test suite runs
- **THEN**: `globalThis.crossOriginIsolated === false`, `createWorkerDecimationPort` auto-selects
  `BufferBacking.Transfer`, real browser `Worker` round trips settle bit-exact outputs, and
  `dispose()` completes cleanly

#### Scenario: Isolated Chromium project verifies Shared backing with real Web Worker
- **GIVEN**: the `core-worker-shared` Playwright Chromium project in `vitest.config.ts`
- **WHEN**: the browser shared-memory test suite runs
- **THEN**: `globalThis.crossOriginIsolated === true`, `createWorkerDecimationPort` auto-selects
  `BufferBacking.Shared`, real browser `Worker` `SharedArrayBuffer` + `Atomics` round trips settle
  bit-exact outputs with `0` view re-mints, and `dispose()` terminates without hanging

#### Scenario: COOP/COEP headers never leak into playground or non-isolated projects
- **GIVEN**: `apps/playground/vite.config.ts` and the non-isolated browser projects in
  `vitest.config.ts`
- **WHEN**: their Vite server configurations are inspected
- **THEN**: neither configures `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`

### Requirement: Pre-Existing Vitest Projects Remain Unchanged
Adding `core-worker-transfer` and `core-worker-shared` MUST NOT alter the `environment`, `root`,
`pool`, `execArgv`, or screenshot comparison configuration of any pre-existing project (`core`,
`playground`, `renderers`, `renderers-dom`, `visual`, `engine-bench`). In particular, `core` MUST
remain `environment: "node"` with `pool: "forks"` and
`execArgv: ["--expose-gc", "--no-concurrent-recompilation"]`, and MUST exclude `test/browser/**`
so browser-only worker specs execute only under `core-worker-transfer` and `core-worker-shared`.

#### Scenario: Existing projects retain identical configuration and clean file partitioning
- **GIVEN**: `vitest.config.ts` after adding `core-worker-transfer` and `core-worker-shared`
- **WHEN**: the six pre-existing project entries are compared against their pre-change settings and
  the `core` Node project runs
- **THEN**: `core`, `playground`, `renderers`, `renderers-dom`, `visual`, and `engine-bench` keep
  their exact pre-change settings (with `core` excluding `test/browser/**`), and browser-only
  worker specs execute only under `core-worker-transfer` and `core-worker-shared`

### Requirement: Dedicated `vue` (Node) and `vue-dom` (Happy-DOM) Vitest Projects
Root `vitest.config.ts`'s `test.projects` array MUST add two dedicated projects for `@trace-kit/vue`, each using an absolute config-relative `root` computed via `path.join(rootDir, "packages/vue")`:
1. **`vue` (Node SSR & build-contract project)**: `environment: "node"`, `include: ["test/node/**/*.test.ts"]` — executes pure Node import-time DOM-free isomorphism checks, `vue/server-renderer` `renderToString` SSR markup assertions, ESM/CJS export resolution, `vue` externalization, zero SVG/font reachability, `/*#__PURE__*/` preservation, and bidirectional `packages/vue/SIDE-EFFECTS.md` coverage.
2. **`vue-dom` (Happy-DOM component & composable project)**: `environment: "happy-dom"`, `include: ["test/dom/**/*.test.ts"]` — executes `useSpectrumEngine` and `<TraceSpectrumViewer>` tests using Vue 3's built-in `createApp`, `createSSRApp`, `h`, `nextTick`, and `effectScope` (with zero `@vue/test-utils` dependency), covering reactivity isolation, dual streaming seam, `v-model:domain` echo suppression, `ViewportInteractionController` coordination, `createSSRApp` client hydration, and 20-cycle mount/unmount leak checks.

`packages/vue/package.json` MUST declare:
- `"test": "vitest run --config ../../vitest.config.ts --project vue --project vue-dom"`
- `"typecheck": "tsc --noEmit && tsc -p tsconfig.test.json --noEmit"`
- `"typecheck:test": "tsc -p tsconfig.test.json --noEmit"`
- `"lint": "eslint ."`

#### Scenario: vitest.config.ts declares vue (node) and vue-dom (happy-dom) projects with absolute config-relative roots
- **GIVEN**: root `vitest.config.ts` after `vue-adapter` lands
- **WHEN**: `packages/vue/test/node/vue-build.test.ts` inspects `vitest.config.ts`
- **THEN**: `test.projects` contains a `"vue"` project with `environment: "node"`, `include: ["test/node/**/*.test.ts"]`, and `root` computed via `path.join(rootDir, "packages/vue")`, AND a `"vue-dom"` project with `environment: "happy-dom"`, `include: ["test/dom/**/*.test.ts"]`, and `root` computed via `path.join(rootDir, "packages/vue")`

#### Scenario: vue project enforces DOM-free Node isolation while vue-dom provides Happy-DOM globals
- **GIVEN**: a test under `packages/vue/test/node/` running in the `vue` project and a test under `packages/vue/test/dom/` running in the `vue-dom` project
- **WHEN**: both projects execute via `pnpm --filter @trace-kit/vue test`
- **THEN**: inside `vue`, `typeof window === "undefined"` and `typeof document === "undefined"` hold; inside `vue-dom`, `document.createElement("div")` and `createApp(...)` succeed without throwing

#### Scenario: packages/vue test script executes both projects cleanly through Turbo
- **GIVEN**: `packages/vue/package.json`'s `test`, `typecheck`, `typecheck:test`, and `lint` scripts
- **WHEN**: `pnpm --filter @trace-kit/vue test` and `pnpm --filter @trace-kit/vue typecheck` run
- **THEN**: both exit `0` and execute real test cases across both `vue` and `vue-dom` projects (zero vacuous passes)

### Requirement: All Eight Pre-Existing Vitest Projects Remain Byte-for-Byte Unchanged
Adding the `vue` and `vue-dom` entries to `vitest.config.ts` MUST NOT modify the `name`, `root`, `environment`, `include`, `exclude`, `setupFiles`, `pool`, `execArgv`, `testTimeout`, `browser`, `worker`, `server`, `plugins`, `resolve`, or `define` configuration of any of the eight pre-existing Vitest projects (`core`, `playground`, `renderers`, `renderers-dom`, `visual`, `engine-bench`, `core-worker-transfer`, `core-worker-shared`).

#### Scenario: All eight pre-existing Vitest project entries remain identical after adding vue and vue-dom
- **GIVEN**: root `vitest.config.ts` after appending `vue` and `vue-dom`
- **WHEN**: `test.projects` is inspected against the eight pre-existing entries
- **THEN**: `test.projects` contains `10` entries in total, and the first `8` entries (`core`, `playground`, `renderers`, `renderers-dom`, `visual`, `engine-bench`, `core-worker-transfer`, `core-worker-shared`) retain their exact pre-change configurations with zero modifications

### Requirement: Vitest Node and DOM Projects for @trace-kit/react
Root `vitest.config.ts` MUST register two projects for `@trace-kit/react`: `react` (`environment: "node"`, `include: ["test/node/**/*.test.ts"]`) and `react-dom` (`environment: "happy-dom"`, `include: ["test/dom/**/*.test.ts"]`), bringing the root project roster to 12 projects while preserving all 10 pre-existing projects.

#### Scenario: Root Vitest executes react and react-dom projects cleanly
- **GIVEN**: Root `vitest.config.ts` with `react` and `react-dom` projects registered
- **WHEN**: `pnpm --filter @trace-kit/react test` executes
- **THEN**: Both Node SSR/build tests (`react`) and DOM/StrictMode/reactivity tests (`react-dom`) execute and pass
