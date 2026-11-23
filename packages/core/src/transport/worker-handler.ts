/**
 * Pure, effect-free decimation worker runtime supporting both Transferable `ArrayBuffer`
 * messages (`"work"`) and `SharedArrayBuffer` SPSC initialization (`"init-sab"`).
 *
 * Importing this module performs zero top-level side effects and never references `self` or
 * ambient `Worker` globals at module scope.
 */
import { lttb } from "../decimation/lttb.js";
import { minMaxEnvelope } from "../decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../decimation/min-max-indices.js";
import { DecimationKind } from "./decimation-port.js";
import {
  attachSabWorkerState,
  runSabWorkerLoop,
} from "./sab-channel.js";
import type {
  WorkerDisposeMessage,
  WorkerErrorMessage,
  WorkerInitSabMessage,
  WorkerMessageEndpoint,
  WorkerMessageEventLike,
  WorkerReadyMessage,
  WorkerResultMessage,
  WorkerWorkMessage,
} from "./worker-channel.js";

export interface DecimationWorkerHandler {
  handleMessage(data: unknown): void;
  dispose(): void;
}

type MessagePoster = Pick<WorkerMessageEndpoint, "postMessage">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkMessage(value: unknown): value is WorkerWorkMessage {
  if (!isRecord(value) || value.type !== "work") return false;
  return (
    typeof value.lease === "number" &&
    typeof value.workerEpoch === "number" &&
    typeof value.kind === "number" &&
    typeof value.sampleCount === "number" &&
    typeof value.bucketCount === "number" &&
    typeof value.domainMin === "number" &&
    typeof value.domainMax === "number" &&
    value.x instanceof ArrayBuffer &&
    value.y instanceof ArrayBuffer
  );
}

function isInitSabMessage(value: unknown): value is WorkerInitSabMessage {
  if (!isRecord(value) || value.type !== "init-sab") return false;
  if (typeof SharedArrayBuffer === "undefined") return false;
  return (
    value.version === 1 &&
    typeof value.workerEpoch === "number" &&
    value.controlSab instanceof SharedArrayBuffer &&
    value.dataSab instanceof SharedArrayBuffer
  );
}

function isDisposeMessage(value: unknown): value is WorkerDisposeMessage {
  return isRecord(value) && value.type === "dispose";
}

function postWorkerError(
  post: MessagePoster,
  lease: number,
  workerEpoch: number,
  code: string,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const reply: WorkerErrorMessage = {
    type: "error",
    lease,
    workerEpoch,
    code,
    message,
  };
  post.postMessage(reply);
}

function executeWorkMessage(msg: WorkerWorkMessage, post: MessagePoster): void {
  try {
    const y = new Float32Array(msg.y);

    if (msg.kind === DecimationKind.MinMaxEnvelope) {
      if (!(msg.out instanceof ArrayBuffer)) {
        throw new TypeError("MinMaxEnvelope work message requires transferable out ArrayBuffer");
      }
      const out = new Float32Array(msg.out);
      const outCount = minMaxEnvelope(y, 0, msg.sampleCount, out, 0, msg.bucketCount);
      const reply: WorkerResultMessage = {
        type: "result",
        lease: msg.lease,
        workerEpoch: msg.workerEpoch,
        kind: msg.kind,
        outCount,
        x: msg.x,
        y: msg.y,
        out: msg.out,
      };
      post.postMessage(reply, [msg.x, msg.y, msg.out]);
      return;
    }

    if (msg.kind === DecimationKind.MinMaxEnvelopeIndices) {
      if (!(msg.indices instanceof ArrayBuffer)) {
        throw new TypeError(
          "MinMaxEnvelopeIndices work message requires transferable indices ArrayBuffer",
        );
      }
      const indices = new Int32Array(msg.indices);
      const outCount = minMaxEnvelopeIndices(y, 0, msg.sampleCount, indices, 0, msg.bucketCount);
      const reply: WorkerResultMessage = {
        type: "result",
        lease: msg.lease,
        workerEpoch: msg.workerEpoch,
        kind: msg.kind,
        outCount,
        x: msg.x,
        y: msg.y,
        indices: msg.indices,
      };
      post.postMessage(reply, [msg.x, msg.y, msg.indices]);
      return;
    }

    if (msg.kind === DecimationKind.Lttb) {
      if (!(msg.out instanceof ArrayBuffer) || !(msg.indices instanceof ArrayBuffer)) {
        throw new TypeError("Lttb work message requires transferable out and indices ArrayBuffers");
      }
      const x = new Float32Array(msg.x);
      const indices = new Int32Array(msg.indices);
      const outCount = lttb(x, y, 0, msg.sampleCount, indices, 0, msg.bucketCount);
      const reply: WorkerResultMessage = {
        type: "result",
        lease: msg.lease,
        workerEpoch: msg.workerEpoch,
        kind: msg.kind,
        outCount,
        x: msg.x,
        y: msg.y,
        out: msg.out,
        indices: msg.indices,
      };
      post.postMessage(reply, [msg.x, msg.y, msg.out, msg.indices]);
      return;
    }

    throw new RangeError(`Unsupported DecimationKind: ${String(msg.kind)}`);
  } catch (err) {
    postWorkerError(post, msg.lease, msg.workerEpoch, "KERNEL_ERROR", err);
  }
}

