import type { SpectrumDataPayload, TraceCollection, YAxisRegistration } from "@trace-kit/core";
import type { AxisLayout, FigureStyle } from "../style.js";

export interface SvgSceneDomain {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * A plain description of one figure. Nothing here is a renderer, a DOM node or a handle: the
 * exporter reads the buffers in place and returns a string.
 */
export interface SvgScene {
  /**
   * A trace collection, or one payload as the single-trace convenience (drawn with
   * `style.traceColor`, bound to the first registered axis, isolated-sample markers on).
   */
  readonly traces: TraceCollection | SpectrumDataPayload;
  /**
   * `xMin`/`xMax` are authoritative for both shapes. `yMin`/`yMax` only drive the implicit axis
   * used when `yAxes` is omitted.
   */
  readonly domain: SvgSceneDomain;
  /** Omitted: one implicit linear left axis spanning `domain.yMin..yMax`. */
  readonly yAxes?: readonly YAxisRegistration[];
  /** CSS pixels. A non-finite or negative value is treated as 0. */
  readonly width: number;
  readonly height: number;
  readonly style?: Partial<FigureStyle>;
  readonly axes?: Partial<AxisLayout>;
}

/**
 * Font data the caller already holds, structurally typed so this module never imports the font
 * module (and its embedded base64 payload) into a consumer's bundle.
 */
export interface SvgEmbeddedFont {
  /** Must be a `data:` URI. Anything else is ignored: the exporter never fetches or references
   * external resources. */
  readonly dataUrl: string;
  readonly format: "woff2";
}

export interface SvgExportOptions {
  /** A finite number `>= 2` is floored and used as the per-trace vertex budget (still capped at
   * the sample count); anything else falls back to the width-derived default. */
  readonly decimationTarget?: number;
  /** Prefix of the single emitted element id. Must match `[A-Za-z][A-Za-z0-9_-]*`, else
   * `tracekit`. */
  readonly idPrefix?: string;
  /** Absent: no `<style>` and no `@font-face` in the document. */
  readonly embedFont?: SvgEmbeddedFont;
}
