import { describe, expect, it } from "vitest";
import { allocateXBuffer, asXBuffer } from "../../src/buffers/brand.js";

// branded-buffers spec's "Construction and Narrowing Contract" scenarios.
describe("construction and narrowing", () => {
  it("rejects a detached buffer", () => {
    // In this engine, detaching an `ArrayBuffer` also collapses the typed-array view's own
    // `.length` to `0`, so a real detach cannot produce `byteLength === 0 && length > 0`
    // directly. `assertUsableBuffer`'s contract is stated against that exact shape (per the
    // branded-buffers spec's scenario, mirroring what a stale/cached `.length` read on some
    // engine or transport boundary could observe), so the fixture simulates it structurally: a
    // real `Float32Array` whose `.length` getter is overridden to keep reporting its original
    // value after the backing buffer is detached.
    const arrayBuffer = new ArrayBuffer(16);
    const detached = new Float32Array(arrayBuffer);
    const originalLength = detached.length;
    structuredClone(arrayBuffer, { transfer: [arrayBuffer] });
    Object.defineProperty(detached, "length", { value: originalLength });

    expect(detached.byteLength).toBe(0);
    expect(detached.length).toBeGreaterThan(0);
    expect(() => asXBuffer(detached)).toThrow();
  });

  it("allocates a buffer of the requested capacity", () => {
    const buffer = allocateXBuffer(1024);
    expect(buffer.length).toBe(1024);
  });
});
