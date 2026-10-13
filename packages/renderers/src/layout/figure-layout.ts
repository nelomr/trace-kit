/**
 * Backend-neutral figure layout: plot-area insets, one `ViewportTransform` per registered Y axis,
 * tick values, formatted labels, gridline positions and stacked axis-column offsets. Both the
 * Canvas2D renderer and the SVG exporter read this one record, so insets, ticks and label strings
 * cannot drift between backends.
 *
 * The record is allocated once (`createFigureLayout`) and updated in place. Geometry
 * (`updateFigureGeometry`) runs on resize / domain changes and allocates only the frozen
 * transform objects core returns; ticks (`refreshFigureTicks`) write into preallocated buffers
 * and reformat strings only when the tick key changes, so a repeat call at an unchanged key is
 * allocation-free.
 */
import {
  createAxisTransforms,
  projectX,
  projectY,
  selectLogTicks,
  selectTicks,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { AxisLayout, FigureStyle } from "../style.js";
import { formatTickLabel } from "./tick-label.js";

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
export function extractFontSizeCss(font: string): number {
  const match = FONT_SIZE_PATTERN.exec(font);
  if (match === null) return 10;
  const size = Number.parseFloat(match[1] ?? "10");
  return Number.isFinite(size) && size > 0 ? size : 10;
}

/**
 * Rewrites the leading `<n>px` size of a CSS font shorthand to `n * dpr` px. A raster context is
 * addressed in device pixels, so a CSS-px font drawn unscaled renders at `1/dpr` of the size the
 * insets were reserved for. A shorthand with no px size is returned unchanged.
 */
export function scaleFontSize(font: string, dpr: number): string {
  const match = FONT_SIZE_PATTERN.exec(font);
  if (match === null) return font;
  const size = Number.parseFloat(match[1] ?? "10") * dpr;
  return `${font.slice(0, match.index)}${size}px${font.slice(match.index + match[0].length)}`;
}

/** Width of one left-stacked Y axis column: tick length, label gutter and one label height. */
export function axisGutterCss(style: FigureStyle, axes: AxisLayout): number {
  return axes.tickLength + axes.labelGutter + extractFontSizeCss(style.font);
}

/**
 * Pure function of `style`/`axes` configuration only (font size, tick length, label gutter,
 * per-axis visibility, and the number of registered left Y axes) — never of data. `insetLeft`
 * grows linearly with `yAxisCount` because each left-stacked axis reserves its own tick+label
 * gutter; it stays a single already-summed number so every one of the N `ViewportTransform`
 * instances built from it shares byte-identical plot geometry — per-axis gutter width lives only
 * here, never in `@trace-kit/core`.
 */
export function computeAxisInsets(
  style: FigureStyle,
  axes: AxisLayout,
  yAxisCount: number,
): AxisInsets {
  const perAxisGutter = axisGutterCss(style, axes);
  const insetBottom = axes.showBottomAxis ? perAxisGutter : 0;
  const insetLeft = axes.showLeftAxis ? yAxisCount * perAxisGutter : 0;
  return {
    insetLeft,
    insetRight: 0,
    insetTop: 0,
    insetBottom,
  };
}

/**
 * Clamps the configured insets against the CSS size: a viewport too small to hold the gutters
 * degrades to a reduced (never negative, never throwing) plot area instead. Each inset may take
 * at most what the previous one left over, minus one CSS pixel that keeps the plot area strictly
 * positive, which is what `createViewportTransform` requires.
 */
export function clampInsetsToViewport(
  raw: AxisInsets,
  cssWidth: number,
  cssHeight: number,
): AxisInsets {
  const maxHorizontal = Math.max(0, cssWidth - 1);
  const maxVertical = Math.max(0, cssHeight - 1);
  const insetLeft = Math.min(raw.insetLeft, maxHorizontal);
  const insetRight = Math.min(raw.insetRight, Math.max(0, maxHorizontal - insetLeft));
  const insetTop = Math.min(raw.insetTop, maxVertical);
  const insetBottom = Math.min(raw.insetBottom, Math.max(0, maxVertical - insetTop));
  return { insetLeft, insetRight, insetTop, insetBottom };
}

/**
 * Selects Y tick values for one axis's transform, dispatching to core's `selectLogTicks` for a
 * log transform and `selectTicks` otherwise.
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

export interface FigureLayoutInput {
  /** Finite and `> 0`; the caller sanitizes. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** `> 0`. The SVG exporter passes 1 so every coordinate is in CSS pixels. */
  readonly dpr: number;
  readonly style: FigureStyle;
  readonly axes: AxisLayout;
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly xOrigin: number;
  /** Length must equal the `yAxisCount` the layout was created with. */
  readonly yAxes: readonly YAxisRegistration[];
}

