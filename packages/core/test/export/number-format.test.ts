import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatExportNumber } from "../../src/export/number-format.js";

describe("formatExportNumber", () => {
  it("keeps the sign of negative zero", () => {
    expect(formatExportNumber(-0)).toBe("-0");
    expect(formatExportNumber(0)).toBe("0");
  });

  it("writes the non-finite tokens literally", () => {
    expect(formatExportNumber(NaN)).toBe("NaN");
    expect(formatExportNumber(Infinity)).toBe("Infinity");
    expect(formatExportNumber(-Infinity)).toBe("-Infinity");
  });

  it("widens an f32 to its exact shortest f64 text", () => {
    expect(formatExportNumber(Math.fround(0.1))).toBe("0.10000000149011612");
  });

  it("formats an absolute X as the f64 sum", () => {
    const absolute = 1550 + Math.fround(0.123456);
    expect(formatExportNumber(absolute)).toBe(String(absolute));
  });

  it("never emits grouping or locale characters", () => {
    for (const value of [1234567.891, -0.000001, 1e21, 123456789012]) {
      expect(formatExportNumber(value)).toMatch(/^-?[0-9]+(\.[0-9]+)?(e[+-][0-9]+)?$/);
    }
  });

  it("round-trips through Number() for every double", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (value) => {
        return Object.is(Number(formatExportNumber(value)), value);
      }),
    );
  });
});
