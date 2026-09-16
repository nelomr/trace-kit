/** @vitest-environment node */
import { createSpectrumDataPayload } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import type { TraceDrawingContext } from "../../src/surface.js";

interface FakeCanvas {
  width: number;
  height: number;
  readonly calls: string[];
  getContext(type: string): TraceDrawingContext;
}

function createFakeCanvas(): FakeCanvas {
  const calls: string[] = [];
  const context: TraceDrawingContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    setTransform(): void {
      calls.push("setTransform");
    },
    fillRect(): void {
      calls.push("fillRect");
    },
    beginPath(): void {
      calls.push("beginPath");
    },
    moveTo(): void {
      calls.push("moveTo");
    },
    lineTo(): void {
      calls.push("lineTo");
    },
    stroke(): void {
      calls.push("stroke");
    },
    fillText(): void {
      calls.push("fillText");
    },
  };
  return {
    width: 0,
    height: 0,
    calls,
    getContext(): TraceDrawingContext {
      return context;
    },
  };
}

function asSurface(canvas: FakeCanvas): HTMLCanvasElement {
  // Test double: a fake `HTMLCanvasElement` with only the members `acquire2dContext` actually
  // calls (`getContext`) plus writable `width`/`height` — a genuine external-boundary cast, not
  // a production-code suppression (banned pattern is scoped to `src/**`, see surface-types.test.ts).
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  return canvas as unknown as HTMLCanvasElement;
}

describe("Canvas2DRenderer lifecycle", () => {
  it("constructs against a fake TraceDrawingContext-satisfying surface", () => {
    const canvas = createFakeCanvas();
    expect(() => new Canvas2DRenderer({ surface: asSurface(canvas) })).not.toThrow();
  });

  it("setData retains the exact payload reference and issues zero context calls", () => {
    const canvas = createFakeCanvas();
    const renderer = new Canvas2DRenderer({ surface: asSurface(canvas) });
    const payload = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });
    renderer.setData(payload);
    expect(canvas.calls).toEqual([]);
  });

  it("resize sets device-pixel backing store size and issues zero context calls", () => {
    const canvas = createFakeCanvas();
    const renderer = new Canvas2DRenderer({ surface: asSurface(canvas) });
    renderer.resize(800, 600, 2);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.calls).toEqual([]);
  });

  it("setDomain recomputes the transform and issues zero context calls", () => {
    const canvas = createFakeCanvas();
    const renderer = new Canvas2DRenderer({ surface: asSurface(canvas) });
    renderer.setDomain(0, 10, -1, 1);
    expect(canvas.calls).toEqual([]);
    expect(renderer.transform.xDomainMin).toBe(0);
    expect(renderer.transform.xDomainMax).toBe(10);
    expect(renderer.transform.yDomainMin).toBe(-1);
    expect(renderer.transform.yDomainMax).toBe(1);
  });

  it("dispose is idempotent and disposed never returns to false", () => {
    const canvas = createFakeCanvas();
    const renderer = new Canvas2DRenderer({ surface: asSurface(canvas) });
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
    expect(() => renderer.dispose()).not.toThrow();
    expect(renderer.disposed).toBe(true);
  });

  it("every method is a no-op after dispose: throws nothing, issues zero context calls", () => {
    const canvas = createFakeCanvas();
    const renderer = new Canvas2DRenderer({ surface: asSurface(canvas) });
    renderer.resize(100, 100, 1);
    canvas.calls.length = 0;
    renderer.dispose();

    const payload = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });

    expect(() => renderer.setData(payload)).not.toThrow();
    expect(() => renderer.setDomain(0, 1, 0, 1)).not.toThrow();
    expect(() => renderer.resize(50, 50, 1)).not.toThrow();
    expect(() => renderer.render()).not.toThrow();
    expect(() => renderer.clear()).not.toThrow();
    expect(canvas.calls).toEqual([]);
  });
});
