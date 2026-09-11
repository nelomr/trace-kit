import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { arbFloat32Series, arbThreshold } from "../arbitraries.js";

// Subset, strict-monotonicity and endpoint-retention properties, over a random nonzero
// sourceOffset, so the window addressing (not just the [0, sampleCount) special case) is
// exercised. Series lengths and thresholds are drawn independently within the boundary
// preconditions.
describe("lttb — properties", () => {
  it("emits threshold strictly increasing absolute indices covering both window endpoints", () => {
    fc.assert(
      fc.property(
        arbFloat32Series(2, 2000).chain((series) =>
          arbThreshold(series.length).chain((threshold) =>
            fc.integer({ min: 0, max: 500 }).map((sourceOffset) => ({
              series,
              threshold,
              sourceOffset,
            })),
          ),
        ),
        ({ series, threshold, sourceOffset }) => {
          const x = new Float32Array(sourceOffset + series.length);
          const y = new Float32Array(sourceOffset + series.length);
          for (let i = 0; i < series.length; i += 1) {
            x[sourceOffset + i] = i;
            y[sourceOffset + i] = series[i]!;
          }
          const out = new Int32Array(threshold);

          const written = lttb(
            x,
            y,
            sourceOffset,
            series.length,
            out,
            0,
            threshold,
          );

          expect(written).toBe(threshold);
          expect(out[0]).toBe(sourceOffset);
          expect(out[threshold - 1]).toBe(sourceOffset + series.length - 1);

          for (let i = 0; i < threshold; i += 1) {
            const index = out[i]!;
            expect(index).toBeGreaterThanOrEqual(sourceOffset);
            expect(index).toBeLessThan(sourceOffset + series.length);
            if (i > 0) {
              expect(index).toBeGreaterThan(out[i - 1]!);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
