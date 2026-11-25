import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  it("declares sideEffects: false, dual ESM/CJS exports, React 18/19 peer range, and catalog pins", () => {
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
    expect(manifest.devDependencies?.["react"]).toBe("catalog:");
    expect(manifest.devDependencies?.["react-dom"]).toBe("catalog:");
    expect(manifest.devDependencies?.["@types/react"]).toBe("catalog:");
    expect(manifest.devDependencies?.["@types/react-dom"]).toBe("catalog:");
  });

  it("declares zero excluded runtime/test-helper/d3/vue dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as PackageManifest;
    const allDeps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const banned of ["@testing-library/react", "d3-scale", "vue", "react-test-renderer"]) {
      expect(allDeps[banned], `unexpected dependency ${banned}`).toBeUndefined();
    }
  });

  it("emits dual ESM, CJS, .d.ts, .d.cts, .d.ts.map, and sourcemaps without tsup target override", () => {
    for (const file of [
      "index.js",
      "index.js.map",
      "index.cjs",
      "index.cjs.map",
      "index.d.ts",
      "index.d.cts",
      "index.d.ts.map",
    ]) {
      expect(existsSync(path.join(distDir, file)), `missing dist/${file}`).toBe(true);
    }
    const tsupText = readFileSync(path.join(packageRoot, "tsup.config.ts"), "utf8");
    expect(tsupText).not.toMatch(/\btarget\s*:/);
  });

  it("resolves under both ESM and CJS in Node with exact sorted 3-symbol runtime export set", async () => {
    const esmUrl = pathToFileURL(path.join(distDir, "index.js")).href;
    const esmModule = (await import(esmUrl)) as Record<string, unknown>;
    expect(Object.keys(esmModule).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);

    const require = createRequire(import.meta.url);
    const cjsModule = require(path.join(distDir, "index.cjs")) as Record<string, unknown>;
    expect(Object.keys(cjsModule).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it("externalizes react and @trace-kit/renderers/controller without inlining runtime internals or JSX runtime", () => {
    const esmText = readFileSync(path.join(distDir, "index.js"), "utf8");
    const cjsText = readFileSync(path.join(distDir, "index.cjs"), "utf8");

    expect(esmText).toMatch(/from\s*["']react["']/);
    expect(cjsText).toMatch(/require\(["']react["']\)/);
    expect(esmText).toMatch(/from\s*["']@trace-kit\/renderers\/controller["']/);
    expect(cjsText).toMatch(/require\(["']@trace-kit\/renderers\/controller["']\)/);
    expect(esmText).not.toContain("react/jsx-runtime");
    expect(cjsText).not.toContain("react/jsx-runtime");
    expect(esmText).not.toContain("ReactCurrentDispatcher");
    expect(cjsText).not.toContain("ReactCurrentDispatcher");
  });

  it("reaches zero SVG exporter or embedded font payloads across all dist/ files", () => {
    for (const file of readdirSync(distDir)) {
      if (!file.endsWith(".js") && !file.endsWith(".cjs")) continue;
      const content = readFileSync(path.join(distDir, file), "utf8");
      expect(content, `${file} must not bundle exportToSvg`).not.toContain("exportToSvg");
      expect(content, `${file} must not bundle embedded font`).not.toContain("TRACEKIT_INTER_EMBEDDED_FONT");
    }
  });

  it("preserves /*#__PURE__*/ annotation immediately preceding forwardRef with zero top-level .displayName side effects", () => {
    const srcText = readFileSync(path.join(packageRoot, "src/trace-spectrum-viewer.ts"), "utf8");
    expect(srcText).toContain("/*#__PURE__*/ forwardRef");
    expect(srcText).not.toMatch(/TraceSpectrumViewer\.displayName\s*=/);
    const esmText = readFileSync(path.join(distDir, "index.js"), "utf8");
    const cjsText = readFileSync(path.join(distDir, "index.cjs"), "utf8");
    const pureForwardRefRe = /\/\*\s*[@#]__PURE__\s*\*\/\s*(?:\(0,\s*[\w$.]+\.)?forwardRef/;
    expect(esmText).toMatch(pureForwardRefRe);
    expect(cjsText).toMatch(pureForwardRefRe);
    expect(esmText).not.toMatch(/TraceSpectrumViewer\.displayName\s*=/);
    expect(cjsText).not.toMatch(/TraceSpectrumViewer\.displayName\s*=/);
  });

  it("contains zero useState() calls across packages/react/src/**/*.ts (strict ref + external store isolation)", () => {
    const srcFiles = readdirSync(path.join(packageRoot, "src")).filter((f) => f.endsWith(".ts"));
    for (const file of srcFiles) {
      const content = readFileSync(path.join(packageRoot, "src", file), "utf8");
      expect(content, `${file} must not use useState`).not.toMatch(/\buseState\b/);
    }
  });

  it("maintains exact bidirectional set equality between packages/react/SIDE-EFFECTS.md and src/**/*.ts (all none)", () => {
    const mdText = readFileSync(path.join(packageRoot, "SIDE-EFFECTS.md"), "utf8");
    const documentedEntries = [...mdText.matchAll(/^\|\s*`(src\/[^`]+\.ts)`\s*\|\s*(\w+)\s*\|/gm)];
    const documentedPaths = documentedEntries.map((m) => m[1]!).sort();
    const actualPaths = readdirSync(path.join(packageRoot, "src"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `src/${f}`)
      .sort();

    expect(documentedPaths).toEqual(actualPaths);
    for (const [, modPath, status] of documentedEntries) {
      expect(status, `${modPath} must declare 'none'`).toBe("none");
    }
  });

  it("verifies strict tsconfig inheritance (zero baseUrl or allowImportingTsExtensions)", () => {
    for (const configName of ["tsconfig.json", "tsconfig.dts.json", "tsconfig.test.json"]) {
      const parsed = JSON.parse(
        readFileSync(path.join(packageRoot, configName), "utf8"),
      ) as { compilerOptions?: Record<string, unknown> };
      expect(parsed.compilerOptions?.["baseUrl"], `${configName} baseUrl`).toBeUndefined();
      expect(
        parsed.compilerOptions?.["allowImportingTsExtensions"],
        `${configName} allowImportingTsExtensions`,
      ).toBeUndefined();
    }
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
