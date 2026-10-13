/** @vitest-environment node */
import {
  AXIS_SIDE_LEFT,
  projectX,
  projectY,
  selectLogTicks,
  selectTicks,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type YAxisRegistration,
} from "@trace-kit/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  axisGutterCss,
  clampInsetsToViewport,
  computeAxisInsets,
  createFigureLayout,
  MAX_TICKS,
  refreshFigureTicks,
  updateFigureGeometry,
  type FigureLayoutInput,
} from "../../src/layout/figure-layout.js";
import { formatTickLabel } from "../../src/layout/tick-label.js";
import {
  DEFAULT_AXIS_LAYOUT,
  DEFAULT_FIGURE_STYLE,
  type AxisLayout,
} from "../../src/style.js";

vi.mock("@trace-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trace-kit/core")>();
  return {
    ...actual,
    selectTicks: vi.fn(actual.selectTicks),
    selectLogTicks: vi.fn(actual.selectLogTicks),
  };
});

vi.mock("../../src/layout/tick-label.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/layout/tick-label.js")>();
  return { ...actual, formatTickLabel: vi.fn(actual.formatTickLabel) };
});

const LINEAR: YAxisRegistration = {
  id: "lin",
  scaleKind: Y_SCALE_KIND_LINEAR,
  domainMin: -1,
  domainMax: 1,
  side: AXIS_SIDE_LEFT,
};
const LOG: YAxisRegistration = {
  id: "log",
  scaleKind: Y_SCALE_KIND_LOG,
  domainMin: 1,
  domainMax: 1000,
  side: AXIS_SIDE_LEFT,
};

function makeInput(
  yAxes: readonly YAxisRegistration[],
  overrides: Partial<FigureLayoutInput> = {},
): FigureLayoutInput {
  return {
    cssWidth: 800,
    cssHeight: 400,
    dpr: 1,
    style: DEFAULT_FIGURE_STYLE,
    axes: DEFAULT_AXIS_LAYOUT,
    xDomainMin: 0,
    xDomainMax: 100,
    xOrigin: 0,
    yAxes,
    ...overrides,
  };
}

function build(input: FigureLayoutInput) {
  const layout = createFigureLayout(input.yAxes.length);
  updateFigureGeometry(layout, input);
  refreshFigureTicks(layout, "nm", "dBm");
  return layout;
}

beforeEach(() => {
  vi.mocked(selectTicks).mockClear();
  vi.mocked(selectLogTicks).mockClear();
  vi.mocked(formatTickLabel).mockClear();
});

describe("formatTickLabel", () => {
  it("is the moved, unchanged formatter", () => {
    expect(formatTickLabel(1.23456, "nm")).toBe("1.235 nm");
    expect(formatTickLabel(2, "")).toBe("2");
    expect(formatTickLabel(0.1 + 0.2, "")).toBe("0.3");
  });
});

describe("computeAxisInsets", () => {
  it("grows linearly with the axis count", () => {
    const one = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 1);
    const two = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 2);
    expect(one.insetLeft).toBe(28);
    expect(two.insetLeft).toBe(one.insetLeft * 2);
    expect(two.insetBottom).toBe(one.insetBottom);
    expect(two.insetRight).toBe(0);
    expect(two.insetTop).toBe(0);
  });

  it("is zero for zero axes or a hidden left axis", () => {
    expect(computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 0).insetLeft).toBe(0);
    const hidden: AxisLayout = { ...DEFAULT_AXIS_LAYOUT, showLeftAxis: false };
    expect(computeAxisInsets(DEFAULT_FIGURE_STYLE, hidden, 3).insetLeft).toBe(0);
  });

  it("exposes the per-axis gutter it sums", () => {
    expect(axisGutterCss(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT)).toBe(28);
  });
});

describe("clampInsetsToViewport", () => {
  it("matches the four-line clamp it replaces, operand for operand", () => {
    const sizes = [0, 0.5, 1, 10, 30, 60, 800];
    for (const w of sizes) {
      for (const h of sizes) {
        const raw = { insetLeft: 56, insetRight: 3, insetTop: 4, insetBottom: 28 };
        const maxHorizontal = Math.max(0, w - 1);
        const maxVertical = Math.max(0, h - 1);
        const insetLeft = Math.min(raw.insetLeft, maxHorizontal);
        const insetRight = Math.min(raw.insetRight, Math.max(0, maxHorizontal - insetLeft));
        const insetTop = Math.min(raw.insetTop, maxVertical);
        const insetBottom = Math.min(raw.insetBottom, Math.max(0, maxVertical - insetTop));
        expect(clampInsetsToViewport(raw, w, h)).toEqual({
          insetLeft,
          insetRight,
          insetTop,
          insetBottom,
        });
      }
    }
  });
});

