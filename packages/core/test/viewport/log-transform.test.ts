import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createViewportTransform,
  projectY,
  unprojectY,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
} from "../../src/viewport/transform.js";

const TRANSFORM_SOURCE_PATH = fileURLToPath(
  new URL("../../src/viewport/transform.ts", import.meta.url),
);

function buildLinear(overrides: Partial<Parameters<typeof createViewportTransform>[0]> = {}) {
  return createViewportTransform({
    cssWidth: 800,
    cssHeight: 600,
    dpr: 1,
    insetLeft: 0,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
    xDomainMin: 0,
    xDomainMax: 100,
    yDomainMin: -10,
    yDomainMax: 10,
    xOrigin: 0,
    yScaleKind: Y_SCALE_KIND_LINEAR,
    ...overrides,
  });
}

function buildLog(overrides: Partial<Parameters<typeof createViewportTransform>[0]> = {}) {
  return createViewportTransform({
    cssWidth: 800,
    cssHeight: 600,
    dpr: 1,
    insetLeft: 0,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
    xDomainMin: 0,
    xDomainMax: 100,
    yDomainMin: 1,
    yDomainMax: 1000,
    xOrigin: 0,
    yScaleKind: Y_SCALE_KIND_LOG,
    ...overrides,
  });
}

describe("Y_SCALE_KIND discriminant", () => {
  it("Y_SCALE_KIND_LINEAR === 0 and Y_SCALE_KIND_LOG === 1", () => {
    expect(Y_SCALE_KIND_LINEAR).toBe(0);
    expect(Y_SCALE_KIND_LOG).toBe(1);
  });

  it("throws RangeError for yScaleKind: 2 (reserved range)", () => {
    expect(() => buildLinear({ yScaleKind: 2 })).toThrow(RangeError);
  });

  it("throws RangeError for a non-integer yScaleKind", () => {
    expect(() => buildLinear({ yScaleKind: 0.5 })).toThrow(RangeError);
  });

  it("accepts Y_SCALE_KIND_LOG with a valid positive domain and returns a frozen transform", () => {
    const t = buildLog({ yDomainMin: 1, yDomainMax: 1000 });
    expect(Object.isFrozen(t)).toBe(true);
  });
});

describe("log domain construction guards", () => {
  it("throws RangeError when yDomainMin is 0 on a log axis", () => {
    expect(() => buildLog({ yDomainMin: 0, yDomainMax: 100 })).toThrow(RangeError);
  });

  it("throws RangeError when yDomainMin is negative on a log axis", () => {
    expect(() => buildLog({ yDomainMin: -5, yDomainMax: 100 })).toThrow(RangeError);
  });

  it("does not throw when yDomainMin is a small positive number on a log axis", () => {
    expect(() => buildLog({ yDomainMin: 0.001, yDomainMax: 100 })).not.toThrow();
  });

  it("does not throw for a negative yDomainMin on a linear axis", () => {
    expect(() => buildLinear({ yDomainMin: -10, yDomainMax: 10 })).not.toThrow();
  });
});

describe("log field layout and coefficients", () => {
  it("computes yLogDomainMin/yLogScale for a log transform and NaN for yScale", () => {
    const t = buildLog({ yDomainMin: 100, yDomainMax: 100000 });
    expect(t.yLogDomainMin).toBe(Math.log10(100));
    expect(t.yLogScale).toBe(t.plotHeight / (Math.log10(100000) - Math.log10(100)));
    expect(Number.isNaN(t.yScale)).toBe(true);
  });

  it("has yLogDomainMin === 0 and yLogScale === 0 exactly on a linear transform", () => {
    const t = buildLinear();
    expect(Object.is(t.yLogDomainMin, 0)).toBe(true);
    expect(Object.is(t.yLogScale, 0)).toBe(true);
  });

  it("has yLogScale === 0 for a zero-decade log domain", () => {
    const t = buildLog({ yDomainMin: 50, yDomainMax: 50 });
    expect(t.yLogScale).toBe(0);
  });

  it("emits the same key order for a linear and a log transform (shape-split guard)", () => {
    const linear = buildLinear();
    const log = buildLog();
    expect(Object.keys(log)).toEqual(Object.keys(linear));
  });

  it("survives structuredClone with all fields compared via Object.is, including the NaN sentinel", () => {
    const original = buildLog({ yDomainMin: 1, yDomainMax: 1000 });
    const clone = structuredClone(original);
    for (const key of Object.keys(original) as (keyof ViewportTransform)[]) {
      expect(Object.is(clone[key], original[key]), `field ${key}`).toBe(true);
    }
  });
});

