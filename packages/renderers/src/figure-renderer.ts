// `FigureRenderer` is the seam a WebGL2 backend satisfies without
// widening this file. No member accepts or returns a Canvas2D-specific type
// (`CanvasRenderingContext2D`, `Path2D`) or a DOM host type (`HTMLCanvasElement`,
// `OffscreenCanvas`) — those stay behind `Canvas2DSurface`/`acquire2dContext` in `surface.ts`,
// never crossing into this contract.
import type {
  DecimationSelection,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
} from "@trace-kit/core";

/** Discriminant in the shape of zrender's `getType()`. */
export type FigureRendererKind = "canvas2d" | "webgl2";

export interface FigureRenderer {
  readonly kind: FigureRendererKind;

  /** `true` once `dispose()` has run. Never returns to `false`. */
  readonly disposed: boolean;

  /**
   * The projection currently in effect. Recomputed by `resize()` and by `setDomain()`, never by
   * `render()`.
   */
  readonly transform: ViewportTransform;

  /**
   * Retains a reference to `payload`. Structural read only: never constructed, never mutated,
   * never placed in a transfer list. Does not draw. Does not copy.
   */
  setData(payload: SpectrumDataPayload): void;

  /**
   * Replaces the whole trace set. Retains `collection` by reference: never copied, never
   * mutated. Resolves per-trace axis binding and rebuilds per-trace transforms/style/memo
   * columns; view X domain is seeded from `collection.xDomainMin`/`xDomainMax`. Does not draw.
   * `setData(payload)` is retained as the single-trace convenience it always was — internally
   * equivalent to a one-entry collection bound to the first registered Y axis.
   */
  setTraces(collection: TraceCollection): void;

  /** Replaces the visible data window. Recomputes `transform`. Does not draw. */
  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void;

  /**
   * Resizes the backing store to `round(width * dpr) x round(height * dpr)` and recomputes
   * `transform`. `width`/`height` are CSS pixels; `dpr` is injected, never read from `window`.
   * Does not draw.
   */
  resize(width: number, height: number, dpr: number): void;

  /** Full repaint of grid, trace and axes. Idempotent for a fixed payload revision + transform. */
  render(): void;

  /** Paints the background over the full backing store. Leaves `transform` untouched. */
  clear(): void;

  /**
   * Replaces the decimation selection. `undefined` restores the default (LTTB at the
   * viewport-derived threshold). Invalidates the decimated result. Does not draw.
   */
  setDecimation(selection: DecimationSelection | undefined): void;

  /** Terminal, idempotent. After it, every method above is a no-op. */
  dispose(): void;
}
