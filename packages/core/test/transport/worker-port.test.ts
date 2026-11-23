import { describe, expect, it, vi } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import {
  StatCounter,
  TransportHealth,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";
import {
  DecimationKind,
  type DecimationPort,
  FailureReason,
  PortMode,
  type SettlementSink,
} from "../../src/transport/decimation-port.js";
import { type Lease, SATURATED } from "../../src/transport/ownership.js";
import {
  CTRL_SHUTDOWN,
  SAB_ERROR_OUT_COUNT,
  type SabWorkerState,
  attachSabWorkerState,
  drainSabRequests,
} from "../../src/transport/sab-channel.js";
import { MAX_BUCKETS } from "../../src/transport/streaming-contract.js";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import type {
  WorkerErrorMessage,
  WorkerInitSabMessage,
  WorkerLike,
  WorkerMessageEndpoint,
  WorkerMessageEventLike,
  WorkerResultMessage,
  WorkerWorkMessage,
} from "../../src/transport/worker-channel.js";
import {
  attachCurrentDecimationWorker,
  attachDecimationWorker,
  handleDecimationMessage,
} from "../../src/transport/worker-handler.js";
import { createWorkerDecimationPort } from "../../src/transport/worker-port.js";

/**
 * Simulates real structured-clone ArrayBuffer transfer semantics (detaching every transferred
 * `ArrayBuffer` via `structuredClone(msg, { transfer })`) so unit tests verify genuine
 * `byteLength === 0` detachment without spawning an OS thread.
 */
interface FakeWorkerOptions {
  readonly throwOnSabInit?: boolean;
  readonly hangWork?: boolean;
  readonly crashOnSubmit?: boolean;
  readonly replyErrorOnSubmit?: boolean;
  readonly sabErrorOnNextJob?: boolean;
}

interface FakeWorkerController {
  readonly worker: WorkerLike;
  readonly postMessages: Array<{ message: unknown; transferLength: number }>;
  terminatedCount: number;
  sabState: SabWorkerState | null;
  lastInitSab: WorkerInitSabMessage | null;
  flushSab(): number;
  emitMessage(data: unknown): void;
  emitError(err?: unknown): void;
  emitMessageError(err?: unknown): void;
  setHang(hang: boolean): void;
}

function createFakeWorker(options: FakeWorkerOptions = {}): FakeWorkerController {
  const messageListeners = new Set<(event: WorkerMessageEventLike) => void>();
  const errorListeners = new Set<(event: unknown) => void>();
  const messageErrorListeners = new Set<(event: unknown) => void>();

  let hangWork = options.hangWork ?? false;
  let sabErrorOnce = options.sabErrorOnNextJob ?? false;

  const controller: FakeWorkerController = {
    postMessages: [],
    terminatedCount: 0,
    sabState: null,
    lastInitSab: null,

    flushSab(): number {
      if (controller.sabState === null) return 0;
      if (sabErrorOnce) {
        sabErrorOnce = false;
        // Write a negative sampleCount to force SAB_ERROR_OUT_COUNT (-1) via kernel error
        const state = controller.sabState;
        const reqHead = Atomics.load(state.ctrl, 16);
        if (state.reqTail !== reqHead) {
          const lease = state.ctrl[64 + (state.reqTail & 15)]!;
          const slot = lease & 0b111;
          state.ctrl[112 + (slot << 2) + 1] = -999;
        }
      }
      return drainSabRequests(controller.sabState);
    },

    emitMessage(data: unknown): void {
      const event: WorkerMessageEventLike = { data };
      for (const listener of [...messageListeners]) {
        listener(event);
      }
    },

    emitError(err: unknown = new Error("simulated worker crash")): void {
      for (const listener of [...errorListeners]) {
        listener(err);
      }
    },

    emitMessageError(err: unknown = new Error("simulated messageerror")): void {
      for (const listener of [...messageErrorListeners]) {
        listener(err);
      }
    },

    setHang(hang: boolean): void {
      hangWork = hang;
    },

    worker: {
      postMessage(message: unknown, transfer?: ArrayBuffer[]): void {
        const transferLength = transfer !== undefined ? transfer.length : 0;
        controller.postMessages.push({ message, transferLength });

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "init-sab"
        ) {
          if (options.throwOnSabInit) {
            const err = new Error("SharedArrayBuffer cannot be cloned in this context");
            err.name = "DataCloneError";
            throw err;
          }
          const initMsg = message as WorkerInitSabMessage;
          controller.lastInitSab = initMsg;
          controller.sabState = attachSabWorkerState(initMsg.controlSab, initMsg.dataSab);
          controller.emitMessage({ type: "ready", workerEpoch: initMsg.workerEpoch });
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "dispose"
        ) {
          return;
        }

        // Transfer path: genuinely detach transferred ArrayBuffers via structuredClone
        const cloned =
          transfer !== undefined
            ? structuredClone(message, { transfer })
            : structuredClone(message);

        if (options.crashOnSubmit) {
          controller.emitError(new Error("crash on submit"));
          return;
        }

        if (options.replyErrorOnSubmit) {
          const workMsg = cloned as WorkerWorkMessage;
          const errReply: WorkerErrorMessage = {
            type: "error",
            lease: workMsg.lease,
            workerEpoch: workMsg.workerEpoch,
            code: "KERNEL_ERROR",
            message: "injected error reply",
          };
          controller.emitMessage(errReply);
          return;
        }

        if (hangWork) {
          return;
        }

        handleDecimationMessage(cloned, {
          postMessage(reply: unknown, replyTransfer?: ArrayBuffer[]): void {
            const returned =
              replyTransfer !== undefined
                ? structuredClone(reply, { transfer: replyTransfer })
                : structuredClone(reply);
            controller.emitMessage(returned);
          },
        });
      },

      terminate(): void {
        controller.terminatedCount += 1;
      },

      addEventListener(
        type: "message" | "error" | "messageerror",
        listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
      ): void {
        if (type === "message") {
          messageListeners.add(listener);
        } else if (type === "error") {
          errorListeners.add(listener as (event: unknown) => void);
        } else {
          messageErrorListeners.add(listener as (event: unknown) => void);
        }
      },

      removeEventListener(
        type: "message" | "error" | "messageerror",
        listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
      ): void {
        if (type === "message") {
          messageListeners.delete(listener);
        } else if (type === "error") {
          errorListeners.delete(listener as (event: unknown) => void);
        } else {
          messageErrorListeners.delete(listener as (event: unknown) => void);
        }
      },
    },
  };

  return controller;
}