export interface FigureLayout {
  readonly yAxisCount: number;
  dpr: number;
  /** `computeAxisInsets` output, CSS px. */
  rawInsets: AxisInsets;
  /** `clampInsetsToViewport` output, CSS px; what the transforms were built from. */
  insets: AxisInsets;
  /** True when the unclamped insets do not fit the viewport. */
  degenerate: boolean;
  /** One per axis, all sharing plot geometry. */
  readonly transforms: ViewportTransform[];
  readonly xTicks: Float64Array;
  xTickCount: number;
  readonly xLabels: string[];
  /** `projectX` of each X tick through the first transform, device px. */
  readonly xGridPositions: Float64Array;
  readonly yTicks: Float64Array[];
  readonly yTickCounts: Int32Array;
  readonly yLabels: string[][];
  /** `projectY` of each tick through its own axis transform, device px. */
  readonly yGridPositions: Float64Array[];
  /** Device-px distance of axis `i`'s line left of `plotLeft`: `i * axisGutterCss * dpr`. */
  readonly axisColumnOffsets: Float64Array;
  /** Bumped only when tick values or axis units change. */
  tickRevision: number;

  /* Staleness key of the current ticks, and the tick-selection inputs captured at geometry time. */
  targetTickCount: number;
  xDomainMin: number;
  xDomainMax: number;
  keyXMin: number;
  keyXMax: number;
  keyXUnit: string;
  keyYUnit: string;
  readonly keyYMin: Float64Array;
  readonly keyYMax: Float64Array;
  /** Set by geometry updates: gridline positions depend on the projection, not only the ticks. */
  positionsDirty: boolean;
}

const ZERO_INSETS: AxisInsets = Object.freeze({
  insetLeft: 0,
  insetRight: 0,
  insetTop: 0,
  insetBottom: 0,
});

/** Allocates every buffer once; nothing here is reallocated for the layout's lifetime. */
export function createFigureLayout(yAxisCount: number): FigureLayout {
  return {
    yAxisCount,
    dpr: 1,
    rawInsets: ZERO_INSETS,
    insets: ZERO_INSETS,
    degenerate: false,
    transforms: [],
    xTicks: new Float64Array(MAX_TICKS),
    xTickCount: 0,
    xLabels: new Array<string>(MAX_TICKS).fill(""),
    xGridPositions: new Float64Array(MAX_TICKS),
    yTicks: Array.from({ length: yAxisCount }, () => new Float64Array(MAX_TICKS)),
    yTickCounts: new Int32Array(yAxisCount),
    yLabels: Array.from({ length: yAxisCount }, () => new Array<string>(MAX_TICKS).fill("")),
    yGridPositions: Array.from({ length: yAxisCount }, () => new Float64Array(MAX_TICKS)),
    axisColumnOffsets: new Float64Array(yAxisCount),
    tickRevision: -1,
    targetTickCount: 6,
    xDomainMin: 0,
    xDomainMax: 1,
    keyXMin: NaN,
    keyXMax: NaN,
    keyXUnit: "",
    keyYUnit: "",
    keyYMin: new Float64Array(yAxisCount).fill(NaN),
    keyYMax: new Float64Array(yAxisCount).fill(NaN),
    positionsDirty: true,
  };
}

/**
 * Recomputes insets, the per-axis transforms and the column offsets. Runs on resize, domain and
 * axis-registration changes — never per frame.
 */
