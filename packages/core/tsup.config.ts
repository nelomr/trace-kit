import { defineConfig } from "tsup";

// Dual ESM + CJS build so consumers on either module system can `import` or `require` this
// package without a bundler doing the translation. `bench/` and `test/` are outside `src/`,
// so this glob never sees them — they are typechecked and linted via `tsconfig.test.json`
// instead, never published.
//
// KNOWN, ACCEPTED GAP (not a silent oversight): tsup's `dts` option bundles declarations via
// `rollup-plugin-dts`, which does not emit `.d.ts.map` declaration maps at all (no
// `sourcemap` field exists on tsup's `DtsConfig` type). The alternative
// `experimentalDts: true` path requires `@microsoft/api-extractor`, a new, uncatalogued
// dependency that isn't justified unless `dts` generation actually becomes a build
// bottleneck. `dts: true` is used as written; declaration maps are not emitted. `.js`/`.cjs`
// sourcemaps ARE emitted (tsup supports those natively) and are the sourcemap guarantee this
// build can actually keep.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
