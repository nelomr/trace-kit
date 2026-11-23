/**
 * `@trace-kit/core/worker` — pure, side-effect-free worker runtime entry point.
 *
 * Exports only the decimation worker handler, wire-protocol types, `DecimationKind`, and the
 * three decimation kernels so consumer worker bundles exclude viewport, CSV/NPY export, and
 * Node-only adapter code.
 */
export { minMaxEnvelope } from "./decimation/min-max.js";
export { minMaxEnvelopeIndices } from "./decimation/min-max-indices.js";
export { lttb } from "./decimation/lttb.js";

export { DecimationKind } from "./transport/decimation-port.js";

export type {
  WorkerMessageEventLike,
  WorkerMessageEndpoint,
  WorkerWorkMessage,
  WorkerInitSabMessage,
  WorkerDisposeMessage,
  WorkerReadyMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "./transport/worker-channel.js";

export type { DecimationWorkerHandler } from "./transport/worker-handler.js";
export {
  handleDecimationMessage,
  createDecimationWorkerHandler,
  attachDecimationWorker,
  attachCurrentDecimationWorker,
} from "./transport/worker-handler.js";
