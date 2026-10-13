/** @vitest-environment node */
import { createViewportTransform, projectX, projectY } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import {
  buildIsolatedMarkers,
  collectIsolatedSampleIndices,
  countIsolatedSegments,
  type MarkerSink,
} from "../../src/path/isolated-markers.js";

class CountingMarkerSink implements MarkerSink {
  calls: Array<{ x: number; y: number; w: number; h: number }> = [];
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ x, y, w, h });
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
  xDomainMax: 100,
  yDomainMin: -10,
  yDomainMax: 10,
  xOrigin: 0,
});

describe("countIsolatedSegments", () => {
  it("counts one isolated segment per single-sample run on the direct path", () => {
    // [1, NaN, 5, NaN, 2, 3]: index 0 alone, index 2 alone, indices 4-5 together (not isolated).
    const y = new Float32Array([1, NaN, 5, NaN, 2, 3]);
    const x = new Float32Array(y.length);
    for (let i = 0; i < x.length; i += 1) x[i] = i;

    const count = countIsolatedSegments(x, y, new Int32Array(0), 0, y.length);

    expect(count).toBe(2);
  });

  it("counts a decimated LTTB singleton (k_s === 1) as one isolated segment", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    // Decimated stream: segment A [0,1] (2 distinct indices), break, singleton [5], break, [8,9].
    const indices = new Int32Array([0, 1, -1, 5, -1, 8, 9]);

    const count = countIsolatedSegments(x, y, indices, indices.length, 0);

    expect(count).toBe(1);
  });

  it("counts a min-max [i, i] bucket between two [-1,-1] buckets as one isolated segment", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    const indices = new Int32Array([-1, -1, 7, 7, -1, -1]);

    const count = countIsolatedSegments(x, y, indices, indices.length, 0);

    expect(count).toBe(1);
  });

  it("counts zero isolated segments for gap-free input", () => {
    const n = 50;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i;
    }

    const count = countIsolatedSegments(x, y, new Int32Array(0), 0, n);

    expect(count).toBe(0);
  });

  it("counts zero isolated segments for a [5, 3] segment of two distinct indices", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    const indices = new Int32Array([5, 3]);

    const count = countIsolatedSegments(x, y, indices, indices.length, 0);

    expect(count).toBe(0);
  });
});

describe("buildIsolatedMarkers", () => {
  it("calls sink.rect with exact (px - s/2, py - s/2, s, s) for an isolated direct-path segment", () => {
    const y = new Float32Array([1, NaN, 5, NaN, 2, 3]);
    const x = new Float32Array(y.length);
    for (let i = 0; i < x.length; i += 1) x[i] = i * 10;
    const sink = new CountingMarkerSink();
    const lineWidthCss = 2;
    const dpr = 1;
    const s = 2 * lineWidthCss * dpr;
    const halfSide = s / 2;

    const drawn = buildIsolatedMarkers(sink, transform, x, y, new Int32Array(0), 0, y.length, halfSide);

    expect(drawn).toBe(2);
    const expectedPxAt2 = projectX(transform, x[2] ?? 0);
    const expectedPyAt2 = projectY(transform, y[2] ?? 0);
    const markerAt2 = sink.calls.find(
      (c) => Math.abs(c.x + halfSide - expectedPxAt2) < 1e-9,
    );
    expect(markerAt2).toBeDefined();
    expect(markerAt2?.x).toBeCloseTo(expectedPxAt2 - s / 2, 9);
    expect(markerAt2?.y).toBeCloseTo(expectedPyAt2 - s / 2, 9);
    expect(markerAt2?.w).toBe(s);
    expect(markerAt2?.h).toBe(s);
  });

  it("draws one marker for a decimated LTTB singleton", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    for (let i = 0; i < 10; i += 1) {
      x[i] = i;
      y[i] = i;
    }
    const indices = new Int32Array([0, 1, -1, 5, -1, 8, 9]);
    const sink = new CountingMarkerSink();

    const drawn = buildIsolatedMarkers(sink, transform, x, y, indices, indices.length, 0, 3);

    expect(drawn).toBe(1);
  });

  it("draws one marker for a min-max [i, i] bucket between two [-1,-1] buckets", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    for (let i = 0; i < 10; i += 1) {
      x[i] = i;
      y[i] = i;
    }
    const indices = new Int32Array([-1, -1, 7, 7, -1, -1]);
    const sink = new CountingMarkerSink();

    const drawn = buildIsolatedMarkers(sink, transform, x, y, indices, indices.length, 0, 3);

    expect(drawn).toBe(1);
  });

  it("draws zero markers for gap-free input", () => {
    const n = 50;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i;
    }
    const sink = new CountingMarkerSink();

    const drawn = buildIsolatedMarkers(sink, transform, x, y, new Int32Array(0), 0, n, 3);

    expect(drawn).toBe(0);
    expect(sink.calls).toHaveLength(0);
  });

  it("draws zero markers for a [5, 3] two-distinct-index segment", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    const indices = new Int32Array([5, 3]);
    const sink = new CountingMarkerSink();

    const drawn = buildIsolatedMarkers(sink, transform, x, y, indices, indices.length, 0, 3);

    expect(drawn).toBe(0);
  });
});