function withTransferRealm<T>(fn: () => T): T {
  const g = globalThis as { crossOriginIsolated?: boolean };
  const hadCoi = "crossOriginIsolated" in g;
  const originalCoi = g.crossOriginIsolated;
  try {
    g.crossOriginIsolated = false;
    return fn();
  } finally {
    if (hadCoi) g.crossOriginIsolated = originalCoi;
    else delete g.crossOriginIsolated;
  }
}

function withSharedRealm<T>(fn: () => T): T {
  const g = globalThis as { crossOriginIsolated?: boolean };
  const hadCoi = "crossOriginIsolated" in g;
  const originalCoi = g.crossOriginIsolated;
  try {
    g.crossOriginIsolated = true;
    return fn();
  } finally {
    if (hadCoi) g.crossOriginIsolated = originalCoi;
    else delete g.crossOriginIsolated;
  }
}

function fillWaveform(x: Float32Array, y: Float32Array, n: number): void {
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    x[i] = t * 50;
    const d = t - 0.5;
    y[i] = 2 / (1 + d * d * 200) - 0.1 * Math.cos(i * 0.25);
  }
}

describe("worker-handler — attachDecimationWorker and attachCurrentDecimationWorker", () => {
  it("detaches the exact registered listener on detach()", () => {
    const registered: Array<(event: WorkerMessageEventLike) => void> = [];
    const removed: Array<(event: WorkerMessageEventLike) => void> = [];
    const endpoint: WorkerMessageEndpoint = {
      postMessage() {},
      addEventListener(_type, listener) {
        registered.push(listener);
      },
      removeEventListener(_type, listener) {
        removed.push(listener);
      },
    };

    const detach = attachDecimationWorker(endpoint);
    expect(registered.length).toBe(1);
    expect(removed.length).toBe(0);

    detach();
    expect(removed.length).toBe(1);
    expect(removed[0]).toBe(registered[0]);

    // Idempotent second detach
    detach();
    expect(removed.length).toBe(1);
  });

  it("attachCurrentDecimationWorker rejects plain Node globalThis lacking worker endpoint methods", () => {
    expect(() => attachCurrentDecimationWorker()).toThrow(TypeError);
  });
});