describe("geometry", () => {
  it("flags a viewport that cannot hold the insets as degenerate", () => {
    expect(build(makeInput([LINEAR], { cssWidth: 10 })).degenerate).toBe(true);
    expect(build(makeInput([LINEAR], { cssHeight: 20 })).degenerate).toBe(true);
    expect(build(makeInput([LINEAR])).degenerate).toBe(false);
  });

  it("builds one transform per axis sharing plot geometry", () => {
    const layout = build(makeInput([LINEAR, LOG]));
    const [a, b] = layout.transforms;
    expect(layout.transforms.length).toBe(2);
    expect(a?.plotLeft).toBe(b?.plotLeft);
    expect(a?.plotTop).toBe(b?.plotTop);
    expect(a?.plotWidth).toBe(b?.plotWidth);
    expect(a?.plotHeight).toBe(b?.plotHeight);
    expect(a?.yScaleKind).toBe(Y_SCALE_KIND_LINEAR);
    expect(b?.yScaleKind).toBe(Y_SCALE_KIND_LOG);
  });

  it("scales plot geometry by dpr", () => {
    const inset = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 2).insetLeft;
    const at1 = build(makeInput([LINEAR, LOG], { dpr: 1 }));
    const at2 = build(makeInput([LINEAR, LOG], { dpr: 2 }));
    expect(at1.transforms[0]?.plotLeft).toBe(inset);
    expect(at2.transforms[0]?.plotLeft).toBe(inset * 2);
    expect(at2.transforms[1]?.plotLeft).toBe(inset * 2);
  });

  it("derives column offsets in registration order, scaled by dpr", () => {
    const gutter = axisGutterCss(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT);
    const layout = build(makeInput([LINEAR, LOG, LINEAR], { dpr: 2 }));
    expect(Array.from(layout.axisColumnOffsets)).toEqual([0, gutter * 2, gutter * 4]);
  });
});

describe("ticks and gridlines", () => {
  it("selects ticks per axis kind and never duplicates a selection", () => {
    build(makeInput([LINEAR, LOG]));
    // One X selection plus one linear Y selection.
    expect(vi.mocked(selectTicks)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(selectLogTicks)).toHaveBeenCalledTimes(1);
  });

  it("places every gridline at the projection of its tick", () => {
    const layout = build(makeInput([LOG, LINEAR], { dpr: 2, xDomainMax: 511 }));
    const first = layout.transforms[0];
    if (first === undefined) throw new Error("no transform");
    for (let i = 0; i < layout.xTickCount; i += 1) {
      expect(layout.xGridPositions[i]).toBe(projectX(first, layout.xTicks[i] ?? 0));
    }
    for (let axis = 0; axis < 2; axis += 1) {
      const t = layout.transforms[axis];
      const ticks = layout.yTicks[axis];
      const positions = layout.yGridPositions[axis];
      if (t === undefined || ticks === undefined || positions === undefined) {
        throw new Error("missing axis buffers");
      }
      expect(layout.yTickCounts[axis]).toBeGreaterThan(0);
      for (let i = 0; i < (layout.yTickCounts[axis] ?? 0); i += 1) {
        expect(positions[i]).toBe(projectY(t, ticks[i] ?? 0));
      }
    }
  });

  it("keeps gridline positions current after a resize that leaves the tick key unchanged", () => {
    const layout = build(makeInput([LINEAR]));
    const before = layout.xGridPositions[1];
    updateFigureGeometry(layout, makeInput([LINEAR], { cssWidth: 400 }));
    expect(refreshFigureTicks(layout, "nm", "dBm")).toBe(false);
    const t = layout.transforms[0];
    if (t === undefined) throw new Error("no transform");
    expect(layout.xGridPositions[1]).toBe(projectX(t, layout.xTicks[1] ?? 0));
    expect(layout.xGridPositions[1]).not.toBe(before);
  });

  it("labels use the unit and the formatter's output", () => {
    const layout = build(makeInput([LINEAR]));
    expect(layout.xLabels[0]).toBe(formatTickLabel(layout.xTicks[0] ?? 0, "nm"));
    expect(layout.yLabels[0]?.[0]).toBe(formatTickLabel(layout.yTicks[0]?.[0] ?? 0, "dBm"));
  });
});

