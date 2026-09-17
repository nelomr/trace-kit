import { defineConfig } from "tsup";

// Dual ESM + CJS build mirroring `packages/core/tsup.config.ts`. `test/` sits outside `src/`,
// so this glob never sees it — it is typechecked and linted via `tsconfig.test.json` instead.
//
// `src/font/index.ts` is a second, separate entry rather than being re-exported from
// `src/index.ts`: the embedded base64 font data must never load into a consumer's bundle
// unless they explicitly import the font subpath — most consumers only need
// `TRACEKIT_INTER_FAMILY` (a plain string, re-exported from the main entry) and never call
// `ensureDefaultFont`, so bundling the ~8 KB data URL into every import of this package would
// be dead weight for them.
export default defineConfig({
  entry: ["src/index.ts", "src/font/index.ts", "src/fixtures/scenarios.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
