/** @vitest-environment node */
import {
  AXIS_MASK_NONE,
  AXIS_MASK_X,
  AXIS_MASK_XY,
  AXIS_MASK_Y,
  createViewportTransform,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_BOX_SIZE_CSS,
  DEFAULT_SETTLE_DEBOUNCE_MS,
  DEFAULT_WHEEL_LINE_HEIGHT_PX,
  DEFAULT_WHEEL_PAGE_FALLBACK_PX,
  DEFAULT_WHEEL_SENSITIVITY,
  MAX_WHEEL_DELTA_PX,
  classifyPointerRegion,
  normalizeWheelDeltaPx,
  resolveWheelAxisMask,
} from "../../src/controller/input-normalizer.js";

describe("input-normalizer (pure DOM-free Node execution)", () => {
  it("runs cleanly with zero DOM globals and exposes exact default constants", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    expect(DEFAULT_WHEEL_LINE_HEIGHT_PX).toBe(32);
    expect(DEFAULT_WHEEL_PAGE_FALLBACK_PX).toBe(800);
    expect(MAX_WHEEL_DELTA_PX).toBe(400);
    expect(DEFAULT_WHEEL_SENSITIVITY).toBe(0.001);
    expect(DEFAULT_MIN_BOX_SIZE_CSS).toBe(4);
    expect(DEFAULT_SETTLE_DEBOUNCE_MS).toBe(120);
  });

  describe("classifyPointerRegion", () => {
    const transform = createViewportTransform({
      cssWidth: 800,
      cssHeight: 400,
      dpr: 1,
      insetLeft: 80,
      insetTop: 20,
      insetRight: 20,
      insetBottom: 50,
      xDomainMin: 0,
      xDomainMax: 100,
      yDomainMin: 0,
      yDomainMax: 50,
      xOrigin: 0,
    });

    it("classifies interior, x-gutter, y-gutter, and outside coordinates unambiguously", () => {
      expect(transform.deviceWidth).toBe(800);
      expect(transform.deviceHeight).toBe(400);
      expect(transform.plotLeft).toBe(80);
      expect(transform.plotTop).toBe(20);
      expect(transform.plotWidth).toBe(700);
      expect(transform.plotHeight).toBe(330);

      expect(classifyPointerRegion(transform, 400, 180)).toBe("plot");
      expect(classifyPointerRegion(transform, 400, 370)).toBe("x-gutter");
      expect(classifyPointerRegion(transform, 40, 180)).toBe("y-gutter");
      expect(classifyPointerRegion(transform, 40, 370)).toBe("outside");
      expect(classifyPointerRegion(transform, 790, 180)).toBe("outside");
    });

    it("handles boundary edges accurately", () => {
      // Plot boundary edges are inclusive.
      expect(classifyPointerRegion(transform, 80, 20)).toBe("plot");
      expect(classifyPointerRegion(transform, 780, 350)).toBe("plot");
      expect(classifyPointerRegion(transform, 80, 350)).toBe("plot");
      expect(classifyPointerRegion(transform, 780, 20)).toBe("plot");

      // Just outside plot into x-gutter and y-gutter.
      expect(classifyPointerRegion(transform, 80, 350.001)).toBe("x-gutter");
      expect(classifyPointerRegion(transform, 780, 400)).toBe("x-gutter");
      expect(classifyPointerRegion(transform, 0, 20)).toBe("y-gutter");
      expect(classifyPointerRegion(transform, 79.999, 350)).toBe("y-gutter");

      // Outside margins and out-of-bounds.
      expect(classifyPointerRegion(transform, -0.001, 180)).toBe("outside");
      expect(classifyPointerRegion(transform, 400, 19.999)).toBe("outside");
      expect(classifyPointerRegion(transform, 400, 400.001)).toBe("outside");
      expect(classifyPointerRegion(transform, 780.001, 370)).toBe("outside");
      expect(classifyPointerRegion(transform, 40, 19.999)).toBe("outside");
    });

    it("returns outside for non-finite coordinates", () => {
      expect(classifyPointerRegion(transform, Number.NaN, 180)).toBe("outside");
      expect(classifyPointerRegion(transform, 400, Number.NaN)).toBe("outside");
      expect(classifyPointerRegion(transform, Number.POSITIVE_INFINITY, 180)).toBe("outside");
      expect(classifyPointerRegion(transform, 400, Number.NEGATIVE_INFINITY)).toBe("outside");
    });
  });

  describe("normalizeWheelDeltaPx", () => {
    it("normalizes PIXEL, LINE, and PAGE delta modes and clamps spikes to ±MAX_WHEEL_DELTA_PX", () => {
      expect(normalizeWheelDeltaPx(0, -120, 0, false, 500)).toBe(-120);
      expect(normalizeWheelDeltaPx(0, 3, 1, false, 500)).toBe(96);
      expect(normalizeWheelDeltaPx(0, 1, 2, false, 500)).toBe(400);
      expect(normalizeWheelDeltaPx(0, 0.25, 2, false, 500)).toBe(125);
      expect(normalizeWheelDeltaPx(0, -900, 0, false, 500)).toBe(-400);
      expect(normalizeWheelDeltaPx(0, 900, 0, false, 500)).toBe(400);
    });

    it("falls back to DEFAULT_WHEEL_PAGE_FALLBACK_PX when pageHeightCss is invalid", () => {
      expect(normalizeWheelDeltaPx(0, 0.25, 2, false, 0)).toBe(200);
      expect(normalizeWheelDeltaPx(0, 0.25, 2, false, -100)).toBe(200);
      expect(normalizeWheelDeltaPx(0, 0.25, 2, false, Number.NaN)).toBe(200);
      expect(normalizeWheelDeltaPx(0, 1, 2, false, 0)).toBe(400);
    });

    it("preserves macOS Shift + Wheel dominant-axis deltaX remap", () => {
      expect(normalizeWheelDeltaPx(-120, 0, 0, true, 400)).toBe(-120);
      expect(normalizeWheelDeltaPx(120, 0, 0, true, 400)).toBe(120);
      expect(normalizeWheelDeltaPx(40, -120, 0, true, 400)).toBe(-120);
      expect(normalizeWheelDeltaPx(-120, 40, 0, true, 400)).toBe(-120);
      // Without shiftKey, deltaX is ignored and deltaY is read.
      expect(normalizeWheelDeltaPx(-120, 0, 0, false, 400)).toBe(0);
    });

    it("returns 0 for zero or non-finite inputs", () => {
      expect(normalizeWheelDeltaPx(0, 0, 0, false, 500)).toBe(0);
      expect(normalizeWheelDeltaPx(0, Number.NaN, 0, false, 500)).toBe(0);
      expect(normalizeWheelDeltaPx(0, Number.POSITIVE_INFINITY, 0, false, 500)).toBe(0);
      expect(normalizeWheelDeltaPx(Number.NEGATIVE_INFINITY, 0, 0, true, 500)).toBe(0);
    });
  });

  describe("resolveWheelAxisMask", () => {
    it("resolves plot, modifier, gutter, and outside masks when gutterInteraction is enabled", () => {
      expect(resolveWheelAxisMask("plot", "xy", true, false, false)).toBe(AXIS_MASK_XY);
      expect(resolveWheelAxisMask("plot", "xy", true, true, false)).toBe(AXIS_MASK_X);
      expect(resolveWheelAxisMask("plot", "xy", true, false, true)).toBe(AXIS_MASK_Y);
      expect(resolveWheelAxisMask("plot", "xy", true, true, true)).toBe(AXIS_MASK_XY);
      expect(resolveWheelAxisMask("x-gutter", "xy", true, false, false)).toBe(AXIS_MASK_X);
      expect(resolveWheelAxisMask("y-gutter", "xy", true, false, false)).toBe(AXIS_MASK_Y);
      expect(resolveWheelAxisMask("outside", "xy", true, false, false)).toBe(AXIS_MASK_NONE);
      expect(resolveWheelAxisMask("outside", "xy", true, true, false)).toBe(AXIS_MASK_NONE);
    });

    it("returns AXIS_MASK_NONE in gutters when gutterInteraction is false", () => {
      expect(resolveWheelAxisMask("x-gutter", "xy", false, false, false)).toBe(AXIS_MASK_NONE);
      expect(resolveWheelAxisMask("y-gutter", "xy", false, false, false)).toBe(AXIS_MASK_NONE);
      expect(resolveWheelAxisMask("plot", "xy", false, false, false)).toBe(AXIS_MASK_XY);
    });

    it("respects wheelAxis defaults 'x' and 'y' inside plot", () => {
      expect(resolveWheelAxisMask("plot", "x", true, false, false)).toBe(AXIS_MASK_X);
      expect(resolveWheelAxisMask("plot", "y", true, false, false)).toBe(AXIS_MASK_Y);
      // Modifiers still override wheelAxis inside plot.
      expect(resolveWheelAxisMask("plot", "x", true, false, true)).toBe(AXIS_MASK_Y);
      expect(resolveWheelAxisMask("plot", "y", true, true, false)).toBe(AXIS_MASK_X);
    });
  });
});
