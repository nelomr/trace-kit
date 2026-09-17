import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  DecimationSelection,
  SpectrumDataPayload,
  ViewportTransform,
} from "@trace-kit/core";
import { createViewportTransform } from "@trace-kit/core";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";

/**
 * A minimal, real `FigureRenderer` implementation that is not Canvas2D — WebGL2 does not exist
 * yet, so this stands in for "a second backend" purely to prove `ScenarioFixture` carries no
 * Canvas2D-specific assumption. It records every call it receives instead of drawing anything.
 */
class RecordingStandInRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind = "webgl2";
  disposed = false;
  transform: ViewportTransform = createViewportTransform({
    cssWidth: 1,
    cssHeight: 1,
    dpr: 1,
    insetLeft: 0,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
    xDomainMin: 0,
    xDomainMax: 1,
    yDomainMin: 0,
    yDomainMax: 1,
    xOrigin: 0,
  });
  readonly calls: string[] = [];

  setData(payload: SpectrumDataPayload): void {
    void payload;
    this.calls.push("setData");
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    void xMin;
    void xMax;
    void yMin;
    void yMax;
    this.calls.push("setDomain");
  }

  resize(width: number, height: number, dpr: number): void {
    void width;
    void height;
    void dpr;
    this.calls.push("resize");
  }

  render(): void {
    this.calls.push("render");
  }

  clear(): void {
    this.calls.push("clear");
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    void selection;
    this.calls.push("setDecimation");
  }

  dispose(): void {
    this.disposed = true;
  }
}

const EXPECTED_DESCRIPTIONS = [
  "simple trace",
  "axes with grid",
  "resonance peak",
  "noise floor",
  "decimation case",
];

describe("scenario fixtures", () => {
  it("contains exactly five entries with the P4-agreed descriptions", () => {
    expect(SCENARIO_FIXTURES.length).toBe(5);
    expect(SCENARIO_FIXTURES.map((f) => f.description)).toEqual(EXPECTED_DESCRIPTIONS);
  });

  it("no field on the fixture type names a renderer backend", () => {
    const forbidden = ["canvas2d", "webgl2", "backend"];
    for (const fixture of SCENARIO_FIXTURES) {
      const keys = Object.keys(fixture);
      for (const key of keys) {
        for (const word of forbidden) {
          expect(key.toLowerCase()).not.toContain(word);
        }
      }
    }
  });

  it("dpr is a plain numeric field on every fixture", () => {
    for (const fixture of SCENARIO_FIXTURES) {
      expect(typeof fixture.dpr).toBe("number");
      expect(fixture.dpr).toBeGreaterThan(0);
    }
  });

  it("is importable via the stable package-relative fixtures subpath", () => {
    // The import at the top of this file already exercises `@trace-kit/renderers/fixtures`
    // rather than a `../../../renderers/...` relative path — this assertion just confirms the
    // module actually resolved to something usable, not an empty/undefined shim.
    expect(Array.isArray(SCENARIO_FIXTURES)).toBe(true);
  });

  it("every fixture id is unique", () => {
    const ids = SCENARIO_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

interface FakeContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(path?: unknown): void;
  fillText(text: string, x: number, y: number): void;
}

/** Matches `test/node/axes-grid.test.ts`'s own fake-canvas pattern: this project runs under
 * `environment: "node"`, which has no `OffscreenCanvas`/`HTMLCanvasElement`. */
function makeFakeSurface(): HTMLCanvasElement {
  const context: FakeContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform(): void {},
    fillRect(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    fillText(): void {},
  };
  const canvas = { getContext: () => context };
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  return canvas as unknown as HTMLCanvasElement;
}

describe("scenario fixture drives a real renderer", () => {
  // `canvas2d-renderer.ts` constructs a real `Path2D` when a payload is present; Node has no
  // such global. Matches `test/node/axes-grid.test.ts`'s own polyfill exactly.
  let originalPath2D: unknown;
  beforeEach(() => {
    originalPath2D = (globalThis as Record<string, unknown>)["Path2D"];
    (globalThis as Record<string, unknown>)["Path2D"] = class {
      moveTo(): void {}
      lineTo(): void {}
    };
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>)["Path2D"] = originalPath2D;
  });

  it.each(SCENARIO_FIXTURES)(
    "$description drives Canvas2DRenderer via setData/setDomain/resize with no field renamed or omitted",
    (fixture: ScenarioFixture) => {
      const surface = makeFakeSurface();
      const renderer = new Canvas2DRenderer({ surface });
      renderer.setData(fixture.payload);
      renderer.setDomain(
        fixture.domain.xMin,
        fixture.domain.xMax,
        fixture.domain.yMin,
        fixture.domain.yMax,
      );
      renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
      expect(() => renderer.render()).not.toThrow();
      renderer.dispose();
    },
  );

  it("the same fixture record drives a real Canvas2D renderer and a stand-in second-backend renderer, with no field renamed or omitted", () => {
    const fixture = SCENARIO_FIXTURES[0];
    if (fixture === undefined) throw new Error("no fixtures");

    const canvas2d = new Canvas2DRenderer({ surface: makeFakeSurface() });
    canvas2d.setData(fixture.payload);
    canvas2d.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
    canvas2d.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
    canvas2d.render();
    canvas2d.dispose();

    const standIn = new RecordingStandInRenderer();
    standIn.setData(fixture.payload);
    standIn.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
    standIn.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
    standIn.render();
    standIn.dispose();

    expect(standIn.calls).toEqual(["setData", "setDomain", "resize", "render"]);
    expect(standIn.disposed).toBe(true);
  });
});
