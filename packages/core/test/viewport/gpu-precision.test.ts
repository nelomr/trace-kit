import { describe, expect, it } from "vitest";
import { createViewportTransform } from "../../src/viewport/transform.js";

describe("GPU precision — f64 storage anti-regression", () => {
  it("stores xOrigin without any float32 rounding", () => {
    const t = createViewportTransform({
      cssWidth: 800,
      cssHeight: 600,
      dpr: 1,
      insetLeft: 0,
      insetRight: 0,
      insetTop: 0,
      insetBottom: 0,
      xDomainMin: 1550.0,
      xDomainMax: 1550.5,
      yDomainMin: -1,
      yDomainMax: 1,
      xOrigin: 1550.123456,
    });
    expect(Math.fround(t.xOrigin)).not.toBe(t.xOrigin);
  });

  it("stores xDomainMin/xDomainMax without any float32 rounding", () => {
    const t = createViewportTransform({
      cssWidth: 800,
      cssHeight: 600,
      dpr: 1,
      insetLeft: 0,
      insetRight: 0,
      insetTop: 0,
      insetBottom: 0,
      xDomainMin: 1550.123456,
      xDomainMax: 1550.987654,
      yDomainMin: -1,
      yDomainMax: 1,
      xOrigin: 0,
    });
    expect(Math.fround(t.xDomainMin)).not.toBe(t.xDomainMin);
    expect(Math.fround(t.xDomainMax)).not.toBe(t.xDomainMax);
  });
});

// Fixture magnitude note: at a telecom-band origin magnitude (~1550), float32's ~24-bit
// significand caps the worst-case single-fround rounding error at roughly 0.1 picometre
// (relative precision 2^-24 applied to a ~1550 magnitude), so a naive-path error can never
// exceed 1 picometre at that specific magnitude — no fixture choice at ~1550 can demonstrate
// the failure mode. A larger origin magnitude is used here instead, purely to push the naive
// path's float32 rounding error past the 1 picometre threshold and actually exercise the defect
// this arithmetic proves is real; the prescribed path's error stays governed by the visible span
// alone (the normalized quantity is bounded by the span, not by the absolute origin), so it
// stays sub-picometre regardless of which origin magnitude demonstrates the naive failure.
describe("GPU precision — naive vs prescribed normalization arithmetic", () => {
  const xOrigin = 50_000.123456;
  const xOffset = 1e-6;
  const xDomainMin = 49_999.9;

  it("the naive per-value float32 cast produces an error exceeding 1 picometre", () => {
    const exact = xOrigin + xOffset - xDomainMin;
    const naive = Math.fround(xOrigin + xOffset) - Math.fround(xDomainMin);
    const errorNm = Math.abs(naive - exact);
    const errorPm = errorNm * 1000;
    expect(errorPm).toBeGreaterThan(1);
  });

  it("the prescribed normalize-then-cast path stays below 1 picometre over a 100nm and a 1500nm span", () => {
    function normalizedErrorPm(spanNm: number): number {
      const domainMin = xOrigin - spanNm / 2;
      const domainMax = xOrigin + spanNm / 2;
      const exactNormalized = (xOrigin + xOffset - domainMin) / (domainMax - domainMin);
      const prescribed = Math.fround((xOrigin + xOffset - domainMin) / (domainMax - domainMin));
      // Map the normalized-space error back to nanometres via the span, then to picometres.
      const errorNm = Math.abs(prescribed - exactNormalized) * spanNm;
      return errorNm * 1000;
    }
    expect(normalizedErrorPm(100)).toBeLessThan(1);
    expect(normalizedErrorPm(1500)).toBeLessThan(1);
  });
});
