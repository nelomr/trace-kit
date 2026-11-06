import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  projectX,
  projectY,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import type { ScenarioFixture } from "../../src/fixtures/scenarios.js";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { mountCanvas2d, readPixels } from "./support/figure-stack.js";
import {
  columnExtents,
  inkLabels,
  insetPlotRect,
  outOfPlotTraceInk,
  traceInkInRect,
  type InkPalette,
  type Rgb,
} from "./support/ink-metric.js";
import { canvasMeasureText, labelInkBoxes, labelMaskInputOf } from "./support/label-mask.js";
import { INK_DELTA, K_INSET } from "./support/webgl2-tolerances.js";

// Canvas2D only, real Chromium, `getImageData` reads: no golden, no screenshot comparison and no
// fake context. Each case renders a small purpose-built figure and inspects where ink is, or is
// not.

const TRACE_COLOR: Rgb = [0x3f, 0xb6, 0xff];
const PALETTE: InkPalette = {
  background: [0x0b, 0x0f, 0x14],
  grid: [0x1c, 0x25, 0x30],
  traces: [TRACE_COLOR],
};

function payloadOf(values: readonly number[], x: (i: number) => number = (i) => i): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: values.length, xOrigin: 0, xUnit: "", yUnit: "" });
  values.forEach((v, i) => {
    payload.x[i] = x(i);
    payload.y[i] = v;
  });
  commitPayloadRevision(payload, values.length);
  return payload;
}

describe("Canvas2D behaviour probes", () => {
  it("draws no trace ink left of the plot when the payload extends past the visible window", async () => {
    await ensureDefaultFont();
    // 4096 flat samples at x = 0..4095, while the window shows only 1748..2348: the stroke
    // arrives from far outside the plot on the left and leaves far outside on the right. The
    // height is odd so the plot is 373 px tall and y = 0.5 falls on the centre of a pixel row: a
    // 1.5 px stroke centred there paints that row in the pure trace colour, whereas centred on a
    // row boundary it would paint two rows at 75 % coverage, which is farther than the ink delta
    // from the trace colour and would make the check below blind to the stroke.
    const fixture: ScenarioFixture = {
      kind: "payload",
      id: "flat-out-of-window",
      description: "flat trace, window inside the payload",
      payload: payloadOf(Array.from({ length: 4096 }, () => 0.5)),
      domain: { xMin: 1_748, xMax: 2_348, yMin: 0, yMax: 1 },
      viewport: { width: 800, height: 401 },
      dpr: 1,
    };
    const figure = mountCanvas2d(fixture);
    try {
      figure.renderer.render();
      const t = figure.renderer.transform;
      const pixels = readPixels(figure.canvas);
      const margin = Math.ceil(DEFAULT_FIGURE_STYLE.lineWidthCss * fixture.dpr);
      const masks = labelInkBoxes(labelMaskInputOf(fixture), canvasMeasureText());

      expect(outOfPlotTraceInk(pixels, t, margin, [TRACE_COLOR], masks, INK_DELTA)).toBe(0);

      // The flat trace is really drawn: trace-coloured ink on the row of y = 0.5 inside the plot.
      const inner = insetPlotRect(t, K_INSET);
      const row = Math.floor(projectY(t, 0.5));
      const onRow = { left: inner.left, top: row, width: inner.width, height: 1 };
      expect(traceInkInRect(pixels, onRow, [TRACE_COLOR], INK_DELTA), "ink on the row of y = 0.5").toBe(inner.width);
    } finally {
      figure.dispose();
    }
  });

  it("does not bridge a run of non-positive samples on a log axis", async () => {
    await ensureDefaultFont();
    const values = Array.from({ length: 60 }, (_, i) => (i === 30 ? 0 : i === 31 ? -5 : 10 + i));
    const fixture: ScenarioFixture = {
      kind: "payload",
      id: "log-non-positive-run",
      description: "log axis with a zero and a negative sample",
      payload: payloadOf(values),
      domain: { xMin: 0, xMax: 59, yMin: 1, yMax: 1_000 },
      viewport: { width: 800, height: 400 },
      dpr: 1,
      yAxes: [{ id: "y", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1_000, side: AXIS_SIDE_LEFT }],
    };
    const figure = mountCanvas2d(fixture);
    try {
      figure.renderer.render();
      const t = figure.renderer.transform;
      const rect = insetPlotRect(t, K_INSET);
      const pixels = readPixels(figure.canvas);
      const extents = columnExtents(inkLabels(pixels, rect, PALETTE), rect, 0);
      const column = (i: number): number => Math.round(projectX(t, i)) - rect.left;

      // The stroke's own width and a pixel of anti-aliasing may reach 5 columns into the gap.
      for (let x = column(29) + 5; x <= column(32) - 5; x += 1) {
        expect(extents.first[x], `column ${x + rect.left}`).toBe(-1);
      }
      // A gentle 1.5 px stroke may straddle a row boundary in any one column; across a dozen
      // columns it passes through every phase, so some pixel is fully covered.
      const strictInk = (center: number): number =>
        traceInkInRect(pixels, { left: center - 6, top: rect.top, width: 13, height: rect.height }, [TRACE_COLOR], INK_DELTA);
      expect(strictInk(Math.round(projectX(t, 10))), "ink where the trace is drawn").toBeGreaterThan(0);
      expect(strictInk(Math.round(projectX(t, 25))), "ink before the gap").toBeGreaterThan(0);
      expect(strictInk(Math.round(projectX(t, 45))), "ink after the gap").toBeGreaterThan(0);
    } finally {
      figure.dispose();
    }
  });
});
