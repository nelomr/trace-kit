/** @vitest-environment node */
import {
  createViewportTransform,
  projectX,
  projectY,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { guardedProjectX, guardedProjectY, liftsPen } from "../../src/path/guarded-projection.js";
import { GUARD_BAND_PX } from "../../src/rules/guard-band.js";

interface AxisOptions {
  readonly yMin: number;
  readonly yMax: number;
  readonly yScaleKind?: number;
}

// 450 x 330 CSS px at dpr 1 with a 50 px left and 30 px bottom inset: the plot rectangle is
// x 50..450, y 0..300, so one X unit over [0, 4] is 100 px and the guard edges are easy to read.
function transformFor({ yMin, yMax, yScaleKind = Y_SCALE_KIND_LINEAR }: AxisOptions): ViewportTransform {
  return createViewportTransform({
    cssWidth: 450,
    cssHeight: 330,
    dpr: 1,
    insetLeft: 50,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 30,
    xDomainMin: 0,
    xDomainMax: 4,
    yDomainMin: yMin,
    yDomainMax: yMax,
    xOrigin: 0,
    yScaleKind,
  });
}

const linear = transformFor({ yMin: 0, yMax: 1 });
const inverted = transformFor({ yMin: 1, yMax: 0 });
const zeroSpan = transformFor({ yMin: 0.5, yMax: 0.5 });
const log = transformFor({ yMin: 1, yMax: 1000, yScaleKind: Y_SCALE_KIND_LOG });
const zeroLogSpan = transformFor({ yMin: 10, yMax: 10, yScaleKind: Y_SCALE_KIND_LOG });

const TOP = -GUARD_BAND_PX;
const BOTTOM = 300 + GUARD_BAND_PX;
const RIGHT = 450 + GUARD_BAND_PX;
const LEFT = 50 - GUARD_BAND_PX;

describe("liftsPen", () => {
  it("lifts the pen for NaN on both axis kinds", () => {
    expect(liftsPen(NaN, false)).toBe(true);
    expect(liftsPen(NaN, true)).toBe(true);
  });

  it.each([0, -0, -5, -Infinity])("lifts the pen for %s on a log axis only", (y) => {
    expect(liftsPen(y, true)).toBe(true);
    expect(liftsPen(y, false)).toBe(false);
  });

  it("keeps the pen down for +Infinity and for positive values on both kinds", () => {
    for (const logAxis of [false, true]) {
      expect(liftsPen(Infinity, logAxis)).toBe(false);
      expect(liftsPen(1e-30, logAxis)).toBe(false);
      expect(liftsPen(7, logAxis)).toBe(false);
    }
  });
});

describe("guardedProjectY", () => {
  it("sends +Infinity to the top guard edge and -Infinity to the bottom one on a linear axis", () => {
    expect(guardedProjectY(linear, Infinity)).toBe(TOP);
    expect(guardedProjectY(linear, -Infinity)).toBe(BOTTOM);
  });

  it("swaps the edges on an inverted domain", () => {
    expect(guardedProjectY(inverted, Infinity)).toBe(BOTTOM);
    expect(guardedProjectY(inverted, -Infinity)).toBe(TOP);
  });

  it("sends +Infinity to the top edge on a log axis", () => {
    expect(guardedProjectY(log, Infinity)).toBe(TOP);
  });

  it("returns finite edges, never NaN, on a zero-span linear axis", () => {
    expect(zeroSpan.yScale).toBe(0);
    expect(guardedProjectY(zeroSpan, Infinity)).toBe(TOP);
    expect(guardedProjectY(zeroSpan, -Infinity)).toBe(BOTTOM);
  });

  it("returns a finite edge on a zero-span log axis", () => {
    expect(zeroLogSpan.yLogScale).toBe(0);
    expect(guardedProjectY(zeroLogSpan, Infinity)).toBe(TOP);
  });

  it("is bit-identical to projectY inside the guard band", () => {
    for (const y of [0.5, 0, -0, 0.25, 1, -3, 40, 1e-9]) {
      expect(Object.is(guardedProjectY(linear, y), projectY(linear, y))).toBe(true);
    }
    for (const y of [1, 10, 100, 1000, 3.7]) {
      expect(Object.is(guardedProjectY(log, y), projectY(log, y))).toBe(true);
    }
  });

  it("clamps a huge finite value to the guard edge on its side", () => {
    expect(guardedProjectY(linear, 1e30)).toBe(TOP);
    expect(guardedProjectY(linear, -1e30)).toBe(BOTTOM);
  });

  it("keeps a huge value finite on a log axis, where the scale is compressive", () => {
    expect(Object.is(guardedProjectY(log, 1e30), projectY(log, 1e30))).toBe(true);
  });

  it("never returns NaN for a drawable sample", () => {
    for (const t of [linear, inverted, zeroSpan, log, zeroLogSpan]) {
      for (const y of [Infinity, 1e30, 0.5, 1e-30]) {
        expect(Number.isNaN(guardedProjectY(t, y))).toBe(false);
      }
    }
    for (const t of [linear, inverted, zeroSpan]) {
      for (const y of [-Infinity, -1e30, 0, -0, -4]) {
        expect(Number.isNaN(guardedProjectY(t, y))).toBe(false);
      }
    }
  });
});

describe("guardedProjectX", () => {
  it("is bit-identical to projectX inside the guard band", () => {
    for (const x of [0, 1, 2.5, 4, -3, 600]) {
      expect(Object.is(guardedProjectX(linear, x), projectX(linear, x))).toBe(true);
    }
  });

  it("clamps a huge X to the guard edge on its side", () => {
    expect(guardedProjectX(linear, 1e30)).toBe(RIGHT);
    expect(guardedProjectX(linear, -1e30)).toBe(LEFT);
    expect(guardedProjectX(linear, Infinity)).toBe(RIGHT);
    expect(guardedProjectX(linear, -Infinity)).toBe(LEFT);
  });
});
