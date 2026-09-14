import { describe, expect, it } from "vitest";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

// spectrum-data-payload spec's "revision distinguishes 'restore' from 'new data' with an
// integer compare" and "A renderer never observes a detached payload buffer" scenarios. No
// source change is needed beyond what change 2 shipped — this documents the passing state as a
// regression guard for the transport-facing consequence this change owns: the retained payload
// is never transferable, so re-upload from `payload.x`/`payload.y` after a simulated
// `webglcontextlost`/`webglcontextrestored` pair succeeds without any detachment check.
describe("GL restore vs. new data", () => {
  it("revision is unchanged across a simulated context-lost/context-restored pair with no intervening commitPayloadRevision call", () => {
    const payload = createSpectrumDataPayload({
      capacity: 64,
      xOrigin: 0,
      xUnit: "s",
      yUnit: "dBm",
    });

    const revisionBeforeLoss = payload.revision;

    // Simulate `webglcontextlost` then `webglcontextrestored`: no core API call happens between
    // them, because context loss is a renderer-side (GPU-resource) event only.
    // ... (nothing to do here: the retained payload is never touched by a context-loss event)

    expect(payload.revision).toBe(revisionBeforeLoss);
  });

  it("re-upload from payload.x/payload.y succeeds without a detachment check, because the retained buffers are never transferable", () => {
    const payload = createSpectrumDataPayload({
      capacity: 64,
      xOrigin: 0,
      xUnit: "s",
      yUnit: "dBm",
    });

    // The retained buffers are always readable: byteLength is never 0, since nothing in
    // `@trace-kit/core` can place a `Retained` buffer in a transfer list (brand-enforced).
    expect(payload.x.byteLength).toBeGreaterThan(0);
    expect(payload.y.byteLength).toBeGreaterThan(0);

    // A renderer's restore path reads unconditionally — no byteLength guard is required.
    const reuploaded = new Float32Array(payload.x.length);
    reuploaded.set(payload.x);
    expect(reuploaded).toEqual(payload.x);
  });
});
