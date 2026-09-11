import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { arbBucketCount, arbFloat32Series } from "../arbitraries.js";

// Verifies per-bucket bounding correctness and a deterministic single-pass work count. Series
// lengths deliberately include values NOT divisible by `bucketCount` — the only input class
// that catches an integer-division bucket partition dropping trailing samples, which is why
// this is a property test and not a unit test.
describe("minMaxEnvelope — properties", () => {
  it("bounds every sample in its bucket, for random non-divisible lengths", () => {
    fc.assert(
      fc.property(
        arbFloat32Series(1, 5000).chain((series) =>
          arbBucketCount(series.length).map(
            (bucketCount) => ({ series, bucketCount }),
          ),
        ),
        ({ series, bucketCount }) => {
          const out = new Float32Array(bucketCount * 2);
          minMaxEnvelope(series, 0, series.length, out, 0, bucketCount);

          for (let bucket = 0; bucket < bucketCount; bucket += 1) {
            const start =
              (((bucket * series.length) / bucketCount) | 0) + 0;
            const end =
              (((bucket + 1) * series.length) / bucketCount) | 0;
            const min = out[bucket * 2]!;
            const max = out[bucket * 2 + 1]!;
            for (let i = start; i < end; i += 1) {
              const sample = series[i]!;
              if (!Number.isNaN(sample)) {
                expect(sample).toBeGreaterThanOrEqual(min);
                expect(sample).toBeLessThanOrEqual(max);
              }
            }
          }
        },
      ),
    );
  });

  it("writes exactly bucketCount * 2 values regardless of input size", () => {
    fc.assert(
      fc.property(
        arbFloat32Series(1, 5000),
        (series) => {
          const bucketCount = Math.max(1, Math.min(512, series.length));
          const out = new Float32Array(bucketCount * 2);
          const written = minMaxEnvelope(
            series,
            0,
            series.length,
            out,
            0,
            bucketCount,
          );
          expect(written).toBe(bucketCount * 2);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("never writes outside [outputOffset, outputOffset + bucketCount * 2)", () => {
    fc.assert(
      fc.property(
        arbFloat32Series(1, 2000).chain((series) =>
          arbBucketCount(series.length).map(
            (bucketCount) => ({ series, bucketCount }),
          ),
        ),
        ({ series, bucketCount }) => {
          const outputOffset = 10;
          const out = new Float32Array(outputOffset + bucketCount * 2 + 10);
          out.fill(-12345);

          minMaxEnvelope(series, 0, series.length, out, outputOffset, bucketCount);

          for (let i = 0; i < outputOffset; i += 1) {
            expect(out[i]).toBe(-12345);
          }
          for (
            let i = outputOffset + bucketCount * 2;
            i < out.length;
            i += 1
          ) {
            expect(out[i]).toBe(-12345);
          }
        },
      ),
    );
  });
});
