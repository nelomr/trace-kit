import { dataToPixel, type Domain, type PixelRange } from "./geometry.js";

/**
 * Issues `moveTo`/`lineTo`/`stroke` calls to draw a polyline of `xValues`/`yValues` (a plain
 * number pair per point) into `ctx`, mapped through `xDomain`/`yDomain` into `xRange`/`yRange`.
 * Deliberately NOT unit-tested: `getContext("2d")` returns `null` under happy-dom, so no DOM
 * test runner available to this project can exercise it. All of its testable logic lives in
 * `geometry.ts` instead.
 */
export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  count: number,
  xDomain: Domain,
  yDomain: Domain,
  xRange: PixelRange,
  yRange: PixelRange,
): void {
  if (count === 0) {
    return;
  }
  ctx.beginPath();
  const firstX = dataToPixel(xValues[0] ?? 0, xDomain, xRange);
  const firstY = dataToPixel(yValues[0] ?? 0, yDomain, yRange);
  ctx.moveTo(firstX, firstY);
  for (let i = 1; i < count; i += 1) {
    const px = dataToPixel(xValues[i] ?? 0, xDomain, xRange);
    const py = dataToPixel(yValues[i] ?? 0, yDomain, yRange);
    ctx.lineTo(px, py);
  }
  ctx.stroke();
}
