import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";

/**
 * Wraps a `Float32Array` in a `Proxy` that counts every numeric-index `get`, so a work-count
 * property can be asserted without the algorithm under test knowing it is instrumented. The
 * `y` channel is the one both algorithms have in common, so it is the channel this file
 * measures for both — `lttb`'s two-reads-per-sample property and `minMaxEnvelope`'s
 * one-read-per-sample property are two distinct claims about the same channel and must not be
 * conflated: applying the exactly-`sampleCount` bound to `lttb`, or the at-most-`2*sampleCount`
 * bound to `minMaxEnvelope`, would fail a correct implementation of the other function.
 */
function countedReads(source: Float32Array): { proxy: Float32Array; count: () => number } {
  let reads = 0;
  const proxy = new Proxy(source, {
    get(target, property, receiver): unknown {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        reads += 1;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return value;
    },
  });
  return { proxy, count: () => reads };
}

describe("read-count", () => {
  it("lttb reads the y channel at most 2 * sampleCount times", () => {
    const sampleCount = 4000;
    const x = new Float32Array(sampleCount);
    const yRaw = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      x[i] = i;
      yRaw[i] = Math.sin(i * 0.02) * 20;
    }
    const { proxy: y, count } = countedReads(yRaw);
    const threshold = 100;
    const out = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(count()).toBeLessThanOrEqual(2 * sampleCount);
    expect(count()).toBeGreaterThan(0);
  });

  it("minMaxEnvelope reads the y channel exactly sampleCount times (one pass, one read per sample)", () => {
    const sampleCount = 4000;
    const yRaw = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      yRaw[i] = Math.cos(i * 0.03) * 15;
    }
    const { proxy: y, count } = countedReads(yRaw);
    const bucketCount = 100;
    const out = new Float32Array(bucketCount * 2);

    minMaxEnvelope(y, 0, sampleCount, out, 0, bucketCount);

    expect(count()).toBe(sampleCount);
  });
});
