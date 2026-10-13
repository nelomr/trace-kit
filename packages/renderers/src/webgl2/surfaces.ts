/**
 * The three caller-supplied canvases and the contexts acquired from them. The renderer creates no
 * DOM: the caller owns the elements, stacks them in one CSS box (underlay below, plot, overlay
 * above) and hands them in. Splitting the figure over three canvases keeps Canvas2D's paint order
 * (background, grid, trace, axes) with no per-frame GL-to-2D copy, which was measured at 11 to
 * 21 ms and is what rules out drawing the GL output into a 2D canvas.
 *
 * Cold module: runs once, from the renderer constructor.
 */
import type { Canvas2DSurface, TraceDrawingContext } from "../surface.js";
import type { Gl2Context } from "./gl-context.js";

export interface WebGL2FigureSurfaces {
  /** Opaque 2D layer: background and gridlines. Sits below the plot canvas. */
  readonly underlay: Canvas2DSurface;
  /** Transparent WebGL2 layer: traces and markers. A canvas that already produced a `2d`
   * context can never yield `webgl2`, so this one must be fresh. */
  readonly plot: Canvas2DSurface;
  /** Transparent 2D layer: axes, ticks and labels. Sits above the plot canvas. */
  readonly overlay: Canvas2DSurface;
}

/** `TraceDrawingContext` plus the `clearRect` a transparent layer needs between frames. */
export interface OverlayDrawingContext extends TraceDrawingContext {
  clearRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Context attributes for the plot canvas. `alpha` and `premultipliedAlpha` let the page composite
 * the transparent plot over the underlay; `antialias` is off because edges are anti-aliased by
 * coverage in the fragment shader; `failIfMajorPerformanceCaveat` stays false because a software
 * rasterizer counts as a major caveat and `true` would make a CI browser return `null`.
 */
export const GL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = Object.freeze({
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "default",
  failIfMajorPerformanceCaveat: false,
  desynchronized: false,
});

/** Narrows the surface union with `instanceof`, guarded because `OffscreenCanvas` is absent from
 * some hosts. The `false` branch of this predicate leaves `HTMLCanvasElement`. */
function isOffscreenSurface(surface: Canvas2DSurface): surface is OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" && surface instanceof OffscreenCanvas;
}

/** Acquires a transparent 2D context for the overlay. Throws, rather than returning `null`. */
export function acquireOverlayContext(surface: Canvas2DSurface): OverlayDrawingContext {
  const context = isOffscreenSurface(surface)
    ? surface.getContext("2d", { alpha: true })
    : surface.getContext("2d", { alpha: true });
  if (context === null) {
    throw new TypeError(
      "acquireOverlayContext: getContext('2d') returned null for the overlay surface.",
    );
  }
  return context;
}

/** Acquires the WebGL2 context for the plot canvas. Throws, rather than returning `null`. */
export function acquireWebGl2Context(surface: Canvas2DSurface): Gl2Context {
  const context = isOffscreenSurface(surface)
    ? surface.getContext("webgl2", GL_CONTEXT_ATTRIBUTES)
    : surface.getContext("webgl2", GL_CONTEXT_ATTRIBUTES);
  if (context === null) {
    throw new TypeError(
      "acquireWebGl2Context: getContext('webgl2') returned null for the plot surface; a canvas that already produced a 2d context cannot yield webgl2.",
    );
  }
  return context;
}
