/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INK_DELTA,
  K_INSET,
  K_ROWS,
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
    expect([K_INSET, K_ROWS, P_COLUMNS, P_MISSING, INK_DELTA]).toEqual([3, 2, 0.95, 0.02, 32]);
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
  });

  it("is defined once: the literals appear in no other file", () => {
    const home = path.join(packageRoot, "test/visual/support/webgl2-tolerances.ts");
    for (const file of walk(path.join(packageRoot, "test"))) {
      if (file === home || file.endsWith("webgl2-tolerances.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/allowedMismatchedPixelRatio:\s*0\.002/);
      expect(source, file).not.toMatch(/\b(K_INSET|K_ROWS|P_COLUMNS|P_MISSING|INK_DELTA)\s*=\s*[\d.]+/);
    }
  });
});
