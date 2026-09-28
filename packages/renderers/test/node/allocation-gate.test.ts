/** @vitest-environment node */
import { createViewportTransform } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { buildTracePath } from "../../src/path/build-trace-path.js";
import type { PolylineSink } from "../../src/path/polyline-sink.js";

const SAMPLE_COUNT = 100_000;
// Roughly 2x a 1920px-wide viewport — the decimation oversample target that keeps sub-pixel
// detail visible under panning without rendering more points than the display can resolve.
const DECIMATED_COUNT = 3_840;

const transform = createViewportTransform({
  cssWidth: 1920,
  cssHeight: 1080,
  dpr: 1,
  insetLeft: 0,
  insetRight: 0,
  insetTop: 0,
  insetBottom: 0,
  xDomainMin: 0,
  xDomainMax: SAMPLE_COUNT,
  yDomainMin: -1,
  yDomainMax: 1,
  xOrigin: 0,
});

const x = new Float32Array(SAMPLE_COUNT);
const y = new Float32Array(SAMPLE_COUNT);
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  x[i] = i;
  y[i] = Math.sin(i * 0.001);
}
const indices = new Int32Array(DECIMATED_COUNT);
for (let i = 0; i < DECIMATED_COUNT; i += 1) {
  indices[i] = Math.floor((i * SAMPLE_COUNT) / DECIMATED_COUNT);
}

/** Preallocated no-op sink: the real production shape, allocates nothing per call. */
class NoopSink implements PolylineSink {
  moveTo(x: number, y: number): void {
    void x;
    void y;
  }
  lineTo(x: number, y: number): void {
    void x;
    void y;
  }
}

/**
 * Deliberately allocating control sink — constructs a `{x, y}` object per `lineTo` call, unlike
 * the real production sink. Proves the GC-event observer is live in this project: a gate that
 * cannot fail is not a gate.
 */
class AllocatingControlSink implements PolylineSink {
  last: { x: number; y: number } | null = null;
  moveTo(x: number, y: number): void {
    this.last = { x, y };
  }
  lineTo(x: number, y: number): void {
    this.last = { x, y };
  }
}

async function countGcEvents(run: () => void): Promise<number> {
  if (typeof globalThis.gc !== "function") {
    throw new Error("run with --expose-gc");
  }
  let events = 0;
  const observer = new PerformanceObserver((list) => {
    events += list.getEntriesByType("gc").length;
  });
  observer.observe({ entryTypes: ["gc"] });

  for (let i = 0; i < 5; i += 1) {
    run();
  }
  globalThis.gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
  events = 0;

  for (let i = 0; i < 50; i += 1) {
    run();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer.disconnect();
  return events;
}

describe("buildTracePath allocation gate", () => {
  it("reports 0 GC events driven by a preallocated counting sink over 100,000 samples decimated to ~2x1920", async () => {
    const sink = new NoopSink();
    const events = await countGcEvents(() => {
      buildTracePath(sink, transform, x, y, indices, DECIMATED_COUNT, 0);
    });
    expect(events).toBe(0);
  }, 60_000);

  it("the allocating control sink reports non-zero GC events under the same instrumentation", async () => {
    const sink = new AllocatingControlSink();
    if (typeof globalThis.gc !== "function") {
      throw new Error("run with --expose-gc");
    }
    let events = 0;
    const observer = new PerformanceObserver((list) => {
      events += list.getEntriesByType("gc").length;
    });
    observer.observe({ entryTypes: ["gc"] });
    for (let i = 0; i < 200; i += 1) {
      buildTracePath(sink, transform, x, y, indices, DECIMATED_COUNT, 0);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    expect(events).toBeGreaterThan(0);
  }, 60_000);

  it("reports 0 GC events for gap-free input with a decimated -1 break stream (5% break pattern)", async () => {
    const sink = new NoopSink();
    const gappedIndices = new Int32Array(DECIMATED_COUNT);
    for (let i = 0; i < DECIMATED_COUNT; i += 1) {
      gappedIndices[i] =
        i % 20 === 0 ? -1 : Math.floor((i * SAMPLE_COUNT) / DECIMATED_COUNT);
    }
    const events = await countGcEvents(() => {
      buildTracePath(sink, transform, x, y, gappedIndices, DECIMATED_COUNT, 0);
    });
    expect(events).toBe(0);
  }, 60_000);

  it("reports 0 GC events for the direct-range path over gap-containing input (5% NaN pattern)", async () => {
    const sink = new NoopSink();
    const gappedY = new Float32Array(SAMPLE_COUNT);
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      gappedY[i] = i % 20 === 0 ? NaN : Math.sin(i * 0.001);
    }
    const events = await countGcEvents(() => {
      buildTracePath(sink, transform, x, gappedY, new Int32Array(0), 0, SAMPLE_COUNT);
    });
    expect(events).toBe(0);
  }, 60_000);
});
