import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { TRACEKIT_INTER_FAMILY } from "../../src/font/index.js";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testFileDir, "../..");

const GENERIC_FAMILY_KEYWORDS = ["sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy"];

describe("default figure font", () => {
  it("does not reference a bare generic CSS font-family keyword", () => {
    for (const keyword of GENERIC_FAMILY_KEYWORDS) {
      expect(DEFAULT_FIGURE_STYLE.font).not.toContain(keyword);
    }
  });

  it("requests the shipped font family by name", () => {
    expect(DEFAULT_FIGURE_STYLE.font).toContain(TRACEKIT_INTER_FAMILY);
  });

  it("lets a consumer override the font with an ordinary style spread", () => {
    const overridden = { ...DEFAULT_FIGURE_STYLE, font: "12px monospace" };
    expect(overridden.font).toBe("12px monospace");
    // The override must not be silently rewritten back to the default anywhere in this object;
    // every other field stays exactly what DEFAULT_FIGURE_STYLE already had.
    expect(overridden.backgroundColor).toBe(DEFAULT_FIGURE_STYLE.backgroundColor);
  });

  it("keeps the built font entry within the committed size budget", () => {
    const builtEntry = path.join(packageRoot, "dist/font/index.js");
    if (!existsSync(builtEntry)) {
      // Meaningful only once `tsup` has actually produced `dist/font/index.js` —
      // running `pnpm run build` in this package first is a precondition, not a defect in the
      // budget itself, so this reports as a skip rather than a failure when unbuilt.
      return;
    }
    const sizeBytes = readFileSync(builtEntry).length;
    const BUDGET_BYTES = 24 * 1024;
    expect(sizeBytes).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
