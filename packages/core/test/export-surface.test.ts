import { describe, expect, it } from "vitest";
import * as coreExports from "../src/index.js";
import type {
  AxisMask,
  BinaryArrayExport,
  CsvExportOptions,
  CsvTraceSource,
  DecimationSelection,
  DecimationWorkerHandler,
  InvalidationPhase,
  MutableViewportDomain,
  NpyArrayKind,
  NpyExportOptions,
  PanGestureSnapshot,
  SampleSpan,
  SampleWindowOptions,
  StreamingInvalidationAdapter,
  StreamingInvalidationAdapterOptions,
  ViewportDomainBounds,
  ViewportDomainConstraints,
  WindowDecimationAcceptedCallback,
  WindowDecimationAdapter,
  WindowDecimationAdapterOptions,
  WorkerDecimationPortConfig,
  WorkerFactory,
  WorkerInboundMessage,
  WorkerLike,
  WorkerMessageEndpoint,
  WorkerMessageEventLike,
  WorkerOutboundMessage,
} from "../src/index.js";

// Compile-only: proves `DecimationSelection` is part of the public type surface, not only an
// internal `decimation/selection.ts` detail.
function typeSurfaceFixture(selection: DecimationSelection): DecimationSelection {
  return selection;
}
void typeSurfaceFixture;

// Compile-only: the export and window types are part of the public type surface.
export type PublicExportTypes = [
  SampleSpan,
  SampleWindowOptions,
  CsvTraceSource,
  CsvExportOptions,
  BinaryArrayExport,
  NpyArrayKind,
  NpyExportOptions,
  WorkerDecimationPortConfig,
  WorkerLike,
  WorkerFactory,
  WorkerMessageEndpoint,
  WorkerMessageEventLike,
  WorkerInboundMessage,
  WorkerOutboundMessage,
  DecimationWorkerHandler,
  AxisMask,
  MutableViewportDomain,
  ViewportDomainBounds,
  ViewportDomainConstraints,
  PanGestureSnapshot,
  InvalidationPhase,
  StreamingInvalidationAdapterOptions,
  StreamingInvalidationAdapter,
  WindowDecimationAcceptedCallback,
  WindowDecimationAdapterOptions,
  WindowDecimationAdapter,
];

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
      "createWorkerDecimationPort",
      "handleDecimationMessage",
      "createDecimationWorkerHandler",
      "attachDecimationWorker",
      "attachCurrentDecimationWorker",
      "MAX_BUCKETS",
      "BUCKET_OVERSAMPLE_DEFAULT",
      "computeBucketCount",
      "createRawSampleRing",
      "createBucketAccumulator",
      "selectTier",
      "rotateBucketOrigin",
      "ingestSample",
      "ingestBatch",
      "applyDomainChange",
      "rebuildDomain",
      "projectTier3",
      "materializeBucketsToPayload",
      "materializeTier3ToPayload",
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
      "BREAK_INDEX",
      "createTraceCollection",
      "withTraceAxis",
      "withTraceStyle",
      "resolveTraceAxisIndices",
      "createSampleSpan",
      "resolveSampleWindow",
      "exportCsv",
      "exportNpy",
      "CSV_DEFAULT_ROWS_PER_CHUNK",
      "NPY_DEFAULT_CHUNK_BYTES",
      "AXIS_MASK_NONE",
      "AXIS_MASK_X",
      "AXIS_MASK_Y",
      "AXIS_MASK_XY",
      "ULP_MIN_SPAN_FACTOR",
      "LOG_EXPONENT_MIN",
      "LOG_EXPONENT_MAX",
      "DEFAULT_MIN_LOG_DECADES_Y",
      "createMutableViewportDomain",
      "createPanGestureSnapshot",
      "capturePanGestureSnapshot",
      "computeUlpMinSpan",
      "clampViewportDomain",
      "computeZoomDomain",
      "computePanDomain",
      "computeBoxZoomDomain",
      "createStreamingInvalidationAdapter",
      "createWindowDecimationAdapter",
    ];
    for (const name of expected) {
      expect(coreExports).toHaveProperty(name);
    }
  });

  it("exposes the viewport interaction math and invalidation adapters with their documented constants", () => {
    expect(coreExports.AXIS_MASK_NONE).toBe(0);
    expect(coreExports.AXIS_MASK_X).toBe(1);
    expect(coreExports.AXIS_MASK_Y).toBe(2);
    expect(coreExports.AXIS_MASK_XY).toBe(3);
    expect(coreExports.ULP_MIN_SPAN_FACTOR).toBe(1e-12);
    expect(coreExports.LOG_EXPONENT_MIN).toBe(-300);
    expect(coreExports.LOG_EXPONENT_MAX).toBe(300);
    expect(coreExports.DEFAULT_MIN_LOG_DECADES_Y).toBe(1e-6);
    for (const name of [
      "createMutableViewportDomain",
      "createPanGestureSnapshot",
      "capturePanGestureSnapshot",
      "computeUlpMinSpan",
      "clampViewportDomain",
      "computeZoomDomain",
      "computePanDomain",
      "computeBoxZoomDomain",
      "createStreamingInvalidationAdapter",
      "createWindowDecimationAdapter",
    ] as const) {
      expect(typeof coreExports[name]).toBe("function");
    }
  });

  it("does not export internal viewport interaction scratch helpers", () => {
    for (const name of [
      "slideLinear",
      "clampLinearValues",
      "clampLogValues",
      "zoomLinearValues",
      "zoomLogValues",
      "resolveLinearSpanLimits",
      "resolveLogLimits",
      "writeLogResult",
    ]) {
      expect(coreExports).not.toHaveProperty(name);
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
      "formatExportNumber",
      "buildNpyHeader",
    ];
    for (const name of forbidden) {
      expect(coreExports).not.toHaveProperty(name);
    }
  });

  it("exposes no writer for a deferred binary format", () => {
    const deferred = /hdf5|npz|\bmat\b|matlab|parquet/i;
    expect(Object.keys(coreExports).filter((name) => deferred.test(name))).toEqual([]);
  });

  it("exposes no default color palette", () => {
    const forbidden = ["TRACE_PALETTE", "DEFAULT_PALETTE", "COLOR_PALETTE", "PALETTE"];
    for (const name of forbidden) {
      expect(coreExports).not.toHaveProperty(name);
    }
  });
});
