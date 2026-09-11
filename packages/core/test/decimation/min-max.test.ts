import { describe, expect, it } from "vitest";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";

describe("minMaxEnvelope", () => {
  it("writes into the caller's buffer over the sub-window only, and returns bucketCount * 2", () => {
    const sampleCount = 2048;
    const y = new Float32Array(1024 + sampleCount);
    for (let i = 0; i < y.length; i += 1) {
      y[i] = i;
    }
    const out = new Float32Array(4096);
    out.fill(-999);

    const written = minMaxEnvelope(y, 1024, 2048, out, 512, 256);

    expect(written).toBe(512);
    for (let i = 0; i < 512; i += 1) {
      expect(out[512 + i]).not.toBe(-999);
    }
    for (let i = 0; i < 512; i += 1) {
      expect(out[i]).toBe(-999);
    }
    for (let i = 1024; i < out.length; i += 1) {
      expect(out[i]).toBe(-999);
    }
  });

  it("throws RangeError before writing when bucketCount > sampleCount", () => {
    const y = new Float32Array(100);
    const out = new Float32Array(400);
    out.fill(-1);

    expect(() => minMaxEnvelope(y, 0, 100, out, 0, 200)).toThrow(RangeError);
    expect(out[0]).toBe(-1);
  });

  it("completes with one sample per bucket when bucketCount === sampleCount", () => {
    const sampleCount = 8;
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i * 2;
    const out = new Float32Array(sampleCount * 2);

    const written = minMaxEnvelope(y, 0, sampleCount, out, 0, sampleCount);

    expect(written).toBe(sampleCount * 2);
    for (let i = 0; i < sampleCount; i += 1) {
      expect(out[i * 2]).toBe(y[i]);
      expect(out[i * 2 + 1]).toBe(y[i]);
    }
  });

  it("reports the finite min/max of a bucket with 99 finite samples and 1 NaN", () => {
    const y = new Float32Array(100);
    for (let i = 0; i < 99; i += 1) y[i] = i + 1;
    y[99] = NaN;
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 100, out, 0, 1);

    expect(out[0]).toBe(1);
    expect(out[1]).toBe(99);
  });

  it("reports NaN/NaN for an all-NaN bucket, never Infinity", () => {
    const y = new Float32Array(10).fill(NaN);
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 10, out, 0, 1);

    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("propagates a real +Infinity sample unchanged", () => {
    const y = new Float32Array([Infinity]);
    const out = new Float32Array(2);

    minMaxEnvelope(y, 0, 1, out, 0, 1);

    expect(out[0]).toBe(Infinity);
    expect(out[1]).toBe(Infinity);
  });

  it("produces byte-identical output across repeated runs", () => {
    const sampleCount = 5000;
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      y[i] = Math.sin(i) * 100;
    }
    const outA = new Float32Array(200);
    const outB = new Float32Array(200);

    minMaxEnvelope(y, 0, sampleCount, outA, 0, 100);
    minMaxEnvelope(y, 0, sampleCount, outB, 0, 100);

    expect(outA).toEqual(outB);
  });
});
