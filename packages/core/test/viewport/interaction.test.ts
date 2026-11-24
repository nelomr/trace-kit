import { describe, expect, it } from "vitest";
import {
  AXIS_MASK_NONE,
  AXIS_MASK_X,
  AXIS_MASK_XY,
  AXIS_MASK_Y,
  DEFAULT_MIN_LOG_DECADES_Y,
  LOG_EXPONENT_MAX,
  LOG_EXPONENT_MIN,
  ULP_MIN_SPAN_FACTOR,
  capturePanGestureSnapshot,
  clampViewportDomain,
  computeBoxZoomDomain,
  computePanDomain,
  computeUlpMinSpan,
  computeZoomDomain,
  createMutableViewportDomain,
  createPanGestureSnapshot,
  type MutableViewportDomain,
  type ViewportDomainConstraints,
} from "../../src/viewport/interaction.js";
import {
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  createViewportTransform,
  unprojectX,
  unprojectY,
  type ViewportTransform,
} from "../../src/viewport/transform.js";

interface TransformSpec {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly yScaleKind?: number;
  readonly cssWidth?: number;
  readonly cssHeight?: number;
  readonly insetLeft?: number;
  readonly insetRight?: number;
  readonly insetTop?: number;
  readonly insetBottom?: number;
  readonly xOrigin?: number;
}

function makeTransform(spec: TransformSpec): ViewportTransform {
  return createViewportTransform({
    cssWidth: spec.cssWidth ?? 900,
    cssHeight: spec.cssHeight ?? 380,
    dpr: 1,
    insetLeft: spec.insetLeft ?? 80,
    insetRight: spec.insetRight ?? 20,
    insetTop: spec.insetTop ?? 20,
    insetBottom: spec.insetBottom ?? 60,
    xDomainMin: spec.xMin,
    xDomainMax: spec.xMax,
    yDomainMin: spec.yMin,
    yDomainMax: spec.yMax,
    xOrigin: spec.xOrigin ?? 0,
    yScaleKind: spec.yScaleKind ?? Y_SCALE_KIND_LINEAR,
  });
}

function nextTransformFrom(
  base: ViewportTransform,
  domain: MutableViewportDomain,
): ViewportTransform {
  return createViewportTransform({
    cssWidth: base.deviceWidth,
    cssHeight: base.deviceHeight,
    dpr: 1,
    insetLeft: base.plotLeft,
    insetRight: base.deviceWidth - base.plotLeft - base.plotWidth,
    insetTop: base.plotTop,
    insetBottom: base.deviceHeight - base.plotTop - base.plotHeight,
    xDomainMin: domain.xMin,
    xDomainMax: domain.xMax,
    yDomainMin: domain.yMin,
    yDomainMax: domain.yMax,
    xOrigin: base.xOrigin,
    yScaleKind: base.yScaleKind,
  });
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

describe("constants & cold factories", () => {
  it("exposes the exact constant values", () => {
    expect(AXIS_MASK_NONE).toBe(0);
    expect(AXIS_MASK_X).toBe(1);
    expect(AXIS_MASK_Y).toBe(2);
    expect(AXIS_MASK_XY).toBe(3);
    expect(ULP_MIN_SPAN_FACTOR).toBe(1e-12);
    expect(LOG_EXPONENT_MIN).toBe(-300);
    expect(LOG_EXPONENT_MAX).toBe(300);
    expect(DEFAULT_MIN_LOG_DECADES_Y).toBe(1e-6);
  });

  it("createMutableViewportDomain defaults and overrides", () => {
    expect(createMutableViewportDomain()).toEqual({
      xMin: 0,
      xMax: 1,
      yMin: -1,
      yMax: 1,
    });
    expect(createMutableViewportDomain(2, 3, 4, 5)).toEqual({
      xMin: 2,
      xMax: 3,
      yMin: 4,
      yMax: 5,
    });
  });

  it("createPanGestureSnapshot returns a zero-initialized snapshot", () => {
    const snapshot = createPanGestureSnapshot();
    expect(snapshot).toEqual({
      startDeviceX: 0,
      startDeviceY: 0,
      startXMin: 0,
      startXMax: 0,
      startYMin: 0,
      startYMax: 0,
      startPlotWidth: 0,
      startPlotHeight: 0,
      startYScaleKind: 0,
      startYLogMin: 0,
      startYLogMax: 0,
    });
  });

  it("capturePanGestureSnapshot copies a linear transform and zeros the log fields", () => {
    const t = makeTransform({ xMin: 10, xMax: 30, yMin: -5, yMax: 5 });
    const out = createPanGestureSnapshot();
    const returned = capturePanGestureSnapshot(t, 300, 200, out);
    expect(returned).toBe(out);
    expect(out.startDeviceX).toBe(300);
    expect(out.startDeviceY).toBe(200);
    expect(out.startXMin).toBe(10);
    expect(out.startXMax).toBe(30);
    expect(out.startYMin).toBe(-5);
    expect(out.startYMax).toBe(5);
    expect(out.startPlotWidth).toBe(t.plotWidth);
    expect(out.startPlotHeight).toBe(t.plotHeight);
    expect(out.startYScaleKind).toBe(Y_SCALE_KIND_LINEAR);
    expect(out.startYLogMin).toBe(0);
    expect(out.startYLogMax).toBe(0);
  });

  it("capturePanGestureSnapshot records decade bounds on a log axis", () => {
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 1000,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 0, 0, out);
    expect(out.startYScaleKind).toBe(Y_SCALE_KIND_LOG);
    expect(out.startYLogMin).toBe(0);
    expect(out.startYLogMax).toBeCloseTo(3, 12);
  });

  it("computeUlpMinSpan = max(|min|, |max|, 1) * 1e-12", () => {
    expect(computeUlpMinSpan(1550, 1551)).toBe(1551 * 1e-12);
    expect(computeUlpMinSpan(-4000, 10)).toBe(4000 * 1e-12);
    expect(computeUlpMinSpan(0.1, 0.2)).toBe(1e-12);
  });
});

