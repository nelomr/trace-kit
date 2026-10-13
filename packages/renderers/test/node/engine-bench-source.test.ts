/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.join(packageRoot, "../..");
const benchDir = path.join(packageRoot, "bench");
const benchSources = readdirSync(benchDir)
  .filter((file) => file.endsWith(".bench-browser.ts"))
  .map((file) => [file, readFileSync(path.join(benchDir, file), "utf8")] as const);

describe("the engine benchmark sources", () => {
  it("exist", () => {
    expect(benchSources.map(([file]) => file)).toContain("engine-crossover.bench-browser.ts");
  });

  it("carry no assertion and no exit-code logic", () => {
    for (const [file, source] of benchSources) {
      expect(source, `${file} expect(`).not.toMatch(/\bexpect\s*\(/);
      expect(source, `${file} process.exit`).not.toMatch(/process\.exit/);
    }
  });
});

describe("how the engine-bench project is wired", () => {
  it("includes only bench/**/*.bench-browser.ts", () => {
    const config = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
    const start = config.indexOf('name: "engine-bench"');
    expect(start).toBeGreaterThan(-1);
    const block = config.slice(start, start + 900);
    expect(block).toContain('include: ["bench/**/*.bench-browser.ts"]');
  });

  it("is run by no package test script and no turbo pipeline", () => {
    const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === "bench:engines") continue;
      expect(command, name).not.toContain("engine-bench");
    }
    expect(pkg.scripts["bench:engines"]).toContain("--project engine-bench");
    const turbo = readFileSync(path.join(repoRoot, "turbo.json"), "utf8");
    expect(turbo).not.toContain("bench");
    const root = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const command of Object.values(root.scripts)) expect(command).not.toContain("engine-bench");
  });

  it("has no workflow", () => {
    expect(existsSync(path.join(repoRoot, ".github/workflows/engine-bench.yml"))).toBe(false);
    for (const file of readdirSync(path.join(repoRoot, ".github/workflows"))) {
      expect(readFileSync(path.join(repoRoot, ".github/workflows", file), "utf8"), file).not.toContain("engine-bench");
    }
  });
});
