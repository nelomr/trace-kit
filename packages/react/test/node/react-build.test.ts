import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(packageRoot, "../..");
const distDir = path.join(packageRoot, "dist");

interface PackageManifest {
  readonly name?: string;
  readonly sideEffects?: boolean;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: Record<string, Record<string, string>>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const EXPECTED_RUNTIME_EXPORTS = [
  "TraceSpectrumViewer",
  "snapshotDomain",
  "useSpectrumEngine",
];

describe("@trace-kit/react build surface, packaging, and static audits (node)", () => {
  it("declares sideEffects: false, dual ESM/CJS exports, and React 18/19 peer range", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.name).toBe("@trace-kit/react");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.main).toBe("./dist/index.cjs");
    expect(manifest.module).toBe("./dist/index.js");
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      require: "./dist/index.cjs",
    });
    expect(manifest.peerDependencies?.["react"]).toBe("^18.2.0 || ^19.0.0");
  });

  it("produces dist/index.js, dist/index.cjs, dist/index.d.ts, and dist/index.d.ts.map", () => {
    for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.ts.map"]) {
      expect(existsSync(path.join(distDir, file)), `missing dist/${file}`).toBe(true);
    }
  });

  it("resolves under both ESM and CJS in Node with exact sorted 3-symbol runtime export set", async () => {
    const esmUrl = pathToFileURL(path.join(distDir, "index.js")).href;
    const esmModule = (await import(esmUrl)) as Record<string, unknown>;
    const esmKeys = Object.keys(esmModule).sort();
    expect(esmKeys).toEqual(EXPECTED_RUNTIME_EXPORTS);

    const require = createRequire(import.meta.url);
    const cjsModule = require(path.join(distDir, "index.cjs")) as Record<string, unknown>;
    const cjsKeys = Object.keys(cjsModule).sort();
    expect(cjsKeys).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it("externalizes react and @trace-kit/* out of dist bundles", () => {
    const esmText = readFileSync(path.join(distDir, "index.js"), "utf8");
    const cjsText = readFileSync(path.join(distDir, "index.cjs"), "utf8");

    expect(esmText).toMatch(/from\s*["']react["']/);
    expect(cjsText).toMatch(/require\(["']react["']\)/);
    expect(esmText).not.toContain("ReactCurrentDispatcher");
    expect(cjsText).not.toContain("ReactCurrentDispatcher");
  });

  it("verifies vitest.config.ts declares 12 workspace projects including react & react-dom", () => {
    const vitestConfigText = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
    const projectNames = [...vitestConfigText.matchAll(/name:\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((name) => name !== "trace-kit-test-only-coop-coep");

    expect(projectNames).toEqual([
      "core",
      "playground",
      "renderers",
      "renderers-dom",
      "visual",
      "engine-bench",
      "core-worker-transfer",
      "core-worker-shared",
      "vue",
      "vue-dom",
      "react",
      "react-dom",
    ]);
    expect(vitestConfigText).toContain('root: path.join(rootDir, "packages/react")');
  });

  it("keeps react and react-dom out of packages/core, packages/renderers, packages/vue, and apps/playground", () => {
    for (const relPkg of [
      "packages/core/package.json",
      "packages/renderers/package.json",
      "packages/vue/package.json",
      "apps/playground/package.json",
    ]) {
      const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, relPkg), "utf8"),
      ) as PackageManifest;
      for (const map of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
        manifest.optionalDependencies,
      ]) {
        expect(map?.["react"], `${relPkg} must not depend on react`).toBeUndefined();
        expect(map?.["react-dom"], `${relPkg} must not depend on react-dom`).toBeUndefined();
      }
    }
  });

  it(
    "fires @typescript-eslint/no-explicit-any and no-restricted-syntax on packages/react/src and packages/react/test via ESLint Node API",
    async () => {
      const eslint = new ESLint({
        cwd: repoRoot,
        overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
        ignore: false,
      });

      const violatingCode = [
        "export function bad(x: any): number {",
        "  return (x as unknown as number);",
        "}",
      ].join("\n");

      const srcResults = await eslint.lintText(violatingCode, {
        filePath: path.join(repoRoot, "packages/react/src/domain-sync.ts"),
      });
      const srcRuleIds = srcResults.flatMap((r) => r.messages.map((m) => m.ruleId));
      expect(srcRuleIds).toContain("@typescript-eslint/no-explicit-any");
      expect(srcRuleIds).toContain("no-restricted-syntax");

      // Use committed fixture with lintFiles so classic parserOptions.project works identically under CI=true singleRun
      const fixtureResults = await eslint.lintFiles([
        path.join(repoRoot, "packages/react/test/fixtures/lint-violation.ts"),
      ]);
      const fixtureRuleIds = fixtureResults.flatMap((r) => r.messages.map((m) => m.ruleId));
      expect(fixtureRuleIds).toContain("@typescript-eslint/no-explicit-any");
      expect(fixtureRuleIds).toContain("no-restricted-syntax");
    },
    30_000,
  );
});
