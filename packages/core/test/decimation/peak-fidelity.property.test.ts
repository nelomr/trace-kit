import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { arbLorentzianPeak } from "../arbitraries.js";

// Decimation must physics-preserve critical peaks rather than discard them. A randomised
// Lorentzian peak's half-maximum window must be covered by at least one emitted bucket's
// [min, max] range, for every generated case. Verified falsifiable against a naive
// uniform-stride stand-in before being pointed at the real `minMaxEnvelope`.
describe("minMaxEnvelope — peak fidelity", () => {
  it("preserves a randomised Lorentzian peak's half-maximum window", () => {
    fc.assert(
      fc.property(arbLorentzianPeak(), ({ series, halfMax }) => {
        const bucketCount = Math.max(1, Math.min(64, series.length));
        const out = new Float32Array(bucketCount * 2);
        minMaxEnvelope(series, 0, series.length, out, 0, bucketCount);

        let peakCovered = false;
        for (let bucket = 0; bucket < bucketCount; bucket += 1) {
          const max = out[bucket * 2 + 1]!;
          if (!Number.isNaN(max) && max >= halfMax) {
            peakCovered = true;
            break;
          }
        }
        expect(peakCovered).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// Same physics-preserving requirement, for lttb's index selection: at least one selected
// index's Y sample must reach the peak's half-maximum, for every generated case.
describe("lttb — peak fidelity", () => {
  it("preserves a randomised Lorentzian peak's half-maximum window", () => {
    fc.assert(
      fc.property(arbLorentzianPeak(), ({ series, halfMax }) => {
        const threshold = Math.max(2, Math.min(64, series.length));
        const x = new Float32Array(series.length);
        for (let i = 0; i < x.length; i += 1) x[i] = i;
        const out = new Int32Array(threshold);
        lttb(x, series, 0, series.length, out, 0, threshold);

        let peakCovered = false;
        for (let i = 0; i < threshold; i += 1) {
          const sampleIndex = out[i]!;
          const value = series[sampleIndex]!;
          if (!Number.isNaN(value) && value >= halfMax) {
            peakCovered = true;
            break;
          }
        }
        expect(peakCovered).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
