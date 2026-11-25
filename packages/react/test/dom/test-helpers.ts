import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  createViewportTransform,
  type DecimationSelection,
  type SpectrumDataPayload,
  type TraceCollection,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import type {
  Canvas2DRendererOptions,
  FigureRenderer,
  FigureRendererKind,
} from "@trace-kit/renderers";
import type {
  ResizeObserverCallbackLike,
  ResizeObserverLike,
} from "@trace-kit/renderers/controller";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SpectrumEnginePlatformOptions } from "../../src/types.js";

/** Enables React 18/19 `act(...)` testing environment flag in happy-dom. */
export function enableReactActEnvironment(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

export interface MountedReactTree {
  readonly host: HTMLDivElement;
  readonly root: Root;
  rerender(node: ReactNode): void;
  unmount(): void;
}

export function mountReact(node: ReactNode, width = 800, height = 400): MountedReactTree {
  enableReactActEnvironment();
  const host = createMountedHost(width, height);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    root,
    rerender(nextNode: ReactNode): void {
      act(() => {
        root.render(nextNode);
      });
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

export interface ResizableSurface {
  width: number;
  height: number;
}

export class StubFigureRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  readonly #surfaces: readonly ResizableSurface[];
  #disposed = false;
  #width = 800;
  #height = 400;
  #dpr = 1;
  #xMin = 0;
  #xMax = 100;
  #yMin = -1;
  #yMax = 1;
  #transform: ViewportTransform;

  readonly callLog: string[] = [];
  readonly setDataCalls: SpectrumDataPayload[] = [];
  readonly setTracesCalls: TraceCollection[] = [];
  readonly setDomainCalls: Array<{
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  }> = [];
  readonly setDecimationCalls: Array<DecimationSelection | undefined> = [];
  readonly resizeCalls: Array<{
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
  }> = [];
  renderCount = 0;
  clearCount = 0;
  disposeCount = 0;
  lastRenderedSampleCount = 0;
  #lastPayload: SpectrumDataPayload | null = null;
  #lastTraces: TraceCollection | null = null;

  constructor(kind: FigureRendererKind, surfaces: readonly ResizableSurface[]) {
    this.kind = kind;
    this.#surfaces = surfaces;
    this.#transform = this.#computeTransform();
  }

  #computeTransform(): ViewportTransform {
    return createViewportTransform({
      cssWidth: this.#width,
      cssHeight: this.#height,
      dpr: this.#dpr,
      insetLeft: 40,
      insetRight: 16,
      insetTop: 16,
      insetBottom: 32,
      xDomainMin: this.#xMin,
      xDomainMax: this.#xMax,
      yDomainMin: this.#yMin,
      yDomainMax: this.#yMax,
      xOrigin: 0,
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get transform(): ViewportTransform {
    return this.#transform;
  }

  setData(payload: SpectrumDataPayload): void {
    if (this.#disposed) return;
    this.callLog.push("setData");
    this.#lastPayload = payload;
    this.#lastTraces = null;
    this.setDataCalls.push(payload);
  }

  setTraces(collection: TraceCollection): void {
    if (this.#disposed) return;
    this.callLog.push("setTraces");
    this.#lastTraces = collection;
    this.#lastPayload = null;
    this.setTracesCalls.push(collection);
    this.#xMin = collection.xDomainMin;
    this.#xMax = collection.xDomainMax;
    this.#transform = this.#computeTransform();
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    this.callLog.push("setDomain");
    this.setDomainCalls.push({ xMin, xMax, yMin, yMax });
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
    this.#transform = this.#computeTransform();
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
    this.callLog.push("resize");
    this.resizeCalls.push({ width, height, dpr });
    this.#width = width;
    this.#height = height;
    this.#dpr = dpr;
    const devW = Math.round(width * dpr);
    const devH = Math.round(height * dpr);
    for (let i = 0; i < this.#surfaces.length; i += 1) {
      const surface = this.#surfaces[i];
      if (surface !== undefined) {
        surface.width = devW;
        surface.height = devH;
      }
    }
    this.#transform = this.#computeTransform();
  }

  render(): void {
    if (this.#disposed) return;
    this.callLog.push("render");
    this.renderCount += 1;
    if (this.#lastPayload !== null) {
      this.lastRenderedSampleCount = this.#lastPayload.sampleCount;
    } else if (this.#lastTraces !== null) {
      let total = 0;
      for (let i = 0; i < this.#lastTraces.entries.length; i += 1) {
        const entry = this.#lastTraces.entries[i];
        if (entry !== undefined) {
          total += entry.payload.sampleCount;
        }
      }
      this.lastRenderedSampleCount = total;
    }
  }

  clear(): void {
    if (this.#disposed) return;
    this.callLog.push("clear");
    this.clearCount += 1;
    this.#lastPayload = null;
    this.#lastTraces = null;
    this.lastRenderedSampleCount = 0;
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    if (this.#disposed) return;
    this.callLog.push("setDecimation");
    this.setDecimationCalls.push(selection);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.callLog.push("dispose");
    this.#disposed = true;
    this.disposeCount += 1;
  }
}

export interface ManualRafController {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  flush(timestamp?: number): number;
  flushAll(maxRounds?: number): number;
  scheduleCount(): number;
  pendingCount(): number;
  resetScheduleCount(): void;
}

export function createManualRaf(): ManualRafController {
  let nextId = 1;
  let scheduled = 0;
  const queue = new Map<number, FrameRequestCallback>();

  return {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      scheduled += 1;
      const id = nextId++;
      queue.set(id, callback);
      return id;
    },
    cancelAnimationFrame(handle: number): void {
      queue.delete(handle);
    },
    flush(timestamp = 16): number {
      const entries = Array.from(queue.entries());
      queue.clear();
      for (const [, cb] of entries) {
        cb(timestamp);
      }
      return entries.length;
    },
    flushAll(maxRounds = 10): number {
      let total = 0;
      for (let i = 0; i < maxRounds && queue.size > 0; i += 1) {
        total += this.flush(16 * (i + 1));
      }
      return total;
    },
    scheduleCount(): number {
      return scheduled;
    },
    pendingCount(): number {
      return queue.size;
    },
    resetScheduleCount(): void {
      scheduled = 0;
    },
  };
}

export interface TrackedResizeObserverEntry {
  readonly callback: ResizeObserverCallbackLike;
  readonly targets: Set<Element>;
  disconnected: boolean;
}

export interface MockResizeObserverHub {
  readonly factory: (callback: ResizeObserverCallbackLike) => ResizeObserverLike;
  readonly instances: TrackedResizeObserverEntry[];
  activeCount(): number;
  triggerAll(width: number, height: number): void;
}

export function createMockResizeObserverHub(): MockResizeObserverHub {
  const instances: TrackedResizeObserverEntry[] = [];

  return {
    factory(callback: ResizeObserverCallbackLike): ResizeObserverLike {
      const entry: TrackedResizeObserverEntry = {
        callback,
        targets: new Set<Element>(),
        disconnected: false,
      };
      instances.push(entry);
      return {
        observe(target: Element): void {
          if (!entry.disconnected) {
            entry.targets.add(target);
          }
        },
        disconnect(): void {
          entry.disconnected = true;
          entry.targets.clear();
        },
      };
    },
    instances,
    activeCount(): number {
      return instances.filter((entry) => !entry.disconnected).length;
    },
    triggerAll(width: number, height: number): void {
      for (const entry of instances) {
        if (!entry.disconnected && entry.targets.size > 0) {
          entry.callback([{ contentRect: { width, height } }]);
        }
      }
    },
  };
}

export interface MockPlatformHarness {
  readonly platform: SpectrumEnginePlatformOptions;
  readonly raf: ManualRafController;
  readonly resizeObservers: MockResizeObserverHub;
  readonly canvas2dRenderers: StubFigureRenderer[];
  readonly webgl2Renderers: StubFigureRenderer[];
  readonly canvas2dOptions: Canvas2DRendererOptions[];
  readonly webgl2Options: Array<
    Parameters<NonNullable<SpectrumEnginePlatformOptions["createWebGL2Renderer"]>>[0]
  >;
  readonly createdCanvases: HTMLCanvasElement[];
  setWebGL2ShouldFail(fail: boolean, message?: string): void;
}

export function createMockPlatform(options?: {
  readonly dpr?: number;
  readonly webgl2ShouldFail?: boolean;
  readonly webgl2FailureMessage?: string;
}): MockPlatformHarness {
  const raf = createManualRaf();
  const resizeObservers = createMockResizeObserverHub();
  const canvas2dRenderers: StubFigureRenderer[] = [];
  const webgl2Renderers: StubFigureRenderer[] = [];
  const canvas2dOptions: Canvas2DRendererOptions[] = [];
  const webgl2Options: Array<
    Parameters<NonNullable<SpectrumEnginePlatformOptions["createWebGL2Renderer"]>>[0]
  > = [];
  const createdCanvases: HTMLCanvasElement[] = [];

  let webgl2Fail = options?.webgl2ShouldFail ?? false;
  let webgl2FailMessage = options?.webgl2FailureMessage ?? "WebGL2 unavailable in mock";
  const dpr = options?.dpr ?? 1;

  const platform: SpectrumEnginePlatformOptions = {
    createCanvas2DRenderer(opts) {
      canvas2dOptions.push(opts);
      const renderer = new StubFigureRenderer("canvas2d", [opts.surface]);
      canvas2dRenderers.push(renderer);
      return renderer;
    },
    createWebGL2Renderer(opts) {
      webgl2Options.push(opts);
      if (webgl2Fail) {
        throw new Error(webgl2FailMessage);
      }
      const renderer = new StubFigureRenderer("webgl2", [
        opts.surfaces.underlay,
        opts.surfaces.plot,
        opts.surfaces.overlay,
      ]);
      webgl2Renderers.push(renderer);
      return renderer;
    },
    createCanvas(): HTMLCanvasElement {
      const canvas = document.createElement("canvas");
      createdCanvases.push(canvas);
      return canvas;
    },
    resizeObserverFactory: resizeObservers.factory,
    getDevicePixelRatio(): number {
      return dpr;
    },
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
  };

  return {
    platform,
    raf,
    resizeObservers,
    canvas2dRenderers,
    webgl2Renderers,
    canvas2dOptions,
    webgl2Options,
    createdCanvases,
    setWebGL2ShouldFail(fail: boolean, message?: string): void {
      webgl2Fail = fail;
      if (message !== undefined) {
        webgl2FailMessage = message;
      }
    },
  };
}

export function createTestPayload(
  sampleCount: number,
  options?: {
    readonly capacity?: number;
    readonly xOrigin?: number;
    readonly xStart?: number;
    readonly xEnd?: number;
  },
): SpectrumDataPayload {
  const capacity = Math.max(1, options?.capacity ?? sampleCount);
  const payload = createSpectrumDataPayload({
    capacity,
    xOrigin: options?.xOrigin ?? 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  const xStart = options?.xStart ?? 0;
  const xEnd = options?.xEnd ?? 100;
  const denom = Math.max(1, sampleCount - 1);
  for (let i = 0; i < sampleCount; i += 1) {
    payload.x[i] = xStart + ((xEnd - xStart) * i) / denom;
    payload.y[i] = -60 + 20 * Math.sin(i * 0.1);
  }
  if (sampleCount > 0) {
    commitPayloadRevision(payload, sampleCount);
  }
  return payload;
}

export function createTestTraceCollection(
  xMin = 0,
  xMax = 100,
  sampleCount = 64,
): TraceCollection {
  const payload = createTestPayload(sampleCount, { xStart: xMin, xEnd: xMax });
  const axes: readonly YAxisRegistration[] = [
    {
      id: "y0",
      scaleKind: Y_SCALE_KIND_LINEAR,
      side: AXIS_SIDE_LEFT,
      domainMin: -100,
      domainMax: 20,
    },
  ];
  return createTraceCollection(
    [
      {
        id: "trace-a",
        payload,
        yAxisId: "y0",
        style: { color: "#38bdf8", lineWidthCss: 1.5 },
      },
    ],
    axes,
    xMin,
    xMax,
  );
}

export function createWheelEvent(
  init: {
    readonly clientX?: number;
    readonly clientY?: number;
    readonly deltaX?: number;
    readonly deltaY?: number;
    readonly deltaMode?: number;
    readonly shiftKey?: boolean;
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
  } = {},
): WheelEvent {
  const clientX = init.clientX ?? 400;
  const clientY = init.clientY ?? 200;
  const shiftKey = init.shiftKey ?? false;
  const altKey = init.altKey ?? false;
  const ctrlKey = init.ctrlKey ?? false;
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? -120,
    deltaMode: init.deltaMode ?? 0,
    shiftKey,
    altKey,
    ctrlKey,
  });
  if (typeof event.clientX !== "number") {
    Object.defineProperties(event, {
      clientX: { value: clientX, configurable: true },
      clientY: { value: clientY, configurable: true },
      shiftKey: { value: shiftKey, configurable: true },
      altKey: { value: altKey, configurable: true },
      ctrlKey: { value: ctrlKey, configurable: true },
    });
  }
  return event;
}

export function createMountedHost(width = 800, height = 400): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  document.body.appendChild(el);
  return el;
}

export function mockElementBoundingRect(
  el: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON(): Record<string, number> {
        return {
          x: rect.left,
          y: rect.top,
          left: rect.left,
          top: rect.top,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          width: rect.width,
          height: rect.height,
        };
      },
    }),
  });
}
