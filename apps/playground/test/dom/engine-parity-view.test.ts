import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pane } from "tweakpane";
import type { DecimationSelection, ViewportTransform } from "@trace-kit/core";
import type { Canvas2DSurface, FigureRenderer } from "@trace-kit/renderers";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import { asRoutePath } from "../../src/shell/view.js";
import { resolveView } from "../../src/shell/registry.js";
import { mountEngineParity, type EngineFactories } from "../../src/views/engine-parity/mount.js";
import { vertexCount } from "../../src/views/engine-parity/vertex-count.js";

const fontCalls = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock("@trace-kit/renderers/font", () => ({
  ensureDefaultFont: (): Promise<boolean> => {
    fontCalls.order.push("font");
    return Promise.resolve(true);
  },
}));

class FakeRenderer implements FigureRenderer {
  readonly kind: FigureRenderer["kind"];
  disposed = false;
  disposeCalls = 0;
  readonly renders: number[] = [];
  readonly selections: Array<DecimationSelection | undefined> = [];
  readonly transform: ViewportTransform;
  constructor(kind: FigureRenderer["kind"], fixture: ScenarioFixture) {
    this.kind = kind;
    this.transform = {
      plotWidth: 700,
      plotHeight: 300,
      plotLeft: 56,
      plotTop: 0,
      deviceWidth: fixture.viewport.width,
      deviceHeight: fixture.viewport.height,
    } as ViewportTransform;
  }
  setData(): void {}
  setTraces(): void {}
  setDomain(): void {}
  resize(): void {}
  render(): void {
    fontCalls.order.push(`render:${this.kind}`);
    this.renders.push(1);
  }
  clear(): void {}
  setDecimation(selection: DecimationSelection | undefined): void {
    this.selections.push(selection);
  }
  dispose(): void {
    this.disposeCalls += 1;
    this.disposed = true;
  }
}

interface Created {
  readonly canvas2d: FakeRenderer[];
  readonly webgl2: FakeRenderer[];
  readonly surfaces: Array<readonly Canvas2DSurface[]>;
  readonly canvases: HTMLCanvasElement[];
}

function factories(created: Created, options: { throwWebGl2?: string } = {}): EngineFactories {
  return {
    createCanvas2D: (canvas, fixture) => {
      created.canvases.push(canvas);
      const renderer = new FakeRenderer("canvas2d", fixture);
      created.canvas2d.push(renderer);
      return renderer;
    },
    createWebGL2: (surfaces, fixture) => {
      if (options.throwWebGl2 !== undefined) throw new TypeError(options.throwWebGl2);
      created.surfaces.push([surfaces.underlay, surfaces.plot, surfaces.overlay]);
      const renderer = new FakeRenderer("webgl2", fixture);
      created.webgl2.push(renderer);
      return renderer;
    },
  };
}

function newCreated(): Created {
  return { canvas2d: [], webgl2: [], surfaces: [], canvases: [] };
}

async function mounted(options: { throwWebGl2?: string } = {}) {
  const created = newCreated();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const controller = new AbortController();
  const teardown = await mountEngineParity(
    { container, panel: new Pane(), signal: controller.signal },
    factories(created, options),
  );
  return { created, container, controller, teardown };
}

