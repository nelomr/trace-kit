import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import minMaxFixture from "./__fixtures__/min-max-gapfree.json" with { type: "json" };
import minMaxIndicesFixture from "./__fixtures__/min-max-indices-gapfree.json" with { type: "json" };

function buildSignal(sampleCount: number): Float32Array {
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    y[i] = Math.sin(i * 0.013) * 100 + Math.sin(i * 0.257) * 10;
  }
  return y;
}

describe("minMaxEnvelope gap-free equivalence", () => {
  it("is unchanged for the committed gap-free fixture", () => {
    const y = buildSignal(minMaxFixture.sampleCount);
    const out = new Float32Array(minMaxFixture.bucketCount * 2);

    minMaxEnvelope(y, 0, minMaxFixture.sampleCount, out, 0, minMaxFixture.bucketCount);

    expect(Array.from(out)).toEqual(minMaxFixture.values);
  });
});

describe("minMaxEnvelopeIndices gap-free equivalence", () => {
  it("is unchanged for the committed gap-free fixture", () => {
    const y = buildSignal(minMaxIndicesFixture.sampleCount);
    const out = new Int32Array(minMaxIndicesFixture.bucketCount * 2);

    minMaxEnvelopeIndices(
      y,
      0,
      minMaxIndicesFixture.sampleCount,
      out,
      0,
      minMaxIndicesFixture.bucketCount,
    );

    expect(Array.from(out)).toEqual(minMaxIndicesFixture.indices);
  });
});

describe("minMaxEnvelope gap awareness", () => {
  it("collapses a mixed bucket (60 real samples + 1 NaN) to NaN/NaN", () => {
    const y = new Float32Array(61);
    for (let i = 0; i < 60; i += 1) y[i] = i + 1;
    y[60] = NaN;
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 61, out, 0, 1);

    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("collapses an all-NaN bucket to NaN/NaN", () => {
    const y = new Float32Array(10).fill(NaN);
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 10, out, 0, 1);

    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("propagates +Infinity unchanged in a gap-free bucket", () => {
    const y = new Float32Array([1, Infinity, 2]);
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 3, out, 0, 1);

    expect(out[0]).toBe(1);
    expect(out[1]).toBe(Infinity);
  });

  it("lets the break take precedence when +Infinity and NaN share a bucket", () => {
    const y = new Float32Array([1, Infinity, NaN]);
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 3, out, 0, 1);

    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("reads each sample exactly once even with gaps present", () => {
    const sampleCount = 200;
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i % 7 === 0 ? NaN : i;
    const out = new Float32Array(20);

    let reads = 0;
    const handler: ProxyHandler<Float32Array> = {
      get(target, prop, receiver): unknown {
        if (typeof prop === "string" && /^\d+$/.test(prop)) reads += 1;
        return Reflect.get(target, prop, receiver);
      },
    };
    const trackingY = new Proxy(y, handler);

    minMaxEnvelope(trackingY, 0, sampleCount, out, 0, 10);

    expect(reads).toBe(sampleCount);
  });

  it("never silently absorbs a gap into a bucket's envelope (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.float({ min: -1000, max: 1000, noNaN: true }), { nil: NaN }), {
          minLength: 20,
          maxLength: 200,
        }),
        fc.integer({ min: 1, max: 10 }),
        (values, bucketCount) => {
          const sampleCount = values.length;
          const bc = Math.min(bucketCount, sampleCount);
          if (bc < 1) return;
          const y = new Float32Array(values);
          const out = new Float32Array(bc * 2);
          minMaxEnvelope(y, 0, sampleCount, out, 0, bc);

          for (let bucket = 0; bucket < bc; bucket += 1) {
            const start = ((bucket * sampleCount) / bc) | 0;
            const end = (((bucket + 1) * sampleCount) / bc) | 0;
            let sawGap = false;
            for (let i = start; i < end; i += 1) {
              if (Number.isNaN(y[i])) sawGap = true;
            }
            if (sawGap) {
              expect(Number.isNaN(out[bucket * 2])).toBe(true);
              expect(Number.isNaN(out[bucket * 2 + 1])).toBe(true);
            }
          }
        },
      ),
    );
  });
});

describe("minMaxEnvelopeIndices gap awareness", () => {
  it("emits [-1, -1] for an all-NaN bucket, not [start, start]", () => {
    const y = new Float32Array(10).fill(NaN);
    const out = new Int32Array(2);

    minMaxEnvelopeIndices(y, 0, 10, out, 0, 1);

    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(-1);
  });

  it("emits [-1, -1] for a mixed bucket", () => {
    const y = new Float32Array(61);
    for (let i = 0; i < 60; i += 1) y[i] = i + 1;
    y[60] = NaN;
    const out = new Int32Array(2);

    minMaxEnvelopeIndices(y, 0, 61, out, 0, 1);

    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(-1);
  });

  it("leaves gap-free buckets unchanged", () => {
    const y = new Float32Array([3, 1, 2]);
    const out = new Int32Array(2);

    minMaxEnvelopeIndices(y, 0, 3, out, 0, 1);

    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
  });
});