describe("computeZoomDomain — X axis", () => {
  it("deep-zoom cursor-anchored zoom near xOrigin 1550 keeps the anchor fixed", () => {
    const t = makeTransform({
      xMin: 1550.0001,
      xMax: 1550.0002,
      yMin: -1,
      yMax: 1,
      xOrigin: 1550,
    });
    const out = createMutableViewportDomain();
    const changed = computeZoomDomain(t, 0.5, 1, 280, 170, AXIS_MASK_X, undefined, out);
    expect(changed).toBe(true);
    const expectedSpan = (1550.0002 - 1550.0001) * 0.5;
    expect(relativeError(out.xMax - out.xMin, expectedSpan)).toBeLessThan(1e-3);
    // Source-precision span: 5e-5 within the representable float64 grid at 1550.
    expect(Math.abs(out.xMax - out.xMin - 5e-5)).toBeLessThan(1e-12);
    const next = nextTransformFrom(t, out);
    expect(Math.abs(unprojectX(next, 280) - 1550.000125)).toBeLessThan(1e-12);
    expect(out.yMin).toBe(-1);
    expect(out.yMax).toBe(1);
  });

  it("zoom-out then zoom-in at the same anchor restores the domain", () => {
    const t = makeTransform({ xMin: 100, xMax: 200, yMin: -50, yMax: 50 });
    const out = createMutableViewportDomain();
    computeZoomDomain(t, 2, 1, 300, 150, AXIS_MASK_X, undefined, out);
    const t2 = nextTransformFrom(t, out);
    const back = createMutableViewportDomain();
    computeZoomDomain(t2, 0.5, 1, 300, 150, AXIS_MASK_X, undefined, back);
    expect(relativeError(back.xMin, 100)).toBeLessThan(1e-10);
    expect(relativeError(back.xMax, 200)).toBeLessThan(1e-10);
  });

  it("ignores axes outside the axis mask", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    const out = createMutableViewportDomain();
    const changed = computeZoomDomain(t, 0.5, 0.5, 300, 150, AXIS_MASK_Y, undefined, out);
    expect(changed).toBe(true);
    expect(out.xMin).toBe(0);
    expect(out.xMax).toBe(100);
    expect(out.yMax - out.yMin).toBeCloseTo(5, 12);
  });

  it("returns false and leaves the domain at the transform when nothing changes", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    const out = createMutableViewportDomain();
    expect(computeZoomDomain(t, 1, 1, 300, 150, AXIS_MASK_XY, undefined, out)).toBe(false);
    expect(computeZoomDomain(t, 0.5, 0.5, 300, 150, AXIS_MASK_NONE, undefined, out)).toBe(false);
    expect(out).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
  });

  it("rejects non-finite or non-positive factors without NaN output", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    for (const factor of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const out = createMutableViewportDomain();
      expect(computeZoomDomain(t, factor, factor, 300, 150, AXIS_MASK_XY, undefined, out)).toBe(false);
      expect(out).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    }
  });

  it("built-in ULP floor survives 200 repeated zoom-ins on [1550, 1551]", () => {
    let t = makeTransform({ xMin: 1550, xMax: 1551, yMin: -1, yMax: 1, xOrigin: 1550 });
    const out = createMutableViewportDomain();
    for (let i = 0; i < 200; i += 1) {
      computeZoomDomain(t, 0.5, 1, 280, 170, AXIS_MASK_X, undefined, out);
      expect(out.xMax).toBeGreaterThan(out.xMin);
      t = nextTransformFrom(t, out);
    }
    expect(out.xMax - out.xMin).toBeGreaterThanOrEqual(computeUlpMinSpan(out.xMin, out.xMax));
    expect(Number.isFinite(t.xScale)).toBe(true);
    expect(t.xScale).toBeGreaterThan(0);
  });

  it("hard bounds clamp a zoom-out ([40, 60] within [0, 100], factor 10)", () => {
    const t = makeTransform({ xMin: 40, xMax: 60, yMin: 0, yMax: 1 });
    const out = createMutableViewportDomain();
    const constraints: ViewportDomainConstraints = { bounds: { xMin: 0, xMax: 100 } };
    computeZoomDomain(t, 10, 1, 480, 150, AXIS_MASK_X, constraints, out);
    expect(out.xMin).toBe(0);
    expect(out.xMax).toBe(100);
  });

  it("honours minSpanX and maxSpanX", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 1 });
    const out = createMutableViewportDomain();
    computeZoomDomain(t, 0.001, 1, 480, 150, AXIS_MASK_X, { minSpanX: 5 }, out);
    expect(out.xMax - out.xMin).toBeCloseTo(5, 10);
    computeZoomDomain(t, 100, 1, 480, 150, AXIS_MASK_X, { maxSpanX: 150 }, out);
    expect(out.xMax - out.xMin).toBeCloseTo(150, 10);
  });

  it("honours minSpanY and maxSpanY on a linear Y axis", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    const out = createMutableViewportDomain();
    computeZoomDomain(t, 1, 0.001, 480, 150, AXIS_MASK_Y, { minSpanY: 2 }, out);
    expect(out.yMax - out.yMin).toBeCloseTo(2, 10);
    computeZoomDomain(t, 1, 100, 480, 150, AXIS_MASK_Y, { maxSpanY: 25 }, out);
    expect(out.yMax - out.yMin).toBeCloseTo(25, 10);
  });

  it("zero-span flat signal axis is a clean no-op while X still zooms", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 5, yMax: 5 });
    const out = createMutableViewportDomain();
    const changed = computeZoomDomain(t, 0.5, 0.5, 300, 150, AXIS_MASK_XY, undefined, out);
    expect(changed).toBe(true);
    expect(out.yMin).toBe(5);
    expect(out.yMax).toBe(5);
    expect(Number.isFinite(out.xMin) && Number.isFinite(out.xMax)).toBe(true);
    expect(out.xMax - out.xMin).toBeCloseTo(50, 10);
  });
});

