# Capability: package-build-pipeline

## Requirements

### Requirement: Dual ESM/CJS Build via tsup
Every publishable package MUST build with `tsup` producing both an ESM and a CJS output, MUST
emit TypeScript declarations (`dts: true`) with declaration maps, and MUST emit sourcemaps.

#### Scenario: packages/core emits both module formats with declarations
- **GIVEN**: `packages/core/package.json` declares `"build": "tsup"` backed by a committed
  `tsup.config.ts`
- **WHEN**: `pnpm exec turbo run build --filter=@trace-kit/core` runs
- **THEN**: `packages/core/dist/` contains an `.mjs` (or `.js` ESM) entry, a `.cjs` entry, a
  matching `.d.ts` for each, and a `.d.ts.map` for each

### Requirement: Per-Package `exports` Map, No Root `exports` Map
Every publishable package MUST declare its own `package.json` `exports` map pointing at its
built ESM and CJS artifacts. The root `package.json` MUST NOT declare an `exports` map, because
the root is `private: true` and is never published, making a root `exports` map dead
configuration.

#### Scenario: packages/core exports map resolves both conditions
- **GIVEN**: `packages/core/package.json` declares `exports["."] = { "import": ..., "require":
  ..., "types": ... }` pointing into `dist/`
- **WHEN**: a Node `require('@trace-kit/core')` and a Node `import('@trace-kit/core')` are each
  attempted from a scratch consumer script inside the isomorphism test
- **THEN**: both resolve successfully to the built artifacts

#### Scenario: root package.json has no exports map
- **GIVEN**: the root `package.json` is `private: true`
- **WHEN**: a repository lint/CI step inspects the root `package.json`
- **THEN**: the step fails if the root `package.json` contains an `exports` field

### Requirement: Audited `sideEffects` Declaration
Every publishable package MUST declare `sideEffects` in its `package.json`, and that
declaration MUST be backed by a documented audit confirming the package's modules are
genuinely free of import-time side effects (or, if not, listing the exact side-effecting file
paths). `packages/core`'s existing unaudited `sideEffects: false` MUST be backed by this audit.

#### Scenario: The committed core audit note names every source file
- **GIVEN**: `packages/core/package.json` declares `"sideEffects": false`
- **WHEN**: `packages/core/SIDE_EFFECTS_AUDIT.md` is compared with the files under `packages/core/src`
- **THEN**: it names exactly those files, in both directions (`packages/core/test/side-effects-audit.test.ts`
  asserts the set equality), and states that none performs a top-level side effect

### Requirement: `@trace-kit/renderers` Exposes a `./svg` Subpath Built by tsup
`packages/renderers/package.json` `exports` MUST declare a `./svg` entry with `types`, `import`
and `require` conditions pointing at built artifacts, alongside the existing `./font` and
`./fixtures` entries. `tsup` MUST build the `src/svg` entry as a separate bundle emitting ESM,
CJS, declarations and declaration maps. The root `.` entry MUST NOT include the svg module.

#### Scenario: The subpath resolves under both module systems
- **GIVEN**: the built renderers package
- **WHEN**: Node performs `import('@trace-kit/renderers/svg')` and `require('@trace-kit/renderers/svg')`
- **THEN**: both resolve and expose `exportToSvg`

#### Scenario: Declarations are emitted
- **GIVEN**: the build output for `./svg`
- **WHEN**: `dist/` is listed
- **THEN**: it contains the ESM entry, the CJS entry, a `.d.ts` for each and a `.d.ts.map`

#### Scenario: The root bundle excludes the exporter
- **GIVEN**: the built root entry
- **WHEN**: its contents are searched for `exportToSvg`
- **THEN**: there is no match

### Requirement: The `./svg` Subpath Is Included in the `sideEffects` Audit
The `sideEffects` audit for `@trace-kit/renderers` MUST list every file under `src/svg/` and the new
layout and shared-rules modules and state that none performs a top-level side effect. The svg and
layout modules MUST be tree-shakeable (no import-time registration or mutation).

