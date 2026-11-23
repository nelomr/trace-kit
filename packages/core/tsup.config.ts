import { defineConfig } from "tsup";

// Dual ESM + CJS multi-entry build so consumers on either module system can `import` or `require`
// `@trace-kit/core`, `@trace-kit/core/worker`, or `@trace-kit/core/node` without pulling Node
// builtins into browser bundles or unrelated viewport/export code into worker bundles.
//
// `node:worker_threads` is externalized and imported exclusively by `src/node/index.ts`.
// tsup's declaration bundler cannot emit `.d.ts.map` files; `tsconfig.dts.json` adds declaration
// maps in the post-build `tsc` step (mirroring `packages/renderers/tsconfig.svg-dts.json`).
export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts", "src/node/index.ts"],
  format: ["esm", "cjs"],
  external: ["node:worker_threads"],
  removeNodeProtocol: false,
  tsconfig: "tsconfig.dts.json",
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
