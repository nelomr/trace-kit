import {
  AXIS_SIDE_LEFT,
  resolveTraceAxisIndices,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
  type YAxisRegistration,
} from "@trace-kit/core";
import { resolveTraceStyle, type ResolvedTraceStyle } from "../rules/trace-style.js";
import {
  DEFAULT_AXIS_LAYOUT,
  DEFAULT_FIGURE_STYLE,
  type AxisLayout,
  type FigureStyle,
} from "../style.js";
import type { SvgScene } from "./scene.js";

export interface NormalizedTrace {
  readonly payload: SpectrumDataPayload;
  readonly style: ResolvedTraceStyle;
  /** Index into `NormalizedScene.yAxes`; always a usable axis. */
  readonly axisIndex: number;
}

/** A scene every consumer can read without a further validity check: finite sizes and domains,
 * non-empty axis list, and only traces that resolve to a usable axis. */
export interface NormalizedScene {
  readonly width: number;
  readonly height: number;
  readonly style: FigureStyle;
  readonly axes: AxisLayout;
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly xOrigin: number;
  /** Safe to hand to the viewport transform: an unusable registration is replaced by a neutral
   * linear axis, so its gutter is still reserved and the inset arithmetic stays stable. */
  readonly yAxes: readonly YAxisRegistration[];
  /** Parallel to `yAxes`; an unusable axis gets no ticks, gridlines or traces in the output. */
  readonly axisUsable: readonly boolean[];
  readonly traces: readonly NormalizedTrace[];
  readonly xUnit: string;
  readonly yUnit: string;
}

const DEFAULT_X_DOMAIN_MIN = 0;
const DEFAULT_X_DOMAIN_MAX = 1;
const DEFAULT_Y_DOMAIN_MIN = -1;
const DEFAULT_Y_DOMAIN_MAX = 1;

function positiveFiniteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function isUsableAxis(axis: YAxisRegistration): boolean {
  if (!Number.isFinite(axis.domainMin) || !Number.isFinite(axis.domainMax)) return false;
  if (axis.domainMin > axis.domainMax) return false;
  if (axis.scaleKind === Y_SCALE_KIND_LOG) return axis.domainMin > 0;
  return axis.scaleKind === Y_SCALE_KIND_LINEAR;
}

/** Replaces any number that would make the layout or a transform throw, so the exporter's
 * never-throw contract holds for hostile style values as well as hostile data. */
function sanitizeStyle(style: FigureStyle): FigureStyle {
  return {
    ...style,
    lineWidthCss: nonNegativeOr(style.lineWidthCss, DEFAULT_FIGURE_STYLE.lineWidthCss),
  };
}

function sanitizeAxes(axes: AxisLayout): AxisLayout {
  return {
    ...axes,
    tickLength: nonNegativeOr(axes.tickLength, DEFAULT_AXIS_LAYOUT.tickLength),
    labelGutter: nonNegativeOr(axes.labelGutter, DEFAULT_AXIS_LAYOUT.labelGutter),
    targetTickCount: Number.isFinite(axes.targetTickCount) && axes.targetTickCount >= 1
      ? axes.targetTickCount
      : DEFAULT_AXIS_LAYOUT.targetTickCount,
    axisLineWidthCss: nonNegativeOr(axes.axisLineWidthCss, DEFAULT_AXIS_LAYOUT.axisLineWidthCss),
  };
}

export function normalizeScene(scene: SvgScene): NormalizedScene {
  const style = sanitizeStyle({ ...DEFAULT_FIGURE_STYLE, ...scene.style });
  const axes = sanitizeAxes({ ...DEFAULT_AXIS_LAYOUT, ...scene.axes });

  const domain = scene.domain;
  const xValid =
    Number.isFinite(domain.xMin) && Number.isFinite(domain.xMax) && domain.xMin <= domain.xMax;
  const xDomainMin = xValid ? domain.xMin : DEFAULT_X_DOMAIN_MIN;
  const xDomainMax = xValid ? domain.xMax : DEFAULT_X_DOMAIN_MAX;

  const implicitAxis: YAxisRegistration = {
    id: "y",
    scaleKind: Y_SCALE_KIND_LINEAR,
    domainMin: domain.yMin,
    domainMax: domain.yMax,
    side: AXIS_SIDE_LEFT,
  };
  const registered = scene.yAxes !== undefined && scene.yAxes.length > 0 ? scene.yAxes : [implicitAxis];
  const axisUsable = registered.map(isUsableAxis);
  const yAxes = registered.map((axis, i) =>
    axisUsable[i] === true
      ? axis
      : {
          id: axis.id,
          scaleKind: Y_SCALE_KIND_LINEAR,
          domainMin: DEFAULT_Y_DOMAIN_MIN,
          domainMax: DEFAULT_Y_DOMAIN_MAX,
          side: axis.side,
        },
  );

  const source = scene.traces;
  const traces: NormalizedTrace[] = [];
  let xOrigin = 0;
  let xUnit = "";
  let yUnit = "";

  if ("entries" in source) {
    const axisIndices = new Int32Array(source.entries.length);
    resolveTraceAxisIndices(source, yAxes, axisIndices);
    for (let i = 0; i < source.entries.length; i += 1) {
      const entry = source.entries[i];
      const axisIndex = axisIndices[i] ?? -1;
      if (entry === undefined || axisIndex < 0 || axisUsable[axisIndex] !== true) continue;
      traces.push({
        payload: entry.payload,
        style: resolveTraceStyle(entry.style, i, style),
        axisIndex,
      });
    }
  } else {
    // A bare payload is a one-trace collection on the first axis, coloured by `traceColor`; its
    // origin and units drive the shared X axis exactly as in the single-payload renderer path.
    xOrigin = finiteOr(source.xOrigin, 0);
    xUnit = source.xUnit;
    yUnit = source.yUnit;
    if (axisUsable[0] === true) {
      traces.push({
        payload: source,
        style: resolveTraceStyle({ color: style.traceColor }, 0, style),
        axisIndex: 0,
      });
    }
  }

  return {
    width: positiveFiniteOrZero(scene.width),
    height: positiveFiniteOrZero(scene.height),
    style,
    axes,
    xDomainMin,
    xDomainMax,
    xOrigin,
    yAxes,
    axisUsable,
    traces,
    xUnit,
    yUnit,
  };
}