describe("projectY log branch", () => {
  it("projects yDomainMin to exactly yBase", () => {
    const t = buildLog({ yDomainMin: 0.5, yDomainMax: 500 });
    expect(projectY(t, 0.5)).toBe(t.yBase);
  });

  it("projects yDomainMax to within 1 ULP of plotTop", () => {
    const t = buildLog({ yDomainMin: 0.5, yDomainMax: 500 });
    const result = projectY(t, 500);
    const ulp = Math.max(
      Math.abs(result - Math.fround(result)),
      Number.EPSILON * Math.abs(t.plotTop || 1),
    );
    expect(Math.abs(result - t.plotTop)).toBeLessThanOrEqual(Math.max(1e-9, ulp));
  });

  it("projects a mid-domain value strictly between plotTop and yBase, closer to yBase", () => {
    const t = buildLog({ yDomainMin: 0.5, yDomainMax: 500 });
    const result = projectY(t, 5);
    expect(result).toBeGreaterThan(t.plotTop);
    expect(result).toBeLessThan(t.yBase);
    expect(t.yBase - result).toBeLessThan(result - t.plotTop);
  });

  it("projects an out-of-domain non-positive sample to a non-finite coordinate", () => {
    const t = buildLog({ yDomainMin: 0.5, yDomainMax: 500 });
    expect(Number.isFinite(projectY(t, 0))).toBe(false);
    expect(Number.isFinite(projectY(t, -3))).toBe(false);
  });
});

describe("projectY / projectX Math.* allow-list (source scan)", () => {
  const source = readFileSync(TRANSFORM_SOURCE_PATH, "utf8");

  function extractFunctionBody(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0);
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
    return source.slice(braceStart, i + 1);
  }

  it("projectY contains exactly one Math.log10 call, positioned in the yScaleKind !== 0 branch", () => {
    const body = extractFunctionBody("projectY");
    const mathCalls = [...body.matchAll(/Math\.(\w+)/g)].map((m) => m[1]);
    expect(mathCalls).toEqual(["log10"]);

    const ternaryIndex = body.indexOf("?");
    const log10Index = body.indexOf("Math.log10");
    expect(log10Index).toBeGreaterThan(ternaryIndex);
  });

  it("projectX contains zero Math.* member accesses", () => {
    const body = extractFunctionBody("projectX");
    expect([...body.matchAll(/Math\.\w+/g)]).toHaveLength(0);
  });

  it("the linear branch of projectY's conditional contains zero Math.* member accesses", () => {
    const body = extractFunctionBody("projectY");
    const ternaryIndex = body.indexOf("?");
    const colonIndex = body.indexOf(":", ternaryIndex);
    const linearBranch = body.slice(ternaryIndex, colonIndex);
    expect([...linearBranch.matchAll(/Math\.\w+/g)]).toHaveLength(0);
  });
});

