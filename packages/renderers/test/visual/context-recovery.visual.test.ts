import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type DecimationSelection,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSpectrumEngineController,
  type SpectrumEngineController,
  type WebGL2ContextLostEvent,
  type WebGL2ContextRestoredEvent,
} from "../../src/controller/index.js";

const WIDTH = 480;
const HEIGHT = 300;
const DPR = 1;
const EVENT_TIMEOUT_MS = 5_000;

function makeOpticalPayload(sampleCount: number, peakCenter = 0.5): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 1550,
    xUnit: "nm",
    yUnit: "dBm",
  });
  fillOpticalSignal(payload, sampleCount, peakCenter);
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

function fillOpticalSignal(
  payload: SpectrumDataPayload,
  sampleCount: number,
  peakCenter: number,
): void {
  const span = 10;
  const gapStart = Math.floor(sampleCount * 0.25);
  const gapEnd = Math.floor(sampleCount * 0.30);
  const isolatedIndex = Math.floor(sampleCount * 0.72);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount > 1 ? i / (sampleCount - 1) : 0;
    payload.x[i] = t * span;
    if (i >= gapStart && i <= gapEnd) {
      payload.y[i] = Number.NaN;
    } else if (i === isolatedIndex - 1 || i === isolatedIndex + 1) {
      payload.y[i] = Number.NaN;
    } else if (i === isolatedIndex) {
      payload.y[i] = -18;
    } else {
      const peak = 55 * Math.exp(-Math.pow((t - peakCenter) / 0.08, 2));
      const ripple = 8 * Math.sin(t * Math.PI * 14);
      payload.y[i] = -70 + peak + ripple;
    }
  }
}

function captureComposited(controller: SpectrumEngineController, renderFirst: boolean): ImageData {
  const canvases = controller.canvases;
  expect(canvases.length).toBeGreaterThan(0);
  const first = canvases[0]!;
  const scratch = document.createElement("canvas");
  scratch.width = first.width;
  scratch.height = first.height;
  const ctx = scratch.getContext("2d");
  if (ctx === null) throw new Error("Failed to acquire 2d context on scratch canvas");
  if (renderFirst) {
    controller.render();
  }
  for (let i = 0; i < canvases.length; i += 1) {
    ctx.drawImage(canvases[i]!, 0, 0);
  }
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
}

function capturePlotLayer(controller: SpectrumEngineController, renderFirst: boolean): ImageData {
  const plot = controller.canvases[1]!;
  const scratch = document.createElement("canvas");
  scratch.width = plot.width;
  scratch.height = plot.height;
  const ctx = scratch.getContext("2d");
  if (ctx === null) throw new Error("Failed to acquire 2d context on scratch canvas");
  if (renderFirst) {
    controller.render();
  }
  ctx.drawImage(plot, 0, 0);
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
}

function countMismatchedPixels(a: ImageData, b: ImageData): number {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  const da = a.data;
  const db = b.data;
  let mismatches = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (
      da[i] !== db[i] ||
      da[i + 1] !== db[i + 1] ||
      da[i + 2] !== db[i + 2] ||
      da[i + 3] !== db[i + 3]
    ) {
      mismatches += 1;
    }
  }
  return mismatches;
}

function countNonBackgroundPixelsInPlot(
  image: ImageData,
  plotLeft: number,
  plotTop: number,
  plotWidth: number,
  plotHeight: number,
): number {
  const data = image.data;
  const bgR = data[0] ?? 0;
  const bgG = data[1] ?? 0;
  const bgB = data[2] ?? 0;

  const x0 = Math.max(0, Math.floor(plotLeft));
  const y0 = Math.max(0, Math.floor(plotTop));
  const x1 = Math.min(image.width, Math.ceil(plotLeft + plotWidth));
  const y1 = Math.min(image.height, Math.ceil(plotTop + plotHeight));

  let nonBg = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = (y * image.width + x) * 4;
      const dr = Math.abs((data[idx] ?? 0) - bgR);
      const dg = Math.abs((data[idx + 1] ?? 0) - bgG);
      const db = Math.abs((data[idx + 2] ?? 0) - bgB);
      if (dr + dg + db > 24) {
        nonBg += 1;
      }
    }
  }
  return nonBg;
}

