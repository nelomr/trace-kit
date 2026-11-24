/** @vitest-environment happy-dom */
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  createViewportTransform,
  type SpectrumDataPayload,
  type ViewportTransform,
} from "@trace-kit/core";
import { afterEach, describe, expect, it } from "vitest";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import {
  createSpectrumEngineController,
  type ResizeObserverCallbackLike,
  type ResizeObserverLike,
} from "../../src/controller/index.js";

interface ResizableSurface {
  width: number;
  height: number;
}

class DomStubRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  readonly #surfaces: readonly ResizableSurface[];
  #disposed = false;
  #width = 800;
  #height = 400;
  #dpr = 1;
  #xMin = 0;
  #xMax = 1;
  #yMin = -1;
  #yMax = 1;
  #transform: ViewportTransform;
  renderCount = 0;
  disposeCount = 0;

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

  setData(): void {}
  setTraces(): void {}

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
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
    if (this.#disposed) return;
    this.#disposed = true;
    this.disposeCount += 1;
  }
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

function createManualRaf() {
  let nextId = 1;
  let scheduled = 0;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      scheduled += 1;
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number): void => {
      queue.delete(id);
    },
    flush: (): void => {
      const entries = Array.from(queue.entries());
      queue.clear();
      for (const [, cb] of entries) cb(16);
    },
    scheduleCount: () => scheduled,
    pendingCount: () => queue.size,
  };
}