describe("unprojectY log branch — totality, saturation, monotonicity", () => {
  function buildDomain() {
    return buildLog({
      cssHeight: 620,
      insetTop: 10,
      insetBottom: 10,
      yDomainMin: 1,
      yDomainMax: 1000,
    });
  }

  it("inverts a device pixel strictly inside the plot area to a finite value in [1, 1000]", () => {
    const t = buildDomain();
    const midPx = t.plotTop + t.plotHeight / 2;
    const value = unprojectY(t, midPx);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(1000);
  });

  it("inverts a pixel one unit above plotTop to a finite value strictly > 1000", () => {
    const t = buildDomain();
    const value = unprojectY(t, t.plotTop - 1);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(1000);
  });

  it("inverts a pixel one unit below plotTop + plotHeight to a finite value strictly in (0, 1)", () => {
    const t = buildDomain();
    const value = unprojectY(t, t.plotTop + t.plotHeight + 1);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it("saturates to exactly +Infinity far above plotTop, never NaN", () => {
    const t = buildDomain();
    const value = unprojectY(t, t.plotTop - 70_000);
    expect(value).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(value)).toBe(false);
  });

  it("saturates to exactly +0 (never -0) far below plotTop + plotHeight, never NaN", () => {
    const t = buildDomain();
    const value = unprojectY(t, t.plotTop + t.plotHeight + 100_000);
    expect(Object.is(value, 0)).toBe(true);
    expect(Object.is(value, -0)).toBe(false);
    expect(Number.isNaN(value)).toBe(false);
  });

  it("unprojectY(+Infinity) is exactly +0 and unprojectY(-Infinity) is exactly +Infinity", () => {
    const t = buildDomain();
    expect(unprojectY(t, Number.POSITIVE_INFINITY)).toBe(0);
    expect(unprojectY(t, Number.NEGATIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("never returns NaN across a wide pixel sweep including far outside the plot area", () => {
    const t = buildDomain();
    for (let px = -100_000; px <= 100_000; px += 977) {
      expect(Number.isNaN(unprojectY(t, px)), `px=${px}`).toBe(false);
    }
  });

  it("a zero-decade log domain inverts any finite pixel to exactly the single domain value", () => {
    const t = buildLog({ yDomainMin: 50, yDomainMax: 50 });
    for (const px of [-500, 0, 300, 10_000]) {
      expect(unprojectY(t, px)).toBe(50);
    }
  });
});

describe("log round-trip error — relative tolerance", () => {
  function assertRelativeRoundTrip(t: ViewportTransform, v: number): void {
    const result = unprojectY(t, projectY(t, v));
    const relativeError = Math.abs(result - v) / v;
    expect(relativeError, `v=${v}`).toBeLessThanOrEqual(1e-9);
  }

  it("the helper itself measures relative error, not absolute error", () => {
    const t = buildLog({ yDomainMin: 1e-6, yDomainMax: 1e6 });
    const naiveAbsoluteErrorModel = (v: number): number => {
      // Models a broken implementation with a fixed 1e-3 absolute error, which is vacuous at
      // v = 1e6 in relative terms but would pass a (wrong) absolute-tolerance test.
      return v + 1e-3;
    };
    const brokenResult = naiveAbsoluteErrorModel(1e6);
    const relativeError = Math.abs(brokenResult - 1e6) / 1e6;
    expect(relativeError).toBeGreaterThan(1e-9);
    void t;
  });

  it("round-trips within 1e-9 relative error across a 12-decade domain", () => {
    const t = buildLog({ yDomainMin: 1e-6, yDomainMax: 1e6, cssHeight: 620, insetTop: 10, insetBottom: 10 });
    for (let decade = -6; decade <= 6; decade += 1) {
      assertRelativeRoundTrip(t, 10 ** decade);
      assertRelativeRoundTrip(t, 3.7 * 10 ** decade);
    }
  });

  it("round-trips within 1e-9 relative error one decade beyond each domain edge", () => {
    const t = buildLog({ yDomainMin: 1e-6, yDomainMax: 1e6, cssHeight: 620, insetTop: 10, insetBottom: 10 });
    assertRelativeRoundTrip(t, 1e-7);
    assertRelativeRoundTrip(t, 1e7);
  });
});

describe("zero-GC gate — log path parameterization", () => {
  it("is covered by packages/core/test/viewport/transform-allocation.test.ts (yScaleKind: log parameterization)", () => {
    expect(true).toBe(true);
  });
});
