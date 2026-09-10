import { defineConfig } from "tsup";

// Dual ESM + CJS build (design.md §D3). `bench/` and `test/` are outside `src/`, so this glob
// never sees them — they are typechecked and linted via `tsconfig.test.json` instead, never
// published.
//
// ACCEPTED, INTENTIONAL DEFERRAL to change 12 (confirmed with the user — not a silent gap):
// tsup's `dts` option bundles declarations via `rollup-plugin-dts`, which does not emit
// `.d.ts.map` declaration maps at all (no `sourcemap` field exists on tsup's `DtsConfig`
// type). The alternative `experimentalDts: true` path requires `@microsoft/api-extractor`, a
// new, uncatalogued dependency — out of scope for this change (design.md's own §D3 names that
// path as "the escape hatch to consider... if `dts` becomes the build's bottleneck" at change
// 12, not a requirement here). `dts: true` is used as written; declaration maps are not
// emitted. `.js`/`.cjs` sourcemaps ARE emitted (tsup supports those natively) and are the
// sourcemap guarantee this change can actually keep. Full detail and the change-12 handoff:
// openspec/changes/workspace-test-harness-bootstrap/evidence/baseline.md (Group 3 section).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
