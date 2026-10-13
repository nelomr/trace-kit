/**
 * Float64 to hi/lo float32 split for the X origin.
 *
 * A float32 holds 24 significant bits, so an X domain minimum near 1000 can only be represented
 * to about 6e-5. Zoomed to a 0.01-wide window across 1000 device pixels that error is a visible
 * jump of several pixels. The origin is therefore split in Float64 into `hi = fround(d)` and the
 * residual `lo = fround(d - hi)`; the vertex shader computes `((offset - hi) - lo)`, where each
 * subtraction is between nearby numbers and is exact or nearly so, and the sub-pixel part of the
 * origin survives in `lo`.
 */

/** `log10(2)`, the factor that turns the `log2` GLSL provides into the base-10 logarithm the
 * shared viewport transform uses. Kept here so the shader literal and the CPU reference share
 * one definition. */
export const LOG10_2 = 0.3010299956639812;

/**
 * Writes `hi` at `out[index]` and `lo` at `out[index + 1]`. The residual is computed in Float64
 * and rounded to float32 by the typed-array store, which rounds exactly like `Math.fround`.
 */
export function splitFloat64ToHiLo(value: number, out: Float32Array, index: number): void {
  const hi = Math.fround(value);
  out[index] = hi;
  out[index + 1] = value - hi;
}
