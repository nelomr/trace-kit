/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { TRACE_PALETTE } from "../../src/style.js";
import { parseCssColorInto, tryParseCssColorInto } from "../../src/webgl2/color.js";

function parse(color: string): number[] {
  const out = new Float32Array(8);
  parseCssColorInto(color, out, 4);
  expect(Array.from(out.subarray(0, 4))).toEqual([0, 0, 0, 0]);
  return Array.from(out.subarray(4, 8));
}

function close(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(4);
  for (let i = 0; i < 4; i += 1) expect(actual[i]).toBeCloseTo(expected[i] ?? 0, 6);
}

describe("parseCssColorInto", () => {
  it("parses #rgb, #rgba, #rrggbb and #rrggbbaa into straight-alpha floats", () => {
    close(parse("#f80"), [1, 136 / 255, 0, 1]);
    close(parse("#f808"), [1, 136 / 255, 0, 136 / 255]);
    close(parse("#3fb6ff"), [63 / 255, 182 / 255, 1, 1]);
    close(parse("#3fb6ff80"), [63 / 255, 182 / 255, 1, 128 / 255]);
  });

  it("parses rgb() and rgba() without premultiplying", () => {
    close(parse("rgb(255, 0, 128)"), [1, 0, 128 / 255, 1]);
    close(parse("rgba(10, 20, 30, 0.5)"), [10 / 255, 20 / 255, 30 / 255, 0.5]);
    close(parse("rgb(10 20 30 / 0.25)"), [10 / 255, 20 / 255, 30 / 255, 0.25]);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    close(parse("  #FFAA00 "), [1, 170 / 255, 0, 1]);
  });

  it("parses every palette entry", () => {
    for (const entry of TRACE_PALETTE) {
      const out = new Float32Array(4);
      expect(() => {
        parseCssColorInto(entry, out, 0);
      }).not.toThrow();
      expect(out[3]).toBe(1);
    }
  });

  it("throws a TypeError naming an unparseable color", () => {
    const out = new Float32Array(4);
    expect(() => {
      parseCssColorInto("cornflowerblue", out, 0);
    }).toThrow(TypeError);
    expect(() => {
      parseCssColorInto("cornflowerblue", out, 0);
    }).toThrow(/cornflowerblue/);
    expect(() => {
      parseCssColorInto("#12", out, 0);
    }).toThrow(/#12/);
  });

  it("reports failure without throwing from the non-throwing variant and leaves the output alone", () => {
    const out = new Float32Array([9, 9, 9, 9]);
    expect(tryParseCssColorInto("red", out, 0)).toBe(false);
    expect(Array.from(out)).toEqual([9, 9, 9, 9]);
    expect(tryParseCssColorInto("#000", out, 0)).toBe(true);
    expect(Array.from(out)).toEqual([0, 0, 0, 1]);
  });
});
