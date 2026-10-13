/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as root from "../../src/index.js";
import * as webgl2 from "../../src/webgl2/index.js";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("renderers export surface", () => {
  it("keeps every WebGL2 symbol out of the root entry", () => {
    expect(Object.keys(root).filter((name) => /webgl2/i.test(name))).toEqual([]);
    const rootSource = source("../../src/index.ts");
    expect(rootSource).not.toMatch(/from\s+["']\.\/webgl2\//);
  });

  it("exports exactly the renderer, its options and its surfaces from ./webgl2", () => {
    expect(Object.keys(webgl2)).toEqual(["WebGL2FigureRenderer"]);
    const entry = source("../../src/webgl2/index.ts");
    const typeExports = [...entry.matchAll(/export type \{([^}]+)\}/g)].flatMap((m) =>
      (m[1] ?? "").split(",").map((name) => name.trim()),
    );
    expect(typeExports.sort()).toEqual(["WebGL2FigureRendererOptions", "WebGL2FigureSurfaces"]);
    expect(entry).not.toContain("CompositeDrawingContext");
  });
});
