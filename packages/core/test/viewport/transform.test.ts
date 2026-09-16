import { describe, expect, it } from "vitest";
import {
  createViewportTransform,
  isInsidePlotArea,
  projectX,
  projectY,
  transformMatchesPayload,
  unprojectX,
  unprojectY,
  type CreateViewportTransformOptions,
} from "../../src/viewport/transform.js";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

function baseOptions(
  overrides: Partial<CreateViewportTransformOptions> = {},
): CreateViewportTransformOptions {
  return {
    cssWidth: 800,
    cssHeight: 600,
    dpr: 2,
    insetLeft: 40,
    insetRight: 10,
    insetTop: 10,
    insetBottom: 30,
    xDomainMin: 0,
    xDomainMax: 100,
    yDomainMin: -1,
    yDomainMax: 1,
    xOrigin: 0,
    ...overrides,
  };
}

describe("createViewportTransform", () => {
  it("returns a frozen object; assignment throws in strict mode", () => {
    const t = createViewportTransform(baseOptions());
    expect(() => {
      // @ts-expect-error — verifying runtime freeze against a readonly field
      t.plotLeft = 999;
    }).toThrow(TypeError);
  });

  it("survives structuredClone with all 14 numeric fields intact", () => {
    const t = createViewportTransform(baseOptions());
    const cloned = structuredClone(t);
    const keys: (keyof typeof t)[] = [
      "xDomainMin",
      "xDomainMax",
      "yDomainMin",
      "yDomainMax",
      "xOrigin",
      "deviceWidth",
      "deviceHeight",
      "dpr",
      "plotLeft",
      "plotTop",
      "plotWidth",
      "plotHeight",
      "xScale",
      "yScale",
      "yBase",
    ];
    expect(keys.length).toBe(15);
    for (const key of keys) {
      expect(cloned[key]).toBe(t[key]);
    }
  });

  it("derives plotLeft/plotTop/plotWidth/plotHeight from CSS insets and dpr", () => {
    const t = createViewportTransform(baseOptions());
    expect(t.plotLeft).toBe(40 * 2);
    expect(t.plotTop).toBe(10 * 2);
    expect(t.deviceWidth).toBe(Math.round(800 * 2));
    expect(t.deviceHeight).toBe(Math.round(600 * 2));
    expect(t.plotWidth).toBe(t.deviceWidth - (40 + 10) * 2);
    expect(t.plotHeight).toBe(t.deviceHeight - (10 + 30) * 2);
  });

  it("throws RangeError for a non-finite option", () => {
    expect(() =>
      createViewportTransform(baseOptions({ xDomainMax: Number.NaN })),
    ).toThrow(RangeError);
  });

  it("throws RangeError for dpr <= 0", () => {
    expect(() => createViewportTransform(baseOptions({ dpr: 0 }))).toThrow(
      RangeError,
    );
    expect(() => createViewportTransform(baseOptions({ dpr: -1 }))).toThrow(
      RangeError,
    );
  });

  it("throws RangeError for a negative inset", () => {
    expect(() =>
      createViewportTransform(baseOptions({ insetLeft: -1 })),
    ).toThrow(RangeError);
  });

  it("throws RangeError when insets sum to or exceed the CSS dimension", () => {
    expect(() =>
      createViewportTransform(
        baseOptions({ insetLeft: 400, insetRight: 400, cssWidth: 800 }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      createViewportTransform(
        baseOptions({ insetTop: 300, insetBottom: 300, cssHeight: 600 }),
      ),
    ).toThrow(RangeError);
  });
});

describe("projectX/projectY round-trip", () => {
  it("round-trips within f64 tolerance inside and outside the X domain", () => {
    const t = createViewportTransform(baseOptions());
    for (const v of [0, 25, 50, 100, 200]) {
      const px = projectX(t, v);
      expect(unprojectX(t, px)).toBeCloseTo(v, 9);
    }
  });

  it("projects an out-of-domain value outside the plot-area pixel range", () => {
    const t = createViewportTransform(baseOptions());
    const px = projectX(t, 200); // twice xDomainMax
    expect(px < t.plotLeft || px > t.plotLeft + t.plotWidth).toBe(true);
  });

  it("isInsidePlotArea is true on all four edges and false one device pixel beyond", () => {
    const t = createViewportTransform(baseOptions());
    const left = t.plotLeft;
    const top = t.plotTop;
    const right = t.plotLeft + t.plotWidth;
    const bottom = t.plotTop + t.plotHeight;
    expect(isInsidePlotArea(t, left, top)).toBe(true);
    expect(isInsidePlotArea(t, right, bottom)).toBe(true);
    expect(isInsidePlotArea(t, left, bottom)).toBe(true);
    expect(isInsidePlotArea(t, right, top)).toBe(true);
    expect(isInsidePlotArea(t, left - 1, top)).toBe(false);
    expect(isInsidePlotArea(t, right + 1, bottom)).toBe(false);
    expect(isInsidePlotArea(t, left, top - 1)).toBe(false);
    expect(isInsidePlotArea(t, right, bottom + 1)).toBe(false);
  });
});

describe("zero-span domain", () => {
  it("projects every X input to plotLeft and inverts to xDomainMin, no NaN", () => {
    const t = createViewportTransform(
      baseOptions({ xDomainMin: 5, xDomainMax: 5 }),
    );
    expect(t.xScale).toBe(0);
    for (const v of [5, 0, 100]) {
      expect(projectX(t, v)).toBe(t.plotLeft);
    }
    expect(unprojectX(t, t.plotLeft)).toBe(5);
    expect(Number.isNaN(unprojectX(t, t.plotLeft))).toBe(false);
  });

  it("projects every Y input to yBase and inverts to yDomainMin, no NaN", () => {
    const t = createViewportTransform(
      baseOptions({ yDomainMin: 3, yDomainMax: 3 }),
    );
    expect(t.yScale).toBe(0);
    expect(projectY(t, 3)).toBe(t.yBase);
    expect(unprojectY(t, t.yBase)).toBe(3);
    expect(Number.isNaN(unprojectY(t, t.yBase))).toBe(false);
  });
});

describe("transformMatchesPayload", () => {
  it("returns false on an xOrigin mismatch and true otherwise", () => {
    const t = createViewportTransform(baseOptions({ xOrigin: 10 }));
    const payload = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 10,
      xUnit: "nm",
      yUnit: "dBm",
    });
    expect(transformMatchesPayload(t, payload)).toBe(true);
    const mismatched = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 20,
      xUnit: "nm",
      yUnit: "dBm",
    });
    expect(transformMatchesPayload(t, mismatched)).toBe(false);
  });
});
