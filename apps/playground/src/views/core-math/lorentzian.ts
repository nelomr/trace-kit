/**
 * Deterministic synthetic Lorentzian generator, writing in place into caller-provided
 * buffers. `+ - x /` only for the lineshape — no `Math.exp`/`Math.pow`/`Math.sin`, which are
 * implementation-dependent (ECMA-262) and would break cross-platform determinism. The noise
 * floor uses an integer PRNG (mulberry32-shaped: `imul`, xor, shift, `>>> 0`, division by
 * `2**32`), never the platform random-number function, which is neither deterministic nor seedable.
 *
 * L(x) = (Gamma/2)^2 / ((x - x0)^2 + (Gamma/2)^2), where Gamma is the FWHM and x0 the center.
 */

export interface LorentzianParams {
  /** 32-bit unsigned integer seed for the noise-floor PRNG. */
  readonly seed: number;
  /** Center frequency (x0), in the same units as the generated x-axis. */
  readonly centerFrequency: number;
  /** Full width at half maximum (Gamma). */
  readonly fwhm: number;
  /** Peak amplitude of the additive noise floor. */
  readonly noiseFloor: number;
}

/** Advances a mulberry32-shaped 32-bit state and returns the next uint32 output. */
function nextUint32(state: number): number {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/**
 * Writes `sampleCount` x/y pairs into `xBuffer`/`yBuffer` starting at index 0. Allocates
 * nothing: no object/array literal, no `.subarray`, every value written by index.
 *
 * @returns `sampleCount`, matching the decimation algorithms' own "count written" convention.
 */
export function generateLorentzian(
  xBuffer: Float32Array,
  yBuffer: Float32Array,
  sampleCount: number,
  params: LorentzianParams,
): number {
  const halfWidth = params.fwhm / 2;
  const halfWidthSquared = halfWidth * halfWidth;
  let prngState = params.seed >>> 0;

  for (let i = 0; i < sampleCount; i += 1) {
    const x = i;
    const dx = x - params.centerFrequency;
    const lineshape = halfWidthSquared / (dx * dx + halfWidthSquared);

    prngState = nextUint32(prngState);
    // Map the uint32 output to a signed unit interval [-1, 1) without a transcendental call.
    const noiseUnit = prngState / 4294967296 - 0.5;
    const noise = noiseUnit * 2 * params.noiseFloor;

    xBuffer[i] = x;
    yBuffer[i] = lineshape + noise;
  }

  return sampleCount;
}
