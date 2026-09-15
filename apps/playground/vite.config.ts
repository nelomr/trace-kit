import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Mirrors the `@trace-kit/bench-harness` alias in tsconfig.json (design.md §D9): the
// millisecond table reaches `runner-core.ts` directly rather than through
// `@trace-kit/core`'s exports map, because the harness is an unpublished development
// instrument, not part of the package's public surface.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@trace-kit/bench-harness": path.join(
        rootDir,
        "../../packages/core/bench/runner-core.ts",
      ),
    },
  },
});
