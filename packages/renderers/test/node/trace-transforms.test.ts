/** @vitest-environment node */
import { readFileSync } from "node:fs";
import {
  AXIS_SIDE_LEFT,
  createSpectrumDataPayload,
  createViewportTransform,
  projectX,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
  type ViewportTransform,
  type YAxisRegistration,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { buildTraceTransforms } from "../../src/layout/trace-transforms.js";

function payloadWithOrigin(xOrigin: number): SpectrumDataPayload {
  return createSpectrumDataPayload({ capacity: 8, xOrigin, xUnit: "nm", yUnit: "dBm" });
}

const AXES: readonly YAxisRegistration[] = [
  { id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -5, domainMax: 5, side: AXIS_SIDE_LEFT },
  { id: "b", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
];

const GEOMETRY = {
  cssWidth: 500,
  cssHeight: 317.4,
  dpr: 1.5,
  insets: { insetLeft: 56, insetRight: 0, insetTop: 0, insetBottom: 28 },
  xDomainMin: 10,
  xDomainMax: 90,
};

describe("buildTraceTransforms", () => {
  it("builds one transform per trace from its own xOrigin, axis domain and scale kind", () => {
    const payloads = [payloadWithOrigin(1000), payloadWithOrigin(2000.5), payloadWithOrigin(0)];
    const axisIndex = new Int32Array([0, 1, 0]);
    const out: ViewportTransform[] = [];

    buildTraceTransforms(AXES, axisIndex, payloads, 3, GEOMETRY, out);

    expect(out).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      const axis = AXES[axisIndex[i] ?? 0];
      const expected = createViewportTransform({
        cssWidth: GEOMETRY.cssWidth,
        cssHeight: GEOMETRY.cssHeight,
        dpr: GEOMETRY.dpr,
        ...GEOMETRY.insets,
        xDomainMin: GEOMETRY.xDomainMin,
        xDomainMax: GEOMETRY.xDomainMax,
        xOrigin: payloads[i]?.xOrigin ?? 0,
        yDomainMin: axis?.domainMin ?? 0,
        yDomainMax: axis?.domainMax ?? 0,
        yScaleKind: axis?.scaleKind ?? Y_SCALE_KIND_LINEAR,
      });
      expect(out[i]).toEqual(expected);
    }
    expect(out[0]?.xOrigin).toBe(1000);
    expect(out[1]?.xOrigin).toBe(2000.5);
    expect(out[1]?.yScaleKind).toBe(Y_SCALE_KIND_LOG);
  });

  it("falls back to the [-1, 1] linear axis for an unbound trace", () => {
    const out: ViewportTransform[] = [];
    buildTraceTransforms(AXES, new Int32Array([-1]), [payloadWithOrigin(0)], 1, GEOMETRY, out);
    expect(out[0]?.yDomainMin).toBe(-1);
    expect(out[0]?.yDomainMax).toBe(1);
    expect(out[0]?.yScaleKind).toBe(Y_SCALE_KIND_LINEAR);
  });

  it("overwrites the caller's array in place and truncates it to the trace count", () => {
    const out: ViewportTransform[] = [];
    buildTraceTransforms(AXES, new Int32Array([0, 0, 0]), [payloadWithOrigin(0), payloadWithOrigin(1), payloadWithOrigin(2)], 3, GEOMETRY, out);
    const first = out;
    buildTraceTransforms(AXES, new Int32Array([0]), [payloadWithOrigin(5)], 1, GEOMETRY, out);
    expect(out).toBe(first);
    expect(out).toHaveLength(1);
    expect(out[0]?.xOrigin).toBe(5);
  });

  it("gives each trace an offset-space left edge of xDomainMin - xOrigin under one absolute domain", () => {
    const geometry = { ...GEOMETRY, xDomainMin: 0, xDomainMax: 299 };
    const payloads = [payloadWithOrigin(0), payloadWithOrigin(1000)];
    const out: ViewportTransform[] = [];

    buildTraceTransforms(AXES, new Int32Array([0, 0]), payloads, 2, geometry, out);

    expect(out[0]?.xDomainMin).toBe(0);
    expect(out[1]?.xDomainMin).toBe(0);
    expect(out[0]?.xOffsetMin).toBe(0);
    expect(out[1]?.xOffsetMin).toBe(-1000);
  });

  it("projects the same absolute X to the same device X whatever the trace origin", () => {
    const geometry = { ...GEOMETRY, xDomainMin: 0, xDomainMax: 299 };
    const payloads = [payloadWithOrigin(0), payloadWithOrigin(1000)];
    const out: ViewportTransform[] = [];
    buildTraceTransforms(AXES, new Int32Array([0, 0]), payloads, 2, geometry, out);
    const [a, b] = out;
    if (a === undefined || b === undefined) throw new Error("missing transform");

    for (let i = 0; i < 300; i += 1) {
      // Absolute X = i: offset i for origin 0, offset i - 1000 for origin 1000.
      expect(projectX(b, i - 1000)).toBe(projectX(a, i));
    }
  });

  it("keeps a non-zero-origin trace inside the plot under an absolute domain", () => {
    const geometry = { ...GEOMETRY, xDomainMin: 1550, xDomainMax: 1551 };
    const out: ViewportTransform[] = [];
    buildTraceTransforms(AXES, new Int32Array([0]), [payloadWithOrigin(1550)], 1, geometry, out);
    const t = out[0];
    if (t === undefined) throw new Error("missing transform");

    expect(projectX(t, 0)).toBe(t.plotLeft);
    expect(projectX(t, 1)).toBeCloseTo(t.plotLeft + t.plotWidth, 9);
    expect(projectX(t, 0.5)).toBeCloseTo(t.plotLeft + t.plotWidth / 2, 9);
  });

  it("imports nothing from the Canvas2D or SVG backends", () => {
    const source = readFileSync(new URL("../../src/layout/trace-transforms.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*\/(canvas2d|svg)\//);
  });
});