describe("computeZoomDomain — logarithmic Y axis", () => {
  it("zooms in decade space and keeps the anchor value fixed", () => {
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1e-3,
      yMax: 1e3,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createMutableViewportDomain();
    const changed = computeZoomDomain(t, 1, 0.5, 300, 170, AXIS_MASK_Y, undefined, out);
    expect(changed).toBe(true);
    expect(out.yMin).toBe(10 ** -1.5);
    expect(out.yMax).toBe(10 ** 1.5);
    expect(out.yMin).toBeGreaterThan(0);
    const next = nextTransformFrom(t, out);
    expect(Math.abs(unprojectY(next, 170) - 1)).toBeLessThan(1e-12);
  });

  it("extreme zoom-out from [1e-250, 1e250] clamps inside [1e-300, 1e300] without throwing", () => {
    let t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1e-250,
      yMax: 1e250,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createMutableViewportDomain();
    for (let i = 0; i < 10; i += 1) {
      computeZoomDomain(t, 1, 10, 300, 170, AXIS_MASK_Y, undefined, out);
      expect(out.yMin).toBeGreaterThanOrEqual(1e-300);
      expect(out.yMax).toBeLessThanOrEqual(1e300);
      expect(out.yMax).toBeGreaterThan(out.yMin);
      t = nextTransformFrom(t, out);
    }
  });

  it("respects minLogDecadesY", () => {
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 100,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createMutableViewportDomain();
    computeZoomDomain(t, 1, 1e-9, 300, 170, AXIS_MASK_Y, { minLogDecadesY: 0.5 }, out);
    expect(Math.log10(out.yMax) - Math.log10(out.yMin)).toBeCloseTo(0.5, 9);
  });

  it("hard log-Y bounds clamp zoom-out", () => {
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 10,
      yMax: 100,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createMutableViewportDomain();
    computeZoomDomain(t, 1, 100, 300, 170, AXIS_MASK_Y, { bounds: { yMin: 1, yMax: 1000 } }, out);
    expect(out.yMin).toBeCloseTo(1, 10);
    expect(out.yMax).toBeCloseTo(1000, 7);
  });

  it("maxSpanY / minSpanY are linear-axis constraints and do not break log zoom", () => {
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 1000,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createMutableViewportDomain();
    expect(computeZoomDomain(t, 1, 0.5, 300, 170, AXIS_MASK_Y, { maxSpanY: 1, minSpanY: 1 }, out)).toBe(true);
    expect(out.yMin).toBeGreaterThan(0);
  });
});

