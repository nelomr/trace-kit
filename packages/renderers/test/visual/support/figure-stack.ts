/**
 * Browser-side helpers shared by the WebGL2 visual suites: the stacked-canvas container a
 * `WebGL2FigureRenderer` draws into, a Canvas2D counterpart, and the one place a fixture is
 * applied to a renderer. Tests (not the renderer) create and position the canvases, because the
 * renderer is handed its surfaces and owns no DOM.
 */
import type { ScenarioFixture } from "../../../src/fixtures/scenarios.js";
import { Canvas2DRenderer } from "../../../src/canvas2d/canvas2d-renderer.js";
import { WebGL2FigureRenderer } from "../../../src/webgl2/webgl2-figure-renderer.js";

export interface FigureStack {
  readonly container: HTMLDivElement;
  readonly underlay: HTMLCanvasElement;
  readonly plot: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  remove(): void;
}

function sizedCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  return canvas;
}

/** A relatively positioned box holding the three canvases, underlay first so it paints below. */
export function createFigureStack(width: number, height: number): FigureStack {
  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  const underlay = sizedCanvas(width, height);
  const plot = sizedCanvas(width, height);
  const overlay = sizedCanvas(width, height);
  container.append(underlay, plot, overlay);
  document.body.appendChild(container);
  return { container, underlay, plot, overlay, remove: () => container.remove() };
}

type RendererLike = Canvas2DRenderer | WebGL2FigureRenderer;

/** Applies a shared fixture the way every engine's consumer does: data or traces, then size. */
export function applyFixture(renderer: RendererLike, fixture: ScenarioFixture): void {
  if (fixture.kind === "payload") {
    renderer.setData(fixture.payload);
    renderer.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
  } else {
    renderer.setTraces(fixture.collection);
  }
  renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
}

export interface WebGl2Figure {
  readonly stack: FigureStack;
  readonly renderer: WebGL2FigureRenderer;
  dispose(): void;
}

export function mountWebGl2(fixture: ScenarioFixture): WebGl2Figure {
  const stack = createFigureStack(fixture.viewport.width, fixture.viewport.height);
  const renderer = new WebGL2FigureRenderer({
    surfaces: { underlay: stack.underlay, plot: stack.plot, overlay: stack.overlay },
    ...(fixture.yAxes === undefined ? {} : { yAxes: fixture.yAxes }),
  });
  applyFixture(renderer, fixture);
  return {
    stack,
    renderer,
    dispose: () => {
      renderer.dispose();
      stack.remove();
    },
  };
}

export interface Canvas2dFigure {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Canvas2DRenderer;
  dispose(): void;
}

export function mountCanvas2d(fixture: ScenarioFixture): Canvas2dFigure {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${fixture.viewport.width}px`;
  canvas.style.height = `${fixture.viewport.height}px`;
  document.body.appendChild(canvas);
  const renderer = new Canvas2DRenderer(
    fixture.yAxes === undefined ? { surface: canvas } : { surface: canvas, yAxes: fixture.yAxes },
  );
  applyFixture(renderer, fixture);
  return {
    canvas,
    renderer,
    dispose: () => {
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** Reads a 2D canvas back as pixels. */
export function readPixels(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("readPixels: the canvas has no 2d context");
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Composes the three layers of a WebGL2 figure into one scratch 2D canvas and reads it back. The
 * `drawImage` of the plot canvas must happen in the same task as `render()`, before the browser
 * presents and clears the drawing buffer, which is why this takes the renderer's `render` thunk.
 */
export function composeWebGl2(figure: WebGl2Figure, render: () => void): ImageData {
  const { underlay, plot, overlay } = figure.stack;
  const scratch = document.createElement("canvas");
  scratch.width = underlay.width;
  scratch.height = underlay.height;
  const context = scratch.getContext("2d");
  if (context === null) throw new Error("composeWebGl2: no 2d context for the scratch canvas");
  render();
  context.drawImage(underlay, 0, 0);
  context.drawImage(plot, 0, 0);
  context.drawImage(overlay, 0, 0);
  return context.getImageData(0, 0, scratch.width, scratch.height);
}
