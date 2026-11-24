/** @vitest-environment happy-dom */
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  createSyncDecimationPort,
  createViewportTransform,
  type DecimationPort,
  type SettlementSink,
  type SpectrumDataPayload,
  type ViewportTransform,
} from "@trace-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import {
  createSpectrumEngineController,
  createViewportInteractionController,
  type EngineChangeEvent,
  type ResizeObserverCallbackLike,
  type ResizeObserverLike,
  type SpectrumEngineController,
  type WebGL2ContextLostEvent,
  type WebGL2ContextRestoredEvent,
  type WebGL2FallbackEvent,
} from "../../src/controller/index.js";
import {
  WebGL2FigureRenderer,
  type WebGL2FigureRendererOptions,
} from "../../src/webgl2/webgl2-figure-renderer.js";
import { asSurface } from "../node/support/fake-surface.js";
import { createParts, type Parts } from "../node/support/webgl2-harness.js";

interface ResizableSurface {
  width: number;
  height: number;
}

class DomStubRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  readonly #surfaces: readonly ResizableSurface[];
  readonly #onDispose: (() => void) | undefined;
  #disposed = false;
  #width = 800;
  #height = 400;
  #dpr = 1;
  #xMin = 0;
  #xMax = 100;
  #yMin = -50;
  #yMax = 50;
  #transform: ViewportTransform;
  renderCount = 0;
  clearCount = 0;
  disposeCount = 0;
  setDomainCalls: Array<{ xMin: number; xMax: number; yMin: number; yMax: number }> = [];
  resizeCalls: Array<{ width: number; height: number; dpr: number }> = [];

  constructor(
    kind: FigureRendererKind,
    surfaces: readonly ResizableSurface[],
    onDispose?: () => void,
  ) {
    this.kind = kind;
    this.#surfaces = surfaces;
    this.#onDispose = onDispose;
    this.#transform = this.#computeTransform();
  }

  #computeTransform(): ViewportTransform {
    return createViewportTransform({
      cssWidth: this.#width,
      cssHeight: this.#height,
      dpr: this.#dpr,
      insetLeft: 60,
      insetRight: 20,
      insetTop: 20,
      insetBottom: 40,
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

  setData(): void {}
  setTraces(): void {}

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    this.setDomainCalls.push({ xMin, xMax, yMin, yMax });
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
    this.#transform = this.#computeTransform();
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
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
    this.renderCount += 1;
  }

  clear(): void {
    if (this.#disposed) return;
    this.clearCount += 1;
  }

  setDecimation(): void {}

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.disposeCount += 1;
    this.#onDispose?.();
  }
}

function makePayload(sampleCount: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: Math.max(1, sampleCount),
    xOrigin: 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  for (let i = 0; i < sampleCount; i += 1) {
    payload.x[i] = i;
    payload.y[i] = Math.sin(i * 0.02);
  }
  if (sampleCount > 0) {
    commitPayloadRevision(payload, sampleCount);
  }
  return payload;
}

function createManualRaf() {
  let nextId = 1;
  let scheduled = 0;
  let cancelled = 0;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      scheduled += 1;
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number): void => {
      if (queue.delete(id)) {
        cancelled += 1;
      }
    },
    flush: (): void => {
      const entries = Array.from(queue.entries());
      queue.clear();
      for (const [, cb] of entries) cb(16);
    },
    scheduleCount: () => scheduled,
    cancelCount: () => cancelled,
    pendingCount: () => queue.size,
    resetCounts: () => {
      scheduled = 0;
      cancelled = 0;
    },
  };
}

function createContainer(): HTMLDivElement {
  const div = document.createElement("div");
  div.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 400,
    right: 800,
    bottom: 400,
    toJSON() {
      return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 };
    },
  });
  document.body.appendChild(div);
  return div;
}

