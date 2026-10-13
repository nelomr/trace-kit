import { describe, expect, it } from "vitest";
import {
  createSampleSpan,
  resolveSampleWindow,
  type SampleSpan,
} from "../../src/viewport/window.js";
import * as rootEntry from "../../src/index.js";
import { buildPayload, payloadFromAbsoluteX } from "../support/payload-builder.js";

function span(
  absoluteX: readonly number[],
  xMin: number,
  xMax: number,
  includeNeighbours = false,
): { start: number; end: number } {
  const out = createSampleSpan();
  const result = resolveSampleWindow(payloadFromAbsoluteX(absoluteX), xMin, xMax, out, {
    includeNeighbours,
  });
  expect(result).toBe(out);
  return { start: out.start, end: out.end };
}

describe("resolveSampleWindow: membership", () => {
  it("decides on absolute X, not on the stored offset", () => {
    const payload = buildPayload({ xOrigin: 1550, x: [0, 0.25, 0.5, 0.75, 1] });
    const out = createSampleSpan();
    resolveSampleWindow(payload, 1550.25, 1550.75, out);
    expect({ start: out.start, end: out.end }).toEqual({ start: 1, end: 4 });
  });

  it("ignores stale samples beyond sampleCount", () => {
    const payload = buildPayload({
      x: [1, 2, 3, 4],
      capacity: 8,
      staleTail: 2.5,
    });
    const out = createSampleSpan();
    resolveSampleWindow(payload, 2, 3, out);
    expect(out.end).toBeLessThanOrEqual(4);
    resolveSampleWindow(payload, 2.5, 2.5, out);
    expect(out.start).toBe(out.end);
    resolveSampleWindow(payload, -Infinity, Infinity, out);
    expect({ start: out.start, end: out.end }).toEqual({ start: 0, end: 4 });
  });

  it("returns the caller's record and only integer indices (a view, not a copy)", () => {
    const payload = payloadFromAbsoluteX([1, 2, 3]);
    const out: SampleSpan = createSampleSpan();
    const result = resolveSampleWindow(payload, 1, 3, out);
    expect(result).toBe(out);
    expect(Object.keys(result).sort()).toEqual(["end", "start"]);
    expect(Number.isInteger(result.start)).toBe(true);
    expect(Number.isInteger(result.end)).toBe(true);
  });
});

describe("resolveSampleWindow: inclusive bounds and plateaus", () => {
  it("includes both bounds on exact hits", () => {
    expect(span([1, 2, 3, 4, 5], 2, 4)).toEqual({ start: 1, end: 4 });
  });

  it("includes a whole plateau at the lower boundary", () => {
    expect(span([1, 2, 2, 2, 3], 2, 3)).toEqual({ start: 1, end: 5 });
  });

  it("includes a whole plateau at the upper boundary", () => {
    expect(span([1, 2, 2, 2, 3], 1, 2)).toEqual({ start: 0, end: 4 });
  });

  it("selects a whole plateau for a zero-width window", () => {
    expect(span([1, 2, 2, 2, 3], 2, 2)).toEqual({ start: 1, end: 4 });
  });

  it("does not let gaps in Y change the span", () => {
    const x = [1, 2, 3, 4, 5];
    const finite = buildPayload({ x, y: [1, 2, 3, 4, 5] });
    const gapped = buildPayload({ x, y: [1, NaN, NaN, 4, NaN] });
    const a = createSampleSpan();
    const b = createSampleSpan();
    resolveSampleWindow(finite, 2, 5, a);
    resolveSampleWindow(gapped, 2, 5, b);
    expect(b).toEqual(a);
  });
});

describe("resolveSampleWindow: neighbours", () => {
  it("extends both sides", () => {
    expect(span([1, 2, 3, 4, 5], 2, 4, true)).toEqual({ start: 0, end: 5 });
  });

  it("clamps at the payload bounds", () => {
    expect(span([1, 2, 3], 1, 3, true)).toEqual({ start: 0, end: 3 });
  });

  it("adds only the adjacent sample around a plateau", () => {
    expect(span([1, 2, 2, 2, 3, 4], 3, 3, true)).toEqual({ start: 3, end: 6 });
  });

  it("brackets a window that lies between two samples", () => {
    expect(span([1, 2, 3, 4], 2.25, 2.75)).toEqual({ start: 2, end: 2 });
    expect(span([1, 2, 3, 4], 2.25, 2.75, true)).toEqual({ start: 1, end: 3 });
  });

  it("is strict when the option is omitted", () => {
    const out = createSampleSpan();
    resolveSampleWindow(payloadFromAbsoluteX([1, 2, 3, 4, 5]), 2, 4, out);
    expect({ start: out.start, end: out.end }).toEqual({ start: 1, end: 4 });
  });
});

describe("resolveSampleWindow: empty and degenerate windows", () => {
  it("is empty for a window wholly below the data, with and without neighbours", () => {
    for (const neighbours of [false, true]) {
      const result = span([10, 20, 30], 1, 5, neighbours);
      expect(result.start).toBe(result.end);
    }
  });

  it("is empty for a window wholly above the data, with and without neighbours", () => {
    for (const neighbours of [false, true]) {
      const result = span([10, 20, 30], 40, 50, neighbours);
      expect(result.start).toBe(result.end);
    }
  });

  it("is empty for a zero-sample payload", () => {
    const empty = buildPayload({ x: [], capacity: 4, staleTail: 1 });
    const out = createSampleSpan();
    resolveSampleWindow(empty, -Infinity, Infinity, out, { includeNeighbours: true });
    expect({ start: out.start, end: out.end }).toEqual({ start: 0, end: 0 });
  });

  it("is empty for an inverted window without throwing", () => {
    const result = span([1, 2, 3], 3, 1);
    expect(result.start).toBe(result.end);
  });

  it("is empty for a NaN bound", () => {
    for (const [lo, hi] of [
      [NaN, 3],
      [1, NaN],
      [NaN, NaN],
    ] as const) {
      const result = span([1, 2, 3], lo, hi);
      expect(result.start).toBe(result.end);
    }
  });

  it("supports open-ended windows", () => {
    expect(span([1, 2, 3], -Infinity, Infinity)).toEqual({ start: 0, end: 3 });
    expect(span([1, 2, 3], 2, Infinity)).toEqual({ start: 1, end: 3 });
    expect(span([1, 2, 3], -Infinity, 2)).toEqual({ start: 0, end: 2 });
  });

  it("handles a single-sample payload inside and outside the window", () => {
    expect(span([5], 4, 6)).toEqual({ start: 0, end: 1 });
    const outside = span([5], 6, 7);
    expect(outside.start).toBe(outside.end);
  });

  it("stays in bounds on a descending sweep", () => {
    const result = span([5, 4, 3, 2, 1], 2, 4);
    expect(result.start).toBeGreaterThanOrEqual(0);
    expect(result.start).toBeLessThanOrEqual(result.end);
    expect(result.end).toBeLessThanOrEqual(5);
  });
});

describe("root entry", () => {
  it("exports the resolver and the span factory", () => {
    expect(rootEntry.resolveSampleWindow).toBe(resolveSampleWindow);
    expect(rootEntry.createSampleSpan).toBe(createSampleSpan);
  });
});
