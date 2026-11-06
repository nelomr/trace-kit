import {
  projectX,
  projectY,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
} from "@trace-kit/core";
import { GUARD_BAND_PX } from "../rules/guard-band.js";

/**
 * True when the sample ends the current segment instead of extending it: a `NaN` gap anywhere,
 * or a non-positive value on a log axis, which has no position on the scale. `+Infinity` never
 * lifts the pen, it is drawn to the plot edge. `NaN` is detected by comparing the value with
 * itself, and the log rule is a plain comparison, so neither relies on infinity arithmetic.
 */
export function liftsPen(y: number, logAxis: boolean): boolean {
  return y !== y || (logAxis && y <= 0);
}

/** `projectX` clamped into the guard band around the plot. Exact inside the band. */
export function guardedProjectX(t: ViewportTransform, xOffset: number): number {
  const left = t.plotLeft - GUARD_BAND_PX;
  const right = t.plotLeft + t.plotWidth + GUARD_BAND_PX;
  return Math.min(Math.max(projectX(t, xOffset), left), right);
}

/**
 * Device Y of a drawable sample (never `NaN`, never non-positive on a log axis). An infinity
 * goes to the guard edge on the side the axis direction implies, chosen from signs alone: a
 * zero-span axis has a zero scale, and multiplying an infinity by it would give `NaN`. Any other
 * value is projected and clamped, so a huge finite value keeps the segment length finite.
 */
export function guardedProjectY(t: ViewportTransform, y: number): number {
  const top = t.plotTop - GUARD_BAND_PX;
  const bottom = t.plotTop + t.plotHeight + GUARD_BAND_PX;
  if (y === Infinity || y === -Infinity) {
    const axisScale = t.yScaleKind === Y_SCALE_KIND_LOG ? t.yLogScale : t.yScale;
    return y > 0 === axisScale >= 0 ? top : bottom;
  }
  return Math.min(Math.max(projectY(t, y), top), bottom);
}
