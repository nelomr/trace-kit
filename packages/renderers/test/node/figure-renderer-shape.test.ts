import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  DecimationSelection,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { WebGL2FigureRenderer } from "../../src/webgl2/webgl2-figure-renderer.js";
import { createHarness } from "./support/webgl2-harness.js";

// The member set of `FigureRenderer` is the whole surface an interaction layer (a crosshair,
// a WebGL2 backend, an exporter) is allowed to depend on. A fixture class that must implement
// exactly this set — no extra, no interaction-shaped member — is a compile-time proof the
// interface hasn't grown a member that widens this dependency surface unintentionally. The set
// is now eleven members: the multi-trace widening's `setTraces` joins the original ten.
class FixtureFigureRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind = "canvas2d";
  readonly disposed: boolean = false;
  readonly transform = {} as ViewportTransform;
  setData(payload: SpectrumDataPayload): void {
    void payload;
  }
  setTraces(collection: TraceCollection): void {
    void collection;
  }
  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    void xMin;
    void xMax;
    void yMin;
    void yMax;
  }
  resize(width: number, height: number, dpr: number): void {
    void width;
    void height;
    void dpr;
  }
  render(): void {}
  clear(): void {}
  dispose(): void {}
  setDecimation(selection: DecimationSelection | undefined): void {
    void selection;
  }
}

// Fixture for a fabricated WebGL2-shaped context, proving the ten-member set and
// `setDecimation`'s parameter type are unchanged across backends — no Canvas2D-specific,
// WebGL2-specific, or backend-local type is substituted into it.
interface FakeWebGL2Context {
  readonly drawArrays: (mode: number, first: number, count: number) => void;
}
class FixtureWebGL2FigureRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind = "webgl2";
  readonly disposed: boolean = false;
  readonly transform = {} as ViewportTransform;
  constructor(private readonly context: FakeWebGL2Context) {
    void this.context;
  }
  setData(payload: SpectrumDataPayload): void {
    void payload;
  }
  setTraces(collection: TraceCollection): void {
    void collection;
  }
  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    void xMin;
    void xMax;
    void yMin;
    void yMax;
  }
  resize(width: number, height: number, dpr: number): void {
    void width;
    void height;
    void dpr;
  }
  render(): void {}
  clear(): void {}
  dispose(): void {}
  setDecimation(selection: DecimationSelection | undefined): void {
    void selection;
  }
}

describe("FigureRenderer — member shape", () => {
  it("compiles with exactly the contracted eleven-member set", () => {
    const instance = new FixtureFigureRenderer();
    expect(instance.kind).toBe("canvas2d");
  });

  it("a fabricated WebGL2-shaped backend satisfies the same eleven-member set", () => {
    const instance = new FixtureWebGL2FigureRenderer({ drawArrays: () => {} });
    expect(instance.kind).toBe("webgl2");
  });
});

const ELEVEN = ["disposed", "transform", "setData", "setTraces", "setDomain", "resize", "render", "clear", "dispose", "setDecimation"];

function publicMembers(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter((name) => name !== "constructor" && !name.startsWith("#"));
}

describe("FigureRenderer - real backends", () => {
  it("both Canvas2DRenderer and WebGL2FigureRenderer expose exactly the eleven members", () => {
    for (const ctor of [Canvas2DRenderer, WebGL2FigureRenderer]) {
      expect(publicMembers(ctor.prototype).sort()).toEqual([...ELEVEN].sort());
    }
  });

  it("a WebGL2FigureRenderer is assignable to FigureRenderer and reports kind webgl2", () => {
    const renderer: FigureRenderer = createHarness().renderer;
    expect(renderer.kind).toBe("webgl2");
  });

  it("FigureRenderer names the backend's default and no longer pins LTTB", () => {
    const source = readFileSync(new URL("../../src/figure-renderer.ts", import.meta.url), "utf8");
    expect(source).toContain("the backend's default");
    expect(source).not.toContain("LTTB at the viewport-derived threshold");
    expect(source).not.toContain("WebGL2FigureSurfaces");
  });

  it("constructs each backend without an unsafe cast", () => {
    for (const file of ["../../src/canvas2d/canvas2d-renderer.ts", "../../src/webgl2/webgl2-figure-renderer.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/as unknown as|as any\b|as never\b/);
    }
  });

  it("takes three surfaces where Canvas2D takes one, with every other option unchanged", () => {
    const source = readFileSync(new URL("../../src/webgl2/webgl2-figure-renderer.ts", import.meta.url), "utf8");
    const options = source.slice(source.indexOf("export interface WebGL2FigureRendererOptions"));
    const block = options.slice(0, options.indexOf("\n}\n"));
    expect(block).toContain("readonly surfaces: WebGL2FigureSurfaces;");
    for (const field of ["style?", "axes?", "decimation?", "yAxes?"]) expect(block).toContain(`readonly ${field}`);
    expect(block).not.toContain("readonly surface:");
  });
});
