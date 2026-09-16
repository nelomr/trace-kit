/**
 * Axes and grid for `Canvas2DRenderer`. Owns the plot-area insets — computed as
 * a pure function of style/layout configuration only, never of data, so it is safe to run on
 * every `resize()`/`setDomain()` — and the paint routines `drawGrid`/`drawAxes`, wired into
 * `render()` in the fixed order background fill → `drawGrid` → trace stroke → `drawAxes`.
 *
 * Tick *values* come from `@trace-kit/core`'s `selectTicks` (never reimplemented here); tick
 * *labels* are formatted here, in a preallocated `string[MAX_TICKS]`, because formatting is
 * presentation (locale, unit suffix) and because a string is an allocation that must not run per
 * frame — the caller gates re-formatting on a `tickRevision` bump.
 */
import { projectX, projectY, type ViewportTransform } from "@trace-kit/core";
import type { AxisLayout, FigureStyle } from "../style.js";
import type { TraceDrawingContext } from "../surface.js";

/** 32 ticks per axis is far beyond any legible axis. */
export const MAX_TICKS = 32;

export interface AxisInsets {
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly insetTop: number;
  readonly insetBottom: number;
}

const FONT_SIZE_PATTERN = /(\d+(?:\.\d+)?)px/;

/** Extracts the leading `<n>px` size from a CSS font shorthand; falls back to 10 CSS px. */
function extractFontSizeCss(font: string): number {
  const match = FONT_SIZE_PATTERN.exec(font);
  if (match === null) return 10;
  const size = Number.parseFloat(match[1] ?? "10");
  return Number.isFinite(size) && size > 0 ? size : 10;
}

/**
 * Pure function of `style`/`axes` configuration only (font size, tick length, label gutter,
 * per-axis visibility) — never of data. Invoked from `resize`/`setDomain`, feeding
 * `createViewportTransform`'s inset options.
 */
export function computeAxisInsets(style: FigureStyle, axes: AxisLayout): AxisInsets {
  const fontSizeCss = extractFontSizeCss(style.font);
  const insetBottom = axes.showBottomAxis
    ? axes.tickLength + axes.labelGutter + fontSizeCss
    : 0;
  const insetLeft = axes.showLeftAxis ? axes.tickLength + axes.labelGutter + fontSizeCss : 0;
  return {
    insetLeft,
    insetRight: 0,
    insetTop: 0,
    insetBottom,
  };
}

/**
 * Formats one tick value for display. Presentation-only, deliberately outside `@trace-kit/core`
 * (locale and unit-suffix formatting is a presentation concern, not a data one); the caller
 * formats once per `tickRevision`, never once per `render()`.
 */
export function formatTickLabel(value: number, unit: string): string {
  const rounded = Math.round(value * 1000) / 1000;
  return unit.length > 0 ? `${rounded} ${unit}` : `${rounded}`;
}

/** Paints one vertical gridline per x-tick and one horizontal gridline per y-tick. */
export function drawGrid(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  xTicks: Float64Array,
  xTickCount: number,
  yTicks: Float64Array,
  yTickCount: number,
): void {
  context.strokeStyle = style.gridColor;
  context.lineWidth = 1;

  for (let i = 0; i < xTickCount; i += 1) {
    const px = projectX(t, xTicks[i] ?? 0);
    context.beginPath();
    context.moveTo(px, t.plotTop);
    context.lineTo(px, t.plotTop + t.plotHeight);
    context.stroke();
  }

  for (let i = 0; i < yTickCount; i += 1) {
    const py = projectY(t, yTicks[i] ?? 0);
    context.beginPath();
    context.moveTo(t.plotLeft, py);
    context.lineTo(t.plotLeft + t.plotWidth, py);
    context.stroke();
  }
}

/** Paints the axis lines, tick marks and (if configured visible) labels for each axis. */
export function drawAxes(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  axes: AxisLayout,
  xTicks: Float64Array,
  xTickCount: number,
  xLabels: readonly string[],
  yTicks: Float64Array,
  yTickCount: number,
  yLabels: readonly string[],
): void {
  context.strokeStyle = style.axisColor;
  context.font = style.font;
  context.textAlign = "center";
  context.textBaseline = "top";

  if (axes.showBottomAxis) {
    const axisY = t.plotTop + t.plotHeight;
    const tickEnd = axisY + axes.tickLength * t.dpr;
    context.beginPath();
    context.moveTo(t.plotLeft, axisY);
    context.lineTo(t.plotLeft + t.plotWidth, axisY);
    context.stroke();

    for (let i = 0; i < xTickCount; i += 1) {
      const px = projectX(t, xTicks[i] ?? 0);
      context.beginPath();
      context.moveTo(px, axisY);
      context.lineTo(px, tickEnd);
      context.stroke();
      context.fillStyle = style.labelColor;
      context.fillText(xLabels[i] ?? "", px, tickEnd);
    }
  }

  if (axes.showLeftAxis) {
    const axisX = t.plotLeft;
    const tickStart = axisX - axes.tickLength * t.dpr;
    context.beginPath();
    context.moveTo(axisX, t.plotTop);
    context.lineTo(axisX, t.plotTop + t.plotHeight);
    context.stroke();

    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let i = 0; i < yTickCount; i += 1) {
      const py = projectY(t, yTicks[i] ?? 0);
      context.beginPath();
      context.moveTo(tickStart, py);
      context.lineTo(axisX, py);
      context.stroke();
      context.fillStyle = style.labelColor;
      context.fillText(yLabels[i] ?? "", tickStart, py);
    }
  }
}
