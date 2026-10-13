/**
 * `WebGL2FigureRenderer`: the `FigureRenderer` backend that draws traces on the GPU at full
 * resolution. It draws into three caller-supplied canvases stacked in one CSS box (underlay below,
 * the transparent WebGL2 plot canvas, the transparent overlay above), which reproduces Canvas2D's
 * paint order (background, grid, trace, axes) with no per-frame GL-to-2D copy. Layout, gridlines,
 * axes, labels, style and decimation rules are the shared ones Canvas2D and the SVG exporter use.
 *
 * Known divergences from Canvas2D, all deliberate: a trace style's `dash` is ignored and the line
 * is drawn solid; traces are scissored to the plot rectangle, where Canvas2D does not clip; a
 * +-Infinity Y sample is clamped through a guard band to the plot edge, where Canvas2D bridges the
 * sample. With no decimation selected the full payload is drawn.
 *
 * Construction, `setData`, `setTraces`, `setDomain`, `resize` and `setDecimation` never draw and
 * never touch GL: GPU objects are created on a trace's first upload inside `render()` and the
 * objects of a replaced trace set are deleted at the start of the next `render()`.
 */
import {
  AXIS_SIDE_LEFT,
  resolveTraceAxisIndices,
  Y_SCALE_KIND_LINEAR,
  type DecimationSelection,
  type SpectrumDataPayload,
  type TraceCollection,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import { drawBottomAxis, drawLeftAxis, drawXGridlines, drawYGridlines } from "../canvas2d/axes.js";
import type { FigureRenderer, FigureRendererKind } from "../figure-renderer.js";
import {
  createFigureLayout,
  refreshFigureTicks,
  scaleFontSize,
  updateFigureGeometry,
  type FigureLayout,
} from "../layout/figure-layout.js";
import { buildTraceTransforms } from "../layout/trace-transforms.js";
import { resolveTraceStyle } from "../rules/trace-style.js";
import { acquire2dContext, type TraceDrawingContext } from "../surface.js";
import {
  DEFAULT_AXIS_LAYOUT,
  DEFAULT_FIGURE_STYLE,
  type AxisLayout,
  type FigureStyle,
} from "../style.js";
import { tryParseCssColorInto } from "./color.js";
import { clearGlCanvas, drawGlFrame, FrameState, UNIFORM_ROW_STRIDE } from "./frame.js";
import type { Gl2Context } from "./gl-context.js";
import { createGlPrograms, type GlPrograms } from "./program.js";
import {
  acquireOverlayContext,
  acquireWebGl2Context,
  type OverlayDrawingContext,
  type WebGL2FigureSurfaces,
} from "./surfaces.js";
import { createTraceSlot, releaseTraceSlot, type TraceGpuSlot } from "./trace-slot.js";

export interface WebGL2FigureRendererOptions {
  /** Three distinct canvases the caller has stacked in one CSS box. */
  readonly surfaces: WebGL2FigureSurfaces;
  readonly style?: Partial<FigureStyle>;
  readonly axes?: Partial<AxisLayout>;
  /** Initial decimation selection. `undefined` (the default) is this backend's default: every
   * sample is drawn at full resolution. Other backends define their own default; a caller that
   * selects nothing gets the backend's. */
  readonly decimation?: DecimationSelection;
  /** Explicit left-stacked Y axis registrations; `undefined` keeps one implicit linear axis whose
   * domain follows `setDomain`. */
  readonly yAxes?: readonly YAxisRegistration[];
}

/** Compares three surfaces pairwise. Identical canvases would hand the same backing store to two
 * layers and every layer would erase the one below it. */
function assertDistinctSurfaces(surfaces: WebGL2FigureSurfaces): void {
  const { underlay, plot, overlay } = surfaces;
  if (underlay === plot || underlay === overlay || plot === overlay) {
    throw new TypeError(
      "WebGL2FigureRenderer: underlay, plot and overlay must be three distinct surfaces.",
    );
  }
}

export class WebGL2FigureRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind = "webgl2";

  #disposed = false;
  #surfaces: WebGL2FigureSurfaces | null;
  #underlay: TraceDrawingContext | null;
  #overlay: OverlayDrawingContext | null;
  #gl: Gl2Context | null;
  #programs: GlPrograms | null;
  #frame: FrameState;
  #style: FigureStyle;
  #deviceStyle: FigureStyle;
  #axes: AxisLayout;

  #payload: SpectrumDataPayload | null = null;
  #traceCollection: TraceCollection | null = null;
  #traceCount = 0;
  #tracePayloads: SpectrumDataPayload[] = [];
  #traceAxisIndex: Int32Array = new Int32Array(0);
  #slots: TraceGpuSlot[] = [];
  /** Slots of a replaced trace set, deleted at the start of the next `render()`. */
  #retired: TraceGpuSlot[] = [];

  #cssWidth = 1;
  #cssHeight = 1;
  #dpr = 1;
  #xOrigin = 0;
  #xDomainMin = 0;
  #xDomainMax = 1;
  #yDomainMin = -1;
  #yDomainMax = 1;

  readonly #yAxisRegistrations: readonly YAxisRegistration[] | null;
  readonly #layout: FigureLayout;
  #primaryTransform: ViewportTransform;

  constructor(options: WebGL2FigureRendererOptions) {
    assertDistinctSurfaces(options.surfaces);
    this.#surfaces = options.surfaces;

    // Construction order is part of the contract: each acquisition can fail, and a failure after
    // the GL context exists must release it, so the GL context is requested last.
    this.#underlay = WebGL2FigureRenderer.#acquireUnderlay(options.surfaces);
    this.#overlay = WebGL2FigureRenderer.#acquireOverlay(options.surfaces);
    const gl = acquireWebGl2Context(options.surfaces.plot);
    this.#gl = gl;
    try {
      this.#programs = createGlPrograms(gl);
    } catch (error) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw error;
    }

    this.#style = Object.freeze({ ...DEFAULT_FIGURE_STYLE, ...options.style });
    this.#axes = Object.freeze({ ...DEFAULT_AXIS_LAYOUT, ...options.axes });
    this.#yAxisRegistrations = options.yAxes ?? null;
    this.#deviceStyle = this.#style;
    this.#layout = createFigureLayout(this.#yAxisRegistrations?.length ?? 1);
    this.#updateGeometry();
    const first = this.#layout.transforms[0];
    if (first === undefined) {
      throw new Error("createAxisTransforms produced zero transforms for a non-empty axis list.");
    }
    this.#primaryTransform = first;
    this.#frame = new FrameState(gl, this.#programs, first);
    this.#frame.allocate(0);
    this.#frame.selection = options.decimation ?? null;
  }

  static #acquireUnderlay(surfaces: WebGL2FigureSurfaces): TraceDrawingContext {
    try {
      return acquire2dContext(surfaces.underlay);
    } catch (error) {
      throw new TypeError("WebGL2FigureRenderer: the underlay surface cannot produce a 2d context.", {
        cause: error,
      });
    }
  }

  static #acquireOverlay(surfaces: WebGL2FigureSurfaces): OverlayDrawingContext {
    return acquireOverlayContext(surfaces.overlay);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get transform(): ViewportTransform {
    return this.#primaryTransform;
  }

  setData(payload: SpectrumDataPayload): void {
    if (this.#disposed) return;
    this.#retireSlots();
    this.#payload = payload;
    this.#xOrigin = payload.xOrigin;
    this.#traceCollection = null;

    this.#traceCount = 1;
    this.#tracePayloads = [payload];
    this.#slots = [createTraceSlot()];
    const frame = this.#frame;
    frame.allocate(1);
    frame.payloads[0] = payload;
    frame.lineWidthCss[0] = this.#style.lineWidthCss;
    // A single payload carries no per-trace style, so isolated samples are always marked: a real
    // measurement must never vanish from the figure.
    frame.markIsolated[0] = 1;
    this.#writeColor(0, this.#style.traceColor);
    // The shared layout's transform is rebuilt with this payload's origin.
    this.#recomputeTransforms();
  }

  setTraces(collection: TraceCollection): void {
    if (this.#disposed) return;
    this.#retireSlots();
    this.#traceCollection = collection;
    this.#payload = null;

    const entries = collection.entries;
    const count = entries.length;
    this.#traceCount = count;
    this.#tracePayloads = new Array<SpectrumDataPayload>(count);
    this.#traceAxisIndex = new Int32Array(count);
    this.#slots = new Array<TraceGpuSlot>(count);
    const frame = this.#frame;
    frame.allocate(count);

    resolveTraceAxisIndices(collection, this.#resolveYAxes(), this.#traceAxisIndex);

    for (let i = 0; i < count; i += 1) {
      const entry = entries[i];
      if (entry === undefined) continue;
      this.#tracePayloads[i] = entry.payload;
      this.#slots[i] = createTraceSlot();
      const resolved = resolveTraceStyle(entry.style, i, this.#style);
      frame.payloads[i] = entry.payload;
      frame.lineWidthCss[i] = resolved.lineWidthCss;
      frame.markIsolated[i] = resolved.markIsolatedSamples ? 1 : 0;
      this.#writeColor(i, resolved.color);
    }

    this.#xDomainMin = collection.xDomainMin;
    this.#xDomainMax = collection.xDomainMax;
    // Tick selection follows the collection's X domain immediately, while the transforms follow
    // it on the next recompute: ticks are keyed on the domain the caller last supplied.
    this.#layout.xDomainMin = collection.xDomainMin;
    this.#layout.xDomainMax = collection.xDomainMax;
    this.#recomputeTraceTransforms();
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    this.#xDomainMin = xMin;
    this.#xDomainMax = xMax;
    this.#yDomainMin = yMin;
    this.#yDomainMax = yMax;
    this.#recomputeTransforms();
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
    this.#cssWidth = width;
    this.#cssHeight = height;
    this.#dpr = dpr;
    const surfaces = this.#surfaces;
    if (surfaces !== null) {
      // All three layers cover the whole figure at the same rounded size, so they share one
      // device coordinate system and stay aligned however the insets change.
      const deviceWidth = Math.round(width * dpr);
      const deviceHeight = Math.round(height * dpr);
      surfaces.underlay.width = deviceWidth;
      surfaces.underlay.height = deviceHeight;
      surfaces.plot.width = deviceWidth;
      surfaces.plot.height = deviceHeight;
      surfaces.overlay.width = deviceWidth;
      surfaces.overlay.height = deviceHeight;
    }
    this.#recomputeTransforms();
  }

  render(): void {
    if (this.#disposed) return;
    const underlay = this.#underlay;
    const overlay = this.#overlay;
    const gl = this.#gl;
    if (underlay === null || overlay === null || gl === null) return;

    this.#releaseRetiredSlots(gl);
    const t = this.#primaryTransform;
    const layout = this.#layout;

    underlay.setTransform(1, 0, 0, 1, 0, 0);
    underlay.fillStyle = this.#style.backgroundColor;
    underlay.fillRect(0, 0, t.deviceWidth, t.deviceHeight);
    refreshFigureTicks(layout, this.#unit("x"), this.#unit("y"));
    drawXGridlines(underlay, t, this.#style, layout.xTicks, layout.xTickCount);
    for (let axisIndex = 0; axisIndex < layout.transforms.length; axisIndex += 1) {
      const axisTransform = layout.transforms[axisIndex];
      const yTicks = layout.yTicks[axisIndex];
      if (axisTransform === undefined || yTicks === undefined) continue;
      drawYGridlines(underlay, axisTransform, this.#style, yTicks, layout.yTickCounts[axisIndex] ?? 0);
    }

    drawGlFrame(this.#frame, this.#slots, this.#traceCount);

    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.clearRect(0, 0, t.deviceWidth, t.deviceHeight);
    drawBottomAxis(overlay, t, this.#deviceStyle, this.#axes, layout.xTicks, layout.xTickCount, layout.xLabels);
    for (let axisIndex = 0; axisIndex < layout.transforms.length; axisIndex += 1) {
      const axisTransform = layout.transforms[axisIndex];
      const yTicks = layout.yTicks[axisIndex];
      const yLabels = layout.yLabels[axisIndex];
      if (axisTransform === undefined || yTicks === undefined || yLabels === undefined) continue;
      drawLeftAxis(
        overlay,
        axisTransform,
        this.#deviceStyle,
        this.#axes,
        yTicks,
        layout.yTickCounts[axisIndex] ?? 0,
        yLabels,
        // Each axis owns a column of its own, as on Canvas2D.
        layout.axisColumnOffsets[axisIndex] ?? 0,
      );
    }
  }

  clear(): void {
    if (this.#disposed) return;
    const underlay = this.#underlay;
    const overlay = this.#overlay;
    const gl = this.#gl;
    if (underlay === null || overlay === null || gl === null) return;
    const t = this.#primaryTransform;
    underlay.setTransform(1, 0, 0, 1, 0, 0);
    underlay.fillStyle = this.#style.backgroundColor;
    underlay.fillRect(0, 0, t.deviceWidth, t.deviceHeight);
    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.clearRect(0, 0, t.deviceWidth, t.deviceHeight);
    clearGlCanvas(gl, t);
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    if (this.#disposed) return;
    // The upload key compares the selection each frame, so no explicit invalidation is needed.
    this.#frame.selection = selection ?? null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const gl = this.#gl;
    if (gl !== null) {
      this.#releaseRetiredSlots(gl);
      for (const slot of this.#slots) releaseTraceSlot(gl, slot);
      const programs = this.#programs;
      if (programs !== null) {
        gl.deleteProgram(programs.line);
        gl.deleteProgram(programs.marker);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.#gl = null;
    this.#programs = null;
    this.#underlay = null;
    this.#overlay = null;
    this.#surfaces = null;
    this.#payload = null;
    this.#traceCollection = null;
    this.#slots = [];
    this.#retired = [];
    this.#tracePayloads = [];
  }

  #unit(axis: "x" | "y"): string {
    const payload = this.#payload;
    if (payload === null) return "";
    return axis === "x" ? payload.xUnit : payload.yUnit;
  }

  #retireSlots(): void {
    for (const slot of this.#slots) this.#retired.push(slot);
    this.#slots = [];
  }

  #releaseRetiredSlots(gl: Gl2Context): void {
    if (this.#retired.length === 0) return;
    for (const slot of this.#retired) releaseTraceSlot(gl, slot);
    this.#retired = [];
  }

  #resolveYAxes(): readonly YAxisRegistration[] {
    if (this.#yAxisRegistrations !== null) return this.#yAxisRegistrations;
    return [
      {
        id: "y",
        scaleKind: Y_SCALE_KIND_LINEAR,
        domainMin: this.#yDomainMin,
        domainMax: this.#yDomainMax,
        side: AXIS_SIDE_LEFT,
      },
    ];
  }

  #updateGeometry(): void {
    if (this.#deviceStyle.font !== scaleFontSize(this.#style.font, this.#dpr)) {
      this.#deviceStyle = Object.freeze({
        ...this.#style,
        font: scaleFontSize(this.#style.font, this.#dpr),
      });
    }
    updateFigureGeometry(this.#layout, {
      cssWidth: this.#cssWidth,
      cssHeight: this.#cssHeight,
      dpr: this.#dpr,
      style: this.#style,
      axes: this.#axes,
      xDomainMin: this.#xDomainMin,
      xDomainMax: this.#xDomainMax,
      xOrigin: this.#xOrigin,
      yAxes: this.#resolveYAxes(),
    });
  }

  #recomputeTransforms(): void {
    this.#updateGeometry();
    const first = this.#layout.transforms[0];
    if (first !== undefined) {
      this.#primaryTransform = first;
      this.#frame.primary = first;
      // A single payload draws through the shared layout's first transform.
      if (this.#traceCollection === null && this.#payload !== null) {
        this.#frame.transforms[0] = first;
      }
    }
    if (this.#traceCollection !== null) this.#recomputeTraceTransforms();
  }

  #recomputeTraceTransforms(): void {
    buildTraceTransforms(
      this.#resolveYAxes(),
      this.#traceAxisIndex,
      this.#tracePayloads,
      this.#traceCount,
      {
        cssWidth: this.#cssWidth,
        cssHeight: this.#cssHeight,
        dpr: this.#dpr,
        insets: this.#layout.insets,
        xDomainMin: this.#xDomainMin,
        xDomainMax: this.#xDomainMax,
      },
      this.#frame.transforms,
    );
  }

  /**
   * Writes trace `index`'s straight-alpha color into its uniform row. A color the parser does not
   * understand (a named color, `hsl()`) is canonicalised once, here, by round-tripping it through
   * the underlay context's `fillStyle`, which reads back a serialisation the parser accepts; the
   * previous `fillStyle` is restored. Nothing here runs per frame.
   */
  #writeColor(index: number, color: string): void {
    const base = index * UNIFORM_ROW_STRIDE + 14;
    const rows = this.#frame.rows;
    if (tryParseCssColorInto(color, rows, base)) return;
    const underlay = this.#underlay;
    if (underlay !== null) {
      const previous = underlay.fillStyle;
      underlay.fillStyle = color;
      const canonical = underlay.fillStyle;
      underlay.fillStyle = previous;
      if (typeof canonical === "string" && tryParseCssColorInto(canonical, rows, base)) return;
    }
    throw new TypeError(`WebGL2FigureRenderer: cannot resolve the CSS color "${color}".`);
  }
}
