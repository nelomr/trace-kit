import { describe, expect, it } from "vitest";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

// spectrum-data-payload spec: "A payload is constructed only via a core factory", "sampleCount
// Distinct From Buffer Capacity", "X-Axis Precision via an f64 Origin With f32 Offsets".
describe("createSpectrumDataPayload", () => {
  it("satisfies the SpectrumDataPayload structural type with branded retained buffers", () => {
    const payload = createSpectrumDataPayload({
      capacity: 16,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });

    expect(payload.x.length).toBe(16);
    expect(payload.y.length).toBe(16);
    expect(payload.x).toBeInstanceOf(Float32Array);
    expect(payload.y).toBeInstanceOf(Float32Array);
  });

  it("reports x.length === y.length === capacity", () => {
    const payload = createSpectrumDataPayload({
      capacity: 1024,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });

    expect(payload.x.length).toBe(1024);
    expect(payload.y.length).toBe(1024);
    expect(payload.capacity).toBe(1024);
  });

  it("reports sampleCount distinct from capacity for a partially filled buffer", () => {
    const payload = createSpectrumDataPayload({
      capacity: 1024,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });

    expect(payload.sampleCount).toBe(0);
    expect(payload.x.length).toBe(1024);
  });

  it("starts revision at 0", () => {
    const payload = createSpectrumDataPayload({
      capacity: 16,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });

    expect(payload.revision).toBe(0);
  });

  it("reconstructs a fine-resolution absolute X value via xOrigin + x[i]", () => {
    const xOrigin = 1550.0;
    const absolute = 1550.123456;
    const payload = createSpectrumDataPayload({
      capacity: 4,
      xOrigin,
      xUnit: "nm",
      yUnit: "dBm",
    });

    payload.x[0] = Math.fround(absolute - xOrigin);
    const reconstructed = xOrigin + payload.x[0];

    expect(reconstructed).toBeCloseTo(absolute, 4);
  });
});