/**
 * Statelessly processes a single inbound worker message payload. Returns `true` if the payload
 * was a recognized TraceKit protocol message, `false` otherwise.
 */
export function handleDecimationMessage(data: unknown, post: MessagePoster): boolean {
  if (isWorkMessage(data)) {
    executeWorkMessage(data, post);
    return true;
  }
  if (isInitSabMessage(data)) {
    try {
      const state = attachSabWorkerState(data.controlSab, data.dataSab);
      const ready: WorkerReadyMessage = {
        type: "ready",
        workerEpoch: data.workerEpoch,
      };
      post.postMessage(ready);
      runSabWorkerLoop(state);
    } catch (err) {
      postWorkerError(post, -1, data.workerEpoch, "INIT_SAB_ERROR", err);
    }
    return true;
  }
  if (isDisposeMessage(data)) {
    return true;
  }
  return false;
}

/** Creates a stateful worker handler wrapping `post` with explicit disposal. */
export function createDecimationWorkerHandler(post: MessagePoster): DecimationWorkerHandler {
  let disposed = false;

  return {
    handleMessage(data: unknown): void {
      if (disposed) return;
      if (isDisposeMessage(data)) {
        disposed = true;
        return;
      }
      handleDecimationMessage(data, post);
    },

    dispose(): void {
      disposed = true;
    },
  };
}

/**
 * Registers a TraceKit decimation handler on `endpoint` and returns a detach callback that
 * removes the exact registered `"message"` listener cleanly.
 */
export function attachDecimationWorker(endpoint: WorkerMessageEndpoint): () => void {
  const handler = createDecimationWorkerHandler(endpoint);
  const onMessage = (event: WorkerMessageEventLike): void => {
    handler.handleMessage(event.data);
  };
  endpoint.addEventListener("message", onMessage);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    endpoint.removeEventListener("message", onMessage);
    handler.dispose();
  };
}

function isWorkerMessageEndpoint(value: unknown): value is WorkerMessageEndpoint {
  if (typeof value !== "object" || value === null) return false;
  return (
    "postMessage" in value &&
    typeof value.postMessage === "function" &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function" &&
    "removeEventListener" in value &&
    typeof value.removeEventListener === "function"
  );
}

/**
 * Attaches the decimation handler to `globalThis` at call time after structurally validating
 * `WorkerMessageEndpoint` methods (zero casts, zero module-scope global access).
 */
export function attachCurrentDecimationWorker(): () => void {
  const g: unknown = globalThis;
  if (!isWorkerMessageEndpoint(g)) {
    throw new TypeError(
      "attachCurrentDecimationWorker requires a worker global implementing postMessage, addEventListener, and removeEventListener",
    );
  }
  return attachDecimationWorker(g);
}
