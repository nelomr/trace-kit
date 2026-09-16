/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import type { TraceDrawingContext } from "../../src/surface.js";

// happy-dom's `HTMLCanvasElement.getContext` returns `null` with no backend installed
// (null-context.test.ts). Stubbing it here is the DOM-side equivalent of the fake surface used
// in test/node/lifecycle.test.ts — this test exercises real `width`/`height` attribute
// semantics, not context drawing, so a minimal stub context is enough.
function stubGetContext(canvas: HTMLCanvasElement): void {
  const context: TraceDrawingContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    font: "",
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
  // Test double: happy-dom's real getContext return type is far wider than this narrow
  // `TraceDrawingContext`; this is a genuine external boundary, not a production suppression.
  // eslint-disable-next-line no-restricted-syntax
  canvas.getContext = (() => context) as unknown as HTMLCanvasElement["getContext"];
}

describe("Canvas2DRenderer resize (real HTMLCanvasElement)", () => {
  it("writes integer width/height attributes honoring round(cssDimension * dpr)", () => {
    const canvas = document.createElement("canvas");
    stubGetContext(canvas);
    const renderer = new Canvas2DRenderer({ surface: canvas });

    renderer.resize(801, 599, 1.5);

    expect(canvas.width).toBe(Math.round(801 * 1.5));
    expect(canvas.height).toBe(Math.round(599 * 1.5));
    expect(Number.isInteger(canvas.width)).toBe(true);
    expect(Number.isInteger(canvas.height)).toBe(true);
  });
});
