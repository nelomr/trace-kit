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
  type ViewportTransform,
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

const EXPECTED_KEYS: readonly (keyof ViewportTransform)[] = [
  "xDomainMin",
  "xDomainMax",
  "yDomainMin",
  "yDomainMax",
  "xOrigin",
  "xOffsetMin",
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
  "yScaleKind",
  "yLogDomainMin",
  "yLogScale",
];

describe("createViewportTransform", () => {
  it("returns a frozen object; assignment throws in strict mode", () => {
    const t = createViewportTransform(baseOptions());
    expect(() => {
      // @ts-expect-error — verifying runtime freeze against a readonly field
      t.plotLeft = 999;
    }).toThrow(TypeError);
  });

  it("exposes exactly the nineteen fields in the contract order", () => {
    const t = createViewportTransform(baseOptions());
    expect(Object.keys(t)).toEqual(EXPECTED_KEYS);
    expect(EXPECTED_KEYS).toHaveLength(19);
  });

  it("places xOffsetMin immediately after xOrigin on every instance", () => {
    for (const xOrigin of [0, 1000, -3.5, 1550.123456]) {
      const keys = Object.keys(createViewportTransform(baseOptions({ xOrigin })));
      expect(keys.indexOf("xOffsetMin")).toBe(keys.indexOf("xOrigin") + 1);
    }
  });

  it("survives structuredClone with all nineteen numeric fields intact", () => {
    const t = createViewportTransform(baseOptions({ xOrigin: 1000, xDomainMin: 0, xDomainMax: 299 }));
    const cloned = structuredClone(t);
    expect(Object.keys(cloned)).toEqual(EXPECTED_KEYS);
    for (const key of EXPECTED_KEYS) {
      expect(typeof cloned[key]).toBe("number");
      expect(Object.is(cloned[key], t[key]), key).toBe(true);
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

describe("xOffsetMin construction", () => {
  it("is bit-identical to xDomainMin when xOrigin is 0, including -0", () => {
    for (const [min, max] of [
      [0, 299],
      [-0, 1],
      [-5, 5],
    ] as const) {
      const t = createViewportTransform(
        baseOptions({ xOrigin: 0, xDomainMin: min, xDomainMax: max }),
      );
      expect(Object.is(t.xOffsetMin, t.xDomainMin)).toBe(true);
    }
  });

  it("is the absolute domain minimum less the origin", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 0, xDomainMax: 299 }),
    );
    expect(t.xOffsetMin).toBe(-1000);
    expect(t.xDomainMin).toBe(0);
    expect(t.xDomainMax).toBe(299);
    expect(t.xOrigin).toBe(1000);
  });

  it("is zero for a domain starting at the origin, so payload offsets span the plot from its left edge", () => {
    // cssWidth 349 less 50 css px of insets at dpr 2 is a 598 device-pixel plot over 299 domain units.
    const t = createViewportTransform(
      baseOptions({
        cssWidth: 349,
        dpr: 2,
        xOrigin: 1000,
        xDomainMin: 1000,
        xDomainMax: 1299,
      }),
    );
    expect(t.plotWidth).toBe(598);
    expect(t.xOffsetMin).toBe(0);
    expect(projectX(t, 0)).toBe(t.plotLeft);
    expect(projectX(t, 149.5)).toBe(t.plotLeft + 299);
    expect(projectX(t, 299)).toBe(t.plotLeft + 598);
  });

  it("keeps a sub-unit domain offset from the origin exact, placing that offset on the plot's left edge", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1550, xDomainMin: 1550.25, xDomainMax: 1551.25 }),
    );
    expect(t.xOffsetMin).toBe(0.25);
    expect(projectX(t, 0.25)).toBe(t.plotLeft);
  });

  it("stores the origin, the offset-space minimum and both bounds without float32 rounding", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1550.123456, xDomainMin: 1550.12345, xDomainMax: 1551.5 }),
    );
    expect(t.xOffsetMin).toBe(1550.12345 - 1550.123456);
    expect(Math.fround(t.xOffsetMin)).not.toBe(t.xOffsetMin);
    expect(Math.fround(t.xOrigin)).not.toBe(t.xOrigin);
    expect(Math.fround(t.xDomainMin)).not.toBe(t.xDomainMin);
    expect(t.xDomainMin).toBe(1550.12345);
  });

  it("throws a RangeError naming the subtraction when xDomainMin - xOrigin overflows", () => {
    expect(() =>
      createViewportTransform(
        baseOptions({ xDomainMin: 1.7e308, xDomainMax: 1.7e308, xOrigin: -1.7e308 }),
      ),
    ).toThrow(/xDomainMin - xOrigin/);
    expect(() =>
      createViewportTransform(
        baseOptions({ xDomainMin: 1.7e308, xDomainMax: 1.7e308, xOrigin: -1.7e308 }),
      ),
    ).toThrow(RangeError);
  });

  it("keeps the existing finiteness checks on the individual inputs", () => {
    expect(() => createViewportTransform(baseOptions({ xOrigin: Number.NaN }))).toThrow(
      /xOrigin must be finite/,
    );
    expect(() =>
      createViewportTransform(baseOptions({ xDomainMin: Number.POSITIVE_INFINITY })),
    ).toThrow(/xDomainMin must be finite/);
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

describe("projectX with an absolute domain and per-trace offset origin", () => {
  it("equals plotLeft + (x - xOffsetMin) * xScale", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 250, xDomainMin: 300, xDomainMax: 400 }),
    );
    for (const x of [-100, 0, 50, 75.5, 1000]) {
      expect(projectX(t, x)).toBe(t.plotLeft + (x - t.xOffsetMin) * t.xScale);
    }
  });

  it("projects the offset-space domain edges to the plot edges", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 0, xDomainMax: 299 }),
    );
    expect(projectX(t, -1000)).toBe(t.plotLeft);
    expect(projectX(t, -701)).toBeCloseTo(t.plotLeft + t.plotWidth, 9);
  });

  it("places two traces with different origins at the same device X for the same absolute X", () => {
    const t0 = createViewportTransform(
      baseOptions({ xOrigin: 0, xDomainMin: 0, xDomainMax: 299 }),
    );
    const t1 = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 0, xDomainMax: 299 }),
    );
    expect(t1.xOffsetMin).toBe(-1000);
    for (let i = 0; i <= 299; i++) {
      expect(projectX(t1, -1000 + i)).toBe(projectX(t0, i));
    }
  });

  it("reads only plotLeft, xOffsetMin and xScale from the transform", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 0, xDomainMax: 299 }),
    );
    const reads = new Set<PropertyKey>();
    const spy = new Proxy({ ...t }, {
      get(target, prop) {
        reads.add(prop);
        return target[prop as keyof ViewportTransform];
      },
    });
    projectX(spy, -900);
    expect([...reads].sort()).toEqual(["plotLeft", "xOffsetMin", "xScale"]);
  });

  it("is bit-identical to the previous domain-min formula when xOrigin is 0", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 0, xDomainMin: 10, xDomainMax: 20 }),
    );
    for (const x of [12.5, 10, 20, 3, 99.999]) {
      expect(Object.is(projectX(t, x), t.plotLeft + (x - t.xDomainMin) * t.xScale)).toBe(true);
    }
  });
});

