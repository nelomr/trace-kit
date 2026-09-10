# Capability: package-build-pipeline

> Change: `workspace-test-harness-bootstrap`. New capability.

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
paths). `packages/core`'s existing unaudited `sideEffects: false` MUST be brought under this
audit by this change.

#### Scenario: packages/core sideEffects is documented as audited
- **GIVEN**: `packages/core/package.json` declares `"sideEffects": false`
- **WHEN**: a reviewer inspects this change's PR description or a committed audit note
- **THEN**: the audit note names every source file under `packages/core/src` and states that
  none performs a top-level side effect (no top-level function call with observable effect, no
  top-level mutation of a shared object)
