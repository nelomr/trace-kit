/**
 * N independent Y domains sharing one X domain, as N `ViewportTransform` instances of one shape.
 * `createAxisTransforms` is a cold-path function (resize / `setDomain`), never invoked per
 * frame. Per-axis gutter arithmetic (font metrics, style) lives in the renderer, never here —
 * this module only ever consumes one already-summed `insetLeft`, so every produced transform
 * shares byte-identical plot geometry.
 */
import {
  createViewportTransform,
  type CreateViewportTransformOptions,
  type ViewportTransform,
} from "./transform.js";

/** The only side implemented by this change; `side: 1` (right) is reserved. */
export const AXIS_SIDE_LEFT = 0;
// Value 1 is reserved for right-side axes; not implemented in this change.

/**
 * Plain, frozen, isomorphic axis configuration — no DOM, no font metrics, no style. `id` is the
 * stable identity a later change binds a trace to; unused by projection itself here.
 */
export interface YAxisRegistration {
  readonly id: string;
  readonly scaleKind: number;
  readonly domainMin: number;
  readonly domainMax: number;
  readonly side: number;
}

/** The X-domain and layout fields shared identically across every axis's transform. */
export type SharedViewportOptions = Omit<
  CreateViewportTransformOptions,
  "yDomainMin" | "yDomainMax" | "yScaleKind"
>;

/**
 * Builds one `ViewportTransform` per registration, writing into the caller-owned `out` array
 * (same caller-buffer idiom as the tick-selection functions) and returning the count written.
 * `out[i]` corresponds to `axes[i]`: registration order is the only correspondence — no id-to-
 * index lookup map is built anywhere in this module.
 */
export function createAxisTransforms(
  shared: SharedViewportOptions,
  axes: readonly YAxisRegistration[],
  out: ViewportTransform[],
): number {
  let count = 0;
  for (let i = 0; i < axes.length; i += 1) {
    const axis = axes[i];
    if (axis === undefined) continue;
    out[i] = createViewportTransform({
      ...shared,
      yDomainMin: axis.domainMin,
      yDomainMax: axis.domainMax,
      yScaleKind: axis.scaleKind,
    });
    count += 1;
  }
  return count;
}
