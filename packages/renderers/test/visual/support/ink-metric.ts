/**
 * Structural cross-engine comparison, as pure functions over RGBA pixels. Canvas2D strokes with an
 * analytic anti-aliased rasterizer and WebGL2 with coverage computed in a fragment shader, so the
 * same trace differs by a pixel or two along every edge; comparing pixels would be either too loose
 * or constantly red. These functions compare where each engine puts a trace's ink instead: the
 * first and last inked row of every column, per trace colour.
 */
import { INK_DELTA, K_ROWS, P_COLUMNS, P_MISSING } from "./webgl2-tolerances.js";

export interface Pixels {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export type Rgb = readonly [number, number, number];

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PlotGeometry {
  readonly plotLeft: number;
  readonly plotTop: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
}

export interface InkPalette {
  readonly background: Rgb;
  readonly grid: Rgb;
  /** Resolved trace colours; a pixel is attributed to the nearest one. */
  readonly traces: readonly Rgb[];
}

function luma(data: ArrayLike<number>, offset: number): number {
  return 0.2126 * (data[offset] ?? 0) + 0.7152 * (data[offset + 1] ?? 0) + 0.0722 * (data[offset + 2] ?? 0);
}

/**
 * Pixels outside `rect` grown by `margin` whose luminance differs by more than `lumaDelta`. Used
 * for axes and labels, where two engines draw identical glyph geometry but may anti-alias it
 * differently (LCD fringes on an opaque canvas, grayscale on a transparent one): the chroma of a
 * fringe is ignored, a shifted glyph is not.
 */
export function outsideRectLumaDifferences(
  a: Pixels,
  b: Pixels,
  rect: Rect,
  margin: number,
  lumaDelta: number,
): number {
  const left = rect.left - margin;
  const top = rect.top - margin;
  const right = rect.left + rect.width + margin;
  const bottom = rect.top + rect.height + margin;
  let differing = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (x >= left && x < right && y >= top && y < bottom) continue;
      const offset = (y * a.width + x) * 4;
      if (Math.abs(luma(a.data, offset) - luma(b.data, offset)) > lumaDelta) differing += 1;
    }
  }
  return differing;
}

export interface ColumnExtents {
  /** First inked row of each column of the measured rectangle, or -1. */
  readonly first: Int32Array;
  /** Last inked row of each column, or -1. */
  readonly last: Int32Array;
}

/** The plot rectangle, rounded to whole pixels and shrunk by `inset` on every side. */
export function insetPlotRect(plot: PlotGeometry, inset: number): Rect {
  return {
    left: Math.round(plot.plotLeft) + inset,
    top: Math.round(plot.plotTop) + inset,
    width: Math.round(plot.plotWidth) - 2 * inset,
    height: Math.round(plot.plotHeight) - 2 * inset,
  };
}

function channelDistance(data: ArrayLike<number>, offset: number, color: Rgb): number {
  return Math.max(
    Math.abs((data[offset] ?? 0) - color[0]),
    Math.abs((data[offset + 1] ?? 0) - color[1]),
    Math.abs((data[offset + 2] ?? 0) - color[2]),
  );
}

/**
 * One label per pixel of `rect` (row-major, `rect.width` wide): the index of the nearest trace
 * colour for a pixel whose max-channel distance from both the background and the grid colour
 * exceeds `inkDelta`, otherwise `-1`.
 */
export function inkLabels(
  pixels: Pixels,
  rect: Rect,
  palette: InkPalette,
  inkDelta: number = INK_DELTA,
): Int8Array {
  const labels = new Int8Array(rect.width * rect.height).fill(-1);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const offset = ((rect.top + y) * pixels.width + rect.left + x) * 4;
      if (
        channelDistance(pixels.data, offset, palette.background) <= inkDelta ||
        channelDistance(pixels.data, offset, palette.grid) <= inkDelta
      ) {
        continue;
      }
      let best = -1;
      let bestDistance = Infinity;
      for (let t = 0; t < palette.traces.length; t += 1) {
        const color = palette.traces[t];
        if (color === undefined) continue;
        const distance = channelDistance(pixels.data, offset, color);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = t;
        }
      }
      labels[y * rect.width + x] = best;
    }
  }
  return labels;
}

/** First and last row carrying trace `trace`'s ink, for every column of `rect`. */
export function columnExtents(labels: Int8Array, rect: Rect, trace: number): ColumnExtents {
  const first = new Int32Array(rect.width).fill(-1);
  const last = new Int32Array(rect.width).fill(-1);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      if (labels[y * rect.width + x] !== trace) continue;
      if (first[x] === -1) first[x] = y;
      last[x] = y;
    }
  }
  return { first, last };
}

export type ComparisonRule = "two-directional" | "one-directional";

export interface ExtentComparison {
  readonly columnsConsidered: number;
  readonly agreeFraction: number;
  /** Fraction of considered columns the rule counts as missing. */
  readonly missingFraction: number;
  readonly pass: boolean;
}

/**
 * Compares Canvas2D's extents (`reference`) with WebGL2's (`candidate`).
 *
 * Two-directional: over the columns where either engine has ink, the first and last rows must agree
 * within `K_ROWS` on at least `P_COLUMNS` of them, and columns where only one engine has ink may be
 * at most `P_MISSING`.
 *
 * One-directional, for a trace Canvas2D decimates (WebGL2 draws every sample, so its extent is a
 * superset) or dashes (WebGL2 draws solid): over the columns where Canvas2D has ink, its extent must
 * lie inside WebGL2's expanded by `K_ROWS`. Only Canvas2D-only columns count as missing; ink that
 * only WebGL2 has is expected.
 */