#### Scenario: The audit names the new modules
- **GIVEN**: the committed audit note
- **WHEN**: it is inspected
- **THEN**: it names every file under `src/svg/`, the layout module and the shared-rules module
  with a no-side-effect statement

### Requirement: `@trace-kit/renderers` Exposes a `./webgl2` Subpath Built by tsup
`packages/renderers/package.json` `exports` MUST declare a `./webgl2` entry with `types`, `import`
and `require` conditions pointing at `./dist/webgl2/index.d.ts`, `./dist/webgl2/index.js` and
`./dist/webgl2/index.cjs`, alongside the existing `.`, `./font`, `./svg` and `./fixtures` entries.
`tsup.config.ts` MUST add `src/webgl2/index.ts` as a separate entry emitting ESM, CJS,
declarations and sourcemaps, and the post-build declaration-map step used for `./svg` MUST also
emit a `.d.ts.map` for `./webgl2`. The subpath MUST expose the exact single concrete runtime export
`["WebGL2FigureRenderer"]` and the public types `WebGL2FigureRendererOptions` and
`WebGL2FigureSurfaces`, and MUST NOT re-export package-internal recovery helpers from
`src/webgl2/rehydrate.ts`. The root `.` entry MUST NOT include the WebGL2 module, the shader
sources or any GL code.

#### Scenario: The subpath resolves under both module systems with exact single runtime export
- **GIVEN**: the built renderers package
- **WHEN**: Node performs `import('@trace-kit/renderers/webgl2')` and
  `require('@trace-kit/renderers/webgl2')`
- **THEN**: both resolve and expose the exact sorted runtime key list `["WebGL2FigureRenderer"]`
  (zero internal rehydration helpers leaked)

#### Scenario: Declarations and maps are emitted
- **GIVEN**: the build output for `./webgl2`
- **WHEN**: `dist/webgl2/` is listed
- **THEN**: it contains the ESM entry, the CJS entry, a `.d.ts` for each and a `.d.ts.map`

#### Scenario: The root bundle excludes the WebGL2 backend
- **GIVEN**: the built root entry files
- **WHEN**: they are searched for `WebGL2FigureRenderer`, `getContext("webgl2"` and `floatBitsToUint`
- **THEN**: there is no match

#### Scenario: The subpath entry points are declared
- **GIVEN**: `packages/renderers/package.json`
- **WHEN**: `exports["./webgl2"]` is read
- **THEN**: it has exactly the `types`, `import` and `require` keys with the paths above

### Requirement: The `./webgl2` Subpath Is Included in the `sideEffects` Audit and Reaches No Cold Entry
The `sideEffects` audit (`packages/renderers/SIDE-EFFECTS.md`) for `@trace-kit/renderers` MUST list
every file under `src/webgl2/` — including the package-internal `webgl2/rehydrate.ts` module (`| none |`,
which evaluates `Symbol.for("trace-kit.webgl2.recovery")` lazily inside helper functions) — and
state that none performs a top-level side effect (no import-time context creation, shader
compilation, listener registration or global mutation: shader sources are plain string constants).
The `./webgl2` bundle MUST NOT import the `./font` entry or the `./svg` entry. `packages/core` and
`apps/playground` MUST remain completely untouched by `engine-context-recovery` (`packages/core`
remains 100% DOM-free and GL-free).

#### Scenario: The audit names every webgl2 module including webgl2/rehydrate.ts
- **GIVEN**: `packages/renderers/SIDE-EFFECTS.md` and `packages/renderers/src/webgl2/*.ts`
- **WHEN**: `packages/renderers/test/node/webgl2-build.test.ts` inspects the committed audit note
- **THEN**: it names every file under `src/webgl2/`, including `webgl2/rehydrate.ts`, with a `none`
  side-effect statement

#### Scenario: Importing the subpath has no side effect
- **GIVEN**: a Node process with no DOM globals
- **WHEN**: `import('@trace-kit/renderers/webgl2')` is evaluated
- **THEN**: it resolves without throwing, without touching `document`/`window`/`OffscreenCanvas`
  and without creating a context

