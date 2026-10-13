/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { escapeXml } from "../../src/svg/escape-xml.js";
import { formatSvgNumber, SVG_COORDINATE_DECIMALS } from "../../src/svg/svg-number.js";

describe("formatSvgNumber", () => {
  it("rounds the first pinned row through the host toFixed", () => {
    // Validates the engine's decimal expansion of the binary double nearest 12.345.
    expect(formatSvgNumber(12.345)).toBe("12.35");
  });

  it.each([
    [12.5, "12.5"],
    [3, "3"],
    [0.004, "0"],
    [-0.004, "0"],
    [0, "0"],
    [-0, "0"],
    [1234567.891, "1234567.89"],
    [0.1 + 0.2, "0.3"],
    [100, "100"],
    [-12.5, "-12.5"],
    [0.05, "0.05"],
    [-0.5, "-0.5"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatSvgNumber(value)).toBe(expected);
  });

  it("pins two decimals", () => {
    expect(SVG_COORDINATE_DECIMALS).toBe(2);
  });

  it("maps non-finite input to 0", () => {
    expect(formatSvgNumber(NaN)).toBe("0");
    expect(formatSvgNumber(Infinity)).toBe("0");
    expect(formatSvgNumber(-Infinity)).toBe("0");
  });

  it("never emits exponent notation, even for extreme finite input", () => {
    for (const v of [1e-7, 1e-12, 1e21, 1e30, -1e30, Number.MAX_VALUE, Number.MIN_VALUE]) {
      expect(formatSvgNumber(v)).not.toMatch(/e/i);
    }
    expect(formatSvgNumber(1e30)).toBe(formatSvgNumber(1e9));
    expect(formatSvgNumber(-1e30)).toBe(formatSvgNumber(-1e9));
  });

  it("never calls a locale-aware API", () => {
    const spy = vi.spyOn(Number.prototype, "toLocaleString");
    try {
      formatSvgNumber(1234.5678);
      formatSvgNumber(-0.001);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("no module under svg/ references toLocaleString or Intl", () => {
    const dir = fileURLToPath(new URL("../../src/svg/", import.meta.url));
    for (const file of readdirSync(dir)) {
      const source = readFileSync(`${dir}${file}`, "utf8");
      expect(source, file).not.toMatch(/toLocaleString|\bIntl\b/);
    }
  });
});

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`a<b&"c"'d'>`)).toBe("a&lt;b&amp;&quot;c&quot;&apos;d&apos;&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("1.5 nm")).toBe("1.5 nm");
  });

  it("escapes ampersands once, never twice", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});