describe("createWorkerDecimationPort — surface parity and eager workerFactory invocation", () => {
  it("reports PortMode.Asynchronous, matches sync port 19-member shape, and constructs via workerFactory", () => {
    withTransferRealm(() => {
      let factoryCalls = 0;
      const syncPort: DecimationPort = createSyncDecimationPort({ poolPairs: 2 });
      const workerPort: DecimationPort = createWorkerDecimationPort({
        poolPairs: 2,
        workerFactory: () => {
          factoryCalls += 1;
          return createFakeWorker().worker;
        },
      });

      expect(workerPort.mode).toBe(PortMode.Asynchronous);
      expect(factoryCalls).toBe(1);
      expect(Object.keys(workerPort).sort()).toEqual(Object.keys(syncPort).sort());
      expect(Object.keys(workerPort).length).toBe(19);

      syncPort.dispose();
      workerPort.dispose();
    });
  });

  it("executes identical generic DecimationPort consumer logic across sync and worker ports", () => {
    withTransferRealm(() => {
      const sampleCount = 256;
      const bucketCount = 16;

      function runConsumer(port: DecimationPort, kind: DecimationKind): number[] {
        const lease = port.acquire();
        if (lease === SATURATED) throw new Error("unexpected saturation");
        fillWaveform(port.viewX(lease), port.viewY(lease), sampleCount);
        port.setKind(lease, kind);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, 50);
        const inflight = port.submit(lease);
        expect(inflight).not.toBe(SATURATED);

        let result: number[] = [];
        const sink: SettlementSink = {
          onSettled(settled, outCount) {
            if (kind === DecimationKind.MinMaxEnvelope) {
              result = Array.from(port.viewOut(settled).subarray(0, outCount));
            } else {
              result = Array.from(port.viewIndices(settled).subarray(0, outCount));
            }
            port.release(settled);
          },
        };
        expect(port.poll(sink)).toBe(1);
        return result;
      }

      const syncPort = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 512 });
      const workerPort = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: 512,
        workerFactory: () => createFakeWorker().worker,
      });

      for (const kind of [
        DecimationKind.MinMaxEnvelope,
        DecimationKind.Lttb,
        DecimationKind.MinMaxEnvelopeIndices,
      ]) {
        expect(runConsumer(workerPort, kind)).toEqual(runConsumer(syncPort, kind));
      }

      syncPort.dispose();
      workerPort.dispose();
    });
  });
});

describe("createWorkerDecimationPort — Transfer mode kind-specific transfer lists & view preservation", () => {
  it("transfers 3, 3, and 4 buffers for MinMaxEnvelope, MinMaxEnvelopeIndices, and Lttb with exact detachment", () => {
    withTransferRealm(() => {
      const sampleCount = 128;
      const bucketCount = 16;
      const fake = createFakeWorker();
      const port = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: 256,
        workerFactory: () => fake.worker,
      });

      const refX = new Float32Array(sampleCount);
      const refY = new Float32Array(sampleCount);
      fillWaveform(refX, refY, sampleCount);

      const refMinMax = new Float32Array(MAX_BUCKETS * 2);
      const refMinMaxCount = minMaxEnvelope(refY, 0, sampleCount, refMinMax, 0, bucketCount);
      const refEnvIdx = new Int32Array(MAX_BUCKETS * 2);
      const refEnvIdxCount = minMaxEnvelopeIndices(refY, 0, sampleCount, refEnvIdx, 0, bucketCount);
      const refLttb = new Int32Array(MAX_BUCKETS * 2);
      const refLttbCount = lttb(refX, refY, 0, sampleCount, refLttb, 0, bucketCount);

      // 1. MinMaxEnvelope: 3 buffers (x, y, out); indices stays attached and === preserved
      {
        const lease = port.acquire();
        if (lease === SATURATED) throw new Error("unexpected saturation");
        const preX = port.viewX(lease);
        const preY = port.viewY(lease);
        const preOut = port.viewOut(lease);
        const preIdx = port.viewIndices(lease);
        preX.set(refX);
        preY.set(refY);
        port.setKind(lease, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, 50);

        port.submit(lease);
        expect(fake.postMessages[0]!.transferLength).toBe(3);
        expect(preX.byteLength).toBe(0);
        expect(preY.byteLength).toBe(0);
        expect(preOut.byteLength).toBe(0);
        expect(preIdx.byteLength).toBe(MAX_BUCKETS * 2 * 4);

        let settledCount = 0;
        port.poll({
          onSettled(settled, outCount) {
            settledCount = outCount;
            expect(port.viewX(settled).length).toBe(256);
            expect(port.viewY(settled).length).toBe(256);
            expect(port.viewOut(settled).length).toBe(MAX_BUCKETS * 2);
            expect(port.viewIndices(settled)).toBe(preIdx);
            expect(Array.from(port.viewOut(settled).subarray(0, outCount))).toEqual(
              Array.from(refMinMax.subarray(0, refMinMaxCount)),
            );
            port.release(settled);
          },
        });
        expect(settledCount).toBe(refMinMaxCount);
      }

      // 2. MinMaxEnvelopeIndices: 3 buffers (x, y, indices); out stays attached and === preserved
      {
        const lease = port.acquire();
        if (lease === SATURATED) throw new Error("unexpected saturation");
        const preX = port.viewX(lease);
        const preY = port.viewY(lease);
        const preOut = port.viewOut(lease);
        const preIdx = port.viewIndices(lease);
        preX.set(refX);
        preY.set(refY);
        port.setKind(lease, DecimationKind.MinMaxEnvelopeIndices);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, 50);

        port.submit(lease);
        expect(fake.postMessages[1]!.transferLength).toBe(3);
        expect(preX.byteLength).toBe(0);
        expect(preY.byteLength).toBe(0);
        expect(preOut.byteLength).toBe(MAX_BUCKETS * 2 * 4);
        expect(preIdx.byteLength).toBe(0);

        let settledCount = 0;
        port.poll({
          onSettled(settled, outCount) {
            settledCount = outCount;
            expect(port.viewOut(settled)).toBe(preOut);
            expect(port.viewIndices(settled).length).toBe(MAX_BUCKETS * 2);
            expect(Array.from(port.viewIndices(settled).subarray(0, outCount))).toEqual(
              Array.from(refEnvIdx.subarray(0, refEnvIdxCount)),
            );
            port.release(settled);
          },
        });
        expect(settledCount).toBe(refEnvIdxCount);
      }

      // 3. Lttb: 4 buffers (x, y, out, indices)
      {
        const lease = port.acquire();
        if (lease === SATURATED) throw new Error("unexpected saturation");
        const preX = port.viewX(lease);
        const preY = port.viewY(lease);
        const preOut = port.viewOut(lease);
        const preIdx = port.viewIndices(lease);
        preX.set(refX);
        preY.set(refY);
        port.setKind(lease, DecimationKind.Lttb);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, 50);

        port.submit(lease);
        expect(fake.postMessages[2]!.transferLength).toBe(4);
        expect(preX.byteLength).toBe(0);
        expect(preY.byteLength).toBe(0);
        expect(preOut.byteLength).toBe(0);
        expect(preIdx.byteLength).toBe(0);

        let settledCount = 0;
        port.poll({
          onSettled(settled, outCount) {
            settledCount = outCount;
            expect(port.viewX(settled).length).toBe(256);
            expect(port.viewY(settled).length).toBe(256);
            expect(port.viewOut(settled).length).toBe(MAX_BUCKETS * 2);
            expect(port.viewIndices(settled).length).toBe(MAX_BUCKETS * 2);
            expect(Array.from(port.viewIndices(settled).subarray(0, outCount))).toEqual(
              Array.from(refLttb.subarray(0, refLttbCount)),
            );
            port.release(settled);
          },
        });
        expect(settledCount).toBe(refLttbCount);
      }

      port.dispose();
    });
  });
});