function createRealWebGL2Factory() {
  const instances: Array<{ renderer: WebGL2FigureRenderer; parts: Parts }> = [];
  const createWebGL2Renderer = (opts: WebGL2FigureRendererOptions): FigureRenderer => {
    const parts = createParts();
    const renderer = new WebGL2FigureRenderer({
      ...opts,
      surfaces: {
        underlay: asSurface(parts.underlay),
        plot: asSurface(parts.plot),
        overlay: asSurface(parts.overlay),
      },
    });
    instances.push({ renderer, parts });
    return renderer;
  };
  return { createWebGL2Renderer, instances };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("SpectrumEngineController context-loss lifecycle (happy-dom)", () => {
  it("attaches webglcontextlost and webglcontextrestored listeners exclusively to canvases[1] (plot)", () => {
    const container = createContainer();
    const registered = new Map<EventTarget, string[]>();
    const track = (target: EventTarget) => {
      const original = target.addEventListener.bind(target);
      target.addEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        const list = registered.get(target) ?? [];
        list.push(type);
        registered.set(target, list);
        original(type, listener, options);
      };
    };

    track(container);
    const createdCanvases: HTMLCanvasElement[] = [];
    const glFactory = createRealWebGL2Factory();

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      createCanvas: () => {
        const c = document.createElement("canvas");
        track(c);
        createdCanvases.push(c);
        return c;
      },
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    expect(controller.activeKind).toBe("webgl2");
    expect(controller.canvases).toHaveLength(3);
    expect(registered.get(container) ?? []).not.toContain("webglcontextlost");
    expect(registered.get(container) ?? []).not.toContain("webglcontextrestored");
    expect(registered.get(controller.canvases[0]!) ?? []).toEqual([]);
    expect(registered.get(controller.canvases[2]!) ?? []).toEqual([]);
    expect(registered.get(controller.canvases[1]!) ?? []).toEqual(
      expect.arrayContaining(["webglcontextlost", "webglcontextrestored"]),
    );

    // Switch to canvas2d -> no context listeners on Canvas2D canvas
    controller.setMode("canvas2d");
    expect(controller.activeKind).toBe("canvas2d");
    expect(registered.get(controller.canvases[0]!) ?? []).toEqual([]);

    controller.dispose();
  });

  it("ignores context events on non-bound targets, in Canvas2D mode, and after dispose()", () => {
    const container = createContainer();
    const glFactory = createRealWebGL2Factory();
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      onContextLost: (e) => lostEvents.push(e),
      onContextRestored: (e) => restoredEvents.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    const underlay = controller.canvases[0]!;
    const plot = controller.canvases[1]!;
    const detached = document.createElement("canvas");

    const ev1 = new Event("webglcontextlost", { cancelable: true });
    underlay.dispatchEvent(ev1);
    const ev2 = new Event("webglcontextlost", { cancelable: true });
    detached.dispatchEvent(ev2);
    detached.dispatchEvent(new Event("webglcontextrestored"));

    expect(ev1.defaultPrevented).toBe(false);
    expect(ev2.defaultPrevented).toBe(false);
    expect(controller.contextLost).toBe(false);
    expect(lostEvents).toHaveLength(0);
    expect(restoredEvents).toHaveLength(0);

    // Switch to canvas2d, dispatch on former plot canvas
    controller.setMode("canvas2d");
    const ev3 = new Event("webglcontextlost", { cancelable: true });
    plot.dispatchEvent(ev3);
    plot.dispatchEvent(new Event("webglcontextrestored"));
    expect(ev3.defaultPrevented).toBe(false);
    expect(controller.contextLost).toBe(false);
    expect(lostEvents).toHaveLength(0);

    // Switch back to webgl2 then dispose, dispatch on former plot canvas
    controller.setMode("webgl2");
    const plot2 = controller.canvases[1]!;
    controller.dispose();
    const ev4 = new Event("webglcontextlost", { cancelable: true });
    plot2.dispatchEvent(ev4);
    plot2.dispatchEvent(new Event("webglcontextrestored"));
    expect(ev4.defaultPrevented).toBe(false);
    expect(controller.contextLost).toBe(false);
    expect(lostEvents).toHaveLength(0);
    expect(restoredEvents).toHaveLength(0);
  });

  it("calls preventDefault(), sets contextLost, cancels pending rAF, emits onContextLost once, and is idempotent on duplicate loss", () => {
    const container = createContainer();
    const raf = createManualRaf();
    const glFactory = createRealWebGL2Factory();
    const lostEvents: WebGL2ContextLostEvent[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onContextLost: (e) => lostEvents.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    controller.setData(makePayload(256));
    controller.requestRender();
    expect(raf.pendingCount()).toBe(1);

    const plot = controller.canvases[1]!;
    glFactory.instances[0]!.parts.gl.simulateContextLoss();
    const ev1 = new Event("webglcontextlost", { cancelable: true });
    plot.dispatchEvent(ev1);

    expect(ev1.defaultPrevented).toBe(true);
    expect(controller.contextLost).toBe(true);
    expect(raf.cancelCount()).toBe(1);
    expect(raf.pendingCount()).toBe(0);
    expect(lostEvents).toHaveLength(1);
    expect(lostEvents[0]?.activeKind).toBe("webgl2");
    expect(lostEvents[0]?.sampleCount).toBe(256);
    expect(lostEvents[0]?.mode).toBe("webgl2");
    expect(typeof lostEvents[0]?.statusMessage).toBe("string");
    expect(lostEvents[0]!.statusMessage.length).toBeGreaterThan(0);

    // Duplicate loss event
    const ev2 = new Event("webglcontextlost", { cancelable: true });
    plot.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(true);
    expect(controller.contextLost).toBe(true);
    expect(lostEvents).toHaveLength(1);

    controller.dispose();
  });

  it("handles re-entrant dispose() and setMode('canvas2d') inside onContextLost cleanly", () => {
    const cA = createContainer();
    const glFactoryA = createRealWebGL2Factory();
    let ctrlA: SpectrumEngineController | null = null;
    ctrlA = createSpectrumEngineController({
      container: cA,
      mode: "webgl2",
      autoResize: false,
      onContextLost: () => {
        ctrlA?.dispose();
      },
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactoryA.createWebGL2Renderer,
    });
    ctrlA.canvases[1]!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(ctrlA.disposed).toBe(true);
    expect(ctrlA.contextLost).toBe(false);
    expect(ctrlA.canvases).toHaveLength(0);

    const cB = createContainer();
    const glFactoryB = createRealWebGL2Factory();
    let ctrlB: SpectrumEngineController | null = null;
    ctrlB = createSpectrumEngineController({
      container: cB,
      mode: "webgl2",
      autoResize: false,
      onContextLost: () => {
        ctrlB?.setMode("canvas2d");
      },
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactoryB.createWebGL2Renderer,
    });
    ctrlB.canvases[1]!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(ctrlB.activeKind).toBe("canvas2d");
    expect(ctrlB.contextLost).toBe(false);
    expect(ctrlB.canvases).toHaveLength(1);
    ctrlB.dispose();
  });

  it("detaches listeners before intentional dispose() and webgl2 -> canvas2d swaps so loseContext() never fires onContextLost", () => {
    // Case A: intentional controller.dispose()
    {
      const container = createContainer();
      const lostEvents: WebGL2ContextLostEvent[] = [];
      let dispatchedDuringDispose: Event | null = null;

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        onContextLost: (e) => lostEvents.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: (opts) =>
          new DomStubRenderer(
            "webgl2",
            [opts.surfaces.underlay, opts.surfaces.plot, opts.surfaces.overlay],
            () => {
              const ev = new Event("webglcontextlost", { cancelable: true });
              dispatchedDuringDispose = ev;
              opts.surfaces.plot.dispatchEvent(ev);
            },
          ),
      });

      controller.dispose();
      expect(controller.disposed).toBe(true);
      expect(controller.contextLost).toBe(false);
      expect(lostEvents).toHaveLength(0);
      expect(dispatchedDuringDispose).not.toBeNull();
      expect(dispatchedDuringDispose!.defaultPrevented).toBe(false);
    }

    // Case B: intentional webgl2 -> canvas2d swap
    {
      const container = createContainer();
      const lostEvents: WebGL2ContextLostEvent[] = [];

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        onContextLost: (e) => lostEvents.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: (opts) =>
          new DomStubRenderer(
            "webgl2",
            [opts.surfaces.underlay, opts.surfaces.plot, opts.surfaces.overlay],
            () => {
              opts.surfaces.plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
            },
          ),
      });

      controller.setMode("canvas2d");
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.contextLost).toBe(false);
      expect(lostEvents).toHaveLength(0);
      controller.dispose();
    }

    // Case C: dispose() while contextLost === true resets contextLost and ignores late restore
    {
      const container = createContainer();
      const glFactory = createRealWebGL2Factory();
      const restoredEvents: WebGL2ContextRestoredEvent[] = [];

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        onContextRestored: (e) => restoredEvents.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: glFactory.createWebGL2Renderer,
      });

      const oldPlot = controller.canvases[1]!;
      glFactory.instances[0]!.parts.gl.simulateContextLoss();
      oldPlot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(controller.contextLost).toBe(true);

      controller.dispose();
      expect(controller.disposed).toBe(true);
      expect(controller.contextLost).toBe(false);

      expect(() => oldPlot.dispatchEvent(new Event("webglcontextrestored"))).not.toThrow();
      expect(restoredEvents).toHaveLength(0);
    }
  });

  it("suspends rAF/render/clear while lost while keeping cold mutators and ResizeObserver live and coherent", () => {
    const container = createContainer();
    const raf = createManualRaf();
    const glFactory = createRealWebGL2Factory();
    let roCallback: ResizeObserverCallbackLike | null = null;

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: true,
      getDevicePixelRatio: () => 2,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      resizeObserverFactory: (cb): ResizeObserverLike => {
        roCallback = cb;
        return { observe() {}, disconnect() {} };
      },
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    const parts = glFactory.instances[0]!.parts;
    controller.setData(makePayload(128));
    controller.render();

    const plot = controller.canvases[1]!;
    parts.gl.simulateContextLoss();
    plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);

    parts.log.length = 0;
    raf.resetCounts();

    for (let i = 0; i < 5; i += 1) controller.requestRender();
    for (let i = 0; i < 3; i += 1) controller.render();
    controller.clear();
    controller.clear();

    expect(raf.scheduleCount()).toBe(0);
    expect(parts.log).toHaveLength(0);

    // Mutators + ResizeObserver while lost
    const updatedPayload = makePayload(200);
    controller.setData(updatedPayload);
    controller.setDomain(1552, 1558, -60, -10);
    controller.setDecimation({ algorithm: "lttb", threshold: 256 });
    roCallback!([{ contentRect: { width: 960, height: 540 } }]);

    expect(raf.scheduleCount()).toBe(0);
    expect(parts.log).toHaveLength(0);
    expect(controller.domain).toEqual({ xMin: 1552, xMax: 1558, yMin: -60, yMax: -10 });
    expect(controller.width).toBe(960);
    expect(controller.height).toBe(540);
    expect(controller.dpr).toBe(2);
    expect(controller.decimation).toEqual({ algorithm: "lttb", threshold: 256 });
    expect(controller.transform.deviceWidth).toBe(1920);
    expect(controller.transform.deviceHeight).toBe(1080);
    expect(controller.transform.xDomainMin).toBe(1552);
    expect(controller.transform.xDomainMax).toBe(1558);

    controller.dispose();
  });

  it("ignores spurious webglcontextrestored, restores synchronously with latest state, increments restoreCount, and resumes rAF", () => {
    const container = createContainer();
    const raf = createManualRaf();
    const glFactory = createRealWebGL2Factory();
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];
    const order: string[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onContextLost: (e) => {
        lostEvents.push(e);
        order.push("onContextLost");
      },
      onContextRestored: (e) => {
        restoredEvents.push(e);
        order.push(`onContextRestored:${e.restoreCount}`);
      },
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) => {
        const real = glFactory.createWebGL2Renderer(opts);
        const origRender = real.render.bind(real);
        real.render = () => {
          order.push("render");
          origRender();
        };
        return real;
      },
    });

    const parts = glFactory.instances[0]!.parts;
    const plot = controller.canvases[1]!;
    controller.setData(makePayload(64));
    controller.render();
    order.length = 0;

    // Spurious restore while healthy
    plot.dispatchEvent(new Event("webglcontextrestored"));
    expect(order).toEqual([]);
    expect(restoredEvents).toHaveLength(0);

    // Cycle 1 with domain mutation while lost
    parts.gl.simulateContextLoss();
    plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    controller.setDomain(1551, 1559, -50, 0);

    parts.gl.simulateContextRestore();
    plot.dispatchEvent(new Event("webglcontextrestored"));

    expect(controller.contextLost).toBe(false);
    expect(controller.canvases[1]).toBe(plot);
    expect(order).toEqual(["onContextLost", "render", "onContextRestored:1"]);
    expect(restoredEvents[0]).toEqual({
      activeKind: "webgl2",
      sampleCount: 64,
      mode: "webgl2",
      restoreCount: 1,
    });

    // rAF resumes normally
    raf.resetCounts();
    controller.requestRender();
    expect(raf.scheduleCount()).toBe(1);
    raf.flush();

    // Cycle 2
    parts.gl.simulateContextLoss();
    plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    parts.gl.simulateContextRestore();
    plot.dispatchEvent(new Event("webglcontextrestored"));

    expect(lostEvents).toHaveLength(2);
    expect(restoredEvents).toHaveLength(2);
    expect(restoredEvents[1]?.restoreCount).toBe(2);
    expect(controller.contextLost).toBe(false);

    controller.dispose();
  });

  it("recovers custom injected 11-member FigureRenderer stubs via 3 fresh canvases without emitting onEngineChange", () => {
    const container = createContainer();
    const glStubs: DomStubRenderer[] = [];
    const changes: EngineChangeEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      onEngineChange: (e) => changes.push(e),
      onContextRestored: (e) => restoredEvents.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) => {
        const stub = new DomStubRenderer("webgl2", [
          opts.surfaces.underlay,
          opts.surfaces.plot,
          opts.surfaces.overlay,
        ]);
        glStubs.push(stub);
        return stub;
      },
    });

    controller.setData(makePayload(120));
    controller.setDomain(10, 20, -40, 0);
    controller.setDecimation({ algorithm: "lttb", threshold: 64 });
    controller.render();
    changes.length = 0;

    const oldCanvases = [...controller.canvases];
    oldCanvases[1]!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);

    oldCanvases[1]!.dispatchEvent(new Event("webglcontextrestored"));

    expect(glStubs).toHaveLength(2);
    expect(glStubs[0]!.disposeCount).toBe(1);
    expect(glStubs[1]!.renderCount).toBeGreaterThanOrEqual(1);
    expect(controller.canvases).toHaveLength(3);
    expect(controller.canvases[0]).not.toBe(oldCanvases[0]);
    expect(controller.canvases[1]).not.toBe(oldCanvases[1]);
    expect(controller.canvases[2]).not.toBe(oldCanvases[2]);
    expect(restoredEvents).toEqual([
      { activeKind: "webgl2", sampleCount: 120, mode: "webgl2", restoreCount: 1 },
    ]);
    expect(changes).toHaveLength(0);

    controller.dispose();
  });

  it("exits lost state via setMode('canvas2d') immediately (ignoring late restore) and deferred mid-gesture", () => {
    // Immediate exit
    {
      const container = createContainer();
      const glFactory = createRealWebGL2Factory();
      const changes: EngineChangeEvent[] = [];
      const restores: WebGL2ContextRestoredEvent[] = [];

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        onEngineChange: (e) => changes.push(e),
        onContextRestored: (e) => restores.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: glFactory.createWebGL2Renderer,
      });
      changes.length = 0;

      const oldPlot = controller.canvases[1]!;
      glFactory.instances[0]!.parts.gl.simulateContextLoss();
      oldPlot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(controller.contextLost).toBe(true);

      controller.setMode("canvas2d");
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.contextLost).toBe(false);
      expect(controller.canvases).toHaveLength(1);
      expect(changes).toEqual([
        {
          previousKind: "webgl2",
          activeKind: "canvas2d",
          sampleCount: 0,
          mode: "canvas2d",
          reason: "mode-change",
        },
      ]);

      // Late restore on detached old plot canvas is ignored
      oldPlot.dispatchEvent(new Event("webglcontextrestored"));
      expect(restores).toHaveLength(0);
      controller.dispose();
    }

    // Gesture-deferred exit
    {
      const container = createContainer();
      const glFactory = createRealWebGL2Factory();
      const changes: EngineChangeEvent[] = [];

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        onEngineChange: (e) => changes.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: glFactory.createWebGL2Renderer,
      });
      changes.length = 0;

      glFactory.instances[0]!.parts.gl.simulateContextLoss();
      controller.canvases[1]!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      controller.setGestureActive(true);
      controller.setMode("canvas2d");

      expect(controller.activeKind).toBe("webgl2");
      expect(controller.pendingKind).toBe("canvas2d");
      expect(controller.contextLost).toBe(true);

      controller.setGestureActive(false);
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.pendingKind).toBeNull();
      expect(controller.contextLost).toBe(false);
      expect(changes[0]?.reason).toBe("gesture-end");
      controller.dispose();
    }
  });

  it("exits lost state via hysteresis-down in auto mode when sampleCount drops below downThreshold", () => {
    const container = createContainer();
    const raf = createManualRaf();
    const glFactory = createRealWebGL2Factory();
    const changes: EngineChangeEvent[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "auto",
      autoResize: false,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onEngineChange: (e) => changes.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    controller.setData(makePayload(80_000));
    controller.render();
    expect(controller.activeKind).toBe("webgl2");
    changes.length = 0;

    glFactory.instances[0]!.parts.gl.simulateContextLoss();
    controller.canvases[1]!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);

    raf.resetCounts();
    controller.setData(makePayload(30_000));
    controller.requestRender();
    expect(raf.scheduleCount()).toBe(1);

    raf.flush();
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.contextLost).toBe(false);
    expect(changes).toEqual([
      {
        previousKind: "webgl2",
        activeKind: "canvas2d",
        sampleCount: 30_000,
        mode: "auto",
        reason: "hysteresis-down",
      },
    ]);
    controller.dispose();
  });

  it("captures re-entrant webglcontextlost dispatched synchronously inside onEngineChange", () => {
    const container = createContainer();
    const glFactory = createRealWebGL2Factory();
    const lostEvents: WebGL2ContextLostEvent[] = [];
    let reentrantEvent: Event | null = null;
    let controller: SpectrumEngineController | null = null;

    controller = createSpectrumEngineController({
      container,
      mode: "auto",
      autoResize: false,
      onContextLost: (e) => lostEvents.push(e),
      onEngineChange: (e) => {
        if (e.activeKind === "webgl2" && controller !== null) {
          glFactory.instances[0]!.parts.gl.simulateContextLoss();
          reentrantEvent = new Event("webglcontextlost", { cancelable: true });
          controller.canvases[1]!.dispatchEvent(reentrantEvent);
        }
      },
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    controller.setData(makePayload(80_000));
    controller.render();

    expect(reentrantEvent).not.toBeNull();
    expect(reentrantEvent!.defaultPrevented).toBe(true);
    expect(controller.contextLost).toBe(true);
    expect(lostEvents).toHaveLength(1);
    controller.dispose();
  });

  it("keeps ViewportInteractionController pointer-drag pan unbroken across loss and mid-gesture in-place restore", () => {
    const container = createContainer();
    const raf = createManualRaf();
    const glFactory = createRealWebGL2Factory();

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      initialWidth: 800,
      initialHeight: 400,
      initialDpr: 1,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });

    controller.setData(makePayload(200));
    controller.setDomain(0, 200, -2, 2);
    controller.render();

    const interactionRaf = createManualRaf();
    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });
    const plotBefore = controller.canvases[1]!;

    // Start pointer-drag pan inside plot area
    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 200,
        pointerId: 1,
        button: 0,
      }),
    );
    expect(controller.gestureActive).toBe(true);

    // Lose context mid-drag
    glFactory.instances[0]!.parts.gl.simulateContextLoss();
    plotBefore.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);
    raf.resetCounts();

    // Continue dragging while lost
    const domainBeforeMove = { ...controller.domain };
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 200,
        pointerId: 1,
        button: 0,
      }),
    );
    interactionRaf.flush();
    expect(raf.scheduleCount()).toBe(0);
    expect(controller.domain.xMin).not.toBe(domainBeforeMove.xMin);
    const pannedDomain = { ...controller.domain };

    // Restore mid-gesture -> exact same plot canvas, repaints panned domain
    glFactory.instances[0]!.parts.gl.simulateContextRestore();
    plotBefore.dispatchEvent(new Event("webglcontextrestored"));

    expect(controller.contextLost).toBe(false);
    expect(controller.canvases[1]).toBe(plotBefore);
    expect(controller.domain).toEqual(pannedDomain);
    expect(controller.gestureActive).toBe(true);

    // Finish drag cleanly
    container.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 200,
        pointerId: 1,
        button: 0,
      }),
    );
    expect(controller.gestureActive).toBe(false);

    interaction.dispose();
    controller.dispose();
  });

  it("starts zero timers on permanent context loss and retryWebGL2() returns false while lost without detaching restore listener", () => {
    vi.useFakeTimers();
    const container = createContainer();
    const glFactory = createRealWebGL2Factory();
    const changes: EngineChangeEvent[] = [];
    const restores: WebGL2ContextRestoredEvent[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      onEngineChange: (e) => changes.push(e),
      onContextRestored: (e) => restores.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });
    changes.length = 0;

    const plot = controller.canvases[1]!;
    glFactory.instances[0]!.parts.gl.simulateContextLoss();
    plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.contextLost).toBe(true);
    expect(changes).toHaveLength(0);

    expect(controller.retryWebGL2()).toBe(false);
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.contextLost).toBe(true);

    // Restore listener still active
    glFactory.instances[0]!.parts.gl.simulateContextRestore();
    plot.dispatchEvent(new Event("webglcontextrestored"));
    expect(controller.contextLost).toBe(false);
    expect(restores).toHaveLength(1);
    expect(restores[0]?.restoreCount).toBe(1);

    controller.dispose();
  });

  it("keeps context listeners attached on the new plot canvas when outgoing.dispose() throws during custom-stub restore", () => {
    const container = createContainer();
    const glStubs: DomStubRenderer[] = [];
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];
    const fallbacks: WebGL2FallbackEvent[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      onContextLost: (e) => lostEvents.push(e),
      onContextRestored: (e) => restoredEvents.push(e),
      onWebGL2Fallback: (e) => fallbacks.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) => {
        const isFirst = glStubs.length === 0;
        const stub = new DomStubRenderer(
          "webgl2",
          [opts.surfaces.underlay, opts.surfaces.plot, opts.surfaces.overlay],
          isFirst
            ? () => {
                throw new Error("broken outgoing dispose on lost context");
              }
            : undefined,
        );
        glStubs.push(stub);
        return stub;
      },
    });

    controller.setData(makePayload(120));
    controller.render();

    const firstPlot = controller.canvases[1]!;
    firstPlot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);
    expect(lostEvents).toHaveLength(1);

    expect(() => firstPlot.dispatchEvent(new Event("webglcontextrestored"))).not.toThrow();

    expect(controller.activeKind).toBe("webgl2");
    expect(controller.contextLost).toBe(false);
    expect(glStubs).toHaveLength(2);
    expect(fallbacks).toHaveLength(0);
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0]?.restoreCount).toBe(1);

    // New active plot canvas MUST have context listeners attached!
    const secondPlot = controller.canvases[1]!;
    expect(secondPlot).not.toBe(firstPlot);
    const secondLoss = new Event("webglcontextlost", { cancelable: true });
    secondPlot.dispatchEvent(secondLoss);
    expect(secondLoss.defaultPrevented).toBe(true);
    expect(controller.contextLost).toBe(true);
    expect(lostEvents).toHaveLength(2);

    controller.dispose();
  });

  it("handles hysteresis-down and re-loss triggered during decimationPort.poll() on custom-stub restore", () => {
    // Subcase A: poll() settles below downThreshold -> transitions to Canvas2D without building a fresh WebGL2 stub
    {
      const container = createContainer();
      const glStubs: DomStubRenderer[] = [];
      const changes: EngineChangeEvent[] = [];
      const restores: WebGL2ContextRestoredEvent[] = [];
      const payload = makePayload(80_000);
      let shrinkOnPoll = false;

      const settlementSink: SettlementSink = { onSettled: () => {} };
      const basePort = createSyncDecimationPort({ poolPairs: 2, transitCapacitySamples: 256 });
      const decimationPort: DecimationPort = {
        ...basePort,
        poll: (sink: SettlementSink) => {
          if (shrinkOnPoll) {
            shrinkOnPoll = false;
            commitPayloadRevision(payload, 30_000);
            return 1;
          }
          return basePort.poll(sink);
        },
      };

      const controller = createSpectrumEngineController({
        container,
        mode: "auto",
        autoResize: false,
        decimationPort,
        settlementSink,
        onEngineChange: (e) => changes.push(e),
        onContextRestored: (e) => restores.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: (opts) => {
          const stub = new DomStubRenderer("webgl2", [
            opts.surfaces.underlay,
            opts.surfaces.plot,
            opts.surfaces.overlay,
          ]);
          glStubs.push(stub);
          return stub;
        },
      });

      controller.setData(payload);
      controller.render();
      expect(controller.activeKind).toBe("webgl2");
      expect(glStubs).toHaveLength(1);
      changes.length = 0;

      const plot = controller.canvases[1]!;
      plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(controller.contextLost).toBe(true);

      shrinkOnPoll = true;
      plot.dispatchEvent(new Event("webglcontextrestored"));

      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.contextLost).toBe(false);
      expect(glStubs).toHaveLength(1);
      expect(restores).toHaveLength(0);
      expect(changes).toEqual([
        {
          previousKind: "webgl2",
          activeKind: "canvas2d",
          sampleCount: 30_000,
          mode: "auto",
          reason: "hysteresis-down",
        },
      ]);

      controller.dispose();
    }

    // Subcase B: poll() re-entrantly dispatches webglcontextlost on the still-bound plot canvas -> stays lost without constructing a fresh stub
    {
      const container = createContainer();
      const glStubs: DomStubRenderer[] = [];
      const lostEvents: WebGL2ContextLostEvent[] = [];
      const restores: WebGL2ContextRestoredEvent[] = [];
      const fallbacks: WebGL2FallbackEvent[] = [];
      let relossPlot: HTMLCanvasElement | null = null;
      let relossOnPoll = false;

      const settlementSink: SettlementSink = { onSettled: () => {} };
      const basePort = createSyncDecimationPort({ poolPairs: 2, transitCapacitySamples: 256 });
      const decimationPort: DecimationPort = {
        ...basePort,
        poll: (sink: SettlementSink) => {
          if (relossOnPoll && relossPlot !== null) {
            relossOnPoll = false;
            relossPlot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
          }
          return basePort.poll(sink);
        },
      };

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        decimationPort,
        settlementSink,
        onContextLost: (e) => lostEvents.push(e),
        onContextRestored: (e) => restores.push(e),
        onWebGL2Fallback: (e) => fallbacks.push(e),
        createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
        createWebGL2Renderer: (opts) => {
          const stub = new DomStubRenderer("webgl2", [
            opts.surfaces.underlay,
            opts.surfaces.plot,
            opts.surfaces.overlay,
          ]);
          glStubs.push(stub);
          return stub;
        },
      });

      const plot = controller.canvases[1]!;
      relossPlot = plot;
      plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(lostEvents).toHaveLength(1);

      relossOnPoll = true;
      plot.dispatchEvent(new Event("webglcontextrestored"));

      expect(controller.activeKind).toBe("webgl2");
      expect(controller.contextLost).toBe(true);
      expect(glStubs).toHaveLength(1);
      expect(lostEvents).toHaveLength(2);
      expect(restores).toHaveLength(0);
      expect(fallbacks).toHaveLength(0);

      // Subsequent clean restore still works
      plot.dispatchEvent(new Event("webglcontextrestored"));
      expect(controller.contextLost).toBe(false);
      expect(glStubs).toHaveLength(2);
      expect(restores).toHaveLength(1);

      controller.dispose();
    }
  });

  it("stays in lost state without spurious fallback when a synchronous re-loss occurs during in-place restore render()", () => {
    const container = createContainer();
    const glFactory = createRealWebGL2Factory();
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];
    const fallbacks: WebGL2FallbackEvent[] = [];
    const changes: EngineChangeEvent[] = [];
    let relossPlot: HTMLCanvasElement | null = null;
    let triggerReloss = false;

    const settlementSink: SettlementSink = { onSettled: () => {} };
    const basePort = createSyncDecimationPort({ poolPairs: 2, transitCapacitySamples: 256 });
    const decimationPort: DecimationPort = {
      ...basePort,
      poll: (sink: SettlementSink) => {
        if (triggerReloss && relossPlot !== null) {
          triggerReloss = false;
          glFactory.instances[0]!.parts.gl.simulateContextLoss();
          relossPlot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
        }
        return basePort.poll(sink);
      },
    };

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      decimationPort,
      settlementSink,
      onContextLost: (e) => lostEvents.push(e),
      onContextRestored: (e) => restoredEvents.push(e),
      onWebGL2Fallback: (e) => fallbacks.push(e),
      onEngineChange: (e) => changes.push(e),
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: glFactory.createWebGL2Renderer,
    });
    changes.length = 0;

    controller.setData(makePayload(128));
    controller.render();

    const plot = controller.canvases[1]!;
    relossPlot = plot;
    const parts = glFactory.instances[0]!.parts;

    parts.gl.simulateContextLoss();
    plot.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.contextLost).toBe(true);
    expect(lostEvents).toHaveLength(1);

    // Restore, but trigger a real synchronous re-loss inside render() -> poll()
    parts.gl.simulateContextRestore();
    triggerReloss = true;
    plot.dispatchEvent(new Event("webglcontextrestored"));

    expect(controller.activeKind).toBe("webgl2");
    expect(controller.contextLost).toBe(true);
    expect(controller.webgl2Fallback).toBe(false);
    expect(lostEvents).toHaveLength(2);
    expect(fallbacks).toHaveLength(0);
    expect(changes).toHaveLength(0);
    expect(restoredEvents).toHaveLength(0);

    // Subsequent clean restore recovers in-place
    parts.gl.simulateContextRestore();
    plot.dispatchEvent(new Event("webglcontextrestored"));
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.contextLost).toBe(false);
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0]?.restoreCount).toBe(1);

    controller.dispose();
  });
});
