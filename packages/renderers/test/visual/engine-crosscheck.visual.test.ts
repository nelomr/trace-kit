import pixelmatch from "pixelmatch";
import { describe, expect, it } from "vitest";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { commitPayloadRevision, createSpectrumDataPayload } from "@trace-kit/core";
import { DEFAULT_FIGURE_STYLE, TRACE_PALETTE } from "../../src/style.js";
import { deriveDecimationTarget } from "../../src/rules/decimation.js";
import {
  composeWebGl2,
  mountCanvas2d,
  mountWebGl2,
  readPixels,
} from "./support/figure-stack.js";
import {
  columnExtents,
  compareExtents,
  inkLabels,
  insetPlotRect,
  outsideRectLumaDifferences,
  type Rect,
  type ColumnExtents,
  type ComparisonRule,
  type InkPalette,
  type Pixels,
  type Rgb,
} from "./support/ink-metric.js";
import { AXIS_LUMA_DELTA, K_INSET, K_ROWS, P_MISSING, WEBGL2_SCREENSHOT_TOLERANCE } from "./support/webgl2-tolerances.js";

// No `toMatchScreenshot` here and no Canvas2D comparator: this suite compares where each engine
// puts a trace's ink, so it tolerates the pixel-level differences between two rasterizers and
// needs no golden. WebGL2 pixels are read by composing the three layers in a scratch canvas inside
// the same task as `render()`; that composition is test code, never the renderer's.

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface TraceInfo {
  readonly color: Rgb;
  readonly sampleCount: number;
  readonly dashed: boolean;
}

function tracesOf(fixture: ScenarioFixture): TraceInfo[] {
  if (fixture.kind === "payload") {
    return [{ color: hexToRgb(DEFAULT_FIGURE_STYLE.traceColor), sampleCount: fixture.payload.sampleCount, dashed: false }];
  }
  return fixture.collection.entries.map((entry, i) => ({
    color: hexToRgb(entry.style.color ?? TRACE_PALETTE[i % TRACE_PALETTE.length] ?? DEFAULT_FIGURE_STYLE.traceColor),
    sampleCount: entry.payload.sampleCount,
    dashed: (entry.style.dash?.length ?? 0) > 0,
  }));
}

function paletteOf(traces: readonly TraceInfo[]): InkPalette {
  return {
    background: hexToRgb(DEFAULT_FIGURE_STYLE.backgroundColor),
    grid: hexToRgb(DEFAULT_FIGURE_STYLE.gridColor),
    traces: traces.map((t) => t.color),
  };
}

interface Rendered {
  readonly canvas2d: ImageData;
  readonly webgl2: ImageData;
  readonly plotLeft: number;
  readonly plotTop: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
}

function renderBoth(fixture: ScenarioFixture, webgl2Fixture: ScenarioFixture = fixture): Rendered {
  const c2 = mountCanvas2d(fixture);
  const gl = mountWebGl2(webgl2Fixture);
  try {
    c2.renderer.render();
    const t = c2.renderer.transform;
    return {
      canvas2d: readPixels(c2.canvas),
      webgl2: composeWebGl2(gl, () => {
        gl.renderer.render();
      }),
      plotLeft: t.plotLeft,
      plotTop: t.plotTop,
      plotWidth: t.plotWidth,
      plotHeight: t.plotHeight,
    };
  } finally {
    c2.dispose();
    gl.dispose();
  }
}

function extentsFor(pixels: Pixels, rendered: Rendered, palette: InkPalette, trace: number): ColumnExtents {
  const rect = insetPlotRect(rendered, K_INSET);
  return columnExtents(inkLabels(pixels, rect, palette), rect, trace);
}

function ruleFor(info: TraceInfo, plotWidth: number): ComparisonRule {
  return deriveDecimationTarget(info.sampleCount, plotWidth) < info.sampleCount || info.dashed
    ? "one-directional"
    : "two-directional";
}

// Rendering two engines of a 200,000-sample fixture and reading both back can exceed the default
// 5 s budget when the whole workspace test run is saturating the CPU.
const BROWSER_TEST_TIMEOUT_MS = 30_000;

describe("Canvas2D versus WebGL2, structurally", { timeout: BROWSER_TEST_TIMEOUT_MS }, () => {
  for (const fixture of SCENARIO_FIXTURES) {
    it(`${fixture.id}: every trace's ink extent agrees within the declared tolerances`, async () => {
      await ensureDefaultFont();
      const rendered = renderBoth(fixture);
      const traces = tracesOf(fixture);
      const palette = paletteOf(traces);
      traces.forEach((info, i) => {
        const result = compareExtents(
          extentsFor(rendered.canvas2d, rendered, palette, i),
          extentsFor(rendered.webgl2, rendered, palette, i),
          ruleFor(info, rendered.plotWidth),
        );
        expect(result.columnsConsidered, `trace ${i} has ink`).toBeGreaterThan(0);
        expect(result.pass, `trace ${i}: ${JSON.stringify(result)}`).toBe(true);
      });
    });
  }

  it("axes-grid: axes and labels outside the plot, grown by the stroke width and K_INSET, match in luminance", async () => {
    await ensureDefaultFont();
    const { rendered, rect, margin } = axesGridRender();
    expect(outsideRectLumaDifferences(rendered.canvas2d, rendered.webgl2, rect, margin, AXIS_LUMA_DELTA)).toBe(0);
  });

  it("axes-grid: the luminance comparison fails a real 1-device-pixel shift of the labels", async () => {
    await ensureDefaultFont();
    const { rendered, rect, margin } = axesGridRender();
    const shifted = shiftRight(rendered.webgl2, 1);
    expect(outsideRectLumaDifferences(rendered.canvas2d, shifted, rect, margin, AXIS_LUMA_DELTA)).toBeGreaterThan(0);
  });
});