function countNonTransparentPixels(image: ImageData): number {
  const data = image.data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 0) count += 1;
  }
  return count;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), EVENT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

async function nextMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const activeContainers: HTMLElement[] = [];

function createMountedContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.style.width = `${WIDTH}px`;
  container.style.height = `${HEIGHT}px`;
  document.body.appendChild(container);
  activeContainers.push(container);
  return container;
}

beforeAll(async () => {
  await ensureDefaultFont();
});

afterEach(() => {
  while (activeContainers.length > 0) {
    activeContainers.pop()?.remove();
  }
});

describe("SpectrumEngineController real Chromium WEBGL_lose_context recovery", () => {
  it("recovers in place after a single WEBGL_lose_context cycle with 0 mismatched pixels", async () => {
    const container = createMountedContainer();
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];
    const lostDeferred = createDeferred<WebGL2ContextLostEvent>();
    const restoredDeferred = createDeferred<WebGL2ContextRestoredEvent>();
    let syncPostComposite: ImageData | null = null;
    let syncPostPlot: ImageData | null = null;
    let controller: SpectrumEngineController | null = null;

    controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
      onContextLost: (event) => {
        lostEvents.push(event);
        lostDeferred.resolve(event);
      },
      onContextRestored: (event) => {
        restoredEvents.push(event);
        if (controller !== null) {
          // Capture synchronously inside onContextRestored before any frame composite clears
          // the drawing buffer, proving synchronous post-restore paint occurred before callback.
          syncPostComposite = captureComposited(controller, false);
          syncPostPlot = capturePlotLayer(controller, false);
        }
        restoredDeferred.resolve(event);
      },
    });

    try {
      expect(controller.activeKind).toBe("webgl2");
      expect(controller.contextLost).toBe(false);

      const payload = makeOpticalPayload(4_096);
      controller.setData(payload);
      controller.setDomain(1550, 1560, -80, 0);

      const preLossComposite = captureComposited(controller, true);
      const preLossPlot = capturePlotLayer(controller, true);
      const t = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(preLossComposite, t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight),
      ).toBeGreaterThan(200);
      expect(countNonTransparentPixels(preLossPlot)).toBeGreaterThan(100);

      const prePlotCanvas = controller.canvases[1]!;
      const gl = prePlotCanvas.getContext("webgl2");
      expect(gl).not.toBeNull();
      const ext = gl!.getExtension("WEBGL_lose_context");
      expect(ext).not.toBeNull();

      let observedDefaultPrevented = false;
      prePlotCanvas.addEventListener("webglcontextlost", (ev) => {
        observedDefaultPrevented = ev.defaultPrevented;
      });

      expect(gl!.isContextLost()).toBe(false);
      ext!.loseContext();
      await withTimeout(lostDeferred.promise, "onContextLost");
      // Yield one macrotask so Blink finishes webglcontextlost dispatch (running subsequent
      // listeners and reading defaultPrevented to mark the context restorable) before restoreContext().
      await nextMacrotask();

      expect(observedDefaultPrevented).toBe(true);
      expect(controller.contextLost).toBe(true);
      expect(gl!.isContextLost()).toBe(true);
      expect(lostEvents).toHaveLength(1);

      // Suspended operations while lost must not throw and must keep contextLost === true
      expect(() => {
        controller.render();
        controller.requestRender();
        controller.clear();
      }).not.toThrow();
      expect(controller.contextLost).toBe(true);

      // Restore context
      ext!.restoreContext();
      const restoredEvent = await withTimeout(restoredDeferred.promise, "onContextRestored");

      expect(controller.contextLost).toBe(false);
      expect(gl!.isContextLost()).toBe(false);
      expect(controller.canvases[1]).toBe(prePlotCanvas);
      expect(restoredEvent.restoreCount).toBe(1);
      expect(restoredEvents).toHaveLength(1);
      expect(syncPostComposite).not.toBeNull();
      expect(syncPostPlot).not.toBeNull();
      expect(countMismatchedPixels(syncPostComposite!, preLossComposite)).toBe(0);
      expect(countMismatchedPixels(syncPostPlot!, preLossPlot)).toBe(0);

      // Explicit post-restore render also matches preLoss with 0 mismatched pixels
      const postComposite = captureComposited(controller, true);
      const postPlot = capturePlotLayer(controller, true);
      expect(countMismatchedPixels(postComposite, preLossComposite)).toBe(0);
      expect(countMismatchedPixels(postPlot, preLossPlot)).toBe(0);
    } finally {
      controller.dispose();
    }
  });

  it("preserves pixel identity and increments restoreCount across repeated lose -> restore cycles", async () => {
    const container = createMountedContainer();
    let lostDeferred = createDeferred<WebGL2ContextLostEvent>();
    let restoredDeferred = createDeferred<WebGL2ContextRestoredEvent>();
    const restoreCounts: number[] = [];

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
      onContextLost: (event) => lostDeferred.resolve(event),
      onContextRestored: (event) => {
        restoreCounts.push(event.restoreCount);
        restoredDeferred.resolve(event);
      },
    });

    try {
      controller.setData(makeOpticalPayload(4_096));
      controller.setDomain(1550, 1560, -80, 0);
      const preLossComposite = captureComposited(controller, true);
      const preLossPlot = capturePlotLayer(controller, true);

      const prePlotCanvas = controller.canvases[1]!;
      const gl = prePlotCanvas.getContext("webgl2")!;
      const ext = gl.getExtension("WEBGL_lose_context")!;

      for (let cycle = 1; cycle <= 2; cycle += 1) {
        lostDeferred = createDeferred<WebGL2ContextLostEvent>();
        restoredDeferred = createDeferred<WebGL2ContextRestoredEvent>();

        ext.loseContext();
        await withTimeout(lostDeferred.promise, `cycle ${cycle} onContextLost`);
        await nextMacrotask();
        expect(controller.contextLost).toBe(true);

        ext.restoreContext();
        await withTimeout(restoredDeferred.promise, `cycle ${cycle} onContextRestored`);
        await nextMacrotask();
        expect(controller.contextLost).toBe(false);
        expect(controller.canvases[1]).toBe(prePlotCanvas);
      }

      expect(restoreCounts).toEqual([1, 2]);
      expect(countMismatchedPixels(captureComposited(controller, true), preLossComposite)).toBe(0);
      expect(countMismatchedPixels(capturePlotLayer(controller, true), preLossPlot)).toBe(0);
    } finally {
      controller.dispose();
    }
  });

  it("preserves exact pixel identity across context recovery for explicit lttb and min-max decimation", async () => {
    const selections: readonly DecimationSelection[] = [
      { algorithm: "lttb", threshold: 256 },
      { algorithm: "min-max", bucketCount: 128 },
    ];

    for (const decimation of selections) {
      const container = createMountedContainer();
      const lostDeferred = createDeferred<WebGL2ContextLostEvent>();
      const restoredDeferred = createDeferred<WebGL2ContextRestoredEvent>();

      const controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        decimation,
        autoResize: false,
        initialWidth: WIDTH,
        initialHeight: HEIGHT,
        initialDpr: DPR,
        onContextLost: (event) => lostDeferred.resolve(event),
        onContextRestored: (event) => restoredDeferred.resolve(event),
      });

      try {
        controller.setData(makeOpticalPayload(12_000));
        controller.setDomain(1550, 1560, -80, 0);

        const preLossComposite = captureComposited(controller, true);
        const preLossPlot = capturePlotLayer(controller, true);

        const plotCanvas = controller.canvases[1]!;
        const ext = plotCanvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;

        ext.loseContext();
        await withTimeout(lostDeferred.promise, `${decimation.algorithm} onContextLost`);
        await nextMacrotask();

        ext.restoreContext();
        await withTimeout(restoredDeferred.promise, `${decimation.algorithm} onContextRestored`);

        expect(controller.canvases[1]).toBe(plotCanvas);
        expect(countMismatchedPixels(captureComposited(controller, true), preLossComposite)).toBe(0);
        expect(countMismatchedPixels(capturePlotLayer(controller, true), preLossPlot)).toBe(0);
      } finally {
        controller.dispose();
      }
    }
  });

  it("renders domain and payload mutations applied while lost identically to a fresh reference controller", async () => {
    const container = createMountedContainer();
    const refContainer = createMountedContainer();
    const lostDeferred = createDeferred<WebGL2ContextLostEvent>();
    const restoredDeferred = createDeferred<WebGL2ContextRestoredEvent>();

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
      onContextLost: (event) => lostDeferred.resolve(event),
      onContextRestored: (event) => restoredDeferred.resolve(event),
    });
    const reference = createSpectrumEngineController({
      container: refContainer,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
    });

    try {
      const payload = makeOpticalPayload(4_096, 0.5);
      controller.setData(payload);
      controller.setDomain(1550, 1560, -80, 0);
      controller.render();

      const plotCanvas = controller.canvases[1]!;
      const ext = plotCanvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;

      ext.loseContext();
      await withTimeout(lostDeferred.promise, "onContextLost");
      await nextMacrotask();
      expect(controller.contextLost).toBe(true);

      // Mutate payload revision and domain while lost
      fillOpticalSignal(payload, 4_096, 0.35);
      commitPayloadRevision(payload, 4_096);
      controller.setDomain(1551, 1558, -75, -5);

      ext.restoreContext();
      await withTimeout(restoredDeferred.promise, "onContextRestored");

      const postRestoreComposite = captureComposited(controller, true);

      // Render fresh reference controller with identical mutated payload & domain
      reference.setData(payload);
      reference.setDomain(1551, 1558, -75, -5);
      const refComposite = captureComposited(reference, true);

      expect(countMismatchedPixels(postRestoreComposite, refComposite)).toBe(0);
    } finally {
      controller.dispose();
      reference.dispose();
    }
  });

  it("exits suspended lost state cleanly via setMode('canvas2d') and paints live Canvas2D trace pixels", async () => {
    const container = createMountedContainer();
    const lostDeferred = createDeferred<WebGL2ContextLostEvent>();

    const controller = createSpectrumEngineController({
      container,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
      onContextLost: (event) => lostDeferred.resolve(event),
    });

    try {
      controller.setData(makeOpticalPayload(4_096));
      controller.setDomain(1550, 1560, -80, 0);
      controller.render();

      const ext = controller.canvases[1]!.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
      ext.loseContext();
      await withTimeout(lostDeferred.promise, "onContextLost");
      expect(controller.contextLost).toBe(true);

      controller.setMode("canvas2d");

      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.contextLost).toBe(false);
      expect(controller.canvases).toHaveLength(1);

      const image = captureComposited(controller, false);
      const t = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(image, t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight),
      ).toBeGreaterThan(200);
    } finally {
      controller.dispose();
    }
  });

  it("disposes cleanly while healthy and while context-lost with zero spurious onContextLost callbacks", async () => {
    // Controller A: healthy disposal
    const containerA = createMountedContainer();
    const lostA: WebGL2ContextLostEvent[] = [];
    const controllerA = createSpectrumEngineController({
      container: containerA,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
      onContextLost: (e) => lostA.push(e),
    });
    controllerA.setData(makeOpticalPayload(1_024));
    controllerA.setDomain(1550, 1560, -80, 0);
    controllerA.render();

    // Controller B: lost before disposal
    const containerB = createMountedContainer();
    const lostB: WebGL2ContextLostEvent[] = [];
    const lostDeferredB = createDeferred<WebGL2ContextLostEvent>();
    const controllerB = createSpectrumEngineController({
      container: containerB,
      mode: "webgl2",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
      onContextLost: (e) => {
        lostB.push(e);
        lostDeferredB.resolve(e);
      },
    });
    controllerB.setData(makeOpticalPayload(1_024));
    controllerB.setDomain(1550, 1560, -80, 0);
    controllerB.render();

    const extB = controllerB.canvases[1]!.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
    extB.loseContext();
    await withTimeout(lostDeferredB.promise, "controllerB onContextLost");
    expect(controllerB.contextLost).toBe(true);

    expect(() => {
      controllerA.dispose();
      controllerB.dispose();
    }).not.toThrow();

    await nextAnimationFrame();
    await nextAnimationFrame();

    expect(lostA).toHaveLength(0);
    expect(lostB).toHaveLength(1);
    expect(controllerA.disposed).toBe(true);
    expect(controllerA.contextLost).toBe(false);
    expect(controllerB.disposed).toBe(true);
    expect(controllerB.contextLost).toBe(false);
  });
});
