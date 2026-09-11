import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";

describe("lttb", () => {
  it("writes exactly threshold absolute indices into the caller's buffer and returns threshold", () => {
    const sourceOffset = 1000;
    const sampleCount = 5000;
    const x = new Float32Array(sourceOffset + sampleCount);
    const y = new Float32Array(sourceOffset + sampleCount);
    for (let i = 0; i < x.length; i += 1) {
      x[i] = i;
      y[i] = Math.sin(i * 0.01) * 100;
    }
    const out = new Int32Array(64);
    out.fill(-1);

    const written = lttb(x, y, sourceOffset, sampleCount, out, 0, 64);

    expect(written).toBe(64);
    for (let i = 0; i < 64; i += 1) {
      const index = out[i]!;
      expect(index).toBeGreaterThanOrEqual(1000);
      expect(index).toBeLessThan(6000);
    }
  });

  it("throws RangeError before writing when threshold < 2", () => {
    const x = new Float32Array(100);
    const y = new Float32Array(100);
    const out = new Int32Array(10);
    out.fill(-1);

    expect(() => lttb(x, y, 0, 100, out, 0, 1)).toThrow(RangeError);
    expect(out[0]).toBe(-1);
  });

  it("throws RangeError before writing when threshold > sampleCount", () => {
    const x = new Float32Array(100);
    const y = new Float32Array(100);
    const out = new Int32Array(200);
    out.fill(-1);

    expect(() => lttb(x, y, 0, 100, out, 0, 101)).toThrow(RangeError);
    expect(out[0]).toBe(-1);
  });

  it("writes only the two endpoints, with no interior-bucket division, when threshold === 2", () => {
    const sourceOffset = 10;
    const sampleCount = 500;
    const x = new Float32Array(sourceOffset + sampleCount);
    const y = new Float32Array(sourceOffset + sampleCount);
    for (let i = 0; i < y.length; i += 1) y[i] = i;
    const out = new Int32Array(2);

    const written = lttb(x, y, sourceOffset, sampleCount, out, 0, 2);

    expect(written).toBe(2);
    expect(out[0]).toBe(sourceOffset);
    expect(out[1]).toBe(sourceOffset + sampleCount - 1);
  });

  it("produces element-wise identical Int32Array output across repeated runs", () => {
    const sampleCount = 3000;
    const x = new Float32Array(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      x[i] = i;
      y[i] = Math.cos(i * 0.02) * 40;
    }
    const outA = new Int32Array(50);
    const outB = new Int32Array(50);

    lttb(x, y, 0, sampleCount, outA, 0, 50);
    lttb(x, y, 0, sampleCount, outB, 0, 50);

    expect(outA).toEqual(outB);
  });
});
