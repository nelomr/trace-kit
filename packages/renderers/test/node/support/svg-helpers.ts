import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  Y_SCALE_KIND_LINEAR,
  type SpectrumDataPayload,
  type TraceStyle,
  type YAxisRegistration,
} from "@trace-kit/core";
import {
  createFigureLayout,
  refreshFigureTicks,
  updateFigureGeometry,
  type FigureLayout,
} from "../../../src/layout/figure-layout.js";
import { DEFAULT_AXIS_LAYOUT, DEFAULT_FIGURE_STYLE } from "../../../src/style.js";
import type { SvgScene } from "../../../src/svg/scene.js";

export function payloadOf(
  y: readonly number[],
  options: { xUnit?: string; yUnit?: string; xOrigin?: number } = {},
): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: Math.max(1, y.length),
    xOrigin: options.xOrigin ?? 0,
    xUnit: options.xUnit ?? "nm",
    yUnit: options.yUnit ?? "dBm",
  });
  for (let i = 0; i < y.length; i += 1) {
    payload.x[i] = i;
    payload.y[i] = y[i] ?? NaN;
  }
  commitPayloadRevision(payload, y.length);
  return payload;
}

export function linearAxis(id: string, min: number, max: number): YAxisRegistration {
  return { id, scaleKind: Y_SCALE_KIND_LINEAR, domainMin: min, domainMax: max, side: AXIS_SIDE_LEFT };
}

export function payloadScene(y: readonly number[], overrides: Partial<SvgScene> = {}): SvgScene {
  return {
    traces: payloadOf(y),
    domain: { xMin: 0, xMax: Math.max(1, y.length - 1), yMin: 0, yMax: 10 },
    width: 800,
    height: 400,
    ...overrides,
  };
}

export function collectionScene(
  entries: readonly { id: string; y: readonly number[]; yAxisId: string; style?: TraceStyle }[],
  axes: readonly YAxisRegistration[],
  overrides: Partial<SvgScene> = {},
): SvgScene {
  const collection = createTraceCollection(
    entries.map((e) => ({
      id: e.id,
      payload: payloadOf(e.y),
      yAxisId: e.yAxisId,
      style: e.style ?? {},
    })),
    axes,
    0,
    9,
  );
  return {
    traces: collection,
    domain: { xMin: 0, xMax: 9, yMin: 0, yMax: 10 },
    yAxes: axes,
    width: 800,
    height: 400,
    ...overrides,
  };
}

/** The layout the exporter builds for `scene` at `dpr = 1`, rebuilt independently so tests can
 * compare emitted coordinates to the shared projection. */
export function layoutFor(scene: SvgScene, xUnit = "", yUnit = ""): FigureLayout {
  const axes = scene.yAxes ?? [linearAxis("y", scene.domain.yMin, scene.domain.yMax)];
  const layout = createFigureLayout(axes.length);
  updateFigureGeometry(layout, {
    cssWidth: scene.width,
    cssHeight: scene.height,
    dpr: 1,
    style: { ...DEFAULT_FIGURE_STYLE, ...scene.style },
    axes: { ...DEFAULT_AXIS_LAYOUT, ...scene.axes },
    xDomainMin: scene.domain.xMin,
    xDomainMax: scene.domain.xMax,
    xOrigin: 0,
    yAxes: axes,
  });
  refreshFigureTicks(layout, xUnit, yUnit);
  return layout;
}

export function paths(svg: string): { d: string; attrs: string }[] {
  return [...svg.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)].map((m) => ({
    d: m[1] ?? "",
    attrs: m[2] ?? "",
  }));
}

/** The body of the first `<g ...>` whose opening tag contains `marker`. */
export function groupBody(svg: string, marker: string): string {
  const start = svg.indexOf(`<g ${marker}`);
  if (start < 0) return "";
  const open = svg.indexOf(">", start);
  const close = svg.indexOf("</g>", open);
  return svg.slice(open + 1, close);
}

export function pointCount(d: string): number {
  return (d.match(/[ML]/g) ?? []).length;
}

export function attr(element: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1];
}

export function elements(markup: string, tag: string): string[] {
  return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[^<]*</${tag}>)`, "g"))].map((m) => m[0]);
}
