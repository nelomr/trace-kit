/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acquireOverlayContext,
  acquireWebGl2Context,
  GL_CONTEXT_ATTRIBUTES,
  type WebGL2FigureSurfaces,
} from "../../src/webgl2/surfaces.js";
import { asSurface, FakeSurface } from "./support/fake-surface.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";
import { RecordingOverlayContext } from "./support/recording-overlay-context.js";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/webgl2");
const surfacesSource = readFileSync(path.join(srcDir, "surfaces.ts"), "utf8");

describe("acquireOverlayContext", () => {
  it("requests a transparent 2D context and returns it", () => {
    const context = new RecordingOverlayContext([]);
    const surface = new FakeSurface(context);
    const acquired = acquireOverlayContext(asSurface(surface));

    expect(acquired).toBe(context);
    expect(surface.getContextCalls).toEqual([{ id: "2d", attributes: { alpha: true } }]);
  });

  it("throws a TypeError naming 2d and overlay when no context is available", () => {
    const surface = new FakeSurface<RecordingOverlayContext>(null);
    expect(() => acquireOverlayContext(asSurface(surface))).toThrow(TypeError);
    expect(() => acquireOverlayContext(asSurface(surface))).toThrow(/2d/);
    expect(() => acquireOverlayContext(asSurface(surface))).toThrow(/overlay/);
  });
});

describe("acquireWebGl2Context", () => {
  it("requests webgl2 with the frozen attribute set", () => {
    const gl = new RecordingGl2Context();
    const surface = new FakeSurface(gl);
    expect(acquireWebGl2Context(asSurface(surface))).toBe(gl);

    expect(surface.getContextCalls).toHaveLength(1);
    expect(surface.getContextCalls[0]?.id).toBe("webgl2");
    expect(surface.getContextCalls[0]?.attributes).toEqual({
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "default",
      failIfMajorPerformanceCaveat: false,
      desynchronized: false,
    });
    expect(Object.isFrozen(GL_CONTEXT_ATTRIBUTES)).toBe(true);
  });

  it("throws a TypeError naming webgl2 and plot when the context is unavailable", () => {
    const surface = new FakeSurface<RecordingGl2Context>(null);
    expect(() => acquireWebGl2Context(asSurface(surface))).toThrow(TypeError);
    expect(() => acquireWebGl2Context(asSurface(surface))).toThrow(/webgl2/);
    expect(() => acquireWebGl2Context(asSurface(surface))).toThrow(/plot/);
  });
});

describe("WebGL2FigureSurfaces", () => {
  it("has three readonly surface fields", () => {
    const surface = asSurface(new FakeSurface(null));
    const surfaces = { underlay: surface, plot: surface, overlay: surface } satisfies WebGL2FigureSurfaces;
    expect(Object.keys(surfaces).sort()).toEqual(["overlay", "plot", "underlay"]);
  });
});

describe("surfaces source", () => {
  it("narrows the surface union without an assertion, `any` or a double cast", () => {
    expect(surfacesSource).toContain("instanceof OffscreenCanvas");
    expect(surfacesSource).toContain('typeof OffscreenCanvas !== "undefined"');
    expect(surfacesSource).not.toMatch(/\bas\s+(unknown|any|never|HTMLCanvasElement|OffscreenCanvas)\b/);
    expect(surfacesSource).not.toMatch(/: any\b|<any>|, any>/);
  });

  it("leaves surface.ts and the shared drawing-context types unchanged", () => {
    const surface = readFileSync(path.join(srcDir, "../surface.ts"), "utf8");
    expect(surface).not.toContain("clearRect");
    expect(surface).not.toContain("webgl2");
    const recording = readFileSync(path.join(srcDir, "../../test/node/support/recording-context.ts"), "utf8");
    expect(recording).not.toContain("clearRect");
  });

  it("creates no DOM and no canvas anywhere in src/webgl2", () => {
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(srcDir, file), "utf8");
      for (const banned of ["createElement", "appendChild", "new OffscreenCanvas"]) {
        expect(source, `${file}: ${banned}`).not.toContain(banned);
      }
      expect(source, `${file}: style.`).not.toMatch(/\.style\./);
    }
  });
});
