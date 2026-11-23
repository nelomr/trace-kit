/**
 * Public barrel for the transport surface. Effect-free re-exports only — importing this module
 * performs no side effect and constructs nothing at module scope.
 */

export type { Lease, LeasePhase, Saturated } from "./ownership.js";
export { SATURATED, SlotState, collectTransferList } from "./ownership.js";

export type {
  TransportStatsView,
} from "./backpressure.js";
export {
  TRANSPORT_STAT_COUNT_I32,
  TRANSPORT_STAT_COUNT_F64,
  StatCounter,
  StatGauge,
  TransportHealth,
  createTransportStatsView,
} from "./backpressure.js";

export type { TransportCapabilities } from "./capabilities.js";
export { detectTransportCapabilities } from "./capabilities.js";

export type {
  DecimationPort,
  DecimationRequestWriter,
  SettlementSink,
} from "./decimation-port.js";
export { DecimationKind, PortMode, FailureReason } from "./decimation-port.js";

export { createSyncDecimationPort } from "./sync-port.js";
export type { SyncDecimationPortConfig } from "./sync-port.js";

export type {
  WorkerMessageEventLike,
  WorkerLike,
  WorkerFactory,
  WorkerMessageEndpoint,
  WorkerWorkMessage,
  WorkerInitSabMessage,
  WorkerDisposeMessage,
  WorkerReadyMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "./worker-channel.js";

export type { DecimationWorkerHandler } from "./worker-handler.js";
export {
  handleDecimationMessage,
  createDecimationWorkerHandler,
  attachDecimationWorker,
  attachCurrentDecimationWorker,
} from "./worker-handler.js";

export type { WorkerDecimationPortConfig } from "./worker-port.js";
export { createWorkerDecimationPort } from "./worker-port.js";

export type {
  RawSampleRing,
  BucketAccumulator,
  TierResult,
  Tier1Result,
  Tier2Result,
  Tier3Result,
  TierSelectionRequest,
  Tier3ProjectionTarget,
} from "./streaming-contract.js";
export {
  MAX_BUCKETS,
  BUCKET_OVERSAMPLE_DEFAULT,
  computeBucketCount,
  createRawSampleRing,
  createBucketAccumulator,
  selectTier,
  rotateBucketOrigin,
  ingestSample,
  ingestBatch,
  applyDomainChange,
  rebuildDomain,
  projectTier3,
} from "./streaming-contract.js";

export {
  materializeBucketsToPayload,
  materializeTier3ToPayload,
} from "./materialize.js";
