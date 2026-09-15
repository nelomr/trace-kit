/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("tweakpane resolves from the pnpm catalog", () => {
  it("pnpm-workspace.yaml's catalog declares tweakpane, and package.json uses catalog:", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const workspaceYaml = readFileSync(
      path.join(dir, "../../../../pnpm-workspace.yaml"),
      "utf8",
    );
    expect(workspaceYaml).toMatch(/^\s*'?tweakpane'?:\s*'?\^?[\d.]+'?/m);

    const pkgRaw = readFileSync(path.join(dir, "../../package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.tweakpane).toBe("catalog:");
  });
});
