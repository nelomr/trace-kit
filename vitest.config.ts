import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Root Vitest configuration using `test.projects` from the outset,
// rather than a flat config. A single project today (`core`, pinned to the `node`
// environment with no DOM globals — CLAUDE.md rule 5). `packages/renderers` and the
// framework adapter packages will need a `jsdom`/browser project later; under
// `test.projects` that is an added array entry, not a migration of `core`'s Node
// isolation.
//
// Each project's `root` is resolved to an absolute path from this file's own location
// rather than left as a bare relative string. On Vitest 5, a relative project `root`
// resolves correctly against this config file's directory regardless of invocation cwd,
// so the absolute construction is no longer required to find test files — it is kept as
// a defensive default that stays correct no matter which cwd a script is invoked from
// (a per-package `"test": "vitest run"` script, run by Turborepo with cwd set to the
// package directory, is one such case).
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
          setupFiles: ["test/setup/fast-check.ts"],
          // `--expose-gc` is a V8 flag: `NODE_OPTIONS` rejects V8 flags outright, and the
          // default `threads` pool's `worker_threads` rejects them in `execArgv`
          // (`ERR_WORKER_INVALID_EXEC_ARGV`). A forked child process is the only pool whose
          // `execArgv` accepts V8 flags. On Vitest 5, a project-scoped `pool`/`execArgv`
          // propagates correctly to the forked worker, so it is scoped to only the two
          // projects whose allocation-gate tests read `globalThis.gc` rather than applied
          // workspace-wide.
          pool: "forks",
          execArgv: ["--expose-gc"],
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
          // Same `--expose-gc` scoping as `core`/`renderers` above — `test/node/buffer-reuse.test.ts`
          // and `test/node/lorentzian-gc-gate.test.ts` also read `globalThis.gc`.
          pool: "forks",
          execArgv: ["--expose-gc"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderers",
          root: path.join(rootDir, "packages/renderers"),
          environment: "node",
          include: ["test/node/**/*.test.ts"],
          // Same `--expose-gc` scoping as the `core` project above — this project's
          // `test/node/allocation-gate.test.ts` also reads `globalThis.gc`.
          pool: "forks",
          execArgv: ["--expose-gc"],
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
      {
        extends: true,
        // Baked in at config-evaluation time (Node-side, here) rather than read at test
        // runtime: browser-mode test code executes inside the actual browser, where
        // `process.platform` does not exist. `define` replaces this identifier with a
        // literal boolean in the bundle the browser loads, so the visual test file can skip
        // off-Linux without needing any Node global at runtime. Must be a sibling of `test`,
        // not nested inside it — this project entry is a full Vite config, matching the
        // `playground` project's own `resolve.alias` sibling placement above.
        define: {
          __TRACEKIT_VISUAL_IS_LINUX_CI__: process.platform === "linux",
        },
        test: {
          name: "visual",
          root: path.join(rootDir, "packages/renderers"),
          include: ["test/visual/**/*.test.ts"],
          // No `environment` key: this project renders in a real browser (Chromium, via
          // Playwright) rather than in a simulated DOM. No `execArgv`/`pool` override either —
          // `--expose-gc` has nothing to instrument here; visual cases assert painted pixels,
          // not allocation counts.
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            expect: {
              toMatchScreenshot: {
                comparatorName: "pixelmatch",
                comparatorOptions: {
                  threshold: 0.1,
                  includeAA: true,
                  allowedMismatchedPixelRatio: 0.001,
                },
                // Flat, no platform/browser token — the corpus is generated and compared on
                // `ubuntu-latest` only, so a platform-keyed filename would only ever have
                // one value and adds nothing; adding a second platform later is a one-line
                // change to these two functions, not a corpus rename.
                resolveScreenshotPath: ({ testFileDirectory, arg, ext }) =>
                  path.join(rootDir, "packages/renderers", testFileDirectory, "__screenshots__", `${arg}${ext}`),
                resolveDiffPath: ({ testFileDirectory, arg, ext }) =>
                  path.join(
                    rootDir,
                    "packages/renderers",
                    testFileDirectory,
                    "__screenshots__",
                    "__diffs__",
                    `${arg}${ext}`,
                  ),
              },
            },
          },
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            // Same alias as the playground project: the browser bundle must not pull the Node
            // reporting half of the harness.
            "@trace-kit/bench-harness": path.join(
              rootDir,
              "packages/core/bench/runner-core.ts",
            ),
          },
        },
        test: {
          name: "engine-bench",
          root: path.join(rootDir, "packages/renderers"),
          include: ["bench/**/*.bench-browser.ts"],
          // Measurements, not assertions: a GPU frame is far slower than the default 5 s
          // budget for 1,000,000-sample sweeps plus warm-up.
          testTimeout: 600_000,
          // Only reached through `pnpm --filter @trace-kit/renderers run bench:engines`; no
          // package `test` script lists this project, so `pnpm run test` never executes it.
          // `ENGINE_BENCH_GPU=1` is a local-only switch for measuring on a GPU-backed Chromium:
          // headed, ANGLE on Metal, without the software-rasterizer fallback. The default stays
          // headless on whatever Playwright's bundled Chromium picks.
          browser: {
            enabled: true,
            headless: process.env["ENGINE_BENCH_GPU"] !== "1",
            provider:
              process.env["ENGINE_BENCH_GPU"] === "1"
                ? playwright({
                    launchOptions: {
                      args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"],
                      ignoreDefaultArgs: ["--enable-unsafe-swiftshader", "--disable-gpu"],
                    },
                  })
                : playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
