/**
 * Backend-neutral per-trace viewport transforms. Payloads that share one X domain may still have
 * been sampled from different absolute origins (two sweep runs), and one shared axis transform
 * would misplace every trace but the first, so each trace gets a transform built from its own
 * `xOrigin` together with the domain and scale kind of the Y axis it is bound to. Both the
 * Canvas2D and the WebGL2 renderer call this one builder, so the two engines cannot disagree on
 * where a trace sits.
 *
 * Cold path: runs on `setTraces`, `setDomain` and `resize`, never per frame. The only allocation
 * is the frozen transform object core returns for each trace.
 */
import {
  createViewportTransform,
  Y_SCALE_KIND_LINEAR,
  type SpectrumDataPayload,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { AxisInsets } from "./figure-layout.js";

export interface TraceTransformGeometry {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  /** The shared, already clamped insets, so every trace has the plot geometry of the axes. */
  readonly insets: AxisInsets;
  readonly xDomainMin: number;
  readonly xDomainMax: number;
}

/**
 * Rebuilds `out[0 .. count)` in place and truncates `out` to `count` entries. A trace bound to no
 * axis (`axisIndex[i] < 0`) takes the `[-1, 1]` linear fallback domain.
 */
export function buildTraceTransforms(
  axes: readonly YAxisRegistration[],
  axisIndex: Int32Array,
  payloads: readonly SpectrumDataPayload[],
  count: number,
  geometry: TraceTransformGeometry,
  out: ViewportTransform[],
): void {
  const { insetLeft, insetRight, insetTop, insetBottom } = geometry.insets;
  for (let i = 0; i < count; i += 1) {
    const payload = payloads[i];
    if (payload === undefined) continue;
    const boundAxis = axisIndex[i] ?? -1;
    const axis = boundAxis >= 0 ? axes[boundAxis] : undefined;
    out[i] = createViewportTransform({
      cssWidth: geometry.cssWidth,
      cssHeight: geometry.cssHeight,
      dpr: geometry.dpr,
      insetLeft,
      insetRight,
      insetTop,
      insetBottom,
      xDomainMin: geometry.xDomainMin,
      xDomainMax: geometry.xDomainMax,
      xOrigin: payload.xOrigin,
      yDomainMin: axis?.domainMin ?? -1,
      yDomainMax: axis?.domainMax ?? 1,
      yScaleKind: axis?.scaleKind ?? Y_SCALE_KIND_LINEAR,
    });
  }
  out.length = count;
}
