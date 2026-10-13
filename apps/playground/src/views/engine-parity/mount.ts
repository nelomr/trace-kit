import type { DecimationSelection } from "@trace-kit/core";
import { Canvas2DRenderer, type FigureRenderer } from "@trace-kit/renderers";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { WebGL2FigureRenderer, type WebGL2FigureSurfaces } from "@trace-kit/renderers/webgl2";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";
import { vertexCount } from "./vertex-count.js";

/** How the view builds each engine's renderer. Tests inject fakes; the defaults build real ones. */
export interface EngineFactories {
  createCanvas2D(canvas: HTMLCanvasElement, fixture: ScenarioFixture): FigureRenderer;
  createWebGL2(surfaces: WebGL2FigureSurfaces, fixture: ScenarioFixture): FigureRenderer;
}

export const DEFAULT_FACTORIES: EngineFactories = {
  createCanvas2D: (canvas, fixture) =>
    new Canvas2DRenderer(
      fixture.yAxes === undefined ? { surface: canvas } : { surface: canvas, yAxes: fixture.yAxes },
    ),
  createWebGL2: (surfaces, fixture) =>
    new WebGL2FigureRenderer(
      fixture.yAxes === undefined ? { surfaces } : { surfaces, yAxes: fixture.yAxes },
    ),
};

type DecimationChoice = "default" | "lttb" | "min-max";

const SELECTIONS: Record<DecimationChoice, DecimationSelection | undefined> = {
  default: undefined,
  lttb: { algorithm: "lttb" },
  "min-max": { algorithm: "min-max" },
};

function applyFixture(renderer: FigureRenderer, fixture: ScenarioFixture): void {
  if (fixture.kind === "payload") {
    renderer.setData(fixture.payload);
    renderer.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
  } else {
    renderer.setTraces(fixture.collection);
  }
  renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
}

function sizedCanvas(fixture: ScenarioFixture, stacked: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${fixture.viewport.width}px`;
  canvas.style.height = `${fixture.viewport.height}px`;
  if (stacked) canvas.style.cssText += ";position:absolute;left:0;top:0";
  return canvas;
}

function pane(title: string): { root: HTMLDivElement; body: HTMLDivElement; count: HTMLDivElement } {
  const root = document.createElement("div");
  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.fontWeight = "600";
  const body = document.createElement("div");
  const count = document.createElement("div");
  count.setAttribute("data-role", "vertex-count");
  root.append(heading, body, count);
  return { root, body, count };
}

/**
 * The `/engine-parity` view: one shared fixture drawn by Canvas2D (one canvas) and WebGL2 (three
 * stacked canvases) side by side, with each engine's vertex count. WebGL2 construction happens here,
 * in a `try/catch`, so a host without WebGL2 shows a message in that pane while Canvas2D keeps
 * working and nothing substitutes. Fixtures are module constants and are never wrapped in a
 * reactive proxy.
 *
 * A canvas that produced a 2d context can never yield WebGL2, and a disposed WebGL2 plot canvas has
 * lost its context, so a scenario change disposes the WebGL2 renderer and replaces all three of its
 * canvases rather than reusing any of them.
 */
export async function mountEngineParity(host: ViewHost, factories: EngineFactories): Promise<ViewTeardown> {
  const { signal } = host;
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;gap:1rem;padding:1rem;font-family:system-ui,sans-serif";

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;align-items:center";
  const scenarioSelect = document.createElement("select");
  scenarioSelect.setAttribute("aria-label", "Scenario");
  for (const fixture of SCENARIO_FIXTURES) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = `${fixture.id} - ${fixture.description}`;
    scenarioSelect.appendChild(option);
  }
  const decimationSelect = document.createElement("select");
  decimationSelect.setAttribute("aria-label", "Decimation");
  for (const [value, label] of [
    ["default", "Default"],
    ["lttb", "LTTB"],
    ["min-max", "Min-Max"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    decimationSelect.appendChild(option);
  }
  controls.append(scenarioSelect, decimationSelect);

  const panes = document.createElement("div");
  panes.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start";
  const c2 = pane("Canvas2D");
  const gl = pane("WebGL2");
  panes.append(c2.root, gl.root);
  root.append(controls, panes);
  host.container.appendChild(root);

  let disposed = false;
  let canvas2d: FigureRenderer | null = null;
  let webgl2: FigureRenderer | null = null;

  function currentFixture(): ScenarioFixture {
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === scenarioSelect.value) ?? SCENARIO_FIXTURES[0];
    if (fixture === undefined) throw new Error("the fixture corpus is empty");
    return fixture;
  }

  function currentSelection(): DecimationSelection | undefined {
    return SELECTIONS[decimationSelect.value as DecimationChoice];
  }

  function updateCounts(fixture: ScenarioFixture): void {
    const selection = currentSelection();
    c2.count.textContent =
      canvas2d === null
        ? ""
        : `Vertices: ${vertexCount("canvas2d", fixture, selection, canvas2d.transform.plotWidth)}`;
    gl.count.textContent =
      webgl2 === null ? "" : `Vertices: ${vertexCount("webgl2", fixture, selection, webgl2.transform.plotWidth)}`;
  }

  /** Rebuilds both renderers for the current scenario. */
  function rebuild(): void {
    const fixture = currentFixture();
    canvas2d?.dispose();
    webgl2?.dispose();
    canvas2d = null;
    webgl2 = null;
    c2.body.replaceChildren();
    gl.body.replaceChildren();

    const canvas = sizedCanvas(fixture, false);
    c2.body.appendChild(canvas);
    canvas2d = factories.createCanvas2D(canvas, fixture);

    const box = document.createElement("div");
    box.style.cssText = `position:relative;width:${fixture.viewport.width}px;height:${fixture.viewport.height}px`;
    const surfaces: WebGL2FigureSurfaces = {
      underlay: sizedCanvas(fixture, true),
      plot: sizedCanvas(fixture, true),
      overlay: sizedCanvas(fixture, true),
    };
    box.append(surfaces.underlay as HTMLCanvasElement, surfaces.plot as HTMLCanvasElement, surfaces.overlay as HTMLCanvasElement);
    gl.body.appendChild(box);
    try {
      webgl2 = factories.createWebGL2(surfaces, fixture);
    } catch (error) {
      gl.body.replaceChildren();
      gl.body.textContent = `WebGL2 unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
    applyDecimationAndRender(fixture);
  }

  function applyDecimationAndRender(fixture: ScenarioFixture): void {
    const selection = currentSelection();
    for (const renderer of [canvas2d, webgl2]) {
      if (renderer === null) continue;
      applyFixture(renderer, fixture);
      renderer.setDecimation(selection);
      renderer.render();
    }
    updateCounts(fixture);
  }

  function onDecimationChange(): void {
    const selection = currentSelection();
    for (const renderer of [canvas2d, webgl2]) {
      if (renderer === null) continue;
      renderer.setDecimation(selection);
      renderer.render();
    }
    updateCounts(currentFixture());
  }

  // The face must be registered before the first render, or the axis labels are measured with a
  // fallback face.
  await ensureDefaultFont();
  if (!signal.aborted) {
    scenarioSelect.addEventListener("change", rebuild, { signal });
    decimationSelect.addEventListener("change", onDecimationChange, { signal });
    rebuild();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    canvas2d?.dispose();
    webgl2?.dispose();
    canvas2d = null;
    webgl2 = null;
    root.remove();
  };
}

export function mount(host: ViewHost): Promise<ViewTeardown> {
  return mountEngineParity(host, DEFAULT_FACTORIES);
}
