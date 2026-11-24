/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const dist = (...parts: string[]) => path.join(packageRoot, "dist", ...parts);
const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, Record<string, string>>;
};

/** Every file a built entry can reach through relative imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.[^"']+)["']/g)) {
      queue.push(path.resolve(path.dirname(file), match[1] ?? ""));
    }
  }
  return [...seen];
}

const EXPECTED_RUNTIME_EXPORTS = [
  "DEFAULT_HYSTERESIS_CONFIG",
  "classifyHysteresisBand",
  "computePayloadSampleCount",
  "computeTracesSampleCount",
  "createSpectrumEngineController",
  "evaluateHysteresisTarget",
  "resolveHysteresisConfig",
];

const EXPECTED_PUBLIC_TYPES = [
  "EngineChangeEvent",
  "EngineChangeReason",
  "EngineKind",
  "EngineSelectionMode",
  "HysteresisBand",
  "HysteresisConfig",
  "HysteresisEvaluationInput",
  "HysteresisEvaluationResult",
  "ResizeObserverCallbackLike",
  "ResizeObserverEntryLike",
  "ResizeObserverLike",
  "ResolvedHysteresisConfig",
  "SpectrumEngineController",
  "SpectrumEngineControllerOptions",
  "ViewportDomain",
  "WebGL2FallbackEvent",
];

// Run after `pnpm --filter @trace-kit/renderers build`; `pnpm run test` builds first.
describe("the ./controller subpath", () => {
  it("is declared with types, import and require conditions", () => {
    expect(pkg.exports["./controller"]).toEqual({
      types: "./dist/controller/index.d.ts",
      import: "./dist/controller/index.js",
      require: "./dist/controller/index.cjs",
    });
  });

  it("builds ESM, CJS, declarations and declaration maps with all 16 public types", () => {
    for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.cts", "index.d.ts.map"]) {
      expect(existsSync(dist("controller", file)), file).toBe(true);
    }

    const dtsSource = readFileSync(dist("controller", "index.d.ts"), "utf8");
    for (const typeName of EXPECTED_PUBLIC_TYPES) {
      expect(dtsSource, `dist/controller/index.d.ts must export ${typeName}`).toMatch(
        new RegExp(`\\b${typeName}\\b`),
      );
    }
  });

  it("resolves under ESM and CJS in Node with no DOM globals and exposes exact 7 runtime keys", async () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    expect(typeof ResizeObserver).toBe("undefined");
    expect(typeof OffscreenCanvas).toBe("undefined");

    const esm = (await import("@trace-kit/renderers/controller")) as Record<string, unknown>;
    expect(Object.keys(esm).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
    expect(typeof esm["createSpectrumEngineController"]).toBe("function");

    const cjs = createRequire(import.meta.url)(
      "@trace-kit/renderers/controller",
    ) as Record<string, unknown>;
    expect(Object.keys(cjs).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
    expect(typeof cjs["createSpectrumEngineController"]).toBe("function");
  });

  it("keeps controller, WebGL2, and SVG exporter code out of the root entry", () => {
    for (const file of ["index.js", "index.cjs"]) {
      const source = readFileSync(dist(file), "utf8");
      for (const banned of [
        "createSpectrumEngineController",
        "WebGL2FigureRenderer",
        'getContext("webgl2"',
        "floatBitsToUint",
        "exportToSvg",
      ]) {
        expect(source, `${file}: ${banned}`).not.toContain(banned);
      }
    }
  });

  it("never reaches the SVG exporter or embedded font data URL", () => {
    for (const entry of ["index.js", "index.cjs"]) {
      const files = reachable(dist("controller", entry));
      expect(files.length, `reachable files for controller/${entry}`).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        for (const banned of [
          "exportToSvg",
          "svg/index",
          "data:font/woff2;base64",
          "TRACEKIT_INTER_EMBEDDED_FONT",
          "tracekit-inter.woff2",
          "base64,",
        ]) {
          expect(source, `${file}: ${banned}`).not.toContain(banned);
        }
      }
    }
  });

  it("is listed in SIDE-EFFECTS.md, file by file, with a no-side-effect statement", () => {
    const note = readFileSync(path.join(packageRoot, "SIDE-EFFECTS.md"), "utf8");
    const controllerFiles = readdirSync(path.join(packageRoot, "src", "controller")).filter((f) =>
      f.endsWith(".ts"),
    );
    expect(controllerFiles.sort()).toEqual([
      "engine-controller.ts",
      "hysteresis.ts",
      "index.ts",
      "types.ts",
    ]);
    for (const file of controllerFiles) {
      const pattern = new RegExp(`controller/${file.replace(".", "\\.")}.*\\|\\s*none\\s*\\|`);
      expect(note, `SIDE-EFFECTS.md must document controller/${file} with side effect none`).toMatch(
        pattern,
      );
    }
  });
});
