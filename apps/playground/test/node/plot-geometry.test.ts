/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { axisTicks, dataToPixel } from "../../src/throwaway-plot/geometry.js";

describe("throwaway plot coordinate math", () => {
  it("maps a data-space value to pixel-space linearly", () => {
    expect(
      dataToPixel(5, { min: 0, max: 10 }, { min: 0, max: 100 }),
    ).toBe(50);
    expect(
      dataToPixel(0, { min: 0, max: 10 }, { min: 20, max: 220 }),
    ).toBe(20);
    expect(
      dataToPixel(10, { min: 0, max: 10 }, { min: 20, max: 220 }),
    ).toBe(220);
  });

  it("places evenly spaced ticks across a domain, including both ends", () => {
    expect(axisTicks({ min: 0, max: 100 }, 5)).toEqual([0, 25, 50, 75, 100]);
  });

  it("rejects fewer than two ticks", () => {
    expect(() => axisTicks({ min: 0, max: 100 }, 1)).toThrow(RangeError);
  });
});
