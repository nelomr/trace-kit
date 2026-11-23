/**
 * `@trace-kit/core/node` — isolated Node.js `node:worker_threads` adapter subpath.
 *
 * This is the only module in `@trace-kit/core` that imports `node:worker_threads`. It adapts
 * Node `Worker` and `MessagePort` (`parentPort`) instances to the DOM-free `WorkerLike` and
 * `WorkerMessageEndpoint` contracts without top-level side effects.
 */
import type { URL } from "node:url";
import {
  Worker as NodeWorker,
  type MessagePort as NodeMessagePort,
  type WorkerOptions,
} from "node:worker_threads";
import type {
  WorkerFactory,
  WorkerLike,
  WorkerMessageEndpoint,
  WorkerMessageEventLike,
} from "../transport/worker-channel.js";
import { attachDecimationWorker } from "../transport/worker-handler.js";

/**
 * Adapts a `node:worker_threads` `Worker` instance to the DOM-free `WorkerLike` contract.
 * Reuses a single mutable event shell per adapter to avoid per-message wrapper allocations,
 * and forwards unexpected non-zero `"exit"` events to `"error"` listeners so fatal exits
 * always trigger port recovery.
 */
export function adaptNodeWorker(nodeWorker: NodeWorker): WorkerLike {
  const eventShell: { data: unknown } = { data: undefined };
  const messageWrappers = new Map<
    (event: WorkerMessageEventLike) => void,
    (value: unknown) => void
  >();
  const errorListeners = new Set<(event: unknown) => void>();
  const messageErrorListeners = new Set<(event: unknown) => void>();

  let terminatedByHost = false;
  let exitListenerAttached = false;

  const onUnexpectedExit = (code: number): void => {
    if (terminatedByHost || code === 0) return;
    const exitError = new Error(`Node worker thread exited unexpectedly with code ${code}`);
    for (const listener of [...errorListeners]) {
      listener(exitError);
    }
  };

  function postMessage(message: unknown): void;
  function postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  function postMessage(message: unknown, transfer?: ArrayBuffer[]): void {
    if (transfer !== undefined) {
      nodeWorker.postMessage(message, transfer);
    } else {
      nodeWorker.postMessage(message);
    }
  }

  function addEventListener(
    type: "message",
    listener: (event: WorkerMessageEventLike) => void,
  ): void;
  function addEventListener(type: "error", listener: (event: unknown) => void): void;
  function addEventListener(type: "messageerror", listener: (event: unknown) => void): void;
  function addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
  ): void {
    if (type === "message") {
      const msgListener = listener;
      if (messageWrappers.has(msgListener)) return;
      const wrapper = (value: unknown): void => {
        eventShell.data = value;
        try {
          msgListener(eventShell);
        } finally {
          eventShell.data = undefined;
        }
      };
      messageWrappers.set(msgListener, wrapper);
      nodeWorker.on("message", wrapper);
      return;
    }

    if (type === "error") {
      const errListener = listener as (event: unknown) => void;
      if (errorListeners.has(errListener)) return;
      errorListeners.add(errListener);
      nodeWorker.on("error", errListener);
      if (!exitListenerAttached) {
        exitListenerAttached = true;
        nodeWorker.on("exit", onUnexpectedExit);
      }
      return;
    }

    const msgErrListener = listener as (event: unknown) => void;
    if (messageErrorListeners.has(msgErrListener)) return;
    messageErrorListeners.add(msgErrListener);
    nodeWorker.on("messageerror", msgErrListener);
  }

  function removeEventListener(
    type: "message",
    listener: (event: WorkerMessageEventLike) => void,
  ): void;
  function removeEventListener(type: "error", listener: (event: unknown) => void): void;
  function removeEventListener(type: "messageerror", listener: (event: unknown) => void): void;
  function removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
  ): void {
    if (type === "message") {
      const msgListener = listener;
      const wrapper = messageWrappers.get(msgListener);
      if (wrapper === undefined) return;
      messageWrappers.delete(msgListener);
      nodeWorker.off("message", wrapper);
      return;
    }

    if (type === "error") {
      const errListener = listener as (event: unknown) => void;
      if (!errorListeners.delete(errListener)) return;
      nodeWorker.off("error", errListener);
      if (errorListeners.size === 0 && exitListenerAttached) {
        exitListenerAttached = false;
        nodeWorker.off("exit", onUnexpectedExit);
      }
      return;
    }

    const msgErrListener = listener as (event: unknown) => void;
    if (!messageErrorListeners.delete(msgErrListener)) return;
    nodeWorker.off("messageerror", msgErrListener);
  }

  function terminate(): Promise<number> {
    terminatedByHost = true;
    if (exitListenerAttached) {
      exitListenerAttached = false;
      nodeWorker.off("exit", onUnexpectedExit);
    }
    return nodeWorker.terminate();
  }

  return {
    postMessage,
    terminate,
    addEventListener,
    removeEventListener,
  };
}

/**
 * Returns a `WorkerFactory` constructing a fresh `node:worker_threads` `Worker` on every
 * invocation and wrapping it with `adaptNodeWorker`.
 */
export function createNodeWorkerFactory(
  filename: string | URL,
  options?: WorkerOptions,
): WorkerFactory {
  return () => adaptNodeWorker(new NodeWorker(filename, options));
}

/**
 * Adapts a `node:worker_threads` `MessagePort` (`parentPort`) to `WorkerMessageEndpoint`.
 * Reuses a single mutable event shell per endpoint to avoid per-message wrapper allocations.
 */
export function createNodeParentPortEndpoint(port: NodeMessagePort): WorkerMessageEndpoint {
  const eventShell: { data: unknown } = { data: undefined };
  const messageWrappers = new Map<
    (event: WorkerMessageEventLike) => void,
    (value: unknown) => void
  >();

  function postMessage(message: unknown): void;
  function postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  function postMessage(message: unknown, transfer?: ArrayBuffer[]): void {
    if (transfer !== undefined) {
      port.postMessage(message, transfer);
    } else {
      port.postMessage(message);
    }
  }

  return {
    postMessage,
    addEventListener(_type, listener) {
      if (messageWrappers.has(listener)) return;
      const wrapper = (value: unknown): void => {
        eventShell.data = value;
        try {
          listener(eventShell);
        } finally {
          eventShell.data = undefined;
        }
      };
      messageWrappers.set(listener, wrapper);
      port.on("message", wrapper);
    },
    removeEventListener(_type, listener) {
      const wrapper = messageWrappers.get(listener);
      if (wrapper === undefined) return;
      messageWrappers.delete(listener);
      port.off("message", wrapper);
    },
  };
}

/**
 * Attaches the pure decimation worker handler to a Node `worker_threads` `parentPort` and
 * returns a detach callback that removes the registered listener.
 */
export function attachNodeDecimationWorker(port: NodeMessagePort): () => void {
  return attachDecimationWorker(createNodeParentPortEndpoint(port));
}