describe("createWorkerDecimationPort — Shared mode SPSC, zero re-mints, and DataCloneError fallback", () => {
  it("posts init-sab exactly once, performs 0 steady-state postMessages, preserves === views, and never calls Atomics.wait", () => {
    withSharedRealm(() => {
      const waitSpy = vi.spyOn(Atomics, "wait");
      try {
        const fake = createFakeWorker();
        const port = createWorkerDecimationPort({
          poolPairs: 2,
          transitCapacitySamples: 128,
          workerFactory: () => fake.worker,
        });

        expect(fake.postMessages.length).toBe(1);
        expect(fake.lastInitSab?.type).toBe("init-sab");

        const firstLease = port.acquire();
        if (firstLease === SATURATED) throw new Error("unexpected saturation");
        const initialX = port.viewX(firstLease);
        const initialY = port.viewY(firstLease);
        const initialOut = port.viewOut(firstLease);
        const initialIdx = port.viewIndices(firstLease);
        expect(initialX.buffer).toBeInstanceOf(SharedArrayBuffer);
        port.release(firstLease);

        for (let iter = 0; iter < 50; iter += 1) {
          const lease = port.acquire();
          if (lease === SATURATED) throw new Error("unexpected saturation");
          expect(port.viewX(lease)).toBe(initialX);
          expect(port.viewY(lease)).toBe(initialY);
          expect(port.viewOut(lease)).toBe(initialOut);
          expect(port.viewIndices(lease)).toBe(initialIdx);

          fillWaveform(port.viewX(lease), port.viewY(lease), 64);
          port.setKind(lease, DecimationKind.MinMaxEnvelope);
          port.setSampleCount(lease, 64);
          port.setBucketCount(lease, 8);
          port.setDomain(lease, 0, 50);
          port.submit(lease);

          // Shared mode never detaches buffers on submit
          expect(initialX.byteLength).toBe(128 * 4);
          expect(fake.flushSab()).toBe(1);

          let drained = 0;
          port.poll({
            onSettled(settled, outCount) {
              drained += 1;
              expect(outCount).toBe(16);
              expect(port.viewX(settled)).toBe(initialX);
              expect(port.viewOut(settled)).toBe(initialOut);
              port.release(settled);
            },
          });
          expect(drained).toBe(1);
        }

        // Still strictly 1 postMessage (init-sab only)
        expect(fake.postMessages.length).toBe(1);
        port.dispose();
        expect(Atomics.load(fake.sabState!.ctrl, CTRL_SHUTDOWN)).toBe(1);
        expect(waitSpy).toHaveBeenCalledTimes(0);
      } finally {
        waitSpy.mockRestore();
      }
    });
  });

  it("falls back silently to Transfer on init-sab DataCloneError without throwing or counting a ResponderFailure", () => {
    withSharedRealm(() => {
      const fake = createFakeWorker({ throwOnSabInit: true });
      const port = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: 64,
        workerFactory: () => fake.worker,
      });

      const stats = createTransportStatsView();
      port.readStats(stats);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(0);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Ready);

      const lease = port.acquire();
      if (lease === SATURATED) throw new Error("unexpected saturation");
      // Downgraded to plain ArrayBuffer backing
      expect(port.viewX(lease).buffer).toBeInstanceOf(ArrayBuffer);
      fillWaveform(port.viewX(lease), port.viewY(lease), 32);
      port.setKind(lease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease, 32);
      port.setBucketCount(lease, 4);
      port.submit(lease);

      let outCountSeen = 0;
      port.poll({
        onSettled(settled, outCount) {
          outCountSeen = outCount;
          port.release(settled);
        },
      });
      expect(outCountSeen).toBe(8);
      port.dispose();
    });
  });
});

