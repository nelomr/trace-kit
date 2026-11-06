import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  projectX,
  projectY,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
  type ViewportTransform,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import type { ScenarioFixture } from "../../src/fixtures/scenarios.js";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { composeWebGl2, mountCanvas2d, mountWebGl2, readPixels } from "./support/figure-stack.js";
import {
  inkLabels,
  insetPlotRect,
  outOfPlotTraceInk,
  traceInkInRect,
  type InkPalette,
  type Rgb,
} from "./support/ink-metric.js";
import { canvasMeasureText, labelInkBoxes, labelMaskInputOf } from "./support/label-mask.js";
import { INK_DELTA, K_INSET } from "./support/webgl2-tolerances.js";

// The same test-local payload is drawn by Canvas2D and by WebGL2 in one page and read back as
// pixels, with no golden and no fake context. Which engine is which is the only difference.

const TRACE_COLOR: Rgb = [0x3f, 0xb6, 0xff];
const PALETTE: InkPalette = {
  background: [0x0b, 0x0f, 0x14],
  grid: [0x1c, 0x25, 0x30],
  traces: [TRACE_COLOR],
};
const ENGINES = ["canvas2d", "webgl2"] as const;
type Engine = (typeof ENGINES)[number];

interface Probe {
  readonly fixture: ScenarioFixture;
  readonly transform: ViewportTransform;
  readonly pixels: Record<Engine, ImageData>;
}

function payloadOf(values: readonly number[]): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: values.length, xOrigin: 0, xUnit: "", yUnit: "" });
  values.forEach((v, i) => {
    payload.x[i] = i;
    payload.y[i] = v;
  });
  commitPayloadRevision(payload, values.length);
  return payload;
}

function fixtureOf(
  id: string,
  values: readonly number[],
  domain: readonly [number, number, number, number],
  dpr: number,
  logY = false,
): ScenarioFixture {
  return {
    kind: "payload",
    id,
    description: id,
    payload: payloadOf(values),
    domain: { xMin: domain[0], xMax: domain[1], yMin: domain[2], yMax: domain[3] },
    viewport: { width: 800, height: 400 },
    dpr,
    ...(logY
      ? {
          yAxes: [
            { id: "y", scaleKind: Y_SCALE_KIND_LOG, domainMin: domain[2], domainMax: domain[3], side: AXIS_SIDE_LEFT },
          ],
        }
      : {}),
  };
}

async function renderProbe(fixture: ScenarioFixture): Promise<Probe> {
  await ensureDefaultFont();
  const c2 = mountCanvas2d(fixture);
  const gl = mountWebGl2(fixture);
  try {
    c2.renderer.render();
    return {
      fixture,
      transform: c2.renderer.transform,
      pixels: {
        canvas2d: readPixels(c2.canvas),
        webgl2: composeWebGl2(gl, () => {
          gl.renderer.render();
        }),
      },
    };
  } finally {
    c2.dispose();
    gl.dispose();
  }
}

/** Pixels of the block `[left, right] x [top, bottom]` that are (nearly) the trace colour. */
function traceInk(image: ImageData, left: number, right: number, top: number, bottom: number): number {
  const rect = { left, top, width: right - left + 1, height: bottom - top + 1 };
  return traceInkInRect(image, rect, [TRACE_COLOR], INK_DELTA);
}

/** Pixels of the block that are neither background nor grid: any stroke ink at all, faint or not. */
function anyInk(image: ImageData, left: number, right: number, top: number, bottom: number): number {
  const rect = { left, top, width: right - left + 1, height: bottom - top + 1 };
  return inkLabels(image, rect, PALETTE, INK_DELTA).filter((label) => label === 0).length;
}