describe("isolated markers allocation", () => {
  it("countIsolatedSegments and buildIsolatedMarkers report 0 GC events under --expose-gc", async () => {
    if (typeof globalThis.gc !== "function") {
      throw new Error("run with --expose-gc");
    }
    const n = 10_000;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i % 20 === 0 ? NaN : i;
    }
    const sink = new CountingMarkerSink();

    let events = 0;
    const observer = new PerformanceObserver((list) => {
      events += list.getEntriesByType("gc").length;
    });
    observer.observe({ entryTypes: ["gc"] });

    for (let i = 0; i < 5; i += 1) {
      countIsolatedSegments(x, y, new Int32Array(0), 0, n);
    }
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    events = 0;

    for (let i = 0; i < 50; i += 1) {
      countIsolatedSegments(x, y, new Int32Array(0), 0, n);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toBe(0);

    sink.calls.length = 0;
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    events = 0;
    for (let i = 0; i < 50; i += 1) {
      sink.calls.length = 0;
      buildIsolatedMarkers(sink, transform, x, y, new Int32Array(0), 0, n, 3);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    expect(events).toBe(0);
  }, 60_000);
});

describe("collectIsolatedSampleIndices", () => {
  it("writes the source index of every isolated direct-path sample and returns their count", () => {
    const y = new Float32Array([1, NaN, 5, NaN, 2, 3]);
    const x = new Float32Array(y.length);
    const out = new Int32Array(4).fill(-9);

    const count = collectIsolatedSampleIndices(x, y, new Int32Array(0), 0, y.length, out);

    expect(count).toBe(2);
    expect(Array.from(out.subarray(0, count))).toEqual([0, 2]);
    expect(out[2]).toBe(-9);
  });

  it("collects the singleton of a decimated stream and the [i, i] min-max bucket", () => {
    const x = new Float32Array(10);
    const y = new Float32Array(10);
    const lttbStream = new Int32Array([0, 1, -1, 5, -1, 8, 9]);
    const minMaxStream = new Int32Array([-1, -1, 7, 7, -1, -1]);
    const out = new Int32Array(4);

    expect(collectIsolatedSampleIndices(x, y, lttbStream, lttbStream.length, 0, out)).toBe(1);
    expect(out[0]).toBe(5);
    expect(collectIsolatedSampleIndices(x, y, minMaxStream, minMaxStream.length, 0, out)).toBe(1);
    expect(out[0]).toBe(7);
  });

  it("agrees with countIsolatedSegments and with the marker painter over random gap patterns", () => {
    let state = 0x9e3779b9;
    const next = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x1_0000_0000;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 1 + Math.floor(next() * 60);
      const x = new Float32Array(n);
      const y = new Float32Array(n);
      const gapRate = next();
      for (let i = 0; i < n; i += 1) {
        x[i] = i;
        y[i] = next() < gapRate ? NaN : next() * 10 - 5;
      }
      // Half the trials run over a decimated stream with `-1` break markers.
      const decimated = trial % 2 === 1;
      let indices = new Int32Array(0);
      let decimatedCount = 0;
      if (decimated) {
        indices = new Int32Array(n);
        for (let i = 0; i < n; i += 1) indices[i] = next() < 0.3 ? -1 : Math.floor(next() * n);
        decimatedCount = n;
      }
      const expected = countIsolatedSegments(x, y, indices, decimatedCount, n);
      const out = new Int32Array(n + 1);
      const count = collectIsolatedSampleIndices(x, y, indices, decimatedCount, n, out);
      expect(count).toBe(expected);

      const sink = new CountingMarkerSink();
      buildIsolatedMarkers(sink, transform, x, y, indices, decimatedCount, n, 1);
      expect(sink.calls).toHaveLength(count);
      for (let k = 0; k < count; k += 1) {
        const source = out[k] ?? -1;
        expect(sink.calls[k]?.x).toBeCloseTo(projectX(transform, x[source] ?? 0) - 1, 9);
        expect(sink.calls[k]?.y).toBeCloseTo(projectY(transform, y[source] ?? 0) - 1, 9);
      }
    }
  });

  it("allocates nothing across repeated walks", async () => {
    if (typeof globalThis.gc !== "function") throw new Error("run with --expose-gc");
    const n = 10_000;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = i;
      y[i] = i % 20 === 0 ? NaN : i;
    }
    const out = new Int32Array(n);
    const none = new Int32Array(0);
    let events = 0;
    const observer = new PerformanceObserver((list) => {
      events += list.getEntriesByType("gc").length;
    });
    observer.observe({ entryTypes: ["gc"] });
    for (let i = 0; i < 5; i += 1) collectIsolatedSampleIndices(x, y, none, 0, n, out);
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    events = 0;
    for (let i = 0; i < 50; i += 1) collectIsolatedSampleIndices(x, y, none, 0, n, out);
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    expect(events).toBe(0);
  }, 60_000);
});