describe("refreshFigureTicks revision gate", () => {
  it("does not reformat or reallocate on an unchanged key", () => {
    const layout = build(makeInput([LINEAR, LOG]));
    const revision = layout.tickRevision;
    const buffers = [layout.xTicks, layout.xLabels, layout.yTicks[0], layout.yLabels[1], layout.axisColumnOffsets];
    vi.mocked(formatTickLabel).mockClear();
    vi.mocked(selectTicks).mockClear();
    vi.mocked(selectLogTicks).mockClear();

    expect(refreshFigureTicks(layout, "nm", "dBm")).toBe(false);

    expect(layout.tickRevision).toBe(revision);
    expect(vi.mocked(formatTickLabel)).not.toHaveBeenCalled();
    expect(vi.mocked(selectTicks)).not.toHaveBeenCalled();
    expect(vi.mocked(selectLogTicks)).not.toHaveBeenCalled();
    expect([layout.xTicks, layout.xLabels, layout.yTicks[0], layout.yLabels[1], layout.axisColumnOffsets]).toEqual(buffers);
    expect(layout.xTicks).toBe(buffers[0]);
    expect(layout.yLabels[1]).toBe(buffers[3]);
  });

  it("reformats and bumps the revision when the domain changes", () => {
    const layout = build(makeInput([LINEAR]));
    const revision = layout.tickRevision;
    updateFigureGeometry(layout, makeInput([LINEAR], { xDomainMax: 7 }));
    vi.mocked(formatTickLabel).mockClear();
    expect(refreshFigureTicks(layout, "nm", "dBm")).toBe(true);
    expect(layout.tickRevision).toBe(revision + 1);
    expect(vi.mocked(formatTickLabel)).toHaveBeenCalled();
  });

  it("reformats when a unit changes", () => {
    const layout = build(makeInput([LINEAR]));
    expect(refreshFigureTicks(layout, "THz", "dBm")).toBe(true);
    expect(layout.xLabels[0]).toContain("THz");
  });

  it("preallocates fixed-capacity buffers", () => {
    const layout = createFigureLayout(2);
    expect(layout.xTicks.length).toBe(MAX_TICKS);
    expect(layout.xLabels.length).toBe(MAX_TICKS);
    expect(layout.yTicks.length).toBe(2);
    expect(layout.yTicks[1]?.length).toBe(MAX_TICKS);
    expect(layout.yLabels[1]?.length).toBe(MAX_TICKS);
    expect(layout.axisColumnOffsets.length).toBe(2);
  });
});

describe("layout module neutrality", () => {
  const dir = fileURLToPath(new URL("../../src/layout/", import.meta.url));
  const sources = ["figure-layout.ts", "tick-label.ts"].map((f) => [f, readFileSync(`${dir}${f}`, "utf8")] as const);

  it.each(sources)("%s imports no backend and references no browser global", (_name, source) => {
    expect(source).not.toMatch(/from\s+["'][^"']*\/(canvas2d|svg)\//);
    expect(source).not.toMatch(/\b(document|window|HTMLCanvasElement|OffscreenCanvas|Path2D)\b/);
    expect(source).not.toMatch(/toLocaleString|Intl\./);
  });

  it("selects ticks only through core's selectors", () => {
    const source = readFileSync(`${dir}figure-layout.ts`, "utf8");
    expect(source).toMatch(/selectTicks/);
    expect(source).toMatch(/selectLogTicks/);
    expect(source).toMatch(/from\s+["']@trace-kit\/core["']/);
    expect(source).not.toMatch(/Math\.(log10|pow)/);
  });
});

describe("canvas2d defers layout computation to the layout module", () => {
  const dir = fileURLToPath(new URL("../../src/canvas2d/", import.meta.url));
  const axesSource = readFileSync(`${dir}axes.ts`, "utf8");
  const rendererSource = readFileSync(`${dir}canvas2d-renderer.ts`, "utf8");

  it("axes.ts only re-exports the moved layout symbols and computes no inset or tick", () => {
    expect(axesSource).toMatch(/export\s*\{[^}]*MAX_TICKS[^}]*\}\s*from\s*["']\.\.\/layout\//s);
    expect(axesSource).toMatch(/export\s*\{[^}]*computeAxisInsets[^}]*\}\s*from\s*["']\.\.\/layout\//s);
    expect(axesSource).toMatch(/export\s*\{[^}]*formatTickLabel[^}]*\}\s*from\s*["']\.\.\/layout\//s);
    expect(axesSource).toMatch(/export\s*\{[^}]*selectYTicks[^}]*\}\s*from\s*["']\.\.\/layout\//s);
    expect(axesSource).not.toMatch(/export (const MAX_TICKS|function (computeAxisInsets|formatTickLabel|selectYTicks))/);
    expect(axesSource).not.toMatch(/selectTicks|selectLogTicks|extractFontSizeCss/);
  });

  it("the renderer carries no duplicated inset clamp and no tick selection of its own", () => {
    expect(rendererSource).not.toMatch(/maxHorizontal|maxVertical/);
    expect(rendererSource).not.toMatch(/selectTicks|selectLogTicks|formatTickLabel/);
    expect(rendererSource).not.toMatch(/computeAxisInsets/);
    expect(rendererSource).toMatch(/updateFigureGeometry/);
    expect(rendererSource).toMatch(/refreshFigureTicks/);
  });
});
