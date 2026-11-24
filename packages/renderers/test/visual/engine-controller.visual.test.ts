import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSpectrumEngineController,
  type EngineChangeEvent,
  type SpectrumEngineController,
  type WebGL2FallbackEvent,
} from "../../src/controller/index.js";

const WIDTH = 480;
const HEIGHT = 300;
const DPR = 1;

function makeSpectrumPayload(sampleCount: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 1550,
    xUnit: "nm",
    yUnit: "dBm",
  });
  const span = 10;
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount > 1 ? i / (sampleCount - 1) : 0;
    payload.x[i] = t * span;
    const peak = 55 * Math.exp(-Math.pow((t - 0.5) / 0.08, 2));
    const ripple = 8 * Math.sin(t * Math.PI * 12);
    payload.y[i] = -70 + peak + ripple;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

function readComposited(controller: SpectrumEngineController): ImageData {
  const canvases = controller.canvases;
  expect(canvases.length).toBeGreaterThan(0);
  const first = canvases[0]!;
  const scratch = document.createElement("canvas");
  scratch.width = first.width;
  scratch.height = first.height;
  const ctx = scratch.getContext("2d");
  if (ctx === null) throw new Error("Failed to acquire 2d context on scratch canvas");
  // Render and composite in the same synchronous task so WebGL2's drawing buffer is intact.
  controller.render();
  for (let i = 0; i < canvases.length; i += 1) {
    ctx.drawImage(canvases[i]!, 0, 0);
  }
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
}

function readPlotLayer(controller: SpectrumEngineController): ImageData {
  const plot = controller.canvases[1]!;
  const scratch = document.createElement("canvas");
  scratch.width = plot.width;
  scratch.height = plot.height;
  const ctx = scratch.getContext("2d");
  if (ctx === null) throw new Error("Failed to acquire 2d context on scratch canvas");
  controller.render();
  ctx.drawImage(plot, 0, 0);
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
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

describe("SpectrumEngineController real Chromium integration", () => {
  it("swaps 1-canvas Canvas2D <-> 3-canvas WebGL2 with non-blank painted frames, deadband retention, and sibling z-order preservation", () => {
    const container = createMountedContainer();
    const overlayDiv = document.createElement("div");
    overlayDiv.setAttribute("data-role", "overlay");
    container.appendChild(overlayDiv);

    const controller = createSpectrumEngineController({
      container,
      mode: "auto",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
    });

    try {
      // 1. Initial Canvas2D at 10,000 samples
      controller.setData(makeSpectrumPayload(10_000));
      controller.setDomain(1550, 1560, -80, 0);
      const c2dImage = readComposited(controller);

      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.canvases.length).toBe(1);
      expect(container.querySelectorAll("canvas").length).toBe(1);
      const initialCanvas2D = controller.canvases[0]!;
      expect(Array.from(container.children)).toEqual([initialCanvas2D, overlayDiv]);

      const t1 = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(c2dImage, t1.plotLeft, t1.plotTop, t1.plotWidth, t1.plotHeight),
      ).toBeGreaterThan(200);

      // 2. Cross upThreshold to 80,000 samples -> WebGL2 (3 stacked canvases)
      controller.setData(makeSpectrumPayload(80_000));
      const glComposite = readComposited(controller);
      const glPlotOnly = readPlotLayer(controller);

      expect(controller.activeKind).toBe("webgl2");
      expect(controller.canvases.length).toBe(3);
      expect(controller.canvases.map((c) => c.getAttribute("data-trace-kit-layer"))).toEqual([
        "underlay",
        "plot",
        "overlay",
      ]);
      expect(controller.domain).toEqual({ xMin: 1550, xMax: 1560, yMin: -80, yMax: 0 });
      for (const c of controller.canvases) {
        expect(c.width).toBe(WIDTH * DPR);
        expect(c.height).toBe(HEIGHT * DPR);
      }
      expect(Array.from(container.children)).toEqual([
        controller.canvases[0],
        controller.canvases[1],
        controller.canvases[2],
        overlayDiv,
      ]);

      const t2 = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(glComposite, t2.plotLeft, t2.plotTop, t2.plotWidth, t2.plotHeight),
      ).toBeGreaterThan(200);
      expect(countNonTransparentPixels(glPlotOnly)).toBeGreaterThan(100);

      // 3. Traverse into deadband (72,000 samples) -> remains WebGL2 with same 3 canvases
      const glCanvasesBeforeDeadband = [...controller.canvases];
      controller.setData(makeSpectrumPayload(72_000));
      controller.render();
      expect(controller.activeKind).toBe("webgl2");
      expect(controller.canvases.length).toBe(3);
      expect([...controller.canvases]).toEqual(glCanvasesBeforeDeadband);

      // 4. Descend to downThreshold (64,000 samples) -> fresh Canvas2D canvas, painted non-blank, overlay still last
      controller.setData(makeSpectrumPayload(64_000));
      const c2dReturnImage = readComposited(controller);

      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.canvases.length).toBe(1);
      expect(controller.canvases[0]).not.toBe(initialCanvas2D);
      expect(Array.from(container.children)).toEqual([controller.canvases[0], overlayDiv]);

      const t3 = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(
          c2dReturnImage,
          t3.plotLeft,
          t3.plotTop,
          t3.plotWidth,
          t3.plotHeight,
        ),
      ).toBeGreaterThan(200);
    } finally {
      controller.dispose();
    }

    expect(controller.disposed).toBe(true);
    expect(container.querySelectorAll("canvas").length).toBe(0);
    expect(Array.from(container.children)).toEqual([overlayDiv]);
  });

  it("falls back cleanly to a live painted Canvas2D frame when getContext('webgl2') returns null in Chromium", () => {
    const container = createMountedContainer();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored via prototype assignment in finally
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const fallbacks: WebGL2FallbackEvent[] = [];
    const changes: EngineChangeEvent[] = [];

    const patchedGetContext = function patchedGetContext(
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      if (contextId === "webgl2") return null;
      return originalGetContext.call(
        this,
        contextId as "2d",
        options as CanvasRenderingContext2DSettings,
      );
    };
    // eslint-disable-next-line no-restricted-syntax -- narrow overload wrapper to simulate null webgl2 context
    HTMLCanvasElement.prototype.getContext = patchedGetContext as unknown as HTMLCanvasElement["getContext"];

    let controller: SpectrumEngineController | null = null;
    try {
      controller = createSpectrumEngineController({
        container,
        mode: "webgl2",
        autoResize: false,
        initialWidth: WIDTH,
        initialHeight: HEIGHT,
        initialDpr: DPR,
        onWebGL2Fallback: (e) => fallbacks.push(e),
        onEngineChange: (e) => changes.push(e),
      });

      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.webgl2Fallback).toBe(true);
      expect(controller.canvases.length).toBe(1);
      expect(fallbacks.length).toBe(1);
      expect(changes).toEqual([
        {
          previousKind: null,
          activeKind: "canvas2d",
          sampleCount: 0,
          mode: "webgl2",
          reason: "webgl2-fallback",
        },
      ]);

      controller.setData(makeSpectrumPayload(20_000));
      controller.setDomain(1550, 1560, -80, 0);
      const image = readComposited(controller);
      const t = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(image, t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight),
      ).toBeGreaterThan(200);
    } finally {
      controller?.dispose();
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }

    expect(controller?.disposed).toBe(true);
    expect(container.querySelectorAll("canvas").length).toBe(0);
  });
});
