import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pane } from "tweakpane";
import {
  createViewportTransform,
  type DecimationSelection,
  type SpectrumDataPayload,
  type ViewportTransform,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "@trace-kit/renderers";
import { asRoutePath } from "../../src/shell/view.js";
import { resolveView } from "../../src/shell/registry.js";
import { mount as mountHome } from "../../src/views/home/mount.js";
import {
  mountEngineController,
  type EngineControllerViewOptions,
} from "../../src/views/engine-controller/mount.js";

class FakeRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  #disposed = false;
  #width = 800;
  #height = 400;
  #dpr = 1;
  #xMin = 0;
  #xMax = 1;
  #yMin = -1;
  #yMax = 1;
  #transform: ViewportTransform;
  disposeCount = 0;
  renderCount = 0;
  lastPayload: SpectrumDataPayload | null = null;
  readonly decimationHistory: Array<DecimationSelection | undefined> = [];

  constructor(kind: FigureRendererKind) {
    this.kind = kind;
    this.#transform = this.#computeTransform();
  }

  #computeTransform(): ViewportTransform {
    return createViewportTransform({
      cssWidth: this.#width,
      cssHeight: this.#height,
      dpr: this.#dpr,
      insetLeft: 48,
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
    this.lastPayload = payload;
  }

  setTraces(): void {}

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
    this.#transform = this.#computeTransform();
  }

  resize(width: number, height: number, dpr: number): void {
    this.#width = width;
    this.#height = height;
    this.#dpr = dpr;
    this.#transform = this.#computeTransform();
  }

  render(): void {
    this.renderCount += 1;
  }

  clear(): void {}

  setDecimation(selection: DecimationSelection | undefined): void {
    this.decimationHistory.push(selection);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.#disposed = true;
  }
}

interface CreatedRenderers {
  readonly canvas2d: FakeRenderer[];
  readonly webgl2: FakeRenderer[];
  readonly order: string[];
}

function createViewHarness(
  created: CreatedRenderers,
  overrides: Partial<EngineControllerViewOptions> = {},
): EngineControllerViewOptions {
  return {
    autoResize: false,
    ensureFont: () => {
      created.order.push("font");
      return Promise.resolve();
    },
    createCanvas2DRenderer: (): FigureRenderer => {
      const renderer = new FakeRenderer("canvas2d");
      created.order.push("create:canvas2d");
      created.canvas2d.push(renderer);
      return renderer;
    },
    createWebGL2Renderer: (): FigureRenderer => {
      const renderer = new FakeRenderer("webgl2");
      created.order.push("create:webgl2");
      created.webgl2.push(renderer);
      return renderer;
    },
    ...overrides,
  };
}

function hudField(container: HTMLElement, field: string): string {
  const el = container.querySelector(
    `div[data-role="controller-hud"] [data-field="${field}"]`,
  );
  if (el === null) {
    throw new Error(`Missing HUD field [data-field="${field}"]`);
  }
  return (el.textContent ?? "").trim();
}

function stageCanvases(container: HTMLElement): HTMLCanvasElement[] {
  const stage = container.querySelector('div[data-role="controller-stage"]');
  if (stage === null) {
    throw new Error('Missing stage container div[data-role="controller-stage"]');
  }
  return Array.from(stage.querySelectorAll("canvas"));
}

function clickAction(container: HTMLElement, action: string): void {
  const el = container.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (el === null) {
    throw new Error(`Missing control [data-action="${action}"]`);
  }
  el.click();
}

function setCheckboxAction(container: HTMLElement, action: string, checked: boolean): void {
  const el = container.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (el === null) {
    throw new Error(`Missing control [data-action="${action}"]`);
  }
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    el.checked = checked;
    el.dispatchEvent(new Event("change"));
  } else {
    el.click();
  }
}

