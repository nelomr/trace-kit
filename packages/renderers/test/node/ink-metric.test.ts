/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  columnExtents,
  compareExtents,
  gapViolations,
  hasInkAround,
  inkLabels,
  insetPlotRect,
  outsideRectDifferences,
  type Pixels,
  type Rgb,
} from "../visual/support/ink-metric.js";
import { INK_DELTA, K_INSET, K_ROWS, P_COLUMNS, P_MISSING } from "../visual/support/webgl2-tolerances.js";

const BG: Rgb = [10, 15, 20];
const GRID: Rgb = [28, 37, 48];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];

function image(width: number, height: number): Pixels & { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = BG[0];
    data[i * 4 + 1] = BG[1];
    data[i * 4 + 2] = BG[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function paint(img: Pixels & { data: Uint8ClampedArray }, x: number, y: number, color: Rgb): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = color[0];
  img.data[i + 1] = color[1];
  img.data[i + 2] = color[2];
}

const PALETTE = { background: BG, grid: GRID, traces: [RED, BLUE] };
const RECT = { left: 0, top: 0, width: 40, height: 20 };

describe("insetPlotRect", () => {
  it("shrinks the plot rectangle by K_INSET on every side", () => {
    const rect = insetPlotRect({ plotLeft: 56, plotTop: 0, plotWidth: 700, plotHeight: 300 }, K_INSET);
    expect(rect).toEqual({ left: 56 + K_INSET, top: K_INSET, width: 700 - 2 * K_INSET, height: 300 - 2 * K_INSET });
  });
});

describe("inkLabels", () => {
  it("attributes ink to the nearest trace colour and ignores background and grid", () => {
    const img = image(40, 20);
    paint(img, 3, 4, RED);
    paint(img, 5, 6, BLUE);
    paint(img, 7, 8, [GRID[0], GRID[1], GRID[2]]);
    paint(img, 9, 9, [200, 30, 30]); // reddish
    const labels = inkLabels(img, RECT, PALETTE, INK_DELTA);

    expect(labels[4 * 40 + 3]).toBe(0);
    expect(labels[6 * 40 + 5]).toBe(1);
    expect(labels[8 * 40 + 7]).toBe(-1);
    expect(labels[9 * 40 + 9]).toBe(0);
    expect(labels[0]).toBe(-1);
  });

  it("does not count a pixel whose distance from the background is at most the ink delta", () => {
    const img = image(40, 20);
    paint(img, 2, 2, [BG[0] + INK_DELTA, BG[1], BG[2]]);
    expect(inkLabels(img, RECT, PALETTE, INK_DELTA)[2 * 40 + 2]).toBe(-1);
  });
});

describe("columnExtents", () => {
  it("returns first and last ink row per column, -1 where a trace has none", () => {
    const img = image(40, 20);
    paint(img, 5, 3, RED);
    paint(img, 5, 12, RED);
    paint(img, 5, 7, BLUE);
    paint(img, 6, 9, RED);
    const labels = inkLabels(img, RECT, PALETTE, INK_DELTA);
    const red = columnExtents(labels, RECT, 0);
    expect([red.first[5], red.last[5]]).toEqual([3, 12]);
    expect([red.first[6], red.last[6]]).toEqual([9, 9]);
    expect([red.first[7], red.last[7]]).toEqual([-1, -1]);
    const blue = columnExtents(labels, RECT, 1);
    expect([blue.first[5], blue.last[5]]).toEqual([7, 7]);
  });
});

function extentsOf(rows: ReadonlyArray<readonly [number, number] | null>) {
  const first = new Int32Array(rows.length).fill(-1);
  const last = new Int32Array(rows.length).fill(-1);
  rows.forEach((r, i) => {
    if (r !== null) {
      first[i] = r[0];
      last[i] = r[1];
    }
  });
  return { first, last };
}

describe("compareExtents, two-directional", () => {
  const base = Array.from({ length: 100 }, (): readonly [number, number] => [10, 14]);

  it("passes when rows agree within K_ROWS on at least P_COLUMNS of the columns", () => {
    const shifted = base.map((r, i): readonly [number, number] => (i < 3 ? [r[0] + K_ROWS, r[1] - K_ROWS] : r));
    const result = compareExtents(extentsOf(base), extentsOf(shifted), "two-directional");
    expect(result.pass).toBe(true);
    expect(result.agreeFraction).toBe(1);
  });

  it("fails when more than 1 - P_COLUMNS of the columns disagree by more than K_ROWS", () => {
    const wrong = base.map((r, i): readonly [number, number] => (i < 10 ? [r[0] + K_ROWS + 1, r[1]] : r));
    const result = compareExtents(extentsOf(base), extentsOf(wrong), "two-directional");
    expect(result.agreeFraction).toBeLessThan(P_COLUMNS);
    expect(result.pass).toBe(false);
  });

  it("fails when one engine alone has ink on more than P_MISSING of the columns", () => {
    const missing = base.map((r, i): readonly [number, number] | null => (i < 5 ? null : r));
    const result = compareExtents(extentsOf(base), extentsOf(missing), "two-directional");
    expect(result.missingFraction).toBeGreaterThan(P_MISSING);
    expect(result.pass).toBe(false);
  });
});

describe("compareExtents, one-directional", () => {
  it("accepts a WebGL2 extent that contains Canvas2D's and counts only Canvas2D-only columns missing", () => {
    const canvas2d = Array.from({ length: 100 }, (): readonly [number, number] => [10, 12]);
    const gl = Array.from({ length: 100 }, (): readonly [number, number] => [6, 20]);
    expect(gl).toHaveLength(100);
    const result = compareExtents(extentsOf(canvas2d), extentsOf(gl), "one-directional");
    expect(result.pass).toBe(true);
    const glOnly = compareExtents(extentsOf(canvas2d.map((_, i) => (i < 50 ? null : [10, 12] as const))), extentsOf(gl), "one-directional");
    expect(glOnly.missingFraction).toBe(0);
    expect(glOnly.pass).toBe(true);
  });

  it("fails when Canvas2D ink lies outside the WebGL2 extent expanded by K_ROWS", () => {
    const canvas2d = Array.from({ length: 100 }, (): readonly [number, number] => [10, 40]);
    const gl = Array.from({ length: 100 }, (): readonly [number, number] => [10, 20]);
    expect(compareExtents(extentsOf(canvas2d), extentsOf(gl), "one-directional").pass).toBe(false);
  });

  it("fails when WebGL2 has no ink where Canvas2D does", () => {
    const canvas2d = Array.from({ length: 100 }, (): readonly [number, number] => [10, 12]);
    const none = Array.from({ length: 100 }, (): null => null);
    expect(compareExtents(extentsOf(canvas2d), extentsOf(none), "one-directional").pass).toBe(false);
  });
});

describe("gap parity", () => {
  it("reports ink inside a NaN run shrunk by ceil(lineWidth * dpr) + 1 and ignores its edges", () => {
    const rows = Array.from({ length: 40 }, (): readonly [number, number] | null => [5, 6]);
    for (let x = 10; x <= 20; x += 1) rows[x] = null;
    const ext = extentsOf(rows);
    // lineWidth 1.5 css at dpr 2: shrink = ceil(3) + 1 = 4; the run [10, 20] -> [14, 16] checked.
    expect(gapViolations(ext, [{ from: 10, to: 20 }], 3)).toBe(0);
    ext.first[15] = 5;
    ext.last[15] = 6;
    expect(gapViolations(ext, [{ from: 10, to: 20 }], 3)).toBe(1);
    ext.first[11] = 5;
    ext.last[11] = 6;
    expect(gapViolations(ext, [{ from: 10, to: 20 }], 3)).toBe(1);
  });

  it("finds ink in the 3x3 neighbourhood of an isolated sample", () => {
    const img = image(40, 20);
    paint(img, 11, 11, RED);
    const labels = inkLabels(img, RECT, PALETTE, INK_DELTA);
    expect(hasInkAround(labels, RECT, 10, 10, 0)).toBe(true);
    expect(hasInkAround(labels, RECT, 20, 10, 0)).toBe(false);
  });
});

describe("outsideRectDifferences", () => {
  it("compares only pixels outside the plot rectangle grown by the given margin", () => {
    const a = image(40, 20);
    const b = image(40, 20);
    paint(b, 20, 10, RED); // inside the plot
    expect(outsideRectDifferences(a, b, { left: 10, top: 5, width: 20, height: 10 }, 2)).toBe(0);
    paint(b, 1, 1, RED); // outside
    expect(outsideRectDifferences(a, b, { left: 10, top: 5, width: 20, height: 10 }, 2)).toBe(1);
    paint(b, 9, 5, RED); // within the 2 px grown margin: ignored
    expect(outsideRectDifferences(a, b, { left: 10, top: 5, width: 20, height: 10 }, 2)).toBe(1);
  });
});
