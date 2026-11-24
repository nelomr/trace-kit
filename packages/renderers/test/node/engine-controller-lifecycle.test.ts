/** @vitest-environment node */
import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createSyncDecimationPort,
  createViewportTransform,
  type DecimationPort,
  type DecimationSelection,
  type SettlementSink,
  type SpectrumDataPayload,
  type TraceCollection,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import { describe, expect, it, vi } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import {
  createSpectrumEngineController,
  type EngineChangeEvent,
  type ResizeObserverLike,
  type SpectrumEngineController,
  type WebGL2FallbackEvent,
} from "../../src/controller/index.js";
import {
  RecordingContext,
  installRecordingPath2D,
  recordingSurface,
} from "./support/recording-context.js";

interface StubCanvasRecord {
  readonly id: number;
  width: number;
  height: number;
  readonly style: Record<string, string>;
  readonly attrs: Map<string, string>;
  parent: StubContainerRecord | null;
  parentNode: StubContainerRecord | null;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove(): void;
}

interface StubContainerRecord {
  readonly style: Record<string, string>;
  readonly children: StubCanvasRecord[];
  readonly firstChild: StubCanvasRecord | null;
  readonly ownerDocument: { createElement(tag: string): HTMLCanvasElement };
  getBoundingClientRect(): { width: number; height: number };
  insertBefore(node: StubCanvasRecord, reference: StubCanvasRecord | null): StubCanvasRecord;
}

function createStubHost(log?: string[]): {
  container: HTMLElement;
  containerRecord: StubContainerRecord;
  createdCanvases: StubCanvasRecord[];
  createCanvas: () => HTMLCanvasElement;
} {
  let nextId = 1;
  const createdCanvases: StubCanvasRecord[] = [];

  const createCanvasStub = (): StubCanvasRecord => {
    const record: StubCanvasRecord = {
      id: nextId++,
      width: 0,
      height: 0,
      style: {},
      attrs: new Map<string, string>(),
      parent: null,
      parentNode: null,
      setAttribute(name: string, value: string): void {
        record.attrs.set(name, value);
      },
      getAttribute(name: string): string | null {
        return record.attrs.get(name) ?? null;
      },
      remove(): void {
        if (record.parent === null) return;
        const idx = record.parent.children.indexOf(record);
        if (idx >= 0) {
          record.parent.children.splice(idx, 1);
          log?.push(`dom:remove:${record.attrs.get("data-trace-kit-layer") ?? record.id}`);
        }
        record.parent = null;
        record.parentNode = null;
      },
    };
    createdCanvases.push(record);
    return record;
  };

  const createCanvas = (): HTMLCanvasElement => {
    const stub = createCanvasStub();
    // eslint-disable-next-line no-restricted-syntax -- test double for HTMLCanvasElement unavailable under node
    return stub as unknown as HTMLCanvasElement;
  };

  const containerRecord: StubContainerRecord = {
    style: { position: "" },
    children: [],
    get firstChild(): StubCanvasRecord | null {
      return containerRecord.children[0] ?? null;
    },
    ownerDocument: {
      createElement(): HTMLCanvasElement {
        return createCanvas();
      },
    },
    getBoundingClientRect(): { width: number; height: number } {
      return { width: 640, height: 400 };
    },
    insertBefore(node: StubCanvasRecord, reference: StubCanvasRecord | null): StubCanvasRecord {
      const existingIdx = containerRecord.children.indexOf(node);
      if (existingIdx >= 0) containerRecord.children.splice(existingIdx, 1);
      if (reference === null) {
        containerRecord.children.push(node);
      } else {
        const refIdx = containerRecord.children.indexOf(reference);
        if (refIdx >= 0) {
          containerRecord.children.splice(refIdx, 0, node);
        } else {
          containerRecord.children.push(node);
        }
      }
      node.parent = containerRecord;
      node.parentNode = containerRecord;
      log?.push(`dom:insert:${node.attrs.get("data-trace-kit-layer") ?? node.id}`);
      return node;
    },
  };

  // eslint-disable-next-line no-restricted-syntax -- test double for HTMLElement unavailable under node
  const container = containerRecord as unknown as HTMLElement;
  return { container, containerRecord, createdCanvases, createCanvas };
}

class RecordingFakeRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  readonly tag: string;
  #disposed = false;
  #transform: ViewportTransform;
  #xOrigin = 0;
  #xMin = 0;
  #xMax = 1;
  #yMin = -1;
  #yMax = 1;
  #width = 640;
  #height = 400;
  #dpr = 1;

  readonly calls: string[] = [];
  readonly #sharedLog: string[] | undefined;
  readonly #surfaces: readonly StubCanvasRecord[];
  readonly decimationHistory: (DecimationSelection | undefined)[] = [];
  readonly domainHistory: Array<{ xMin: number; xMax: number; yMin: number; yMax: number }> = [];
  renderCount = 0;
  renderAttemptCount = 0;
  disposeCount = 0;
  clearCount = 0;
  throwOnSetDomain: Error | null = null;
  throwOnRender: Error | null = null;
  throwOnTransformWhenDisposed = false;
  onDispose: (() => void) | null = null;

  constructor(
    kind: FigureRendererKind,
    tag: string,
    surfaces: readonly StubCanvasRecord[],
    sharedLog?: string[],
    initialDecimation?: DecimationSelection,
    initialYAxes?: readonly YAxisRegistration[],
  ) {
    this.kind = kind;
    this.tag = tag;
    this.#surfaces = surfaces;
    this.#sharedLog = sharedLog;
    if (initialYAxes !== undefined && initialYAxes.length > 0) {
      this.#yMin = initialYAxes[0]!.domainMin;
      this.#yMax = initialYAxes[0]!.domainMax;
    }
    this.#transform = this.#buildTransform();
    this.decimationHistory.push(initialDecimation);
    this.#record("construct");
  }

  #buildTransform(): ViewportTransform {
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
      xOrigin: this.#xOrigin,
    });
  }

  #record(name: string): void {
    this.calls.push(name);
    this.#sharedLog?.push(`${this.tag}:${name}`);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get transform(): ViewportTransform {
    if (this.#disposed && this.throwOnTransformWhenDisposed) {
      throw new Error("transform accessed on disposed renderer");
    }
    return this.#transform;
  }

  setData(payload: SpectrumDataPayload): void {
    if (this.#disposed) return;
    this.#xOrigin = payload.xOrigin;
    this.#record("setData");
  }

  setTraces(collection: TraceCollection): void {
    if (this.#disposed) return;
    this.#xOrigin = 0;
    this.#xMin = collection.xDomainMin;
    this.#xMax = collection.xDomainMax;
    this.#record("setTraces");
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    this.#record("setDomain");
    if (this.throwOnSetDomain !== null) throw this.throwOnSetDomain;
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
    this.#transform = this.#buildTransform();
    this.domainHistory.push({ xMin, xMax, yMin, yMax });
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
    this.#width = width;
    this.#height = height;
    this.#dpr = dpr;
    const devW = Math.round(width * dpr);
    const devH = Math.round(height * dpr);
    for (const s of this.#surfaces) {
      s.width = devW;
      s.height = devH;
    }
    this.#transform = this.#buildTransform();
    this.#record("resize");
  }

  render(): void {
    this.renderAttemptCount += 1;
    if (this.#disposed) return;
    this.#record("render");
    if (this.throwOnRender !== null) throw this.throwOnRender;
    this.renderCount += 1;
  }

  clear(): void {
    if (this.#disposed) return;
    this.clearCount += 1;
    this.#record("clear");
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    if (this.#disposed) return;
    this.decimationHistory.push(selection);
    this.#record("setDecimation");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.disposeCount += 1;
    this.#record("dispose");
    this.onDispose?.();
  }
}

function makePayload(sampleCount: number, xOrigin = 0, capacity = Math.max(1, sampleCount)): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity,
    xOrigin,
    xUnit: "nm",
    yUnit: "dBm",
  });
  for (let i = 0; i < sampleCount; i += 1) {
    payload.x[i] = i * 0.001;
    payload.y[i] = -40 + (i % 10);
  }
  if (sampleCount > 0) {
    commitPayloadRevision(payload, sampleCount);
  }
  return payload;
}

function makeTraces(
  payloads: readonly SpectrumDataPayload[],
  xDomainMin = 0,
  xDomainMax = 10,
  yAxisId = "y",
): TraceCollection {
  return {
    entries: payloads.map((payload, index) => ({
      id: `trace-${index}`,
      payload,
      yAxisId,
      style: {},
    })),
    xDomainMin,
    xDomainMax,
    revision: 1,
  };
}

function createManualRaf(): {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  flush: (timestamp?: number) => void;
  scheduleCount: () => number;
  cancelCount: () => number;
  pendingCount: () => number;
} {
  let nextHandle = 1;
  let scheduled = 0;
  let cancelled = 0;
  const callbacks = new Map<number, FrameRequestCallback>();

  return {
    requestAnimationFrame(cb: FrameRequestCallback): number {
      scheduled += 1;
      const handle = nextHandle++;
      callbacks.set(handle, cb);
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      if (callbacks.delete(handle)) {
        cancelled += 1;
      }
    },
    flush(timestamp = 16): void {
      const entries = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, cb] of entries) {
        cb(timestamp);
      }
    },
    scheduleCount: () => scheduled,
    cancelCount: () => cancelled,
    pendingCount: () => callbacks.size,
  };
}

