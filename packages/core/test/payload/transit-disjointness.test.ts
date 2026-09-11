import { describe, expect, it } from "vitest";
import type { TransitYBuffer } from "../../src/buffers/brand.js";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

// spectrum-data-payload spec's "Payload buffers never share a backing store with a transit
// buffer" scenario.
describe("transit disjointness", () => {
  it("a payload's Y buffer never shares a backing ArrayBuffer with a separately allocated transit buffer", () => {
    const payload = createSpectrumDataPayload({
      capacity: 16,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });
    const transitSlot = {
      yTransit: new Float32Array(16) as TransitYBuffer,
    };

    expect(payload.y.buffer === transitSlot.yTransit.buffer).toBe(false);
  });
});
