/** @vitest-environment node */
import { readFileSync } from "node:fs";
import {
  createViewportTransform,
  projectX,
  projectY,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { buildTracePath } from "../../src/path/build-trace-path.js";
import type { PolylineSink } from "../../src/path/polyline-sink.js";
import { GUARD_BAND_PX } from "../../src/rules/guard-band.js";

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

  it("gap-free input still issues exactly 1 moveTo and n - 1 lineTo (500-point case)", () => {
    const n = 500;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = Math.sin(i);
    }
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, new Int32Array(0), 0, n);

    expect(count).toBe(n);
    expect(sink.moveToCalls).toBe(1);
    expect(sink.lineToCalls).toBe(n - 1);
  });

  it("a single interior gap on the direct path splits the sequence into two moveTo-led segments (2/497)", () => {
    const n = 500;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i === 250 ? NaN : Math.sin(i);
    }
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, new Int32Array(0), 0, n);

    expect(count).toBe(n);
    expect(sink.moveToCalls).toBe(2);
    expect(sink.lineToCalls).toBe(n - 1 - 2);
  });

  it("a decimated stream with a -1 break and trailing -1 padding draws two segments and stops at the padding", () => {
    const sampleCount = 100;
    const x = new Float32Array(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      x[i] = i;
      y[i] = i;
    }
    // Segment A: [0, 3, 7]; break; segment B: [20, 99]; trailing padding: [-1, -1].
    const indices = new Int32Array([0, 3, 7, -1, 20, 99, -1, -1]);
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, indices, indices.length, 0);

    expect(count).toBe(indices.length);
    expect(sink.moveToCalls).toBe(2);
    expect(sink.lineToCalls).toBe(3);
  });

  it("all-NaN direct-path input issues zero moveTo and zero lineTo calls", () => {
    const n = 50;
    const x = new Float32Array(n);
    const y = new Float32Array(n).fill(NaN);
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, new Int32Array(0), 0, n);

    expect(count).toBe(n);
    expect(sink.moveToCalls).toBe(0);
    expect(sink.lineToCalls).toBe(0);
  });

  it("a leading gap on the direct path starts the first moveTo at the first finite sample", () => {
    const n = 20;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i < 5 ? NaN : i;
    }
    const sink = new CountingSink();

    buildTracePath(sink, transform, x, y, new Int32Array(0), 0, n);

    expect(sink.moveToCalls).toBe(1);
    expect(sink.points[0]?.x).toBe(projectX(transform, x[5] ?? 0));
  });

  it("a trailing gap on the direct path ends the drawn segment at the last finite sample", () => {
    const n = 20;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i >= 15 ? NaN : i;
    }
    const sink = new CountingSink();

    const count = buildTracePath(sink, transform, x, y, new Int32Array(0), 0, n);

    expect(count).toBe(n);
    expect(sink.moveToCalls).toBe(1);
    expect(sink.lineToCalls).toBe(14);
  });

  it("coordinates within a decimated segment still match the transform's projection", () => {
    const sampleCount = 50;
    const x = new Float32Array(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      x[i] = i * 3;
      y[i] = Math.sin(i * 0.2);
    }
    const indices = new Int32Array([2, 5, -1, 10, 40]);
    const sink = new CountingSink();

    buildTracePath(sink, transform, x, y, indices, indices.length, 0);

    expect(sink.points[0]?.x).toBe(projectX(transform, x[2] ?? 0));
    expect(sink.points[1]?.x).toBe(projectX(transform, x[5] ?? 0));
    expect(sink.points[2]?.x).toBe(projectX(transform, x[10] ?? 0));
    expect(sink.points[3]?.x).toBe(projectX(transform, x[40] ?? 0));
  });
});

