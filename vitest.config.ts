import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Root Vitest configuration using `test.projects` from the outset (design.md §D5),
// rather than a flat config. A single project today (`core`, pinned to the `node`
// environment with no DOM globals — CLAUDE.md rule 5). `packages/renderers` and the
// framework adapter packages will need a `jsdom`/browser project later; under
// `test.projects` that is an added array entry, not a migration of `core`'s Node
// isolation.
//
// Each project's `root` is resolved to an absolute path from this file's own
// location rather than left as a bare relative string. Vitest resolves a relative
// project `root` against the CLI's invocation cwd, not against this config file's
// directory — so a per-package `"test": "vitest run"` script (which Turborepo runs
// with cwd set to the package directory) would otherwise resolve `"packages/core"`
// relative to `packages/core` itself, doubling the path and finding zero test files.
// An absolute root removes that dependency on invocation cwd entirely.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          root: path.join(rootDir, "packages/core"),
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
