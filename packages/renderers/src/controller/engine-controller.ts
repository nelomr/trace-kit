import type {
  DecimationPort,
  DecimationSelection,
  SettlementSink,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
  YAxisRegistration,
} from "@trace-kit/core";
import {
  Canvas2DRenderer,
  type Canvas2DRendererOptions,
} from "../canvas2d/canvas2d-renderer.js";
import type { FigureRenderer } from "../figure-renderer.js";
import type { AxisLayout, FigureStyle } from "../style.js";
import { getRecoveryHandle } from "../webgl2/rehydrate.js";
import {
  WebGL2FigureRenderer,
  type WebGL2FigureRendererOptions,
} from "../webgl2/webgl2-figure-renderer.js";
import {
  computePayloadSampleCount,
  computeTracesSampleCount,
  resolveDesiredEngine,
  resolveHysteresisConfig,
  type EngineKind,
  type EngineSelectionMode,
  type ResolvedHysteresisConfig,
} from "./hysteresis.js";
import type {
  EngineChangeEvent,
  EngineChangeReason,
  ResizeObserverCallbackLike,
  ResizeObserverEntryLike,
  ResizeObserverLike,
  SpectrumEngineController,
  SpectrumEngineControllerOptions,
  ViewportDomain,
  WebGL2ContextLostEvent,
  WebGL2ContextRestoredEvent,
  WebGL2FallbackEvent,
} from "./types.js";

const DEFAULT_WIDTH_CSS = 800;
const DEFAULT_HEIGHT_CSS = 400;
const DEFAULT_DPR = 1;
const DEFAULT_CONTEXT_LOST_MESSAGE = "WebGL2 context lost.";
const EMPTY_CANVASES: readonly HTMLCanvasElement[] = Object.freeze([]);

function extractStatusMessage(event: Event): string {
  const raw: unknown = Reflect.get(event, "statusMessage");
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw;
  }
  return DEFAULT_CONTEXT_LOST_MESSAGE;
}

function assertPositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `SpectrumEngineController: ${name} must be a finite number > 0 (received ${value}).`,
    );
  }
  return value;
}

function defaultGetDevicePixelRatio(): number {
  if (typeof window !== "undefined") {
    const ratio = window.devicePixelRatio;
    if (Number.isFinite(ratio) && ratio > 0) return ratio;
  }
  return DEFAULT_DPR;
}

function defaultRequestAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return Number(setTimeout(() => callback(Date.now()), 16));
}

function defaultCancelAnimationFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

function defaultCreateCanvas2DRenderer(options: Canvas2DRendererOptions): FigureRenderer {
  return new Canvas2DRenderer(options);
}

function defaultCreateWebGL2Renderer(options: WebGL2FigureRendererOptions): FigureRenderer {
  return new WebGL2FigureRenderer(options);
}

function ensureContainerPositioning(container: HTMLElement): void {
  const inlinePos = container.style.position;
  if (inlinePos === "static") {
    container.style.position = "relative";
    return;
  }
  if (inlinePos === "") {
    const computedPos =
      typeof getComputedStyle === "function" ? getComputedStyle(container).position : "";
    if (computedPos === "" || computedPos === "static") {
      container.style.position = "relative";
    }
  }
}

interface MutableDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

class SpectrumEngineControllerImpl implements SpectrumEngineController {
  readonly #container: HTMLElement;
  readonly #hysteresis: ResolvedHysteresisConfig;
  readonly #style: Partial<FigureStyle> | undefined;
  readonly #axes: Partial<AxisLayout> | undefined;
  readonly #yAxes: readonly YAxisRegistration[] | undefined;
  readonly #onEngineChange: ((event: EngineChangeEvent) => void) | undefined;
  readonly #onWebGL2Fallback: ((event: WebGL2FallbackEvent) => void) | undefined;
  readonly #onContextLost: ((event: WebGL2ContextLostEvent) => void) | undefined;
  readonly #onContextRestored: ((event: WebGL2ContextRestoredEvent) => void) | undefined;
  readonly #createCanvas2DRenderer: (options: Canvas2DRendererOptions) => FigureRenderer;
  readonly #createWebGL2Renderer: (options: WebGL2FigureRendererOptions) => FigureRenderer;
  readonly #createCanvas: () => HTMLCanvasElement;
  readonly #getDevicePixelRatio: () => number;
  readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelAnimationFrame: (handle: number) => void;

  #mode: EngineSelectionMode;
  #activeKind: EngineKind = "canvas2d";
  #activeRenderer: FigureRenderer | null = null;
  #disposedTransform: ViewportTransform | null = null;
  #mountedCanvases: readonly HTMLCanvasElement[] = EMPTY_CANVASES;
  #boundPlotCanvas: HTMLCanvasElement | null = null;
  #pendingKind: EngineKind | null = null;
  #gestureActive = false;
  #webgl2Fallback = false;
  #contextLost = false;
  #restoreCount = 0;
  #hysteresisDirty = false;
  #disposed = false;
  #transitionSeq = 0;

  #width: number;
  #height: number;
  #dpr: number;
  #decimation: DecimationSelection | undefined;

