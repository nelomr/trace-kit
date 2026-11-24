/** @vitest-environment happy-dom */
import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createViewportTransform,
  type SpectrumDataPayload,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import {
  createSpectrumEngineController,
  createViewportInteractionController,
  type BoxSelectEvent,
  type BoxZoomState,
  type GestureStateChangeEvent,
  type SpectrumEngineController,
  type ViewportInvalidationEvent,
  type ViewportMutationReason,
} from "../../src/controller/index.js";

interface ResizableSurface {
  width: number;
  height: number;
}

class DomStubRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  readonly #surfaces: readonly ResizableSurface[];
  readonly #yAxes: readonly YAxisRegistration[] | undefined;
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
  setDomainCount = 0;

  constructor(
    kind: FigureRendererKind,
    surfaces: readonly ResizableSurface[],
    yAxes?: readonly YAxisRegistration[],
  ) {
    this.kind = kind;
    this.#surfaces = surfaces;
    this.#yAxes = yAxes;
    if (yAxes !== undefined && yAxes.length === 1 && yAxes[0] !== undefined) {
      this.#yMin = yAxes[0].domainMin;
      this.#yMax = yAxes[0].domainMax;
    }
    this.#transform = this.#computeTransform();
  }

  #computeTransform(): ViewportTransform {
    const singleAxis = this.#yAxes !== undefined && this.#yAxes.length === 1 ? this.#yAxes[0] : undefined;
    const yScaleKind = singleAxis !== undefined ? singleAxis.scaleKind : Y_SCALE_KIND_LINEAR;
    return createViewportTransform({
      cssWidth: this.#width,
      cssHeight: this.#height,
      dpr: this.#dpr,
      insetLeft: 80,
      insetRight: 20,
      insetTop: 20,
      insetBottom: 50,
      xDomainMin: this.#xMin,
      xDomainMax: this.#xMax,
      yDomainMin: this.#yMin,
      yDomainMax: this.#yMax,
      xOrigin: 0,
      yScaleKind,
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
    this.setDomainCount += 1;
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
    this.#transform = this.#computeTransform();
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#disposed) return;
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

  clear(): void {}
  setDecimation(): void {}

  dispose(): void {
    this.#disposed = true;
  }
}

interface ManualRafQueue {
  readonly requestAnimationFrame: (cb: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly pendingCount: () => number;
  readonly flushNext: () => boolean;
  readonly flushAll: () => number;
}

function createManualRafQueue(): ManualRafQueue {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  let now = 0;
  return {
    requestAnimationFrame(cb: FrameRequestCallback): number {
      const handle = nextHandle++;
      callbacks.set(handle, cb);
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      callbacks.delete(handle);
    },
    pendingCount(): number {
      return callbacks.size;
    },
    flushNext(): boolean {
      const first = callbacks.entries().next();
      if (first.done) return false;
      const [handle, cb] = first.value;
      callbacks.delete(handle);
      now += 16;
      cb(now);
      return true;
    },
    flushAll(): number {
      let ran = 0;
      while (callbacks.size > 0) {
        const snapshot = [...callbacks.entries()];
        callbacks.clear();
        for (const [, cb] of snapshot) {
          now += 16;
          cb(now);
          ran += 1;
        }
      }
      return ran;
    },
  };
}

interface ManualTimerQueue {
  readonly setTimeout: (cb: () => void, ms: number) => number;
  readonly clearTimeout: (handle: number) => void;
  readonly advanceBy: (ms: number) => void;
  readonly pendingCount: () => number;
  readonly now: () => number;
}

function createManualTimerQueue(): ManualTimerQueue {
  let currentMs = 0;
  let nextHandle = 1;
  const timers = new Map<number, { dueMs: number; cb: () => void }>();
  return {
    setTimeout(cb: () => void, ms: number): number {
      const handle = nextHandle++;
      timers.set(handle, { dueMs: currentMs + Math.max(0, ms), cb });
      return handle;
    },
    clearTimeout(handle: number): void {
      timers.delete(handle);
    },
    advanceBy(ms: number): void {
      const targetMs = currentMs + ms;
      while (true) {
        let nextId: number | null = null;
        let earliestDue = Infinity;
        for (const [id, entry] of timers.entries()) {
          if (entry.dueMs <= targetMs && entry.dueMs < earliestDue) {
            earliestDue = entry.dueMs;
            nextId = id;
          }
        }
        if (nextId === null) break;
        const entry = timers.get(nextId);
        timers.delete(nextId);
        currentMs = earliestDue;
        entry?.cb();
      }
      currentMs = targetMs;
    },
    pendingCount(): number {
      return timers.size;
    },
    now(): number {
      return currentMs;
    },
  };
}

function makePayload(sampleCount: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: Math.max(1, sampleCount),
    xOrigin: 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  if (sampleCount > 0) {
    commitPayloadRevision(payload, sampleCount);
  }
  return payload;
}

function makeDomRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
    },
  };
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: {
    clientX?: number;
    clientY?: number;
    pointerId?: number;
    pointerType?: string;
    button?: number;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
  } = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "mouse",
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchWheel(
  target: EventTarget,
  init: {
    clientX?: number;
    clientY?: number;
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
  } = {},
): WheelEvent {
  const clientX = init.clientX ?? 400;
  const clientY = init.clientY ?? 180;
  const shiftKey = init.shiftKey ?? false;
  const altKey = init.altKey ?? false;
  const ctrlKey = init.ctrlKey ?? false;
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    shiftKey,
    altKey,
    ctrlKey,
  });
  // happy-dom's WheelEvent extends Event rather than MouseEvent and drops MouseEventInit fields.
  if (typeof event.clientX !== "number") {
    Object.defineProperties(event, {
      clientX: { value: clientX, configurable: true },
      clientY: { value: clientY, configurable: true },
      shiftKey: { value: shiftKey, configurable: true },
      altKey: { value: altKey, configurable: true },
      ctrlKey: { value: ctrlKey, configurable: true },
    });
  }
  target.dispatchEvent(event);
  return event;
}

