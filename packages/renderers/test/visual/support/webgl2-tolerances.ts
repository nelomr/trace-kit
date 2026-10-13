/**
 * Every numeric tolerance the WebGL2 pixel suites use, declared once. The WebGL2 screenshot
 * comparison has its own, slightly looser ratio than the Canvas2D one because the shader's
 * coverage-based edges and a software rasterizer differ from Canvas2D's analytic anti-aliasing by a
 * few pixels along every stroke. The structural cross-engine check compares ink extents per column
 * rather than pixels, so it needs row and column tolerances instead.
 */

/** Passed to `toMatchScreenshot` for the WebGL2 goldens. A 4 device-pixel shift of a trace moves
 * about 0.5 % of the pixels, so `0.002` still fails a perturbed render. */
export const WEBGL2_SCREENSHOT_TOLERANCE = {
  threshold: 0.1,
  allowedMismatchedPixelRatio: 0.002,
} as const;

/** Device pixels trimmed off every side of the plot rectangle before ink is measured, so the
 * border and the clipped ends of strokes do not enter the comparison. */
export const K_INSET = 3;

/** Largest allowed difference, in rows, between the two engines' first and last ink row of a column. */
export const K_ROWS = 2;

/** Fraction of the columns with ink on either engine that must agree within `K_ROWS`. */
export const P_COLUMNS = 0.95;

/** Largest fraction of inked columns where exactly one engine has ink. */
export const P_MISSING = 0.02;

/** Largest allowed luminance difference (0-255, Rec. 709 weights) for a pixel outside the plot when
 * the axes and labels of the two engines are compared. Both engines run the same painters on the
 * same layout, so glyph geometry is identical; what differs is the sub-pixel treatment. Canvas2D's
 * opaque context lets Chromium use LCD text anti-aliasing (coloured fringes) while the transparent
 * overlay can only use grayscale. Measured on Linux Chromium: aligned layers differ by at most 34.5
 * in luminance, while any 1-device-pixel shift produces differences above 125 on about two thousand
 * pixels, so `48` separates the two with margin. */
export const AXIS_LUMA_DELTA = 48;

/** Smallest per-channel distance (0-255) from the background and grid colour that counts as ink. */
export const INK_DELTA = 32;