  #activeData: SpectrumDataPayload | null = null;
  #activeTraces: TraceCollection | null = null;
  #sampleCount = 0;
  #lastPayloadRevision = -1;
  #lastXOrigin = Number.NaN;
  #lastTraceRevisions: Float64Array = new Float64Array(0);
  #lastTraceCount = 0;

  readonly #effectiveDomain: MutableDomain;
  readonly #domainView: ViewportDomain;

  #decimationPort: DecimationPort | null;
  #settlementSink: SettlementSink | null;

  #rafHandle: number | null = null;
  #resizeObserver: ResizeObserverLike | null = null;

  readonly #onFrame: FrameRequestCallback = () => {
    this.#rafHandle = null;
    if (this.#disposed) return;
    this.render();
  };

  readonly #onPlotContextLost = (event: Event): void => {
    if (
      this.#disposed ||
      this.#activeKind !== "webgl2" ||
      event.target !== this.#boundPlotCanvas
    ) {
      return;
    }

    event.preventDefault();
    if (this.#rafHandle !== null) {
      this.#cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }

    if (this.#contextLost) return;
    this.#contextLost = true;

    const statusMessage = extractStatusMessage(event);
    this.#onContextLost?.({
      activeKind: "webgl2",
      sampleCount: this.#sampleCount,
      mode: this.#mode,
      statusMessage,
    });
  };

  readonly #onPlotContextRestored = (event: Event): void => {
    if (
      this.#disposed ||
      this.#activeKind !== "webgl2" ||
      event.target !== this.#boundPlotCanvas
    ) {
      return;
    }

    if (!this.#contextLost) return;

    const activeRenderer = this.#activeRenderer;
    if (activeRenderer === null) {
      this.#contextLost = false;
      return;
    }

    this.#contextLost = false;
    const restoreSeq = this.#transitionSeq;
    const handle = getRecoveryHandle(activeRenderer);

    if (handle !== null) {
      try {
        handle.rehydrate();
        this.#syncRevisionsAndSampleCount();
        this.render();
        if (
          this.#disposed ||
          this.#transitionSeq !== restoreSeq ||
          this.#activeKind !== "webgl2" ||
          this.#contextLost
        ) {
          return;
        }
        if (handle.isContextLost()) {
          throw new Error("WebGL2 context remained lost immediately after restoration.");
        }
      } catch (error) {
        if (this.#disposed || this.#transitionSeq !== restoreSeq) return;
        this.#fallbackFromBrokenWebGL2Restore(error);
        return;
      }

      if (this.#rafHandle !== null) {
        this.#cancelAnimationFrame(this.#rafHandle);
        this.#rafHandle = null;
      }
      this.#restoreCount += 1;
      this.#onContextRestored?.({
        activeKind: "webgl2",
        sampleCount: this.#sampleCount,
        mode: this.#mode,
        restoreCount: this.#restoreCount,
      });
      return;
    }

    // Custom injected renderer stub without an internal recovery handle:
    // poll pending decimation work and evaluate hysteresis before staging fresh canvases.
    try {
      if (this.#decimationPort !== null && this.#settlementSink !== null) {
        this.#decimationPort.poll(this.#settlementSink);
      }
    } catch (error) {
      if (this.#disposed || this.#transitionSeq !== restoreSeq) return;
      this.#fallbackFromBrokenWebGL2Restore(error);
      return;
    }

    if (
      this.#disposed ||
      this.#transitionSeq !== restoreSeq ||
      this.#activeKind !== "webgl2" ||
      this.#contextLost
    ) {
      return;
    }

    this.#syncRevisionsAndSampleCount();
    if (this.#hysteresisDirty) {
      const desired = resolveDesiredEngine(
        this.#mode,
        this.#activeKind,
        this.#sampleCount,
        this.#hysteresis.downThreshold,
        this.#hysteresis.upThreshold,
        this.#webgl2Fallback,
      );
      if (desired !== this.#activeKind) {
        if (this.#gestureActive) {
          this.#pendingKind = desired;
          this.#hysteresisDirty = false;
        } else {
          const reason: EngineChangeReason =
            this.#mode === "auto" ? "hysteresis-down" : "mode-change";
          this.#transitionTo(desired, reason, true, true);
          return;
        }
      } else {
        this.#pendingKind = null;
        this.#hysteresisDirty = false;
      }
    }

    // Stage 3 fresh canvases and swap atomically without emitting onEngineChange.
    const incomingCanvases: HTMLCanvasElement[] = [
      this.#stageCanvas("webgl2", "underlay", false),
      this.#stageCanvas("webgl2", "plot", false),
      this.#stageCanvas("webgl2", "overlay", true),
    ];
    const incomingPlot = incomingCanvases[1]!;
    let incomingLost = false;
    const onIncomingLost = (): void => {
      incomingLost = true;
    };
    if (typeof incomingPlot.addEventListener === "function") {
      incomingPlot.addEventListener("webglcontextlost", onIncomingLost);
    }

    let incoming: FigureRenderer | null = null;
    try {
      incoming = this.#constructWebGL2(
        incomingCanvases[0]!,
        incomingCanvases[1]!,
        incomingCanvases[2]!,
      );
      this.#replayState(incoming);
      incoming.render();
      const incomingHandle = getRecoveryHandle(incoming);
      if (incomingLost || (incomingHandle !== null && incomingHandle.isContextLost())) {
        throw new Error("WebGL2 context was lost during restoration.");
      }
    } catch (error) {
      if (typeof incomingPlot.removeEventListener === "function") {
        incomingPlot.removeEventListener("webglcontextlost", onIncomingLost);
      }
      try {
        incoming?.dispose();
      } catch {
        // Ignore secondary disposal errors during restore failure unwind.
      }
      if (this.#disposed || this.#transitionSeq !== restoreSeq) return;
      this.#fallbackFromBrokenWebGL2Restore(error);
      return;
    }

    if (typeof incomingPlot.removeEventListener === "function") {
      incomingPlot.removeEventListener("webglcontextlost", onIncomingLost);
    }
    if (this.#rafHandle !== null) {
      this.#cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }
    const committedSeq = this.#commitDomAndSwap(incoming, incomingCanvases, true);
    if (
      this.#disposed ||
      this.#contextLost ||
      this.#transitionSeq !== committedSeq ||
      this.#activeKind !== "webgl2"
    ) {
      return;
    }
    this.#restoreCount += 1;
    this.#onContextRestored?.({
      activeKind: "webgl2",
      sampleCount: this.#sampleCount,
      mode: this.#mode,
      restoreCount: this.#restoreCount,
    });
  };

  readonly #onResize: ResizeObserverCallbackLike = (entries: readonly ResizeObserverEntryLike[]) => {
    if (this.#disposed) return;
    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : undefined;
    let nextWidth = lastEntry !== undefined ? lastEntry.contentRect.width : 0;
    let nextHeight = lastEntry !== undefined ? lastEntry.contentRect.height : 0;
    if (!(Number.isFinite(nextWidth) && nextWidth > 0 && Number.isFinite(nextHeight) && nextHeight > 0)) {
      const rect = this.#container.getBoundingClientRect();
      nextWidth = rect.width;
      nextHeight = rect.height;
    }
    const nextDpr = this.#getDevicePixelRatio();
    if (
      Number.isFinite(nextWidth) &&
      nextWidth > 0 &&
      Number.isFinite(nextHeight) &&
      nextHeight > 0 &&
      Number.isFinite(nextDpr) &&
      nextDpr > 0 &&
      (nextWidth !== this.#width || nextHeight !== this.#height || nextDpr !== this.#dpr)
    ) {
      this.resize(nextWidth, nextHeight, nextDpr);
      this.requestRender();
    }
  };

  constructor(options: SpectrumEngineControllerOptions) {
    // 1. Fail-fast synchronous validation before touching DOM or creating any renderer.
    const hysteresis = resolveHysteresisConfig(options.hysteresis);

    if (options.decimationPort !== undefined && options.settlementSink === undefined) {
      throw new TypeError(
        "createSpectrumEngineController: settlementSink is required when decimationPort is provided.",
      );
    }

    const getDevicePixelRatio = options.getDevicePixelRatio ?? defaultGetDevicePixelRatio;

    let initialWidth: number;
    if (options.initialWidth !== undefined) {
      initialWidth = assertPositiveFinite(options.initialWidth, "initialWidth");
    } else {
      const rectW =
        typeof options.container.getBoundingClientRect === "function"
          ? options.container.getBoundingClientRect().width
          : 0;
      initialWidth = Number.isFinite(rectW) && rectW > 0 ? rectW : DEFAULT_WIDTH_CSS;
    }

    let initialHeight: number;
    if (options.initialHeight !== undefined) {
      initialHeight = assertPositiveFinite(options.initialHeight, "initialHeight");
    } else {
      const rectH =
        typeof options.container.getBoundingClientRect === "function"
          ? options.container.getBoundingClientRect().height
          : 0;
      initialHeight = Number.isFinite(rectH) && rectH > 0 ? rectH : DEFAULT_HEIGHT_CSS;
    }

    let initialDpr: number;
    if (options.initialDpr !== undefined) {
      initialDpr = assertPositiveFinite(options.initialDpr, "initialDpr");
    } else {
      const rawDpr = getDevicePixelRatio();
      initialDpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : DEFAULT_DPR;
    }

    // 2. Initialize immutable config, hooks, and retained state.
    this.#container = options.container;
    this.#hysteresis = hysteresis;
    this.#mode = options.mode ?? "auto";
    this.#style = options.style;
    this.#axes = options.axes;
    this.#yAxes = options.yAxes;
    this.#decimation = options.decimation;
    this.#decimationPort = options.decimationPort ?? null;
    this.#settlementSink = options.settlementSink ?? null;
    this.#onEngineChange = options.onEngineChange;
    this.#onWebGL2Fallback = options.onWebGL2Fallback;
    this.#onContextLost = options.onContextLost;
    this.#onContextRestored = options.onContextRestored;
    this.#createCanvas2DRenderer = options.createCanvas2DRenderer ?? defaultCreateCanvas2DRenderer;
    this.#createWebGL2Renderer = options.createWebGL2Renderer ?? defaultCreateWebGL2Renderer;
    this.#createCanvas =
      options.createCanvas ?? (() => options.container.ownerDocument.createElement("canvas"));
    this.#getDevicePixelRatio = getDevicePixelRatio;
    this.#requestAnimationFrame = options.requestAnimationFrame ?? defaultRequestAnimationFrame;
    this.#cancelAnimationFrame = options.cancelAnimationFrame ?? defaultCancelAnimationFrame;

    this.#width = initialWidth;
    this.#height = initialHeight;
    this.#dpr = initialDpr;

    const firstYAxis =
      options.yAxes !== undefined && options.yAxes.length > 0 ? options.yAxes[0] : undefined;
    const yMin = firstYAxis !== undefined ? firstYAxis.domainMin : -1;
    const yMax = firstYAxis !== undefined ? firstYAxis.domainMax : 1;
    this.#effectiveDomain = { xMin: 0, xMax: 1, yMin, yMax };
    const effectiveDomain = this.#effectiveDomain;
    this.#domainView = Object.freeze({
      get xMin(): number {
        return effectiveDomain.xMin;
      },
      get xMax(): number {
        return effectiveDomain.xMax;
      },
      get yMin(): number {
        return effectiveDomain.yMin;
      },
      get yMax(): number {
        return effectiveDomain.yMax;
      },
    });

    // 3. Establish positioning context on the stable host container.
    ensureContainerPositioning(this.#container);

    // 4. Mount the initial engine ("webgl2" only when mode === "webgl2", else "canvas2d").
    const initialTarget: EngineKind = this.#mode === "webgl2" ? "webgl2" : "canvas2d";
    this.#transitionTo(initialTarget, "init", false, false);

    // 5. Attach ResizeObserver when autoResize !== false.
    if (options.autoResize !== false) {
      const factory =
        options.resizeObserverFactory ??
        (typeof ResizeObserver !== "undefined"
          ? (cb: ResizeObserverCallbackLike): ResizeObserverLike => new ResizeObserver(cb)
          : null);
      if (factory !== null) {
        try {
          const observer = factory(this.#onResize);
          try {
            observer.observe(this.#container);
          } catch (observeError) {
            try {
              observer.disconnect();
            } catch {
              // Ignore secondary disconnect errors during constructor unwind.
            }
            throw observeError;
          }
          this.#resizeObserver = observer;
        } catch (error) {
          this.dispose();
          throw error;
        }
      }
    }
  }

  get activeKind(): EngineKind {
    return this.#activeKind;
  }

  get mode(): EngineSelectionMode {
    return this.#mode;
  }

  get hysteresis(): ResolvedHysteresisConfig {
    return this.#hysteresis;
  }

  get pendingKind(): EngineKind | null {
    return this.#pendingKind;
  }

  get gestureActive(): boolean {
    return this.#gestureActive;
  }

  get webgl2Fallback(): boolean {
    return this.#webgl2Fallback;
  }

  get contextLost(): boolean {
    return this.#contextLost;
  }

  get sampleCount(): number {
    return this.#sampleCount;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get container(): HTMLElement {
    return this.#container;
  }

  get canvases(): readonly HTMLCanvasElement[] {
    return this.#mountedCanvases;
  }

  get transform(): ViewportTransform {
    if (this.#activeRenderer !== null) {
      return this.#activeRenderer.transform;
    }
    if (this.#disposedTransform !== null) {
      return this.#disposedTransform;
    }
    throw new Error(
      "SpectrumEngineController: transform is unavailable before renderer initialization.",
    );
  }

  get domain(): ViewportDomain {
    return this.#domainView;
  }

  get decimation(): DecimationSelection | undefined {
    return this.#decimation;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get dpr(): number {
    return this.#dpr;
  }

  setData(payload: SpectrumDataPayload): void {
    if (this.#disposed) return;
    this.#activeData = payload;
    this.#activeTraces = null;
    this.#lastPayloadRevision = payload.revision;
    this.#sampleCount = computePayloadSampleCount(payload);

    const renderer = this.#activeRenderer;
    if (renderer !== null) {
      renderer.setData(payload);
      if (payload.xOrigin !== this.#lastXOrigin) {
        this.#lastXOrigin = payload.xOrigin;
        renderer.setDomain(
          this.#effectiveDomain.xMin,
          this.#effectiveDomain.xMax,
          this.#effectiveDomain.yMin,
          this.#effectiveDomain.yMax,
        );
      }
    } else {
      this.#lastXOrigin = payload.xOrigin;
    }

    this.#hysteresisDirty = true;
    this.#refreshPendingKind();
  }

  setTraces(collection: TraceCollection): void {
    if (this.#disposed) return;
    this.#activeTraces = collection;
    this.#activeData = null;
    this.#lastPayloadRevision = -1;
    this.#lastXOrigin = Number.NaN;

    this.#effectiveDomain.xMin = collection.xDomainMin;
    this.#effectiveDomain.xMax = collection.xDomainMax;

    const entries = collection.entries;
    const count = entries.length;
    if (count > this.#lastTraceRevisions.length) {
      this.#lastTraceRevisions = new Float64Array(count);
    }
    for (let i = 0; i < count; i += 1) {
      const entry = entries[i];
      this.#lastTraceRevisions[i] = entry !== undefined ? entry.payload.revision : -1;
    }
    this.#lastTraceCount = count;
    this.#sampleCount = computeTracesSampleCount(collection);

    const renderer = this.#activeRenderer;
    if (renderer !== null) {
      renderer.setTraces(collection);
      renderer.setDomain(
        this.#effectiveDomain.xMin,
        this.#effectiveDomain.xMax,
        this.#effectiveDomain.yMin,
        this.#effectiveDomain.yMax,
      );
    }

    this.#hysteresisDirty = true;
    this.#refreshPendingKind();
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    this.#effectiveDomain.xMin = xMin;
    this.#effectiveDomain.xMax = xMax;
    this.#effectiveDomain.yMin = yMin;
    this.#effectiveDomain.yMax = yMax;
    this.#activeRenderer?.setDomain(xMin, xMax, yMin, yMax);
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
    const validW = assertPositiveFinite(width, "width");
    const validH = assertPositiveFinite(height, "height");
    const validDpr = assertPositiveFinite(dpr, "dpr");
    this.#width = validW;
    this.#height = validH;
    this.#dpr = validDpr;
    this.#activeRenderer?.resize(validW, validH, validDpr);
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    if (this.#disposed) return;
    this.#decimation = selection;
    this.#activeRenderer?.setDecimation(selection);
  }

  setMode(mode: EngineSelectionMode): void {
    if (this.#disposed) return;
    this.#mode = mode;
    if (mode === "webgl2") {
      this.#webgl2Fallback = false;
    }
    this.#syncRevisionsAndSampleCount();
    this.#hysteresisDirty = true;

    const desired = resolveDesiredEngine(
      this.#mode,
      this.#activeKind,
      this.#sampleCount,
      this.#hysteresis.downThreshold,
      this.#hysteresis.upThreshold,
      this.#webgl2Fallback,
    );

    if (this.#gestureActive) {
      this.#pendingKind = desired !== this.#activeKind ? desired : null;
      return;
    }

    if (desired !== this.#activeKind) {
      const shouldPreRender = this.#activeData !== null || this.#activeTraces !== null;
      this.#transitionTo(desired, "mode-change", shouldPreRender, shouldPreRender);
      return;
    }

    this.#pendingKind = null;
    this.#hysteresisDirty = false;
  }

  setGestureActive(active: boolean): void {
    if (this.#disposed || this.#gestureActive === active) return;
    this.#gestureActive = active;
    this.#hysteresisDirty = true;

    if (active) {
      this.#refreshPendingKind();
      return;
    }

    this.#syncRevisionsAndSampleCount();
    const desired = resolveDesiredEngine(
      this.#mode,
      this.#activeKind,
      this.#sampleCount,
      this.#hysteresis.downThreshold,
      this.#hysteresis.upThreshold,
      this.#webgl2Fallback,
    );

    if (desired !== this.#activeKind) {
      const shouldPreRender = this.#activeData !== null || this.#activeTraces !== null;
      this.#transitionTo(desired, "gesture-end", shouldPreRender, shouldPreRender);
      return;
    }

    this.#pendingKind = null;
    this.#hysteresisDirty = false;
  }

  retryWebGL2(): boolean {
    if (this.#disposed) return false;
    if (this.#activeKind === "webgl2" && this.#contextLost) {
      return false;
    }
    this.#webgl2Fallback = false;
    this.#syncRevisionsAndSampleCount();
    this.#hysteresisDirty = true;

    const desired = resolveDesiredEngine(
      this.#mode,
      this.#activeKind,
      this.#sampleCount,
      this.#hysteresis.downThreshold,
      this.#hysteresis.upThreshold,
      this.#webgl2Fallback,
    );

    if (this.#gestureActive) {
      this.#pendingKind = desired !== this.#activeKind ? desired : null;
      return this.#activeKind === "webgl2" && !this.#contextLost;
    }

    if (desired === "webgl2" && this.#activeKind !== "webgl2") {
      const shouldPreRender = this.#activeData !== null || this.#activeTraces !== null;
      this.#transitionTo("webgl2", "webgl2-retry", shouldPreRender, shouldPreRender);
    } else {
      this.#pendingKind = null;
      this.#hysteresisDirty = false;
    }

    return this.#activeKind === "webgl2" && !this.#contextLost;
  }

  render(): void {
    if (this.#disposed) return;

    if (this.#rafHandle !== null) {
      this.#cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }

    if (this.#decimationPort !== null && this.#settlementSink !== null) {
      this.#decimationPort.poll(this.#settlementSink);
      if (this.#disposed) return;
    }

    this.#syncRevisionsAndSampleCount();

    if (this.#hysteresisDirty) {
      const desired = resolveDesiredEngine(
        this.#mode,
        this.#activeKind,
        this.#sampleCount,
        this.#hysteresis.downThreshold,
        this.#hysteresis.upThreshold,
        this.#webgl2Fallback,
      );

      if (desired !== this.#activeKind) {
        if (this.#gestureActive) {
          this.#pendingKind = desired;
          this.#hysteresisDirty = false;
        } else {
          const reason: EngineChangeReason =
            this.#mode === "auto"
              ? desired === "webgl2"
                ? "hysteresis-up"
                : "hysteresis-down"
              : "mode-change";
          this.#transitionTo(desired, reason, true);
          return;
        }
      } else {
        this.#pendingKind = null;
        this.#hysteresisDirty = false;
      }
    }

    if (this.#contextLost) return;
    this.#activeRenderer?.render();
  }

  requestRender(): void {
    if (this.#disposed || this.#rafHandle !== null) return;
    if (this.#contextLost && !(this.#pendingKind === "canvas2d" && !this.#gestureActive)) {
      return;
    }
    this.#rafHandle = this.#requestAnimationFrame(this.#onFrame);
  }

  clear(): void {
    if (this.#disposed || this.#contextLost) return;
    this.#activeRenderer?.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#detachContextListeners();
    this.#contextLost = false;

    if (this.#rafHandle !== null) {
      this.#cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }

    if (this.#resizeObserver !== null) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }

    const activeRenderer = this.#activeRenderer;
    if (activeRenderer !== null) {
      this.#disposedTransform = activeRenderer.transform;
      this.#activeRenderer = null;
      activeRenderer.dispose();
    }

    const canvases = this.#mountedCanvases;
    for (let i = 0; i < canvases.length; i += 1) {
      canvases[i]?.remove();
    }
    this.#mountedCanvases = EMPTY_CANVASES;

    // Release caller-owned references without calling decimationPort.dispose().
    this.#activeData = null;
    this.#activeTraces = null;
    this.#decimationPort = null;
    this.#settlementSink = null;
    this.#pendingKind = null;
    this.#hysteresisDirty = false;
  }

  #refreshPendingKind(): void {
    const desired = resolveDesiredEngine(
      this.#mode,
      this.#activeKind,
      this.#sampleCount,
      this.#hysteresis.downThreshold,
      this.#hysteresis.upThreshold,
      this.#webgl2Fallback,
    );
    this.#pendingKind = desired !== this.#activeKind ? desired : null;
  }

  #syncRevisionsAndSampleCount(): void {
    const payload = this.#activeData;
    if (payload !== null) {
      if (payload.revision !== this.#lastPayloadRevision) {
        this.#lastPayloadRevision = payload.revision;
        this.#sampleCount = computePayloadSampleCount(payload);
        this.#hysteresisDirty = true;
      }
      if (payload.xOrigin !== this.#lastXOrigin) {
        this.#lastXOrigin = payload.xOrigin;
        this.#activeRenderer?.setDomain(
          this.#effectiveDomain.xMin,
          this.#effectiveDomain.xMax,
          this.#effectiveDomain.yMin,
          this.#effectiveDomain.yMax,
        );
      }
      return;
    }

    const traces = this.#activeTraces;
    if (traces !== null) {
      const entries = traces.entries;
      const count = entries.length;
      let changed = count !== this.#lastTraceCount;
      if (count > this.#lastTraceRevisions.length) {
        this.#lastTraceRevisions = new Float64Array(count);
        changed = true;
      }
      for (let i = 0; i < count; i += 1) {
        const entry = entries[i];
        const rev = entry !== undefined ? entry.payload.revision : -1;
        if (this.#lastTraceRevisions[i] !== rev) {
          this.#lastTraceRevisions[i] = rev;
          changed = true;
        }
      }
      if (changed) {
        this.#lastTraceCount = count;
        this.#sampleCount = computeTracesSampleCount(traces);
        this.#hysteresisDirty = true;
      }
    }
  }

  #stageCanvas(engine: EngineKind, layer: string, pointerEventsNone: boolean): HTMLCanvasElement {
    const canvas = this.#createCanvas();
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    if (pointerEventsNone) {
      canvas.style.pointerEvents = "none";
    }
    canvas.setAttribute("data-trace-kit-engine", engine);
    canvas.setAttribute("data-trace-kit-layer", layer);
    return canvas;
  }

  #constructCanvas2D(surface: HTMLCanvasElement): FigureRenderer {
    const opts: Canvas2DRendererOptions = {
      surface,
      ...(this.#style !== undefined ? { style: this.#style } : {}),
      ...(this.#axes !== undefined ? { axes: this.#axes } : {}),
      ...(this.#yAxes !== undefined ? { yAxes: this.#yAxes } : {}),
      ...(this.#decimation !== undefined ? { decimation: this.#decimation } : {}),
    };
    return this.#createCanvas2DRenderer(opts);
  }

  #constructWebGL2(
    underlay: HTMLCanvasElement,
    plot: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
  ): FigureRenderer {
    const opts: WebGL2FigureRendererOptions = {
      surfaces: { underlay, plot, overlay },
      ...(this.#style !== undefined ? { style: this.#style } : {}),
      ...(this.#axes !== undefined ? { axes: this.#axes } : {}),
      ...(this.#yAxes !== undefined ? { yAxes: this.#yAxes } : {}),
      ...(this.#decimation !== undefined ? { decimation: this.#decimation } : {}),
    };
    return this.#createWebGL2Renderer(opts);
  }

  #replayState(incoming: FigureRenderer): void {
    incoming.resize(this.#width, this.#height, this.#dpr);
    if (this.#activeData !== null) {
      incoming.setData(this.#activeData);
    } else if (this.#activeTraces !== null) {
      incoming.setTraces(this.#activeTraces);
    }
    incoming.setDomain(
      this.#effectiveDomain.xMin,
      this.#effectiveDomain.xMax,
      this.#effectiveDomain.yMin,
      this.#effectiveDomain.yMax,
    );
    incoming.setDecimation(this.#decimation);
  }

  #attachContextListeners(plotCanvas: HTMLCanvasElement): void {
    this.#detachContextListeners();
    this.#boundPlotCanvas = plotCanvas;
    if (typeof plotCanvas.addEventListener === "function") {
      plotCanvas.addEventListener("webglcontextlost", this.#onPlotContextLost);
      plotCanvas.addEventListener("webglcontextrestored", this.#onPlotContextRestored);
    }
  }

  #detachContextListeners(): void {
    const canvas = this.#boundPlotCanvas;
    this.#boundPlotCanvas = null;
    if (canvas !== null && typeof canvas.removeEventListener === "function") {
      canvas.removeEventListener("webglcontextlost", this.#onPlotContextLost);
      canvas.removeEventListener("webglcontextrestored", this.#onPlotContextRestored);
    }
  }

  #commitDomAndSwap(
    incoming: FigureRenderer,
    incomingCanvases: readonly HTMLCanvasElement[],
    ignoreOutgoingDisposeError = false,
  ): number {
    this.#detachContextListeners();
    this.#contextLost = false;

    const outgoing = this.#activeRenderer;
    const outgoingCanvases = this.#mountedCanvases;
    const firstOutgoing = outgoingCanvases[0];
    const anchor =
      firstOutgoing !== undefined && firstOutgoing.parentNode === this.#container
        ? firstOutgoing
        : this.#container.firstChild;

    for (let i = 0; i < incomingCanvases.length; i += 1) {
      const canvas = incomingCanvases[i];
      if (canvas !== undefined) {
        this.#container.insertBefore(canvas, anchor);
      }
    }

    for (let i = 0; i < outgoingCanvases.length; i += 1) {
      outgoingCanvases[i]?.remove();
    }

    this.#activeRenderer = incoming;
    this.#activeKind = incoming.kind;
    this.#mountedCanvases = Object.freeze(incomingCanvases);
    this.#pendingKind = null;
    this.#hysteresisDirty = false;
    const committedSeq = ++this.#transitionSeq;

    try {
      if (outgoing !== null) {
        if (ignoreOutgoingDisposeError) {
          try {
            outgoing.dispose();
          } catch {
            // Ignore secondary disposal errors from a broken outgoing renderer.
          }
        } else {
          outgoing.dispose();
        }
      }
    } finally {
      if (
        !this.#disposed &&
        this.#transitionSeq === committedSeq &&
        this.#activeRenderer === incoming &&
        incoming.kind === "webgl2"
      ) {
        const plotCanvas = incomingCanvases[1];
        if (plotCanvas !== undefined) {
          this.#attachContextListeners(plotCanvas);
        }
      }
    }

    return committedSeq;
  }

  #mountFallbackCanvas2D(preRender: boolean, ignoreOutgoingDisposeError = false): number {
    const surface = this.#stageCanvas("canvas2d", "canvas2d", false);
    const fallbackRenderer = this.#constructCanvas2D(surface);
    this.#replayState(fallbackRenderer);
    if (preRender) {
      fallbackRenderer.render();
    }
    return this.#commitDomAndSwap(fallbackRenderer, [surface], ignoreOutgoingDisposeError);
  }

  #fallbackFromBrokenWebGL2Restore(error: unknown): void {
    this.#detachContextListeners();
    this.#contextLost = false;
    this.#webgl2Fallback = true;
    this.#pendingKind = null;
    this.#hysteresisDirty = false;

    const preRender = this.#activeData !== null || this.#activeTraces !== null;
    const fallbackSeq = this.#mountFallbackCanvas2D(preRender, true);

    if (this.#rafHandle !== null) {
      this.#cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }

    if (this.#disposed || this.#transitionSeq !== fallbackSeq) return;

    const attemptedMode = this.#mode;
    const fallbackSampleCount = this.#sampleCount;

    this.#onWebGL2Fallback?.({
      error,
      attemptedMode,
      sampleCount: fallbackSampleCount,
    });

    if (this.#disposed || this.#transitionSeq !== fallbackSeq) return;

    this.#onEngineChange?.({
      previousKind: "webgl2",
      activeKind: "canvas2d",
      sampleCount: fallbackSampleCount,
      mode: attemptedMode,
      reason: "webgl2-fallback",
    });
  }

  #transitionTo(
    targetKind: EngineKind,
    reason: EngineChangeReason,
    preRender: boolean,
    cancelPendingRaf = false,
  ): void {
    const previousKind: EngineKind | null =
      this.#activeRenderer === null ? null : this.#activeKind;

    // Step 1: Stage fresh unmounted <canvas> element(s) for the incoming engine.
    let incomingCanvases: HTMLCanvasElement[];
    let stagedPlotCanvas: HTMLCanvasElement | null = null;
    let incomingLost = false;
    const onIncomingLost = (): void => {
      incomingLost = true;
    };

    if (targetKind === "webgl2") {
      incomingCanvases = [
        this.#stageCanvas("webgl2", "underlay", false),
        this.#stageCanvas("webgl2", "plot", false),
        this.#stageCanvas("webgl2", "overlay", true),
      ];
      stagedPlotCanvas = incomingCanvases[1] ?? null;
      if (stagedPlotCanvas !== null && typeof stagedPlotCanvas.addEventListener === "function") {
        stagedPlotCanvas.addEventListener("webglcontextlost", onIncomingLost);
      }
    } else {
      incomingCanvases = [this.#stageCanvas("canvas2d", "canvas2d", false)];
    }

    const detachStagedListener = (): void => {
      if (stagedPlotCanvas !== null && typeof stagedPlotCanvas.removeEventListener === "function") {
        stagedPlotCanvas.removeEventListener("webglcontextlost", onIncomingLost);
      }
      stagedPlotCanvas = null;
    };

    // Steps 2–4: Construct, replay authoritative state in strict order, and pre-paint.
    let incoming: FigureRenderer | null = null;
    try {
      incoming =
        targetKind === "webgl2"
          ? this.#constructWebGL2(incomingCanvases[0]!, incomingCanvases[1]!, incomingCanvases[2]!)
          : this.#constructCanvas2D(incomingCanvases[0]!);
      this.#replayState(incoming);
      if (preRender) {
        incoming.render();
      }
      if (targetKind === "webgl2") {
        const handle = getRecoveryHandle(incoming);
        if (incomingLost || (handle !== null && handle.isContextLost())) {
          throw new Error("WebGL2 context was lost during engine switch.");
        }
      }
    } catch (error) {
      detachStagedListener();
      // Clean up any partially constructed incoming renderer before discarding staged canvases.
      try {
        incoming?.dispose();
      } catch {
        // Ignore secondary disposal errors during failure unwind.
      }

      if (targetKind !== "webgl2") {
        throw error;
      }

      // Leak-free deterministic fallback to Canvas2D.
      this.#webgl2Fallback = true;
      this.#contextLost = false;
      this.#pendingKind = null;
      this.#hysteresisDirty = false;

      let fallbackSeq: number;
      if (this.#activeRenderer === null || this.#activeKind !== "canvas2d") {
        fallbackSeq = this.#mountFallbackCanvas2D(preRender);
      } else {
        if (preRender) {
          this.#activeRenderer.render();
        }
        fallbackSeq = ++this.#transitionSeq;
      }

      // Cancel only a pre-existing redundant rAF before user callbacks so a
      // re-entrant requestRender() inside callbacks is preserved.
      if (cancelPendingRaf && this.#rafHandle !== null) {
        this.#cancelAnimationFrame(this.#rafHandle);
        this.#rafHandle = null;
      }

      if (this.#disposed || this.#transitionSeq !== fallbackSeq) return;

      const attemptedMode = this.#mode;
      const fallbackSampleCount = this.#sampleCount;

      // Invoke fallback and engine-change callbacks only AFTER Canvas2D is mounted and active.
      this.#onWebGL2Fallback?.({
        error,
        attemptedMode,
        sampleCount: fallbackSampleCount,
      });

      if (this.#disposed || this.#transitionSeq !== fallbackSeq) return;

      if (previousKind === null || previousKind === "webgl2") {
        this.#onEngineChange?.({
          previousKind,
          activeKind: "canvas2d",
          sampleCount: fallbackSampleCount,
          mode: attemptedMode,
          reason: "webgl2-fallback",
        });
      }
      return;
    }

    // Step 5: Atomic DOM swap, state update, outgoing disposal, active listener binding, and notification.
    detachStagedListener();
    const nextSampleCount = this.#sampleCount;
    const nextMode = this.#mode;
    const nextKind = incoming.kind;
    const committedSeq = this.#commitDomAndSwap(incoming, incomingCanvases);

    // Cancel only a pre-existing redundant rAF before user callbacks so a
    // re-entrant requestRender() inside onEngineChange is preserved.
    if (cancelPendingRaf && this.#rafHandle !== null) {
      this.#cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }

    if (this.#disposed || this.#transitionSeq !== committedSeq) return;

    this.#onEngineChange?.({
      previousKind,
      activeKind: nextKind,
      sampleCount: nextSampleCount,
      mode: nextMode,
      reason,
    });
  }
}

/**
 * Creates a `SpectrumEngineController` managing automatic hysteresis-stabilized switching
 * between `Canvas2DRenderer` and `WebGL2FigureRenderer` inside `options.container`.
 */
export function createSpectrumEngineController(
  options: SpectrumEngineControllerOptions,
): SpectrumEngineController {
  return new SpectrumEngineControllerImpl(options);
}