function extractStub(canvas: unknown): StubCanvasRecord {
  return canvas as StubCanvasRecord;
}

describe("SpectrumEngineController lifecycle & validation", () => {
  it("validates hysteresis, initial dimensions/DPR, and decimationPort/settlementSink before allocating canvases or renderers", () => {
    const host = createStubHost();
    let c2dCreates = 0;
    let glCreates = 0;
    const baseFactories = {
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      createCanvas2DRenderer: () => {
        c2dCreates += 1;
        return new RecordingFakeRenderer("canvas2d", "c2d", []);
      },
      createWebGL2Renderer: () => {
        glCreates += 1;
        return new RecordingFakeRenderer("webgl2", "gl", []);
      },
    };

    expect(() =>
      createSpectrumEngineController({
        ...baseFactories,
        hysteresis: { upThreshold: 80_000, downThreshold: 80_000 },
      }),
    ).toThrow(RangeError);

    for (const invalidDim of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() =>
        createSpectrumEngineController({ ...baseFactories, initialWidth: invalidDim }),
      ).toThrow(RangeError);
      expect(() =>
        createSpectrumEngineController({ ...baseFactories, initialHeight: invalidDim }),
      ).toThrow(RangeError);
      expect(() =>
        createSpectrumEngineController({ ...baseFactories, initialDpr: invalidDim }),
      ).toThrow(RangeError);
    }

    const port = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 16 });
    try {
      expect(() =>
        createSpectrumEngineController({
          ...baseFactories,
          decimationPort: port,
        }),
      ).toThrow(TypeError);
    } finally {
      port.dispose();
    }

    expect(host.createdCanvases.length).toBe(0);
    expect(host.containerRecord.children.length).toBe(0);
    expect(c2dCreates).toBe(0);
    expect(glCreates).toBe(0);
  });

  it("validates resize(width, height, dpr) synchronously without mutating dimensions or calling active renderer", () => {
    const host = createStubHost();
    const renderers: RecordingFakeRenderer[] = [];
    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      initialWidth: 640,
      initialHeight: 400,
      initialDpr: 2,
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: () => {
        throw new Error("should not create webgl2");
      },
    });

    const active = renderers[0]!;
    const callsBefore = active.calls.length;

    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => controller.resize(bad, 400, 2)).toThrow(RangeError);
      expect(() => controller.resize(640, bad, 2)).toThrow(RangeError);
      expect(() => controller.resize(640, 400, bad)).toThrow(RangeError);
    }

    expect(controller.width).toBe(640);
    expect(controller.height).toBe(400);
    expect(controller.dpr).toBe(2);
    expect(active.calls.length).toBe(callsBefore);
    controller.dispose();
  });

  it("mounts Canvas2D initially in auto mode with zero WebGL2 attempts and seeds domain from yAxes[0] or [-1, 1]", () => {
    const host1 = createStubHost();
    const events: EngineChangeEvent[] = [];
    let glCalls = 0;

    const c1 = createSpectrumEngineController({
      container: host1.container,
      createCanvas: host1.createCanvas,
      autoResize: false,
      onEngineChange: (e) => events.push(e),
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: () => {
        glCalls += 1;
        throw new Error("unexpected webgl2");
      },
    });

    expect(c1.activeKind).toBe("canvas2d");
    expect(c1.mode).toBe("auto");
    expect(c1.canvases.length).toBe(1);
    expect(c1.disposed).toBe(false);
    expect(c1.sampleCount).toBe(0);
    expect(c1.domain).toEqual({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 });
    expect(glCalls).toBe(0);
    expect(events).toEqual([
      {
        previousKind: null,
        activeKind: "canvas2d",
        sampleCount: 0,
        mode: "auto",
        reason: "init",
      },
    ]);
    c1.dispose();

    const host2 = createStubHost();
    const yAxes: readonly YAxisRegistration[] = [
      { id: "power", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -80, domainMax: 0, side: AXIS_SIDE_LEFT },
    ];
    const c2 = createSpectrumEngineController({
      container: host2.container,
      createCanvas: host2.createCanvas,
      autoResize: false,
      yAxes,
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)], undefined, opts.decimation, opts.yAxes),
      createWebGL2Renderer: () => {
        throw new Error("unexpected webgl2");
      },
    });

    expect(c2.domain).toEqual({ xMin: 0, xMax: 1, yMin: -80, yMax: 0 });
    c2.dispose();
  });

  it("keeps passive mutators non-drawing and non-scheduling while synchronously updating sampleCount and pendingKind", () => {
    const host = createStubHost();
    const raf = createManualRaf();
    const renderers: RecordingFakeRenderer[] = [];

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: (opts) => {
        const r = new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]);
        renderers.push(r);
        return r;
      },
    });

    const c2d = renderers[0]!;
    const traces = makeTraces([
      makePayload(25_000),
      makePayload(25_000),
      makePayload(25_000),
      makePayload(25_000),
    ]);

    controller.setTraces(traces);
    controller.setDomain(0, 10, -80, 0);
    controller.setDecimation({ algorithm: "lttb", threshold: 500 });
    controller.resize(800, 500, 1);

    expect(controller.sampleCount).toBe(100_000);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.pendingKind).toBe("webgl2");
    expect(c2d.renderCount).toBe(0);
    expect(raf.scheduleCount()).toBe(0);

    controller.render();
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.pendingKind).toBeNull();
    expect(renderers.length).toBe(2);
    expect(renderers[1]!.renderCount).toBe(1);
    controller.dispose();
  });

  it("executes the exact 5-step atomic swap order: construct -> resize -> setData -> setDomain -> setDecimation -> render -> dom swap -> outgoing dispose -> onEngineChange", () => {
    const log: string[] = [];
    const host = createStubHost(log);

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      onEngineChange: (event) => {
        log.push(`callback:onEngineChange:${event.reason}:${event.activeKind}`);
      },
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "outgoing", [extractStub(opts.surface)], log),
      createWebGL2Renderer: (opts) =>
        new RecordingFakeRenderer(
          "webgl2",
          "incoming",
          [
            extractStub(opts.surfaces.underlay),
            extractStub(opts.surfaces.plot),
            extractStub(opts.surfaces.overlay),
          ],
          log,
        ),
    });

    controller.setData(makePayload(80_000));
    controller.setDomain(10, 20, -50, 50);
    controller.setDecimation({ algorithm: "min-max", bucketCount: 512 });

    // Clear log prior to the render-triggered swap.
    log.length = 0;
    controller.render();

    expect(log).toEqual([
      "incoming:construct",
      "incoming:resize",
      "incoming:setData",
      "incoming:setDomain",
      "incoming:setDecimation",
      "incoming:render",
      "dom:insert:underlay",
      "dom:insert:plot",
      "dom:insert:overlay",
      "dom:remove:canvas2d",
      "outgoing:dispose",
      "callback:onEngineChange:hysteresis-up:webgl2",
    ]);
    controller.dispose();
  });

  it("preserves effectiveDomain across setTraces and round-trip swaps, never reuses disposed canvases, and reconciles xOrigin on real Canvas2DRenderer", () => {
    const host = createStubHost();
    const yAxes: readonly YAxisRegistration[] = [
      { id: "power", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -80, domainMax: 0, side: AXIS_SIDE_LEFT },
    ];
    const restorePath2D = installRecordingPath2D();
    try {
      const controller = createSpectrumEngineController({
        container: host.container,
        createCanvas: host.createCanvas,
        autoResize: false,
        yAxes,
        createCanvas2DRenderer: (opts) => {
          const ctx = new RecordingContext();
          const stub = extractStub(opts.surface);
          const surface = recordingSurface(ctx);
          // Mirror backing store mutations onto our stub for assertion.
          const wrapped = new Proxy(surface, {
            set(target, prop, value, receiver) {
              if (prop === "width" && typeof value === "number") stub.width = value;
              if (prop === "height" && typeof value === "number") stub.height = value;
              return Reflect.set(target, prop, value, receiver);
            },
          });
          return new Canvas2DRenderer({ ...opts, surface: wrapped });
        },
        createWebGL2Renderer: (opts) =>
          new RecordingFakeRenderer(
            "webgl2",
            "gl",
            [
              extractStub(opts.surfaces.underlay),
              extractStub(opts.surfaces.plot),
              extractStub(opts.surfaces.overlay),
            ],
            undefined,
            opts.decimation,
            opts.yAxes,
          ),
      });

      const firstCanvas2dSet = [...controller.canvases];
      controller.resize(640, 400, 2);

      const tracePayload = makePayload(80_000, 1550);
      controller.setTraces(makeTraces([tracePayload], 1550, 1560, "power"));

      expect(controller.domain).toEqual({ xMin: 1550, xMax: 1560, yMin: -80, yMax: 0 });
      expect(controller.transform.deviceWidth).toBe(1280);
      expect(controller.transform.deviceHeight).toBe(800);
      expect(controller.transform.dpr).toBe(2);
      expect(controller.transform.xDomainMin).toBe(1550);
      expect(controller.transform.xDomainMax).toBe(1560);
      expect(controller.transform.yDomainMin).toBe(-80);
      expect(controller.transform.yDomainMax).toBe(0);

      // Swap canvas2d -> webgl2
      controller.render();
      expect(controller.activeKind).toBe("webgl2");
      const firstWebgl2Set = [...controller.canvases];
      expect(firstWebgl2Set.length).toBe(3);
      for (const c of firstWebgl2Set) {
        expect(extractStub(c).width).toBe(1280);
        expect(extractStub(c).height).toBe(800);
      }
      expect(controller.domain).toEqual({ xMin: 1550, xMax: 1560, yMin: -80, yMax: 0 });

      // Swap webgl2 -> canvas2d
      controller.setTraces(makeTraces([makePayload(10_000, 1550)], 1550, 1560, "power"));
      controller.render();
      expect(controller.activeKind).toBe("canvas2d");
      const secondCanvas2dSet = [...controller.canvases];
      expect(secondCanvas2dSet[0]).not.toBe(firstCanvas2dSet[0]);
      expect(extractStub(secondCanvas2dSet[0]).width).toBe(1280);
      expect(extractStub(secondCanvas2dSet[0]).height).toBe(800);
      expect(controller.domain).toEqual({ xMin: 1550, xMax: 1560, yMin: -80, yMax: 0 });

      // Swap canvas2d -> webgl2 again; verify zero canvas reuse across all activations
      controller.setTraces(makeTraces([makePayload(90_000, 1550)], 1550, 1560, "power"));
      controller.render();
      expect(controller.activeKind).toBe("webgl2");
      const secondWebgl2Set = [...controller.canvases];
      for (const c of secondWebgl2Set) {
        expect(firstWebgl2Set).not.toContain(c);
      }

      // Back to canvas2d, then steady-state setData with changed xOrigin = 2000
      controller.setMode("canvas2d");
      const payloadOrigin2000 = makePayload(5_000, 2000);
      controller.setData(payloadOrigin2000);
      expect(controller.transform.xOrigin).toBe(2000);
      controller.setDomain(2000, 2010, -80, 0);
      expect(controller.transform.xOrigin).toBe(2000);
      expect(controller.transform.xOffsetMin).toBe(0);

      controller.dispose();
    } finally {
      restorePath2D();
    }
  });

  it("tracks in-place payload.revision advances for both single payloads and multi-trace collections", () => {
    const host = createStubHost();
    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: (opts) =>
        new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]),
    });

    // Single payload mutated in place across upThreshold without calling setData again
    const retained = makePayload(40_000, 0, 100_000);
    controller.setData(retained);
    controller.render();
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.sampleCount).toBe(40_000);

    commitPayloadRevision(retained, 90_000);
    controller.render();
    expect(controller.sampleCount).toBe(90_000);
    expect(controller.activeKind).toBe("webgl2");

    // Multi-trace collection payloads mutated in place across downThreshold without calling setTraces again
    const p1 = makePayload(45_000, 0, 50_000);
    const p2 = makePayload(45_000, 0, 50_000);
    controller.setTraces(makeTraces([p1, p2]));
    controller.render();
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.sampleCount).toBe(90_000);

    commitPayloadRevision(p1, 25_000);
    commitPayloadRevision(p2, 25_000);
    controller.render();
    expect(controller.sampleCount).toBe(50_000);
    expect(controller.activeKind).toBe("canvas2d");

    controller.dispose();
  });

  it("executes setMode synchronously when idle, cancels redundant rAF, and defers all transitions while gestureActive is true", () => {
    const host = createStubHost();
    const raf = createManualRaf();
    const events: EngineChangeEvent[] = [];

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onEngineChange: (e) => events.push(e),
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: (opts) =>
        new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]),
    });

    // Synchronous setMode cancels redundant pending rAF when data is present (pre-rendered)
    const payload = makePayload(150_000, 0, 150_000);
    controller.setData(payload);
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);

    controller.setMode("webgl2");
    expect(controller.activeKind).toBe("webgl2");
    expect(raf.pendingCount()).toBe(0);
    expect(events[events.length - 1]?.reason).toBe("mode-change");

    controller.setMode("canvas2d");
    expect(controller.activeKind).toBe("canvas2d");
    expect(events[events.length - 1]?.reason).toBe("mode-change");

    // Mid-gesture deferral in auto mode
    controller.setMode("auto");
    // Now activeKind switched to webgl2 because sampleCount=150_000 and gestureActive=false
    expect(controller.activeKind).toBe("webgl2");

    // Reset back to canvas2d at 40k
    commitPayloadRevision(payload, 40_000);
    controller.render();
    expect(controller.activeKind).toBe("canvas2d");

    const canvasBeforeGesture = controller.canvases[0];
    controller.setGestureActive(true);
    expect(controller.gestureActive).toBe(true);

    // Threshold crossing during gesture defers swap
    controller.setData(makePayload(100_000));
    controller.render();
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.pendingKind).toBe("webgl2");
    expect(controller.canvases[0]).toBe(canvasBeforeGesture);

    // Returning to original band before gesture end cancels deferred swap
    controller.setData(makePayload(50_000));
    controller.setGestureActive(false);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.pendingKind).toBeNull();
    expect(controller.canvases[0]).toBe(canvasBeforeGesture);

    // Mid-gesture in-place payload revision advance flushed directly by setGestureActive(false)
    const retained = makePayload(40_000, 0, 100_000);
    controller.setData(retained);
    controller.render();
    controller.setGestureActive(true);
    commitPayloadRevision(retained, 95_000);
    controller.setGestureActive(false);
    expect(controller.sampleCount).toBe(95_000);
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.pendingKind).toBeNull();
    expect(events[events.length - 1]?.reason).toBe("gesture-end");

    // setMode during gestureActive defers until setGestureActive(false)
    controller.setGestureActive(true);
    controller.setMode("canvas2d");
    expect(controller.mode).toBe("canvas2d");
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.pendingKind).toBe("canvas2d");
    controller.setGestureActive(false);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.pendingKind).toBeNull();
    expect(events[events.length - 1]?.reason).toBe("gesture-end");

    controller.dispose();
  });

  it("handles leak-free WebGL2 fallback across construction, replay, pre-render, initial mount, latch, and retryWebGL2", () => {
    // (A) Initial mount failure in webgl2 mode: Canvas2D mounted BEFORE callbacks; single webgl2-fallback event
    const hostInit = createStubHost();
    const callbackOrder: string[] = [];
    const fallbackEvents: WebGL2FallbackEvent[] = [];
    const changeEvents: EngineChangeEvent[] = [];
    const initError = new TypeError("webgl2 context null");
    let controllerRef: SpectrumEngineController | null = null;

    controllerRef = createSpectrumEngineController({
      container: hostInit.container,
      createCanvas: hostInit.createCanvas,
      autoResize: false,
      mode: "webgl2",
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d-fallback", [extractStub(opts.surface)]),
      createWebGL2Renderer: () => {
        throw initError;
      },
      onWebGL2Fallback: (ev) => {
        callbackOrder.push(`fallback:canvases=${hostInit.containerRecord.children.length}`);
        fallbackEvents.push(ev);
      },
      onEngineChange: (ev) => {
        callbackOrder.push(`change:${ev.reason}:canvases=${hostInit.containerRecord.children.length}`);
        changeEvents.push(ev);
      },
    });

    expect(controllerRef.activeKind).toBe("canvas2d");
    expect(controllerRef.webgl2Fallback).toBe(true);
    expect(controllerRef.canvases.length).toBe(1);
    expect(callbackOrder).toEqual(["fallback:canvases=1", "change:webgl2-fallback:canvases=1"]);
    expect(fallbackEvents).toEqual([
      { error: initError, attemptedMode: "webgl2", sampleCount: 0 },
    ]);
    expect(changeEvents).toEqual([
      {
        previousKind: null,
        activeKind: "canvas2d",
        sampleCount: 0,
        mode: "webgl2",
        reason: "webgl2-fallback",
      },
    ]);
    controllerRef.dispose();

    // (B) Partial swap failures during replay (setDomain) and pre-render (render) dispose incoming WebGL2 renderer
    for (const failPhase of ["setDomain", "render"] as const) {
      const host = createStubHost();
      const glInstances: RecordingFakeRenderer[] = [];
      const changes: EngineChangeEvent[] = [];
      const fallbacks: WebGL2FallbackEvent[] = [];
      const boom = new Error(`boom on ${failPhase}`);
      let shouldFail = true;

      const controller = createSpectrumEngineController({
        container: host.container,
        createCanvas: host.createCanvas,
        autoResize: false,
        onEngineChange: (e) => changes.push(e),
        onWebGL2Fallback: (e) => fallbacks.push(e),
        createCanvas2DRenderer: (opts) =>
          new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
        createWebGL2Renderer: (opts) => {
          const r = new RecordingFakeRenderer("webgl2", "gl", [
            extractStub(opts.surfaces.underlay),
            extractStub(opts.surfaces.plot),
            extractStub(opts.surfaces.overlay),
          ]);
          if (shouldFail) {
            if (failPhase === "setDomain") r.throwOnSetDomain = boom;
            if (failPhase === "render") r.throwOnRender = boom;
          }
          glInstances.push(r);
          return r;
        },
      });

      const originalCanvas = controller.canvases[0];
      changes.length = 0;

      controller.setData(makePayload(100_000));
      controller.render();

      expect(glInstances.length).toBe(1);
      expect(glInstances[0]!.disposeCount).toBe(1);
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.webgl2Fallback).toBe(true);
      expect(controller.canvases.length).toBe(1);
      expect(controller.canvases[0]).toBe(originalCanvas);
      expect(host.containerRecord.children.length).toBe(1);
      expect(changes.length).toBe(0);
      expect(fallbacks).toEqual([
        { error: boom, attemptedMode: "auto", sampleCount: 100_000 },
      ]);

      // Latch prevents per-frame retries across 10 subsequent renders
      for (let i = 0; i < 10; i += 1) {
        controller.render();
      }
      expect(glInstances.length).toBe(1);

      // retryWebGL2 during gestureActive defers and returns false
      shouldFail = false;
      controller.setGestureActive(true);
      expect(controller.retryWebGL2()).toBe(false);
      expect(controller.webgl2Fallback).toBe(false);
      expect(controller.pendingKind).toBe("webgl2");
      expect(controller.activeKind).toBe("canvas2d");

      // Re-latch via failure to test non-gesture retryWebGL2 synchronously
      controller.setGestureActive(false);
      expect(controller.activeKind).toBe("webgl2");
      expect(changes[changes.length - 1]?.reason).toBe("gesture-end");

      // Drop back to canvas2d, fail once, then retryWebGL2 synchronously succeeds with reason "webgl2-retry"
      controller.setData(makePayload(10_000));
      controller.render();
      expect(controller.activeKind).toBe("canvas2d");

      shouldFail = true;
      controller.setData(makePayload(100_000));
      controller.render();
      expect(controller.webgl2Fallback).toBe(true);

      shouldFail = false;
      const upgraded = controller.retryWebGL2();
      expect(upgraded).toBe(true);
      expect(controller.activeKind).toBe("webgl2");
      expect(controller.webgl2Fallback).toBe(false);
      expect(changes[changes.length - 1]?.reason).toBe("webgl2-retry");

      controller.dispose();
    }
  });

  it("preserves setDecimation(undefined) and explicit selections across swaps, polls DecimationPort before revision sync, and never disposes the port", () => {
    const host = createStubHost();
    const renderers: RecordingFakeRenderer[] = [];
    const callOrder: string[] = [];

    const retained = makePayload(40_000, 0, 100_000);
    const backingPort = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 16 });
    let pollCalls = 0;
    let portDisposeCalls = 0;
    let mutateOnNextPoll = false;

    const spyPort: DecimationPort = {
      mode: backingPort.mode,
      poolPairs: backingPort.poolPairs,
      transitCapacitySamples: backingPort.transitCapacitySamples,
      acquire: () => backingPort.acquire(),
      setKind: (l, k) => backingPort.setKind(l, k),
      setSampleCount: (l, c) => backingPort.setSampleCount(l, c),
      setBucketCount: (l, b) => backingPort.setBucketCount(l, b),
      setDomain: (l, min, max) => backingPort.setDomain(l, min, max),
      viewX: (l) => backingPort.viewX(l),
      viewY: (l) => backingPort.viewY(l),
      viewOut: (l) => backingPort.viewOut(l),
      viewIndices: (l) => backingPort.viewIndices(l),
      submit: (l) => backingPort.submit(l),
      poll: (sink: SettlementSink): number => {
        pollCalls += 1;
        callOrder.push("port:poll");
        if (mutateOnNextPoll) {
          mutateOnNextPoll = false;
          commitPayloadRevision(retained, 90_000);
        }
        return backingPort.poll(sink);
      },
      release: (l) => backingPort.release(l),
      reportResponderFailure: (r) => backingPort.reportResponderFailure(r),
      noteDroppedSamples: (c) => backingPort.noteDroppedSamples(c),
      readStats: (o) => backingPort.readStats(o),
      dispose: () => {
        portDisposeCalls += 1;
        backingPort.dispose();
      },
    };
    const sink: SettlementSink = {
      onSettled() {},
    };

    try {
      const controller = createSpectrumEngineController({
        container: host.container,
        createCanvas: host.createCanvas,
        autoResize: false,
        decimation: undefined,
        decimationPort: spyPort,
        settlementSink: sink,
        createCanvas2DRenderer: (opts) => {
          const r = new RecordingFakeRenderer(
            "canvas2d",
            "c2d",
            [extractStub(opts.surface)],
            callOrder,
            opts.decimation,
          );
          renderers.push(r);
          return r;
        },
        createWebGL2Renderer: (opts) => {
          const r = new RecordingFakeRenderer(
            "webgl2",
            "gl",
            [
              extractStub(opts.surfaces.underlay),
              extractStub(opts.surfaces.plot),
              extractStub(opts.surfaces.overlay),
            ],
            callOrder,
            opts.decimation,
          );
          renderers.push(r);
          return r;
        },
      });

      controller.setData(retained);
      callOrder.length = 0;
      mutateOnNextPoll = true;
      controller.render();

      // poll ran BEFORE revision sync and incoming WebGL2 construct/render
      expect(pollCalls).toBe(1);
      expect(callOrder[0]).toBe("port:poll");
      expect(controller.activeKind).toBe("webgl2");
      expect(controller.decimation).toBeUndefined();
      expect(renderers[1]!.decimationHistory).toEqual([undefined, undefined]);

      // Explicit selection replayed verbatim on swap back to canvas2d
      const explicit: DecimationSelection = { algorithm: "min-max", bucketCount: 512 };
      controller.setDecimation(explicit);
      expect(controller.decimation).toEqual(explicit);
      commitPayloadRevision(retained, 20_000);
      controller.render();

      expect(controller.activeKind).toBe("canvas2d");
      expect(renderers[2]!.decimationHistory).toEqual([explicit, explicit]);

      // Disposing controller NEVER disposes the caller-owned DecimationPort
      controller.dispose();
      expect(portDisposeCalls).toBe(0);
    } finally {
      backingPort.dispose();
    }
  });

  it("coalesces requestRender(), cancels pending rAF on synchronous render(), runs 100 steady-state frames without swaps, and makes dispose() idempotent", () => {
    const host = createStubHost();
    const raf = createManualRaf();
    const renderers: RecordingFakeRenderer[] = [];
    let roDisconnectCount = 0;
    let roObserveCount = 0;

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: true,
      resizeObserverFactory: (): ResizeObserverLike => ({
        observe() {
          roObserveCount += 1;
        },
        disconnect() {
          roDisconnectCount += 1;
        },
      }),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: () => {
        throw new Error("should not swap");
      },
    });

    expect(roObserveCount).toBe(1);

    // Coalesce multiple mutations + requestRender() calls into a single rAF
    controller.setData(makePayload(1_000));
    controller.requestRender();
    controller.setDomain(0, 10, -1, 1);
    controller.requestRender();
    controller.setDecimation({ algorithm: "lttb" });
    controller.setData(makePayload(2_000));
    controller.requestRender();

    expect(raf.scheduleCount()).toBe(1);
    expect(renderers[0]!.renderCount).toBe(0);

    raf.flush();
    expect(renderers[0]!.renderCount).toBe(1);

    // Synchronous render() cancels pending rAF
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);
    controller.render();
    expect(raf.pendingCount()).toBe(0);
    expect(raf.cancelCount()).toBe(1);
    expect(renderers[0]!.renderCount).toBe(2);

    // 100 steady-state frames: zero swaps, zero new canvases
    const canvasesCreatedBefore = host.createdCanvases.length;
    for (let i = 0; i < 100; i += 1) {
      controller.render();
    }
    expect(renderers.length).toBe(1);
    expect(host.createdCanvases.length).toBe(canvasesCreatedBefore);
    expect(renderers[0]!.renderCount).toBe(102);

    // Schedule one more frame, then dispose twice
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);

    controller.dispose();
    controller.dispose();

    expect(controller.disposed).toBe(true);
    expect(raf.pendingCount()).toBe(0);
    expect(raf.cancelCount()).toBe(2);
    expect(roDisconnectCount).toBe(1);
    expect(renderers[0]!.disposeCount).toBe(1);
    expect(controller.canvases.length).toBe(0);
    expect(host.containerRecord.children.length).toBe(0);

    // All post-dispose calls are safe no-ops
    const scheduledBefore = raf.scheduleCount();
    expect(() => controller.setData(makePayload(90_000))).not.toThrow();
    expect(() => controller.setTraces(makeTraces([makePayload(90_000)]))).not.toThrow();
    expect(() => controller.setDomain(0, 5, -5, 5)).not.toThrow();
    expect(() => controller.resize(100, 100, 1)).not.toThrow();
    expect(() => controller.setDecimation(undefined)).not.toThrow();
    expect(() => controller.setMode("webgl2")).not.toThrow();
    expect(() => controller.setGestureActive(true)).not.toThrow();
    expect(controller.retryWebGL2()).toBe(false);
    expect(() => controller.render()).not.toThrow();
    expect(() => controller.requestRender()).not.toThrow();
    expect(() => controller.clear()).not.toThrow();
    expect(raf.scheduleCount()).toBe(scheduledBefore);
    expect(renderers[0]!.renderCount).toBe(102);
  });

  it("updates domain in place with zero Object.freeze or wrapper allocations across setDomain() and setTraces() hot sweeps", () => {
    const host = createStubHost();
    const fixedTransform = createViewportTransform({
      cssWidth: 640,
      cssHeight: 400,
      dpr: 1,
      insetLeft: 40,
      insetRight: 16,
      insetTop: 16,
      insetBottom: 32,
      xDomainMin: 0,
      xDomainMax: 1,
      yDomainMin: -1,
      yDomainMax: 1,
      xOrigin: 0,
    });
    let domainCalls = 0;
    let renderCalls = 0;
    const zeroAllocRenderer: FigureRenderer = {
      kind: "canvas2d",
      disposed: false,
      transform: fixedTransform,
      setData() {},
      setTraces() {},
      setDomain() {
        domainCalls += 1;
      },
      resize() {},
      render() {
        renderCalls += 1;
      },
      clear() {},
      setDecimation() {},
      dispose() {},
    };

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      createCanvas2DRenderer: () => zeroAllocRenderer,
      createWebGL2Renderer: () => {
        throw new Error("should not swap");
      },
    });

    controller.setData(makePayload(1_000));
    const traces = makeTraces([makePayload(500)], 1500, 1600);
    const initialDomainRef = controller.domain;
    expect(Object.isFrozen(initialDomainRef)).toBe(true);
    expect(Object.keys(initialDomainRef)).toEqual(["xMin", "xMax", "yMin", "yMax"]);
    expect(Reflect.set(controller.domain, "xMin", 999)).toBe(false);

    const freezeSpy = vi.spyOn(Object, "freeze");
    try {
      domainCalls = 0;
      renderCalls = 0;
      for (let i = 0; i < 100; i += 1) {
        controller.setDomain(i, i + 100, -80 - i, i);
        controller.render();
        expect(controller.domain).toBe(initialDomainRef);
      }

      expect(domainCalls).toBe(100);
      expect(renderCalls).toBe(100);
      expect(controller.domain).toEqual({ xMin: 99, xMax: 199, yMin: -179, yMax: 99 });
      expect(freezeSpy).toHaveBeenCalledTimes(0);

      controller.setTraces(traces);
      expect(controller.domain).toBe(initialDomainRef);
      expect(controller.domain).toEqual({ xMin: 1500, xMax: 1600, yMin: -179, yMax: 99 });
      expect(freezeSpy).toHaveBeenCalledTimes(0);
    } finally {
      freezeSpy.mockRestore();
      controller.dispose();
    }
  });

  it("preserves re-entrant requestRender() invoked inside onEngineChange and onWebGL2Fallback during setMode, setGestureActive(false), and retryWebGL2", () => {
    const host = createStubHost();
    const raf = createManualRaf();
    const renderers: RecordingFakeRenderer[] = [];
    let shouldFailWebGL2 = false;
    let requestOnEngineChange = false;
    let requestOnFallback = false;
    let controllerRef: SpectrumEngineController | null = null;

    controllerRef = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onEngineChange: () => {
        if (requestOnEngineChange) {
          requestOnEngineChange = false;
          controllerRef?.setDomain(1, 2, -10, 10);
          controllerRef?.requestRender();
        }
      },
      onWebGL2Fallback: () => {
        if (requestOnFallback) {
          requestOnFallback = false;
          controllerRef?.setDomain(3, 4, -20, 20);
          controllerRef?.requestRender();
        }
      },
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: (opts) => {
        if (shouldFailWebGL2) {
          throw new Error("webgl2 unavailable");
        }
        const r = new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]);
        renderers.push(r);
        return r;
      },
    });

    const controller = controllerRef;
    controller.setData(makePayload(100_000));

    // (1) setMode() with pre-existing pending rAF + re-entrant requestRender() in onEngineChange
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);
    requestOnEngineChange = true;
    controller.setMode("webgl2");
    expect(controller.activeKind).toBe("webgl2");
    expect(raf.pendingCount()).toBe(1);
    const gl1 = renderers[renderers.length - 1]!;
    expect(gl1.renderCount).toBe(1);
    raf.flush();
    expect(gl1.renderCount).toBe(2);

    // (2) setGestureActive(false) with pre-existing pending rAF + re-entrant requestRender() in onEngineChange
    controller.setGestureActive(true);
    controller.setMode("canvas2d");
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);
    requestOnEngineChange = true;
    controller.setGestureActive(false);
    expect(controller.activeKind).toBe("canvas2d");
    expect(raf.pendingCount()).toBe(1);
    const c2d2 = renderers[renderers.length - 1]!;
    expect(c2d2.renderCount).toBe(1);
    raf.flush();
    expect(c2d2.renderCount).toBe(2);

    // (3) retryWebGL2() failing -> re-entrant requestRender() in onWebGL2Fallback with pre-existing pending rAF
    shouldFailWebGL2 = true;
    controller.setMode("auto");
    expect(controller.webgl2Fallback).toBe(true);
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);
    requestOnFallback = true;
    expect(controller.retryWebGL2()).toBe(false);
    expect(raf.pendingCount()).toBe(1);
    const rendersBeforeFlush = c2d2.renderCount;
    raf.flush();
    expect(c2d2.renderCount).toBe(rendersBeforeFlush + 1);

    // (4) retryWebGL2() succeeding -> re-entrant requestRender() in onEngineChange with pre-existing pending rAF
    shouldFailWebGL2 = false;
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);
    requestOnEngineChange = true;
    expect(controller.retryWebGL2()).toBe(true);
    expect(controller.activeKind).toBe("webgl2");
    expect(raf.pendingCount()).toBe(1);
    const gl2 = renderers[renderers.length - 1]!;
    expect(gl2.renderCount).toBe(1);
    raf.flush();
    expect(gl2.renderCount).toBe(2);

    controller.dispose();
  });

  it("guards against re-entrant dispose(), retryWebGL2(), and setMode() inside onWebGL2Fallback and onEngineChange", () => {
    // (A) onWebGL2Fallback re-entrantly disposing controller (including initial-mount fallback via closure hook)
    const hostA = createStubHost();
    const changeEventsA: EngineChangeEvent[] = [];
    let controllerA: SpectrumEngineController | null = null;
    let disposeInFallback = false;

    controllerA = createSpectrumEngineController({
      container: hostA.container,
      createCanvas: hostA.createCanvas,
      autoResize: false,
      onWebGL2Fallback: () => {
        if (disposeInFallback) {
          controllerA?.dispose();
        }
      },
      onEngineChange: (ev) => {
        changeEventsA.push(ev);
      },
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: () => {
        throw new Error("no gl");
      },
    });
    changeEventsA.length = 0;
    disposeInFallback = true;
    controllerA.setMode("webgl2");
    expect(controllerA.disposed).toBe(true);
    expect(changeEventsA.length).toBe(0);

    // (B) onWebGL2Fallback re-entrantly triggering retryWebGL2() that succeeds
    const hostB = createStubHost();
    const changeEventsB: EngineChangeEvent[] = [];
    let controllerB: SpectrumEngineController | null = null;
    let glAttemptsB = 0;

    controllerB = createSpectrumEngineController({
      container: hostB.container,
      createCanvas: hostB.createCanvas,
      autoResize: false,
      onWebGL2Fallback: () => {
        controllerB?.retryWebGL2();
      },
      onEngineChange: (ev) => {
        changeEventsB.push(ev);
      },
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: (opts) => {
        glAttemptsB += 1;
        if (glAttemptsB === 1) {
          throw new Error("transient gl error");
        }
        return new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]);
      },
    });
    changeEventsB.length = 0;
    controllerB.setMode("webgl2");
    expect(controllerB.activeKind).toBe("webgl2");
    expect(controllerB.webgl2Fallback).toBe(false);
    expect(changeEventsB).toEqual([
      {
        previousKind: "canvas2d",
        activeKind: "webgl2",
        sampleCount: 0,
        mode: "webgl2",
        reason: "webgl2-retry",
      },
    ]);
    controllerB.dispose();

    // (C) onEngineChange re-entrantly calling setMode("canvas2d") and dispose()
    const hostC = createStubHost();
    const changeEventsC: EngineChangeEvent[] = [];
    let controllerC: SpectrumEngineController | null = null;
    let reenterModeBack = false;
    let reenterDispose = false;

    controllerC = createSpectrumEngineController({
      container: hostC.container,
      createCanvas: hostC.createCanvas,
      autoResize: false,
      onEngineChange: (ev) => {
        changeEventsC.push(ev);
        if (reenterModeBack && ev.activeKind === "webgl2") {
          reenterModeBack = false;
          controllerC?.setMode("canvas2d");
        } else if (reenterDispose && ev.activeKind === "webgl2") {
          reenterDispose = false;
          controllerC?.dispose();
        }
      },
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: (opts) =>
        new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]),
    });

    changeEventsC.length = 0;
    reenterModeBack = true;
    controllerC.setMode("webgl2");
    expect(controllerC.activeKind).toBe("canvas2d");
    expect(controllerC.canvases.length).toBe(1);
    expect(changeEventsC.map((e) => `${e.previousKind}->${e.activeKind}`)).toEqual([
      "canvas2d->webgl2",
      "webgl2->canvas2d",
    ]);

    reenterDispose = true;
    controllerC.setMode("webgl2");
    expect(controllerC.disposed).toBe(true);
    expect(controllerC.canvases.length).toBe(0);
    expect(hostC.containerRecord.children.length).toBe(0);

    // (D) outgoing.dispose() re-entrantly disposing controller must suppress onEngineChange
    const hostD = createStubHost();
    const renderersD: RecordingFakeRenderer[] = [];
    const changeEventsD: EngineChangeEvent[] = [];
    let controllerD: SpectrumEngineController | null = null;

    controllerD = createSpectrumEngineController({
      container: hostD.container,
      createCanvas: hostD.createCanvas,
      autoResize: false,
      onEngineChange: (ev) => changeEventsD.push(ev),
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        renderersD.push(r);
        return r;
      },
      createWebGL2Renderer: (opts) => {
        const r = new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]);
        renderersD.push(r);
        return r;
      },
    });
    changeEventsD.length = 0;
    renderersD[0]!.onDispose = () => {
      controllerD?.dispose();
    };
    controllerD.setMode("webgl2");
    expect(controllerD.disposed).toBe(true);
    expect(changeEventsD.length).toBe(0);
  });

  it("aborts render() safely when settlementSink disposes the controller inside decimationPort.poll()", () => {
    const host = createStubHost();
    const renderers: RecordingFakeRenderer[] = [];
    const backingPort = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 16 });
    let controllerRef: SpectrumEngineController | null = null;

    const spyPort: DecimationPort = {
      mode: backingPort.mode,
      poolPairs: backingPort.poolPairs,
      transitCapacitySamples: backingPort.transitCapacitySamples,
      acquire: () => backingPort.acquire(),
      setKind: (l, k) => backingPort.setKind(l, k),
      setSampleCount: (l, c) => backingPort.setSampleCount(l, c),
      setBucketCount: (l, b) => backingPort.setBucketCount(l, b),
      setDomain: (l, min, max) => backingPort.setDomain(l, min, max),
      viewX: (l) => backingPort.viewX(l),
      viewY: (l) => backingPort.viewY(l),
      viewOut: (l) => backingPort.viewOut(l),
      viewIndices: (l) => backingPort.viewIndices(l),
      submit: (l) => backingPort.submit(l),
      poll: (sink: SettlementSink): number => {
        controllerRef?.dispose();
        return backingPort.poll(sink);
      },
      release: (l) => backingPort.release(l),
      reportResponderFailure: (r) => backingPort.reportResponderFailure(r),
      noteDroppedSamples: (c) => backingPort.noteDroppedSamples(c),
      readStats: (o) => backingPort.readStats(o),
      dispose: () => backingPort.dispose(),
    };

    try {
      controllerRef = createSpectrumEngineController({
        container: host.container,
        createCanvas: host.createCanvas,
        autoResize: false,
        decimationPort: spyPort,
        settlementSink: { onSettled() {} },
        createCanvas2DRenderer: (opts) => {
          const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
          renderers.push(r);
          return r;
        },
        createWebGL2Renderer: () => {
          throw new Error("should not swap");
        },
      });

      const active = renderers[0]!;
      controllerRef.setData(makePayload(10_000));
      controllerRef.render();

      expect(controllerRef.disposed).toBe(true);
      expect(active.disposeCount).toBe(1);
      expect(active.renderAttemptCount).toBe(0);
    } finally {
      backingPort.dispose();
    }
  });

  it("releases internal renderer reference on dispose() while preserving readable controller.transform", () => {
    const host = createStubHost();
    const renderers: RecordingFakeRenderer[] = [];

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      initialWidth: 640,
      initialHeight: 400,
      initialDpr: 2,
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        r.throwOnTransformWhenDisposed = true;
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: () => {
        throw new Error("unused");
      },
    });

    controller.setDomain(10, 20, -50, 0);
    const snapshotBeforeDispose = controller.transform;
    controller.dispose();

    expect(controller.disposed).toBe(true);
    expect(renderers[0]!.disposeCount).toBe(1);
    // Reading controller.transform after dispose must NOT touch the disposed renderer
    expect(() => controller.transform).not.toThrow();
    expect(controller.transform).toBe(snapshotBeforeDispose);
    expect(controller.transform.deviceWidth).toBe(1280);
    expect(controller.transform.deviceHeight).toBe(800);
    expect(controller.transform.xDomainMin).toBe(10);
    expect(controller.transform.xDomainMax).toBe(20);
  });

  it("commits new engine state before calling outgoing.dispose() during atomic swap", () => {
    const host = createStubHost();
    const renderers: RecordingFakeRenderer[] = [];
    let observedDuringDispose: {
      activeKind: string;
      canvasCount: number;
      pendingKind: string | null;
    } | null = null;
    let controllerRef: SpectrumEngineController | null = null;

    controllerRef = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      createCanvas2DRenderer: (opts) => {
        const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: (opts) => {
        const r = new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]);
        renderers.push(r);
        return r;
      },
    });

    renderers[0]!.onDispose = () => {
      if (controllerRef !== null) {
        observedDuringDispose = {
          activeKind: controllerRef.activeKind,
          canvasCount: controllerRef.canvases.length,
          pendingKind: controllerRef.pendingKind,
        };
      }
    };

    controllerRef.setData(makePayload(90_000));
    controllerRef.render();

    expect(observedDuringDispose).toEqual({
      activeKind: "webgl2",
      canvasCount: 3,
      pendingKind: null,
    });
    controllerRef.dispose();
  });

  it("treats redundant setGestureActive(false) as a no-op so pending data-driven swaps stay deferred until render()", () => {
    const host = createStubHost();
    const events: EngineChangeEvent[] = [];

    const controller = createSpectrumEngineController({
      container: host.container,
      createCanvas: host.createCanvas,
      autoResize: false,
      onEngineChange: (ev) => events.push(ev),
      createCanvas2DRenderer: (opts) =>
        new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]),
      createWebGL2Renderer: (opts) =>
        new RecordingFakeRenderer("webgl2", "gl", [
          extractStub(opts.surfaces.underlay),
          extractStub(opts.surfaces.plot),
          extractStub(opts.surfaces.overlay),
        ]),
    });

    events.length = 0;
    controller.setData(makePayload(100_000));
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.pendingKind).toBe("webgl2");
    expect(controller.gestureActive).toBe(false);

    // Defensive redundant setGestureActive(false) when no gesture was active must NOT swap
    controller.setGestureActive(false);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.pendingKind).toBe("webgl2");
    expect(events.length).toBe(0);

    // Swap still happens on render() with reason "hysteresis-up"
    controller.render();
    expect(controller.activeKind).toBe("webgl2");
    expect(events).toEqual([
      {
        previousKind: "canvas2d",
        activeKind: "webgl2",
        sampleCount: 100_000,
        mode: "auto",
        reason: "hysteresis-up",
      },
    ]);
    controller.dispose();
  });

  it("disposes initial renderer and removes mounted canvases if ResizeObserver setup throws in constructor", () => {
    // (A) resizeObserverFactory throws
    const hostA = createStubHost();
    const renderersA: RecordingFakeRenderer[] = [];
    expect(() =>
      createSpectrumEngineController({
        container: hostA.container,
        createCanvas: hostA.createCanvas,
        autoResize: true,
        resizeObserverFactory: () => {
          throw new Error("RO factory failed");
        },
        createCanvas2DRenderer: (opts) => {
          const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
          renderersA.push(r);
          return r;
        },
        createWebGL2Renderer: () => {
          throw new Error("unused");
        },
      }),
    ).toThrow("RO factory failed");

    expect(renderersA.length).toBe(1);
    expect(renderersA[0]!.disposeCount).toBe(1);
    expect(hostA.containerRecord.children.length).toBe(0);

    // (B) observer.observe() throws
    const hostB = createStubHost();
    const renderersB: RecordingFakeRenderer[] = [];
    let disconnectCalls = 0;
    expect(() =>
      createSpectrumEngineController({
        container: hostB.container,
        createCanvas: hostB.createCanvas,
        autoResize: true,
        resizeObserverFactory: (): ResizeObserverLike => ({
          observe() {
            throw new Error("RO observe failed");
          },
          disconnect() {
            disconnectCalls += 1;
          },
        }),
        createCanvas2DRenderer: (opts) => {
          const r = new RecordingFakeRenderer("canvas2d", "c2d", [extractStub(opts.surface)]);
          renderersB.push(r);
          return r;
        },
        createWebGL2Renderer: () => {
          throw new Error("unused");
        },
      }),
    ).toThrow("RO observe failed");

    expect(renderersB.length).toBe(1);
    expect(renderersB[0]!.disposeCount).toBe(1);
    expect(disconnectCalls).toBe(1);
    expect(hostB.containerRecord.children.length).toBe(0);
  });
});
