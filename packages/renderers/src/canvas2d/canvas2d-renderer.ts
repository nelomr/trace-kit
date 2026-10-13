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
  lttb,
  minMaxEnvelopeIndices,
  resolveTraceAxisIndices,
  Y_SCALE_KIND_LINEAR,
  type DecimationAlgorithm,
  type DecimationSelection,
  type IndexBuffer,
  type SpectrumDataPayload,
  type TraceCollection,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "../figure-renderer.js";
import { buildTracePath } from "../path/build-trace-path.js";
import {
  buildIsolatedMarkers,
  countIsolatedSegments,
  isolatedMarkerHalfSide,
} from "../path/isolated-markers.js";
import {
  createFigureLayout,
  scaleFontSize,
  refreshFigureTicks,
  updateFigureGeometry,
  type FigureLayout,
} from "../layout/figure-layout.js";
import { buildTraceTransforms } from "../layout/trace-transforms.js";
import { decimateTraceIndices, resolveDecimationTarget } from "../rules/decimation.js";
import { resolveTraceStyle } from "../rules/trace-style.js";
import { acquire2dContext, type Canvas2DSurface, type TraceDrawingContext } from "../surface.js";
import {
  DEFAULT_AXIS_LAYOUT,
  DEFAULT_FIGURE_STYLE,
  type AxisLayout,
  type FigureStyle,
} from "../style.js";
import { drawBottomAxis, drawLeftAxis, drawXGridlines, drawYGridlines } from "./axes.js";

/** Pre-decimate to at most twice the plot-area width — enough oversampling to keep sub-pixel
 * detail visible without rendering more points than the display can resolve. */
const OVERSAMPLE = 2;

/** Shared, frozen, never-mutated dash pattern for a trace with no explicit `dash` style — a
 * solid line takes `setLineDash([])`, and reusing one frozen empty array across every such
 * trace avoids allocating a fresh one per trace per `setTraces` call. */
const EMPTY_DASH: number[] = [];

export interface Canvas2DRendererOptions {
  readonly surface: Canvas2DSurface;
  readonly style?: Partial<FigureStyle>;
  readonly axes?: Partial<AxisLayout>;
  /** Initial decimation selection. `undefined` (the default) is this backend's default: LTTB at
   * the viewport-derived threshold, `min(sampleCount, max(2, ceil(2 * plotWidth)))` vertices.
   * Other backends define their own default; a caller that selects nothing gets the backend's. */
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
  /** `#style` with the label font scaled to device pixels; rebuilt only when the dpr changes, so
   * `render()` hands the axis painters a ready object and allocates nothing. */
  #deviceStyle: FigureStyle;
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

  /** One layout record for the renderer's lifetime: insets, per-axis transforms, tick buffers,
   * labels and column offsets, shared with the SVG exporter's layout module. */
  readonly #layout: FigureLayout;
  /** `#layout.transforms[0]`, held as a dedicated field so the public `transform` getter never
   * has to unwrap a `noUncheckedIndexedAccess` optional. */
  #primaryTransform: ViewportTransform;

  #indices: IndexBuffer = allocateIndexBuffer(2);
  #decimatedCount = 0;
  /** Isolated segments in the current single-payload decimation result; refreshed only when the
   * memo recomputes, so `render()` never walks the samples to rediscover it. */
  #isolatedCount = 0;
  #decimation: DecimationSelection;
  #memoRevision = -1;
  #memoAlgorithm: DecimationAlgorithm | null = null;
  #memoParameter = -1;
  #memoXMin = NaN;
  #memoXMax = NaN;
  #memoYMin = NaN;
  #memoYMax = NaN;

  /** `null` until `setTraces` is first called. Once set, `render()` draws the trace set instead
   * of the single `#payload`; `setData` clears this back to `null` so the two entry points stay
   * mutually exclusive rather than both partially applying. */
  #traceCollection: TraceCollection | null = null;
  #traceCount = 0;
  #traceIds: string[] = [];
  #tracePayloads: SpectrumDataPayload[] = [];
  #traceAxisIndex: Int32Array = new Int32Array(0);
  #traceIndices: IndexBuffer[] = [];
  #traceDecimatedCount: Int32Array = new Int32Array(0);
  #traceTransforms: ViewportTransform[] = [];
  #traceStroke: string[] = [];
  #traceLineWidthCss: Float64Array = new Float64Array(0);
  #traceDashDevice: number[][] = [];
  #traceMarkIsolated: boolean[] = [];
  #traceIsolatedCount: Int32Array = new Int32Array(0);

