import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { WebGL2FigureRenderer } from "../../src/webgl2/webgl2-figure-renderer.js";
import { createFigureStack, type FigureStack } from "./support/figure-stack.js";

// Pixel reads from a real WebGL2 context, not goldens and not fakes: each case renders a small
// purpose-built figure and inspects the composited or per-layer pixels directly.

const WIDTH = 400;
const HEIGHT = 300;

interface Figure {
  readonly stack: FigureStack;
  readonly renderer: WebGL2FigureRenderer;
  /** Renders and returns the plot layer's RGBA as the browser holds it (straight alpha). */
  renderPlot(): ImageData;
  /** Renders and returns the three layers composed, as a viewer would see them. */
  renderComposite(): ImageData;
  dispose(): void;
}

function payloadOf(values: readonly number[], x?: (i: number) => number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: values.length, xOrigin: 0, xUnit: "", yUnit: "" });
  values.forEach((v, i) => {
    payload.x[i] = x === undefined ? i : x(i);
    payload.y[i] = v;
  });
  commitPayloadRevision(payload, values.length);
  return payload;
}

function open(
  payload: SpectrumDataPayload,
  domain: readonly [number, number, number, number],
  logY = false,
  lineWidthCss?: number,
): Figure {
  const stack = createFigureStack(WIDTH, HEIGHT);
  const renderer = new WebGL2FigureRenderer({
    surfaces: { underlay: stack.underlay, plot: stack.plot, overlay: stack.overlay },
    ...(lineWidthCss === undefined ? {} : { style: { lineWidthCss } }),
    ...(logY
      ? { yAxes: [{ id: "y", scaleKind: Y_SCALE_KIND_LOG, domainMin: domain[2], domainMax: domain[3], side: AXIS_SIDE_LEFT }] }
      : {}),
  });
  renderer.setData(payload);
  renderer.setDomain(...domain);
  renderer.resize(WIDTH, HEIGHT, 1);

  const read = (layers: readonly HTMLCanvasElement[]): ImageData => {
    const scratch = document.createElement("canvas");
    scratch.width = stack.plot.width;
    scratch.height = stack.plot.height;
    const context = scratch.getContext("2d");
    if (context === null) throw new Error("no scratch context");
    renderer.render();
    for (const layer of layers) context.drawImage(layer, 0, 0);
    return context.getImageData(0, 0, scratch.width, scratch.height);
  };
  return {
    stack,
    renderer,
    renderPlot: () => read([stack.plot]),
    renderComposite: () => read([stack.underlay, stack.plot, stack.overlay]),
    dispose: () => {
      renderer.dispose();
      stack.remove();
    },
  };
}

