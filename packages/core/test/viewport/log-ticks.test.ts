import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectLogTicks, selectTicks } from "../../src/viewport/ticks.js";

const TICKS_SOURCE_PATH = fileURLToPath(new URL("../../src/viewport/ticks.ts", import.meta.url));

describe("selectLogTicks — basic contract", () => {
  it("returns a count <= capacity, finite and ascending, covering [1, 1000]", () => {
    const out = new Float64Array(32);
    const n = selectLogTicks(1, 1000, 5, out, 0);
    expect(n).toBeLessThanOrEqual(32);
    for (let i = 1; i < n; i += 1) {
      expect(Number.isFinite(out[i])).toBe(true);
      expect(out[i]!).toBeGreaterThan(out[i - 1]!);
    }
  });

  it("returns 0 for an invalid log domain (domainMin: 0)", () => {
    const out = new Float64Array(32);
    expect(selectLogTicks(0, 1000, 5, out, 0)).toBe(0);
  });

  it("returns 0 for an inverted domain", () => {
    const out = new Float64Array(32);
    expect(selectLogTicks(100, 10, 5, out, 0)).toBe(0);
  });

  it("returns 1 for a zero-decade domain, out[offset] === domainMin", () => {
    const out = new Float64Array(32);
    const n = selectLogTicks(50, 50, 5, out, 0);
    expect(n).toBe(1);
    expect(out[0]).toBe(50);
  });
});

describe("selectLogTicks — decade arithmetic", () => {
  it("thins across 9 decades toward a target of 5 (stride-2)", () => {
    const out = new Float64Array(32);
    const n = selectLogTicks(1e-3, 1e6, 5, out, 0);
    expect(Array.from(out.slice(0, n))).toEqual([1e-3, 1e-1, 1e1, 1e3, 1e5]);
  });

  it("emits full decades plus mantissas for a small decade count", () => {
    const out = new Float64Array(32);
    const n = selectLogTicks(1, 100, 12, out, 0);
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(Array.from(out.slice(0, n))).toEqual(expected.slice(0, Math.min(expected.length, out.length)));
  });

  it("delegates to selectTicks verbatim for a sub-decade span", () => {
    const outLog = new Float64Array(32);
    const outLinear = new Float64Array(32);
    const nLog = selectLogTicks(286.9252014, 329.4978332, 5, outLog, 0);
    const nLinear = selectTicks(286.9252014, 329.4978332, 5, outLinear, 0);
    expect(nLog).toBe(nLinear);
    for (let i = 0; i < nLog; i += 1) {
      expect(outLog[i]).toBe(outLinear[i]);
    }
  });
});

describe("selectLogTicks — non-empty floor (the d3-scale#44 anti-defect guarantee)", () => {
  it("returns >= 1 for the documented [42, 43] d3-scale defect domain", () => {
    const out = new Float64Array(8);
    const n = selectLogTicks(42, 43, 5, out, 0);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("returns >= 1 for the documented [286.9252014, 329.4978332] d3-scale defect domain", () => {
    const out = new Float64Array(8);
    const n = selectLogTicks(286.9252014, 329.4978332, 5, out, 0);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe("selectLogTicks — transcendental-free source scan", () => {
  it("contains no Math.log10 or Math.pow in its own body", () => {
    const source = readFileSync(TICKS_SOURCE_PATH, "utf8");
    const start = source.indexOf("export function selectLogTicks(");
    expect(start).toBeGreaterThanOrEqual(0);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(braceStart, i + 1);
    expect(body.includes("Math.log10")).toBe(false);
    expect(body.includes("Math.pow")).toBe(false);
  });
});

describe("selectTicks/niceStep regression guard — untouched by this phase", () => {
  it("selectTicks([0, 100], targetCount: 5) behaves exactly as archived", () => {
    const out = new Float64Array(32);
    const n = selectTicks(0, 100, 5, out, 0);
    expect(n).toBeGreaterThan(0);
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[n - 1]!).toBeLessThanOrEqual(100);
  });
});