function axesGridRender(): { rendered: Rendered; rect: Rect; margin: number } {
  const fixture = SCENARIO_FIXTURES.find((f) => f.id === "axes-grid");
  if (fixture === undefined) throw new Error("fixture axes-grid missing");
  const rendered = renderBoth(fixture);
  return {
    rendered,
    margin: Math.ceil(DEFAULT_FIGURE_STYLE.lineWidthCss * fixture.dpr) + K_INSET,
    rect: {
      left: Math.round(rendered.plotLeft),
      top: Math.round(rendered.plotTop),
      width: Math.round(rendered.plotWidth),
      height: Math.round(rendered.plotHeight),
    },
  };
}

/** A copy of `source` moved `dx` device pixels to the right, the left edge repeating. */
function shiftRight(source: ImageData, dx: number): Pixels {
  const data = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const from = (y * source.width + Math.max(0, x - dx)) * 4;
      const to = (y * source.width + x) * 4;
      for (let c = 0; c < 4; c += 1) data[to + c] = source.data[from + c] ?? 0;
    }
  }
  return { data, width: source.width, height: source.height };
}

describe("non-vacuity of the cross-check", { timeout: BROWSER_TEST_TIMEOUT_MS }, () => {
  it("fails simple-trace when only the WebGL2 Y domain is shifted by 3 * K_ROWS rows", async () => {
    await ensureDefaultFont();
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === "simple-trace");
    if (fixture === undefined || fixture.kind !== "payload") throw new Error("fixture simple-trace missing");
    const probe = mountCanvas2d(fixture);
    const yScale = probe.renderer.transform.yScale;
    probe.dispose();
    const shiftUnits = (3 * K_ROWS) / yScale;
    const shifted: ScenarioFixture = {
      ...fixture,
      domain: { ...fixture.domain, yMin: fixture.domain.yMin + shiftUnits, yMax: fixture.domain.yMax + shiftUnits },
    };
    const rendered = renderBoth(fixture, shifted);
    const palette = paletteOf(tracesOf(fixture));
    const result = compareExtents(
      extentsFor(rendered.canvas2d, rendered, palette, 0),
      extentsFor(rendered.webgl2, rendered, palette, 0),
      "two-directional",
    );
    expect(result.pass).toBe(false);
  });

  it("exceeds P_MISSING on gapped-trace when the WebGL2 payload is empty", async () => {
    await ensureDefaultFont();
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === "gapped-trace");
    if (fixture === undefined || fixture.kind !== "payload") throw new Error("fixture gapped-trace missing");
    const empty = createSpectrumDataPayload({ capacity: fixture.payload.capacity, xOrigin: fixture.payload.xOrigin, xUnit: "", yUnit: "" });
    commitPayloadRevision(empty, 0);
    const rendered = renderBoth(fixture, { ...fixture, payload: empty });
    const palette = paletteOf(tracesOf(fixture));
    const result = compareExtents(
      extentsFor(rendered.canvas2d, rendered, palette, 0),
      extentsFor(rendered.webgl2, rendered, palette, 0),
      "two-directional",
    );
    expect(result.missingFraction).toBeGreaterThan(P_MISSING);
  });

  it("a 4 device-pixel shifted render exceeds the WebGL2 screenshot tolerance against an unshifted live render", async () => {
    await ensureDefaultFont();
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === "simple-trace");
    if (fixture === undefined || fixture.kind !== "payload") throw new Error("fixture simple-trace missing");
    const probe = mountCanvas2d(fixture);
    const yScale = probe.renderer.transform.yScale;
    probe.dispose();
    const shiftUnits = 4 / yScale;
    const shifted: ScenarioFixture = {
      ...fixture,
      domain: { ...fixture.domain, yMin: fixture.domain.yMin + shiftUnits, yMax: fixture.domain.yMax + shiftUnits },
    };
    // Compared with pixelmatch directly and never through `toMatchScreenshot`, so a golden
    // update run can never write a perturbed reference.
    const live = renderBoth(fixture).webgl2;
    const perturbed = renderBoth(fixture, shifted).webgl2;
    const mismatched = pixelmatch(live.data, perturbed.data, undefined, live.width, live.height, {
      threshold: WEBGL2_SCREENSHOT_TOLERANCE.threshold,
      includeAA: true,
    });
    expect(mismatched / (live.width * live.height)).toBeGreaterThan(
      WEBGL2_SCREENSHOT_TOLERANCE.allowedMismatchedPixelRatio,
    );
  });
});
