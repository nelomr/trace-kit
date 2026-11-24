import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LOG,
  commitPayloadRevision,
  createSpectrumDataPayload,
  type SpectrumDataPayload,
  type YAxisRegistration,
} from "@trace-kit/core";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSpectrumEngineController,
  createViewportInteractionController,
  type SpectrumEngineController,
  type ViewportInvalidationEvent,
} from "../../src/controller/index.js";

const WIDTH = 480;
const HEIGHT = 300;
const DPR = 1;

function makeLinearSpectrumPayload(sampleCount: number): SpectrumDataPayload {
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
    const ripple = 8 * Math.sin(t * Math.PI * 14);
    payload.y[i] = -70 + peak + ripple;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

function makeLogPowerPayload(sampleCount: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 1550,
    xUnit: "nm",
    yUnit: "mW",
  });
  const span = 10;
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount > 1 ? i / (sampleCount - 1) : 0;
    payload.x[i] = t * span;
    const exponent = -2 + 4 * Math.exp(-Math.pow((t - 0.5) / 0.14, 2)) + 0.4 * Math.sin(t * Math.PI * 10);
    payload.y[i] = 10 ** exponent;
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
  controller.render();
  for (let i = 0; i < canvases.length; i += 1) {
    ctx.drawImage(canvases[i]!, 0, 0);
  }
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

function countDifferingPixels(a: ImageData, b: ImageData): number {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  const ad = a.data;
  const bd = b.data;
  let diffs = 0;
  for (let i = 0; i < ad.length; i += 4) {
    const dr = Math.abs((ad[i] ?? 0) - (bd[i] ?? 0));
    const dg = Math.abs((ad[i + 1] ?? 0) - (bd[i + 1] ?? 0));
    const db = Math.abs((ad[i + 2] ?? 0) - (bd[i + 2] ?? 0));
    if (dr + dg + db > 24) {
      diffs += 1;
    }
  }
  return diffs;
}

function waitAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