describe("createWorkerDecimationPort — unified failure handling, lazy respawn, cross-epoch SAB & stale replies", () => {
  it("recovers from error event, messageerror, worker error message, SAB -1 error, and lazy timeout without timers", () => {
    withTransferRealm(() => {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      try {
        let clock = 100;
        const workers: FakeWorkerController[] = [];
        const port = createWorkerDecimationPort({
          poolPairs: 2,
          transitCapacitySamples: 64,
          leaseTimeoutMs: 500,
          maxRemintEvents: 6,
          now: () => clock,
          workerFactory: () => {
            const ctrl = createFakeWorker({ hangWork: workers.length === 0 });
            workers.push(ctrl);
            return ctrl.worker;
          },
        });

        expect(workers.length).toBe(1);

        // 1. Lazy deadline timeout on hung worker
        const l1 = port.acquire();
        if (l1 === SATURATED) throw new Error("unexpected saturation");
        port.setKind(l1, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(l1, 16);
        port.setBucketCount(l1, 4);
        port.submit(l1);

        clock += 499;
        expect(port.poll({ onSettled() {} })).toBe(0);
        expect(workers[0]!.terminatedCount).toBe(0);

        clock += 1; // >= leaseTimeoutMs
        expect(port.poll({ onSettled() {} })).toBe(0);
        expect(workers[0]!.terminatedCount).toBe(1);
        // Lazy respawn: factory NOT invoked yet until next acquire() or submit()
        expect(workers.length).toBe(1);

        const stats = createTransportStatsView();
        port.readStats(stats);
        expect(stats.counters[StatCounter.ResponderFailures]).toBe(1);

        // Next acquire spawns worker #2 lazily
        const l2 = port.acquire();
        if (l2 === SATURATED) throw new Error("unexpected saturation");
        expect(workers.length).toBe(2);

        // 2. Worker error event
        fillWaveform(port.viewX(l2), port.viewY(l2), 16);
        port.setKind(l2, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(l2, 16);
        port.setBucketCount(l2, 4);
        workers[1]!.setHang(true);
        port.submit(l2);
        workers[1]!.emitError(new Error("uncaught worker throw"));
        expect(workers[1]!.terminatedCount).toBe(1);
        expect(workers.length).toBe(2); // still lazy

        // 3. messageerror event
        const l3 = port.acquire();
        if (l3 === SATURATED) throw new Error("unexpected saturation");
        expect(workers.length).toBe(3);
        workers[2]!.setHang(true);
        port.submit(l3);
        workers[2]!.emitMessageError();
        expect(workers[2]!.terminatedCount).toBe(1);

        // 4. WorkerErrorMessage
        const l4 = port.acquire();
        if (l4 === SATURATED) throw new Error("unexpected saturation");
        expect(workers.length).toBe(4);
        workers[3]!.setHang(true);
        const inflight4 = port.submit(l4);
        if (inflight4 === SATURATED) throw new Error("unexpected saturation");
        const errMsg: WorkerErrorMessage = {
          type: "error",
          lease: inflight4,
          workerEpoch: 3,
          code: "KERNEL_ERROR",
          message: "boom",
        };
        workers[3]!.emitMessage(errMsg);
        expect(workers[3]!.terminatedCount).toBe(1);

        // 5. Explicit reportResponderFailure
        const l5 = port.acquire();
        if (l5 === SATURATED) throw new Error("unexpected saturation");
        expect(workers.length).toBe(5);
        workers[4]!.setHang(true);
        port.submit(l5);
        port.reportResponderFailure(FailureReason.WorkerError);
        expect(workers[4]!.terminatedCount).toBe(1);

        port.readStats(stats);
        expect(stats.counters[StatCounter.ResponderFailures]).toBe(5);

        // Subsequent normal round trip works on lazily respawned worker #6
        const l6 = port.acquire();
        if (l6 === SATURATED) throw new Error("unexpected saturation");
        expect(workers.length).toBe(6);
        fillWaveform(port.viewX(l6), port.viewY(l6), 16);
        port.setKind(l6, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(l6, 16);
        port.setBucketCount(l6, 4);
        port.submit(l6);
        let settled = 0;
        port.poll({
          onSettled(s) {
            settled += 1;
            port.release(s);
          },
        });
        expect(settled).toBe(1);

        port.dispose();
        expect(setTimeoutSpy).toHaveBeenCalledTimes(0);
        expect(setIntervalSpy).toHaveBeenCalledTimes(0);
      } finally {
        setTimeoutSpy.mockRestore();
        setIntervalSpy.mockRestore();
      }
    });
  });

  it("reaches terminal TransportHealth.Degraded at maxRemintEvents and stops respawning", () => {
    withTransferRealm(() => {
      let spawns = 0;
      const port = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: 32,
        maxRemintEvents: 2,
        workerFactory: () => {
          spawns += 1;
          return createFakeWorker({ crashOnSubmit: true }).worker;
        },
      });

      expect(spawns).toBe(1);

      // Failure 1 -> remints (count=1 < 2), lazy respawn on next acquire
      const l1 = port.acquire();
      if (l1 === SATURATED) throw new Error("expected lease 1");
      port.submit(l1);

      // Failure 2 -> remints (count=2 === 2), lazy respawn on next acquire
      const l2 = port.acquire();
      if (l2 === SATURATED) throw new Error("expected lease 2");
      expect(spawns).toBe(2);
      port.submit(l2);

      // Failure 3 -> cap reached! Terminal Degraded, no respawn
      const l3 = port.acquire();
      if (l3 === SATURATED) throw new Error("expected lease 3");
      expect(spawns).toBe(3);
      port.submit(l3);

      const stats = createTransportStatsView();
      port.readStats(stats);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
      expect(stats.counters[StatCounter.RemintEvents]).toBe(2);

      // Further acquire returns SATURATED and never invokes workerFactory again
      expect(port.acquire()).toBe(SATURATED);
      expect(spawns).toBe(3);
      port.dispose();
    });
  });

  it("reaches terminal TransportHealth.Degraded at maxRemintEvents with poolPairs === 3 (Transfer): never hands out idle Free slots, respawns, or increments ResponderFailures", () => {
    withTransferRealm(() => {
      let spawns = 0;
      const port = createWorkerDecimationPort({
        poolPairs: 3,
        transitCapacitySamples: 32,
        maxRemintEvents: 2,
        workerFactory: () => {
          spawns += 1;
          return createFakeWorker({ crashOnSubmit: true }).worker;
        },
      });

      expect(spawns).toBe(1);

      // Only 1 slot InFlight per failure; 2 sibling slots stay Free.
      for (let failure = 1; failure <= 3; failure += 1) {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) throw new Error("expected lease");
        expect(spawns).toBe(failure);
        port.submit(lease);
      }

      const stats = createTransportStatsView();
      port.readStats(stats);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
      expect(stats.counters[StatCounter.RemintEvents]).toBe(2);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(3);

      // Further acquire() calls must return SATURATED permanently without spawning or incrementing failures.
      expect(port.acquire()).toBe(SATURATED);
      expect(port.acquire()).toBe(SATURATED);
      expect(port.acquire()).toBe(SATURATED);
      expect(spawns).toBe(3);

      port.readStats(stats);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(3);
      expect(stats.counters[StatCounter.ChunksDropped]).toBe(3);

      port.dispose();
    });
  });

  it("reaches terminal TransportHealth.Degraded at maxRemintEvents with poolPairs === 3 (Shared): never hands out idle Free slots, respawns, or increments ResponderFailures", () => {
    withSharedRealm(() => {
      const workers: FakeWorkerController[] = [];
      const port = createWorkerDecimationPort({
        poolPairs: 3,
        transitCapacitySamples: 64,
        maxRemintEvents: 2,
        workerFactory: () => {
          const ctrl = createFakeWorker({ sabErrorOnNextJob: true });
          workers.push(ctrl);
          return ctrl.worker;
        },
      });

      expect(workers.length).toBe(1);

      // Only 1 slot InFlight per failure; 2 sibling slots stay Free.
      for (let failure = 1; failure <= 3; failure += 1) {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) throw new Error("expected lease");
        expect(workers.length).toBe(failure);
        fillWaveform(port.viewX(lease), port.viewY(lease), 16);
        port.setKind(lease, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(lease, 16);
        port.setBucketCount(lease, 4);
        port.submit(lease);
        expect(workers[failure - 1]!.flushSab()).toBe(1);
        port.poll({ onSettled() {} });
      }

      const stats = createTransportStatsView();
      port.readStats(stats);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
      expect(stats.counters[StatCounter.RemintEvents]).toBe(2);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(3);

      // Further acquire() calls must return SATURATED permanently without spawning or incrementing failures.
      expect(port.acquire()).toBe(SATURATED);
      expect(port.acquire()).toBe(SATURATED);
      expect(port.acquire()).toBe(SATURATED);
      expect(workers.length).toBe(3);

      port.readStats(stats);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(3);
      expect(stats.counters[StatCounter.ChunksDropped]).toBe(3);

      port.dispose();
    });
  });

  it("handles Shared mode failure by minting fresh SABs and preserving sibling Acquired/Settled slots safely across epochs", () => {
    withSharedRealm(() => {
      let clock = 0;
      const workers: FakeWorkerController[] = [];
      const port = createWorkerDecimationPort({
        poolPairs: 3,
        transitCapacitySamples: 64,
        leaseTimeoutMs: 100,
        maxRemintEvents: 4,
        now: () => clock,
        workerFactory: () => {
          const ctrl = createFakeWorker();
          workers.push(ctrl);
          return ctrl.worker;
        },
      });

      const oldControlSab = workers[0]!.lastInitSab!.controlSab;
      const oldDataSab = workers[0]!.lastInitSab!.dataSab;

      // Slot 0: complete a job so it sits in Settled state on epoch 0
      const settledCandidate = port.acquire();
      if (settledCandidate === SATURATED) throw new Error("unexpected saturation");
      fillWaveform(port.viewX(settledCandidate), port.viewY(settledCandidate), 32);
      port.setKind(settledCandidate, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(settledCandidate, 32);
      port.setBucketCount(settledCandidate, 4);
      port.submit(settledCandidate);
      expect(workers[0]!.flushSab()).toBe(1);
      let settledLease: Lease<"settled"> | null = null;
      port.poll({
        onSettled(l) {
          settledLease = l;
        },
      });
      expect(settledLease).not.toBeNull();
      const settledOutBeforeFailure = Array.from(port.viewOut(settledLease!).subarray(0, 8));

      // Slot 1: submit and hang past leaseTimeoutMs
      const hungLease = port.acquire();
      if (hungLease === SATURATED) throw new Error("unexpected saturation");
      port.setKind(hungLease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(hungLease, 16);
      port.setBucketCount(hungLease, 4);
      port.submit(hungLease);

      // Slot 2: acquire and write caller samples BEFORE failure triggers
      const siblingAcquired = port.acquire();
      if (siblingAcquired === SATURATED) throw new Error("unexpected saturation");
      const refX = new Float32Array(32);
      const refY = new Float32Array(32);
      fillWaveform(refX, refY, 32);
      port.viewX(siblingAcquired).set(refX);
      port.viewY(siblingAcquired).set(refY);
      port.setKind(siblingAcquired, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(siblingAcquired, 32);
      port.setBucketCount(siblingAcquired, 4);
      const refOut = new Float32Array(MAX_BUCKETS * 2);
      const refOutCount = minMaxEnvelope(refY, 0, 32, refOut, 0, 4);

      // Trigger timeout on slot 1 via poll()
      clock += 200;
      port.poll({ onSettled() {} });
      expect(workers[0]!.terminatedCount).toBe(1);
      expect(Atomics.load(workers[0]!.sabState!.ctrl, CTRL_SHUTDOWN)).toBe(1);

      // Sibling Settled slot 0 is still completely readable on old dataSab!
      expect(Array.from(port.viewOut(settledLease!).subarray(0, 8))).toEqual(
        settledOutBeforeFailure,
      );
      port.release(settledLease!);

      // Sibling Acquired slot 2 submits cleanly -> lazily spawns worker #2 with NEW SAB pair
      // and copies valid sampleCount prefix into new dataSab!
      const inflightSibling = port.submit(siblingAcquired);
      expect(inflightSibling).not.toBe(SATURATED);
      expect(workers.length).toBe(2);

      const newControlSab = workers[1]!.lastInitSab!.controlSab;
      const newDataSab = workers[1]!.lastInitSab!.dataSab;
      expect(newControlSab).not.toBe(oldControlSab);
      expect(newDataSab).not.toBe(oldDataSab);

      expect(workers[1]!.flushSab()).toBe(1);
      let siblingResult: number[] = [];
      port.poll({
        onSettled(l, outCount) {
          expect(port.viewX(l).buffer).toBe(newDataSab);
          siblingResult = Array.from(port.viewOut(l).subarray(0, outCount));
          port.release(l);
        },
      });
      expect(siblingResult).toEqual(Array.from(refOut.subarray(0, refOutCount)));

      // Newly acquired slot 0 (which was released from Settled) is now bound to newDataSab too
      const reacquired = port.acquire();
      if (reacquired === SATURATED) throw new Error("unexpected saturation");
      expect(port.viewX(reacquired).buffer).toBe(newDataSab);
      port.release(reacquired);

      port.dispose();
    });
  });

  it("routes SAB outCount === -1 kernel error sentinel through unified failure recovery", () => {
    withSharedRealm(() => {
      const workers: FakeWorkerController[] = [];
      const port = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: 64,
        maxRemintEvents: 4,
        workerFactory: () => {
          const ctrl = createFakeWorker({ sabErrorOnNextJob: workers.length === 0 });
          workers.push(ctrl);
          return ctrl.worker;
        },
      });

      const lease = port.acquire();
      if (lease === SATURATED) throw new Error("unexpected saturation");
      fillWaveform(port.viewX(lease), port.viewY(lease), 16);
      port.setKind(lease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease, 16);
      port.setBucketCount(lease, 4);
      port.submit(lease);

      expect(workers[0]!.flushSab()).toBe(1);
      // Verify SAB error sentinel was written
      expect(workers[0]!.sabState!.ctrl[81]).toBe(SAB_ERROR_OUT_COUNT);

      let settled = 0;
      port.poll({
        onSettled() {
          settled += 1;
        },
      });
      expect(settled).toBe(0);
      expect(workers[0]!.terminatedCount).toBe(1);

      const stats = createTransportStatsView();
      port.readStats(stats);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(1);
      expect(stats.counters[StatCounter.RemintEvents]).toBe(1);
      port.dispose();
    });
  });

  it("drops stale workerEpoch and stale generation replies without re-minting views or notifying sink", () => {
    withTransferRealm(() => {
      let clock = 0;
      const workers: FakeWorkerController[] = [];
      const port = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: 32,
        leaseTimeoutMs: 100,
        now: () => clock,
        workerFactory: () => {
          const ctrl = createFakeWorker({ hangWork: true });
          workers.push(ctrl);
          return ctrl.worker;
        },
      });

      const l1 = port.acquire();
      if (l1 === SATURATED) throw new Error("unexpected saturation");
      const inflight1 = port.submit(l1);
      if (inflight1 === SATURATED) throw new Error("unexpected saturation");

      // Timeout slot 0 -> generation increments & workerEpoch increments
      clock += 200;
      const l2 = port.acquire();
      if (l2 === SATURATED) throw new Error("unexpected saturation");
      const liveXView = port.viewX(l2);
      const liveXRef = liveXView;

      // 1. Late zombie reply with stale workerEpoch=0 on live worker #2
      const staleEpochReply: WorkerResultMessage = {
        type: "result",
        lease: inflight1,
        workerEpoch: 0,
        kind: DecimationKind.MinMaxEnvelope,
        outCount: 4,
        x: new ArrayBuffer(32 * 4),
        y: new ArrayBuffer(32 * 4),
        out: new ArrayBuffer(MAX_BUCKETS * 2 * 4),
      };
      workers[1]!.emitMessage(staleEpochReply);

      // 2. Stale generation reply with matching workerEpoch=1 while slot is Acquired (not InFlight)
      const staleGenReply: WorkerResultMessage = {
        type: "result",
        lease: inflight1,
        workerEpoch: 1,
        kind: DecimationKind.MinMaxEnvelope,
        outCount: 4,
        x: new ArrayBuffer(32 * 4),
        y: new ArrayBuffer(32 * 4),
        out: new ArrayBuffer(MAX_BUCKETS * 2 * 4),
      };
      workers[1]!.emitMessage(staleGenReply);

      let sinkCalls = 0;
      expect(
        port.poll({
          onSettled() {
            sinkCalls += 1;
          },
        }),
      ).toBe(0);
      expect(sinkCalls).toBe(0);
      expect(port.viewX(l2)).toBe(liveXRef);

      const stats = createTransportStatsView();
      port.readStats(stats);
      expect(stats.counters[StatCounter.StaleSettlements]).toBe(2);

      port.dispose();
    });
  });

  it("dispose() is terminal and idempotent (terminates once, leaves all counters unchanged on second call)", () => {
    withTransferRealm(() => {
      const fake = createFakeWorker({ hangWork: true });
      const port = createWorkerDecimationPort({
        poolPairs: 2,
        transitCapacitySamples: 32,
        workerFactory: () => fake.worker,
      });

      const l1 = port.acquire();
      if (l1 === SATURATED) throw new Error("unexpected saturation");
      port.submit(l1);

      port.dispose();
      expect(fake.terminatedCount).toBe(1);

      const statsAfterFirst = createTransportStatsView();
      port.readStats(statsAfterFirst);
      expect(statsAfterFirst.counters[StatCounter.Health]).toBe(TransportHealth.Degraded);
      expect(statsAfterFirst.counters[StatCounter.LeasesOutstanding]).toBe(0);
      expect(port.acquire()).toBe(SATURATED);

      const statsBeforeSecond = createTransportStatsView();
      port.readStats(statsBeforeSecond);

      // Second dispose() must be a complete no-op
      port.dispose();
      expect(fake.terminatedCount).toBe(1);

      const statsAfterSecond = createTransportStatsView();
      port.readStats(statsAfterSecond);
      expect(Array.from(statsAfterSecond.counters)).toEqual(Array.from(statsBeforeSecond.counters));
      expect(Array.from(statsAfterSecond.gauges)).toEqual(Array.from(statsBeforeSecond.gauges));
    });
  });
});
