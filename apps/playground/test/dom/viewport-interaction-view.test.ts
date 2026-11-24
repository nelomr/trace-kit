import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pane } from "tweakpane";
import {
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  createViewportTransform,
  type DecimationSelection,
  type SpectrumDataPayload,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "@trace-kit/renderers";
import { asRoutePath } from "../../src/shell/view.js";
import { resolveView } from "../../src/shell/registry.js";
import { mount as mountHome } from "../../src/views/home/mount.js";
import {
  mountViewportInteraction,
  type ViewportInteractionViewOptions,
} from "../../src/views/viewport-interaction/mount.js";

class FakeRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind;
  #disposed = false;
  #width = 800;
  #height = 420;
  #dpr = 1;
  #xMin = 0;
  #xMax = 1;
  #yMin = -1;
  #yMax = 1;
  #xOrigin = 0;
  #yScaleKind: YAxisRegistration["scaleKind"] = Y_SCALE_KIND_LINEAR;
  #transform: ViewportTransform;
  disposeCount = 0;
  renderCount = 0;
  lastPayload: SpectrumDataPayload | null = null;
  readonly decimationHistory: Array<DecimationSelection | undefined> = [];

  constructor(kind: FigureRendererKind, yAxes?: readonly YAxisRegistration[]) {
    this.kind = kind;
    if (yAxes !== undefined && yAxes.length === 1) {
      const primary = yAxes[0];
      if (primary !== undefined) {
        this.#yScaleKind = primary.scaleKind;
        this.#yMin = primary.domainMin;
        this.#yMax = primary.domainMax;
      }
    }
    this.#transform = this.#computeTransform();
  }

  #computeTransform(): ViewportTransform {
    return createViewportTransform({
      cssWidth: this.#width,
      cssHeight: this.#height,
      dpr: this.#dpr,
      insetLeft: 64,
      insetRight: 16,
      insetTop: 16,
      insetBottom: 36,
      xDomainMin: this.#xMin,
      xDomainMax: this.#xMax,
      yDomainMin: this.#yMin,
      yDomainMax: this.#yMax,
      xOrigin: this.#xOrigin,
      yScaleKind: this.#yScaleKind,
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
    this.#xOrigin = payload.xOrigin;
    this.#transform = this.#computeTransform();
  }

  setTraces(): void {}

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    const prevXMin = this.#xMin;
    const prevXMax = this.#xMax;
    const prevYMin = this.#yMin;
    const prevYMax = this.#yMax;
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
    try {
      this.#transform = this.#computeTransform();
    } catch (error) {
      this.#xMin = prevXMin;
      this.#xMax = prevXMax;
      this.#yMin = prevYMin;
      this.#yMax = prevYMax;
      throw error;
    }
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
  overrides: Partial<ViewportInteractionViewOptions> = {},
): ViewportInteractionViewOptions {
  return {
    autoResize: false,
    ensureFont: () => {
      created.order.push("font");
      return Promise.resolve();
    },
    createCanvas2DRenderer: (options): FigureRenderer => {
      const renderer = new FakeRenderer("canvas2d", options.yAxes);
      created.order.push("create:canvas2d");
      created.canvas2d.push(renderer);
      return renderer;
    },
    createWebGL2Renderer: (options): FigureRenderer => {
      const renderer = new FakeRenderer("webgl2", options.yAxes);
      created.order.push("create:webgl2");
      created.webgl2.push(renderer);
      return renderer;
    },
    ...overrides,
  };
}

function hudField(container: HTMLElement, field: string): string {
  const el = container.querySelector(
    `div[data-role="interaction-hud"] [data-field="${field}"]`,
  );
  if (el === null) {
    throw new Error(`Missing HUD field [data-field="${field}"]`);
  }
  return (el.textContent ?? "").trim();
}

function clickAction(container: HTMLElement, action: string): void {
  const el = container.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (el === null) {
    throw new Error(`Missing control [data-action="${action}"]`);
  }
  el.click();
}

function selectAction(container: HTMLElement, action: string, value: string): void {
  const el = container.querySelector<HTMLSelectElement>(`select[data-action="${action}"]`);
  if (el === null) {
    throw new Error(`Missing select [data-action="${action}"]`);
  }
  el.value = value;
  el.dispatchEvent(new Event("change"));
}

function parseDomainPair(text: string): [number, number] {
  const match = text.match(/\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Could not parse domain pair from "${text}"`);
  }
  return [Number(match[1]), Number(match[2])];
}

function createSyntheticWheelEvent(init: {
  readonly deltaX?: number;
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
}): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY,
    deltaMode: init.deltaMode ?? 0,
    bubbles: true,
    cancelable: true,
  });
  // Happy-DOM's WheelEvent drops MouseEventInit fields; attach them explicitly if missing.
  if (typeof event.clientX !== "number") {
    Object.defineProperties(event, {
      clientX: { value: init.clientX, configurable: true },
      clientY: { value: init.clientY, configurable: true },
      shiftKey: { value: init.shiftKey ?? false, configurable: true },
      altKey: { value: init.altKey ?? false, configurable: true },
      ctrlKey: { value: init.ctrlKey ?? false, configurable: true },
    });
  }
  return event;
}

describe("/viewport-interaction registration", () => {
  it("registers /viewport-interaction via views/index.ts with no shell or /home edits and appears on /home", async () => {
    await import("../../src/views/index.js");
    const view = resolveView(asRoutePath("/viewport-interaction"));
    expect(view).toBeDefined();
    expect(view?.label).toBe("Viewport Interaction");

    const here = path.dirname(fileURLToPath(import.meta.url));
    const indexSrc = readFileSync(path.join(here, "../../src/views/index.ts"), "utf8");
    expect(indexSrc.match(/viewport-interaction/g)?.length).toBe(1);

    for (const shellFile of ["router.ts", "registry.ts", "bootstrap.ts", "view.ts"]) {
      expect(readFileSync(path.join(here, "../../src/shell", shellFile), "utf8")).not.toContain(
        "viewport-interaction",
      );
    }
    expect(readFileSync(path.join(here, "../../src/views/home/mount.ts"), "utf8")).not.toContain(
      "viewport-interaction",
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
    expect(hrefs).toContain("#/viewport-interaction");
    await teardown();
  });
});

describe("/viewport-interaction view", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("awaits ensureFont prior to DOM mount and returns a safe no-op teardown if aborted after font resolves", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountViewportInteraction(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    expect(created.order[0]).toBe("font");
    expect(created.order[1]).toBe("create:canvas2d");
    expect(container.querySelector('div[data-role="interaction-stage"]')).not.toBeNull();
    expect(container.querySelector('div[data-role="interaction-hud"]')).not.toBeNull();
    expect(container.querySelector('[data-trace-kit-overlay="box-zoom"]')).not.toBeNull();

    // Verify all 9 required HUD fields exist.
    for (const field of [
      "active-engine",
      "domain-x",
      "domain-y",
      "gesture-state",
      "gesture-active",
      "pointer-region",
      "invalidation-seq",
      "invalidation-phase",
      "visible-samples",
    ]) {
      expect(hudField(container, field).length).toBeGreaterThan(0);
    }

    abortController.abort();
    await teardown();

    // Abort during ensureFont bails before mounting DOM or creating renderers.
    const abortedCreated: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const abortedContainer = document.createElement("div");
    document.body.appendChild(abortedContainer);
    const abortDuringFont = new AbortController();
    const abortedTeardown = await mountViewportInteraction(
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
    expect(abortedContainer.querySelectorAll('[data-trace-kit-overlay="box-zoom"]')).toHaveLength(
      0,
    );
    await abortedTeardown();
  });

  it("programmatic controls and presets mutate domain and survive linear -> log-y-power scale switching", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountViewportInteraction(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    const [homeXMin, homeXMax] = parseDomainPair(hudField(container, "domain-x"));
    const [homeYMin, homeYMax] = parseDomainPair(hudField(container, "domain-y"));
    const homeXSpan = homeXMax - homeXMin;
    const homeYSpan = homeYMax - homeYMin;

    // zoom-in halves visible span
    clickAction(container, "zoom-in");
    const [zXMin, zXMax] = parseDomainPair(hudField(container, "domain-x"));
    const [zYMin, zYMax] = parseDomainPair(hudField(container, "domain-y"));
    expect(zXMax - zXMin).toBeCloseTo(homeXSpan * 0.5, 6);
    expect(zYMax - zYMin).toBeCloseTo(homeYSpan * 0.5, 6);

    // pan-right shifts X right
    clickAction(container, "pan-right");
    const [pXMin, pXMax] = parseDomainPair(hudField(container, "domain-x"));
    expect(pXMin).toBeGreaterThan(zXMin);
    expect(pXMax).toBeGreaterThan(zXMax);

    // pan-left shifts X back left
    clickAction(container, "pan-left");
    const [plXMin, plXMax] = parseDomainPair(hudField(container, "domain-x"));
    expect(plXMin).toBeCloseTo(zXMin, 6);
    expect(plXMax).toBeCloseTo(zXMax, 6);

    // zoom-out doubles span back to home span
    clickAction(container, "zoom-out");
    const [zoXMin, zoXMax] = parseDomainPair(hudField(container, "domain-x"));
    expect(zoXMax - zoXMin).toBeCloseTo(homeXSpan, 6);

    // reset-domain restores homeDomain
    clickAction(container, "pan-right");
    clickAction(container, "reset-domain");
    const [rXMin, rXMax] = parseDomainPair(hudField(container, "domain-x"));
    const [rYMin, rYMax] = parseDomainPair(hudField(container, "domain-y"));
    expect(rXMin).toBeCloseTo(homeXMin, 6);
    expect(rXMax).toBeCloseTo(homeXMax, 6);
    expect(rYMin).toBeCloseTo(homeYMin, 6);
    expect(rYMax).toBeCloseTo(homeYMax, 6);

    // Switch to log-y-power preset and zoom-in cleanly with strictly positive Y
    selectAction(container, "preset-select", "log-y-power");
    const activeLogRenderer = created.canvas2d.at(-1);
    expect(activeLogRenderer?.transform.yScaleKind).toBe(Y_SCALE_KIND_LOG);
    const [logYMinBefore, logYMaxBefore] = parseDomainPair(hudField(container, "domain-y"));
    expect(logYMinBefore).toBeGreaterThan(0);
    expect(logYMaxBefore).toBeGreaterThan(logYMinBefore);

    clickAction(container, "zoom-in");
    const [logYMinAfter, logYMaxAfter] = parseDomainPair(hudField(container, "domain-y"));
    expect(logYMinAfter).toBeGreaterThan(0);
    expect(logYMinAfter).toBeGreaterThan(logYMinBefore);
    expect(logYMaxAfter).toBeLessThan(logYMaxBefore);

    abortController.abort();
    await teardown();
  });

  it("deep-zoom-1550 preset displays sub-picometre precision (>= 6 decimals) and xOrigin === 1550", async () => {
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountViewportInteraction(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    selectAction(container, "preset-select", "deep-zoom-1550");
    const domainXText = hudField(container, "domain-x");
    const [xMin, xMax] = parseDomainPair(domainXText);
    expect(xMin).toBeCloseTo(1550.0001, 7);
    expect(xMax).toBeCloseTo(1550.0002, 7);

    // Verify at least 6 decimal places are rendered in the HUD text.
    const decimalMatches = domainXText.match(/\d+\.(\d+)/g) ?? [];
    expect(decimalMatches.length).toBeGreaterThanOrEqual(2);
    for (const numStr of decimalMatches) {
      const frac = numStr.split(".")[1] ?? "";
      expect(frac.length).toBeGreaterThanOrEqual(6);
    }

    const activeRenderer = created.canvas2d.at(-1);
    expect(activeRenderer?.transform.xOrigin).toBe(1550);

    abortController.abort();
    await teardown();
  });

  it("updates HUD telemetry on wheel event inside stage, and wires drag-mode, wheel-axis, sample-count, and invalidation-mode selects", async () => {
    vi.useFakeTimers();
    const created: CreatedRenderers = { canvas2d: [], webgl2: [], order: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const abortController = new AbortController();

    const teardown = await mountViewportInteraction(
      { container, panel: new Pane(), signal: abortController.signal },
      createViewHarness(created),
    );

    const stage = container.querySelector<HTMLElement>('div[data-role="interaction-stage"]');
    expect(stage).not.toBeNull();
    if (stage === null) return;

    const [beforeXMin, beforeXMax] = parseDomainPair(hudField(container, "domain-x"));
    const seqBefore = Number(hudField(container, "invalidation-seq"));

    const wheelEvent = createSyntheticWheelEvent({
      deltaY: -120,
      clientX: 400,
      clientY: 200,
    });
    stage.dispatchEvent(wheelEvent);

    // Advance past wheel settle debounce (120 ms)
    vi.advanceTimersByTime(200);

    const seqAfter = Number(hudField(container, "invalidation-seq"));
    expect(seqAfter).toBeGreaterThan(seqBefore);
    expect(hudField(container, "invalidation-phase")).toBe("settled");

    const [afterXMin, afterXMax] = parseDomainPair(hudField(container, "domain-x"));
    expect(afterXMax - afterXMin).toBeLessThan(beforeXMax - beforeXMin);

    // Wire remaining selects cleanly
    selectAction(container, "drag-mode-select", "box-zoom");
    selectAction(container, "drag-mode-select", "pan");

    selectAction(container, "wheel-axis-select", "x");
    selectAction(container, "wheel-axis-select", "y");
    selectAction(container, "wheel-axis-select", "xy");

    // Sample-count toggle: 10000 -> canvas2d, 90000 -> webgl2
    selectAction(container, "invalidation-mode-select", "direct");
    selectAction(container, "sample-count-select", "90000");
    expect(hudField(container, "active-engine")).toBe("webgl2");
    selectAction(container, "sample-count-select", "10000");
    expect(hudField(container, "active-engine")).toBe("canvas2d");

    // Invalidation mode selects: windowed-port & streaming-ring
    selectAction(container, "invalidation-mode-select", "windowed-port");
    clickAction(container, "zoom-in");
    expect(Number(hudField(container, "visible-samples"))).toBeGreaterThan(0);

    selectAction(container, "invalidation-mode-select", "streaming-ring");
    clickAction(container, "pan-right");
    expect(Number(hudField(container, "visible-samples"))).toBeGreaterThan(0);

    abortController.abort();
    await teardown();
  });

  it("unmounts cleanly: leaves 0 canvases, 0 box-zoom overlays, and nets addEventListener/removeEventListener and rAF/cAF to 0", async () => {
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
      const teardown = await mountViewportInteraction(
        { container, panel, signal: abortController.signal },
        createViewHarness(created),
      );

      // Exercise a wheel event (leaves pending rAF + timer) before unmounting
      const stage = container.querySelector<HTMLElement>('div[data-role="interaction-stage"]');
      stage?.dispatchEvent(
        createSyntheticWheelEvent({
          deltaY: -60,
          clientX: 300,
          clientY: 180,
        }),
      );

      abortController.abort();
      await teardown();

      expect(container.querySelectorAll("canvas")).toHaveLength(0);
      expect(container.querySelectorAll('[data-trace-kit-overlay="box-zoom"]')).toHaveLength(0);
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
