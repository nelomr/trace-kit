import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectTicks } from "../../src/viewport/ticks.js";

describe("selectTicks", () => {
  it("writes a count <= capacity, finite and ascending, covering [0, 100]", () => {
    const out = new Float64Array(32);
    const n = selectTicks(0, 100, 5, out, 0);
    expect(n).toBeLessThanOrEqual(32);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      expect(Number.isFinite(out[i])).toBe(true);
      if (i > 0) {
        expect(out[i]!).toBeGreaterThan(out[i - 1]!);
      }
    }
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[n - 1]!).toBeLessThanOrEqual(100);
  });

  it("writes no more than the output buffer's capacity", () => {
    const out = new Float64Array(4);
    const n = selectTicks(0, 100, 20, out, 0);
    expect(n).toBeLessThanOrEqual(4);
  });

  it("is deterministic: two calls with identical arguments return bit-identical output", () => {
    const outA = new Float64Array(32);
    const outB = new Float64Array(32);
    const nA = selectTicks(0, 1000, 7, outA, 0);
    const nB = selectTicks(0, 1000, 7, outB, 0);
    expect(nA).toBe(nB);
    for (let i = 0; i < nA; i += 1) {
      expect(outA[i]).toBe(outB[i]);
    }
  });

  it("respects outputOffset, leaving the prefix untouched and writing from that index", () => {
    const out = new Float64Array(32);
    out[0] = -1;
    out[9] = -2;
    const n = selectTicks(0, 100, 5, out, 10);
    expect(out[0]).toBe(-1);
    expect(out[9]).toBe(-2);
    expect(Number.isFinite(out[10])).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it("contains no Math.log10 or Math.pow call (source scan)", () => {
    const path = fileURLToPath(
      new URL("../../src/viewport/ticks.ts", import.meta.url),
    );
    const source = readFileSync(path, "utf8");
    expect(source.includes("Math.log10")).toBe(false);
    expect(source.includes("Math.pow")).toBe(false);
  });
});
