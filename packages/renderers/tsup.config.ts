import { defineConfig } from "tsup";

// Dual ESM + CJS build mirroring `packages/core/tsup.config.ts`. `test/` sits outside `src/`,
// so this glob never sees it — it is typechecked and linted via `tsconfig.test.json` instead.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
