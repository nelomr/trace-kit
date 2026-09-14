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
  RawSampleRing,
  BucketAccumulator,
  TierResult,
} from "./streaming-contract.js";
export {
  MAX_BUCKETS,
  BUCKET_OVERSAMPLE_DEFAULT,
} from "./streaming-contract.js";
