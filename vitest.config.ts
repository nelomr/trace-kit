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
    // `--expose-gc` is a V8 flag: `NODE_OPTIONS` rejects V8 flags outright, and the default
    // `threads` pool's `worker_threads` rejects them in `execArgv`
    // (`ERR_WORKER_INVALID_EXEC_ARGV`). A forked child process is the only pool whose
    // `execArgv` accepts V8 flags (design.md §D6). This MUST live on the top-level `test`
    // object, not inside a `projects[].test` entry — per-project `pool`/`poolOptions` are
    // resolved but not propagated to the process pool that actually spawns workers in
    // Vitest 3.2.7 (verified empirically: a project-scoped `execArgv` silently has no
    // effect on the forked child's `process.execArgv`, while the same option at this
    // top level does). With a single `core` project today this is equivalent to scoping it
    // there; when a `jsdom` project is added later, `--expose-gc` in a browser-like
    // environment is inert, so applying it workspace-wide is harmless.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--expose-gc"],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          root: path.join(rootDir, "packages/core"),
          environment: "node",
          include: ["test/**/*.test.ts"],
          setupFiles: ["test/setup/fast-check.ts"],
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            // Mirrors `apps/playground/vite.config.ts`'s alias so the DOM-free build config
            // and the test config resolve `@trace-kit/bench-harness` identically — this
            // project entry is a full Vite config, not only a `test` fragment, and Vitest's
            // own config discovery does not merge `apps/playground/vite.config.ts` in when
            // running through this root config.
            "@trace-kit/bench-harness": path.join(
              rootDir,
              "packages/core/bench/runner-core.ts",
            ),
          },
        },
        test: {
          name: "playground",
          root: path.join(rootDir, "apps/playground"),
          environment: "happy-dom",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderers",
          root: path.join(rootDir, "packages/renderers"),
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderers-dom",
          root: path.join(rootDir, "packages/renderers"),
          environment: "happy-dom",
          include: ["test/dom/**/*.test.ts"],
        },
      },
    ],
  },
});
