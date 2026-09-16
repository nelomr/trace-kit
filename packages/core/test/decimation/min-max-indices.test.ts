import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";

/** `min-max.ts`'s bucket-close write, pinned so `minMaxEnvelopeIndices` is proven to never have
 * touched the sibling function it was modeled on. */
const PRE_WIDENING_WRITE_LINES = ["    out[writeCursor] = lo;", "    out[writeCursor + 1] = hi;"];

function makeSignal(sampleCount: number): Float32Array {
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    y[i] = Math.sin(i * 0.01) * 100 + ((i * 7919) % 13);
  }
  return y;
}

describe("minMaxEnvelopeIndices", () => {
  it("emits ascending (loIndex, hiIndex) pairs and a monotone non-decreasing full output", () => {
    const sampleCount = 10_000;
    const bucketCount = 50;
    const y = makeSignal(sampleCount);
    const out = new Int32Array(bucketCount * 2);
    const written = minMaxEnvelopeIndices(y, 0, sampleCount, out, 0, bucketCount);
    expect(written).toBe(bucketCount * 2);

    for (let b = 0; b < bucketCount; b += 1) {
      expect(out[2 * b]).toBeLessThanOrEqual(out[2 * b + 1] as number);
    }
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] as number);
    }
  });

  it("emits (argmax, argmin) in ascending order when the max occurs before the min in a bucket", () => {
    const sampleCount = 4;
    const y = new Float32Array([10, -10, 0, 0]); // argmax=0, argmin=1, within one bucket
    const out = new Int32Array(2);
    minMaxEnvelopeIndices(y, 0, sampleCount, out, 0, 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
  });

  it("returns exactly bucketCount * 2 for bucketCount = 500", () => {
    const sampleCount = 100_000;
    const bucketCount = 500;
    const y = makeSignal(sampleCount);
    const out = new Int32Array(bucketCount * 2);
    const written = minMaxEnvelopeIndices(y, 0, sampleCount, out, 0, bucketCount);
    expect(written).toBe(bucketCount * 2);
  });

  it("agrees bucket-for-bucket with minMaxEnvelope's emitted extremes", () => {
    const sampleCount = 10_000;
    const bucketCount = 77;
    const y = makeSignal(sampleCount);
    const valuesOut = new Float32Array(bucketCount * 2);
    minMaxEnvelope(y, 0, sampleCount, valuesOut, 0, bucketCount);
    const indicesOut = new Int32Array(bucketCount * 2);
    minMaxEnvelopeIndices(y, 0, sampleCount, indicesOut, 0, bucketCount);

    for (let b = 0; b < bucketCount; b += 1) {
      const expectedMin = valuesOut[2 * b] as number;
      const expectedMax = valuesOut[2 * b + 1] as number;
      const loIndex = indicesOut[2 * b] as number;
      const hiIndex = indicesOut[2 * b + 1] as number;
      const actual = new Set([y[loIndex], y[hiIndex]]);
      expect(actual.has(expectedMin)).toBe(true);
      expect(actual.has(expectedMax)).toBe(true);
    }
  });

  it("a bucket whose samples are all equal emits the same index for both positions", () => {
    const sampleCount = 8;
    const y = new Float32Array(sampleCount).fill(5);
    const out = new Int32Array(2);
    const written = minMaxEnvelopeIndices(y, 0, sampleCount, out, 0, 1);
    expect(written).toBe(2);
    expect(out[0]).toBe(out[1]);
  });

  it("min-max.ts's bucket-close write order is unchanged", () => {
    // `minMaxEnvelope` is a sibling, never a rewrite: this pins its `lo`-then-`hi` write lines
    // against the pre-widening source so a future edit to that file is caught here, not just by
    // the surrounding behavioral tests.
    const filePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/decimation/min-max.ts",
    );
    const source = readFileSync(filePath, "utf8");
    for (const line of PRE_WIDENING_WRITE_LINES) {
      expect(source).toContain(line);
    }
    expect(typeof minMaxEnvelope).toBe("function");
  });
});