function assertOverlayAboveCanvases(container: HTMLElement): HTMLDivElement {
  const overlays = container.querySelectorAll<HTMLDivElement>('[data-trace-kit-overlay="box-zoom"]');
  expect(overlays.length).toBe(1);
  const overlay = overlays[0]!;
  const children = Array.from(container.children);
  const overlayIdx = children.indexOf(overlay);
  const canvases = Array.from(container.querySelectorAll("canvas"));
  expect(canvases.length).toBeGreaterThan(0);
  for (const canvas of canvases) {
    expect(overlayIdx).toBeGreaterThan(children.indexOf(canvas));
  }
  return overlay;
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

describe("ViewportInteractionController real Chromium integration", () => {
  it("drives drag-pan, wheel zoom, Shift+Drag box-zoom overlay, hysteresis deferral, and canvas2d <-> webgl2 <-> canvas2d survival", async () => {
    const container = createMountedContainer();
    const controller = createSpectrumEngineController({
      container,
      mode: "auto",
      autoResize: false,
      initialWidth: WIDTH,
      initialHeight: HEIGHT,
      initialDpr: DPR,
    });

    const invalidations: ViewportInvalidationEvent[] = [];
    const interaction = createViewportInteractionController({
      controller,
      settleDebounceMs: 40,
      onInvalidate: (e) => invalidations.push(e),
    });

    try {
      // 1. Initial Canvas2D (1 canvas) at 10,000 samples
      controller.setData(makeLinearSpectrumPayload(10_000));
      controller.setDomain(1550, 1560, -80, 0);
      interaction.setHomeDomain(1550, 1560, -80, 0);
      const initialFrame = readComposited(controller);
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.canvases.length).toBe(1);

      const t0 = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(initialFrame, t0.plotLeft, t0.plotTop, t0.plotWidth, t0.plotHeight),
      ).toBeGreaterThan(200);

      const rect = container.getBoundingClientRect();
      const plotCenterX = rect.left + t0.plotLeft + t0.plotWidth * 0.5;
      const plotCenterY = rect.top + t0.plotTop + t0.plotHeight * 0.5;

      // 2. Real pointer drag-pan mutates domain and visibly shifts painted canvas pixels
      container.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX,
          clientY: plotCenterY,
        }),
      );
      expect(controller.gestureActive).toBe(true);
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX + 80,
          clientY: plotCenterY,
        }),
      );
      await waitAnimationFrame();
      container.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX + 80,
          clientY: plotCenterY,
        }),
      );
      expect(controller.gestureActive).toBe(false);
      expect(controller.domain.xMin).toBeLessThan(1550);
      const pannedFrame = readComposited(controller);
      expect(countDifferingPixels(initialFrame, pannedFrame)).toBeGreaterThan(100);

      // 3. Real wheel zoom mutates domain, updates painted canvas, and settles after debounce
      const spanBeforeWheel = controller.domain.xMax - controller.domain.xMin;
      container.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: plotCenterX,
          clientY: plotCenterY,
          deltaY: -200,
          deltaMode: 0,
        }),
      );
      expect(controller.domain.xMax - controller.domain.xMin).toBeLessThan(spanBeforeWheel);
      await waitAnimationFrame();
      await waitMs(70);
      expect(controller.gestureActive).toBe(false);
      const zoomedFrame = readComposited(controller);
      expect(countDifferingPixels(pannedFrame, zoomedFrame)).toBeGreaterThan(100);

      // 4. Shift + Drag box-zoom on 1-canvas Canvas2D verifies overlay transform: translate3d and z-order
      interaction.resetDomain();
      controller.render();
      const boxStartX = rect.left + t0.plotLeft + t0.plotWidth * 0.25;
      const boxStartY = rect.top + t0.plotTop + t0.plotHeight * 0.25;
      const boxEndX = rect.left + t0.plotLeft + t0.plotWidth * 0.75;
      const boxEndY = rect.top + t0.plotTop + t0.plotHeight * 0.75;

      container.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          pointerType: "mouse",
          button: 0,
          shiftKey: true,
          clientX: boxStartX,
          clientY: boxStartY,
        }),
      );
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          pointerType: "mouse",
          button: 0,
          shiftKey: true,
          clientX: boxEndX,
          clientY: boxEndY,
        }),
      );
      const overlayC2D = assertOverlayAboveCanvases(container);
      expect(overlayC2D.style.display).toBe("block");
      expect(overlayC2D.style.transform).toContain("translate3d(");

      container.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          pointerType: "mouse",
          button: 0,
          shiftKey: true,
          clientX: boxEndX,
          clientY: boxEndY,
        }),
      );
      expect(overlayC2D.style.display).toBe("none");
      expect(controller.domain.xMin).toBeCloseTo(1552.5, 1);
      expect(controller.domain.xMax).toBeCloseTo(1557.5, 1);

      // 5. Mid-gesture hysteresis deferral (10k -> 90k while dragging stays canvas2d; swaps to webgl2 on release)
      interaction.resetDomain();
      container.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 3,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX,
          clientY: plotCenterY,
        }),
      );
      expect(controller.gestureActive).toBe(true);
      controller.setData(makeLinearSpectrumPayload(90_000));
      controller.render();
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.pendingKind).toBe("webgl2");

      container.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 3,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX + 20,
          clientY: plotCenterY,
        }),
      );
      expect(controller.gestureActive).toBe(false);
      expect(controller.activeKind).toBe("webgl2");
      expect(controller.canvases.length).toBe(3);

      // 6. Overlay stays above 3-canvas WebGL2 stack during Shift+Drag, and wheel + drag survive without re-attaching
      const overlayGL = assertOverlayAboveCanvases(container);
      container.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 4,
          pointerType: "mouse",
          button: 0,
          shiftKey: true,
          clientX: boxStartX,
          clientY: boxStartY,
        }),
      );
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 4,
          pointerType: "mouse",
          button: 0,
          shiftKey: true,
          clientX: boxEndX,
          clientY: boxEndY,
        }),
      );
      expect(overlayGL.style.display).toBe("block");
      expect(overlayGL.style.transform).toContain("translate3d(");
      container.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 4,
          pointerType: "mouse",
          button: 0,
          shiftKey: true,
          clientX: boxEndX,
          clientY: boxEndY,
        }),
      );
      expect(overlayGL.style.display).toBe("none");

      const glSpanBeforeWheel = controller.domain.xMax - controller.domain.xMin;
      container.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: plotCenterX,
          clientY: plotCenterY,
          deltaY: -150,
          deltaMode: 0,
        }),
      );
      expect(controller.domain.xMax - controller.domain.xMin).toBeLessThan(glSpanBeforeWheel);
      await waitMs(70);
      expect(controller.gestureActive).toBe(false);

      const glFrame = readComposited(controller);
      const tGl = controller.transform;
      expect(
        countNonBackgroundPixelsInPlot(glFrame, tGl.plotLeft, tGl.plotTop, tGl.plotWidth, tGl.plotHeight),
      ).toBeGreaterThan(200);

      // 7. Cross downThreshold back to Canvas2D (60,000 samples <= 64k) and verify drag still works
      controller.setData(makeLinearSpectrumPayload(60_000));
      controller.render();
      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.canvases.length).toBe(1);
      assertOverlayAboveCanvases(container);

      const xMinBackOnC2D = controller.domain.xMin;
      container.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 5,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX,
          clientY: plotCenterY,
        }),
      );
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 5,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX - 60,
          clientY: plotCenterY,
        }),
      );
      await waitAnimationFrame();
      container.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 5,
          pointerType: "mouse",
          button: 0,
          clientX: plotCenterX - 60,
          clientY: plotCenterY,
        }),
      );
      expect(controller.domain.xMin).toBeGreaterThan(xMinBackOnC2D);
      expect(invalidations.some((e) => e.phase === "settled")).toBe(true);
    } finally {
      interaction.dispose();
      controller.dispose();
    }

    expect(container.querySelectorAll("canvas").length).toBe(0);
    expect(container.querySelectorAll('[data-trace-kit-overlay="box-zoom"]').length).toBe(0);
  });

  it("interactively zooms and pans a single-axis Y_SCALE_KIND_LOG figure on both Canvas2D and WebGL2 with non-blank renders", async () => {
    const logAxes: readonly YAxisRegistration[] = [
      {
        id: "power",
        scaleKind: Y_SCALE_KIND_LOG,
        domainMin: 1e-3,
        domainMax: 1e3,
        side: AXIS_SIDE_LEFT,
      },
    ];

    for (const mode of ["canvas2d", "webgl2"] as const) {
      const container = createMountedContainer();
      const controller = createSpectrumEngineController({
        container,
        mode,
        yAxes: logAxes,
        autoResize: false,
        initialWidth: WIDTH,
        initialHeight: HEIGHT,
        initialDpr: DPR,
      });
      const interaction = createViewportInteractionController({
        controller,
        settleDebounceMs: 30,
      });

      try {
        controller.setData(makeLogPowerPayload(mode === "webgl2" ? 20_000 : 4_000));
        controller.setDomain(1550, 1560, 1e-3, 1e3);
        const beforeFrame = readComposited(controller);
        const t0 = controller.transform;
        expect(controller.activeKind).toBe(mode);
        expect(t0.yScaleKind).toBe(Y_SCALE_KIND_LOG);
        expect(t0.yLogDomainMin).toBeCloseTo(-3, 9);
        expect(
          countNonBackgroundPixelsInPlot(beforeFrame, t0.plotLeft, t0.plotTop, t0.plotWidth, t0.plotHeight),
        ).toBeGreaterThan(150);

        const rect = container.getBoundingClientRect();
        const cx = rect.left + t0.plotLeft + t0.plotWidth * 0.5;
        const cy = rect.top + t0.plotTop + t0.plotHeight * 0.5;

        // Wheel zoom Y-only (shiftKey: true)
        container.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            deltaY: -250,
            deltaMode: 0,
            shiftKey: true,
          }),
        );
        await waitMs(60);

        const tZoom = controller.transform;
        expect(tZoom.yScaleKind).toBe(Y_SCALE_KIND_LOG);
        expect(tZoom.yDomainMin).toBeGreaterThan(1e-3);
        expect(tZoom.yDomainMax).toBeLessThan(1e3);
        expect(tZoom.yLogDomainMin).toBeGreaterThan(-3);

        // Drag pan Y upward (dragging down increases log domain)
        const yMinBeforePan = controller.domain.yMin;
        container.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: 10,
            pointerType: "mouse",
            button: 0,
            clientX: cx,
            clientY: cy,
          }),
        );
        container.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            pointerId: 10,
            pointerType: "mouse",
            button: 0,
            clientX: cx,
            clientY: cy + 50,
          }),
        );
        await waitAnimationFrame();
        container.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            pointerId: 10,
            pointerType: "mouse",
            button: 0,
            clientX: cx,
            clientY: cy + 50,
          }),
        );

        const tPan = controller.transform;
        expect(tPan.yDomainMin).toBeGreaterThan(yMinBeforePan);
        expect(tPan.yDomainMin).toBeGreaterThan(0);
        expect(tPan.yLogDomainMin).toBeCloseTo(Math.log10(tPan.yDomainMin), 9);

        const afterFrame = readComposited(controller);
        expect(
          countNonBackgroundPixelsInPlot(afterFrame, tPan.plotLeft, tPan.plotTop, tPan.plotWidth, tPan.plotHeight),
        ).toBeGreaterThan(100);
        expect(countDifferingPixels(beforeFrame, afterFrame)).toBeGreaterThan(100);
      } finally {
        interaction.dispose();
        controller.dispose();
      }

      expect(container.querySelectorAll("canvas").length).toBe(0);
      expect(container.querySelectorAll('[data-trace-kit-overlay="box-zoom"]').length).toBe(0);
    }
  });
});
