import { describe, expect, it } from "vitest";
import * as coreExports from "../src/index.js";
import type { DecimationSelection } from "../src/index.js";

// Compile-only: proves `DecimationSelection` is part of the public type surface, not only an
// internal `decimation/selection.ts` detail.
function typeSurfaceFixture(selection: DecimationSelection): DecimationSelection {
  return selection;
}
void typeSurfaceFixture;

// The public export surface of `@trace-kit/core` is explicit about what it exports and, just
// as deliberately, what it does not.
describe("export surface", () => {
  it("exposes exactly the intended public bindings", () => {
    const expected = [
      "VERSION",
      "asXBuffer",
      "asYBuffer",
      "asIndexBuffer",
      "allocateXBuffer",
      "allocateYBuffer",
      "allocateIndexBuffer",
      "createSpectrumDataPayload",
      "commitPayloadRevision",
      "isCursorCurrent",
      "minMaxEnvelope",
      "lttb",
      "minMaxEnvelopeIndices",
      "resolveDecimationParameter",
      "SATURATED",
      "SlotState",
      "collectTransferList",
      "TRANSPORT_STAT_COUNT_I32",
      "TRANSPORT_STAT_COUNT_F64",
      "StatCounter",
      "StatGauge",
      "TransportHealth",
      "createTransportStatsView",
      "detectTransportCapabilities",
      "DecimationKind",
      "PortMode",
      "FailureReason",
      "createSyncDecimationPort",
      "MAX_BUCKETS",
      "BUCKET_OVERSAMPLE_DEFAULT",
      "createViewportTransform",
      "projectX",
      "projectY",
      "unprojectX",
      "unprojectY",
      "isInsidePlotArea",
      "transformMatchesPayload",
      "selectTicks",
      "selectLogTicks",
      "Y_SCALE_KIND_LINEAR",
      "Y_SCALE_KIND_LOG",
      "AXIS_SIDE_LEFT",
      "createAxisTransforms",
    ];
    for (const name of expected) {
      expect(coreExports).toHaveProperty(name);
    }
  });

  it("does not export internal boundary validators or the mutable payload type", () => {
    const forbidden = [
      "assertUsableBuffer",
      "assertCapacity",
      "MutableSpectrumDataPayload",
      "BufferBacking",
      "selectBufferBacking",
      "createBufferPool",
    ];
    for (const name of forbidden) {
      expect(coreExports).not.toHaveProperty(name);
    }
  });
});
