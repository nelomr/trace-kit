/**
 * `Canvas2DRenderer` — the `FigureRenderer` backend that draws through a
 * `Canvas2DSurface`. Construction, `setData`, `setDomain` and `resize` never draw — only
 * `render()` may issue a drawing call, keeping recompute and paint strictly separated so a
 * caller can batch multiple state changes before one repaint. `render()` is a full repaint and
 * is idempotent for a fixed payload revision and transform. The CTM is set to identity once per
 * `render()` and never scaled, translated or rotated: every coordinate handed to the drawing
 * context is already in device pixels, produced by `buildTracePath`/`projectX`/`projectY`.
 */
import {
  AXIS_SIDE_LEFT,
  allocateIndexBuffer,
  createAxisTransforms,
  lttb,
  minMaxEnvelopeIndices,
  resolveDecimationParameter,
  selectTicks,
  Y_SCALE_KIND_LINEAR,
  type DecimationAlgorithm,
  type DecimationSelection,
  type IndexBuffer,
  type SpectrumDataPayload,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "../figure-renderer.js";
import { buildTracePath } from "../path/build-trace-path.js";
import { acquire2dContext, type Canvas2DSurface, type TraceDrawingContext } from "../surface.js";
import {
  DEFAULT_AXIS_LAYOUT,
  DEFAULT_FIGURE_STYLE,
  type AxisLayout,
  type FigureStyle,
} from "../style.js";
import {
  computeAxisInsets,
  drawBottomAxis,
  drawLeftAxis,
  drawXGridlines,
  drawYGridlines,
  formatTickLabel,
  selectYTicks,
  MAX_TICKS,
} from "./axes.js";

/** Pre-decimate to at most twice the plot-area width — enough oversampling to keep sub-pixel
 * detail visible without rendering more points than the display can resolve. */
const OVERSAMPLE = 2;

export interface Canvas2DRendererOptions {
  readonly surface: Canvas2DSurface;
  readonly style?: Partial<FigureStyle>;
  readonly axes?: Partial<AxisLayout>;
  /** Initial decimation selection. `undefined` (the default) is LTTB at the viewport-derived
   * threshold — today's behavior, unchanged. */
  readonly decimation?: DecimationSelection;
  /**
   * Explicit left-stacked Y axis registrations. `undefined` (the default) keeps today's
   * behaviour verbatim: exactly one implicit linear left axis, whose domain is set via
   * `setDomain`'s `yMin`/`yMax` arguments. When provided, each registration's own
   * `domainMin`/`domainMax` is authoritative for that axis — a later change (roadmap 5.7) is
   * what would make an axis's domain independently settable after construction.
   */
  readonly yAxes?: readonly YAxisRegistration[];
}

const DEFAULT_DECIMATION: DecimationSelection = { algorithm: "lttb" };

export class Canvas2DRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind = "canvas2d";

  #disposed = false;
  #surface: Canvas2DSurface | null;
  #context: TraceDrawingContext | null;
  #style: FigureStyle;
  #axes: AxisLayout;

  #payload: SpectrumDataPayload | null = null;

  #cssWidth = 1;
  #cssHeight = 1;
  #dpr = 1;
  #xOrigin = 0;
  #xDomainMin = 0;
  #xDomainMax = 1;
  /** Only meaningful for the default implicit single-axis case (`#yAxisRegistrations === null`);
   * an explicit `yAxes` registration carries its own domain instead. */
  #yDomainMin = -1;
  #yDomainMax = 1;

  /** `null` is the default, pre-change single-implicit-axis case. Fixed for the renderer's
   * lifetime once an explicit registration list is supplied at construction. */
  readonly #yAxisRegistrations: readonly YAxisRegistration[] | null;
  readonly #yAxisCount: number;

  /** `#transforms[0]` mirrors `#primaryTransform` — the default single-axis case never observes
   * an array. Kept as a dedicated field (rather than an indexed read) so the public `transform`
   * getter never has to unwrap a `noUncheckedIndexedAccess` optional. */
  #transforms: ViewportTransform[] = [];
  #primaryTransform: ViewportTransform;

  #indices: IndexBuffer = allocateIndexBuffer(2);
  #decimatedCount = 0;
  #decimation: DecimationSelection;
  #memoRevision = -1;
  #memoAlgorithm: DecimationAlgorithm | null = null;
  #memoParameter = -1;
  #memoXMin = NaN;
  #memoXMax = NaN;
  #memoYMin = NaN;
  #memoYMax = NaN;

  readonly #xTicks: Float64Array = new Float64Array(MAX_TICKS);
  #xTickCount = 0;
  readonly #xLabels: string[] = new Array<string>(MAX_TICKS).fill("");

  /** One fixed-capacity `Float64Array`/label array per registered Y axis, allocated once at
   * construction — never reallocated per `render()` call per axis. */
  readonly #yTicksPerAxis: Float64Array[];
  readonly #yTickCountPerAxis: number[];
  readonly #yLabelsPerAxis: string[][];

  /** Bumped only when tick values or axis units change. */
  #tickRevision = -1;
  #tickXMin = NaN;
  #tickXMax = NaN;
  #tickXUnit = "";
  readonly #tickYMinPerAxis: number[];
  readonly #tickYMaxPerAxis: number[];
  #tickYUnit = "";

  constructor(options: Canvas2DRendererOptions) {
    this.#surface = options.surface;
    this.#context = acquire2dContext(options.surface);
    this.#style = Object.freeze({ ...DEFAULT_FIGURE_STYLE, ...options.style });
    this.#axes = Object.freeze({ ...DEFAULT_AXIS_LAYOUT, ...options.axes });
    this.#decimation = options.decimation ?? DEFAULT_DECIMATION;
    this.#yAxisRegistrations = options.yAxes ?? null;
    this.#yAxisCount = this.#yAxisRegistrations?.length ?? 1;

    this.#yTicksPerAxis = Array.from({ length: this.#yAxisCount }, () => new Float64Array(MAX_TICKS));
    this.#yTickCountPerAxis = new Array<number>(this.#yAxisCount).fill(0);
    this.#yLabelsPerAxis = Array.from({ length: this.#yAxisCount }, () =>
      new Array<string>(MAX_TICKS).fill(""),
    );
    this.#tickYMinPerAxis = new Array<number>(this.#yAxisCount).fill(NaN);
    this.#tickYMaxPerAxis = new Array<number>(this.#yAxisCount).fill(NaN);

    this.#transforms = this.#computeTransforms();
    const first = this.#transforms[0];
    if (first === undefined) {
      throw new Error("createAxisTransforms produced zero transforms for a non-empty axis list.");
    }
    this.#primaryTransform = first;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get transform(): ViewportTransform {
    return this.#primaryTransform;
  }

  setData(payload: SpectrumDataPayload): void {
    if (this.#disposed) return;
    this.#payload = payload;
    this.#xOrigin = payload.xOrigin;
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    this.#xDomainMin = xMin;
    this.#xDomainMax = xMax;
    // Only the default implicit single axis takes its domain from setDomain; an explicit `yAxes`
    // registration owns its own domain instead (see the constructor option's doc comment).
    this.#yDomainMin = yMin;
    this.#yDomainMax = yMax;
    this.#recomputeTransforms();
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
    this.#cssWidth = width;
    this.#cssHeight = height;
    this.#dpr = dpr;
    const surface = this.#surface;
    if (surface !== null) {
      surface.width = Math.round(width * dpr);
      surface.height = Math.round(height * dpr);
    }
    this.#recomputeTransforms();
    this.#ensureIndexCapacity();
  }

  #recomputeTransforms(): void {
    this.#transforms = this.#computeTransforms();
    const first = this.#transforms[0];
    if (first !== undefined) {
      this.#primaryTransform = first;
    }
  }

  render(): void {
    if (this.#disposed) return;
    const context = this.#context;
    if (context === null) return;
    const t = this.#primaryTransform;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.#style.backgroundColor;
    context.fillRect(0, 0, t.deviceWidth, t.deviceHeight);

    this.#recomputeTicksIfStale();

    // X gridlines are shared across every axis (one X domain) — painted once, against the
    // primary transform, whose plotLeft/plotWidth/xScale are byte-identical to every other
    // registered axis's transform (the `multi-axis-viewport` shared-plot-geometry invariant).
    drawXGridlines(context, t, this.#style, this.#xTicks, this.#xTickCount);
    for (let axisIndex = 0; axisIndex < this.#transforms.length; axisIndex += 1) {
      const axisTransform = this.#transforms[axisIndex];
      const yTicks = this.#yTicksPerAxis[axisIndex];
      if (axisTransform === undefined || yTicks === undefined) continue;
      drawYGridlines(
        context,
        axisTransform,
        this.#style,
        yTicks,
        this.#yTickCountPerAxis[axisIndex] ?? 0,
      );
    }

    const payload = this.#payload;
    if (payload !== null && payload.sampleCount > 0) {
      this.#recomputeDecimationIfStale(payload, t);

      const path = new Path2D();
      buildTracePath(
        path,
        t,
        payload.x,
        payload.y,
        this.#indices,
        this.#decimatedCount,
        payload.sampleCount,
      );
      context.strokeStyle = this.#style.traceColor;
      context.lineWidth = this.#style.lineWidthCss * t.dpr;
      context.stroke(path);
    }

    drawBottomAxis(context, t, this.#style, this.#axes, this.#xTicks, this.#xTickCount, this.#xLabels);
    for (let axisIndex = 0; axisIndex < this.#transforms.length; axisIndex += 1) {
      const axisTransform = this.#transforms[axisIndex];
      const yTicks = this.#yTicksPerAxis[axisIndex];
      const yLabels = this.#yLabelsPerAxis[axisIndex];
      if (axisTransform === undefined || yTicks === undefined || yLabels === undefined) continue;
      drawLeftAxis(
        context,
        axisTransform,
        this.#style,
        this.#axes,
        yTicks,
        this.#yTickCountPerAxis[axisIndex] ?? 0,
        yLabels,
      );
    }
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    if (this.#disposed) return;
    this.#decimation = selection ?? DEFAULT_DECIMATION;
    // Invalidate the memoized decimated result without recomputing it here — recompute happens
    // lazily, in `#recomputeDecimationIfStale`, only when `render()` is next called.
    this.#memoAlgorithm = null;
  }

  clear(): void {
    if (this.#disposed) return;
    const context = this.#context;
    if (context === null) return;
    const t = this.#primaryTransform;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.#style.backgroundColor;
    context.fillRect(0, 0, t.deviceWidth, t.deviceHeight);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#context = null;
    this.#surface = null;
    this.#payload = null;
  }

  /** The registered axes: the caller's explicit list, or — the default, pre-change behaviour —
   * one synthetic implicit linear left axis tracking `setDomain`'s `yMin`/`yMax`. */
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

  #computeTransforms(): ViewportTransform[] {
    const insets = computeAxisInsets(this.#style, this.#axes, this.#yAxisCount);
    // Clamp the (data-independent) configured insets against the current CSS size: a canvas
    // constructed or resized to a size too small to hold the configured gutters must not throw —
    // it degrades to a zero (or reduced) plot area instead. This never affects the transform once
    // `resize()` has been called with a realistic size.
    const maxHorizontal = Math.max(0, this.#cssWidth - 1);
    const maxVertical = Math.max(0, this.#cssHeight - 1);
    const insetLeft = Math.min(insets.insetLeft, maxHorizontal);
    const insetRight = Math.min(insets.insetRight, Math.max(0, maxHorizontal - insetLeft));
    const insetTop = Math.min(insets.insetTop, maxVertical);
    const insetBottom = Math.min(insets.insetBottom, Math.max(0, maxVertical - insetTop));
    const out: ViewportTransform[] = [];
    createAxisTransforms(
      {
        cssWidth: this.#cssWidth,
        cssHeight: this.#cssHeight,
        dpr: this.#dpr,
        insetLeft,
        insetRight,
        insetTop,
        insetBottom,
        xDomainMin: this.#xDomainMin,
        xDomainMax: this.#xDomainMax,
        xOrigin: this.#xOrigin,
      },
      this.#resolveYAxes(),
      out,
    );
    return out;
  }

  #recomputeTicksIfStale(): void {
    const xUnit = this.#payload?.xUnit ?? "";
    const yUnit = this.#payload?.yUnit ?? "";
    let stale =
      this.#tickXMin !== this.#xDomainMin ||
      this.#tickXMax !== this.#xDomainMax ||
      this.#tickXUnit !== xUnit ||
      this.#tickYUnit !== yUnit;
    for (let axisIndex = 0; axisIndex < this.#transforms.length && !stale; axisIndex += 1) {
      const t = this.#transforms[axisIndex];
      if (t === undefined) continue;
      if (
        this.#tickYMinPerAxis[axisIndex] !== t.yDomainMin ||
        this.#tickYMaxPerAxis[axisIndex] !== t.yDomainMax
      ) {
        stale = true;
      }
    }
    if (!stale) return;

    this.#xTickCount = selectTicks(
      this.#xDomainMin,
      this.#xDomainMax,
      this.#axes.targetTickCount,
      this.#xTicks,
      0,
    );
    for (let i = 0; i < this.#xTickCount; i += 1) {
      this.#xLabels[i] = formatTickLabel(this.#xTicks[i] ?? 0, xUnit);
    }

    for (let axisIndex = 0; axisIndex < this.#transforms.length; axisIndex += 1) {
      const t = this.#transforms[axisIndex];
      const yTicks = this.#yTicksPerAxis[axisIndex];
      const yLabels = this.#yLabelsPerAxis[axisIndex];
      if (t === undefined || yTicks === undefined || yLabels === undefined) continue;
      const count = selectYTicks(t, this.#axes.targetTickCount, yTicks, 0);
      this.#yTickCountPerAxis[axisIndex] = count;
      for (let i = 0; i < count; i += 1) {
        yLabels[i] = formatTickLabel(yTicks[i] ?? 0, yUnit);
      }
      this.#tickYMinPerAxis[axisIndex] = t.yDomainMin;
      this.#tickYMaxPerAxis[axisIndex] = t.yDomainMax;
    }

    this.#tickXMin = this.#xDomainMin;
    this.#tickXMax = this.#xDomainMax;
    this.#tickXUnit = xUnit;
    this.#tickYUnit = yUnit;
    this.#tickRevision += 1;
  }

  #ensureIndexCapacity(required = 0): void {
    const capacity = Math.max(
      2,
      Math.ceil(this.#primaryTransform.plotWidth * OVERSAMPLE),
      required,
    );
    if (capacity > this.#indices.length) {
      this.#indices = allocateIndexBuffer(capacity);
    }
  }

  #recomputeDecimationIfStale(payload: SpectrumDataPayload, t: ViewportTransform): void {
    const algorithm = this.#decimation.algorithm;
    const parameter = resolveDecimationParameter(this.#decimation, t.plotWidth, payload.sampleCount);
    // `min-max` emits two vertices per bucket; the vertex count actually drawn (and therefore
    // the bypass boundary and the scratch capacity) is `parameter` for `lttb`, `parameter * 2`
    // for `min-max`.
    const emittedVertexCount = algorithm === "lttb" ? parameter : parameter * 2;
    const stale =
      this.#memoRevision !== payload.revision ||
      this.#memoAlgorithm !== algorithm ||
      this.#memoParameter !== parameter ||
      this.#memoXMin !== t.xDomainMin ||
      this.#memoXMax !== t.xDomainMax ||
      this.#memoYMin !== t.yDomainMin ||
      this.#memoYMax !== t.yDomainMax;
    if (!stale) return;

    if (payload.sampleCount <= emittedVertexCount) {
      this.#decimatedCount = 0;
    } else if (algorithm === "lttb") {
      this.#ensureIndexCapacity(emittedVertexCount);
      this.#decimatedCount = lttb(
        payload.x,
        payload.y,
        0,
        payload.sampleCount,
        this.#indices,
        0,
        parameter,
      );
    } else {
      this.#ensureIndexCapacity(emittedVertexCount);
      this.#decimatedCount = minMaxEnvelopeIndices(
        payload.y,
        0,
        payload.sampleCount,
        this.#indices,
        0,
        parameter,
      );
    }

    this.#memoRevision = payload.revision;
    this.#memoAlgorithm = algorithm;
    this.#memoParameter = parameter;
    this.#memoXMin = t.xDomainMin;
    this.#memoXMax = t.xDomainMax;
    this.#memoYMin = t.yDomainMin;
    this.#memoYMax = t.yDomainMax;
  }
}
