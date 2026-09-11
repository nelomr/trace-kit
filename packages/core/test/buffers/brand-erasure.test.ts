import { describe, expect, it } from "vitest";
import { asXBuffer } from "../../src/buffers/brand.js";

// branded-buffers spec, "A branded buffer is identical at runtime to its underlying typed
// array" scenario: branding is type-level only (design.md §D1) and must erase completely.
describe("brand erasure", () => {
  it("produces a value runtime-identical to a plain Float32Array", () => {
    const length = 8;
    const plain = new Float32Array(length);
    const branded = asXBuffer(new Float32Array(length));

    expect(Object.getPrototypeOf(branded)).toBe(Float32Array.prototype);
    expect(branded instanceof Float32Array).toBe(true);
    expect(Object.getOwnPropertyNames(branded)).toEqual(
      Object.getOwnPropertyNames(plain),
    );
    expect(Object.getOwnPropertySymbols(branded)).toEqual(
      Object.getOwnPropertySymbols(plain),
    );
  });
});