describe("/engine-controller registration", () => {
  it("registers /engine-controller via views/index.ts with no shell or /home edits and appears on /home", async () => {
    await import("../../src/views/index.js");
    const view = resolveView(asRoutePath("/engine-controller"));
    expect(view).toBeDefined();
    expect(view?.label).toBe("Engine Controller");

    const here = path.dirname(fileURLToPath(import.meta.url));
    const indexSrc = readFileSync(path.join(here, "../../src/views/index.ts"), "utf8");
    expect(indexSrc.match(/engine-controller/g)?.length).toBe(1);

    for (const shellFile of ["router.ts", "registry.ts", "bootstrap.ts", "view.ts"]) {
      expect(readFileSync(path.join(here, "../../src/shell", shellFile), "utf8")).not.toContain(
        "engine-controller",
      );
    }
    expect(readFileSync(path.join(here, "../../src/views/home/mount.ts"), "utf8")).not.toContain(
      "engine-controller",
    );

    const homeContainer = document.createElement("div");
    const panel = new Pane();
    const abortController = new AbortController();
    const teardown = mountHome({
      container: homeContainer,
      panel,
      signal: abortController.signal,
    });
    const hrefs = Array.from(homeContainer.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("#/engine-controller");
    await teardown();
  });
});

describe("/engine-controller view", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("awaits ensureFont before creating controller, mounts stage and HUD, and honors abort after ensureFont", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountEngineController(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    expect(created.order[0]).toBe("font");
    expect(created.order[1]).toBe("create:canvas2d");
    expect(container.querySelector('div[data-role="controller-stage"]')).not.toBeNull();
    expect(container.querySelector('div[data-role="controller-hud"]')).not.toBeNull();
    expect(stageCanvases(container)).toHaveLength(1);
    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(hudField(container, "selection-mode")).toBe("auto");
    expect(hudField(container, "canvas-count")).toBe("1");
    expect(hudField(container, "switch-count")).toBe("0");

    abortController.abort();
    await teardown();

    // Verify abort during ensureFont bails immediately without mounting or creating renderers.
    const abortedCreated: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const abortedContainer = document.createElement("div");
    document.body.appendChild(abortedContainer);
    const abortDuringFont = new AbortController();
    const abortedTeardown = await mountEngineController(
      { container: abortedContainer, panel: new Pane(), signal: abortDuringFont.signal },
      createViewHarness(abortedCreated, {
        ensureFont: async () => {
          abortedCreated.order.push("font");
          abortDuringFont.abort();
          await Promise.resolve();
        },
      }),
    );

    expect(abortedCreated.canvas2d).toHaveLength(0);
    expect(abortedCreated.webgl2).toHaveLength(0);
    expect(abortedContainer.querySelectorAll("canvas")).toHaveLength(0);
    await abortedTeardown();
  });

  it("traverses presets 10k -> 80k -> 72k -> 64k switching 1 -> 3 -> 3 -> 1 canvases and updates HUD", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountEngineController(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    clickAction(container, "samples-10000");
    expect(stageCanvases(container)).toHaveLength(1);
    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(hudField(container, "sample-count")).toBe("10000");
    expect(hudField(container, "hysteresis-band")).toBe("below-down");
    expect(hudField(container, "canvas-count")).toBe("1");
    expect(hudField(container, "switch-count")).toBe("0");

    // Same Retained payload instance reused across sample-count updates (zero reallocation).
    const initialPayload = created.canvas2d[0]?.lastPayload;
    expect(initialPayload).not.toBeNull();

    clickAction(container, "samples-80000");
    expect(stageCanvases(container)).toHaveLength(3);
    expect(hudField(container, "active-engine")).toBe("webgl2");
    expect(hudField(container, "sample-count")).toBe("80000");
    expect(hudField(container, "hysteresis-band")).toBe("above-up");
    expect(hudField(container, "canvas-count")).toBe("3");
    expect(hudField(container, "switch-count")).toBe("1");
    expect(created.webgl2[0]?.lastPayload).toBe(initialPayload);

    clickAction(container, "samples-72000");
    expect(stageCanvases(container)).toHaveLength(3);
    expect(hudField(container, "active-engine")).toBe("webgl2");
    expect(hudField(container, "sample-count")).toBe("72000");
    expect(hudField(container, "hysteresis-band")).toBe("deadband");
    expect(hudField(container, "canvas-count")).toBe("3");
    expect(hudField(container, "switch-count")).toBe("1");

    clickAction(container, "samples-64000");
    expect(stageCanvases(container)).toHaveLength(1);
    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(hudField(container, "sample-count")).toBe("64000");
    expect(hudField(container, "hysteresis-band")).toBe("below-down");
    expect(hudField(container, "canvas-count")).toBe("1");
    expect(hudField(container, "switch-count")).toBe("2");

    abortController.abort();
    await teardown();
  });

  it("reports deadband without switching on 10k -> 72k and switches on 80k, and supports slider, mode-select, and decimation-select", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountEngineController(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    // 10k -> 72k -> 80k spec scenario
    clickAction(container, "samples-72000");
    expect(hudField(container, "hysteresis-band")).toBe("deadband");
    expect(stageCanvases(container)).toHaveLength(1);
    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(hudField(container, "switch-count")).toBe("0");

    clickAction(container, "samples-80000");
    expect(hudField(container, "hysteresis-band")).toBe("above-up");
    expect(stageCanvases(container)).toHaveLength(3);
    expect(hudField(container, "active-engine")).toBe("webgl2");
    expect(hudField(container, "canvas-count")).toBe("3");
    expect(hudField(container, "switch-count")).toBe("1");

    // Continuous range slider
    const slider = container.querySelector<HTMLInputElement>(
      'input[data-action="sample-count-slider"]',
    );
    expect(slider).not.toBeNull();
    if (slider !== null) {
      slider.value = "50000";
      slider.dispatchEvent(new Event("input"));
    }
    expect(hudField(container, "sample-count")).toBe("50000");
    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(stageCanvases(container)).toHaveLength(1);

    // Mode selector
    const modeSelect = container.querySelector<HTMLSelectElement>(
      'select[data-action="mode-select"]',
    );
    expect(modeSelect).not.toBeNull();
    if (modeSelect !== null) {
      modeSelect.value = "webgl2";
      modeSelect.dispatchEvent(new Event("change"));
    }
    expect(hudField(container, "selection-mode")).toBe("webgl2");
    expect(hudField(container, "active-engine")).toBe("webgl2");
    expect(stageCanvases(container)).toHaveLength(3);

    // Decimation selector
    const decimationSelect = container.querySelector<HTMLSelectElement>(
      'select[data-action="decimation-select"]',
    );
    expect(decimationSelect).not.toBeNull();
    const activeGl = created.webgl2.at(-1);
    if (decimationSelect !== null) {
      decimationSelect.value = "lttb";
      decimationSelect.dispatchEvent(new Event("change"));
      expect(activeGl?.decimationHistory.at(-1)).toEqual({ algorithm: "lttb" });

      decimationSelect.value = "min-max";
      decimationSelect.dispatchEvent(new Event("change"));
      expect(activeGl?.decimationHistory.at(-1)).toEqual({ algorithm: "min-max" });

      decimationSelect.value = "default";
      decimationSelect.dispatchEvent(new Event("change"));
      expect(activeGl?.decimationHistory.at(-1)).toBeUndefined();
    }

    abortController.abort();
    await teardown();
  });

  it("defers threshold switch while gesture-toggle is active and flushes immediately on release", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountEngineController(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    expect(hudField(container, "gesture-active")).toBe("false");
    expect(hudField(container, "pending-engine")).toBe("none");

    setCheckboxAction(container, "gesture-toggle", true);
    expect(hudField(container, "gesture-active")).toBe("true");

    clickAction(container, "samples-150000");
    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(hudField(container, "pending-engine")).toBe("webgl2");
    expect(stageCanvases(container)).toHaveLength(1);

    setCheckboxAction(container, "gesture-toggle", false);
    expect(hudField(container, "gesture-active")).toBe("false");
    expect(hudField(container, "active-engine")).toBe("webgl2");
    expect(hudField(container, "pending-engine")).toBe("none");
    expect(stageCanvases(container)).toHaveLength(3);

    abortController.abort();
    await teardown();
  });

  it("latches fallback to Canvas2D when simulate-webgl2-failure is enabled and recovers via retryWebGL2 when disabled", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountEngineController(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    setCheckboxAction(container, "simulate-webgl2-failure", true);
    clickAction(container, "samples-150000");

    expect(hudField(container, "active-engine")).toBe("canvas2d");
    expect(hudField(container, "webgl2-fallback")).toBe("true");
    expect(hudField(container, "canvas-count")).toBe("1");
    expect(stageCanvases(container)).toHaveLength(1);

    setCheckboxAction(container, "simulate-webgl2-failure", false);

    expect(hudField(container, "webgl2-fallback")).toBe("false");
    expect(hudField(container, "active-engine")).toBe("webgl2");
    expect(hudField(container, "canvas-count")).toBe("3");
    expect(stageCanvases(container)).toHaveLength(3);

    abortController.abort();
    await teardown();
  });

  it("unmounts cleanly: disposes controller, leaves 0 canvases, and nets addEventListener/removeEventListener and rAF/cAF to 0", async () => {
    let addCount = 0;
    let removeCount = 0;
    let rafActive = 0;

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalAdd = EventTarget.prototype.addEventListener;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalRemove = EventTarget.prototype.removeEventListener;
    const originalRaf = window.requestAnimationFrame.bind(window);
    const originalCaf = window.cancelAnimationFrame.bind(window);

    let nextRafId = 1;
    const rafIds = new Set<number>();

    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Pane();
    const abortController = new AbortController();

    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof originalAdd>
    ) {
      addCount += 1;
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof originalRemove>
    ) {
      removeCount += 1;
      return originalRemove.apply(this, args);
    };
    window.requestAnimationFrame = (): number => {
      const id = nextRafId;
      nextRafId += 1;
      rafIds.add(id);
      rafActive += 1;
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      if (rafIds.delete(id)) {
        rafActive -= 1;
      }
    };

    try {
      const teardown = await mountEngineController(
        { container, panel, signal: abortController.signal },
        createViewHarness(created),
      );

      clickAction(container, "samples-80000");
      expect(stageCanvases(container)).toHaveLength(3);

      abortController.abort();
      await teardown();

      expect(container.querySelectorAll("canvas")).toHaveLength(0);
      expect(container.childElementCount).toBe(0);
      expect(created.canvas2d.every((r) => r.disposeCount === 1)).toBe(true);
      expect(created.webgl2.every((r) => r.disposeCount === 1)).toBe(true);
      expect(addCount - removeCount).toBe(0);
      expect(rafActive).toBe(0);
    } finally {
      EventTarget.prototype.addEventListener = originalAdd;
      EventTarget.prototype.removeEventListener = originalRemove;
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    }
  });
});