describe("buildTracePath with a non-zero origin", () => {
  const originTransform = createViewportTransform({
    cssWidth: 800,
    cssHeight: 400,
    dpr: 1,
    insetLeft: 0,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
    xDomainMin: 0,
    xDomainMax: 299,
    yDomainMin: -1,
    yDomainMax: 1,
    xOrigin: 1000,
  });

  it("walks raw payload offsets and lands them at their absolute X", () => {
    const n = 300;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = -1000 + i;
      y[i] = Math.sin(i);
    }
    const sink = new CountingSink();

    buildTracePath(sink, originTransform, x, y, new Int32Array(0), 0, n);

    expect(sink.points[0]?.x).toBe(originTransform.plotLeft);
    for (let i = 0; i < n; i += 1) {
      expect(sink.points[i]?.x).toBe(originTransform.plotLeft + (i - 0) * originTransform.xScale);
    }
  });

  it("never mentions xOrigin in the per-point loop or the marker pass", () => {
    for (const file of ["build-trace-path.ts", "isolated-markers.ts"]) {
      const source = readFileSync(new URL(`../../src/path/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/xOrigin/);
    }
  });
});


interface SinkCall {
  readonly kind: "moveTo" | "lineTo";
  readonly x: number;
  readonly y: number;
}

class CallLog implements PolylineSink {
  readonly calls: SinkCall[] = [];

  moveTo(x: number, y: number): void {
    this.calls.push({ kind: "moveTo", x, y });
  }

  lineTo(x: number, y: number): void {
    this.calls.push({ kind: "lineTo", x, y });
  }

  count(kind: SinkCall["kind"]): number {
    return this.calls.filter((call) => call.kind === kind).length;
  }

  everyArgumentIsFinite(): boolean {
    return this.calls.every((call) => Number.isFinite(call.x) && Number.isFinite(call.y));
  }
}

// 450 x 330 CSS px at dpr 1, 50 px left and 30 px bottom inset: the plot is x 50..450, y 0..300.
function referenceTransform(
  yMin: number,
  yMax: number,
  options: { readonly xMax?: number; readonly log?: boolean } = {},
): ViewportTransform {
  return createViewportTransform({
    cssWidth: 450,
    cssHeight: 330,
    dpr: 1,
    insetLeft: 50,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 30,
    xDomainMin: 0,
    xDomainMax: options.xMax ?? 4,
    yDomainMin: yMin,
    yDomainMax: yMax,
    xOrigin: 0,
    ...(options.log === true ? { yScaleKind: Y_SCALE_KIND_LOG } : {}),
  });
}

function walkDirect(t: ViewportTransform, xs: readonly number[], ys: readonly number[]): CallLog {
  const sink = new CallLog();
  buildTracePath(sink, t, Float32Array.from(xs), Float32Array.from(ys), new Int32Array(0), 0, xs.length);
  return sink;
}

const TOP = -GUARD_BAND_PX;
const BOTTOM = 300 + GUARD_BAND_PX;

describe("buildTracePath draws infinities to the guard edge", () => {
  const xs = [0, 1, 2, 3, 4];

  it("draws +Infinity on a linear axis to the top guard edge without breaking the line", () => {
    const sink = walkDirect(referenceTransform(0, 1), xs, [0.5, 0.5, Infinity, 0.5, 0.5]);
    expect(sink.calls).toEqual([
      { kind: "moveTo", x: 50, y: 150 },
      { kind: "lineTo", x: 150, y: 150 },
      { kind: "lineTo", x: 250, y: TOP },
      { kind: "lineTo", x: 350, y: 150 },
      { kind: "lineTo", x: 450, y: 150 },
    ]);
  });

  it("draws -Infinity on a linear axis to the bottom guard edge", () => {
    const sink = walkDirect(referenceTransform(0, 1), xs, [0.5, 0.5, -Infinity, 0.5, 0.5]);
    expect(sink.calls[2]).toEqual({ kind: "lineTo", x: 250, y: BOTTOM });
    expect(sink.count("moveTo")).toBe(1);
    expect(sink.count("lineTo")).toBe(4);
  });

  it("sends +Infinity to the bottom edge on an inverted axis", () => {
    const sink = walkDirect(referenceTransform(1, 0), xs, [0.5, 0.5, Infinity, 0.5, 0.5]);
    expect(sink.calls[2]).toEqual({ kind: "lineTo", x: 250, y: BOTTOM });
  });

  it("keeps every coordinate finite on a zero-span axis", () => {
    const sink = walkDirect(referenceTransform(0.5, 0.5), [0, 1, 2], [0.5, Infinity, -Infinity]);
    expect(sink.calls.map((call) => call.y)).toEqual([300, TOP, BOTTOM]);
  });

  it("draws +Infinity on a log axis to the top guard edge", () => {
    const sink = walkDirect(referenceTransform(1, 1000, { log: true }), [0, 1, 2], [10, Infinity, 100]);
    expect(sink.calls).toEqual([
      { kind: "moveTo", x: 50, y: 200 },
      { kind: "lineTo", x: 150, y: TOP },
      { kind: "lineTo", x: 250, y: 100 },
    ]);
  });

  it("clamps huge finite coordinates into the guard band", () => {
    const sink = walkDirect(referenceTransform(0, 1), [0, 1e30, 2], [0.5, 1e30, 0.5]);
    expect(sink.calls[1]).toEqual({ kind: "lineTo", x: 450 + GUARD_BAND_PX, y: TOP });
    expect(sink.everyArgumentIsFinite()).toBe(true);
  });

  it("leaves in-band coordinates identical to the plain projection", () => {
    const linear = referenceTransform(0, 1);
    const log = referenceTransform(1, 1000, { log: true });
    const ys = [0.25, 0.5, 0.75, 0.1, 0.9];
    const logYs = [1.5, 10, 100, 999, 3];
    const linearWalk = walkDirect(linear, xs, ys);
    const logWalk = walkDirect(log, xs, logYs);
    for (let i = 0; i < xs.length; i += 1) {
      expect(linearWalk.calls[i]?.x).toBe(projectX(linear, xs[i] ?? 0));
      expect(linearWalk.calls[i]?.y).toBe(projectY(linear, Math.fround(ys[i] ?? 0)));
      expect(logWalk.calls[i]?.y).toBe(projectY(log, Math.fround(logYs[i] ?? 0)));
    }
  });
});

describe("buildTracePath lifts the pen on a log axis for non-positive samples", () => {
  const log = referenceTransform(1, 1000, { log: true, xMax: 2 });

  it("does not bridge a zero between two positive samples", () => {
    const sink = walkDirect(log, [0, 1, 2], [10, 0, 100]);
    expect(sink.calls).toEqual([
      { kind: "moveTo", x: 50, y: 200 },
      { kind: "moveTo", x: 450, y: 100 },
    ]);
  });

  it.each([
    ["-Infinity", -Infinity],
    ["a negative value", -5],
  ])("does not bridge %s", (_name, bad) => {
    const sink = walkDirect(log, [0, 1, 2], [10, bad, 100]);
    expect(sink.count("moveTo")).toBe(2);
    expect(sink.count("lineTo")).toBe(0);
    expect(sink.everyArgumentIsFinite()).toBe(true);
  });

  it("draws the segments on either side of a non-positive run and never spans it", () => {
    const wide = referenceTransform(1, 1000, { log: true, xMax: 5 });
    const sink = walkDirect(wide, [0, 1, 2, 3, 4, 5], [10, 20, -5, 0, 30, 40]);
    expect(sink.calls.map((call) => call.kind)).toEqual(["moveTo", "lineTo", "moveTo", "lineTo"]);
    expect(sink.calls[1]?.x).toBe(projectX(wide, 1));
    expect(sink.calls[2]?.x).toBe(projectX(wide, 4));
  });

  it("still draws zero and negative samples on a linear axis", () => {
    const sink = walkDirect(referenceTransform(-1, 1), [0, 1, 2], [0.5, 0, -0.5]);
    expect(sink.count("moveTo")).toBe(1);
    expect(sink.count("lineTo")).toBe(2);
  });

  it("treats NaN next to a zero as one break", () => {
    const wide = referenceTransform(1, 1000, { log: true, xMax: 4 });
    const sink = walkDirect(wide, [0, 1, 2, 3, 4], [10, NaN, 0, 100, 200]);
    expect(sink.calls.map((call) => call.kind)).toEqual(["moveTo", "moveTo", "lineTo"]);
    expect(sink.calls[1]?.x).toBe(projectX(wide, 3));
  });

  it("applies the same break to a decimated index stream pointing at a zero sample", () => {
    const wide = referenceTransform(1, 1000, { log: true, xMax: 3 });
    const x = Float32Array.from([0, 1, 2, 3]);
    const y = Float32Array.from([10, 0, 100, 20]);
    const indices = Int32Array.from([0, 1, 2, 3]);
    const sink = new CallLog();
    buildTracePath(sink, wide, x, y, indices, indices.length, 0);
    expect(sink.calls.map((call) => call.kind)).toEqual(["moveTo", "moveTo", "lineTo"]);
    expect(sink.calls[1]?.x).toBe(projectX(wide, 2));
  });
});
