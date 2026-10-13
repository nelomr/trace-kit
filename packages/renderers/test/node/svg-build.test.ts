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
  sideEffects: boolean;
  dependencies: Record<string, string>;
};

/** Every file a built entry can reach through relative imports, so a shared chunk cannot smuggle
 * the embedded font into the exporter unnoticed. */
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
describe("the ./svg subpath", () => {
  it("is declared with types, import and require conditions", () => {
    expect(pkg.exports["./svg"]).toEqual({
      types: "./dist/svg/index.d.ts",
      import: "./dist/svg/index.js",
      require: "./dist/svg/index.cjs",
    });
    expect(pkg.sideEffects).toBe(false);
    expect(Object.keys(pkg.dependencies)).toEqual(["@trace-kit/core"]);
  });

  it("builds ESM, CJS, declarations and declaration maps", () => {
    for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.cts", "index.d.ts.map"]) {
      expect(existsSync(dist("svg", file)), file).toBe(true);
    }
  });

  it("resolves under ESM and CJS and exposes exportToSvg", async () => {
    const esm = (await import("@trace-kit/renderers/svg")) as Record<string, unknown>;
    expect(typeof esm["exportToSvg"]).toBe("function");
    const cjs = createRequire(import.meta.url)("@trace-kit/renderers/svg") as Record<string, unknown>;
    expect(typeof cjs["exportToSvg"]).toBe("function");
    expect(esm["SVG_COORDINATE_DECIMALS"]).toBe(2);
  });

  it("keeps the exporter out of the root entry", () => {
    for (const file of ["index.js", "index.cjs"]) {
      const source = readFileSync(dist(file), "utf8");
      expect(source, file).not.toContain("exportToSvg");
    }
  });

  it("never reaches the embedded font data and does not import the font entry", () => {
    for (const entry of ["index.js", "index.cjs"]) {
      for (const file of reachable(dist("svg", entry))) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toContain("tracekit-inter.woff2");
        expect(source, file).not.toContain("base64,");
        expect(path.relative(dist(), file).startsWith("font"), file).toBe(false);
      }
    }
  });

  it("is listed with a no-side-effect statement in the audit note", () => {
    const note = readFileSync(path.join(packageRoot, "SIDE-EFFECTS.md"), "utf8");
    for (const folder of ["svg", "layout", "rules"]) {
      for (const file of readdirSync(path.join(packageRoot, "src", folder))) {
        expect(note, `${folder}/${file}`).toContain(`${folder}/${file}`);
      }
    }
    expect(note.toLowerCase()).toContain("no top-level side effect");
  });
});
