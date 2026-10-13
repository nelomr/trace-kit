/** @vitest-environment node */
import { createViewportTransform, projectY, Y_SCALE_KIND_LOG } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { LOG10_2, splitFloat64ToHiLo } from "../../src/webgl2/precision.js";
import { LINE_VERTEX_SHADER, MARKER_VERTEX_SHADER } from "../../src/webgl2/shaders.js";
import { extractXProjection } from "./support/shader-source.js";

const f = Math.fround;

/**
 * The shader's `projectXDevice` arithmetic with every intermediate rounded to float32, which is
 * what a `highp` GPU does when it keeps the written evaluation order.
 */
function emulateX(offset: number, row: Float32Array, scale: number, plotLeft: number): number {
  const hi = row[0] ?? 0;
  const lo = row[1] ?? 0;
  const one = 1;
  return f(f(f(f(f(offset - hi) * f(one)) - lo) * f(scale)) + f(plotLeft));
}

interface ZoomCase {
  readonly d: number;
  readonly span: number;
  readonly plotLeft: number;
  readonly plotWidth: number;
  readonly count: number;
}

function offsetsFor(c: ZoomCase): Float32Array {
  const offsets = new Float32Array(c.count);
  for (let i = 0; i < c.count; i += 1) offsets[i] = c.d + (i / (c.count - 1)) * c.span;
  return offsets;
}

/** Largest device-pixel disagreement between the emulation and the Float64 reference. */
function maxEmulationError(c: ZoomCase, useLo: boolean): number {
  const row = new Float32Array(2);
  splitFloat64ToHiLo(c.d, row, 0);
  if (!useLo) row[1] = 0;
  const scale64 = c.plotWidth / c.span;
  const offsets = offsetsFor(c);
  let worst = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const offset = offsets[i] ?? 0;
    const reference = c.plotLeft + (offset - c.d) * scale64;
    worst = Math.max(worst, Math.abs(emulateX(offset, row, scale64, c.plotLeft) - reference));
  }
  return worst;
}

describe("splitFloat64ToHiLo", () => {
  it("stores hi = fround(value) and the float32 residual as lo", () => {
    const out = new Float32Array(4);
    const value = 1000.00002;
    splitFloat64ToHiLo(value, out, 2);

    expect(out[2]).toBe(Math.fround(value));
    expect(out[3]).toBe(Math.fround(value - Math.fround(value)));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it("recovers the Float64 value to the float32 precision of the residual", () => {
    const out = new Float32Array(2);
    for (const value of [1000.00002, 123456.789, -98765.4321, 0.1, 0]) {
      splitFloat64ToHiLo(value, out, 0);
      const recovered = (out[0] ?? 0) + (out[1] ?? 0);
      // The residual is below half an ulp of `hi`, and float32 keeps 24 of its bits.
      expect(Math.abs(recovered - value)).toBeLessThanOrEqual(Math.abs(value) * 2 ** -47 + 1e-30);
    }
  });

  it("gives traces sharing one domain identical pairs and distinct domains their own", () => {
    const rows = new Float32Array(6);
    splitFloat64ToHiLo(1000.00002, rows, 0);
    splitFloat64ToHiLo(1000.00002, rows, 2);
    splitFloat64ToHiLo(2000.00007, rows, 4);

    expect([rows[0], rows[1]]).toEqual([rows[2], rows[3]]);
    expect([rows[0], rows[1]]).not.toEqual([rows[4], rows[5]]);
  });
});

describe("X projection emulation against a Float64 reference", () => {
  it("stays under 0.01 device px at deep zoom (span 0.01 around 1000.00002)", () => {
    const deep: ZoomCase = { d: 1000.00002, span: 0.01, plotLeft: 56, plotWidth: 1000, count: 1001 };
    expect(maxEmulationError(deep, true)).toBeLessThan(0.01);
  });

  it("is not vacuous: a single-float origin drifts by more than a pixel at deep zoom", () => {
    const deep: ZoomCase = { d: 1000.00002, span: 0.01, plotLeft: 56, plotWidth: 1000, count: 1001 };
    expect(maxEmulationError(deep, false)).toBeGreaterThan(1);
  });

  it("stays under 0.01 device px at shallow zoom (span 1500)", () => {
    const shallow: ZoomCase = { d: 1000.00002, span: 1500, plotLeft: 56, plotWidth: 1000, count: 1001 };
    expect(maxEmulationError(shallow, true)).toBeLessThan(0.01);
  });
});

describe("log Y emulation against projectY", () => {
  it("stays under 0.01 device px for decade and in-between samples", () => {
    const t = createViewportTransform({
      cssWidth: 800,
      cssHeight: 400,
      dpr: 2,
      insetLeft: 0,
      insetRight: 0,
      insetTop: 0,
      insetBottom: 0,
      xDomainMin: 0,
      xDomainMax: 1,
      yDomainMin: 1,
      yDomainMax: 1000,
      xOrigin: 0,
      yScaleKind: Y_SCALE_KIND_LOG,
    });
    for (const y of [1, 2.5, 10, 999]) {
      const emulated = f(
        f(t.yBase) -
          f(f(f(f(Math.log2(f(y))) * f(LOG10_2)) - f(t.yLogDomainMin)) * f(t.yLogScale)),
      );
      expect(Math.abs(emulated - projectY(t, y))).toBeLessThan(0.01);
    }
  });

  it("uses the base-10 conversion constant 0.30102999566398120", () => {
    expect(LOG10_2).toBe(0.3010299956639812);
    expect(Math.abs(LOG10_2 - Math.log10(2))).toBeLessThan(1e-16);
  });
});

describe("shader binding of the X evaluation order", () => {
  // The emulation above is only a faithful model of the GPU when the shader really evaluates
  // `((offset - hi) * one - lo) * scale + plotLeft` in that order.
  const MODELLED = "((offset-hi)*one-lo)*scale+plotLeft";

  it("extracts the modelled expression from both vertex shaders", () => {
    expect(extractXProjection(LINE_VERTEX_SHADER)).toBe(MODELLED);
    expect(extractXProjection(MARKER_VERTEX_SHADER)).toBe(MODELLED);
  });

  it("rejects a reassociated copy, so the check is not vacuous", () => {
    const reassociated = LINE_VERTEX_SHADER.replace(
      "((offset - hi) * one - lo) * scale + plotLeft",
      "(offset - (hi + lo)) * scale + plotLeft",
    );
    expect(reassociated).not.toBe(LINE_VERTEX_SHADER);
    expect(extractXProjection(reassociated)).not.toBe(MODELLED);
    const withoutBarrier = LINE_VERTEX_SHADER.replace(
      "((offset - hi) * one - lo) * scale + plotLeft",
      "((offset - hi) - lo) * scale + plotLeft",
    );
    expect(withoutBarrier).not.toBe(LINE_VERTEX_SHADER);
    expect(extractXProjection(withoutBarrier)).not.toBe(MODELLED);
  });
});
