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

// Run after `pnpm --filter @trace-kit/renderers build`; `pnpm run test` builds first.
describe("the ./webgl2 subpath", () => {
  it("is declared with types, import and require conditions", () => {
    expect(pkg.exports["./webgl2"]).toEqual({
      types: "./dist/webgl2/index.d.ts",
      import: "./dist/webgl2/index.js",
      require: "./dist/webgl2/index.cjs",
    });
  });

  it("builds ESM, CJS, declarations and declaration maps", () => {
    for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.cts", "index.d.ts.map"]) {
      expect(existsSync(dist("webgl2", file)), file).toBe(true);
    }
  });

  it("resolves under ESM and CJS without touching a DOM global", async () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    const esm = (await import("@trace-kit/renderers/webgl2")) as Record<string, unknown>;
    expect(typeof esm["WebGL2FigureRenderer"]).toBe("function");
    const cjs = createRequire(import.meta.url)("@trace-kit/renderers/webgl2") as Record<string, unknown>;
    expect(typeof cjs["WebGL2FigureRenderer"]).toBe("function");
    expect(Object.keys(esm).sort()).toEqual(["WebGL2FigureRenderer"]);
  });

  it("keeps shader and GL code out of the root entry", () => {
    for (const file of ["index.js", "index.cjs"]) {
      const source = readFileSync(dist(file), "utf8");
      for (const banned of ["WebGL2FigureRenderer", 'getContext("webgl2"', "floatBitsToUint"]) {
        expect(source, `${file}: ${banned}`).not.toContain(banned);
      }
    }
  });

  it("never reaches the embedded font data or the SVG exporter", () => {
    for (const entry of ["index.js", "index.cjs"]) {
      for (const file of reachable(dist("webgl2", entry))) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toContain("tracekit-inter.woff2");
        expect(source, file).not.toContain("exportToSvg");
        expect(source, file).not.toContain("base64,");
      }
    }
  });

  it("is listed in the audit note, file by file", () => {
    const note = readFileSync(path.join(packageRoot, "SIDE-EFFECTS.md"), "utf8");
    for (const file of readdirSync(path.join(packageRoot, "src", "webgl2"))) {
      expect(note, `webgl2/${file}`).toContain(`webgl2/${file}`);
    }
    expect(note).toContain("layout/trace-transforms.ts");
  });

  it("leaves packages/core free of GL context code", () => {
    const root = path.join(packageRoot, "../core/src");
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".ts")) continue;
      expect(readFileSync(path.join(root, entry), "utf8"), entry).not.toMatch(/getContext|WebGL2?RenderingContext/);
    }
  });
});