function createContainer(position = ""): HTMLDivElement {
  const div = document.createElement("div");
  if (position !== "") div.style.position = position;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SpectrumEngineController DOM mounting, z-order, ResizeObserver & rAF (happy-dom)", () => {
  it("promotes empty or static container position to relative while preserving absolute and fixed", () => {
    const cEmpty = createContainer("");
    const cStatic = createContainer("static");
    const cAbsolute = createContainer("absolute");
    const cFixed = createContainer("fixed");

    const factories = {
      autoResize: false,
      createCanvas2DRenderer: (opts: { readonly surface: ResizableSurface }) =>
        new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: () => {
        throw new Error("unused");
      },
    };

    const ctrl1 = createSpectrumEngineController({ container: cEmpty, ...factories });
    const ctrl2 = createSpectrumEngineController({ container: cStatic, ...factories });
    const ctrl3 = createSpectrumEngineController({ container: cAbsolute, ...factories });
    const ctrl4 = createSpectrumEngineController({ container: cFixed, ...factories });

    expect(cEmpty.style.position).toBe("relative");
    expect(cStatic.style.position).toBe("relative");
    expect(cAbsolute.style.position).toBe("absolute");
    expect(cFixed.style.position).toBe("fixed");

    ctrl1.dispose();
    ctrl2.dispose();
    ctrl3.dispose();
    ctrl4.dispose();
  });

  it("mounts 1 canvas2d canvas and swaps to 3 stacked webgl2 canvases with happy-dom safe styles and attributes", () => {
    const container = createContainer();
    const controller = createSpectrumEngineController({
      container,
      autoResize: false,
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) =>
        new DomStubRenderer("webgl2", [
          opts.surfaces.underlay,
          opts.surfaces.plot,
          opts.surfaces.overlay,
        ]),
    });

    // Initial Canvas2D topology
    const c2dCanvases = Array.from(container.querySelectorAll("canvas"));
    expect(c2dCanvases.length).toBe(1);
    expect(controller.canvases.length).toBe(1);
    const c2d = c2dCanvases[0]!;
    expect(c2d.getAttribute("data-trace-kit-engine")).toBe("canvas2d");
    expect(c2d.getAttribute("data-trace-kit-layer")).toBe("canvas2d");
    expect(c2d.style.position).toBe("absolute");
    expect(c2d.style.left).toBe("0px");
    expect(c2d.style.top).toBe("0px");
    expect(c2d.style.width).toBe("100%");
    expect(c2d.style.height).toBe("100%");
    expect(c2d.style.display).toBe("block");

    // Upgrade to WebGL2 topology
    controller.setData(makePayload(80_000));
    controller.render();

    const glCanvases = Array.from(container.querySelectorAll("canvas"));
    expect(glCanvases.length).toBe(3);
    expect(controller.canvases.length).toBe(3);
    expect(glCanvases.map((c) => c.getAttribute("data-trace-kit-engine"))).toEqual([
      "webgl2",
      "webgl2",
      "webgl2",
    ]);
    expect(glCanvases.map((c) => c.getAttribute("data-trace-kit-layer"))).toEqual([
      "underlay",
      "plot",
      "overlay",
    ]);
    for (const c of glCanvases) {
      expect(c.style.position).toBe("absolute");
      expect(c.style.left).toBe("0px");
      expect(c.style.top).toBe("0px");
      expect(c.style.width).toBe("100%");
      expect(c.style.height).toBe("100%");
      expect(c.style.display).toBe("block");
    }
    expect(glCanvases[2]!.style.pointerEvents).toBe("none");

    controller.dispose();
  });

  it("preserves host container identity, pointerdown listeners, and sibling overlay z-order across round-trip swaps", () => {
    const container = createContainer();
    let pointerDownCount = 0;
    container.addEventListener("pointerdown", () => {
      pointerDownCount += 1;
    });

    const controller = createSpectrumEngineController({
      container,
      autoResize: false,
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) =>
        new DomStubRenderer("webgl2", [
          opts.surfaces.underlay,
          opts.surfaces.plot,
          opts.surfaces.overlay,
        ]),
    });

    // Append a non-managed sibling overlay after controller creation
    const overlayDiv = document.createElement("div");
    overlayDiv.setAttribute("data-role", "overlay");
    container.appendChild(overlayDiv);

    expect(Array.from(container.children)).toEqual([controller.canvases[0], overlayDiv]);

    // Dispatch pointerdown on Canvas2D canvas -> bubbles to container
    controller.canvases[0]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(pointerDownCount).toBe(1);

    // Swap canvas2d -> webgl2
    controller.setData(makePayload(90_000));
    controller.render();

    expect(controller.container).toBe(container);
    expect(Array.from(container.children)).toEqual([
      controller.canvases[0],
      controller.canvases[1],
      controller.canvases[2],
      overlayDiv,
    ]);

    // Dispatch pointerdown on WebGL2 plot canvas -> still bubbles to container
    controller.canvases[1]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(pointerDownCount).toBe(2);

    // Swap webgl2 -> canvas2d
    controller.setData(makePayload(10_000));
    controller.render();

    expect(Array.from(container.children)).toEqual([controller.canvases[0], overlayDiv]);
    controller.canvases[0]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(pointerDownCount).toBe(3);

    // Dispose removes only managed canvases and preserves sibling overlay
    controller.dispose();
    expect(container.querySelectorAll("canvas").length).toBe(0);
    expect(Array.from(container.children)).toEqual([overlayDiv]);
  });

  it("inserts initial canvases before pre-existing non-managed children in container", () => {
    const container = createContainer();
    const preExistingOverlay = document.createElement("div");
    preExistingOverlay.setAttribute("data-role", "overlay");
    container.appendChild(preExistingOverlay);

    const controller = createSpectrumEngineController({
      container,
      autoResize: false,
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: () => {
        throw new Error("unused");
      },
    });

    expect(Array.from(container.children)).toEqual([controller.canvases[0], preExistingOverlay]);
    controller.dispose();
    expect(Array.from(container.children)).toEqual([preExistingOverlay]);
  });

  it("wires ResizeObserver autoResize with injected DPR and coalesced rAF, updating backing stores and transform", () => {
    const container = createContainer();
    const raf = createManualRaf();
    const renderers: DomStubRenderer[] = [];
    let roCallback: ResizeObserverCallbackLike | null = null;
    let observedTarget: Element | null = null;
    let disconnected = false;

    const controller = createSpectrumEngineController({
      container,
      autoResize: true,
      getDevicePixelRatio: () => 2,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      resizeObserverFactory: (cb): ResizeObserverLike => {
        roCallback = cb;
        return {
          observe(target: Element) {
            observedTarget = target;
          },
          disconnect() {
            disconnected = true;
          },
        };
      },
      createCanvas2DRenderer: (opts) => {
        const r = new DomStubRenderer("canvas2d", [opts.surface]);
        renderers.push(r);
        return r;
      },
      createWebGL2Renderer: () => {
        throw new Error("unused");
      },
    });

    expect(observedTarget).toBe(container);
    expect(roCallback).not.toBeNull();

    // Emit ResizeObserver notification for 800 x 500 CSS pixels at DPR 2
    roCallback!([{ contentRect: { width: 800, height: 500 } }]);

    expect(controller.width).toBe(800);
    expect(controller.height).toBe(500);
    expect(controller.dpr).toBe(2);
    expect(controller.transform.deviceWidth).toBe(1600);
    expect(controller.transform.deviceHeight).toBe(1000);
    expect(controller.transform.dpr).toBe(2);
    expect(controller.canvases[0]!.width).toBe(1600);
    expect(controller.canvases[0]!.height).toBe(1000);

    // Additional mutations before flush coalesce into the single scheduled rAF
    controller.setData(makePayload(5_000));
    controller.requestRender();
    controller.setDomain(0, 10, -50, 0);
    controller.requestRender();

    expect(raf.scheduleCount()).toBe(1);
    expect(renderers[0]!.renderCount).toBe(0);

    raf.flush();
    expect(renderers[0]!.renderCount).toBe(1);

    controller.dispose();
    expect(disconnected).toBe(true);
    expect(controller.canvases.length).toBe(0);
    expect(container.querySelectorAll("canvas").length).toBe(0);
  });

  it("preserves z-order with simultaneous before and after siblings across 1->3->1 round-trip swaps", () => {
    const container = createContainer();
    const controller = createSpectrumEngineController({
      container,
      autoResize: false,
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) =>
        new DomStubRenderer("webgl2", [
          opts.surfaces.underlay,
          opts.surfaces.plot,
          opts.surfaces.overlay,
        ]),
    });

    const underlayDiv = document.createElement("div");
    underlayDiv.setAttribute("data-role", "underlay");
    const overlayDiv = document.createElement("div");
    overlayDiv.setAttribute("data-role", "overlay");

    container.insertBefore(underlayDiv, controller.canvases[0]!);
    container.appendChild(overlayDiv);

    expect(Array.from(container.children)).toEqual([underlayDiv, controller.canvases[0], overlayDiv]);

    // Swap 1 -> 3 canvases
    controller.setData(makePayload(90_000));
    controller.render();
    expect(Array.from(container.children)).toEqual([
      underlayDiv,
      controller.canvases[0],
      controller.canvases[1],
      controller.canvases[2],
      overlayDiv,
    ]);

    // Swap 3 -> 1 canvas
    controller.setData(makePayload(10_000));
    controller.render();
    expect(Array.from(container.children)).toEqual([underlayDiv, controller.canvases[0], overlayDiv]);

    // Dispose preserves both before and after siblings in exact order
    controller.dispose();
    expect(Array.from(container.children)).toEqual([underlayDiv, overlayDiv]);
  });

  it("falls back safely to container.firstChild when an outgoing managed canvas was externally detached", () => {
    const container = createContainer();
    const controller = createSpectrumEngineController({
      container,
      autoResize: false,
      createCanvas2DRenderer: (opts) => new DomStubRenderer("canvas2d", [opts.surface]),
      createWebGL2Renderer: (opts) =>
        new DomStubRenderer("webgl2", [
          opts.surfaces.underlay,
          opts.surfaces.plot,
          opts.surfaces.overlay,
        ]),
    });

    const overlayDiv = document.createElement("div");
    overlayDiv.setAttribute("data-role", "overlay");
    container.appendChild(overlayDiv);

    // Externally detach the managed Canvas2D canvas so outgoingCanvases[0].parentNode !== container
    controller.canvases[0]!.remove();
    expect(Array.from(container.children)).toEqual([overlayDiv]);

    // Swapping to WebGL2 must not throw NotFoundError and must insert before overlayDiv
    controller.setData(makePayload(90_000));
    expect(() => controller.render()).not.toThrow();
    expect(controller.activeKind).toBe("webgl2");
    expect(Array.from(container.children)).toEqual([
      controller.canvases[0],
      controller.canvases[1],
      controller.canvases[2],
      overlayDiv,
    ]);

    controller.dispose();
    expect(Array.from(container.children)).toEqual([overlayDiv]);
  });
});