function setupController(options: {
  width?: number;
  height?: number;
  dpr?: number;
  rect?: DOMRect;
  yAxes?: readonly YAxisRegistration[];
  mode?: "auto" | "canvas2d" | "webgl2";
  domain?: readonly [number, number, number, number];
  raf?: ManualRafQueue;
  onEngineChange?: () => void;
} = {}): {
  container: HTMLDivElement;
  controller: SpectrumEngineController;
  renderers: DomStubRenderer[];
  raf: ManualRafQueue;
} {
  const width = options.width ?? 800;
  const height = options.height ?? 400;
  const dpr = options.dpr ?? 1;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rect = options.rect ?? makeDomRect(0, 0, width, height);
  container.getBoundingClientRect = () => rect;

  const raf = options.raf ?? createManualRafQueue();
  const renderers: DomStubRenderer[] = [];

  const controller = createSpectrumEngineController({
    container,
    mode: options.mode ?? "auto",
    autoResize: false,
    initialWidth: width,
    initialHeight: height,
    initialDpr: dpr,
    ...(options.yAxes !== undefined ? { yAxes: options.yAxes } : {}),
    ...(options.onEngineChange !== undefined ? { onEngineChange: options.onEngineChange } : {}),
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    createCanvas2DRenderer: (opts) => {
      const r = new DomStubRenderer("canvas2d", [opts.surface], opts.yAxes);
      renderers.push(r);
      return r;
    },
    createWebGL2Renderer: (opts) => {
      const r = new DomStubRenderer(
        "webgl2",
        [opts.surfaces.underlay, opts.surfaces.plot, opts.surfaces.overlay],
        opts.yAxes,
      );
      renderers.push(r);
      return r;
    },
  });

  if (options.domain !== undefined) {
    controller.setDomain(
      options.domain[0],
      options.domain[1],
      options.domain[2],
      options.domain[3],
    );
  } else if (options.yAxes === undefined) {
    controller.setDomain(0, 100, 0, 50);
  }

  return { container, controller, renderers, raf };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ViewportInteractionController — Happy-DOM integration", () => {
  it("attaches strictly to controller.container, survives canvas2d <-> webgl2 swaps, and balances listeners on dispose", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
    const interactionRaf = createManualRafQueue();
    const timers = createManualTimerQueue();

    let addCount = 0;
    let removeCount = 0;
    const origAdd = container.addEventListener.bind(container);
    const origRemove = container.removeEventListener.bind(container);
    container.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      addCount += 1;
      origAdd(type, listener, opts);
    }) as typeof container.addEventListener;
    container.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => {
      removeCount += 1;
      origRemove(type, listener, opts);
    }) as typeof container.removeEventListener;

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    expect(addCount).toBeGreaterThanOrEqual(7);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.canvases.length).toBe(1);

    // Swap canvas2d -> webgl2 -> canvas2d
    controller.setMode("webgl2");
    controller.render();
    expect(controller.activeKind).toBe("webgl2");
    expect(controller.canvases.length).toBe(3);

    // Wheel zoom on webgl2 works without re-attaching
    const domainBeforeWheel = { ...controller.domain };
    dispatchWheel(container, { clientX: 430, clientY: 185, deltaY: -100 });
    expect(controller.domain.xMax - controller.domain.xMin).toBeLessThan(
      domainBeforeWheel.xMax - domainBeforeWheel.xMin,
    );
    timers.advanceBy(120);
    expect(controller.gestureActive).toBe(false);

    // Drag pan on webgl2 works without re-attaching
    const xMinBeforePan = controller.domain.xMin;
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    dispatchPointer(container, "pointermove", { clientX: 470, clientY: 180 });
    interactionRaf.flushAll();
    dispatchPointer(container, "pointerup", { clientX: 470, clientY: 180 });
    expect(controller.domain.xMin).toBeLessThan(xMinBeforePan);

    // Swap back to canvas2d
    controller.setMode("canvas2d");
    controller.render();
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.canvases.length).toBe(1);

    const xMinAfterSwap = controller.domain.xMin;
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    dispatchPointer(container, "pointermove", { clientX: 330, clientY: 180 });
    interactionRaf.flushAll();
    dispatchPointer(container, "pointerup", { clientX: 330, clientY: 180 });
    expect(controller.domain.xMin).toBeGreaterThan(xMinAfterSwap);

    // Dispose twice: balanced listener removals and idempotent second dispose
    interaction.dispose();
    expect(interaction.disposed).toBe(true);
    expect(removeCount).toBe(addCount);
    const removeAfterFirst = removeCount;

    expect(() => interaction.dispose()).not.toThrow();
    expect(removeCount).toBe(removeAfterFirst);
    controller.dispose();
  });

  it("saves and restores touch-action lifecycle and respects manageTouchAction: false", () => {
    const { container, controller } = setupController();
    container.style.touchAction = "pan-y";

    const interaction = createViewportInteractionController({ controller });
    expect(container.style.touchAction).toBe("none");
    interaction.dispose();
    expect(container.style.touchAction).toBe("pan-y");

    container.style.touchAction = "manipulation";
    const interaction2 = createViewportInteractionController({
      controller,
      manageTouchAction: false,
    });
    expect(container.style.touchAction).toBe("manipulation");
    interaction2.dispose();
    expect(container.style.touchAction).toBe("manipulation");
    controller.dispose();
  });

  it("performs zero getBoundingClientRect calls across 50 pointermove events and maps scaled and 0x0 headless rects accurately", () => {
    const { container, controller } = setupController({
      width: 400,
      height: 200,
      dpr: 1.5,
      rect: makeDomRect(100, 50, 400, 200),
      domain: [0, 100, 0, 50],
    });
    const rectSpy = vi.fn(() => makeDomRect(100, 50, 400, 200));
    container.getBoundingClientRect = rectSpy;
    const interactionRaf = createManualRafQueue();

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });

    // At rect {100, 50, 400, 200} with dpr 1.5 (deviceWidth 600, deviceHeight 300),
    // client (300, 150) -> css (200, 100) -> device (300, 150) which is inside plot.
    dispatchPointer(container, "pointerdown", { clientX: 300, clientY: 150 });
    expect(rectSpy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 50; i += 1) {
      dispatchPointer(container, "pointermove", { clientX: 300 + i, clientY: 150 });
    }
    expect(rectSpy).toHaveBeenCalledTimes(1);

    dispatchPointer(container, "pointerup", { clientX: 350, clientY: 150 });
    expect(rectSpy).toHaveBeenCalledTimes(1);
    expect(controller.domain.xMin).toBeLessThan(0);
    interaction.dispose();
    controller.dispose();

    // 0 x 0 headless rect fallback (css * dpr)
    const zeroSetup = setupController({
      width: 400,
      height: 200,
      dpr: 2,
      rect: makeDomRect(0, 0, 0, 0),
      domain: [0, 100, 0, 50],
    });
    const zeroInteraction = createViewportInteractionController({
      controller: zeroSetup.controller,
    });
    // client (120, 80) * dpr 2 -> device (240, 160), inside plot [160..760] x [40..300]
    const w = dispatchWheel(zeroSetup.container, { clientX: 120, clientY: 80, deltaY: -100 });
    expect(w.defaultPrevented).toBe(true);
    expect(Number.isFinite(zeroSetup.controller.domain.xMin)).toBe(true);
    expect(Number.isFinite(zeroSetup.controller.domain.yMin)).toBe(true);
    expect(zeroSetup.controller.domain.xMax - zeroSetup.controller.domain.xMin).toBeLessThan(100);
    zeroInteraction.dispose();
    zeroSetup.controller.dispose();
  });

  it("ignores outside events, guards throwing setPointerCapture, ignores secondary mouse button, and handles 2-pointer pinch ignoring 3rd pointer", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 100] });
    const interactionRaf = createManualRafQueue();

    // Make setPointerCapture throw NotFoundError
    container.setPointerCapture = () => {
      throw new DOMException("No active pointer", "NotFoundError");
    };
    container.releasePointerCapture = () => {
      throw new DOMException("No active pointer", "NotFoundError");
    };

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });

    // Outside (bottom-left corner: x=40 < plotLeft 80, y=370 > plotBottom 350)
    dispatchPointer(container, "pointerdown", { clientX: 40, clientY: 370 });
    expect(controller.gestureActive).toBe(false);
    expect(interaction.state).toBe("idle");
    const outWheel = dispatchWheel(container, { clientX: 40, clientY: 370, deltaY: -100 });
    expect(outWheel.defaultPrevented).toBe(false);
    expect(controller.domain).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });

    // Secondary mouse button (button: 2) ignored
    dispatchPointer(container, "pointerdown", {
      clientX: 400,
      clientY: 180,
      pointerType: "mouse",
      button: 2,
    });
    expect(controller.gestureActive).toBe(false);
    expect(interaction.state).toBe("idle");

    // Throwing setPointerCapture never breaks normal drag
    expect(() => {
      dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
      dispatchPointer(container, "pointermove", { clientX: 470, clientY: 180 });
      interactionRaf.flushAll();
      dispatchPointer(container, "pointerup", { clientX: 470, clientY: 180 });
    }).not.toThrow();
    expect(controller.domain.xMin).toBeLessThan(0);

    // Reset domain for 2-pointer touch pinch test
    interaction.resetDomain();
    expect(controller.domain).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });

    // Two-finger touch pinch: dist 200 -> 400 around midpoint (300, 200), 3rd pointer ignored
    dispatchPointer(container, "pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    dispatchPointer(container, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 400,
      clientY: 200,
    });
    expect(interaction.state).toBe("pinching");
    expect(controller.gestureActive).toBe(true);

    // 3rd simultaneous pointer ignored
    dispatchPointer(container, "pointerdown", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 500,
      clientY: 200,
    });
    dispatchPointer(container, "pointermove", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 700,
      clientY: 200,
    });

    dispatchPointer(container, "pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 200,
    });
    dispatchPointer(container, "pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 500,
      clientY: 200,
    });
    interactionRaf.flushAll();

    // Span halves from 100 to 50 around midpoint (300, 200)
    expect(controller.domain.xMax - controller.domain.xMin).toBeCloseTo(50, 9);
    expect(controller.domain.yMax - controller.domain.yMin).toBeCloseTo(50, 9);

    dispatchPointer(container, "pointerup", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 200,
    });
    expect(controller.gestureActive).toBe(true);
    dispatchPointer(container, "pointerup", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 500,
      clientY: 200,
    });
    expect(controller.gestureActive).toBe(false);
    expect(interaction.state).toBe("idle");

    interaction.dispose();
    controller.dispose();
  });

  it("handles wheel inverse symmetry, macOS Shift+Wheel Y-only, trackpad ctrlKey pinch, disabled no-preventDefault, and trailing settle debounce", () => {
    const { container, controller } = setupController({ domain: [100, 200, -50, 50] });
    const timers = createManualTimerQueue();
    const interactionRaf = createManualRafQueue();

    const interaction = createViewportInteractionController({
      controller,
      wheelSensitivity: 0.001,
      pinchSensitivity: 0.004,
      settleDebounceMs: 120,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    // Exact inverse symmetry: -100 then +100 at same point returns to [100, 200] x [-50, 50]
    dispatchWheel(container, { clientX: 350, clientY: 160, deltaY: -100 });
    dispatchWheel(container, { clientX: 350, clientY: 160, deltaY: 100 });
    expect(controller.domain.xMin).toBeCloseTo(100, 8);
    expect(controller.domain.xMax).toBeCloseTo(200, 8);
    expect(controller.domain.yMin).toBeCloseTo(-50, 8);
    expect(controller.domain.yMax).toBeCloseTo(50, 8);
    timers.advanceBy(120);

    // macOS Shift + Wheel (deltaX: -120, deltaY: 0, shiftKey: true) -> zooms Y-only
    const xBeforeShift = { min: controller.domain.xMin, max: controller.domain.xMax };
    const ySpanBeforeShift = controller.domain.yMax - controller.domain.yMin;
    dispatchWheel(container, {
      clientX: 350,
      clientY: 160,
      deltaX: -120,
      deltaY: 0,
      shiftKey: true,
    });
    expect(controller.domain.xMin).toBeCloseTo(xBeforeShift.min, 10);
    expect(controller.domain.xMax).toBeCloseTo(xBeforeShift.max, 10);
    expect(controller.domain.yMax - controller.domain.yMin).toBeCloseTo(
      ySpanBeforeShift * Math.exp(-120 * 0.001),
      8,
    );
    timers.advanceBy(120);

    // Trackpad pinch (ctrlKey: true, deltaY: -10) -> preventDefault + pinchSensitivity (0.004)
    interaction.resetDomain();
    const xSpanBeforePinch = controller.domain.xMax - controller.domain.xMin;
    const pinchEvent = dispatchWheel(container, {
      clientX: 430,
      clientY: 185,
      deltaY: -10,
      ctrlKey: true,
    });
    expect(pinchEvent.defaultPrevented).toBe(true);
    expect(controller.domain.xMax - controller.domain.xMin).toBeCloseTo(
      xSpanBeforePinch * Math.exp(-10 * 0.004),
      8,
    );
    timers.advanceBy(120);

    // Disabled controller never calls preventDefault
    interaction.setEnabled(false);
    const disabledWheel = dispatchWheel(container, { clientX: 430, clientY: 185, deltaY: -100 });
    expect(disabledWheel.defaultPrevented).toBe(false);
    interaction.setEnabled(true);

    // Rapid wheel burst: 10 events at 0..180 ms (every 20 ms), settleDebounceMs = 120
    for (let i = 0; i < 10; i += 1) {
      dispatchWheel(container, { clientX: 430, clientY: 185, deltaY: -20 });
      if (i < 9) {
        timers.advanceBy(20);
      }
    }
    // Now at t = 180 ms. Advance 70 ms -> t = 250 ms (still latched)
    timers.advanceBy(70);
    expect(controller.gestureActive).toBe(true);
    expect(interaction.state).toBe("wheeling");

    // Advance 50 ms -> t = 300 ms (120 ms after last tick -> settled!)
    timers.advanceBy(50);
    expect(controller.gestureActive).toBe(false);
    expect(interaction.state).toBe("idle");

    interaction.dispose();
    controller.dispose();
  });

  it("coalesces 20 rapid pointermove events to 1 rAF setDomain and enforces single-axis gutter drag pan", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
    const interactionRaf = createManualRafQueue();
    const setDomainSpy = vi.spyOn(controller, "setDomain");
    const renderSpy = vi.spyOn(controller, "render");

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });

    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    for (let i = 1; i <= 20; i += 1) {
      dispatchPointer(container, "pointermove", { clientX: 400 + i * 2, clientY: 180 });
    }
    expect(setDomainSpy).toHaveBeenCalledTimes(0);
    expect(renderSpy).toHaveBeenCalledTimes(0);
    expect(interactionRaf.pendingCount()).toBe(1);

    interactionRaf.flushAll();
    expect(setDomainSpy).toHaveBeenCalledTimes(1);
    // Plot width = 700, dx = +40 -> deltaX = -40 * 100 / 700
    expect(controller.domain.xMin).toBeCloseTo((-40 * 100) / 700, 9);

    dispatchPointer(container, "pointerup", { clientX: 440, clientY: 180 });
    expect(controller.gestureActive).toBe(false);

    // Axis-gutter drag: x-gutter diagonal drag shifts X only
    interaction.resetDomain();
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 370 });
    dispatchPointer(container, "pointermove", { clientX: 440, clientY: 410 });
    dispatchPointer(container, "pointerup", { clientX: 440, clientY: 410 });
    expect(controller.domain.xMin).not.toBe(0);
    expect(controller.domain.yMin).toBe(0);
    expect(controller.domain.yMax).toBe(50);

    // Axis-gutter drag: y-gutter diagonal drag shifts Y only
    interaction.resetDomain();
    dispatchPointer(container, "pointerdown", { clientX: 40, clientY: 180 });
    dispatchPointer(container, "pointermove", { clientX: 80, clientY: 220 });
    dispatchPointer(container, "pointerup", { clientX: 80, clientY: 220 });
    expect(controller.domain.xMin).toBe(0);
    expect(controller.domain.xMax).toBe(100);
    expect(controller.domain.yMin).not.toBe(0);

    interaction.dispose();
    controller.dispose();
  });

  it("drives the 5-state box-zoom machine and compositor-only overlay with zero canvas repaints during drag", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
    const boxStates: BoxZoomState[] = [];
    const boxSelects: BoxSelectEvent[] = [];

    const setDomainSpy = vi.spyOn(controller, "setDomain");
    const renderSpy = vi.spyOn(controller, "render");
    const requestRenderSpy = vi.spyOn(controller, "requestRender");

    const interaction = createViewportInteractionController({
      controller,
      minBoxSizeCss: 4,
      onGestureStateChange: (e: GestureStateChangeEvent) => boxStates.push(e.boxState),
      onBoxSelect: (e: BoxSelectEvent) => boxSelects.push(e),
    });

    const overlay = container.querySelector<HTMLDivElement>('[data-trace-kit-overlay="box-zoom"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.style.position).toBe("absolute");
    expect(overlay?.style.left).toBe("0px");
    expect(overlay?.style.top).toBe("0px");
    expect(overlay?.style.display).toBe("none");

    // 1. Shift+drag sweep: idle -> pending -> active -> committed -> idle with 0 canvas repaints during 30 moves
    dispatchPointer(container, "pointerdown", { clientX: 150, clientY: 80, shiftKey: true });
    dispatchPointer(container, "pointermove", { clientX: 152, clientY: 81, shiftKey: true }); // sub-threshold
    expect(overlay?.style.display).toBe("none");

    for (let i = 1; i <= 30; i += 1) {
      dispatchPointer(container, "pointermove", {
        clientX: 150 + i * 6,
        clientY: 80 + i * 3,
        shiftKey: true,
      });
    }
    expect(overlay?.style.display).toBe("block");
    expect(overlay?.style.transform).toMatch(/^translate3d\([^,]+px,\s*[^,]+px,\s*0\)$/);
    expect(Number.parseFloat(overlay?.style.width ?? "0")).toBeGreaterThan(0);
    expect(Number.parseFloat(overlay?.style.height ?? "0")).toBeGreaterThan(0);
    expect(setDomainSpy).toHaveBeenCalledTimes(0);
    expect(renderSpy).toHaveBeenCalledTimes(0);
    expect(requestRenderSpy).toHaveBeenCalledTimes(0);

    dispatchPointer(container, "pointerup", { clientX: 330, clientY: 170, shiftKey: true });
    expect(boxStates).toEqual(["pending", "active", "committed", "idle"]);
    expect(boxSelects.length).toBe(1);
    expect(setDomainSpy).toHaveBeenCalledTimes(1);
    expect(overlay?.style.display).toBe("none");
    expect(controller.gestureActive).toBe(false);

    // 2. Sub-threshold click cancels without mutating domain
    boxStates.length = 0;
    boxSelects.length = 0;
    interaction.resetDomain();
    interaction.setDragMode("box-zoom");
    const domainBeforeClick = { ...controller.domain };
    dispatchPointer(container, "pointerdown", { clientX: 200, clientY: 100 });
    dispatchPointer(container, "pointermove", { clientX: 202, clientY: 101 });
    dispatchPointer(container, "pointerup", { clientX: 202, clientY: 101 });
    expect(boxStates).toEqual(["pending", "cancelled", "idle"]);
    expect(boxSelects.length).toBe(0);
    expect(controller.domain).toEqual(domainBeforeClick);
    expect(controller.gestureActive).toBe(false);

    // 3. Escape mid-sweep cancels cleanly and ignores subsequent pointerup
    boxStates.length = 0;
    dispatchPointer(container, "pointerdown", { clientX: 200, clientY: 100 });
    dispatchPointer(container, "pointermove", { clientX: 320, clientY: 200 });
    expect(interaction.state).toBe("box-active");
    expect(overlay?.style.display).toBe("block");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(boxStates).toEqual(["pending", "active", "cancelled", "idle"]);
    expect(overlay?.style.display).toBe("none");
    expect(controller.gestureActive).toBe(false);
    expect(controller.domain).toEqual(domainBeforeClick);

    dispatchPointer(container, "pointerup", { clientX: 320, clientY: 200 });
    expect(controller.domain).toEqual(domainBeforeClick);

    // 4. Overlay stays after all managed canvases across canvas2d -> webgl2 -> canvas2d swaps
    const assertOverlayLast = () => {
      const children = Array.from(container.children);
      const overlays = container.querySelectorAll('[data-trace-kit-overlay="box-zoom"]');
      expect(overlays.length).toBe(1);
      const overlayIdx = children.indexOf(overlays[0]!);
      const canvasIndices = Array.from(container.querySelectorAll("canvas")).map((c) =>
        children.indexOf(c),
      );
      for (const idx of canvasIndices) {
        expect(overlayIdx).toBeGreaterThan(idx);
      }
    };
    assertOverlayLast();
    controller.setMode("webgl2");
    controller.render();
    assertOverlayLast();
    controller.setMode("canvas2d");
    controller.render();
    assertOverlayLast();

    interaction.dispose();
    expect(container.querySelector('[data-trace-kit-overlay="box-zoom"]')).toBeNull();
    controller.dispose();
  });

  it("clears gestureActive cleanly on all abnormal exits and handles re-entrant dispose/cancelGesture in callbacks", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
    const interactionRaf = createManualRafQueue();

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });

    // pointercancel
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    expect(controller.gestureActive).toBe(true);
    dispatchPointer(container, "pointercancel", { clientX: 400, clientY: 180 });
    expect(controller.gestureActive).toBe(false);
    expect(interaction.state).toBe("idle");
    const domainAfterCancel = { ...controller.domain };
    dispatchPointer(container, "pointermove", { clientX: 500, clientY: 180 });
    interactionRaf.flushAll();
    expect(controller.domain).toEqual(domainAfterCancel);

    // lostpointercapture
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    expect(controller.gestureActive).toBe(true);
    dispatchPointer(container, "lostpointercapture", { clientX: 400, clientY: 180 });
    expect(controller.gestureActive).toBe(false);
    expect(interaction.state).toBe("idle");

    // cancelGesture() and setEnabled(false)
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    interaction.cancelGesture();
    expect(controller.gestureActive).toBe(false);
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    interaction.setEnabled(false);
    expect(controller.gestureActive).toBe(false);
    interaction.dispose();
    controller.dispose();

    // Re-entrant dispose inside onInvalidate never loops or throws
    const reentrantSetup = setupController({ domain: [0, 100, 0, 50] });
    let handle: ReturnType<typeof createViewportInteractionController> | null = null;
    handle = createViewportInteractionController({
      controller: reentrantSetup.controller,
      onInvalidate: () => {
        handle?.dispose();
      },
    });
    expect(() => {
      dispatchPointer(reentrantSetup.container, "pointerdown", { clientX: 400, clientY: 180 });
      dispatchPointer(reentrantSetup.container, "pointermove", { clientX: 440, clientY: 180 });
      dispatchPointer(reentrantSetup.container, "pointerup", { clientX: 440, clientY: 180 });
    }).not.toThrow();
    expect(handle.disposed).toBe(true);
    expect(reentrantSetup.controller.gestureActive).toBe(false);
    reentrantSetup.controller.dispose();

    // Re-entrant cancelGesture inside onBoxSelect never loops or throws
    const reentrantBoxSetup = setupController({ domain: [0, 100, 0, 50] });
    let boxHandle: ReturnType<typeof createViewportInteractionController> | null = null;
    boxHandle = createViewportInteractionController({
      controller: reentrantBoxSetup.controller,
      dragMode: "box-zoom",
      onBoxSelect: () => {
        boxHandle?.cancelGesture();
      },
    });
    expect(() => {
      dispatchPointer(reentrantBoxSetup.container, "pointerdown", { clientX: 150, clientY: 80 });
      dispatchPointer(reentrantBoxSetup.container, "pointermove", { clientX: 300, clientY: 180 });
      dispatchPointer(reentrantBoxSetup.container, "pointerup", { clientX: 300, clientY: 180 });
    }).not.toThrow();
    expect(reentrantBoxSetup.controller.gestureActive).toBe(false);
    boxHandle.dispose();
    reentrantBoxSetup.controller.dispose();

    // Re-entrant dispose inside onEngineChange triggered by setGestureActive(false) never loops or throws
    let engineDisposeHandle: ReturnType<typeof createViewportInteractionController> | null = null;
    const engineReentrantSetup = setupController({
      mode: "auto",
      domain: [0, 100, 0, 50],
      onEngineChange: () => {
        engineDisposeHandle?.dispose();
      },
    });
    engineReentrantSetup.controller.setData(makePayload(10_000));
    engineReentrantSetup.controller.render();
    engineDisposeHandle = createViewportInteractionController({
      controller: engineReentrantSetup.controller,
      onInvalidate: (e) => {
        if (e.phase === "settled") {
          engineReentrantSetup.controller.setData(makePayload(90_000));
        }
      },
    });
    expect(() => {
      dispatchPointer(engineReentrantSetup.container, "pointerdown", { clientX: 400, clientY: 180 });
      dispatchPointer(engineReentrantSetup.container, "pointermove", { clientX: 440, clientY: 180 });
      dispatchPointer(engineReentrantSetup.container, "pointerup", { clientX: 440, clientY: 180 });
    }).not.toThrow();
    expect(engineDisposeHandle.disposed).toBe(true);
    expect(engineReentrantSetup.controller.gestureActive).toBe(false);
    engineReentrantSetup.controller.dispose();

    // Fail-fast constructor validation throws RangeError without appending overlay or changing touchAction
    const badSetup = setupController();
    badSetup.container.style.touchAction = "pan-x";
    expect(() =>
      createViewportInteractionController({ controller: badSetup.controller, wheelSensitivity: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      createViewportInteractionController({ controller: badSetup.controller, pinchSensitivity: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      createViewportInteractionController({ controller: badSetup.controller, minBoxSizeCss: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      createViewportInteractionController({ controller: badSetup.controller, settleDebounceMs: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      createViewportInteractionController({
        controller: badSetup.controller,
        homeDomain: { xMin: Number.NaN, xMax: 1, yMin: 0, yMax: 1 },
      }),
    ).toThrow(RangeError);
    expect(badSetup.container.style.touchAction).toBe("pan-x");
    expect(badSetup.container.querySelector('[data-trace-kit-overlay="box-zoom"]')).toBeNull();
    badSetup.controller.dispose();
  });

  it("coalesces wheel gesture invalidations, fires one trailing wheel-settle, suppresses cancelled timers, and orders settled invalidation before setGestureActive(false) hysteresis flush", () => {
    const { container, controller } = setupController({
      mode: "auto",
      domain: [0, 100, 0, 50],
    });
    const interactionRaf = createManualRafQueue();
    const timers = createManualTimerQueue();
    const events: ViewportInvalidationEvent[] = [];

    const interaction = createViewportInteractionController({
      controller,
      settleDebounceMs: 120,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      onInvalidate: (e) => events.push(e),
    });

    // 15 wheel events over 200 ms across 12 animation frames
    for (let i = 0; i < 15; i += 1) {
      dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -15 });
      if (i < 12) {
        interactionRaf.flushNext();
      }
      if (i < 14) {
        timers.advanceBy(Math.round(200 / 14));
      }
    }
    const gestureEventsDuringBurst = events.filter((e) => e.phase === "gesture");
    const settledEventsDuringBurst = events.filter((e) => e.phase === "settled");
    expect(gestureEventsDuringBurst.length).toBeLessThanOrEqual(12);
    expect(gestureEventsDuringBurst.length).toBeGreaterThan(0);
    expect(settledEventsDuringBurst.length).toBe(0);

    timers.advanceBy(120);
    const settledAfter = events.filter((e) => e.phase === "settled");
    expect(settledAfter.length).toBe(1);
    expect(settledAfter[0]?.reason).toBe("wheel-settle");
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.seq).toBeGreaterThan(events[i - 1]!.seq);
    }

    // Cancelling / resetting before debounce expiry prevents any stale wheel-settle callback
    events.length = 0;
    dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -30 });
    interaction.cancelGesture();
    timers.advanceBy(500);
    expect(events.filter((e) => e.reason === "wheel-settle").length).toBe(0);

    interaction.dispose();
    controller.dispose();

    // Hysteresis ordering: onInvalidate("settled", "pan-end") runs BEFORE setGestureActive(false)
    const hystSetup = setupController({ mode: "auto", domain: [0, 100, 0, 50] });
    hystSetup.controller.setData(makePayload(10_000));
    hystSetup.controller.render();
    expect(hystSetup.controller.activeKind).toBe("canvas2d");

    let activeKindDuringSettledCallback: string | null = null;
    let gestureActiveDuringSettledCallback: boolean | null = null;
    const hystInteraction = createViewportInteractionController({
      controller: hystSetup.controller,
      onInvalidate: (e) => {
        if (e.phase === "settled" && e.reason === "pan-end") {
          activeKindDuringSettledCallback = hystSetup.controller.activeKind;
          gestureActiveDuringSettledCallback = hystSetup.controller.gestureActive;
          hystSetup.controller.setData(makePayload(90_000));
        }
      },
    });

    dispatchPointer(hystSetup.container, "pointerdown", { clientX: 400, clientY: 180 });
    dispatchPointer(hystSetup.container, "pointermove", { clientX: 450, clientY: 180 });
    expect(hystSetup.controller.activeKind).toBe("canvas2d");
    dispatchPointer(hystSetup.container, "pointerup", { clientX: 450, clientY: 180 });

    expect(activeKindDuringSettledCallback).toBe("canvas2d");
    expect(gestureActiveDuringSettledCallback).toBe(true);
    expect(hystSetup.controller.gestureActive).toBe(false);
    expect(hystSetup.controller.activeKind).toBe("webgl2");
    expect(hystSetup.controller.canvases.length).toBe(3);

    hystInteraction.dispose();
    hystSetup.controller.dispose();
  });

  it("supports homeDomain, dblclick reset, programmatic log-Y/bounds API, and safe post-dispose no-ops", () => {
    const logAxes: readonly YAxisRegistration[] = [
      {
        id: "power",
        scaleKind: Y_SCALE_KIND_LOG,
        domainMin: 1,
        domainMax: 1000,
        side: AXIS_SIDE_LEFT,
      },
    ];
    const { container, controller } = setupController({
      yAxes: logAxes,
      domain: [0, 100, 1, 1000],
    });
    const reasons: ViewportMutationReason[] = [];
    const invalidations: ViewportInvalidationEvent[] = [];

    const interaction = createViewportInteractionController({
      controller,
      constraints: { bounds: { xMin: 0, xMax: 100 } },
      onDomainChange: (_d, reason) => reasons.push(reason),
      onInvalidate: (e) => invalidations.push(e),
    });

    expect(interaction.homeDomain).toEqual({ xMin: 0, xMax: 100, yMin: 1, yMax: 1000 });

    // zoomByFactor(0.5, 0.5, 0.5, 0.5) on [0, 100] x [1, 1000] (log Y)
    expect(interaction.zoomByFactor(0.5, 0.5, 0.5, 0.5)).toBe(true);
    expect(controller.domain.xMin).toBeCloseTo(25, 10);
    expect(controller.domain.xMax).toBeCloseTo(75, 10);
    expect(controller.domain.yMin).toBeCloseTo(10 ** 0.75, 10);
    expect(controller.domain.yMax).toBeCloseTo(10 ** 2.25, 10);
    expect(invalidations.at(-1)).toMatchObject({ phase: "settled", reason: "programmatic" });

    // panByFraction(-2, 1/3) -> X clamps to [0, 50] preserving span 50; Y shifts +0.5 decades
    expect(interaction.panByFraction(-2, 1 / 3)).toBe(true);
    expect(controller.domain.xMin).toBeCloseTo(0, 10);
    expect(controller.domain.xMax).toBeCloseTo(50, 10);
    expect(Math.log10(controller.domain.yMin)).toBeCloseTo(1.25, 10);
    expect(Math.log10(controller.domain.yMax)).toBeCloseTo(2.75, 10);
    expect(controller.domain.yMin).toBeGreaterThan(0);
    expect(invalidations.at(-1)).toMatchObject({ phase: "settled", reason: "programmatic" });

    // dblclick inside plot restores homeDomain
    container.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 400, clientY: 180 }));
    expect(controller.domain).toEqual({ xMin: 0, xMax: 100, yMin: 1, yMax: 1000 });
    expect(invalidations.at(-1)).toMatchObject({ phase: "settled", reason: "reset" });

    // setHomeDomain validates finite bounds and updates reset target
    expect(() => interaction.setHomeDomain(Number.NaN, 100, 1, 1000)).toThrow(RangeError);
    interaction.setHomeDomain(10, 90, 2, 500);
    expect(interaction.homeDomain).toEqual({ xMin: 10, xMax: 90, yMin: 2, yMax: 500 });
    interaction.resetDomain();
    expect(controller.domain).toEqual({ xMin: 10, xMax: 90, yMin: 2, yMax: 500 });

    // commitBoxDomain clamps with span-preserving bounds slide and fires reason: "box-zoom"
    expect(interaction.commitBoxDomain(-10, 30, 10, 100)).toBe(true);
    expect(controller.domain.xMin).toBe(0);
    expect(controller.domain.xMax).toBe(40);
    expect(controller.domain.yMin).toBe(10);
    expect(controller.domain.yMax).toBe(100);
    expect(invalidations.at(-1)).toMatchObject({ phase: "settled", reason: "box-zoom" });

    // doubleClickReset: false and dblclick outside are no-ops
    const countBeforeOutsideDbl = invalidations.length;
    container.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 40, clientY: 370 }));
    expect(invalidations.length).toBe(countBeforeOutsideDbl);

    // Dispose and verify all imperative methods are safe no-ops
    interaction.dispose();
    const setDomainSpy = vi.spyOn(controller, "setDomain");
    expect(interaction.zoomByFactor(0.5, 0.5)).toBe(false);
    expect(interaction.panByFraction(0.1, 0)).toBe(false);
    expect(interaction.commitBoxDomain(0, 10, 1, 10)).toBe(false);
    expect(() => interaction.resetDomain()).not.toThrow();
    expect(() => interaction.setHomeDomain(Number.NaN, 0, 0, 0)).not.toThrow();
    expect(() => interaction.setDragMode("box-zoom")).not.toThrow();
    expect(() => interaction.setEnabled(true)).not.toThrow();
    expect(() => interaction.cancelGesture()).not.toThrow();
    expect(() => interaction.dispose()).not.toThrow();
    expect(setDomainSpy).not.toHaveBeenCalled();

    // Verify doubleClickReset: false option
    const noDblSetup = setupController({ domain: [0, 100, 0, 50] });
    const noDbl = createViewportInteractionController({
      controller: noDblSetup.controller,
      doubleClickReset: false,
    });
    noDbl.zoomByFactor(0.5, 0.5);
    const zoomed = { ...noDblSetup.controller.domain };
    noDblSetup.container.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: 400, clientY: 180 }),
    );
    expect(noDblSetup.controller.domain).toEqual(zoomed);
    noDbl.dispose();
    noDblSetup.controller.dispose();
    controller.dispose();
  });

  it("Fatal 1: promotes remaining pinch pointer into slot 1 when pointer 1 lifts first, preventing 2-slot corruption", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 100] });
    const interactionRaf = createManualRafQueue();

    const captured = new Set<number>();
    const released: number[] = [];
    container.setPointerCapture = (id: number) => {
      captured.add(id);
    };
    container.releasePointerCapture = (id: number) => {
      captured.delete(id);
      released.push(id);
    };

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });

    // Touch down pointer 1 and pointer 2 -> enter pinching.
    dispatchPointer(container, "pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    dispatchPointer(container, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 400,
      clientY: 200,
    });
    expect(interaction.state).toBe("pinching");
    expect(captured.has(1)).toBe(true);
    expect(captured.has(2)).toBe(true);

    // Lift pointer 1 while pointer 2 stays down.
    dispatchPointer(container, "pointerup", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    expect(interaction.state).toBe("pinching");
    expect(controller.gestureActive).toBe(true);
    expect(captured.has(1)).toBe(false);
    expect(captured.has(2)).toBe(true);

    // A new finger (pointer 3) touches down -> must re-enter 2-pointer pinch, NOT panning/box-pending.
    dispatchPointer(container, "pointerdown", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    expect(interaction.state).toBe("pinching");
    expect(captured.has(2)).toBe(true);
    expect(captured.has(3)).toBe(true);

    // Spread pointer 2 and pointer 3 from dist 200 -> 400 -> halves domain span cleanly.
    dispatchPointer(container, "pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 500,
      clientY: 200,
    });
    dispatchPointer(container, "pointermove", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 100,
      clientY: 200,
    });
    interactionRaf.flushAll();
    expect(controller.domain.xMax - controller.domain.xMin).toBeCloseTo(50, 9);
    expect(controller.domain.yMax - controller.domain.yMin).toBeCloseTo(50, 9);

    // Lift pointer 3 then pointer 2: both captures must be released and state returns to idle.
    dispatchPointer(container, "pointerup", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 100,
      clientY: 200,
    });
    expect(interaction.state).toBe("pinching");
    expect(controller.gestureActive).toBe(true);
    dispatchPointer(container, "pointerup", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 500,
      clientY: 200,
    });
    expect(interaction.state).toBe("idle");
    expect(controller.gestureActive).toBe(false);
    expect(captured.size).toBe(0);
    expect(released).toEqual([1, 3, 2]);

    interaction.dispose();
    controller.dispose();
  });

  it("Fatal 2 & Warning 1: releases gestureActive and resets state to idle when callbacks or setDomain throw across all paths", () => {
    // (a) Throwing onGestureStateChange in #abortActiveGesture (pointercancel, Escape, cancelGesture, setEnabled(false))
    {
      const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
      let shouldThrowOnIdle = false;
      const interaction = createViewportInteractionController({
        controller,
        onGestureStateChange: (e) => {
          if (shouldThrowOnIdle && e.state === "idle") {
            throw new Error("abort state callback boom");
          }
        },
      });

      // pointercancel
      dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
      expect(controller.gestureActive).toBe(true);
      shouldThrowOnIdle = true;
      expect(() => dispatchPointer(container, "pointercancel", { clientX: 400, clientY: 180 })).toThrow(
        "abort state callback boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      // Escape during box-active
      shouldThrowOnIdle = false;
      dispatchPointer(container, "pointerdown", { clientX: 200, clientY: 100, shiftKey: true });
      dispatchPointer(container, "pointermove", { clientX: 300, clientY: 180, shiftKey: true });
      expect(interaction.state).toBe("box-active");
      shouldThrowOnIdle = true;
      expect(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      ).toThrow("abort state callback boom");
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      // cancelGesture() & setEnabled(false)
      shouldThrowOnIdle = false;
      dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
      shouldThrowOnIdle = true;
      expect(() => interaction.cancelGesture()).toThrow("abort state callback boom");
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      shouldThrowOnIdle = false;
      dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
      shouldThrowOnIdle = true;
      expect(() => interaction.setEnabled(false)).toThrow("abort state callback boom");
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      interaction.dispose();
      controller.dispose();
    }

    // (b) Throwing in #onPointerUp "pinching" (setDomain during flush, and onGestureStateChange on idle)
    {
      const { container, controller } = setupController({ domain: [0, 100, 0, 100] });
      const interactionRaf = createManualRafQueue();
      let throwOnIdle = false;
      const interaction = createViewportInteractionController({
        controller,
        requestAnimationFrame: interactionRaf.requestAnimationFrame,
        cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
        onGestureStateChange: (e) => {
          if (throwOnIdle && e.state === "idle") {
            throw new Error("pinch idle boom");
          }
        },
      });

      // Throw during pinch flush setDomain
      const origSetDomain = controller.setDomain.bind(controller);
      let throwSetDomain = false;
      controller.setDomain = (xMin, xMax, yMin, yMax) => {
        if (throwSetDomain) throw new Error("pinch setDomain boom");
        origSetDomain(xMin, xMax, yMin, yMax);
      };

      dispatchPointer(container, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
      dispatchPointer(container, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 200 });
      dispatchPointer(container, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 200 });
      throwSetDomain = true;
      expect(() =>
        dispatchPointer(container, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 200 }),
      ).toThrow("pinch setDomain boom");
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      // Throw during pinch idle state callback
      throwSetDomain = false;
      dispatchPointer(container, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
      dispatchPointer(container, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 200 });
      dispatchPointer(container, "pointerup", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
      throwOnIdle = true;
      expect(() =>
        dispatchPointer(container, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 200 }),
      ).toThrow("pinch idle boom");
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      interaction.dispose();
      controller.dispose();
    }

    // (c) Throwing onGestureStateChange on sub-threshold & invalid box-zoom pointerup
    {
      const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
      let throwOnCancelled = false;
      const interaction = createViewportInteractionController({
        controller,
        dragMode: "box-zoom",
        minBoxSizeCss: 4,
        onGestureStateChange: (e) => {
          if (throwOnCancelled && e.boxState === "cancelled") {
            throw new Error("box cancel boom");
          }
        },
      });

      // Sub-threshold click
      dispatchPointer(container, "pointerdown", { clientX: 200, clientY: 100 });
      dispatchPointer(container, "pointermove", { clientX: 201, clientY: 101 });
      throwOnCancelled = true;
      expect(() => dispatchPointer(container, "pointerup", { clientX: 201, clientY: 101 })).toThrow(
        "box cancel boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      // Active box collapsing to zero-width invalid box on pointerup
      throwOnCancelled = false;
      dispatchPointer(container, "pointerdown", { clientX: 200, clientY: 100 });
      dispatchPointer(container, "pointermove", { clientX: 300, clientY: 180 });
      expect(interaction.state).toBe("box-active");
      throwOnCancelled = true;
      expect(() => dispatchPointer(container, "pointerup", { clientX: 200, clientY: 180 })).toThrow(
        "box cancel boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      interaction.dispose();
      controller.dispose();
    }

    // (d) Throwing on first #onWheel tick (onGestureStateChange, setDomain, onDomainChange)
    {
      const timers = createManualTimerQueue();
      const interactionRaf = createManualRafQueue();
      const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
      let failPhase: "none" | "state" | "domain" | "onDomain" = "state";
      const origSetDomain = controller.setDomain.bind(controller);
      controller.setDomain = (xMin, xMax, yMin, yMax) => {
        if (failPhase === "domain") throw new Error("wheel setDomain boom");
        origSetDomain(xMin, xMax, yMin, yMax);
      };

      const interaction = createViewportInteractionController({
        controller,
        requestAnimationFrame: interactionRaf.requestAnimationFrame,
        cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        onGestureStateChange: (e) => {
          if (failPhase === "state" && e.state === "wheeling") {
            throw new Error("wheel state boom");
          }
        },
        onDomainChange: () => {
          if (failPhase === "onDomain") throw new Error("wheel onDomain boom");
        },
      });

      expect(() => dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -100 })).toThrow(
        "wheel state boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");
      expect(timers.pendingCount()).toBe(0);

      failPhase = "domain";
      expect(() => dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -100 })).toThrow(
        "wheel setDomain boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");
      expect(timers.pendingCount()).toBe(0);

      failPhase = "onDomain";
      expect(() => dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -100 })).toThrow(
        "wheel onDomain boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");
      expect(timers.pendingCount()).toBe(0);

      interaction.dispose();
      controller.dispose();
    }

    // (e) Warning 1: throwing controller.setDomain on pointerup box-zoom commit and pan flush resets #state to idle
    {
      const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
      const interactionRaf = createManualRafQueue();
      const origSetDomain = controller.setDomain.bind(controller);
      let throwSetDomain = false;
      controller.setDomain = (xMin, xMax, yMin, yMax) => {
        if (throwSetDomain) throw new Error("setDomain pointerup boom");
        origSetDomain(xMin, xMax, yMin, yMax);
      };

      const interaction = createViewportInteractionController({
        controller,
        requestAnimationFrame: interactionRaf.requestAnimationFrame,
        cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
      });

      // Box-zoom commit throws
      dispatchPointer(container, "pointerdown", { clientX: 150, clientY: 80, shiftKey: true });
      dispatchPointer(container, "pointermove", { clientX: 300, clientY: 180, shiftKey: true });
      expect(interaction.state).toBe("box-active");
      throwSetDomain = true;
      expect(() =>
        dispatchPointer(container, "pointerup", { clientX: 300, clientY: 180, shiftKey: true }),
      ).toThrow("setDomain pointerup boom");
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      // Pan flush throws
      throwSetDomain = false;
      dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
      dispatchPointer(container, "pointermove", { clientX: 460, clientY: 180 });
      expect(interaction.state).toBe("panning");
      throwSetDomain = true;
      expect(() => dispatchPointer(container, "pointerup", { clientX: 460, clientY: 180 })).toThrow(
        "setDomain pointerup boom",
      );
      expect(controller.gestureActive).toBe(false);
      expect(interaction.state).toBe("idle");

      interaction.dispose();
      controller.dispose();
    }
  });

  it("Fatal 3: guards re-entrant cancelGesture / setEnabled(false) / resetDomain from callbacks across box->pinch, wheel, pinch-up, and gesture rAF", () => {
    // (a) Box-zoom -> pinch transition where onGestureStateChange cancels or disables
    {
      const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
      let handle: ReturnType<typeof createViewportInteractionController> | null = null;
      handle = createViewportInteractionController({
        controller,
        dragMode: "box-zoom",
        onGestureStateChange: (e) => {
          if (e.state === "pinching" && e.boxState === "cancelled") {
            handle?.cancelGesture();
          }
        },
      });

      dispatchPointer(container, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 100 });
      dispatchPointer(container, "pointermove", { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 180 });
      expect(handle.state).toBe("box-active");

      dispatchPointer(container, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 180 });
      expect(handle.state).toBe("idle");
      expect(controller.gestureActive).toBe(false);

      handle.dispose();
      controller.dispose();
    }

    // (b) #onWheel where onGestureStateChange or onDomainChange calls cancelGesture / resetDomain
    {
      const timers = createManualTimerQueue();
      const interactionRaf = createManualRafQueue();
      const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
      const invalidations: ViewportInvalidationEvent[] = [];
      let action: "cancel-state" | "reset-domain" = "cancel-state";
      let handle: ReturnType<typeof createViewportInteractionController> | null = null;
      handle = createViewportInteractionController({
        controller,
        requestAnimationFrame: interactionRaf.requestAnimationFrame,
        cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        onGestureStateChange: (e) => {
          if (action === "cancel-state" && e.state === "wheeling") {
            handle?.cancelGesture();
          }
        },
        onDomainChange: (_d, reason) => {
          if (action === "reset-domain" && reason === "wheel") {
            handle?.resetDomain();
          }
        },
        onInvalidate: (e) => invalidations.push(e),
      });

      // Cancel inside onGestureStateChange: domain must NOT mutate, no rAF or settle timer armed.
      dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -100 });
      expect(controller.domain).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 50 });
      expect(handle.state).toBe("idle");
      expect(controller.gestureActive).toBe(false);
      expect(interactionRaf.pendingCount()).toBe(0);
      expect(timers.pendingCount()).toBe(0);

      // resetDomain inside onDomainChange: homeDomain stays restored, no gesture rAF or settle timer armed.
      action = "reset-domain";
      invalidations.length = 0;
      dispatchWheel(container, { clientX: 400, clientY: 180, deltaY: -100 });
      expect(controller.domain).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 50 });
      expect(handle.state).toBe("idle");
      expect(controller.gestureActive).toBe(false);
      expect(interactionRaf.pendingCount()).toBe(0);
      expect(timers.pendingCount()).toBe(0);
      expect(invalidations.map((e) => `${e.phase}:${e.reason}`)).toEqual(["settled:reset"]);

      handle.dispose();
      controller.dispose();
    }

    // (c) #onPointerUp("pinching") and #onGestureFrame where onDomainChange calls resetDomain / cancelGesture
    {
      const interactionRaf = createManualRafQueue();
      const { container, controller } = setupController({ domain: [0, 100, 0, 100] });
      const invalidations: ViewportInvalidationEvent[] = [];
      let resetOnPan = true;
      let cancelOnPinchEnd = false;
      let handle: ReturnType<typeof createViewportInteractionController> | null = null;
      handle = createViewportInteractionController({
        controller,
        requestAnimationFrame: interactionRaf.requestAnimationFrame,
        cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
        onDomainChange: (_d, reason) => {
          if (resetOnPan && reason === "pan") {
            handle?.resetDomain();
          }
          if (cancelOnPinchEnd && reason === "pinch-end") {
            handle?.cancelGesture();
          }
        },
        onInvalidate: (e) => invalidations.push(e),
      });

      // Pan rAF: onDomainChange calls resetDomain() -> must NOT emit phase:"gesture" after settled:reset.
      dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
      dispatchPointer(container, "pointermove", { clientX: 460, clientY: 180 });
      interactionRaf.flushAll();
      expect(invalidations.map((e) => `${e.phase}:${e.reason}`)).toEqual(["settled:reset"]);
      expect(handle.state).toBe("idle");
      expect(controller.gestureActive).toBe(false);

      // Pinch-end: onDomainChange calls cancelGesture() -> must NOT emit settled:pinch-end afterwards.
      resetOnPan = false;
      cancelOnPinchEnd = true;
      invalidations.length = 0;
      dispatchPointer(container, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
      dispatchPointer(container, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 200 });
      dispatchPointer(container, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 200 });
      dispatchPointer(container, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 200 });
      expect(invalidations).toEqual([]);
      expect(handle.state).toBe("idle");
      expect(controller.gestureActive).toBe(false);

      handle.dispose();
      controller.dispose();
    }
  });

  it("Warning 2: aborts active non-captured drag/box-zoom/pinch on window blur and removes blur listener on dispose", () => {
    const { container, controller } = setupController({ domain: [0, 100, 0, 50] });
    const interactionRaf = createManualRafQueue();

    // Simulate environment where setPointerCapture throws NotFoundError.
    container.setPointerCapture = () => {
      throw new DOMException("No active pointer", "NotFoundError");
    };
    container.releasePointerCapture = () => {
      throw new DOMException("No active pointer", "NotFoundError");
    };

    let blurAdds = 0;
    let blurRemoves = 0;
    const origWinAdd = window.addEventListener.bind(window);
    const origWinRemove = window.removeEventListener.bind(window);
    const addSpy = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, opts) => {
      if (type === "blur") blurAdds += 1;
      origWinAdd(type, listener, opts);
    });
    const removeSpy = vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, opts) => {
      if (type === "blur") blurRemoves += 1;
      origWinRemove(type, listener, opts);
    });

    const interaction = createViewportInteractionController({
      controller,
      requestAnimationFrame: interactionRaf.requestAnimationFrame,
      cancelAnimationFrame: interactionRaf.cancelAnimationFrame,
    });
    expect(blurAdds).toBe(1);

    // 1. Pan aborted by window blur
    dispatchPointer(container, "pointerdown", { clientX: 400, clientY: 180 });
    expect(interaction.state).toBe("panning");
    expect(controller.gestureActive).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(interaction.state).toBe("idle");
    expect(controller.gestureActive).toBe(false);

    // 2. Box-zoom aborted by window blur (overlay hidden)
    const overlay = container.querySelector<HTMLDivElement>('[data-trace-kit-overlay="box-zoom"]');
    dispatchPointer(container, "pointerdown", { clientX: 200, clientY: 100, shiftKey: true });
    dispatchPointer(container, "pointermove", { clientX: 320, clientY: 180, shiftKey: true });
    expect(interaction.state).toBe("box-active");
    expect(overlay?.style.display).toBe("block");
    window.dispatchEvent(new Event("blur"));
    expect(interaction.state).toBe("idle");
    expect(controller.gestureActive).toBe(false);
    expect(overlay?.style.display).toBe("none");

    // 3. Pinch aborted by window blur
    dispatchPointer(container, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
    dispatchPointer(container, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 200 });
    expect(interaction.state).toBe("pinching");
    window.dispatchEvent(new Event("blur"));
    expect(interaction.state).toBe("idle");
    expect(controller.gestureActive).toBe(false);

    interaction.dispose();
    expect(blurRemoves).toBe(blurAdds);
    addSpy.mockRestore();
    removeSpy.mockRestore();
    controller.dispose();
  });
});
