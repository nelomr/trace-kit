# Capability: package-build-pipeline

## ADDED Requirements

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
emit a `.d.ts.map` for `./webgl2`. The subpath MUST expose `WebGL2FigureRenderer` and the type
`WebGL2FigureRendererOptions` (and `WebGL2FigureSurfaces`). The root `.` entry MUST NOT include
the WebGL2 module, the shader sources or any GL code.

#### Scenario: The subpath resolves under both module systems
- **GIVEN**: the built renderers package
- **WHEN**: Node performs `import('@trace-kit/renderers/webgl2')` and
  `require('@trace-kit/renderers/webgl2')`
- **THEN**: both resolve and expose `WebGL2FigureRenderer`

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
The `sideEffects` audit for `@trace-kit/renderers` MUST list every file under `src/webgl2/` and
state that none performs a top-level side effect (no import-time context creation, shader
compilation, listener registration or global mutation: shader sources are plain string constants).
The `./webgl2` bundle MUST NOT import the `./font` entry or the `./svg` entry.

#### Scenario: The audit names the new modules
- **GIVEN**: the committed audit note
- **WHEN**: it is inspected
- **THEN**: it names every file under `src/webgl2/` with a no-side-effect statement

#### Scenario: Importing the subpath has no side effect
- **GIVEN**: a Node process with no DOM globals
- **WHEN**: `import('@trace-kit/renderers/webgl2')` is evaluated
- **THEN**: it resolves without throwing, without touching `document`/`window`/`OffscreenCanvas`
  and without creating a context

#### Scenario: The WebGL2 bundle does not pull the font or the exporter
- **GIVEN**: the built `./webgl2` ESM output and its chunks
- **WHEN**: they are searched for the embedded font data URL and `exportToSvg`
- **THEN**: neither appears
