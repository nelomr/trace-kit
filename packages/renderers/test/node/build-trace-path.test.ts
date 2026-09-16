/** @vitest-environment node */
import { createViewportTransform, projectX, projectY } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { buildTracePath } from "../../src/path/build-trace-path.js";
import type { PolylineSink } from "../../src/path/polyline-sink.js";

class CountingSink implements PolylineSink {
  moveToCalls = 0;
  lineToCalls = 0;
  readonly points: Array<{ x: number; y: number }> = [];

  moveTo(x: number, y: number): void {
    this.moveToCalls += 1;
    this.points.push({ x, y });
  }

  lineTo(x: number, y: number): void {
    this.lineToCalls += 1;
    this.points.push({ x, y });
  }
}

const transform = createViewportTransform({
  cssWidth: 800,
  cssHeight: 400,
  dpr: 1,
  insetLeft: 0,
  insetRight: 0,
  insetTop: 0,
  insetBottom: 0,
  xDomainMin: 0,
  xDomainMax: 1000,
  yDomainMin: -1,
  yDomainMax: 1,
  xOrigin: 0,
});

describe("buildTracePath", () => {
  it("issues exactly 1 moveTo and n - 1 lineTo calls in order for the direct-range bypass path", () => {
    const n = 500;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = Math.sin(i);
    }
    const indices = new Int32Array(0);
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, indices, 0, n);

    expect(count).toBe(n);
    expect(sink.moveToCalls).toBe(1);
    expect(sink.lineToCalls).toBe(n - 1);
  });

  it("issues zero calls for n = 0", () => {
    const sink = new CountingSink();
    const count = buildTracePath(
      sink,
      transform,
      new Float32Array(0),
      new Float32Array(0),
      new Int32Array(0),
      0,
      0,
    );
    expect(count).toBe(0);
    expect(sink.moveToCalls).toBe(0);
    expect(sink.lineToCalls).toBe(0);
  });

  it("projects exactly (projectX(t, x[i]), projectY(t, y[i])) for the direct-range bypass path", () => {
    const n = 10;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i * 37;
      y[i] = i * 0.1 - 0.4;
    }
    const sink = new CountingSink();
    buildTracePath(sink, transform, x, y, new Int32Array(0), 0, n);

    for (let i = 0; i < n; i += 1) {
      const point = sink.points[i];
      expect(point).toBeDefined();
      expect(point?.x).toBe(projectX(transform, x[i] ?? 0));
      expect(point?.y).toBe(projectY(transform, y[i] ?? 0));
    }
  });

  it("projects exactly (projectX(t, x[indices[i]]), projectY(t, y[indices[i]])) for the decimated-index-set path", () => {
    const sampleCount = 100;
    const x = new Float32Array(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      x[i] = i * 5;
      y[i] = Math.cos(i);
    }
    // A hand-picked, non-contiguous, non-monotonic-in-value (but ascending as an index set)
    // decimated index set — exercises the indices[i] indirection distinctly from the identity
    // walk of the bypass path.
    const indices = new Int32Array([0, 3, 7, 20, 99]);
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, indices, indices.length, 0);

    expect(count).toBe(indices.length);
    expect(sink.moveToCalls).toBe(1);
    expect(sink.lineToCalls).toBe(indices.length - 1);
    for (let i = 0; i < indices.length; i += 1) {
      const sampleIndex = indices[i] ?? 0;
      const point = sink.points[i];
      expect(point).toBeDefined();
      expect(point?.x).toBe(projectX(transform, x[sampleIndex] ?? 0));
      expect(point?.y).toBe(projectY(transform, y[sampleIndex] ?? 0));
    }
  });
});
