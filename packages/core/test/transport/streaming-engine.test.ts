import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";
import {
  StatCounter,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";
import {
  materializeBucketsToPayload,
  materializeTier3ToPayload,
} from "../../src/transport/materialize.js";
import {
  type BucketAccumulator,
  type Tier3ProjectionTarget,
  applyDomainChange,
  createBucketAccumulator,
  createRawSampleRing,
  ingestBatch,
  ingestSample,
  projectTier3,
  rebuildDomain,
} from "../../src/transport/streaming-contract.js";

function logicalSlot(acc: BucketAccumulator, b: number): number {
  let s = b + acc.bucketOrigin;
  if (s >= acc.bucketCount) s -= acc.bucketCount;
  return s;
}

describe("streaming-engine — incremental ingest", () => {
  it("writes samples into RawSampleRing with masked wrap and updates BucketAccumulator in place", () => {
    const ring = createRawSampleRing(256);
    const acc = createBucketAccumulator(10);
    acc.domainMin = 0;
    acc.invBucketWidth = 1; // buckets [0,1), [1,2), ..., [9,10)

    // Ingest 500 samples: wraps 256-slot ring; samples at x >= 10 are out of domain
    const xs = new Float32Array(500);
    const ys = new Float32Array(500);
    for (let i = 0; i < 500; i += 1) {
      xs[i] = i * 0.5;
      ys[i] = Math.sin(i);
    }

    // First 10 via ingestSample, remaining 490 via ingestBatch
    for (let i = 0; i < 10; i += 1) {
      ingestSample(ring, xs[i]!, ys[i]!, acc);
    }
    ingestBatch(ring, xs, ys, 10, 490, acc);

    expect(ring.totalWritten).toBe(500);
    expect(ring.writeIndex).toBe(500 & 255);
    expect(acc.revision).toBe(0);

    // Samples 0..19 had x in [0, 10): each integer bucket got 2 samples (x = b, b + 0.5).
    // Samples 20..499 had x >= 10 (out of domain) and must not have mutated any bucket.
    for (let b = 0; b < 10; b += 1) {
      const y0 = ys[b * 2]!;
      const y1 = ys[b * 2 + 1]!;
      expect(acc.count[b]).toBe(2);
      expect(acc.min[b]).toBe(Math.min(y0, y1));
      expect(acc.max[b]).toBe(Math.max(y0, y1));
    }

    // Verify resident ring contents for the last 256 samples (seq 244..499)
    for (let seq = 244; seq < 500; seq += 1) {
      expect(ring.x[seq & 255]).toBe(xs[seq]);
      expect(ring.y[seq & 255]).toBe(ys[seq]);
    }
  });

  it("handles circular bucketOrigin wrap via conditional subtraction during incremental ingest", () => {
    const ring = createRawSampleRing(64);
    const acc = createBucketAccumulator(7); // non-power-of-two
    acc.domainMin = 10;
    acc.invBucketWidth = 1;
    acc.bucketOrigin = 5;

    ingestSample(ring, 12.2, 3.5, acc); // logical b = 2 -> physical s = (2 + 5) - 7 = 0
    ingestSample(ring, 12.8, -1.25, acc);
    ingestSample(ring, 16.5, 9.0, acc); // logical b = 6 -> physical s = (6 + 5) - 7 = 4

    expect(acc.count[0]).toBe(2);
    expect(acc.min[0]).toBe(-1.25);
    expect(acc.max[0]).toBe(3.5);
    expect(acc.count[4]).toBe(1);
    expect(acc.min[4]).toBe(9.0);
    expect(acc.max[4]).toBe(9.0);
  });

  it("validates ingestBatch bounds before writing", () => {
    const ring = createRawSampleRing(16);
    const xs = new Float32Array(4);
    const ys = new Float32Array(4);
    expect(() => ingestBatch(ring, xs, ys, -1, 2)).toThrow(RangeError);
    expect(() => ingestBatch(ring, xs, ys, 0, -1)).toThrow(RangeError);
    expect(() => ingestBatch(ring, xs, ys, 2, 3)).toThrow(RangeError);
    expect(ring.totalWritten).toBe(0);
  });
});

describe("streaming-engine — NaN gap poisoning (count[s] = -1)", () => {
  it("poisons the bucket stickily on NaN, stores NaN in RawSampleRing.y, and resolves sub-bucket gaps on Tier-2 zoom-in", () => {
    const ring = createRawSampleRing(64);
    const acc = createBucketAccumulator(10);
    acc.domainMin = 0;
    acc.invBucketWidth = 1; // [0, 10)

    ingestSample(ring, 0.2, 1.0, acc);
    ingestSample(ring, 0.5, NaN, acc);
    ingestSample(ring, 0.8, 2.0, acc);
    ingestSample(ring, 2.5, 4.0, acc);

    // Bucket 0 is gap-poisoned stickily (even though 0.8 was finite after NaN)
    expect(acc.count[0]).toBe(-1);
    // Bucket 1 is empty
    expect(acc.count[1]).toBe(0);
    // Bucket 2 is populated
    expect(acc.count[2]).toBe(1);
    expect(acc.min[2]).toBe(4.0);
    expect(acc.max[2]).toBe(4.0);
    // RawSampleRing.y stored NaN faithfully at index 1
    expect(Number.isNaN(ring.y[1])).toBe(true);

    // Zoom in via Tier-2 rebuild over [0, 1) with bucketCount = 10 -> invBucketWidth = 10
    const res = rebuildDomain(acc, ring, 0, 10);
    expect(res).toEqual({ tier: 2, partialHistory: false });
    expect(acc.count[2]).toBe(1);
    expect(acc.min[2]).toBe(1.0);
    expect(acc.max[2]).toBe(1.0);
    expect(acc.count[5]).toBe(-1);
    expect(acc.count[8]).toBe(1);
    expect(acc.min[8]).toBe(2.0);
    expect(acc.max[8]).toBe(2.0);
    for (const emptyBucket of [0, 1, 3, 4, 6, 7, 9]) {
      expect(acc.count[emptyBucket]).toBe(0);
    }
  });

  it("safely ignores NaN ring.x samples during rebuildDomain and Tier-1 applyDomainChange", () => {
    const ring = createRawSampleRing(32);
    // Monotonic finite x values interspersed with NaN x samples (both finite y and NaN y)
    ingestSample(ring, 0.5, 1.0);
    ingestSample(ring, Number.NaN, 99.0);
    ingestSample(ring, 1.5, 2.0);
    ingestSample(ring, 2.5, 3.0);
    ingestSample(ring, Number.NaN, Number.NaN);
    ingestSample(ring, 3.5, 4.0);
    ingestSample(ring, 4.5, 5.0);
    ingestSample(ring, Number.NaN, -50.0);
    ingestSample(ring, 5.5, 6.0);

    const acc = createBucketAccumulator(4);
    const rebuildRes = rebuildDomain(acc, ring, 0, 1);
    expect(rebuildRes).toEqual({ tier: 2, partialHistory: false });
    // Logical buckets [0,1), [1,2), [2,3), [3,4) must reflect only finite-x samples 0.5..3.5
    expect(Array.from(acc.count)).toEqual([1, 1, 1, 1]);
    expect(Array.from(acc.min)).toEqual([1.0, 2.0, 3.0, 4.0]);
    expect(Array.from(acc.max)).toEqual([1.0, 2.0, 3.0, 4.0]);

    // Tier-1 positive aligned shift by +2 -> covers [2, 6), scanning exposed [4, 6) which crosses NaN x at seq 7
    const shiftRes = applyDomainChange(acc, ring, {
      requestedDomainMin: 2,
      requestedInvBucketWidth: 1,
      inGesture: false,
    });
    expect(shiftRes).toEqual({ tier: 1, k: 2, partialHistory: false });

    const expectedYs = [3.0, 4.0, 5.0, 6.0];
    for (let b = 0; b < 4; b += 1) {
      const s = logicalSlot(acc, b);
      expect(acc.count[s]).toBe(1);
      expect(acc.min[s]).toBe(expectedYs[b]);
      expect(acc.max[s]).toBe(expectedYs[b]);
    }
  });
});

describe("streaming-engine — Tier-2 rebuild & partialHistory", () => {
  it("reuses exact preallocated arrays, resets bucketOrigin = 0, and reports partialHistory accurately", () => {
    const ring = createRawSampleRing(64);
    for (let i = 0; i < 128; i += 1) {
      ingestSample(ring, i, Math.sin(i));
    }

    const acc = createBucketAccumulator(16);
    const minRef = acc.min;
    const maxRef = acc.max;
    const countRef = acc.count;
    acc.bucketOrigin = 7;

    // Domain [0, 128) reaches earlier than resident oldest sample (x = 64)
    const partialRes = rebuildDomain(acc, ring, 0, 16 / 128);
    expect(partialRes).toEqual({ tier: 2, partialHistory: true });
    expect(acc.min).toBe(minRef);
    expect(acc.max).toBe(maxRef);
    expect(acc.count).toBe(countRef);
    expect(acc.bucketOrigin).toBe(0);
    expect(acc.coveredFromSeq).toBe(64);
    expect(acc.revision).toBe(1);

    // Buckets 0..7 cover [0, 64) -> must be empty (count === 0)
    for (let b = 0; b < 8; b += 1) {
      expect(acc.count[b]).toBe(0);
    }
    // Buckets 8..15 cover [64, 128) -> populated
    for (let b = 8; b < 16; b += 1) {
      expect(acc.count[b]).toBe(8);
    }

    // Domain [64, 128) is fully within resident history
    const completeRes = rebuildDomain(acc, ring, 64, 16 / 64);
    expect(completeRes).toEqual({ tier: 2, partialHistory: false });
    expect(acc.revision).toBe(2);
    for (let b = 0; b < 16; b += 1) {
      expect(acc.count[b]).toBe(4);
    }
  });
});

describe("streaming-engine — Tier-1 aligned pan matches Tier-2 rebuild bit-for-bit", () => {
  it("property: positive and negative aligned shifts with non-pow2 bucketCount and ring wrap match Tier-2 exactly", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(16, 32, 64, 128),
        fc.integer({ min: 5, max: 35 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: -30, max: 30 }),
        fc.array(
          fc.oneof(
            { weight: 9, arbitrary: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }) },
            { weight: 1, arbitrary: fc.constant(Number.NaN) },
          ),
          { minLength: 200, maxLength: 200 },
        ),
        (ringCapacity, bucketCount, totalSamples, startDomainMin, rawShift, yValues) => {
          const shift =
            rawShift === 0
              ? 1
              : Math.abs(rawShift) >= bucketCount
                ? Math.sign(rawShift) * (bucketCount - 1)
                : rawShift;
          if (shift === 0) return;

          const ring = createRawSampleRing(ringCapacity);
          for (let i = 0; i < totalSamples; i += 1) {
            ingestSample(ring, i * 0.5, yValues[i]!);
          }

          const invBucketWidth = 1; // exact dyadic step = 1.0
          const accTier1 = createBucketAccumulator(bucketCount);
          const accTier2 = createBucketAccumulator(bucketCount);

          rebuildDomain(accTier1, ring, startDomainMin, invBucketWidth);
          const targetDomainMin = startDomainMin + shift;

          const tier1Res = applyDomainChange(accTier1, ring, {
            requestedDomainMin: targetDomainMin,
            requestedInvBucketWidth: invBucketWidth,
            inGesture: false,
          });
          const tier2Res = rebuildDomain(accTier2, ring, targetDomainMin, invBucketWidth);

          expect(tier1Res.tier).toBe(1);
          if (tier1Res.tier === 1) {
            expect(tier1Res.k).toBe(shift);
          }
          expect(tier1Res.partialHistory).toBe(tier2Res.partialHistory);

          for (let b = 0; b < bucketCount; b += 1) {
            const s1 = logicalSlot(accTier1, b);
            const c1 = accTier1.count[s1]!;
            const c2 = accTier2.count[b]!;
            expect(c1).toBe(c2);
            if (c1 > 0) {
              expect(accTier1.min[s1]).toBe(accTier2.min[b]);
              expect(accTier1.max[s1]).toBe(accTier2.max[b]);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("streaming-engine — Tier-3 non-mutating bounding projection", () => {
  it("never mutates accumulator across 0.25x, 1x, 4x, and 16x zoom and panned offsets", () => {
    const ring = createRawSampleRing(256);
    const acc = createBucketAccumulator(32);
    for (let i = 0; i < 200; i += 1) {
      ingestSample(ring, i * 0.5, i === 50 ? NaN : Math.sin(i * 0.2) * 10);
    }
    rebuildDomain(acc, ring, 0, 32 / 100);
    acc.revision = 3;

    const minSnap = Array.from(acc.min);
    const maxSnap = Array.from(acc.max);
    const countSnap = Array.from(acc.count);
    const originSnap = acc.bucketOrigin;
    const domainMinSnap = acc.domainMin;
    const invWidthSnap = acc.invBucketWidth;
    const coveredSnap = acc.coveredFromSeq;

    const target: Tier3ProjectionTarget = {
      min: new Float32Array(64),
      max: new Float32Array(64),
      count: new Int32Array(64),
    };

    for (const zoom of [0.25, 1, 4, 16]) {
      const res = projectTier3(
        acc,
        10,
        (32 / 100) * zoom,
        64,
        target,
        ring,
      );
      expect(res.tier).toBe(3);
    }

    expect(Array.from(acc.min)).toEqual(minSnap);
    expect(Array.from(acc.max)).toEqual(maxSnap);
    expect(Array.from(acc.count)).toEqual(countSnap);
    expect(acc.bucketOrigin).toBe(originSnap);
    expect(acc.domainMin).toBe(domainMinSnap);
    expect(acc.invBucketWidth).toBe(invWidthSnap);
    expect(acc.coveredFromSeq).toBe(coveredSnap);
    expect(acc.revision).toBe(3);
  });

  it("property: bounds every covered finite sample across 0.1x..16x zoom with zero fabrication and gap propagation", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            { weight: 12, arbitrary: fc.float({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }) },
            { weight: 1, arbitrary: fc.constant(Number.NaN) },
          ),
          { minLength: 64, maxLength: 128 },
        ),
        fc.constantFrom(0.1, 0.5, 1, 2, 4, 8, 16),
        fc.integer({ min: -10, max: 30 }),
        (ys, zoomFactor, panOffset) => {
          const ring = createRawSampleRing(256);
          for (let i = 0; i < ys.length; i += 1) {
            ingestSample(ring, i, ys[i]!);
          }

          const srcBuckets = 32;
          const srcInvWidth = 0.25; // covers [0, 128)
          const acc = createBucketAccumulator(srcBuckets);
          rebuildDomain(acc, ring, 0, srcInvWidth);

          const targetBuckets = 32;
          const reqInvWidth = srcInvWidth * zoomFactor;
          const reqDomainMin = panOffset;
          const out: Tier3ProjectionTarget = {
            min: new Float32Array(targetBuckets),
            max: new Float32Array(targetBuckets),
            count: new Int32Array(targetBuckets),
          };

          const res = projectTier3(acc, reqDomainMin, reqInvWidth, targetBuckets, out, ring);
          expect(res.tier).toBe(3);

          // Check every source bucket's overlap with target buckets:
          const ratio = reqInvWidth / srcInvWidth;
          const offset = (acc.domainMin - reqDomainMin) * reqInvWidth;
          for (let b = 0; b < srcBuckets; b += 1) {
            const s = logicalSlot(acc, b);
            const c = acc.count[s]!;
            if (c === 0) continue;
            const uLo = offset + b * ratio;
            const uHi = offset + (b + 1) * ratio;
            const tStart = Math.max(0, Math.floor(uLo));
            const tEnd = Math.min(targetBuckets - 1, Math.max(Math.floor(uLo), Math.ceil(uHi) - 1));
            for (let t = tStart; t <= tEnd; t += 1) {
              if (c < 0) {
                expect(out.count[t]).toBe(-1);
              } else if (out.count[t]! > 0) {
                expect(out.min[t]!).toBeLessThanOrEqual(acc.min[s]!);
                expect(out.max[t]!).toBeGreaterThanOrEqual(acc.max[s]!);
              } else {
                // Only legal non-positive state when a populated bucket overlaps is gap-poisoned (-1)
                expect(out.count[t]).toBe(-1);
              }
            }
          }

          // Check no value is fabricated for target buckets overlapping no non-empty source bucket
          for (let t = 0; t < targetBuckets; t += 1) {
            if (out.count[t]! === 0) continue;
            // Verify at least one non-empty source bucket overlaps target t
            let hadOverlap = false;
            for (let b = 0; b < srcBuckets; b += 1) {
              const s = logicalSlot(acc, b);
              if (acc.count[s] === 0) continue;
              const uLo = offset + b * ratio;
              const uHi = offset + (b + 1) * ratio;
              const tStart = Math.floor(uLo);
              const tEnd = Math.max(tStart, Math.ceil(uHi) - 1);
              if (t >= tStart && t <= tEnd) {
                hadOverlap = true;
                break;
              }
            }
            expect(hadOverlap).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("streaming-engine — xOrigin offset space & telemetry stats", () => {
  it("preserves sub-picometer optical wavelength resolution in xOrigin offset space", () => {
    const xOrigin = 1550.0;
    const ring = createRawSampleRing(64);
    const acc = createBucketAccumulator(10);
    // Bucket b covers [0.00005 + b*0.0001, 0.00005 + (b+1)*0.0001), centering samples 0.0001..0.0009
    acc.domainMin = 0.00005;
    acc.invBucketWidth = 10_000; // 0.0001 nm per bucket

    // 9 samples at 1550.0001..1550.0009 nm stored as f32 offsets 0.0001..0.0009
    for (let i = 1; i <= 9; i += 1) {
      const absWavelength = xOrigin + i * 0.0001;
      const offset = absWavelength - xOrigin;
      ingestSample(ring, offset, -20 + i, acc);
    }

    // Distinct samples 0.0001 nm apart land in 9 distinct buckets without f32 collapse
    let populated = 0;
    for (let b = 0; b < 10; b += 1) {
      if (acc.count[b]! > 0) {
        expect(acc.count[b]).toBe(1);
        populated += 1;
      }
    }
    expect(populated).toBe(9);
  });

  it("increments DomainShifts on Tier-1, DomainRebuilds on Tier-2, and neither on Tier-3", () => {
    const ring = createRawSampleRing(64);
    for (let i = 0; i < 64; i += 1) {
      ingestSample(ring, i, i * 2);
    }
    const acc = createBucketAccumulator(16);
    const stats = createTransportStatsView();

    // 2 Tier-2 rebuilds (one via rebuildDomain, one via applyDomainChange zoom change)
    rebuildDomain(acc, ring, 0, 1, stats);
    applyDomainChange(
      acc,
      ring,
      { requestedDomainMin: 0, requestedInvBucketWidth: 0.5, inGesture: false },
      stats,
    );

    // 3 Tier-1 aligned pans (invBucketWidth = 0.5 => step = 2.0 per bucket)
    applyDomainChange(
      acc,
      ring,
      { requestedDomainMin: 2, requestedInvBucketWidth: 0.5, inGesture: false },
      stats,
    );
    applyDomainChange(
      acc,
      ring,
      { requestedDomainMin: 4, requestedInvBucketWidth: 0.5, inGesture: false },
      stats,
    );
    applyDomainChange(
      acc,
      ring,
      { requestedDomainMin: 2, requestedInvBucketWidth: 0.5, inGesture: false },
      stats,
    );

    // 5 Tier-3 in-gesture calls via applyDomainChange
    for (let i = 0; i < 5; i += 1) {
      const res = applyDomainChange(
        acc,
        ring,
        { requestedDomainMin: 2 + i * 0.3, requestedInvBucketWidth: 0.5, inGesture: true },
        stats,
      );
      expect(res.tier).toBe(3);
    }

    expect(stats.counters[StatCounter.DomainShifts]).toBe(3);
    expect(stats.counters[StatCounter.DomainRebuilds]).toBe(2);
    expect(acc.revision).toBe(5);
  });
});

describe("streaming-engine — materializeBucketsToPayload and materializeTier3ToPayload", () => {
  it("emits (xCenter, min)/(xCenter, max) for populated buckets, (xCenter, NaN) for empty/gap-poisoned buckets, respects circular bucketOrigin, and bumps revision", () => {
    const ring = createRawSampleRing(64);
    const acc = createBucketAccumulator(4);
    acc.domainMin = 10;
    acc.invBucketWidth = 1; // buckets [10,11), [11,12), [12,13), [13,14) -> centers 10.5, 11.5, 12.5, 13.5
    acc.bucketOrigin = 2; // non-zero circular origin

    // Logical bucket 0: populated (min=-2, max=5)
    ingestSample(ring, 10.2, 5.0, acc);
    ingestSample(ring, 10.8, -2.0, acc);
    // Logical bucket 1: empty (count === 0)
    // Logical bucket 2: gap-poisoned (count === -1)
    ingestSample(ring, 12.3, 1.0, acc);
    ingestSample(ring, 12.6, NaN, acc);
    // Logical bucket 3: populated (min=3, max=3)
    ingestSample(ring, 13.4, 3.0, acc);

    const payload = createSpectrumDataPayload({
      capacity: 8,
      xOrigin: 0,
      xUnit: "s",
      yUnit: "V",
    });
    expect(payload.revision).toBe(0);

    const written = materializeBucketsToPayload(acc, payload);
    expect(written).toBe(6); // 2 + 1 + 1 + 2
    expect(payload.sampleCount).toBe(6);
    expect(payload.revision).toBe(1);

    // Bucket 0 -> (10.5, -2), (10.5, 5)
    expect(payload.x[0]).toBe(10.5);
    expect(payload.y[0]).toBe(-2.0);
    expect(payload.x[1]).toBe(10.5);
    expect(payload.y[1]).toBe(5.0);
    // Bucket 1 (empty) -> (11.5, NaN)
    expect(payload.x[2]).toBe(11.5);
    expect(Number.isNaN(payload.y[2])).toBe(true);
    // Bucket 2 (gap-poisoned) -> (12.5, NaN)
    expect(payload.x[3]).toBe(12.5);
    expect(Number.isNaN(payload.y[3])).toBe(true);
    // Bucket 3 -> (13.5, 3), (13.5, 3)
    expect(payload.x[4]).toBe(13.5);
    expect(payload.y[4]).toBe(3.0);
    expect(payload.x[5]).toBe(13.5);
    expect(payload.y[5]).toBe(3.0);
  });

  it("translates ringXOrigin into payload.xOrigin and preserves high-offset xOrigin = 1550.0", () => {
    const ring = createRawSampleRing(32);
    const acc = createBucketAccumulator(2);
    acc.domainMin = 0.0001;
    acc.invBucketWidth = 10_000; // centers at 0.00015 and 0.00025

    ingestSample(ring, 0.00012, -10, acc);
    ingestSample(ring, 0.00022, -20, acc);

    // Case 1: matching xOrigin = 1550.0 (zero delta)
    const payloadSame = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 1550.0,
      xUnit: "nm",
      yUnit: "dBm",
    });
    const n1 = materializeBucketsToPayload(acc, payloadSame, 1550.0);
    expect(n1).toBe(4);
    expect(payloadSame.xOrigin).toBe(1550.0);
    expect(payloadSame.x[0]).toBeCloseTo(0.00015, 7);
    expect(payloadSame.x[2]).toBeCloseTo(0.00025, 7);

    // Case 2: differing ringXOrigin = 1551.0 vs payload.xOrigin = 1550.0 (delta = +1.0)
    const payloadDiff = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 1550.0,
      xUnit: "nm",
      yUnit: "dBm",
    });
    const n2 = materializeBucketsToPayload(acc, payloadDiff, 1551.0);
    expect(n2).toBe(4);
    expect(payloadDiff.x[0]).toBeCloseTo(1.00015, 5);
    expect(payloadDiff.x[2]).toBeCloseTo(1.00025, 5);
  });

  it("materializeTier3ToPayload writes Tier3ProjectionTarget into Retained payload with gap breaks and revision bump", () => {
    const target: Tier3ProjectionTarget = {
      min: new Float32Array([1.0, 0, 0, -4.0]),
      max: new Float32Array([3.0, 0, 0, 2.0]),
      count: new Int32Array([5, 0, -1, 2]),
    };
    const payload = createSpectrumDataPayload({
      capacity: 8,
      xOrigin: 100,
      xUnit: "nm",
      yUnit: "dBm",
    });

    const written = materializeTier3ToPayload(target, 4, 0, 1, payload, 102);
    expect(written).toBe(6);
    expect(payload.sampleCount).toBe(6);
    expect(payload.revision).toBe(1);
    expect(payload.x[0]).toBe(2.5);
    expect(payload.y[0]).toBe(1.0);
    expect(payload.x[1]).toBe(2.5);
    expect(payload.y[1]).toBe(3.0);
    expect(payload.x[2]).toBe(3.5);
    expect(Number.isNaN(payload.y[2])).toBe(true);
    expect(payload.x[3]).toBe(4.5);
    expect(Number.isNaN(payload.y[3])).toBe(true);
    expect(payload.x[4]).toBe(5.5);
    expect(payload.y[4]).toBe(-4.0);
    expect(payload.x[5]).toBe(5.5);
    expect(payload.y[5]).toBe(2.0);
  });

  it("throws RangeError when payload.capacity < bucketCount * 2", () => {
    const acc = createBucketAccumulator(8);
    acc.domainMin = 0;
    acc.invBucketWidth = 1;
    const undersized = createSpectrumDataPayload({
      capacity: 15,
      xOrigin: 0,
      xUnit: "s",
      yUnit: "V",
    });
    expect(() => materializeBucketsToPayload(acc, undersized)).toThrow(RangeError);
    expect(undersized.revision).toBe(0);

    const target: Tier3ProjectionTarget = {
      min: new Float32Array(8),
      max: new Float32Array(8),
      count: new Int32Array(8),
    };
    expect(() => materializeTier3ToPayload(target, 8, 0, 1, undersized)).toThrow(RangeError);
    expect(undersized.revision).toBe(0);
  });
});
