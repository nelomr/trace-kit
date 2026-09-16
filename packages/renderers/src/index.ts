// Public surface of `@trace-kit/renderers`: headless Canvas2D (and later WebGL2) figure
// renderers that draw from a `Canvas2DSurface`/`FigureRenderer` contract without ever assuming
// a specific DOM host. Populated incrementally by later phases.

export type { Canvas2DSurface, SurfaceKind, TraceDrawingContext } from "./surface.js";
export { acquire2dContext } from "./surface.js";

export type { FigureRenderer, FigureRendererKind } from "./figure-renderer.js";

export type { PolylineSink } from "./path/polyline-sink.js";
export { buildTracePath } from "./path/build-trace-path.js";

export type { FigureStyle, AxisLayout } from "./style.js";
export { DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT } from "./style.js";

export type { Canvas2DRendererOptions } from "./canvas2d/canvas2d-renderer.js";
export { Canvas2DRenderer } from "./canvas2d/canvas2d-renderer.js";