  /** Per-trace memo columns — same staleness key as the single-payload memo below, but one slot
   * per trace so a revision bump on one trace never re-decimates its siblings. */
  #traceMemoRevision: Float64Array = new Float64Array(0);
  #traceMemoAlgorithm: (DecimationAlgorithm | null)[] = [];
  #traceMemoParameter: Int32Array = new Int32Array(0);
  #traceMemoXMin: Float64Array = new Float64Array(0);
  #traceMemoXMax: Float64Array = new Float64Array(0);
  #traceMemoYMin: Float64Array = new Float64Array(0);
  #traceMemoYMax: Float64Array = new Float64Array(0);

  constructor(options: Canvas2DRendererOptions) {
    this.#surface = options.surface;
    this.#context = acquire2dContext(options.surface);
    this.#style = Object.freeze({ ...DEFAULT_FIGURE_STYLE, ...options.style });
    this.#axes = Object.freeze({ ...DEFAULT_AXIS_LAYOUT, ...options.axes });
    this.#decimation = options.decimation ?? DEFAULT_DECIMATION;
    this.#yAxisRegistrations = options.yAxes ?? null;
    this.#yAxisCount = this.#yAxisRegistrations?.length ?? 1;

    this.#deviceStyle = this.#style;
    this.#layout = createFigureLayout(this.#yAxisCount);
    this.#updateGeometry();
    const first = this.#layout.transforms[0];
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
    // Mutually exclusive with `setTraces`: a payload set through the single-trace entry point
    // replaces whatever trace set was there, rather than drawing both.
    this.#traceCollection = null;
  }