#### Scenario: The WebGL2 bundle does not pull the font or the exporter
- **GIVEN**: the built `./webgl2` ESM and CJS outputs and their chunks
- **WHEN**: they are searched for the embedded font data URL and `exportToSvg`
- **THEN**: neither appears

### Requirement: `@trace-kit/core` Exposes `./worker` and `./node` Subpaths Built by tsup
`packages/core/tsup.config.ts` MUST build three separate entry points — `src/index.ts`,
`src/worker.ts`, and `src/node/index.ts` — each emitting ESM (`.js`), CJS (`.cjs`), TypeScript
declarations (`.d.ts`), declaration maps (`.d.ts.map`), and sourcemaps. `packages/core/package.json`
`exports` MUST declare `"./worker"` and `"./node"` alongside `"."`, each with `types`, `import`,
and `require` conditions pointing at its built artifacts under `./dist/`. `packages/core/package.json`
MUST retain `"sideEffects": false`.

#### Scenario: Core subpaths resolve under both ESM and CJS with emitted declarations
- **GIVEN**: the built `@trace-kit/core` package (`pnpm exec turbo run build --filter=@trace-kit/core`)
- **WHEN**: Node evaluates both `import(...)` and `require(...)` for `@trace-kit/core`,
  `@trace-kit/core/worker`, and `@trace-kit/core/node`, and `packages/core/dist/` is listed
- **THEN**: all three subpaths resolve in both module formats exposing their documented exports
  (`createWorkerDecimationPort` on `.`; `handleDecimationMessage`, `createDecimationWorkerHandler`,
  `attachDecimationWorker`, and `attachCurrentDecimationWorker` on `./worker`; `adaptNodeWorker`,
  `createNodeWorkerFactory`, `createNodeParentPortEndpoint`, and `attachNodeDecimationWorker` on
  `./node`), and each entry has `.js`, `.cjs`, `.d.ts`, and `.d.ts.map` artifacts

### Requirement: `node:worker_threads` Is Isolated to `@trace-kit/core/node`
`packages/core/tsup.config.ts` MUST mark `node:worker_threads` as external. Neither the built root
`.` artifacts nor the built `./worker` artifacts (and their shared chunks, if any) may import or
reference `node:worker_threads` or any other `node:*` builtin. The `./worker` bundle MUST NOT pull
unrelated viewport, CSV export, or SVG modules.

#### Scenario: Root and worker build outputs contain zero Node builtin references
- **GIVEN**: the built ESM and CJS outputs for `.` and `./worker` under `packages/core/dist/`
- **WHEN**: a build-output inspection test scans `.` and `./worker` outputs for `node:worker_threads`
  and `node:` specifiers, and scans `./worker` for viewport/export symbols (`exportToCsv`)
- **THEN**: zero matches appear in `.` and `./worker` for `node:worker_threads` or `node:`, and
  zero matches appear in `./worker` for `exportToCsv`

### Requirement: `packages/core/SIDE_EFFECTS_AUDIT.md` Covers Every New Core Module
`packages/core/SIDE_EFFECTS_AUDIT.md` MUST maintain exact bidirectional set equality with all
source files matching `packages/core/src/**/*.ts` (including every new transport, streaming,
`src/worker.ts`, `src/node/index.ts`, `src/viewport/interaction.ts`, and
`src/transport/window-invalidation.ts` module), documenting that none performs an import-time
side effect and keeping `@trace-kit/core` 100% DOM-free (`"lib": ["ES2022"]`) with
`"sideEffects": false`.

#### Scenario: Bidirectional side-effects audit test passes with all new viewport-interaction core files
- **GIVEN**: `packages/core/src/**/*.ts` (including `src/viewport/interaction.ts` and
  `src/transport/window-invalidation.ts`) and `packages/core/SIDE_EFFECTS_AUDIT.md`
- **WHEN**: `packages/core/test/side-effects-audit.test.ts` runs
- **THEN**: the file set listed in `SIDE_EFFECTS_AUDIT.md` equals the exact set of `.ts` files
  under `packages/core/src/` with zero missing and zero extraneous entries

