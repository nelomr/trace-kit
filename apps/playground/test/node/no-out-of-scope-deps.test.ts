/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe("no dependency on an unowned package", () => {
  it("package.json declares no @trace-kit/renderers, @trace-kit/vue, or @trace-kit/react", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(dir, "../../package.json"), "utf8");
    const pkg = JSON.parse(raw) as PackageJsonShape;
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ["@trace-kit/renderers", "@trace-kit/vue", "@trace-kit/react"]) {
      expect(Object.keys(allDeps)).not.toContain(banned);
    }
  });
});
