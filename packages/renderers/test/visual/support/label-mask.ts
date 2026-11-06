/**
 * Where the tick labels of a Canvas2D or WebGL2 figure put their ink, so a check for trace ink
 * outside the plot can exclude them. Text is the one thing outside the plot rectangle whose
 * anti-aliasing (LCD fringes on an opaque canvas) can land near a trace colour, and its glyph
 * bounds do not depend on how it is rasterized.
 *
 * The layout is rebuilt through the same pure module the renderers use, from the same inputs, and
 * the anchors are the ones the axis painters compute. Only the text measurement is injected: the
 * browser measures with a canvas, the Node drift test with a stub.
 */
import {
  AXIS_SIDE_LEFT,
  projectY,
  Y_SCALE_KIND_LINEAR,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { ScenarioFixture } from "../../../src/fixtures/scenarios.js";
import {
  createFigureLayout,
  refreshFigureTicks,
  scaleFontSize,
  updateFigureGeometry,
} from "../../../src/layout/figure-layout.js";
import { DEFAULT_AXIS_LAYOUT, DEFAULT_FIGURE_STYLE } from "../../../src/style.js";
import type { Rect } from "./ink-metric.js";
import { LABEL_MASK_PAD_PX } from "./webgl2-tolerances.js";

export interface TextBounds {
  readonly actualBoundingBoxLeft: number;
  readonly actualBoundingBoxRight: number;
  readonly actualBoundingBoxAscent: number;
  readonly actualBoundingBoxDescent: number;
}

/** Bounds of `text` relative to its anchor, as `CanvasRenderingContext2D.measureText` reports them. */
export type MeasureText = (
  text: string,
  font: string,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
) => TextBounds;

/** Everything the layout of a figure depends on besides the shared style constants. */
export interface LabelMaskInput {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly xOrigin: number;
  readonly yAxes: readonly YAxisRegistration[];
  readonly xUnit: string;
  readonly yUnit: string;
}

/** One label: the painter's anchor and text, and the grown glyph box as a pixel `Rect`. */
export interface LabelInkBox extends Rect {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The layout inputs a renderer derives from a fixture: a payload fixture draws one payload whose
 * origin and units it takes, over the fixture's domain and either its explicit axes or one
 * implicit linear axis; a collection takes its own X domain, has origin `0` and no units.
 */
export function labelMaskInputOf(fixture: ScenarioFixture): LabelMaskInput {
  const implicitAxis: YAxisRegistration = {
    id: "y",
    scaleKind: Y_SCALE_KIND_LINEAR,
    domainMin: fixture.domain.yMin,
    domainMax: fixture.domain.yMax,
    side: AXIS_SIDE_LEFT,
  };
  const base = {
    cssWidth: fixture.viewport.width,
    cssHeight: fixture.viewport.height,
    dpr: fixture.dpr,
    yAxes: fixture.yAxes ?? [implicitAxis],
  };
  if (fixture.kind === "payload") {
    return {
      ...base,
      xDomainMin: fixture.domain.xMin,
      xDomainMax: fixture.domain.xMax,
      xOrigin: fixture.payload.xOrigin,
      xUnit: fixture.payload.xUnit,
      yUnit: fixture.payload.yUnit,
    };
  }
  return {
    ...base,
    xDomainMin: fixture.collection.xDomainMin,
    xDomainMax: fixture.collection.xDomainMax,
    xOrigin: 0,
    xUnit: "",
    yUnit: "",
  };
}

/**
 * One box per tick label, in the order the painters draw them: the bottom axis left to right,
 * then each left axis in registration order, bottom to top of its tick list.
 */
export function labelInkBoxes(input: LabelMaskInput, measure: MeasureText): LabelInkBox[] {
  const style = DEFAULT_FIGURE_STYLE;
  const axes = DEFAULT_AXIS_LAYOUT;
  const layout = createFigureLayout(input.yAxes.length);
  updateFigureGeometry(layout, {
    cssWidth: input.cssWidth,
    cssHeight: input.cssHeight,
    dpr: input.dpr,
    style,
    axes,
    xDomainMin: input.xDomainMin,
    xDomainMax: input.xDomainMax,
    xOrigin: input.xOrigin,
    yAxes: input.yAxes,
  });
  refreshFigureTicks(layout, input.xUnit, input.yUnit);

  const font = scaleFontSize(style.font, input.dpr);
  const boxes: LabelInkBox[] = [];
  const push = (
    text: string,
    x: number,
    y: number,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
  ): void => {
    const bounds = measure(text, font, align, baseline);
    const left = Math.floor(x - bounds.actualBoundingBoxLeft - LABEL_MASK_PAD_PX);
    const top = Math.floor(y - bounds.actualBoundingBoxAscent - LABEL_MASK_PAD_PX);
    const right = Math.ceil(x + bounds.actualBoundingBoxRight + LABEL_MASK_PAD_PX);
    const bottom = Math.ceil(y + bounds.actualBoundingBoxDescent + LABEL_MASK_PAD_PX);
    boxes.push({ text, x, y, left, top, width: right - left, height: bottom - top });
  };

  const first = layout.transforms[0];
  if (first === undefined) return boxes;

  if (axes.showBottomAxis) {
    const tickEnd = first.plotTop + first.plotHeight + axes.tickLength * first.dpr;
    for (let i = 0; i < layout.xTickCount; i += 1) {
      push(layout.xLabels[i] ?? "", layout.xGridPositions[i] ?? 0, tickEnd, "center", "top");
    }
  }
  if (axes.showLeftAxis) {
    for (let axis = 0; axis < layout.transforms.length; axis += 1) {
      const t = layout.transforms[axis];
      const ticks = layout.yTicks[axis];
      const labels = layout.yLabels[axis];
      if (t === undefined || ticks === undefined || labels === undefined) continue;
      const tickStart =
        t.plotLeft - (layout.axisColumnOffsets[axis] ?? 0) - axes.tickLength * t.dpr;
      for (let i = 0; i < (layout.yTickCounts[axis] ?? 0); i += 1) {
        push(labels[i] ?? "", tickStart, projectY(t, ticks[i] ?? 0), "right", "middle");
      }
    }
  }
  return boxes;
}

/** A `MeasureText` backed by a canvas 2D context; only callable in a browser. */
export function canvasMeasureText(): MeasureText {
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (context === null) throw new Error("canvasMeasureText: no 2d context for text measurement");
  return (text, font, align, baseline) => {
    context.font = font;
    context.textAlign = align;
    context.textBaseline = baseline;
    const metrics = context.measureText(text);
    return {
      actualBoundingBoxLeft: metrics.actualBoundingBoxLeft,
      actualBoundingBoxRight: metrics.actualBoundingBoxRight,
      actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
      actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
    };
  };
}
