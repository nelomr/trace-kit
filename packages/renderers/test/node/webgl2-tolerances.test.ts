/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIGURE_STYLE, TRACE_PALETTE } from "../../src/style.js";
import type { Rgb } from "../visual/support/ink-metric.js";
import {
  AXIS_LUMA_DELTA,
  INK_DELTA,
  K_INSET,
  K_ROWS,
  LABEL_MASK_PAD_PX,
  P_COLUMNS,
  P_MISSING,
  WEBGL2_SCREENSHOT_TOLERANCE,
} from "../visual/support/webgl2-tolerances.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__screenshots__" || entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".ts")) yield full;
  }
}

describe("WebGL2 tolerance constants", () => {
  it("declares the screenshot tolerance distinct from the Canvas2D pair", () => {
    expect(WEBGL2_SCREENSHOT_TOLERANCE).toEqual({ threshold: 0.1, allowedMismatchedPixelRatio: 0.002 });
    expect(WEBGL2_SCREENSHOT_TOLERANCE.allowedMismatchedPixelRatio).not.toBe(0.001);
  });

  it("starts at the documented values", () => {
    expect([K_INSET, K_ROWS, P_COLUMNS, P_MISSING, INK_DELTA, AXIS_LUMA_DELTA]).toEqual([3, 2, 0.95, 0.02, 32, 48]);
  });

  it("keeps every constant non-zero and inside its calibration bound", () => {
    expect(WEBGL2_SCREENSHOT_TOLERANCE.threshold).toBeGreaterThan(0);
    expect(WEBGL2_SCREENSHOT_TOLERANCE.threshold).toBeLessThanOrEqual(0.15);
    expect(WEBGL2_SCREENSHOT_TOLERANCE.allowedMismatchedPixelRatio).toBeGreaterThan(0);
    expect(WEBGL2_SCREENSHOT_TOLERANCE.allowedMismatchedPixelRatio).toBeLessThanOrEqual(0.003);
    expect(K_INSET).toBeGreaterThan(0);
    expect(K_INSET).toBeLessThanOrEqual(4);
    expect(K_ROWS).toBeGreaterThan(0);
    expect(K_ROWS).toBeLessThanOrEqual(3);
    expect(P_COLUMNS).toBeGreaterThanOrEqual(0.9);
    expect(P_MISSING).toBeGreaterThan(0);
    expect(P_MISSING).toBeLessThanOrEqual(0.05);
    expect(INK_DELTA).toBeGreaterThanOrEqual(24);
    expect(INK_DELTA).toBeLessThanOrEqual(48);
    expect(AXIS_LUMA_DELTA).toBeGreaterThan(0);
    expect(AXIS_LUMA_DELTA).toBeLessThanOrEqual(64);
  });

  it("is defined once: the literals appear in no other file", () => {
    const home = path.join(packageRoot, "test/visual/support/webgl2-tolerances.ts");
    for (const file of walk(path.join(packageRoot, "test"))) {
      if (file === home || file.endsWith("webgl2-tolerances.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/allowedMismatchedPixelRatio:\s*0\.002/);
      expect(source, file).not.toMatch(/\b(K_INSET|K_ROWS|P_COLUMNS|P_MISSING|INK_DELTA|AXIS_LUMA_DELTA)\s*=\s*[\d.]+/);
    }
  });
});

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Largest per-channel distance from `p` to the box `[min(bg, c), max(bg, c)]` of each channel: the
 * set of every per-channel blend of the background and `c`, which is what grayscale and LCD
 * anti-aliasing of text drawn in `c` can produce. Zero means `p` could be such a blend.
 */
function distanceToBlendBox(p: Rgb, bg: Rgb, c: Rgb): number {
  let worst = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const lo = Math.min(bg[channel] ?? 0, c[channel] ?? 0);
    const hi = Math.max(bg[channel] ?? 0, c[channel] ?? 0);
    const value = p[channel] ?? 0;
    worst = Math.max(worst, lo - value, value - hi, 0);
  }
  return worst;
}

describe("chrome colours stay separated from the trace colours", () => {
  const bg = rgb(DEFAULT_FIGURE_STYLE.backgroundColor);
  const chrome = [DEFAULT_FIGURE_STYLE.gridColor, DEFAULT_FIGURE_STYLE.axisColor, DEFAULT_FIGURE_STYLE.labelColor];
  const traces = [...TRACE_PALETTE, DEFAULT_FIGURE_STYLE.traceColor];

  it("keeps every trace colour farther than INK_DELTA from every blend of the background and a chrome colour", () => {
    let minimum = Infinity;
    for (const c of chrome) {
      for (const p of traces) {
        const distance = distanceToBlendBox(rgb(p), bg, rgb(c));
        expect(distance, `${p} against ${c}`).toBeGreaterThan(INK_DELTA);
        minimum = Math.min(minimum, distance);
      }
    }
    // Today's closest pair: the label colour against `#7cd992` and `#c792ea`.
    expect(minimum).toBe(66);
  });

  it("is not vacuous: a trace colour equal to a chrome colour is reported as ambiguous", () => {
    const label = DEFAULT_FIGURE_STYLE.labelColor;
    expect(distanceToBlendBox(rgb(label), bg, rgb(label))).toBeLessThanOrEqual(INK_DELTA);
    expect(distanceToBlendBox(rgb(label), bg, rgb(label))).toBe(0);
  });

  it("declares the label mask padding once", () => {
    expect(LABEL_MASK_PAD_PX).toBe(2);
  });
});