export function updateFigureGeometry(layout: FigureLayout, input: FigureLayoutInput): void {
  const raw = computeAxisInsets(input.style, input.axes, layout.yAxisCount);
  const clamped = clampInsetsToViewport(raw, input.cssWidth, input.cssHeight);
  layout.dpr = input.dpr;
  layout.rawInsets = raw;
  layout.insets = clamped;
  layout.degenerate =
    raw.insetLeft + raw.insetRight >= input.cssWidth ||
    raw.insetTop + raw.insetBottom >= input.cssHeight;
  layout.targetTickCount = input.axes.targetTickCount;
  layout.xDomainMin = input.xDomainMin;
  layout.xDomainMax = input.xDomainMax;

  createAxisTransforms(
    {
      cssWidth: input.cssWidth,
      cssHeight: input.cssHeight,
      dpr: input.dpr,
      insetLeft: clamped.insetLeft,
      insetRight: clamped.insetRight,
      insetTop: clamped.insetTop,
      insetBottom: clamped.insetBottom,
      xDomainMin: input.xDomainMin,
      xDomainMax: input.xDomainMax,
      xOrigin: input.xOrigin,
    },
    input.yAxes,
    layout.transforms,
  );

  const gutterDevice = axisGutterCss(input.style, input.axes) * input.dpr;
  for (let i = 0; i < layout.yAxisCount; i += 1) {
    layout.axisColumnOffsets[i] = i * gutterDevice;
  }
  layout.positionsDirty = true;
}

/**
 * Selects ticks, formats labels and projects gridline positions, reformatting only when the tick
 * key (X domain, every axis's Y domain, the two unit strings) changed. Returns `true` exactly when
 * ticks and labels were recomputed (and `tickRevision` bumped); gridline positions are refreshed
 * whenever the geometry changed too, because a resize moves them without changing any tick.
 */
export function refreshFigureTicks(layout: FigureLayout, xUnit: string, yUnit: string): boolean {
  let stale =
    layout.keyXMin !== layout.xDomainMin ||
    layout.keyXMax !== layout.xDomainMax ||
    layout.keyXUnit !== xUnit ||
    layout.keyYUnit !== yUnit;
  for (let axis = 0; axis < layout.transforms.length && !stale; axis += 1) {
    const t = layout.transforms[axis];
    if (t === undefined) continue;
    if (layout.keyYMin[axis] !== t.yDomainMin || layout.keyYMax[axis] !== t.yDomainMax) {
      stale = true;
    }
  }

  if (stale) {
    layout.xTickCount = selectTicks(
      layout.xDomainMin,
      layout.xDomainMax,
      layout.targetTickCount,
      layout.xTicks,
      0,
    );
    for (let i = 0; i < layout.xTickCount; i += 1) {
      layout.xLabels[i] = formatTickLabel(layout.xTicks[i] ?? 0, xUnit);
    }
    for (let axis = 0; axis < layout.transforms.length; axis += 1) {
      const t = layout.transforms[axis];
      const ticks = layout.yTicks[axis];
      const labels = layout.yLabels[axis];
      if (t === undefined || ticks === undefined || labels === undefined) continue;
      const count = selectYTicks(t, layout.targetTickCount, ticks, 0);
      layout.yTickCounts[axis] = count;
      for (let i = 0; i < count; i += 1) {
        labels[i] = formatTickLabel(ticks[i] ?? 0, yUnit);
      }
      layout.keyYMin[axis] = t.yDomainMin;
      layout.keyYMax[axis] = t.yDomainMax;
    }
    layout.keyXMin = layout.xDomainMin;
    layout.keyXMax = layout.xDomainMax;
    layout.keyXUnit = xUnit;
    layout.keyYUnit = yUnit;
    layout.tickRevision += 1;
  }

  if (stale || layout.positionsDirty) {
    projectGridPositions(layout);
    layout.positionsDirty = false;
  }
  return stale;
}

function projectGridPositions(layout: FigureLayout): void {
  const first = layout.transforms[0];
  if (first !== undefined) {
    for (let i = 0; i < layout.xTickCount; i += 1) {
      layout.xGridPositions[i] = projectX(first, layout.xTicks[i] ?? 0);
    }
  }
  for (let axis = 0; axis < layout.transforms.length; axis += 1) {
    const t = layout.transforms[axis];
    const ticks = layout.yTicks[axis];
    const positions = layout.yGridPositions[axis];
    if (t === undefined || ticks === undefined || positions === undefined) continue;
    const count = layout.yTickCounts[axis] ?? 0;
    for (let i = 0; i < count; i += 1) {
      positions[i] = projectY(t, ticks[i] ?? 0);
    }
  }
}
