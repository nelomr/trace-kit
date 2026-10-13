/**
 * CPU reference of the vertex shader's float classifiers. GLSL ES 3.00 does not guarantee
 * the built-in NaN test or IEEE infinities behave on every GPU, so the shader classifies a sample from its bit
 * pattern (`floatBitsToUint`). These functions apply the same masks to a `Uint32` view of the
 * float, which lets the test suite pin the classification on nine IEEE patterns without a GPU.
 * Operands are unsigned 32-bit words; callers read them from a `Uint32Array` sharing a buffer
 * with the `Float32Array` under test.
 */

/** Exponent field: all ones for NaN and infinity. */
export const FLOAT32_EXPONENT_MASK = 0x7f800000;
/** Mantissa field: non-zero distinguishes NaN from infinity. */
export const FLOAT32_MANTISSA_MASK = 0x007fffff;
/** Everything but the sign bit, so +Infinity and -Infinity compare equal to one pattern. */
export const FLOAT32_ABS_MASK = 0x7fffffff;

/** True for every NaN (quiet, signalling, either sign): the pen-up gap marker. */
export function isFloat32GapBits(bits: number): boolean {
  return (bits & FLOAT32_EXPONENT_MASK) === FLOAT32_EXPONENT_MASK && (bits & FLOAT32_MANTISSA_MASK) !== 0;
}

/** True for +Infinity and -Infinity only. */
export function isFloat32InfinityBits(bits: number): boolean {
  return (bits & FLOAT32_ABS_MASK) === FLOAT32_EXPONENT_MASK;
}
