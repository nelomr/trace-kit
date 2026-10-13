import type { TraceStyle } from "@trace-kit/core";
import { TRACE_PALETTE, type FigureStyle } from "../style.js";

export interface ResolvedTraceStyle {
  readonly color: string;
  readonly lineWidthCss: number;
  /** CSS pixels. The shared frozen `EMPTY_DASH` when the style declares no pattern. */
  readonly dashCss: readonly number[];
  readonly markIsolatedSamples: boolean;
}

/** One frozen empty pattern shared by every solid trace, so resolving a style never allocates a
 * fresh `[]` per trace. */
const EMPTY_DASH: readonly number[] = Object.freeze([]);

/**
 * Resolves one trace's style: an explicit value wins, otherwise the renderer-owned palette entry
 * for the trace index (cycling), the figure line width, and isolated-sample markers on. A real
 * measured sample must never be invisible, hence the marker default.
 */
export function resolveTraceStyle(
  style: TraceStyle,
  index: number,
  figure: FigureStyle,
): ResolvedTraceStyle {
  const dash = style.dash;
  return {
    color: style.color ?? TRACE_PALETTE[index % TRACE_PALETTE.length] ?? figure.traceColor,
    lineWidthCss: style.lineWidthCss ?? figure.lineWidthCss,
    dashCss: dash === undefined || dash.length === 0 ? EMPTY_DASH : dash,
    markIsolatedSamples: style.markIsolatedSamples ?? true,
  };
}
