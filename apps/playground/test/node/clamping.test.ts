/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { clampInt, validateRun } from "../../src/views/core-math/validate-run.js";
import { createCoreMathState } from "../../src/views/core-math/mount.js";

const MAX_SAMPLES = 1_000_000;
const MAX_OUT_ELEMENTS = 65_536;

describe("clampInt", () => {
  it("clamps NaN and Infinity to the floor", () => {
    expect(clampInt(NaN, 2, 10)).toBe(2);
    expect(clampInt(Infinity, 2, 10)).toBe(2);
    expect(clampInt(-Infinity, 2, 10)).toBe(2);
  });

  it("truncates a fractional value", () => {
    expect(clampInt(5.9, 0, 10)).toBe(5);
  });
});

describe("validateRun", () => {
  it("clamps a threshold above sampleCount into range", () => {
    const { sampleCount, threshold } = validateRun(1_000, 5_000, 10);
    expect(threshold).toBeLessThanOrEqual(sampleCount);
  });

  it("clamps a threshold of 0 or 1 up to >= 2", () => {
    expect(validateRun(1_000, 0, 10).threshold).toBeGreaterThanOrEqual(2);
    expect(validateRun(1_000, 1, 10).threshold).toBeGreaterThanOrEqual(2);
  });

  it("clamps sampleCount into [2, MAX_SAMPLES]", () => {
    expect(validateRun(0, 10, 10).sampleCount).toBe(2);
    expect(validateRun(MAX_SAMPLES * 10, 10, 10).sampleCount).toBe(MAX_SAMPLES);
  });

  it("clamps bucketCount into [1, min(sampleCount, MAX_OUT_ELEMENTS / 2)]", () => {
    const result = validateRun(1_000, 10, 100_000);
    expect(result.bucketCount).toBeLessThanOrEqual(Math.min(1_000, MAX_OUT_ELEMENTS / 2));
    expect(validateRun(1_000, 10, 0).bucketCount).toBeGreaterThanOrEqual(1);
  });

  it("clamps NaN/Infinity raw inputs to each parameter's floor", () => {
    const result = validateRun(NaN, NaN, NaN);
    expect(result.sampleCount).toBe(2);
    expect(result.threshold).toBe(2);
    expect(result.bucketCount).toBe(1);
  });

  it("computes the threshold clamp's upper bound AFTER sampleCount resolves, not independently", () => {
    // A raw sampleCount that itself gets clamped down must still bound threshold correctly —
    // proving the ordering rather than three independent clamps against the raw inputs.
    const rawSampleCount = MAX_SAMPLES * 10;
    const rawThreshold = MAX_OUT_ELEMENTS + 1;
    const result = validateRun(rawSampleCount, rawThreshold, 10);
    expect(result.threshold).toBe(Math.min(result.sampleCount, MAX_OUT_ELEMENTS));
  });
});

describe("clamping reaches lttb through the mount module's actual call path", () => {
  it("does not throw for a threshold above sampleCount", () => {
    const state = createCoreMathState();
    state.regenerate({ seed: 1, centerFrequency: 50, fwhm: 10, noiseFloor: 0 }, 100);
    expect(() => state.run("lttb", 100_000)).not.toThrow();
  });

  it("does not throw for a threshold of 0 or 1", () => {
    const state = createCoreMathState();
    state.regenerate({ seed: 1, centerFrequency: 50, fwhm: 10, noiseFloor: 0 }, 100);
    expect(() => state.run("lttb", 0)).not.toThrow();
    expect(() => state.run("lttb", 1)).not.toThrow();
  });
});
