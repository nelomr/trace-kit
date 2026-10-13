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
//
// `src/svg/index.ts` is a third separate entry for the same reason: the SVG exporter is a cold,
// offline path that most consumers of the renderer never call, so it must not load with the root
// entry. It also must not reach the font entry — a caller opts into font embedding by passing
// the font module's constant in, so the exporter bundle never carries the data URL itself.
//
// `src/webgl2/index.ts` is a fourth separate entry for the same reason: the shader sources and GL
// plumbing are dead weight for every consumer that only draws with Canvas2D, so they must not load
// with the root entry. It does not reach the font data or the SVG exporter either.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/font/index.ts",
    "src/svg/index.ts",
    "src/webgl2/index.ts",
    "src/fixtures/scenarios.ts",
  ],
  format: ["esm", "cjs"],
  // tsup's declaration bundler cannot emit `.d.ts.map` files; `tsconfig.svg-dts.json` adds them
  // for the exporter and WebGL2 entries in a post-build `tsc` step (see the `build` script).
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
