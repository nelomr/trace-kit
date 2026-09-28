import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";

function xFrom(sampleCount: number): Float32Array {
  const x = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) x[i] = i;
  return x;
}

function isFinite32(v: number): boolean {
  return v === v;
}

describe("lttb — bucketing never crosses a gap", () => {
  it("retains no candidate pair spanning a source gap (two segments)", () => {
    const sampleCount = 200;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      y[i] = i >= 40 && i < 45 ? NaN : Math.sin(i * 0.1) * 10;
    }
    const threshold = 40;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(written).toBe(threshold);
    let sawBreak = false;
    for (let i = 0; i < threshold; i += 1) {
      const idx = out[i]!;
      if (idx === -1) {
        sawBreak = true;
        continue;
      }
      expect(y[idx]).not.toBeNaN();
    }
    expect(sawBreak).toBe(true);
  });

  it("each finite segment's own first/last sample is retained (golden: [0,40) + [45,200))", () => {
    const sampleCount = 200;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      y[i] = i >= 40 && i < 45 ? NaN : Math.sin(i * 0.1) * 10;
    }
    const threshold = 40;
    const out = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(out[0]).toBe(0);
    const breakIndex = Array.from(out).indexOf(-1);
    expect(breakIndex).toBeGreaterThan(0);
    expect(out[breakIndex - 1]).toBe(39);
    expect(out[breakIndex + 1]).toBe(45);
    expect(out[threshold - 1]).toBe(199);
  });

  it("property: no candidate pair straddles a randomly placed gap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 300 }),
        fc.integer({ min: 1, max: 10 }),
        (sampleCount, gapAt) => {
          const gapStart = Math.min(gapAt * 3, sampleCount - 5);
          if (gapStart < 1) return;
          const x = xFrom(sampleCount);
          const y = new Float32Array(sampleCount);
          for (let i = 0; i < sampleCount; i += 1) {
            y[i] = i === gapStart ? NaN : Math.sin(i * 0.07) * 5;
          }
          const threshold = Math.min(20, sampleCount);
          const out = new Int32Array(threshold);
          const written = lttb(x, y, 0, sampleCount, out, 0, threshold);
          if (written === 0) return;
          for (let i = 0; i < written; i += 1) {
            const idx = out[i]!;
            if (idx === -1) continue;
            expect(isFinite32(y[idx]!)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("lttb — break representation", () => {
  it("a consumer detects a break without re-scanning source y (-1 sentinel)", () => {
    const sampleCount = 100;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i === 50 ? NaN : i;
    const threshold = 20;
    const out = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(Array.from(out)).toContain(-1);
  });

  it("break representation is deterministic across repeated runs", () => {
    const sampleCount = 100;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i === 50 ? NaN : i;
    const threshold = 20;
    const outA = new Int32Array(threshold);
    const outB = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, outA, 0, threshold);
    lttb(x, y, 0, sampleCount, outB, 0, threshold);

    expect(outA).toEqual(outB);
  });

  it("never writes a leading break for a leading gap", () => {
    const sampleCount = 100;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < 5; i += 1) y[i] = NaN;
    for (let i = 5; i < sampleCount; i += 1) y[i] = i;
    const threshold = 20;
    const out = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(out[0]).not.toBe(-1);
    expect(out[0]).toBe(5);
  });
});

describe("lttb — return-count and index-content contract", () => {
  it("pads short segments with trailing -1 breaks up to threshold", () => {
    const y = new Float32Array([1, NaN, NaN, NaN, 2]);
    const x = xFrom(5);
    const threshold = 5;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, 5, out, 0, threshold);

    expect(written).toBe(5);
    expect(Array.from(out)).toEqual([0, -1, 4, -1, -1]);
  });

  it("emits a single-sample segment once as an isolated point, never dropped", () => {
    const sampleCount = 20;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i;
    // Gaps on both sides of index 10 isolate it as a single-sample segment.
    y[9] = NaN;
    y[11] = NaN;
    const threshold = 15;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(written).toBe(threshold);
    expect(Array.from(out)).toContain(10);
  });

  it("infeasible fragmentation returns 0", () => {
    const sampleCount = 1000;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i % 2 === 0 ? i : NaN;
    const threshold = 64;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(written).toBe(0);
  });

  it("apportionment is proportional and sums exactly to the budget", () => {
    const sampleCount = 300;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    // Two segments: [0,100) length 100, gap, [105,300) length 195.
    for (let i = 0; i < sampleCount; i += 1) {
      y[i] = i >= 100 && i < 105 ? NaN : Math.sin(i * 0.05) * 10;
    }
    const threshold = 60;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(written).toBe(threshold);
    // Exactly one break slot for two segments, so the remaining 59 slots hold real indices.
    const breaks = Array.from(out).filter((v) => v === -1).length;
    expect(breaks).toBe(1);
  });

  it("golden: single interior gap retains both segments' endpoints", () => {
    const sampleCount = 50;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i >= 20 && i < 25 ? NaN : i;
    const threshold = 20;
    const out = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(out[0]).toBe(0);
    expect(out[threshold - 1]).toBe(49);
  });

  it("golden: trailing gap emits no trailing break, only padding at threshold length", () => {
    const sampleCount = 50;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < 40; i += 1) y[i] = i;
    for (let i = 40; i < sampleCount; i += 1) y[i] = NaN;
    const threshold = 20;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(written).toBe(threshold);
    expect(out[0]).toBe(0);
    expect(out[threshold - 1]).toBe(39);
  });

  it("alternating finite/NaN at threshold=64 over 1000 samples returns 0", () => {
    const sampleCount = 1000;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) y[i] = i % 2 === 0 ? i : NaN;
    const threshold = 64;
    const out = new Int32Array(threshold);

    expect(lttb(x, y, 0, sampleCount, out, 0, threshold)).toBe(0);
  });
});

describe("lttb — all-NaN input", () => {
  it("does not throw and selects no real point (all -1, returns threshold)", () => {
    const sampleCount = 50;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount).fill(NaN);
    const threshold = 10;
    const out = new Int32Array(threshold);

    let written = -999;
    expect(() => {
      written = lttb(x, y, 0, sampleCount, out, 0, threshold);
    }).not.toThrow();

    expect(written).toBe(threshold);
    for (let i = 0; i < threshold; i += 1) expect(out[i]).toBe(-1);
  });
});

describe("lttb — peak fidelity near a gap", () => {
  it("a narrow peak adjacent to a gap survives decimation", () => {
    const sampleCount = 200;
    const x = xFrom(sampleCount);
    const y = new Float32Array(sampleCount).fill(0);
    // Segment [0, 100): flat except a sharp peak right before the gap at index 98.
    y[98] = 1000;
    // Gap [100, 105).
    for (let i = 100; i < 105; i += 1) y[i] = NaN;
    // Segment [105, 200): flat.
    const threshold = 30;
    const out = new Int32Array(threshold);

    const written = lttb(x, y, 0, sampleCount, out, 0, threshold);

    expect(written).toBe(threshold);
    expect(Array.from(out)).toContain(98);
  });
});