describe("unprojectX returns absolute X", () => {
  it("round-trips an offset inside and outside the domain to xOrigin + offset", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 1000, xDomainMax: 1299 }),
    );
    for (const o of [0, 123.5, 299, -50, 600]) {
      expect(unprojectX(t, projectX(t, o))).toBeCloseTo(1000 + o, 9);
    }
    const outside = projectX(t, 600);
    expect(outside).toBeGreaterThan(t.plotLeft + t.plotWidth);
  });

  it("returns the absolute domain edges for the plot-edge pixels", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1550, xDomainMin: 1550, xDomainMax: 1551 }),
    );
    expect(unprojectX(t, t.plotLeft)).toBeCloseTo(1550, 9);
    expect(unprojectX(t, t.plotLeft + t.plotWidth)).toBeCloseTo(1551, 9);
  });

  it("returns the absolute xDomainMin on a zero-span axis and never NaN", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 1005, xDomainMax: 1005 }),
    );
    expect(t.xScale).toBe(0);
    expect(unprojectX(t, 12345)).toBe(1005);
    for (const px of [-1e6, 0, t.plotLeft, 1e6]) {
      expect(Number.isNaN(unprojectX(t, px))).toBe(false);
    }
  });

  it("does not clamp one pixel beyond the plot edge", () => {
    const t = createViewportTransform(
      baseOptions({ xOrigin: 1000, xDomainMin: 1000, xDomainMax: 1299 }),
    );
    expect(unprojectX(t, t.plotLeft + t.plotWidth + 1)).toBeGreaterThan(t.xDomainMax);
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

  it("compares only the origin and ignores the X domain", () => {
    const payload = createSpectrumDataPayload({
      capacity: 4,
      xOrigin: 1000,
      xUnit: "nm",
      yUnit: "dBm",
    });
    for (const [xDomainMin, xDomainMax] of [
      [0, 299],
      [1000, 1299],
      [-5, 5],
    ] as const) {
      const t = createViewportTransform(baseOptions({ xOrigin: 1000, xDomainMin, xDomainMax }));
      expect(transformMatchesPayload(t, payload)).toBe(true);
    }
    const other = createViewportTransform(
      baseOptions({ xOrigin: 0, xDomainMin: 1000, xDomainMax: 1299 }),
    );
    expect(transformMatchesPayload(other, payload)).toBe(false);
  });
});
