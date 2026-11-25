import { defineConfig } from "tsup";

// Dual ESM + CJS build mirroring `packages/core/tsup.config.ts` and
// `packages/renderers/tsup.config.ts`. Externalizes `vue` and all `@trace-kit/*`
// workspace entries so neither Vue's runtime nor renderer implementations bundle into
// `dist/`. No `target` override is declared — inherits `tsconfig.base.json`'s `ES2022`.
// Post-build `tsc -p tsconfig.dts.json` adds `dist/index.d.ts.map`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  external: [
    "vue",
    "@trace-kit/core",
    "@trace-kit/renderers",
    "@trace-kit/renderers/controller",
  ],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
