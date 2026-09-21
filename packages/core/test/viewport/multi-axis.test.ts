import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AXIS_SIDE_LEFT,
  createAxisTransforms,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type SharedViewportOptions,
  type ViewportTransform,
  type YAxisRegistration,
} from "../../src/viewport/index.js";

const VIEWPORT_SRC_DIR = fileURLToPath(new URL("../../src/viewport", import.meta.url));

function sharedOptions(overrides: Partial<SharedViewportOptions> = {}): SharedViewportOptions {
  return {
    cssWidth: 800,
    cssHeight: 600,
    dpr: 1,
    insetLeft: 40,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 30,
    xDomainMin: 0,
    xDomainMax: 100,
    xOrigin: 0,
    ...overrides,
  };
}

describe("AXIS_SIDE_LEFT and YAxisRegistration acceptance", () => {
  it("AXIS_SIDE_LEFT === 0", () => {
    expect(AXIS_SIDE_LEFT).toBe(0);
  });

  it("accepts a log YAxisRegistration and produces a corresponding ViewportTransform", () => {
    const registration: YAxisRegistration = {
      id: "power-mw",
      scaleKind: Y_SCALE_KIND_LOG,
      domainMin: 1e-3,
      domainMax: 1e3,
      side: AXIS_SIDE_LEFT,
    };
    const out: ViewportTransform[] = [];
    const count = createAxisTransforms(sharedOptions(), [registration], out);
    expect(count).toBe(1);
    expect(out[0]?.yScaleKind).toBe(Y_SCALE_KIND_LOG);
  });

  it("YAxisRegistration's fields are all string or number (type-level fixture)", () => {
    const registration: YAxisRegistration = {
      id: "x",
      scaleKind: 0,
      domainMin: 0,
      domainMax: 1,
      side: 0,
    };
    type OnlyPrimitive<T> = T extends string | number ? T : never;
    type Check = {
      [K in keyof YAxisRegistration]: OnlyPrimitive<YAxisRegistration[K]>;
    };
    const check: Check = registration;
    expect(check).toBeDefined();
  });
});

describe("createAxisTransforms — N transforms from one shared X domain", () => {
  it("returns the count written and produces matching scale kinds per axis", () => {
    const axes: YAxisRegistration[] = [
      { id: "log-axis", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
      { id: "linear-axis", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -10, domainMax: 10, side: AXIS_SIDE_LEFT },
    ];
    const out: ViewportTransform[] = [];
    const count = createAxisTransforms(sharedOptions(), axes, out);
    expect(count).toBe(2);
    expect(out[0]?.yScaleKind).toBe(Y_SCALE_KIND_LOG);
    expect(out[0]?.yDomainMin).toBe(1);
    expect(out[0]?.yDomainMax).toBe(1000);
    expect(out[1]?.yScaleKind).toBe(Y_SCALE_KIND_LINEAR);
    expect(out[1]?.yDomainMin).toBe(-10);
    expect(out[1]?.yDomainMax).toBe(10);
  });

  it("shares identical X fields and plot geometry (by Object.is) across all produced transforms", () => {
    const axes: YAxisRegistration[] = [
      { id: "a", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
      { id: "b", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -10, domainMax: 10, side: AXIS_SIDE_LEFT },
    ];
    const out: ViewportTransform[] = [];
    createAxisTransforms(sharedOptions(), axes, out);
    const sharedFields: (keyof ViewportTransform)[] = [
      "xDomainMin",
      "xDomainMax",
      "xOrigin",
      "xScale",
      "deviceWidth",
      "deviceHeight",
      "dpr",
    ];
    for (const field of sharedFields) {
      expect(Object.is(out[0]?.[field], out[1]?.[field]), field).toBe(true);
    }
  });
});

describe("shared plot geometry across N axes — inset stacking invariant", () => {
  it("every transform has identical plotLeft/plotTop/plotWidth/plotHeight given one shared insetLeft", () => {
    const axes: YAxisRegistration[] = [
      { id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 1, side: AXIS_SIDE_LEFT },
      { id: "b", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 2, side: AXIS_SIDE_LEFT },
      { id: "c", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 3, side: AXIS_SIDE_LEFT },
    ];
    const out: ViewportTransform[] = [];
    // insetLeft already sums all three axes' gutters — the renderer's job, not this function's.
    createAxisTransforms(sharedOptions({ insetLeft: 120 }), axes, out);
    for (const field of ["plotLeft", "plotTop", "plotWidth", "plotHeight"] as const) {
      expect(out[1]?.[field]).toBe(out[0]?.[field]);
      expect(out[2]?.[field]).toBe(out[0]?.[field]);
    }
  });

  it("converts a shared CSS insetLeft to device pixels exactly once per transform under dpr", () => {
    const axes: YAxisRegistration[] = [
      { id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 1, side: AXIS_SIDE_LEFT },
    ];
    const out: ViewportTransform[] = [];
    createAxisTransforms(sharedOptions({ insetLeft: 80, dpr: 2 }), axes, out);
    expect(out[0]?.plotLeft).toBe(80 * 2);
  });

  it("a smaller plot width results from reconfiguring one axis to two with recomputed insetLeft", () => {
    const outOne: ViewportTransform[] = [];
    createAxisTransforms(
      sharedOptions({ insetLeft: 50 }),
      [{ id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 1, side: AXIS_SIDE_LEFT }],
      outOne,
    );
    const outTwo: ViewportTransform[] = [];
    createAxisTransforms(
      sharedOptions({ insetLeft: 100 }),
      [
        { id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 1, side: AXIS_SIDE_LEFT },
        { id: "b", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 1, side: AXIS_SIDE_LEFT },
      ],
      outTwo,
    );
    expect(outTwo[0]?.plotWidth).toBeLessThan(outOne[0]!.plotWidth);
    expect(outTwo[0]?.plotWidth).toBe(outTwo[1]?.plotWidth);
  });

  it("yAxisCount: 0 with insetLeft: 0 yields no transforms and no error", () => {
    const out: ViewportTransform[] = [];
    const count = createAxisTransforms(sharedOptions({ insetLeft: 0 }), [], out);
    expect(count).toBe(0);
  });

  it("throws RangeError via the existing construction guard when insets consume the whole width", () => {
    expect(() =>
      createAxisTransforms(
        sharedOptions({ insetLeft: 900, cssWidth: 800 }),
        [{ id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: 0, domainMax: 1, side: AXIS_SIDE_LEFT }],
        [],
      ),
    ).toThrow(RangeError);
  });
});

describe("no yAxisId / no id-to-index lookup / buildTracePath unchanged", () => {
  it("packages/core/src/viewport/axes.ts exports no id-to-index lookup structure", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/viewport/axes.ts", import.meta.url)), "utf8");
    expect(source.includes("Map<")).toBe(false);
    expect(/yAxisId/i.test(source)).toBe(false);
  });

  it("no file under packages/core/src/viewport declares a yAxisId field", () => {
    for (const file of readdirSync(VIEWPORT_SRC_DIR)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(`${VIEWPORT_SRC_DIR}/${file}`, "utf8");
      expect(/yAxisId/i.test(source), file).toBe(false);
    }
  });

  it("createAxisTransforms accepts only one already-summed insetLeft in shared, structurally", () => {
    // SharedViewportOptions derives from CreateViewportTransformOptions, which declares exactly
    // one insetLeft field — there is no per-axis inset parameter anywhere in the signature.
    const options: SharedViewportOptions = sharedOptions();
    expect(typeof options.insetLeft).toBe("number");
    expect((options as Record<string, unknown>)["insetLeftPerAxis"]).toBeUndefined();
  });
});
