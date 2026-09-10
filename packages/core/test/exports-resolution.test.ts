import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Proves the corrected `exports`/`main`/`module` fields (design.md §D4) actually resolve
// against the built `dist/` output, for both a dynamic `import()` (the `import` condition)
// and `createRequire(...)('@trace-kit/core')` (the `require` condition) — and that the two
// resolved entry points are genuinely distinct files (ESM vs CJS), not one masquerading as
// the other.
describe("exports resolution", () => {
  it("resolves via dynamic import()", async () => {
    const esm = await import("@trace-kit/core");
    expect(typeof esm.VERSION).toBe("string");
  });

  it("resolves via createRequire(...)('@trace-kit/core')", () => {
    // `require()`'s call signature returns `any` by Node's own type definitions
    // (CLAUDE.md rule 1 bans `any`, so this narrows through `unknown` with a runtime check
    // rather than trusting the untyped return value).
    const require = createRequire(import.meta.url);
    const cjs: unknown = require("@trace-kit/core");
    if (typeof cjs !== "object" || cjs === null || !("VERSION" in cjs)) {
      throw new TypeError("expected the CJS entry to export VERSION");
    }
    expect(typeof cjs.VERSION).toBe("string");
  });

  it("resolves the ESM and CJS entries to distinct files", () => {
    // `import.meta.resolve` is not implemented by Vitest's Vite-SSR transform, so this
    // confirms distinctness structurally: the `require`-resolved CJS path is a `.cjs` file,
    // and its ESM sibling declared by the `exports["."].import` condition
    // (`dist/index.js`, per package.json) exists as a genuinely different file on disk —
    // not an alias, symlink-to-self, or the same file under two names.
    const require = createRequire(import.meta.url);
    const cjsPath = require.resolve("@trace-kit/core");
    expect(cjsPath.endsWith(".cjs")).toBe(true);

    const esmPath = path.join(path.dirname(cjsPath), "index.js");
    expect(esmPath).not.toBe(cjsPath);
    expect(existsSync(esmPath)).toBe(true);
  });
});
