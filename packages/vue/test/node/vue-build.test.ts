/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { parseWorkspaceYaml } from "../../../../scripts/verify-catalog-discipline.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const dist = (...parts: string[]) => path.join(packageRoot, "dist", ...parts);

interface PackageManifest {
  readonly name: string;
  readonly type?: string;
  readonly sideEffects?: boolean;
  readonly exports?: Record<string, Record<string, string>>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const pkg = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
) as PackageManifest;

const EXPECTED_RUNTIME_EXPORTS = [
  "TraceSpectrumViewer",
  "snapshotDomain",
  "useSpectrumEngine",
];

const EXCLUDED_DEPENDENCIES = [
  "d3-scale",
  "@vue/test-utils",
  "vue-tsc",
  "@vitejs/plugin-vue",
  "vue-eslint-parser",
  "eslint-plugin-vue",
];

function collectTsFiles(dir: string, prefix = ""): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(abs, rel));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(rel);
    }
  }
  return results.sort();
}

function collectDistFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDistFiles(abs));
    } else if (entry.isFile()) {
      results.push(abs);
    }
  }
  return results;
}

const LINT_TIMEOUT_MS = 20_000;

describe("@trace-kit/vue build surface, packaging, and static audits (node)", () => {
  it("declares valid package.json exports, sideEffects: false, vue peer/dev deps, and catalog pin", () => {
    expect(pkg.name).toBe("@trace-kit/vue");
    expect(pkg.type).toBe("module");
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      require: "./dist/index.cjs",
    });
    expect(pkg.peerDependencies?.["vue"]).toBe("^3.4.0");
    expect(pkg.devDependencies?.["vue"]).toBe("catalog:");

    const workspaceYaml = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    const { catalog } = parseWorkspaceYaml(workspaceYaml);
    expect(catalog["vue"]).toBe("3.5.46");
  });

  it("declares zero excluded SFC, test-utils, or d3-scale dependencies", () => {
    const allDepMaps = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ];
    for (const depMap of allDepMaps) {
      if (depMap === undefined) continue;
      for (const excluded of EXCLUDED_DEPENDENCIES) {
        expect(depMap[excluded], `excluded dep ${excluded}`).toBeUndefined();
      }
    }
  });

  it("emits dual ESM, CJS, .d.ts, .d.cts, .d.ts.map, and sourcemaps without tsup target override", () => {
    for (const file of [
      "index.js",
      "index.cjs",
      "index.d.ts",
      "index.d.cts",
      "index.d.ts.map",
      "index.js.map",
      "index.cjs.map",
    ]) {
      expect(existsSync(dist(file)), `dist/${file}`).toBe(true);
    }

    const tsupConfig = readFileSync(path.join(packageRoot, "tsup.config.ts"), "utf8");
    expect(tsupConfig).not.toMatch(/\btarget\s*:/);
  });

  it("resolves under both ESM and CJS in Node with exact sorted 3-symbol runtime export set", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");

    const esm = (await import("@trace-kit/vue")) as Record<string, unknown>;
    expect(Object.keys(esm).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
    expect(typeof esm["useSpectrumEngine"]).toBe("function");
    expect(typeof esm["snapshotDomain"]).toBe("function");
    expect(esm["TraceSpectrumViewer"]).toBeDefined();

    const cjs = createRequire(import.meta.url)("@trace-kit/vue") as Record<string, unknown>;
    expect(Object.keys(cjs).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
    expect(typeof cjs["useSpectrumEngine"]).toBe("function");
    expect(typeof cjs["snapshotDomain"]).toBe("function");
    expect(cjs["TraceSpectrumViewer"]).toBeDefined();
  });

  it("externalizes vue and @trace-kit/renderers/controller without inlining runtime internals", () => {
    const esmSource = readFileSync(dist("index.js"), "utf8");
    const cjsSource = readFileSync(dist("index.cjs"), "utf8");

    expect(esmSource).toMatch(/from\s+["']vue["']/);
    expect(esmSource).toMatch(/from\s+["']@trace-kit\/renderers\/controller["']/);
    expect(cjsSource).toMatch(/require\(["']vue["']\)/);
    expect(cjsSource).toMatch(/require\(["']@trace-kit\/renderers\/controller["']\)/);

    for (const [label, source] of [
      ["dist/index.js", esmSource],
      ["dist/index.cjs", cjsSource],
    ] as const) {
      for (const banned of [
        "createBaseVNode",
        "reactiveEffect",
        "class Canvas2DRenderer",
        "class WebGL2FigureRenderer",
        "getContext(\"webgl2\"",
      ]) {
        expect(source, `${label} must not inline ${banned}`).not.toContain(banned);
      }
    }
  });

  it("reaches zero SVG exporter or embedded font payloads across all dist/ files", () => {
    const distFiles = collectDistFiles(dist());
    expect(distFiles.length).toBeGreaterThan(0);

    for (const file of distFiles) {
      if (file.endsWith(".map")) continue;
      const source = readFileSync(file, "utf8");
      for (const banned of [
        "@trace-kit/renderers/svg",
        "exportToSvg",
        "@trace-kit/renderers/font",
        "data:font/woff2;base64",
        "TRACEKIT_INTER_EMBEDDED_FONT",
      ]) {
        expect(source, `${file} must not contain ${banned}`).not.toContain(banned);
      }
    }
  });

  it("preserves /*#__PURE__*/ annotation immediately preceding defineComponent( in source and built outputs", () => {
    const purePattern =
      /\/\*\s*[#@]__PURE__\s*\*\/\s*(?:\(0,\s*[A-Za-z0-9_$.]+\.defineComponent\)|(?:[A-Za-z0-9_$.]+\.)?defineComponent)\s*\(/;

    const srcFile = readFileSync(
      path.join(packageRoot, "src", "trace-spectrum-viewer.ts"),
      "utf8",
    );
    const esmFile = readFileSync(dist("index.js"), "utf8");
    const cjsFile = readFileSync(dist("index.cjs"), "utf8");

    expect(srcFile, "src/trace-spectrum-viewer.ts").toMatch(purePattern);
    expect(esmFile, "dist/index.js").toMatch(purePattern);
    expect(cjsFile, "dist/index.cjs").toMatch(purePattern);
  });

  it("emits SpectrumEngineHandle bindings in dist/trace-spectrum-viewer.d.ts for InstanceType inference", () => {
    const dtsFile = readFileSync(dist("trace-spectrum-viewer.d.ts"), "utf8");
    expect(dtsFile).toContain("SpectrumEngineHandle");
    expect(dtsFile).not.toMatch(/DefineComponent<[\s\S]*?\(\)\s*=>\s*import\("vue"\)\.VNode/);
  });

  it("maintains exact bidirectional set equality between packages/vue/SIDE-EFFECTS.md and src/**/*.ts (all none)", () => {
    const srcFiles = collectTsFiles(path.join(packageRoot, "src"));
    const auditMd = readFileSync(path.join(packageRoot, "SIDE-EFFECTS.md"), "utf8");

    const rows: Array<{ file: string; sideEffect: string }> = [];
    for (const line of auditMd.split("\n")) {
      const match = /^\|\s*`([^`]+\.ts)`\s*\|[^|]+\|\s*([^|]+?)\s*\|/.exec(line.trim());
      if (match !== null && match[1] !== undefined && match[2] !== undefined) {
        rows.push({ file: match[1], sideEffect: match[2] });
      }
    }

    const documentedFiles = rows.map((r) => r.file).sort();
    expect(documentedFiles).toEqual(srcFiles);
    for (const row of rows) {
      expect(row.sideEffect, `SIDE-EFFECTS.md row for ${row.file}`).toBe("none");
    }
  });

  it("contains zero { deep: true } watchers across packages/vue/src/**/*.ts", () => {
    const srcFiles = collectTsFiles(path.join(packageRoot, "src"));
    for (const rel of srcFiles) {
      const content = readFileSync(path.join(packageRoot, "src", rel), "utf8");
      expect(content, `src/${rel} must not use deep: true`).not.toMatch(/deep\s*:\s*true/);
    }
  });

  it("verifies strict tsconfig inheritance (zero baseUrl or allowImportingTsExtensions)", () => {
    const mainTsconfig = JSON.parse(
      readFileSync(path.join(packageRoot, "tsconfig.json"), "utf8"),
    ) as { extends?: string; compilerOptions?: Record<string, unknown> };
    expect(mainTsconfig.extends).toBe("../../tsconfig.base.json");
    expect(mainTsconfig.compilerOptions?.["lib"]).toEqual(["ES2022", "DOM"]);

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

  it("verifies vitest.config.ts declares 10 projects (8 pre-existing + vue & vue-dom)", () => {
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
    ]);
    expect(vitestConfigText).toContain('root: path.join(rootDir, "packages/vue")');
    expect(vitestConfigText).toContain('include: ["test/node/**/*.test.ts"]');
    expect(vitestConfigText).toContain('include: ["test/dom/**/*.test.ts"]');
  });

  it("keeps vue out of packages/core, packages/renderers, and apps/playground", () => {
    for (const relPkg of [
      "packages/core/package.json",
      "packages/renderers/package.json",
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
        expect(map?.["vue"], `${relPkg} must not depend on vue`).toBeUndefined();
      }
    }
  });

  it(
    "fires @typescript-eslint/no-explicit-any and no-restricted-syntax on packages/vue/src and packages/vue/test via ESLint Node API",
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

      // `packages/vue/src/**` runs under `parserOptions.projectService`, which honors `lintText`.
      const srcRelPath = "packages/vue/src/domain-sync.ts";
      const srcResults = await eslint.lintText(violatingCode, {
        filePath: path.join(repoRoot, srcRelPath),
      });
      const srcRuleIds = srcResults.flatMap((r) => r.messages.map((m) => m.ruleId));
      expect(srcRuleIds, `${srcRelPath} should flag no-explicit-any`).toContain(
        "@typescript-eslint/no-explicit-any",
      );
      expect(srcRuleIds, `${srcRelPath} should flag no-restricted-syntax`).toContain(
        "no-restricted-syntax",
      );

      // `packages/vue/test/**` runs under classic `parserOptions.project`; under `CI=true`
      // (`singleRun: true`), typescript-eslint builds its Program from disk, so mirror
      // `packages/core/test/lint-rules.test.ts` and lint a committed fixture with `lintFiles`.
      const testFixtureRelPath = "packages/vue/test/fixtures/lint-violation.ts";
      const testResults = await eslint.lintFiles([path.join(repoRoot, testFixtureRelPath)]);
      const testRuleIds = testResults.flatMap((r) => r.messages.map((m) => m.ruleId));
      expect(testRuleIds, `${testFixtureRelPath} should flag no-explicit-any`).toContain(
        "@typescript-eslint/no-explicit-any",
      );
      expect(testRuleIds, `${testFixtureRelPath} should flag no-restricted-syntax`).toContain(
        "no-restricted-syntax",
      );
    },
    LINT_TIMEOUT_MS,
  );
});
