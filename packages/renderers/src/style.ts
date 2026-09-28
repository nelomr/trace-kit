/**
 * `FigureStyle`/`AxisLayout` — the renderer's frozen configuration surface.
 * Every field is a plain number or string, read into locals before any loop runs; nothing in
 * the per-point path reads a style property directly. There is no `setStyle`: restyling at
 * runtime is an engine-controller concern left for later, since the renderer never reads style
 * off the live DOM element — `getComputedStyle` forces layout and does not exist on
 * `OffscreenCanvas`.
 */

export interface FigureStyle {
  readonly backgroundColor: string;
  readonly traceColor: string;
  readonly gridColor: string;
  readonly axisColor: string;
  readonly labelColor: string;
  /** CSS pixels. Multiplied by `transform.dpr` at draw time, never by `devicePixelRatio`. */
  readonly lineWidthCss: number;
  readonly font: string;
}

export interface AxisLayout {
  /** CSS pixels. */
  readonly tickLength: number;
  /** CSS pixels reserved for tick labels beyond `tickLength`. */
  readonly labelGutter: number;
  /** A hint passed through to `selectTicks`; the actual count is whatever the nice step yields. */
  readonly targetTickCount: number;
  readonly showLeftAxis: boolean;
  readonly showBottomAxis: boolean;
}

export const DEFAULT_FIGURE_STYLE: FigureStyle = Object.freeze({
  backgroundColor: "#0b0f14",
  traceColor: "#3fb6ff",
  gridColor: "#1c2530",
  axisColor: "#3a4756",
  labelColor: "#8a97a8",
  lineWidthCss: 1.5,
  font: '10px "TraceKit Inter"',
});

export const DEFAULT_AXIS_LAYOUT: AxisLayout = Object.freeze({
  tickLength: 4,
  labelGutter: 14,
  targetTickCount: 6,
  showLeftAxis: true,
  showBottomAxis: true,
});

/**
 * Default per-trace colors for a `TraceCollection` entry that carries no explicit
 * `TraceStyle.color`. Renderer-owned, not core-owned: `@trace-kit/core`'s `TraceCollection`
 * validates and composes traces without ever picking a color, so two different renderer
 * consumers (Canvas2D, later WebGL2) can each ship their own palette without a core release.
 * Index `i % TRACE_PALETTE.length` so a collection with more traces than colors cycles rather
 * than running out.
 */
export const TRACE_PALETTE: readonly string[] = Object.freeze([
  "#3fb6ff",
  "#ff7a45",
  "#7cd992",
  "#f2c94c",
  "#c792ea",
  "#ff6b81",
]);
