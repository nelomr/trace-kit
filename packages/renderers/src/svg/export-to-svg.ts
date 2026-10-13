import {
  allocateIndexBuffer,
  createViewportTransform,
  type SpectrumDataPayload,
  type ViewportTransform,
} from "@trace-kit/core";
import {
  createFigureLayout,
  extractFontSizeCss,
  refreshFigureTicks,
  updateFigureGeometry,
  type FigureLayout,
} from "../layout/figure-layout.js";
import { buildTracePath } from "../path/build-trace-path.js";
import {
  buildIsolatedMarkers,
  countIsolatedSegments,
  isolatedMarkerHalfSide,
} from "../path/isolated-markers.js";
import { decimateTraceIndices, deriveDecimationTarget } from "../rules/decimation.js";
import { normalizeScene, type NormalizedScene, type NormalizedTrace } from "./normalize-scene.js";
import { escapeXml } from "./escape-xml.js";
import type { SvgEmbeddedFont, SvgExportOptions, SvgScene } from "./scene.js";
import { SvgMarkerSink, SvgPathSink } from "./svg-sinks.js";
import { formatSvgNumber } from "./svg-number.js";
import { SvgWriter } from "./svg-writer.js";

const DEFAULT_ID_PREFIX = "tracekit";
const ID_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The family the shared layout and Canvas2D default to, followed by a generic fallback so a
 * viewer without the face still renders legible labels. Declared here, not imported from the
 * font module, so this entry never reaches the embedded font data. */
const LABEL_FONT_FAMILY = "TraceKit Inter";
const LABEL_FONT_STACK = `${LABEL_FONT_FAMILY}, sans-serif`;

/** A `data:` URI free of every character that could end the CSS `url(...)`, the style element or
 * the XML text node early. Base64 and percent-encoded payloads satisfy it; anything else is
 * ignored rather than escaped, because a font that needed escaping is not a font. */