describe("computePanDomain", () => {
  const constraints: ViewportDomainConstraints | undefined = undefined;

  it("200 arbitrary intermediate moves ending at the start restore the exact bounds", () => {
    const t = makeTransform({
      xMin: 1550.0001,
      xMax: 1550.0002,
      yMin: -10,
      yMax: 10,
      xOrigin: 1550,
    });
    const snapshot = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 300, 200, snapshot);
    const out = createMutableViewportDomain();
    for (let i = 0; i < 200; i += 1) {
      computePanDomain(snapshot, 300 + ((i * 37) % 211) - 100, 200 + ((i * 53) % 97) - 40, AXIS_MASK_XY, constraints, out);
    }
    expect(computePanDomain(snapshot, 300, 200, AXIS_MASK_XY, constraints, out)).toBe(true);
    expect(Object.is(out.xMin, 1550.0001)).toBe(true);
    expect(Object.is(out.xMax, 1550.0002)).toBe(true);
    expect(Object.is(out.yMin, -10)).toBe(true);
    expect(Object.is(out.yMax, 10)).toBe(true);
  });

  it("dragging right +40 px shifts X left; dragging down +40 px shifts Y up", () => {
    // plotWidth = 800 px for 100 x-units -> 8 px/unit; plotHeight = 300 px for 50 y-units -> 6 px/unit.
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 50 });
    const snapshot = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 300, 200, snapshot);
    const out = createMutableViewportDomain();
    computePanDomain(snapshot, 340, 240, AXIS_MASK_XY, undefined, out);
    expect(out.xMin).toBeCloseTo(-5, 10);
    expect(out.xMax).toBeCloseTo(95, 10);
    expect(out.yMin).toBeCloseTo(40 * (50 / 300), 10);
    expect(out.yMax).toBeCloseTo(50 + 40 * (50 / 300), 10);
  });

  it("axis mask restricts the pan to the enabled axes", () => {
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 50 });
    const snapshot = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 300, 200, snapshot);
    const out = createMutableViewportDomain();
    computePanDomain(snapshot, 340, 240, AXIS_MASK_X, undefined, out);
    expect(out.yMin).toBe(0);
    expect(out.yMax).toBe(50);
    expect(out.xMin).not.toBe(0);
    computePanDomain(snapshot, 340, 240, AXIS_MASK_Y, undefined, out);
    expect(out.xMin).toBe(0);
    expect(out.xMax).toBe(100);
    expect(out.yMin).not.toBe(0);
  });

  it("log-Y drag translates linearly in decade space", () => {
    // plotHeight 300 px, 3 decades -> 100 px per decade.
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 1000,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const snapshot = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 300, 100, snapshot);
    const out = createMutableViewportDomain();
    expect(computePanDomain(snapshot, 300, 200, AXIS_MASK_Y, undefined, out)).toBe(true);
    expect(relativeError(out.yMin, 10)).toBeLessThan(1e-12);
    expect(relativeError(out.yMax, 10000)).toBeLessThan(1e-12);
  });

  it("extreme log drag stays >= 1e-300 without throwing", () => {
    const t = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 1000,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const snapshot = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 300, 100, snapshot);
    const out = createMutableViewportDomain();
    computePanDomain(snapshot, 300, 100 - 50000, AXIS_MASK_Y, undefined, out);
    expect(out.yMin).toBeGreaterThanOrEqual(1e-300);
    expect(out.yMax).toBeGreaterThan(out.yMin);
    expect(() => nextTransformFrom(t, out)).not.toThrow();
    computePanDomain(snapshot, 300, 100 + 50000, AXIS_MASK_Y, undefined, out);
    expect(out.yMax).toBeLessThanOrEqual(1e300);
    expect(() => nextTransformFrom(t, out)).not.toThrow();
  });

  it("span-preserving bounds clamping and zero-jump return from a wall", () => {
    const t = makeTransform({ xMin: 20, xMax: 40, yMin: 0, yMax: 1 });
    const bounded: ViewportDomainConstraints = { bounds: { xMin: 0, xMax: 100 } };
    const snapshot = createPanGestureSnapshot();
    capturePanGestureSnapshot(t, 300, 200, snapshot);
    const out = createMutableViewportDomain();
    // 800 px / 20 units = 40 px per unit; +1200 px drags the domain 30 units left.
    computePanDomain(snapshot, 1500, 200, AXIS_MASK_X, bounded, out);
    expect(out.xMin).toBe(0);
    expect(out.xMax).toBe(20);
    expect(out.xMax - out.xMin).toBe(20);

    const t2 = makeTransform({ xMin: 10, xMax: 30, yMin: 0, yMax: 1 });
    capturePanGestureSnapshot(t2, 300, 200, snapshot);
    computePanDomain(snapshot, 3000, 200, AXIS_MASK_X, bounded, out);
    expect(out.xMin).toBe(0);
    expect(out.xMax).toBe(20);
    computePanDomain(snapshot, 300, 200, AXIS_MASK_X, bounded, out);
    expect(out.xMin).toBe(10);
    expect(out.xMax).toBe(30);
  });

  it("returns false for a degenerate snapshot or non-finite pointer", () => {
    const snapshot = createPanGestureSnapshot();
    const out = createMutableViewportDomain(1, 2, 3, 4);
    expect(computePanDomain(snapshot, 10, 10, AXIS_MASK_XY, undefined, out)).toBe(false);
    const t = makeTransform({ xMin: 0, xMax: 100, yMin: 0, yMax: 50 });
    capturePanGestureSnapshot(t, 300, 200, snapshot);
    expect(computePanDomain(snapshot, Number.NaN, Number.NaN, AXIS_MASK_XY, undefined, out)).toBe(false);
    expect(out).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 50 });
  });
});

