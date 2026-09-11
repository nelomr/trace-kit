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
