/**
 * Throwaway plotting routine, scoped to the `/core-math` view only.
 *
 * This is NOT a prototype of a `FigureRenderer` and declares no `FigureRenderer`- or
 * `ViewportTransform`-shaped export. It exists to put a line on a canvas for one sandbox view
 * and will be deleted wholesale (`rm -rf apps/playground/src/throwaway-plot/`) once a real
 * Canvas2D renderer package exists — at which point the `/core-math` view switches to that
 * package instead. Nothing outside this directory implements any part of this routine, and
 * ESLint's `no-restricted-imports` rule enforces that only `views/core-math/**` may import
 * from here.
 */

export * from "./geometry.js";
export * from "./draw.js";
