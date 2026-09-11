import fc from "fast-check";

// Shared fast-check arbitraries. `fc.float()` — not `fc.double()` — generates
// f32-representable values, so a generated series survives a `Float32Array` round trip
// unchanged and a property failure is never an artifact of narrowing.

export function arbFloat32Series(minLength: number, maxLength: number) {
  return fc
    .array(fc.float({ noNaN: true, noDefaultInfinity: true }), {
      minLength,
      maxLength,
    })
    .map((values) => Float32Array.from(values));
}

export function arbFloat32SeriesWithGaps(minLength: number, maxLength: number) {
  return fc
    .array(
      fc.oneof(
        fc.float({ noNaN: true, noDefaultInfinity: true }),
        fc.constant(NaN),
      ),
      { minLength, maxLength },
    )
    .map((values) => Float32Array.from(values));
}

/** Respects the decimation API's `bucketCount <= sampleCount` precondition. */
export function arbBucketCount(sampleCount: number) {
  return fc.integer({ min: 1, max: Math.max(1, sampleCount) });
}

export function arbThreshold(sampleCount: number) {
  return fc.integer({ min: 2, max: Math.max(2, sampleCount) });
}

export interface LorentzianPeakCase {
  series: Float32Array;
  position: number;
  width: number;
  halfMax: number;
  halfMaxLow: number;
  halfMaxHigh: number;
}

/**
 * A randomised Lorentzian peak superimposed on a noise floor, for the physics-preserving
 * decimation property test (CLAUDE.md rule 6).
 */
export function arbLorentzianPeak(): fc.Arbitrary<LorentzianPeakCase> {
  return fc
    .record({
      sampleCount: fc.integer({ min: 200, max: 2000 }),
      position: fc.float({
        min: Math.fround(0.1),
        max: Math.fround(0.9),
        noNaN: true,
      }),
      width: fc.float({
        min: Math.fround(0.01),
        max: Math.fround(0.1),
        noNaN: true,
      }),
      amplitude: fc.float({
        min: Math.fround(10),
        max: Math.fround(100),
        noNaN: true,
      }),
      noiseFloor: fc.float({
        min: Math.fround(0),
        max: Math.fround(1),
        noNaN: true,
      }),
    })
    .map(({ sampleCount, position, width, amplitude, noiseFloor }) => {
      const series = new Float32Array(sampleCount);
      const centerIndex = position * sampleCount;
      const gamma = Math.max(width * sampleCount, 1);
      for (let i = 0; i < sampleCount; i += 1) {
        const dx = i - centerIndex;
        const lorentzian = amplitude / (1 + (dx / gamma) * (dx / gamma));
        series[i] = noiseFloor + lorentzian;
      }
      const halfMax = noiseFloor + amplitude / 2;
      const halfWidthIndex = gamma;
      const result: LorentzianPeakCase = {
        series,
        position: centerIndex,
        width: gamma,
        halfMax,
        halfMaxLow: Math.max(0, Math.floor(centerIndex - halfWidthIndex)),
        halfMaxHigh: Math.min(
          sampleCount - 1,
          Math.ceil(centerIndex + halfWidthIndex),
        ),
      };
      return result;
    });
}
