import { describe, expect, it } from "vitest";
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type MutableSpectrumDataPayload,
} from "../../src/payload/spectrum-data-payload.js";

// spectrum-data-payload spec's "Monotonic Revision Field, Mutated Only Through
// commitPayloadRevision" scenarios.
describe("commitPayloadRevision", () => {
  it("increments revision and writes sampleCount", () => {
    const payload = createSpectrumDataPayload({
      capacity: 1024,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    }) as MutableSpectrumDataPayload;

    expect(payload.revision).toBe(0);
    commitPayloadRevision(payload, 600);
    expect(payload.revision).toBe(1);
    expect(payload.sampleCount).toBe(600);

    commitPayloadRevision(payload, 600);
    expect(payload.revision).toBe(2);
  });

  it("recomputes extents over the new [0, sampleCount) prefix only", () => {
    const payload = createSpectrumDataPayload({
      capacity: 8,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    }) as MutableSpectrumDataPayload;

    payload.x.set([1, 2, 3, 100, 100, 100, 100, 100]);
    payload.y.set([10, 20, 30, -100, -100, -100, -100, -100]);
    commitPayloadRevision(payload, 3);

    expect(payload.xMin).toBe(1);
    expect(payload.xMax).toBe(3);
    expect(payload.yMin).toBe(10);
    expect(payload.yMax).toBe(30);

    // Overwrite the prefix and commit a smaller revision: extents must reflect ONLY the new
    // [0, sampleCount) prefix, never stale data from the previous revision.
    payload.x.set([5, 6]);
    payload.y.set([50, 60]);
    commitPayloadRevision(payload, 2);

    expect(payload.xMin).toBe(5);
    expect(payload.xMax).toBe(6);
    expect(payload.yMin).toBe(50);
    expect(payload.yMax).toBe(60);
  });

  it("does not change xOrigin", () => {
    const payload = createSpectrumDataPayload({
      capacity: 8,
      xOrigin: 1550.0,
      xUnit: "nm",
      yUnit: "dBm",
    }) as MutableSpectrumDataPayload;

    commitPayloadRevision(payload, 4);
    expect(payload.xOrigin).toBe(1550.0);
  });
});
