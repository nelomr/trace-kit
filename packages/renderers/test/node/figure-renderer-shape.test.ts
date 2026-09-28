import { describe, expect, it } from "vitest";
import type {
  DecimationSelection,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";

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