### Requirement: `@trace-kit/renderers` Exposes a `./controller` Subpath Built by tsup
`packages/renderers/package.json` `exports` MUST declare a `"./controller"` entry with `types`, `import`, and `require` conditions pointing at `./dist/controller/index.d.ts`, `./dist/controller/index.js`, and `./dist/controller/index.cjs`, alongside the existing `"."`, `"./font"`, `"./svg"`, `"./webgl2"`, and `"./fixtures"` entries. `packages/renderers/tsup.config.ts` MUST include `src/controller/index.ts` as a separate entry emitting ESM (`.js`), CJS (`.cjs`), declarations (`.d.ts`, `.d.cts`), and sourcemaps, and `packages/renderers/tsconfig.svg-dts.json` MUST include `src/controller/index.ts` so the post-build `tsc` step emits `./dist/controller/index.d.ts.map`.

The `./controller` subpath MUST export:
- Concrete runtime values and functions (exact `17` exports):
  - Engine controller exports: `createSpectrumEngineController`, `DEFAULT_HYSTERESIS_CONFIG`, `resolveHysteresisConfig`, `classifyHysteresisBand`, `evaluateHysteresisTarget`, `computePayloadSampleCount`, and `computeTracesSampleCount`.
  - Interaction controller exports: `createViewportInteractionController`, `DEFAULT_WHEEL_LINE_HEIGHT_PX`, `DEFAULT_WHEEL_PAGE_FALLBACK_PX`, `MAX_WHEEL_DELTA_PX`, `DEFAULT_WHEEL_SENSITIVITY`, `DEFAULT_MIN_BOX_SIZE_CSS`, `DEFAULT_SETTLE_DEBOUNCE_MS`, `classifyPointerRegion`, `normalizeWheelDeltaPx`, and `resolveWheelAxisMask`.
- TypeScript exported types in `dist/controller/index.d.ts` (exact `30` public types):
  - Engine controller types (`18`): `SpectrumEngineController`, `SpectrumEngineControllerOptions`, `ViewportDomain`, `EngineKind`, `EngineSelectionMode`, `HysteresisBand`, `HysteresisConfig`, `ResolvedHysteresisConfig`, `HysteresisEvaluationInput`, `HysteresisEvaluationResult`, `EngineChangeEvent`, `EngineChangeReason`, `WebGL2FallbackEvent`, `WebGL2ContextLostEvent`, `WebGL2ContextRestoredEvent`, `ResizeObserverLike`, `ResizeObserverEntryLike`, and `ResizeObserverCallbackLike`.
  - Interaction controller types (`12`): `ViewportInteractionController`, `ViewportInteractionControllerOptions`, `InteractionDragMode`, `WheelZoomAxis`, `PointerRegion`, `BoxZoomState`, `InteractionGestureState`, `ViewportInvalidationPhase`, `ViewportMutationReason`, `ViewportInvalidationEvent`, `BoxSelectEvent`, and `GestureStateChangeEvent`.

The root `"."` entry of `@trace-kit/renderers` MUST NOT include `createSpectrumEngineController`, `createViewportInteractionController`, `WebGL2FigureRenderer`, shader sources, `exportToSvg`, or any GL code.

#### Scenario: The ./controller subpath resolves under both ESM and CJS with all 17 concrete runtime exports
- **GIVEN**: the built `@trace-kit/renderers` package
- **WHEN**: Node evaluates `import('@trace-kit/renderers/controller')` and `require('@trace-kit/renderers/controller')`
- **THEN**: both resolve and expose the exact sorted set of 17 concrete runtime exports (`createSpectrumEngineController`, `createViewportInteractionController`, `DEFAULT_HYSTERESIS_CONFIG`, `DEFAULT_MIN_BOX_SIZE_CSS`, `DEFAULT_SETTLE_DEBOUNCE_MS`, `DEFAULT_WHEEL_LINE_HEIGHT_PX`, `DEFAULT_WHEEL_PAGE_FALLBACK_PX`, `DEFAULT_WHEEL_SENSITIVITY`, `MAX_WHEEL_DELTA_PX`, `classifyHysteresisBand`, `classifyPointerRegion`, `computePayloadSampleCount`, `computeTracesSampleCount`, `evaluateHysteresisTarget`, `normalizeWheelDeltaPx`, `resolveHysteresisConfig`, `resolveWheelAxisMask`)

