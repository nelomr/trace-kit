// A `Canvas2DRenderer` never assumes a specific DOM host: it draws through whichever surface
// the caller hands it, on the main thread or inside a worker. `Canvas2DSurface` is the union of
// the two hosts a 2D context can be acquired from; `TraceDrawingContext` is the narrow
// structural slice of `CanvasRenderingContext2D` the renderer actually calls, so a fixture or a
// mock never needs to implement the full (huge) canvas context interface to satisfy it.

export type Canvas2DSurface = HTMLCanvasElement | OffscreenCanvas;

export type SurfaceKind = "element" | "offscreen";

export interface TraceDrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(path?: Path2D): void;
  fillText(text: string, x: number, y: number): void;
}

/**
 * Acquires a 2D drawing context from either an `HTMLCanvasElement` or an `OffscreenCanvas`,
 * without a worker-transfer step and without any unsafe cast. Throws synchronously — rather
 * than returning `null` — when the host cannot produce a 2D context, so every call site gets a
 * non-nullable `TraceDrawingContext` back.
 */
export function acquire2dContext(surface: Canvas2DSurface): TraceDrawingContext {
  const isOffscreen =
    typeof OffscreenCanvas !== "undefined" && surface instanceof OffscreenCanvas;
  const context = isOffscreen
    ? surface.getContext("2d", { alpha: false })
    : (surface as HTMLCanvasElement).getContext("2d", { alpha: false });
  if (context === null) {
    throw new TypeError(
      "acquire2dContext: getContext('2d') returned null — the host cannot produce a 2D context.",
    );
  }
  return context;
}
