/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  FLOAT32_ABS_MASK,
  FLOAT32_EXPONENT_MASK,
  FLOAT32_MANTISSA_MASK,
  isFloat32GapBits,
  isFloat32InfinityBits,
} from "../../src/webgl2/float-bits.js";

// One shared buffer, so a float written through one view is observed bit for bit through the other.
const floats = new Float32Array(1);
const words = new Uint32Array(floats.buffer);

function bitsOf(value: number): number {
  floats[0] = value;
  return words[0] ?? 0;
}

describe("float-bits classifiers", () => {
  const nan = [
    ["quiet NaN 0x7FC00000", 0x7fc00000],
    ["signalling NaN 0x7F800001", 0x7f800001],
    ["negative NaN 0xFFC00000", 0xffc00000],
  ] as const;
  for (const [label, bits] of nan) {
    it(`${label} is a gap and not an infinity`, () => {
      expect(isFloat32GapBits(bits)).toBe(true);
      expect(isFloat32InfinityBits(bits)).toBe(false);
    });
  }

  const infinities = [
    ["+Infinity 0x7F800000", 0x7f800000],
    ["-Infinity 0xFF800000", 0xff800000],
  ] as const;
  for (const [label, bits] of infinities) {
    it(`${label} is an infinity and not a gap`, () => {
      expect(isFloat32InfinityBits(bits)).toBe(true);
      expect(isFloat32GapBits(bits)).toBe(false);
    });
  }

  const finite = [
    ["zero", 0],
    ["negative zero", 0x80000000],
    ["a subnormal 0x00000001", 0x00000001],
    ["a finite 1.5", bitsOf(1.5)],
  ] as const;
  for (const [label, bits] of finite) {
    it(`${label} is neither a gap nor an infinity`, () => {
      expect(isFloat32GapBits(bits)).toBe(false);
      expect(isFloat32InfinityBits(bits)).toBe(false);
    });
  }

  it("agrees with the engine's own classification of stored floats", () => {
    expect(isFloat32GapBits(bitsOf(NaN))).toBe(true);
    expect(isFloat32InfinityBits(bitsOf(Infinity))).toBe(true);
    expect(isFloat32InfinityBits(bitsOf(-Infinity))).toBe(true);
    expect(isFloat32GapBits(bitsOf(Infinity))).toBe(false);
    expect(isFloat32GapBits(bitsOf(3.4e38))).toBe(false);
  });

  it("exports the masks the shader constants must match", () => {
    expect(FLOAT32_EXPONENT_MASK).toBe(0x7f800000);
    expect(FLOAT32_MANTISSA_MASK).toBe(0x007fffff);
    expect(FLOAT32_ABS_MASK).toBe(0x7fffffff);
  });
});