function alphaAt(image: ImageData, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

function columnHasInk(image: ImageData, x: number, top: number, bottom: number): boolean {
  for (let y = top; y <= bottom; y += 1) if (alphaAt(image, x, y) > 0) return true;
  return false;
}

const ramp = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

describe("WebGL2 behaviour probes", () => {
  it("anti-aliases a diagonal: some border pixel has alpha strictly between 0 and full", async () => {
    await ensureDefaultFont();
    const figure = open(payloadOf([0, 1]), [0, 1, 0, 1]);
    try {
      const plot = figure.renderPlot();
      let partial = false;
      for (let i = 3; i < plot.data.length; i += 4) {
        const a = plot.data[i] ?? 0;
        if (a > 0 && a < 255) partial = true;
      }
      expect(partial).toBe(true);
    } finally {
      figure.dispose();
    }
  });

  it("leaves a NaN run blank, away from the stroke's own width", () => {
    const values = ramp(100, (i) => (i >= 40 && i <= 60 ? NaN : Math.sin(i / 8)));
    const figure = open(payloadOf(values), [0, 99, -1.5, 1.5]);
    try {
      const plot = figure.renderPlot();
      const t = figure.renderer.transform;
      const top = Math.round(t.plotTop);
      const bottom = Math.round(t.plotTop + t.plotHeight) - 1;
      const toColumn = (i: number): number => Math.round(t.plotLeft + (i / 99) * t.plotWidth);
      for (let x = toColumn(40) + 4; x <= toColumn(60) - 4; x += 1) {
        expect(columnHasInk(plot, x, top, bottom), `column ${x}`).toBe(false);
      }
      expect(columnHasInk(plot, toColumn(20), top, bottom)).toBe(true);
    } finally {
      figure.dispose();
    }
  });

  it("clamps +-Infinity through the guard band so the stroke reaches the plot edge", () => {
    const values = ramp(50, (i) => (i === 25 ? Infinity : 0));
    const figure = open(payloadOf(values), [0, 49, -1, 1]);
    try {
      const plot = figure.renderPlot();
      const t = figure.renderer.transform;
      const topRow = Math.ceil(t.plotTop) + 1;
      const columns = Array.from({ length: Math.round(t.plotWidth) }, (_, i) => Math.round(t.plotLeft) + i);
      expect(columns.some((x) => alphaAt(plot, x, topRow) > 0)).toBe(true);
    } finally {
      figure.dispose();
    }
  });

  it("drops non-positive samples on a log axis", () => {
    const values = ramp(60, (i) => (i === 30 ? 0 : i === 31 ? -5 : 10 + i));
    const figure = open(payloadOf(values), [0, 59, 1, 1000], true);
    try {
      const plot = figure.renderPlot();
      const t = figure.renderer.transform;
      const top = Math.round(t.plotTop);
      const bottom = Math.round(t.plotTop + t.plotHeight) - 1;
      const toColumn = (i: number): number => Math.round(t.plotLeft + (i / 59) * t.plotWidth);
      for (let x = toColumn(29) + 5; x <= toColumn(32) - 5; x += 1) {
        expect(columnHasInk(plot, x, top, bottom), `column ${x}`).toBe(false);
      }
      expect(columnHasInk(plot, toColumn(10), top, bottom)).toBe(true);
    } finally {
      figure.dispose();
    }
  });

  it("draws nothing outside the plot rectangle on the plot layer", () => {
    const values = ramp(50, (i) => (i % 2 === 0 ? Infinity : -Infinity));
    const figure = open(payloadOf(values), [0, 49, -1, 1]);
    try {
      const plot = figure.renderPlot();
      const t = figure.renderer.transform;
      const left = Math.floor(t.plotLeft);
      const bottom = Math.ceil(t.plotTop + t.plotHeight);
      for (let y = 0; y < plot.height; y += 1) {
        for (let x = 0; x < plot.width; x += 1) {
          const inside = x >= left && y < bottom;
          if (!inside) expect(alphaAt(plot, x, y), `(${x}, ${y})`).toBe(0);
        }
      }
    } finally {
      figure.dispose();
    }
  });

  it("shows the grid through the transparent plot layer", () => {
    const figure = open(payloadOf([5, 5]), [0, 1, 0, 100]);
    try {
      const plot = figure.renderPlot();
      const composite = figure.renderComposite();
      const t = figure.renderer.transform;
      // Where the plot layer is transparent the composite must still carry the underlay's grid:
      // some pixel there is visibly brighter than the background.
      const bg = [0x0b, 0x0f, 0x14];
      let found = false;
      const x0 = Math.round(t.plotLeft) + 1;
      const x1 = Math.round(t.plotLeft + t.plotWidth);
      const y0 = Math.round(t.plotTop);
      const y1 = Math.round(t.plotTop + t.plotHeight);
      for (let y = y0; y < y1 && !found; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          if (alphaAt(plot, x, y) !== 0) continue;
          const i = (y * composite.width + x) * 4;
          if (Math.max(...[0, 1, 2].map((c) => Math.abs((composite.data[i + c] ?? 0) - (bg[c] ?? 0)))) >= 10) {
            found = true;
            break;
          }
        }
      }
      expect(found).toBe(true);
    } finally {
      figure.dispose();
    }
  });

  it("paints the grid under the trace: a trace on a gridline shows the trace colour", () => {
    // y = 50 over a [0, 100] domain sits on a major gridline.
    const figure = open(payloadOf([50, 50, 50, 50]), [0, 3, 0, 100], false, 6);
    try {
      const composite = figure.renderComposite();
      const t = figure.renderer.transform;
      const x = Math.round(t.plotLeft + t.plotWidth / 2);
      const y = Math.round(t.yBase - 50 * t.yScale);
      const i = (y * composite.width + x) * 4;
      const trace = DEFAULT_FIGURE_STYLE.traceColor;
      const expected = [1, 3, 5].map((k) => Number.parseInt(trace.slice(k, k + 2), 16));
      for (let c = 0; c < 3; c += 1) {
        expect(Math.abs((composite.data[i + c] ?? 0) - (expected[c] ?? 0))).toBeLessThanOrEqual(8);
      }
    } finally {
      figure.dispose();
    }
  });

  it("rejects a plot canvas that already produced a 2d context, naming webgl2", () => {
    const stack = createFigureStack(WIDTH, HEIGHT);
    try {
      expect(stack.plot.getContext("2d")).not.toBeNull();
      expect(
        () => new WebGL2FigureRenderer({ surfaces: { underlay: stack.underlay, plot: stack.plot, overlay: stack.overlay } }),
      ).toThrow(/webgl2/);
    } finally {
      stack.remove();
    }
  });
});