describe("±Infinity is drawn to the plot edge on both engines", () => {
  // An infinite sample is drawn as a point on the guard edge, tens of thousands of pixels away, so
  // the two segments that meet there are almost vertical and cross the plot's top (or bottom) edge
  // beside the neighbouring samples 1 and 3, not at sample 2's own column. The edge band is read
  // across the whole span those two segments cover. Ink is counted by distance from the trace
  // colour: near the bottom edge the axis line also differs from the background.
  for (const infinity of [Infinity, -Infinity]) {
    const top = infinity > 0;
    for (const engine of ENGINES) {
      it(`${engine}: ${top ? "+" : "-"}Infinity reaches the ${top ? "top" : "bottom"} band`, async () => {
        const probe = await renderProbe(fixtureOf("infinity-edge", [0.5, 0.5, infinity, 0.5, 0.5], [0, 4, 0, 1], 2));
        const t = probe.transform;
        const from = Math.round(projectX(t, 1));
        const to = Math.round(projectX(t, 3));
        const firstRow = Math.ceil(t.plotTop);
        const lastRow = Math.floor(t.plotTop + t.plotHeight) - 1;
        const [rowFrom, rowTo] = top ? [firstRow, firstRow + 2] : [lastRow - 2, lastRow];
        expect(
          traceInk(probe.pixels[engine], from, to, rowFrom, rowTo),
          `trace ink in rows ${rowFrom}..${rowTo}, columns ${from}..${to}`,
        ).toBeGreaterThan(0);
      });
    }
  }
});

describe("a log non-positive sample is bridged by neither engine", () => {
  // Three device pixels per CSS pixel: a marker straddles the plot's left and right edge, so only
  // half of it is visible, and at this scale the visible half is wider than the axis line painted
  // over the left edge, leaving whole pixels of trace colour on both sides.
  const dpr = 3;
  const fixture = fixtureOf("log-isolated", [10, 0, 100], [0, 2, 1, 1_000], dpr, true);

  for (const engine of ENGINES) {
    it(`${engine}: the columns between the samples are blank`, async () => {
      const probe = await renderProbe(fixture);
      const t = probe.transform;
      const rect = insetPlotRect(t, K_INSET);
      const rowBottom = rect.top + rect.height - 1;
      const column = (i: number): number => Math.round(projectX(t, i));
      const m = 2 * Math.ceil(DEFAULT_FIGURE_STYLE.lineWidthCss * dpr) + 2;
      const image = probe.pixels[engine];
      expect(anyInk(image, column(0) + m, column(1) - m, rect.top, rowBottom), "gap 0-1").toBe(0);
      expect(anyInk(image, column(1) + m, column(2) - m, rect.top, rowBottom), "gap 1-2").toBe(0);
    });

    it(`${engine}: both samples carry a marker`, async () => {
      const probe = await renderProbe(fixture);
      const t = probe.transform;
      const column = (i: number): number => Math.round(projectX(t, i));
      const near = Math.ceil(DEFAULT_FIGURE_STYLE.lineWidthCss * dpr);
      const row10 = Math.round(projectY(t, 10));
      const row100 = Math.round(projectY(t, 100));
      const image = probe.pixels[engine];
      expect(traceInk(image, column(0) + 2, column(0) + near - 1, row10 - 2, row10 + 2), "marker of sample 0").toBeGreaterThan(0);
      expect(traceInk(image, column(2) - near, column(2) - 1, row100 - 2, row100 + 2), "marker of sample 2").toBeGreaterThan(0);
    });
  }
});

describe("alternating infinities stay inside the plot on both engines", () => {
  const values = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? Infinity : -Infinity));
  const fixture = fixtureOf("alternating-infinities", values, [0, 49, -1, 1], 2);

  for (const engine of ENGINES) {
    it(`${engine}: no trace ink outside the plot, tick labels aside`, async () => {
      const probe = await renderProbe(fixture);
      const margin = Math.ceil(DEFAULT_FIGURE_STYLE.lineWidthCss * fixture.dpr);
      const masks = labelInkBoxes(labelMaskInputOf(fixture), canvasMeasureText());
      expect(outOfPlotTraceInk(probe.pixels[engine], probe.transform, margin, [TRACE_COLOR], masks, INK_DELTA)).toBe(0);
    });

    it(`${engine}: the infinities are drawn inside the plot`, async () => {
      // Without this the zero above would also hold for an engine that draws nothing at all.
      const probe = await renderProbe(fixture);
      const rect = insetPlotRect(probe.transform, K_INSET);
      expect(traceInkInRect(probe.pixels[engine], rect, [TRACE_COLOR], INK_DELTA)).toBeGreaterThan(0);
    });
  }
});
