import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import fixture from "./__fixtures__/lttb-gapfree.json" with { type: "json" };

function buildSignal(sampleCount: number): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    x[i] = i;
    y[i] = Math.sin(i * 0.013) * 100 + Math.sin(i * 0.257) * 10;
  }
  return { x, y };
}

describe("lttb gap-free golden", () => {
  it("is bit-identical to the pre-change implementation's committed output", () => {
    const { x, y } = buildSignal(fixture.sampleCount);
    const out = new Int32Array(fixture.threshold);

    const written = lttb(x, y, 0, fixture.sampleCount, out, 0, fixture.threshold);

    expect(written).toBe(fixture.threshold);
    expect(Array.from(out)).toEqual(fixture.indices);
  });
});
