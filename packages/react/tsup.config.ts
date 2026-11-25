import { defineConfig } from "tsup";

// Dual ESM + CJS build mirroring `packages/vue/tsup.config.ts`. Externalizes `react`
// and all `@trace-kit/*` workspace entries so neither React's runtime nor renderer
// implementations bundle into `dist/`. Post-build `tsc -p tsconfig.dts.json` adds
// `dist/index.d.ts.map`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  external: [
    "react",
    "@trace-kit/core",
    "@trace-kit/renderers",
    "@trace-kit/renderers/controller",
  ],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
