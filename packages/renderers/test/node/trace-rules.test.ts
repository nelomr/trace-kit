/** @vitest-environment node */
import {
  allocateIndexBuffer,
  lttb,
  minMaxEnvelopeIndices,
  resolveDecimationParameter,
  type TraceStyle,
} from "@trace-kit/core";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isolatedMarkerHalfSide } from "../../src/path/isolated-markers.js";
import {
  decimateTraceIndices,
  deriveDecimationTarget,
  resolveDecimationTarget,
} from "../../src/rules/decimation.js";
import { resolveTraceStyle } from "../../src/rules/trace-style.js";
import { DEFAULT_FIGURE_STYLE, TRACE_PALETTE } from "../../src/style.js";

describe("deriveDecimationTarget", () => {
  it.each([
    [1_000_000, 700, 1400],
    [100, 700, 100],
    [5, 0, 2],
    [1, 0, 1],
  ])("(%d samples, plot width %d) -> %d", (sampleCount, plotWidth, expected) => {
    expect(deriveDecimationTarget(sampleCount, plotWidth)).toBe(expected);
  });

  it("equals core's default-lttb resolution over a property sweep", () => {
    for (const plotWidth of [0, 1, 1.5, 99, 700, 1599.5, 4000]) {
      for (const sampleCount of [1, 2, 3, 50, 1400, 1401, 100_000]) {
        expect(deriveDecimationTarget(sampleCount, plotWidth)).toBe(
          resolveDecimationParameter({ algorithm: "lttb" }, plotWidth, sampleCount),
        );
      }
    }
  });
});

describe("resolveDecimationTarget", () => {
  it("uses the derived target for default lttb", () => {
    expect(resolveDecimationTarget({ algorithm: "lttb" }, 700, 1_000_000)).toBe(1400);
  });

  it("delegates an explicit threshold or a min-max selection to core", () => {
    expect(resolveDecimationTarget({ algorithm: "lttb", threshold: 50 }, 700, 1_000)).toBe(50);
    expect(resolveDecimationTarget({ algorithm: "min-max" }, 700, 1_000_000)).toBe(
      resolveDecimationParameter({ algorithm: "min-max" }, 700, 1_000_000),
    );
  });
});

describe("resolveTraceStyle", () => {
  it("cycles the palette by trace index when no colour is given", () => {
    const style: TraceStyle = {};
    for (let i = 0; i < TRACE_PALETTE.length * 2; i += 1) {
      expect(resolveTraceStyle(style, i, DEFAULT_FIGURE_STYLE).color).toBe(
        TRACE_PALETTE[i % TRACE_PALETTE.length],
      );
    }
  });

  it("applies the figure line width and enables isolated markers by default", () => {
    const resolved = resolveTraceStyle({}, 0, DEFAULT_FIGURE_STYLE);
    expect(resolved.lineWidthCss).toBe(DEFAULT_FIGURE_STYLE.lineWidthCss);
    expect(resolved.markIsolatedSamples).toBe(true);
    expect(resolved.dashCss.length).toBe(0);
  });

  it("lets an explicit style win and shares one frozen empty dash", () => {
    const explicit = resolveTraceStyle(
      { color: "#123456", lineWidthCss: 3, dash: [4, 2], markIsolatedSamples: false },
      0,
      DEFAULT_FIGURE_STYLE,
    );
    expect(explicit.color).toBe("#123456");
    expect(explicit.lineWidthCss).toBe(3);
    expect(explicit.dashCss).toEqual([4, 2]);
    expect(explicit.markIsolatedSamples).toBe(false);

    const a = resolveTraceStyle({ dash: [] }, 0, DEFAULT_FIGURE_STYLE);
    const b = resolveTraceStyle({}, 1, DEFAULT_FIGURE_STYLE);
    expect(a.dashCss).toBe(b.dashCss);
    expect(Object.isFrozen(a.dashCss)).toBe(true);
  });
});

describe("isolatedMarkerHalfSide", () => {
  it("is the line width scaled to device pixels", () => {
    expect(isolatedMarkerHalfSide(1.5, 2)).toBe(3);
    expect(isolatedMarkerHalfSide(1, 1)).toBe(1);
  });
});

describe("decimateTraceIndices", () => {
  function fragmented(): { x: Float32Array; y: Float32Array } {
    const n = 100;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i % 2 === 0 ? i : NaN;
    }
    return { x, y };
  }

  it("matches lttb for a feasible input", () => {
    const n = 500;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = Math.sin(i / 7);
    }
    const expected = allocateIndexBuffer(40);
    const actual = allocateIndexBuffer(40);
    const expectedCount = lttb(x, y, 0, n, expected, 0, 40);
    const actualCount = decimateTraceIndices("lttb", 40, x, y, n, actual);
    expect(actualCount).toBe(expectedCount);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it("falls back to the min-max envelope when lttb is infeasible, within capacity", () => {
    const { x, y } = fragmented();
    const probe = allocateIndexBuffer(10);
    expect(lttb(x, y, 0, 100, probe, 0, 10)).toBe(0);

    const indices = allocateIndexBuffer(10);
    const count = decimateTraceIndices("lttb", 10, x, y, 100, indices);
    const reference = allocateIndexBuffer(10);
    const referenceCount = minMaxEnvelopeIndices(y, 0, 100, reference, 0, 5);
    expect(count).toBe(referenceCount);
    expect(count).toBeLessThanOrEqual(indices.length);
    expect(Array.from(indices)).toEqual(Array.from(reference));
  });

  it("runs the min-max envelope directly for the min-max algorithm", () => {
    const { x, y } = fragmented();
    const indices = allocateIndexBuffer(12);
    const reference = allocateIndexBuffer(12);
    expect(decimateTraceIndices("min-max", 6, x, y, 100, indices)).toBe(
      minMaxEnvelopeIndices(y, 0, 100, reference, 0, 6),
    );
    expect(Array.from(indices)).toEqual(Array.from(reference));
  });
});

describe("backend neutrality of rules/ and path/", () => {
  const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
  const files = [
    ...readdirSync(`${srcDir}rules`).map((f) => `rules/${f}`),
    ...readdirSync(`${srcDir}path`).map((f) => `path/${f}`),
  ];

  it("has rules modules to audit", () => {
    expect(files.filter((f) => f.startsWith("rules/")).length).toBeGreaterThanOrEqual(2);
  });

  it.each(files)("%s imports no backend module and no browser global", (file) => {
    const source = readFileSync(`${srcDir}${file}`, "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*\/(canvas2d|svg)\//);
    if (file.startsWith("rules/")) {
      expect(source).not.toMatch(/\b(document|window|HTMLCanvasElement|OffscreenCanvas|Path2D)\b/);
    }
  });
});