describe("computeBoxZoomDomain", () => {
  // Plot is 0..400 x 0..200 device px mapped to [0, 100] x [0, 50].
  const t = makeTransform({
    xMin: 0,
    xMax: 100,
    yMin: 0,
    yMax: 50,
    cssWidth: 400,
    cssHeight: 200,
    insetLeft: 0,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
  });

  it("writes identical bounds for all four diagonal sweep directions", () => {
    const corners: ReadonlyArray<readonly [number, number, number, number]> = [
      [100, 50, 300, 150],
      [300, 150, 100, 50],
      [100, 150, 300, 50],
      [300, 50, 100, 150],
    ];
    for (const [x0, y0, x1, y1] of corners) {
      const out = createMutableViewportDomain();
      expect(computeBoxZoomDomain(t, x0, y0, x1, y1, AXIS_MASK_XY, undefined, out)).toBe(true);
      expect(out.xMin).toBeCloseTo(25, 10);
      expect(out.xMax).toBeCloseTo(75, 10);
      expect(out.yMin).toBeCloseTo(12.5, 10);
      expect(out.yMax).toBeCloseTo(37.5, 10);
    }
  });

  it("clamps an out-of-plot drag end to the plot edge on log-Y", () => {
    const log = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 1000,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    const out = createMutableViewportDomain();
    expect(computeBoxZoomDomain(log, 250, 170, 999, -100, AXIS_MASK_XY, undefined, out)).toBe(true);
    // plotLeft 80, plotWidth 800 -> (999 clamps to 880), anchor 250 -> 17.0625.. in data space.
    expect(out.xMax).toBeCloseTo(100, 10);
    expect(out.xMin).toBeCloseTo(((250 - 80) / 800) * 100, 10);
    expect(out.yMax).toBeCloseTo(1000, 7);
    expect(out.yMin).toBeCloseTo(10 ** ((3 * (320 - 170)) / 300), 9);
    expect(out.yMin).toBeGreaterThan(0);
  });

  it("log-Y box on [1, 1000] spanning the midpoint to the top gives [sqrt(1000), 1000]", () => {
    const log = makeTransform({
      xMin: 0,
      xMax: 100,
      yMin: 1,
      yMax: 1000,
      yScaleKind: Y_SCALE_KIND_LOG,
      insetLeft: 50,
      insetRight: 50,
      cssWidth: 500,
    });
    const out = createMutableViewportDomain();
    // x: plot 50..450 -> start 250 (mid), end beyond 450 clamps to 450 -> [50, 100]
    expect(computeBoxZoomDomain(log, 250, 170, 999, -100, AXIS_MASK_XY, undefined, out)).toBe(true);
    expect(out.xMin).toBeCloseTo(50, 10);
    expect(out.xMax).toBeCloseTo(100, 10);
    expect(out.yMin).toBeCloseTo(Math.sqrt(1000), 8);
    expect(out.yMax).toBeCloseTo(1000, 7);
  });

  it("zero-extent box returns false and does not corrupt out", () => {
    const out = createMutableViewportDomain(7, 8, 9, 10);
    expect(computeBoxZoomDomain(t, 100, 50, 100, 150, AXIS_MASK_XY, undefined, out)).toBe(false);
    expect(computeBoxZoomDomain(t, 100, 50, 300, 50, AXIS_MASK_XY, undefined, out)).toBe(false);
    expect(out).toEqual({ xMin: 7, xMax: 8, yMin: 9, yMax: 10 });
  });

  it("rejects non-finite corners and AXIS_MASK_NONE", () => {
    const out = createMutableViewportDomain(7, 8, 9, 10);
    expect(computeBoxZoomDomain(t, Number.NaN, 50, 300, 150, AXIS_MASK_XY, undefined, out)).toBe(false);
    expect(computeBoxZoomDomain(t, 100, 50, 300, 150, AXIS_MASK_NONE, undefined, out)).toBe(false);
    expect(out).toEqual({ xMin: 7, xMax: 8, yMin: 9, yMax: 10 });
  });

  it("an X-only box copies Y from transform and ignores a zero Y extent", () => {
    const out = createMutableViewportDomain(0, 1, -3, 3);
    expect(computeBoxZoomDomain(t, 100, 50, 300, 50, AXIS_MASK_X, undefined, out)).toBe(true);
    expect(out.xMin).toBeCloseTo(25, 10);
    expect(out.xMax).toBeCloseTo(75, 10);
    expect(out.yMin).toBe(t.yDomainMin);
    expect(out.yMax).toBe(t.yDomainMax);
  });

  it("a Y-only box copies X from transform, ignores a zero X extent, and leaves out untouched on failure", () => {
    const out = createMutableViewportDomain(-99, -88, -77, -66);
    expect(computeBoxZoomDomain(t, 100, 50, 100, 150, AXIS_MASK_Y, undefined, out)).toBe(true);
    expect(out.xMin).toBe(t.xDomainMin);
    expect(out.xMax).toBe(t.xDomainMax);
    expect(out.yMin).toBeCloseTo(12.5, 10);
    expect(out.yMax).toBeCloseTo(37.5, 10);

    // Zero Y extent fails without overwriting stale out values.
    const sentinel = createMutableViewportDomain(11, 22, 33, 44);
    expect(computeBoxZoomDomain(t, 100, 50, 100, 50, AXIS_MASK_Y, undefined, sentinel)).toBe(false);
    expect(sentinel).toEqual({ xMin: 11, xMax: 22, yMin: 33, yMax: 44 });
  });

  it("applies constraints to the committed box", () => {
    const out = createMutableViewportDomain();
    expect(
      computeBoxZoomDomain(t, 100, 50, 110, 150, AXIS_MASK_XY, { minSpanX: 10 }, out),
    ).toBe(true);
    expect(out.xMax - out.xMin).toBeCloseTo(10, 10);
  });
});

