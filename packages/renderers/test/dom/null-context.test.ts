import { describe, expect, it } from "vitest";
import { acquire2dContext } from "../../src/surface.js";

// happy-dom's `HTMLCanvasElement.getContext` returns `null` by default (no 2d backend is
// installed) — this is exactly the "context acquisition failed" case a real browser produces
// for an exhausted canvas budget or an unsupported context id, so it doubles as our synchronous
// failure-path test without any manual mocking.
describe("acquire2dContext — null context", () => {
  it("throws synchronously when getContext('2d') returns null", () => {
    const canvas = document.createElement("canvas");
    expect(() => acquire2dContext(canvas)).toThrow(TypeError);
  });
});
