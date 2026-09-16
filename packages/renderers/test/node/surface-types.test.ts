import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Canvas2DSurface, SurfaceKind, TraceDrawingContext } from "../../src/surface.js";
import { acquire2dContext } from "../../src/surface.js";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";

// `Canvas2DSurface` must accept both a real DOM canvas element and an `OffscreenCanvas`
// without a cast — a compile-time fixture is the only honest way to test a type union's
// membership; a runtime check could not tell "accepts HTMLCanvasElement" from "widened to
// unknown". These fixtures below never run, they only need to type-check.
function typeLevelFixture(): void {
  const htmlLike = {} as HTMLCanvasElement;
  const offscreenLike = {} as OffscreenCanvas;
  const s1: Canvas2DSurface = htmlLike;
  const s2: Canvas2DSurface = offscreenLike;
  const kind: SurfaceKind = "element";
  const ctxShape: TraceDrawingContext = {
    fillStyle: "black",
    strokeStyle: "black",
    lineWidth: 1,
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    setTransform(): void {},
    fillRect(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    fillText(): void {},
  };
  void s1;
  void s2;
  void kind;
  void ctxShape;
  void acquire2dContext;

  // task 7.16: `Canvas2DRenderer`'s constructor accepts an `OffscreenCanvas`-typed surface
  // without a cast — this never runs, it only needs to type-check under `tsc --noEmit`.
  function fixtureWithOffscreenSurface(): void {
    void new Canvas2DRenderer({ surface: offscreenLike });
  }
  void fixtureWithOffscreenSurface;
}
void typeLevelFixture;

describe("surface.ts source constraints", () => {
  it("contains no unsafe-cast escape hatches", () => {
    const filePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/surface.ts",
    );
    const source = readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/as any\b/);
    expect(source).not.toMatch(/<any>/);
    expect(source).not.toMatch(/,\s*any>/);
    expect(source).not.toMatch(/as never\b/);
    expect(source).not.toMatch(/as unknown as/);
  });
});

describe("Canvas2DRenderer source constraints", () => {
  it("never assigns surface.style — restyling the DOM element is an adapter concern", () => {
    const filePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/canvas2d/canvas2d-renderer.ts",
    );
    const source = readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/\.style\s*=/);
  });
});