#### Scenario: Declarations, CJS declarations, and declaration maps are emitted for ./controller with all 30 public types
- **GIVEN**: the build output for `./controller`
- **WHEN**: `packages/renderers/dist/controller/` is listed and `packages/renderers/dist/controller/index.d.ts` is inspected by `packages/renderers/test/node/engine-controller-build.test.ts`
- **THEN**: `dist/controller/` contains `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts`, and `index.d.ts.map`, and `index.d.ts` exports `SpectrumEngineController`, `ViewportInteractionController`, `WebGL2ContextLostEvent`, and `WebGL2ContextRestoredEvent` along with all 30 public types

#### Scenario: The root @trace-kit/renderers bundle excludes the controllers and WebGL2 backend
- **GIVEN**: the built root entry files `packages/renderers/dist/index.js` and `packages/renderers/dist/index.cjs`
- **WHEN**: they are searched for `createSpectrumEngineController`, `createViewportInteractionController`, `WebGL2FigureRenderer`, `getContext("webgl2"`, `floatBitsToUint`, and `exportToSvg`
- **THEN**: there is no match in either file

#### Scenario: The ./controller subpath entry points are declared in package.json
- **GIVEN**: `packages/renderers/package.json`
- **WHEN**: `exports["./controller"]` is inspected
- **THEN**: it declares `types: "./dist/controller/index.d.ts"`, `import: "./dist/controller/index.js"`, and `require: "./dist/controller/index.cjs"`

### Requirement: The `./controller` Subpath Is Included in the `sideEffects` Audit and Reaches Neither the SVG Exporter Nor the Embedded Font Entry
`packages/renderers/SIDE-EFFECTS.md` MUST list every file under `packages/renderers/src/controller/` (`controller/index.ts`, `controller/types.ts`, `controller/hysteresis.ts`, `controller/engine-controller.ts`, `controller/interaction-types.ts`, `controller/input-normalizer.ts`, `controller/box-zoom-overlay.ts`, `controller/invalidation-scheduler.ts`, `controller/viewport-interaction-controller.ts`) and state that none performs a top-level side effect (`| none |`: no import-time DOM creation, context acquisition, listener/observer registration, or global mutation). The built `./controller` ESM/CJS outputs (`dist/controller/index.js`, `dist/controller/index.cjs`) and their reachable chunks MUST NOT import or inline the `./svg` exporter (`exportToSvg` or `svg/index`) or the `./font` entry (embedded base64 WOFF2 font data URL), and the built `./webgl2` output and its chunks MUST continue not to reach `exportToSvg` or `./font`.

#### Scenario: The side-effects audit names every controller module
- **GIVEN**: `packages/renderers/SIDE-EFFECTS.md` and `packages/renderers/src/controller/*.ts`
- **WHEN**: the committed audit note is inspected by `packages/renderers/test/node/engine-controller-build.test.ts`
- **THEN**: it names all `9` `.ts` files under `src/controller/` with a `none` side-effect entry

#### Scenario: Importing ./controller in Node has no import-time side effect
- **GIVEN**: a Node process with no DOM globals (`document`, `window`, `ResizeObserver`, `OffscreenCanvas` undefined)
- **WHEN**: `import('@trace-kit/renderers/controller')` is evaluated
- **THEN**: it resolves without throwing and without accessing any DOM global at import time

#### Scenario: The ./controller bundle does not pull the SVG exporter or embedded font data URL
- **GIVEN**: the built `./controller` outputs `packages/renderers/dist/controller/index.js`, `packages/renderers/dist/controller/index.cjs`, and their reachable chunks
- **WHEN**: they are searched for `exportToSvg`, `svg/index`, `data:font/woff2;base64`, and `TRACEKIT_INTER_EMBEDDED_FONT`
- **THEN**: there is no match in any file
