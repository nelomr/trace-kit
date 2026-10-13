/**
 * Paint routines for the axes and grid of `Canvas2DRenderer`, wired into `render()` in the fixed
 * order background fill -> `drawGrid` -> trace stroke -> `drawAxes`. Everything that is computed
 * rather than painted (plot-area insets, tick values, label strings) lives in `../layout/` and is
 * shared with the SVG exporter; the symbols below are re-exported only so existing imports keep
 * resolving.
 */
import { projectX, projectY, type ViewportTransform } from "@trace-kit/core";
import type { AxisLayout, FigureStyle } from "../style.js";
import type { TraceDrawingContext } from "../surface.js";

export { computeAxisInsets, MAX_TICKS, selectYTicks, type AxisInsets } from "../layout/figure-layout.js";
export { formatTickLabel } from "../layout/tick-label.js";

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
 * the tick values passed in are already the decade output of core's log tick selector — this function itself
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
  context.lineWidth = axes.axisLineWidthCss * t.dpr;
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
 * (device pixels) shifts an outer-stacked axis's column further left of the plot area — `0` for
 * the innermost (nearest the plot) axis, matching the single-axis position exactly when only one
 * axis is registered.
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
  context.lineWidth = axes.axisLineWidthCss * t.dpr;
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
