/**
 * @trace-kit/core
 * High-throughput isomorphic telemetry & decimation engine
 *
 * Public export surface. Deliberately does not export:
 * `MutableSpectrumDataPayload` (the mutation entry point is `commitPayloadRevision`, not a
 * writable type handle), `assertUsableBuffer`/`assertCapacity` (internal boundary validators —
 * exporting them would invite pre-validation before a hot path that validates again), or any
 * bucket-boundary helper (an implementation detail of the decimation algorithms).
 */

export { VERSION } from './version.js';

export type {
  BufferAxis,
  OwnershipClass,
  Branded,
  XBuffer,
  YBuffer,
  IndexBuffer,
  Retained,
  Transit,
  TransitXBuffer,
  TransitYBuffer,
  TransitIndexBuffer,
  TransferableBacking,
} from './buffers/brand.js';
export {
  asXBuffer,
  asYBuffer,
  asIndexBuffer,
  allocateXBuffer,
  allocateYBuffer,
  allocateIndexBuffer,
} from './buffers/brand.js';

export type {
  SpectrumDataPayload,
  DecimationResultCursor,
} from './payload/spectrum-data-payload.js';
export {
  createSpectrumDataPayload,
  commitPayloadRevision,
  isCursorCurrent,
} from './payload/spectrum-data-payload.js';

export { minMaxEnvelope } from './decimation/min-max.js';
export { lttb } from './decimation/lttb.js';
export { minMaxEnvelopeIndices } from './decimation/min-max-indices.js';

export type {
  DecimationAlgorithm,
  DecimationSelection,
  LttbSelection,
  MinMaxSelection,
} from './decimation/selection.js';
export { resolveDecimationParameter } from './decimation/selection.js';

export type {
  ViewportTransform,
  CreateViewportTransformOptions,
} from './viewport/index.js';
export {
  createViewportTransform,
  projectX,
  projectY,
  unprojectX,
  unprojectY,
  isInsidePlotArea,
  transformMatchesPayload,
  selectTicks,
} from './viewport/index.js';

export type {
  Lease,
  LeasePhase,
  Saturated,
  TransportStatsView,
  TransportCapabilities,
  DecimationPort,
  DecimationRequestWriter,
  SettlementSink,
  SyncDecimationPortConfig,
  RawSampleRing,
  BucketAccumulator,
  TierResult,
} from './transport/index.js';
export {
  SATURATED,
  SlotState,
  collectTransferList,
  TRANSPORT_STAT_COUNT_I32,
  TRANSPORT_STAT_COUNT_F64,
  StatCounter,
  StatGauge,
  TransportHealth,
  createTransportStatsView,
  detectTransportCapabilities,
  DecimationKind,
  PortMode,
  FailureReason,
  createSyncDecimationPort,
  MAX_BUCKETS,
  BUCKET_OVERSAMPLE_DEFAULT,
} from './transport/index.js';