  setTraces(collection: TraceCollection): void {
    if (this.#disposed) return;
    this.#traceCollection = collection;
    this.#payload = null;

    const entries = collection.entries;
    const count = entries.length;
    this.#traceCount = count;
    this.#traceIds = new Array<string>(count);
    this.#tracePayloads = new Array<SpectrumDataPayload>(count);
    this.#traceAxisIndex = new Int32Array(count);
    this.#traceIndices = new Array<IndexBuffer>(count);
    this.#traceDecimatedCount = new Int32Array(count);
    this.#traceStroke = new Array<string>(count);
    this.#traceLineWidthCss = new Float64Array(count);
    this.#traceDashDevice = new Array<number[]>(count);
    this.#traceMarkIsolated = new Array<boolean>(count);
    this.#traceIsolatedCount = new Int32Array(count);
    this.#traceMemoRevision = new Float64Array(count).fill(-1);
    this.#traceMemoAlgorithm = new Array<DecimationAlgorithm | null>(count).fill(null);
    this.#traceMemoParameter = new Int32Array(count).fill(-1);
    this.#traceMemoXMin = new Float64Array(count).fill(NaN);
    this.#traceMemoXMax = new Float64Array(count).fill(NaN);
    this.#traceMemoYMin = new Float64Array(count).fill(NaN);
    this.#traceMemoYMax = new Float64Array(count).fill(NaN);

    resolveTraceAxisIndices(collection, this.#resolveYAxes(), this.#traceAxisIndex);

    for (let i = 0; i < count; i += 1) {
      const entry = entries[i];
      if (entry === undefined) continue;
      this.#traceIds[i] = entry.id;
      this.#tracePayloads[i] = entry.payload;
      this.#traceIndices[i] = allocateIndexBuffer(2);
      const resolved = resolveTraceStyle(entry.style, i, this.#style);
      this.#traceStroke[i] = resolved.color;
      this.#traceLineWidthCss[i] = resolved.lineWidthCss;
      this.#traceDashDevice[i] =
        resolved.dashCss.length === 0 ? EMPTY_DASH : resolved.dashCss.map((v) => v * this.#dpr);
      this.#traceMarkIsolated[i] = resolved.markIsolatedSamples;
    }

    this.#xDomainMin = collection.xDomainMin;
    this.#xDomainMax = collection.xDomainMax;
    // Tick selection follows the collection's X domain immediately, while the transforms only
    // follow it on the next `resize`/`setDomain`: ticks are keyed on the domain the caller last
    // supplied, not on the projection built from an earlier one.
    this.#layout.xDomainMin = collection.xDomainMin;
    this.#layout.xDomainMax = collection.xDomainMax;

    this.#recomputeTraceTransforms();
    this.#ensureTraceIndexCapacities();
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
    if (this.#traceCollection !== null) {
      this.#recomputeTraceTransforms();
    }
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
    if (this.#traceCollection !== null) {
      this.#recomputeTraceTransforms();
      this.#ensureTraceIndexCapacities();
    }
  }

  #recomputeTransforms(): void {
    this.#updateGeometry();
    const first = this.#layout.transforms[0];
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

    const layout = this.#layout;
    // The dash pattern is context state that outlives a frame: the previous frame's last trace
    // would otherwise dash this frame's gridlines. Only collection renders ever set a dash.
    if (this.#traceCollection !== null) context.setLineDash(EMPTY_DASH);
    refreshFigureTicks(layout, this.#payload?.xUnit ?? "", this.#payload?.yUnit ?? "");

    // X gridlines are shared across every axis (one X domain) — painted once, against the
    // primary transform, whose plotLeft/plotWidth/xScale are byte-identical to every other
    // registered axis's transform (the `multi-axis-viewport` shared-plot-geometry invariant).
    drawXGridlines(context, t, this.#style, layout.xTicks, layout.xTickCount);
    for (let axisIndex = 0; axisIndex < layout.transforms.length; axisIndex += 1) {
      const axisTransform = layout.transforms[axisIndex];
      const yTicks = layout.yTicks[axisIndex];
      if (axisTransform === undefined || yTicks === undefined) continue;
      drawYGridlines(
        context,
        axisTransform,
        this.#style,
        yTicks,
        layout.yTickCounts[axisIndex] ?? 0,
      );
    }

    if (this.#traceCollection !== null) {
      this.#renderTraces(context);
    } else {
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

        // A single payload carries no per-trace style, so isolated samples are always marked:
        // a one-sample segment strokes to nothing under a butt cap, and a real measurement must
        // never vanish from the figure.
        if (this.#isolatedCount > 0) {
          const markers = new Path2D();
          buildIsolatedMarkers(
            markers,
            t,
            payload.x,
            payload.y,
            this.#indices,
            this.#decimatedCount,
            payload.sampleCount,
            isolatedMarkerHalfSide(this.#style.lineWidthCss, t.dpr),
          );
          context.fillStyle = this.#style.traceColor;
          context.fill(markers);
        }
      }
    }

    // Same leak, inside the frame: the last trace's dash must not carry onto the axis strokes.
    if (this.#traceCollection !== null) context.setLineDash(EMPTY_DASH);
    drawBottomAxis(context, t, this.#deviceStyle, this.#axes, layout.xTicks, layout.xTickCount, layout.xLabels);
    for (let axisIndex = 0; axisIndex < layout.transforms.length; axisIndex += 1) {
      const axisTransform = layout.transforms[axisIndex];
      const yTicks = layout.yTicks[axisIndex];
      const yLabels = layout.yLabels[axisIndex];
      if (axisTransform === undefined || yTicks === undefined || yLabels === undefined) continue;
      drawLeftAxis(
        context,
        axisTransform,
        this.#deviceStyle,
        this.#axes,
        yTicks,
        layout.yTickCounts[axisIndex] ?? 0,
        yLabels,
        // Each axis owns a column of its own: `insetLeft` reserves one gutter per axis, so
        // drawing them all at `plotLeft` would stack every line and label on top of each other
        // and leave the reserved gutters empty.
        layout.axisColumnOffsets[axisIndex] ?? 0,
      );
    }
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    if (this.#disposed) return;
    this.#decimation = selection ?? DEFAULT_DECIMATION;
    // Invalidate the memoized decimated result without recomputing it here — recompute happens
    // lazily, in `#recomputeDecimationIfStale`, only when `render()` is next called.
    this.#memoAlgorithm = null;
    for (let i = 0; i < this.#traceMemoAlgorithm.length; i += 1) {
      this.#traceMemoAlgorithm[i] = null;
    }
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
    this.#traceCollection = null;
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
    const parameter = resolveDecimationTarget(this.#decimation, t.plotWidth, payload.sampleCount);
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

    this.#isolatedCount = countIsolatedSegments(
      payload.x,
      payload.y,
      this.#indices,
      this.#decimatedCount,
      payload.sampleCount,
    );

    this.#memoRevision = payload.revision;
    this.#memoAlgorithm = algorithm;
    this.#memoParameter = parameter;
    this.#memoXMin = t.xDomainMin;
    this.#memoXMax = t.xDomainMax;
    this.#memoYMin = t.yDomainMin;
    this.#memoYMax = t.yDomainMax;
  }

  /** Rebuilds one `ViewportTransform` per trace through the shared builder, so each trace keeps
   * its own `xOrigin` while sharing the axes' plot geometry. */
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
      this.#traceTransforms,
    );
  }

  #ensureTraceIndexCapacity(i: number, required: number): void {
    const t = this.#traceTransforms[i];
    const plotWidth = t?.plotWidth ?? 0;
    const capacity = Math.max(2, Math.ceil(plotWidth * OVERSAMPLE), required);
    const current = this.#traceIndices[i];
    if (current === undefined || capacity > current.length) {
      this.#traceIndices[i] = allocateIndexBuffer(capacity);
    }
  }

  #ensureTraceIndexCapacities(): void {
    for (let i = 0; i < this.#traceCount; i += 1) {
      this.#ensureTraceIndexCapacity(i, 0);
    }
  }

  /** Per-trace twin of `#recomputeDecimationIfStale`, plus the infeasible-LTTB fallback: when
   * `lttb` cannot represent this trace's gaps within `threshold` (returns `0`), immediately
   * falls back to `minMaxEnvelopeIndices` over the same trace and records that result under the
   * same memo key, so an unchanged frame never re-runs either decimator. Refreshes the isolated-
   * sample count only when this trace's memo actually recomputes. */
  #recomputeTraceDecimationIfStale(i: number, payload: SpectrumDataPayload, t: ViewportTransform): void {
    const algorithm = this.#decimation.algorithm;
    const parameter = resolveDecimationTarget(this.#decimation, t.plotWidth, payload.sampleCount);
    const emittedVertexCount = algorithm === "lttb" ? parameter : parameter * 2;
    const stale =
      this.#traceMemoRevision[i] !== payload.revision ||
      this.#traceMemoAlgorithm[i] !== algorithm ||
      this.#traceMemoParameter[i] !== parameter ||
      this.#traceMemoXMin[i] !== t.xDomainMin ||
      this.#traceMemoXMax[i] !== t.xDomainMax ||
      this.#traceMemoYMin[i] !== t.yDomainMin ||
      this.#traceMemoYMax[i] !== t.yDomainMax;
    if (!stale) return;

    let decimatedCount: number;
    if (payload.sampleCount <= emittedVertexCount) {
      decimatedCount = 0;
    } else {
      this.#ensureTraceIndexCapacity(i, emittedVertexCount);
      const indices = this.#traceIndices[i];
      decimatedCount =
        indices === undefined
          ? 0
          : decimateTraceIndices(algorithm, parameter, payload.x, payload.y, payload.sampleCount, indices);
    }

    this.#traceDecimatedCount[i] = decimatedCount;
    const indices = this.#traceIndices[i];
    this.#traceIsolatedCount[i] =
      indices === undefined
        ? 0
        : countIsolatedSegments(payload.x, payload.y, indices, decimatedCount, payload.sampleCount);

    this.#traceMemoRevision[i] = payload.revision;
    this.#traceMemoAlgorithm[i] = algorithm;
    this.#traceMemoParameter[i] = parameter;
    this.#traceMemoXMin[i] = t.xDomainMin;
    this.#traceMemoXMax[i] = t.xDomainMax;
    this.#traceMemoYMin[i] = t.yDomainMin;
    this.#traceMemoYMax[i] = t.yDomainMax;
  }

  /** The per-trace `render()` loop: one `Path2D` per trace, its pre-resolved style, and —
   * only for a trace whose memo just proved it has an isolated sample and whose style opts in —
   * one further `Path2D` filled for the markers. `setTransform` is not called here; it runs once
   * per frame in the caller, outside this loop. */
  #renderTraces(context: TraceDrawingContext): void {
    for (let i = 0; i < this.#traceCount; i += 1) {
      const payload = this.#tracePayloads[i];
      const t = this.#traceTransforms[i];
      const indices = this.#traceIndices[i];
      if (payload === undefined || t === undefined || indices === undefined) continue;
      if (payload.sampleCount === 0) continue;

      this.#recomputeTraceDecimationIfStale(i, payload, t);
      const decimatedCount = this.#traceDecimatedCount[i] ?? 0;

      const path = new Path2D();
      buildTracePath(path, t, payload.x, payload.y, indices, decimatedCount, payload.sampleCount);
      const lineWidthCss = this.#traceLineWidthCss[i] ?? this.#style.lineWidthCss;
      const lineWidthDevice = lineWidthCss * t.dpr;
      const markerHalfSide = isolatedMarkerHalfSide(lineWidthCss, t.dpr);
      context.strokeStyle = this.#traceStroke[i] ?? this.#style.traceColor;
      context.lineWidth = lineWidthDevice;
      context.setLineDash(this.#traceDashDevice[i] ?? EMPTY_DASH);
      context.stroke(path);

      const isolatedCount = this.#traceIsolatedCount[i] ?? 0;
      if (isolatedCount > 0 && (this.#traceMarkIsolated[i] ?? true)) {
        const markers = new Path2D();
        buildIsolatedMarkers(
          markers,
          t,
          payload.x,
          payload.y,
          indices,
          decimatedCount,
          payload.sampleCount,
          markerHalfSide,
        );
        context.fillStyle = this.#traceStroke[i] ?? this.#style.traceColor;
        context.fill(markers);
      }
    }
  }
}