export function compareExtents(
  reference: ColumnExtents,
  candidate: ColumnExtents,
  rule: ComparisonRule,
  kRows: number = K_ROWS,
): ExtentComparison {
  let considered = 0;
  let agree = 0;
  let missing = 0;
  for (let x = 0; x < reference.first.length; x += 1) {
    const refFirst = reference.first[x] ?? -1;
    const refLast = reference.last[x] ?? -1;
    const candFirst = candidate.first[x] ?? -1;
    const candLast = candidate.last[x] ?? -1;
    const refInk = refFirst !== -1;
    const candInk = candFirst !== -1;
    if (rule === "two-directional") {
      if (!refInk && !candInk) continue;
      considered += 1;
      if (refInk !== candInk) {
        missing += 1;
        continue;
      }
      if (Math.abs(refFirst - candFirst) <= kRows && Math.abs(refLast - candLast) <= kRows) agree += 1;
    } else {
      if (!refInk) continue;
      considered += 1;
      if (!candInk) {
        missing += 1;
        continue;
      }
      if (candFirst - kRows <= refFirst && refLast <= candLast + kRows) agree += 1;
    }
  }
  const agreeFraction = considered === 0 ? 1 : agree / considered;
  const missingFraction = considered === 0 ? 0 : missing / considered;
  return {
    columnsConsidered: considered,
    agreeFraction,
    missingFraction,
    pass: agreeFraction >= P_COLUMNS && missingFraction <= P_MISSING,
  };
}

export interface ColumnRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Columns with ink inside a NaN run's projected range after shrinking it by `shrink` on both ends
 * (a stroke's width plus a pixel of anti-aliasing legitimately bleeds into the run's edges).
 */
export function gapViolations(
  extents: ColumnExtents,
  runs: readonly ColumnRange[],
  shrink: number,
): number {
  let violations = 0;
  for (const run of runs) {
    for (let x = run.from + shrink; x <= run.to - shrink; x += 1) {
      if ((extents.first[x] ?? -1) !== -1) violations += 1;
    }
  }
  return violations;
}

/** Whether any pixel of the 3x3 neighbourhood centred on `(cx, cy)` (rect-local) carries ink. */
export function hasInkAround(labels: Int8Array, rect: Rect, cx: number, cy: number, trace: number): boolean {
  for (let y = Math.max(0, cy - 1); y <= Math.min(rect.height - 1, cy + 1); y += 1) {
    for (let x = Math.max(0, cx - 1); x <= Math.min(rect.width - 1, cx + 1); x += 1) {
      if (labels[y * rect.width + x] === trace) return true;
    }
  }
  return false;
}

/** Pixels that differ between two images outside `rect` grown by `margin` on every side. */
export function outsideRectDifferences(a: Pixels, b: Pixels, rect: Rect, margin: number): number {
  const left = rect.left - margin;
  const top = rect.top - margin;
  const right = rect.left + rect.width + margin;
  const bottom = rect.top + rect.height + margin;
  let differing = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (x >= left && x < right && y >= top && y < bottom) continue;
      const offset = (y * a.width + x) * 4;
      if (
        a.data[offset] !== b.data[offset] ||
        a.data[offset + 1] !== b.data[offset + 1] ||
        a.data[offset + 2] !== b.data[offset + 2]
      ) {
        differing += 1;
      }
    }
  }
  return differing;
}

/**
 * Pixels outside the plot rectangle grown by `margin` on every side that lie outside every rect of
 * `masks` and whose max-channel distance from some colour of `traceColors` is at most `inkDelta`.
 *
 * The plot edges are rounded outward (the layout's edges may be fractional), so a pixel the stroke
 * of a correctly clipped trace could touch is never counted. Masks are the tick-label ink boxes,
 * the only content outside the plot that can be anti-aliased into a colour near a trace's.
 */
export function outOfPlotTraceInk(
  pixels: Pixels,
  plot: PlotGeometry,
  margin: number,
  traceColors: readonly Rgb[],
  masks: readonly Rect[],
  inkDelta: number,
): number {
  const left = Math.floor(plot.plotLeft) - margin;
  const top = Math.floor(plot.plotTop) - margin;
  const right = Math.ceil(plot.plotLeft + plot.plotWidth) + margin;
  const bottom = Math.ceil(plot.plotTop + plot.plotHeight) + margin;
  let count = 0;
  for (let y = 0; y < pixels.height; y += 1) {
    const insideRows = y >= top && y < bottom;
    for (let x = 0; x < pixels.width; x += 1) {
      if (insideRows && x >= left && x < right) continue;
      if (isMasked(masks, x, y)) continue;
      const offset = (y * pixels.width + x) * 4;
      for (const color of traceColors) {
        if (channelDistance(pixels.data, offset, color) <= inkDelta) {
          count += 1;
          break;
        }
      }
    }
  }
  return count;
}

function isMasked(masks: readonly Rect[], x: number, y: number): boolean {
  for (const mask of masks) {
    if (x >= mask.left && x < mask.left + mask.width && y >= mask.top && y < mask.top + mask.height) {
      return true;
    }
  }
  return false;
}

/**
 * Pixels of `rect` whose max-channel distance from some colour of `traceColors` is at most
 * `inkDelta`. Unlike `inkLabels`, which attributes every pixel that is not background or grid to
 * its nearest trace colour, this counts only pixels that really are (nearly) that colour: an axis
 * line, a half-covered stroke edge or a label fringe is not trace ink.
 */
export function traceInkInRect(
  pixels: Pixels,
  rect: Rect,
  traceColors: readonly Rgb[],
  inkDelta: number,
): number {
  let count = 0;
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const offset = (y * pixels.width + x) * 4;
      for (const color of traceColors) {
        if (channelDistance(pixels.data, offset, color) <= inkDelta) {
          count += 1;
          break;
        }
      }
    }
  }
  return count;
}