const SAFE_DATA_URL = /^data:[^\s"'()<>\\&]*$/;

function resolveIdPrefix(prefix: string | undefined): string {
  return prefix !== undefined && ID_PREFIX_PATTERN.test(prefix) ? prefix : DEFAULT_ID_PREFIX;
}

function usableFont(font: SvgEmbeddedFont | undefined): SvgEmbeddedFont | null {
  if (font === undefined || font.format !== "woff2") return null;
  return SAFE_DATA_URL.test(font.dataUrl) ? font : null;
}

/**
 * Exports one figure as a standalone SVG document. Pure and synchronous: it reads the scene's
 * buffers in place, holds no state between calls and never throws for degenerate input (those
 * produce a minimal, valid document instead). Layout, tick selection, label text, decimation
 * budget, trace style and the isolated-sample rule all come from the modules Canvas2D uses, at
 * `dpr = 1`, so one CSS pixel is one SVG user unit.
 */
export function exportToSvg(scene: SvgScene, options?: SvgExportOptions): string {
  const idPrefix = resolveIdPrefix(options?.idPrefix);
  const normalized = normalizeScene(scene);
  const writer = new SvgWriter();
  const { width, height } = normalized;
  const w = formatSvgNumber(width);
  const h = formatSvgNumber(height);

  writer.raw(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);

  const layout = createFigureLayout(normalized.yAxes.length);
  let degenerate = width <= 0 || height <= 0;
  if (!degenerate) {
    updateFigureGeometry(layout, {
      cssWidth: width,
      cssHeight: height,
      dpr: 1,
      style: normalized.style,
      axes: normalized.axes,
      xDomainMin: normalized.xDomainMin,
      xDomainMax: normalized.xDomainMax,
      xOrigin: normalized.xOrigin,
      yAxes: normalized.yAxes,
    });
    degenerate = layout.degenerate;
  }
  const primary = degenerate ? undefined : layout.transforms[0];

  writeDefs(writer, idPrefix, primary, usableFont(options?.embedFont));
  writer.rect(0, 0, width, height, normalized.style.backgroundColor);

  if (primary !== undefined) {
    refreshFigureTicks(layout, normalized.xUnit, normalized.yUnit);
    writeGridlines(writer, normalized, layout, primary);
    writeTraces(writer, normalized, layout, idPrefix, options?.decimationTarget);
    writeAxes(writer, normalized, layout, primary);
    writeLabels(writer, normalized, layout, primary);
  }

  writer.raw("</svg>");
  return writer.toString();
}

function writeDefs(
  writer: SvgWriter,
  idPrefix: string,
  plot: ViewportTransform | undefined,
  font: SvgEmbeddedFont | null,
): void {
  writer.raw("<defs>");
  if (font !== null) {
    writer.raw(
      `<style>@font-face{font-family:"${LABEL_FONT_FAMILY}";src:url(${font.dataUrl}) format("woff2");}</style>`,
    );
  }
  const x = plot?.plotLeft ?? 0;
  const y = plot?.plotTop ?? 0;
  const clipWidth = plot?.plotWidth ?? 0;
  const clipHeight = plot?.plotHeight ?? 0;
  writer.raw(
    `<clipPath id="${idPrefix}-plot-clip"><rect x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" width="${formatSvgNumber(clipWidth)}" height="${formatSvgNumber(clipHeight)}"/></clipPath>`,
  );
  writer.raw("</defs>");
}

function writeGridlines(
  writer: SvgWriter,
  scene: NormalizedScene,
  layout: FigureLayout,
  plot: ViewportTransform,
): void {
  writer.raw(`<g stroke="${escapeXml(scene.style.gridColor)}" stroke-width="1" fill="none">`);
  const plotBottom = plot.plotTop + plot.plotHeight;
  for (let i = 0; i < layout.xTickCount; i += 1) {
    const x = layout.xGridPositions[i] ?? 0;
    writer.line(x, plot.plotTop, x, plotBottom);
  }
  const plotRight = plot.plotLeft + plot.plotWidth;
  for (let axis = 0; axis < layout.yAxisCount; axis += 1) {
    if (scene.axisUsable[axis] !== true) continue;
    const positions = layout.yGridPositions[axis];
    const count = layout.yTickCounts[axis] ?? 0;
    if (positions === undefined) continue;
    for (let i = 0; i < count; i += 1) {
      const y = positions[i] ?? 0;
      writer.line(plot.plotLeft, y, plotRight, y);
    }
  }
  writer.raw("</g>");
}

function writeTraces(
  writer: SvgWriter,
  scene: NormalizedScene,
  layout: FigureLayout,
  idPrefix: string,
  decimationTarget: number | undefined,
): void {
  writer.raw(`<g clip-path="url(#${idPrefix}-plot-clip)">`);
  const insets = layout.insets;
  for (let i = 0; i < scene.traces.length; i += 1) {
    const trace = scene.traces[i];
    if (trace === undefined || trace.payload.sampleCount === 0) continue;
    const axis = scene.yAxes[trace.axisIndex];
    if (axis === undefined) continue;
    // One transform per trace: payloads sharing an X domain may still be sampled from different
    // absolute origins, so sharing the layout's transform would misplace all but the first.
    const transform = createViewportTransform({
      cssWidth: scene.width,
      cssHeight: scene.height,
      dpr: 1,
      insetLeft: insets.insetLeft,
      insetRight: insets.insetRight,
      insetTop: insets.insetTop,
      insetBottom: insets.insetBottom,
      xDomainMin: scene.xDomainMin,
      xDomainMax: scene.xDomainMax,
      xOrigin: Number.isFinite(trace.payload.xOrigin) ? trace.payload.xOrigin : 0,
      yDomainMin: axis.domainMin,
      yDomainMax: axis.domainMax,
      yScaleKind: axis.scaleKind,
    });
    writeTrace(writer, trace, transform, decimationTarget);
  }
  writer.raw("</g>");
}

function resolveTarget(
  sampleCount: number,
  plotWidth: number,
  decimationTarget: number | undefined,
): number {
  if (decimationTarget !== undefined && Number.isFinite(decimationTarget) && decimationTarget >= 2) {
    return Math.min(sampleCount, Math.floor(decimationTarget));
  }
  return deriveDecimationTarget(sampleCount, plotWidth);
}

function writeTrace(
  writer: SvgWriter,
  trace: NormalizedTrace,
  t: ViewportTransform,
  decimationTarget: number | undefined,
): void {
  const payload: SpectrumDataPayload = trace.payload;
  const sampleCount = payload.sampleCount;
  const target = resolveTarget(sampleCount, t.plotWidth, decimationTarget);

  // At or below the target the raw samples are walked directly: decimating would only discard
  // information the vector output can afford to keep.
  const indices = allocateIndexBuffer(sampleCount <= target ? 2 : target);
  const decimatedCount =
    sampleCount <= target
      ? 0
      : decimateTraceIndices("lttb", target, payload.x, payload.y, sampleCount, indices);

  const pathSink = new SvgPathSink();
  buildTracePath(pathSink, t, payload.x, payload.y, indices, decimatedCount, sampleCount);

  const { color, lineWidthCss, dashCss } = trace.style;
  if (pathSink.hasSegment) {
    const dash = dashCss.length === 0 ? "" : ` stroke-dasharray="${dashCss.map(formatSvgNumber).join(" ")}"`;
    writer.raw(
      `<path d="${pathSink.pathData()}" stroke="${escapeXml(color)}" stroke-width="${formatSvgNumber(lineWidthCss)}"${dash} fill="none"/>`,
    );
  }

  if (!trace.style.markIsolatedSamples) return;
  if (countIsolatedSegments(payload.x, payload.y, indices, decimatedCount, sampleCount) === 0) return;
  buildIsolatedMarkers(
    new SvgMarkerSink(writer, color),
    t,
    payload.x,
    payload.y,
    indices,
    decimatedCount,
    sampleCount,
    isolatedMarkerHalfSide(lineWidthCss, t.dpr),
  );
}

function writeAxes(
  writer: SvgWriter,
  scene: NormalizedScene,
  layout: FigureLayout,
  plot: ViewportTransform,
): void {
  writer.raw(
    `<g stroke="${escapeXml(scene.style.axisColor)}" stroke-width="${formatSvgNumber(scene.axes.axisLineWidthCss)}" fill="none">`,
  );
  const tickLength = scene.axes.tickLength;
  if (scene.axes.showBottomAxis) {
    const axisY = plot.plotTop + plot.plotHeight;
    writer.line(plot.plotLeft, axisY, plot.plotLeft + plot.plotWidth, axisY);
    for (let i = 0; i < layout.xTickCount; i += 1) {
      const x = layout.xGridPositions[i] ?? 0;
      writer.line(x, axisY, x, axisY + tickLength);
    }
  }
  if (scene.axes.showLeftAxis) {
    for (let axis = 0; axis < layout.yAxisCount; axis += 1) {
      if (scene.axisUsable[axis] !== true) continue;
      const axisX = plot.plotLeft - (layout.axisColumnOffsets[axis] ?? 0);
      writer.line(axisX, plot.plotTop, axisX, plot.plotTop + plot.plotHeight);
      const positions = layout.yGridPositions[axis];
      const count = layout.yTickCounts[axis] ?? 0;
      if (positions === undefined) continue;
      for (let i = 0; i < count; i += 1) {
        const y = positions[i] ?? 0;
        writer.line(axisX - tickLength, y, axisX, y);
      }
    }
  }
  writer.raw("</g>");
}

function writeLabels(
  writer: SvgWriter,
  scene: NormalizedScene,
  layout: FigureLayout,
  plot: ViewportTransform,
): void {
  writer.raw(
    `<g fill="${escapeXml(scene.style.labelColor)}" stroke="none" font-family="${LABEL_FONT_STACK}" font-size="${formatSvgNumber(extractFontSizeCss(scene.style.font))}">`,
  );
  const tickLength = scene.axes.tickLength;
  if (scene.axes.showBottomAxis) {
    const labelY = plot.plotTop + plot.plotHeight + tickLength;
    for (let i = 0; i < layout.xTickCount; i += 1) {
      writer.text(layout.xLabels[i] ?? "", layout.xGridPositions[i] ?? 0, labelY, "middle", "hanging");
    }
  }
  if (scene.axes.showLeftAxis) {
    for (let axis = 0; axis < layout.yAxisCount; axis += 1) {
      if (scene.axisUsable[axis] !== true) continue;
      const labelX = plot.plotLeft - (layout.axisColumnOffsets[axis] ?? 0) - tickLength;
      const labels = layout.yLabels[axis];
      const positions = layout.yGridPositions[axis];
      const count = layout.yTickCounts[axis] ?? 0;
      if (labels === undefined || positions === undefined) continue;
      for (let i = 0; i < count; i += 1) {
        writer.text(labels[i] ?? "", labelX, positions[i] ?? 0, "end", "middle");
      }
    }
  }
  writer.raw("</g>");
}
