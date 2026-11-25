# `sideEffects: false` audit

`package.json` declares `"sideEffects": false`, which lets a bundler drop any import whose exports
go unused. That is only true while no module runs code with observable external effects at import
time. This note records the file-by-file audit for every source module in `@trace-kit/vue`.

Rule applied to every file below: **no top-level side effect**. A file may contain only `import`
and `export` statements, `const` declarations of frozen local literals, pure `/*#__PURE__*/`
component definitions (`defineComponent(...)` constructs a plain options descriptor object without
reading DOM or browser globals), and function or type declarations. Nothing registers, mutates,
reads `window`/`document`/`ResizeObserver`/`HTMLCanvasElement`/`requestAnimationFrame`, or touches
any external global at import time.

## `src/`

| File | Top-level content | Side effect |
|---|---|---|
| `index.ts` | re-exports only (`useSpectrumEngine`, `TraceSpectrumViewer`, `snapshotDomain`, and public types) | none |
| `types.ts` | TypeScript type and interface declarations only (zero runtime bytes) | none |
| `domain-sync.ts` | one frozen default domain literal, pure helper functions | none |
| `use-spectrum-engine.ts` | composable function declaration and pure internal helpers | none |
| `trace-spectrum-viewer.ts` | three frozen style literals and one `/*#__PURE__*/ defineComponent(...)` options export | none |