describe("clampViewportDomain", () => {
  it("clamps X and linear Y into bounds in place", () => {
    const domain = createMutableViewportDomain(-50, 50, -5, 5);
    const ok = clampViewportDomain(
      domain,
      Y_SCALE_KIND_LINEAR,
      { bounds: { xMin: 0, xMax: 100, yMin: -1, yMax: 1 } },
      false,
    );
    expect(ok).toBe(true);
    expect(domain).toEqual({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });
  });

  it("preserveSpan slides instead of shrinking", () => {
    const domain = createMutableViewportDomain(-10, 10, 0, 1);
    expect(clampViewportDomain(domain, Y_SCALE_KIND_LINEAR, { bounds: { xMin: 0, xMax: 100 } }, true)).toBe(true);
    expect(domain.xMin).toBe(0);
    expect(domain.xMax).toBe(20);
  });

  it("returns true and leaves a valid unconstrained domain unchanged", () => {
    const domain = createMutableViewportDomain(0, 10, 1, 100);
    expect(clampViewportDomain(domain, Y_SCALE_KIND_LOG, undefined, false)).toBe(true);
    expect(domain.xMin).toBe(0);
    expect(domain.xMax).toBe(10);
    expect(relativeError(domain.yMin, 1)).toBeLessThan(1e-12);
    expect(relativeError(domain.yMax, 100)).toBeLessThan(1e-12);
  });

  it("rejects non-finite, inverted, zero-span and non-positive log-Y input without mutation", () => {
    const bad: ReadonlyArray<readonly [number, number, number, number, number]> = [
      [Number.NaN, 1, 0, 1, Y_SCALE_KIND_LINEAR],
      [0, Number.POSITIVE_INFINITY, 0, 1, Y_SCALE_KIND_LINEAR],
      [5, 1, 0, 1, Y_SCALE_KIND_LINEAR],
      [1, 1, 0, 1, Y_SCALE_KIND_LINEAR],
      [0, 1, 2, 1, Y_SCALE_KIND_LINEAR],
      [0, 1, 0, 10, Y_SCALE_KIND_LOG],
      [0, 1, -1, 10, Y_SCALE_KIND_LOG],
      [0, 1, 10, 1, Y_SCALE_KIND_LOG],
    ];
    for (const [xMin, xMax, yMin, yMax, kind] of bad) {
      const domain = createMutableViewportDomain(xMin, xMax, yMin, yMax);
      expect(clampViewportDomain(domain, kind, undefined, false)).toBe(false);
      expect(Object.is(domain.xMin, xMin)).toBe(true);
      expect(Object.is(domain.xMax, xMax)).toBe(true);
      expect(Object.is(domain.yMin, yMin)).toBe(true);
      expect(Object.is(domain.yMax, yMax)).toBe(true);
    }
  });

  it("clamps log-Y into the [1e-300, 1e300] exponent window", () => {
    const domain = createMutableViewportDomain(0, 1, 1e-320, 1e320);
    // 1e320 is Infinity -> rejected.
    expect(clampViewportDomain(domain, Y_SCALE_KIND_LOG, undefined, false)).toBe(false);
    const wide = createMutableViewportDomain(0, 1, 1e-310, 1e305);
    expect(clampViewportDomain(wide, Y_SCALE_KIND_LOG, undefined, false)).toBe(true);
    expect(wide.yMin).toBeGreaterThanOrEqual(1e-300);
    expect(wide.yMax).toBeLessThanOrEqual(1e300);
  });
});
