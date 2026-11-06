import { describe, expect, it } from "vitest";
import {
  createViewportTransform,
  type ViewportTransform,
} from "../../src/viewport/transform.js";

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

// Emulates the vertex-shader X expression `((offset - hi) * one - lo) * scale` with a float32
// rounding after every operation, as a GPU evaluates it. `origin` is the binary64 value the
// shader origin pair is split from; the f64 reference evaluates `(offset - d) * scale` on the
// same float32 offsets, so any difference is purely the float32 arithmetic of the shader.
function emulateShaderX(offsetF32: number, origin: number, scale: number): number {
  const hi = Math.fround(origin);
  const lo = Math.fround(origin - hi);
  const one = 1;
  const diff = Math.fround(offsetF32 - hi);
  const scaled = Math.fround(diff * one);
  const shifted = Math.fround(scaled - lo);
  return Math.fround(shifted * Math.fround(scale));
}

function emulateNaiveSingleFloatX(offsetF32: number, origin: number, scale: number): number {
  const diff = Math.fround(offsetF32 - Math.fround(origin));
  return Math.fround(diff * Math.fround(scale));
}

interface DeepZoomCase {
  readonly xOrigin: number;
  readonly xDomainMin: number;
  readonly xDomainMax: number;
}

function deepZoomTransform(c: DeepZoomCase): ViewportTransform {
  return createViewportTransform({
    cssWidth: 1056,
    cssHeight: 600,
    dpr: 1,
    insetLeft: 56,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
    xDomainMin: c.xDomainMin,
    xDomainMax: c.xDomainMax,
    yDomainMin: -1,
    yDomainMax: 1,
    xOrigin: c.xOrigin,
  });
}

// 1,001 float32 offsets evenly spaced across the offset-space window, as the payload stores them.
function windowOffsets(t: ViewportTransform): Float32Array {
  const count = 1001;
  const out = new Float32Array(count);
  const spanOffset = t.xDomainMax - t.xDomainMin;
  for (let i = 0; i < count; i++) {
    out[i] = t.xOffsetMin + (spanOffset * i) / (count - 1);
  }
  return out;
}

function maxErrorPx(
  t: ViewportTransform,
  emulate: (offsetF32: number, origin: number, scale: number) => number,
  origin: number,
): number {
  const scale = t.plotWidth / (t.xDomainMax - t.xDomainMin);
  const offsets = windowOffsets(t);
  let max = 0;
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i] as number;
    const reference = (offset - t.xOffsetMin) * scale;
    max = Math.max(max, Math.abs(emulate(offset, origin, scale) - reference));
  }
  return max;
}

describe("GPU precision — hi/lo origin split from the offset-space domain minimum", () => {
  const deepZoom = { xOrigin: 1550, xDomainMin: 2550.00002, xDomainMax: 2550.01002 };
  const narrowWindow = { xOrigin: 1550, xDomainMin: 1550.12345, xDomainMax: 1550.12355 };
  const zeroOrigin = { xOrigin: 0, xDomainMin: 1000.00002, xDomainMax: 1000.01002 };
  const shallow = { xOrigin: 0, xDomainMin: 0, xDomainMax: 1500 };

  it("stays under a hundredth of a device pixel at a zero origin (deep and shallow zoom)", () => {
    for (const c of [zeroOrigin, shallow]) {
      const t = deepZoomTransform(c);
      expect(maxErrorPx(t, emulateShaderX, t.xOffsetMin)).toBeLessThan(0.01);
    }
  });

  it("stays under a hundredth of a device pixel at a deep zoom with a non-zero origin", () => {
    const t = deepZoomTransform(deepZoom);
    expect(t.xOffsetMin).toBeCloseTo(1000.00002, 9);
    expect(maxErrorPx(t, emulateShaderX, t.xOffsetMin)).toBeLessThan(0.01);
  });

  it("stays under a hundredth of a device pixel for a narrow window near a non-zero origin", () => {
    const t = deepZoomTransform(narrowWindow);
    expect(maxErrorPx(t, emulateShaderX, t.xOffsetMin)).toBeLessThan(0.01);
  });

  it("a single float32 origin with no lo term misplaces samples by more than a pixel", () => {
    const t = deepZoomTransform(deepZoom);
    expect(maxErrorPx(t, emulateNaiveSingleFloatX, t.xOffsetMin)).toBeGreaterThan(1);
  });

  it("the absolute domain minimum is not a valid shader origin", () => {
    const t = deepZoomTransform(deepZoom);
    expect(maxErrorPx(t, emulateShaderX, t.xDomainMin)).toBeGreaterThan(1);
  });

  it("a float32 cast of the absolute domain minimum is rejected as the shader origin", () => {
    const t = deepZoomTransform(deepZoom);
    const castOnly = Math.fround(t.xDomainMin);
    expect(maxErrorPx(t, emulateNaiveSingleFloatX, castOnly)).toBeGreaterThan(1);
  });

  it("the hi/lo pair reconstructs the binary64 offset-space minimum to float32-pair precision", () => {
    const t = deepZoomTransform(deepZoom);
    const hi = Math.fround(t.xOffsetMin);
    const lo = Math.fround(t.xOffsetMin - hi);
    expect(Math.abs(hi + lo - t.xOffsetMin)).toBeLessThanOrEqual(Math.abs(t.xOffsetMin) * 2 ** -46);
    expect(lo).not.toBe(0);
  });
});