function fixtureAt(id: string): ScenarioFixture {
  const fixture = SCENARIO_FIXTURES.find((f) => f.id === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixture;
}

beforeEach(() => {
  fontCalls.order.length = 0;
  document.body.innerHTML = "";
});

describe("/engine-parity view", () => {
  it("draws the selected scenario on two labelled panes sized to the fixture viewport", async () => {
    const { container, created, teardown } = await mounted();
    const text = container.textContent ?? "";
    expect(text).toContain("Canvas2D");
    expect(text).toContain("WebGL2");
    expect(container.querySelectorAll("canvas")).toHaveLength(4);
    for (const canvas of Array.from(container.querySelectorAll("canvas"))) {
      expect(canvas.style.width).toBe("800px");
      expect(canvas.style.height).toBe("400px");
    }
    const absolute = Array.from(container.querySelectorAll("canvas")).filter((c) => c.style.position === "absolute");
    expect(absolute).toHaveLength(3);
    expect(created.canvas2d).toHaveLength(1);
    expect(created.webgl2).toHaveLength(1);
    await teardown();
  });

  it("offers the nine scenarios and the three decimation modes", async () => {
    const { container, teardown } = await mounted();
    const scenario = container.querySelector<HTMLSelectElement>('select[aria-label="Scenario"]');
    const decimation = container.querySelector<HTMLSelectElement>('select[aria-label="Decimation"]');
    expect(Array.from(scenario?.options ?? []).map((o) => o.value)).toEqual(SCENARIO_FIXTURES.map((f) => f.id));
    expect(Array.from(decimation?.options ?? []).map((o) => o.textContent)).toEqual(["Default", "LTTB", "Min-Max"]);
    await teardown();
  });

  it("runs ensureDefaultFont before the first render", async () => {
    const { teardown } = await mounted();
    const firstRender = fontCalls.order.findIndex((entry) => entry.startsWith("render"));
    expect(fontCalls.order.indexOf("font")).toBeGreaterThanOrEqual(0);
    expect(fontCalls.order.indexOf("font")).toBeLessThan(firstRender);
    await teardown();
  });

  it("maps the decimation control to setDecimation on both renderers and redraws", async () => {
    const { container, created, teardown } = await mounted();
    const decimation = container.querySelector<HTMLSelectElement>('select[aria-label="Decimation"]');
    if (decimation === null) throw new Error("no decimation control");
    const c2 = created.canvas2d[0];
    const gl = created.webgl2[0];
    const rendersBefore = (c2?.renders.length ?? 0) + (gl?.renders.length ?? 0);

    for (const [value, expected] of [
      ["lttb", { algorithm: "lttb" }],
      ["min-max", { algorithm: "min-max" }],
      ["default", undefined],
    ] as const) {
      decimation.value = value;
      decimation.dispatchEvent(new Event("change"));
      expect(c2?.selections.at(-1)).toEqual(expected);
      expect(gl?.selections.at(-1)).toEqual(expected);
    }
    expect((c2?.renders.length ?? 0) + (gl?.renders.length ?? 0)).toBeGreaterThan(rendersBefore);
    await teardown();
  });

  it("rebuilds both renderers and replaces the three WebGL2 canvases on a scenario change", async () => {
    const { container, created, teardown } = await mounted();
    const scenario = container.querySelector<HTMLSelectElement>('select[aria-label="Scenario"]');
    if (scenario === null) throw new Error("no scenario control");
    const first = created.webgl2[0];
    const firstSurfaces = created.surfaces[0];
    scenario.value = "gapped-trace";
    scenario.dispatchEvent(new Event("change"));

    expect(first?.disposeCalls).toBe(1);
    expect(created.webgl2).toHaveLength(2);
    const secondSurfaces = created.surfaces[1];
    expect(secondSurfaces).toBeDefined();
    for (let i = 0; i < 3; i += 1) expect(secondSurfaces?.[i]).not.toBe(firstSurfaces?.[i]);
    expect(container.querySelectorAll("canvas")).toHaveLength(4);
    await teardown();
  });

  it("shows vertex counts per pane from public behaviour", async () => {
    const { container, teardown } = await mounted();
    const scenario = container.querySelector<HTMLSelectElement>('select[aria-label="Scenario"]');
    if (scenario === null) throw new Error("no scenario control");
    scenario.value = "decimation-minmax";
    scenario.dispatchEvent(new Event("change"));
    const counts = Array.from(container.querySelectorAll('[data-role="vertex-count"]')).map((e) => e.textContent ?? "");
    const n = (fixtureAt("decimation-minmax").kind === "payload"
      ? (fixtureAt("decimation-minmax") as Extract<ScenarioFixture, { kind: "payload" }>).payload.sampleCount
      : 0);
    expect(counts[0]).toContain(String(Math.min(n, Math.max(2, Math.ceil(2 * 700)))));
    expect(counts[1]).toContain(String(n));
    await teardown();
  });

  it("shows 'WebGL2 unavailable' in its pane only, leaving Canvas2D working and substituting nothing", async () => {
    const { container, created, teardown } = await mounted({ throwWebGl2: "no context" });
    expect(container.textContent).toContain("WebGL2 unavailable: no context");
    expect(created.canvas2d).toHaveLength(1);
    expect(created.canvas2d[0]?.renders.length).toBeGreaterThan(0);
    expect(created.webgl2).toHaveLength(0);
    await teardown();
  });

  it("tears down: disposes both renderers once, removes the root and every listener", async () => {
    const { container, created, controller, teardown } = await mounted();
    const scenario = container.querySelector<HTMLSelectElement>('select[aria-label="Scenario"]');
    controller.abort();
    await teardown();
    expect(created.canvas2d.map((r) => r.disposeCalls)).toEqual([1]);
    expect(created.webgl2.map((r) => r.disposeCalls)).toEqual([1]);
    expect(container.childElementCount).toBe(0);
    scenario?.dispatchEvent(new Event("change"));
    expect(created.canvas2d).toHaveLength(1);
  });

  it("stays balanced over ten mount/unmount cycles", async () => {
    const created = newCreated();
    for (let i = 0; i < 10; i += 1) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const controller = new AbortController();
      const teardown = await mountEngineParity(
        { container, panel: new Pane(), signal: controller.signal },
        factories(created),
      );
      controller.abort();
      await teardown();
    }
    expect(created.canvas2d.every((r) => r.disposeCalls === 1)).toBe(true);
    expect(created.webgl2.every((r) => r.disposeCalls === 1)).toBe(true);
    expect(created.canvas2d).toHaveLength(10);
    expect(document.querySelectorAll('[data-role="vertex-count"]')).toHaveLength(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });
});

describe("vertexCount", () => {
  const minmax = fixtureAt("decimation-minmax");
  it("is n on WebGL2 by default and the viewport budget on Canvas2D", () => {
    expect(vertexCount("webgl2", minmax, undefined, 700)).toBe(200_000);
    expect(vertexCount("canvas2d", minmax, undefined, 700)).toBe(1400);
  });

  it("counts lttb as the threshold and min-max as twice the bucket count, bypassing short payloads", () => {
    expect(vertexCount("webgl2", minmax, { algorithm: "lttb", threshold: 500 }, 700)).toBe(500);
    expect(vertexCount("canvas2d", minmax, { algorithm: "min-max", bucketCount: 300 }, 700)).toBe(600);
    expect(vertexCount("webgl2", fixtureAt("simple-trace"), { algorithm: "lttb", threshold: 100_000 }, 700)).toBe(
      vertexCount("webgl2", fixtureAt("simple-trace"), undefined, 700),
    );
  });

  it("sums over the traces of a collection", () => {
    const overlay = fixtureAt("overlay-two-axis");
    if (overlay.kind !== "collection") throw new Error("expected a collection");
    const total = overlay.collection.entries.reduce((sum, entry) => sum + entry.payload.sampleCount, 0);
    expect(vertexCount("webgl2", overlay, undefined, 700)).toBe(total);
  });
});

describe("/engine-parity registration", () => {
  it("registers through registerView at /engine-parity with one import line and no shell edit", async () => {
    await import("../../src/views/index.js");
    const view = resolveView(asRoutePath("/engine-parity"));
    expect(view?.label).toBe("Engine Parity");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const index = readFileSync(path.join(here, "../../src/views/index.ts"), "utf8");
    expect(index.match(/engine-parity/g)?.length).toBe(1);
    for (const shellFile of ["router.ts", "registry.ts", "bootstrap.ts", "view.ts"]) {
      expect(readFileSync(path.join(here, "../../src/shell", shellFile), "utf8")).not.toContain("engine-parity");
    }
  });
});
