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
  allocateIndexBuffer,
  createViewportTransform,
  lttb,
  minMaxEnvelopeIndices,
  resolveDecimationParameter,
  selectTicks,
  type DecimationAlgorithm,
  type DecimationSelection,
  type IndexBuffer,
  type SpectrumDataPayload,
  type ViewportTransform,
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
import { computeAxisInsets, drawAxes, drawGrid, formatTickLabel, MAX_TICKS } from "./axes.js";

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
  #yDomainMin = -1;
  #yDomainMax = 1;

  #transform: ViewportTransform;

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
  readonly #yTicks: Float64Array = new Float64Array(MAX_TICKS);
  #xTickCount = 0;
  #yTickCount = 0;
  readonly #xLabels: string[] = new Array<string>(MAX_TICKS).fill("");
  readonly #yLabels: string[] = new Array<string>(MAX_TICKS).fill("");
  /** Bumped only when tick values or axis units change. */
  #tickRevision = -1;
  #tickXMin = NaN;
  #tickXMax = NaN;
  #tickYMin = NaN;
  #tickYMax = NaN;
  #tickXUnit = "";
  #tickYUnit = "";

  constructor(options: Canvas2DRendererOptions) {
    this.#surface = options.surface;
    this.#context = acquire2dContext(options.surface);
    this.#style = Object.freeze({ ...DEFAULT_FIGURE_STYLE, ...options.style });
    this.#axes = Object.freeze({ ...DEFAULT_AXIS_LAYOUT, ...options.axes });
    this.#decimation = options.decimation ?? DEFAULT_DECIMATION;
    this.#transform = this.#computeTransform();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get transform(): ViewportTransform {
    return this.#transform;
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
    this.#yDomainMin = yMin;
    this.#yDomainMax = yMax;
    this.#transform = this.#computeTransform();
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
    this.#transform = this.#computeTransform();
    this.#ensureIndexCapacity();
  }

  render(): void {
    if (this.#disposed) return;
    const context = this.#context;
    if (context === null) return;
    const t = this.#transform;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.#style.backgroundColor;
    context.fillRect(0, 0, t.deviceWidth, t.deviceHeight);

    this.#recomputeTicksIfStale();
    drawGrid(context, t, this.#style, this.#xTicks, this.#xTickCount, this.#yTicks, this.#yTickCount);

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

    drawAxes(
      context,
      t,
      this.#style,
      this.#axes,
      this.#xTicks,
      this.#xTickCount,
      this.#xLabels,
      this.#yTicks,
      this.#yTickCount,
      this.#yLabels,
    );
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
    const t = this.#transform;
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

  #computeTransform(): ViewportTransform {
    const insets = computeAxisInsets(this.#style, this.#axes);
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
    return createViewportTransform({
      cssWidth: this.#cssWidth,
      cssHeight: this.#cssHeight,
      dpr: this.#dpr,
      insetLeft,
      insetRight,
      insetTop,
      insetBottom,
      xDomainMin: this.#xDomainMin,
      xDomainMax: this.#xDomainMax,
      yDomainMin: this.#yDomainMin,
      yDomainMax: this.#yDomainMax,
      xOrigin: this.#xOrigin,
    });
  }

  #recomputeTicksIfStale(): void {
    const xUnit = this.#payload?.xUnit ?? "";
    const yUnit = this.#payload?.yUnit ?? "";
    const stale =
      this.#tickXMin !== this.#xDomainMin ||
      this.#tickXMax !== this.#xDomainMax ||
      this.#tickYMin !== this.#yDomainMin ||
      this.#tickYMax !== this.#yDomainMax ||
      this.#tickXUnit !== xUnit ||
      this.#tickYUnit !== yUnit;
    if (!stale) return;

    this.#xTickCount = selectTicks(
      this.#xDomainMin,
      this.#xDomainMax,
      this.#axes.targetTickCount,
      this.#xTicks,
      0,
    );
    this.#yTickCount = selectTicks(
      this.#yDomainMin,
      this.#yDomainMax,
      this.#axes.targetTickCount,
      this.#yTicks,
      0,
    );
    for (let i = 0; i < this.#xTickCount; i += 1) {
      this.#xLabels[i] = formatTickLabel(this.#xTicks[i] ?? 0, xUnit);
    }
    for (let i = 0; i < this.#yTickCount; i += 1) {
      this.#yLabels[i] = formatTickLabel(this.#yTicks[i] ?? 0, yUnit);
    }

    this.#tickXMin = this.#xDomainMin;
    this.#tickXMax = this.#xDomainMax;
    this.#tickYMin = this.#yDomainMin;
    this.#tickYMax = this.#yDomainMax;
    this.#tickXUnit = xUnit;
    this.#tickYUnit = yUnit;
    this.#tickRevision += 1;
  }

  #ensureIndexCapacity(required = 0): void {
    const capacity = Math.max(
      2,
      Math.ceil(this.#transform.plotWidth * OVERSAMPLE),
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
