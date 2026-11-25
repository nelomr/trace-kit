# Side-Effects Audit — `@trace-kit/react`

`package.json` declares `"sideEffects": false`. Every source module under `src/` MUST remain free of module-evaluation side effects so bundlers can tree-shake unused exports safely.

| Module | Side Effects | Notes |
|---|---|---|
| `src/domain-sync.ts` | none | Pure functions and frozen constant (`DEFAULT_DOMAIN_SNAPSHOT`) |
| `src/index.ts` | none | Pure re-export barrel |
| `src/trace-spectrum-viewer.ts` | none | `/*#__PURE__*/ forwardRef(...)` component factory + frozen style objects |
| `src/types.ts` | none | TypeScript type declarations only (erased at compile time) |
| `src/use-spectrum-engine.ts` | none | Pure hook and helper declarations |
