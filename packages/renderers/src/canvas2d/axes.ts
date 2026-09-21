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
import {
  projectX,
  projectY,
  selectLogTicks,
  selectTicks,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
} from "@trace-kit/core";
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
 * per-axis visibility, and the number of registered left Y axes) — never of data. Invoked from
 * `resize`/`setDomain`, feeding `createAxisTransforms`'s shared inset option. `insetLeft` grows
 * linearly with `yAxisCount` because each left-stacked axis reserves its own tick+label gutter;
 * `insetLeft` stays a single already-summed number so every one of the N `ViewportTransform`
 * instances built from it shares byte-identical plot geometry (see `createAxisTransforms`) —
 * per-axis gutter *width* lives only here, never in `@trace-kit/core`.
 */
export function computeAxisInsets(
  style: FigureStyle,
  axes: AxisLayout,
  yAxisCount: number,
): AxisInsets {
  const fontSizeCss = extractFontSizeCss(style.font);
  const insetBottom = axes.showBottomAxis
    ? axes.tickLength + axes.labelGutter + fontSizeCss
    : 0;
  const perAxisGutter = axes.tickLength + axes.labelGutter + fontSizeCss;
  const insetLeft = axes.showLeftAxis ? yAxisCount * perAxisGutter : 0;
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

/**
 * Selects Y tick values for one axis's transform, dispatching to `@trace-kit/core`'s
 * `selectLogTicks` for a `Y_SCALE_KIND_LOG` transform and `selectTicks` otherwise — never a
 * renderer-local reimplementation of either algorithm.
 */
export function selectYTicks(
  t: ViewportTransform,
  targetCount: number,
  out: Float64Array,
  outputOffset: number,
): number {
  return t.yScaleKind === Y_SCALE_KIND_LOG
    ? selectLogTicks(t.yDomainMin, t.yDomainMax, targetCount, out, outputOffset)
    : selectTicks(t.yDomainMin, t.yDomainMax, targetCount, out, outputOffset);
}

/** Paints one vertical gridline per x-tick, projected through the (X-shared) transform. */
export function drawXGridlines(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  xTicks: Float64Array,
  xTickCount: number,
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
}

/**
 * Paints one horizontal gridline per y-tick for one axis's transform. For a log-kind transform
 * the tick values passed in are already `selectLogTicks`'s decade output — this function itself
 * has no scale-kind branch, projecting every tick the same way via `projectY`.
 */
export function drawYGridlines(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  yTicks: Float64Array,
  yTickCount: number,
): void {
  context.strokeStyle = style.gridColor;
  context.lineWidth = 1;
  for (let i = 0; i < yTickCount; i += 1) {
    const py = projectY(t, yTicks[i] ?? 0);
    context.beginPath();
    context.moveTo(t.plotLeft, py);
    context.lineTo(t.plotLeft + t.plotWidth, py);
    context.stroke();
  }
}

/** Paints one vertical gridline per x-tick and one horizontal gridline per y-tick, for a single
 * transform. Kept as the single-axis composition of `drawXGridlines`/`drawYGridlines` so a
 * one-axis caller (and its byte-identical call-sequence guarantee) needs no change. */
export function drawGrid(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  xTicks: Float64Array,
  xTickCount: number,
  yTicks: Float64Array,
  yTickCount: number,
): void {
  drawXGridlines(context, t, style, xTicks, xTickCount);
  drawYGridlines(context, t, style, yTicks, yTickCount);
}

/** Paints the bottom (X) axis line, tick marks and labels for one shared transform. */
export function drawBottomAxis(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  axes: AxisLayout,
  xTicks: Float64Array,
  xTickCount: number,
  xLabels: readonly string[],
): void {
  if (!axes.showBottomAxis) return;
  context.strokeStyle = style.axisColor;
  context.font = style.font;
  context.textAlign = "center";
  context.textBaseline = "top";

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

/**
 * Paints one left (Y) axis's line, tick marks and labels for one axis's transform. `columnOffset`
 * (device pixels) shifts an outer-stacked axis's label column further left of the plot area —
 * `0` for the innermost (nearest the plot) axis, matching the archived single-axis position
 * exactly when only one axis is registered.
 */
export function drawLeftAxis(
  context: TraceDrawingContext,
  t: ViewportTransform,
  style: FigureStyle,
  axes: AxisLayout,
  yTicks: Float64Array,
  yTickCount: number,
  yLabels: readonly string[],
  columnOffset = 0,
): void {
  if (!axes.showLeftAxis) return;
  context.strokeStyle = style.axisColor;
  context.font = style.font;

  const axisX = t.plotLeft - columnOffset;
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

/** Paints the axis lines, tick marks and (if configured visible) labels for each axis. Kept as
 * the single-axis composition of `drawBottomAxis`/`drawLeftAxis` so a one-axis caller (and its
 * byte-identical call-sequence guarantee) needs no change. */
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
  drawBottomAxis(context, t, style, axes, xTicks, xTickCount, xLabels);
  drawLeftAxis(context, t, style, axes, yTicks, yTickCount, yLabels);
}
