/**
 * `createWorkerDecimationPort` — asynchronous off-thread `DecimationPort` implementation over
 * DOM-free `WorkerLike` / `WorkerFactory` contracts.
 *
 * Automatically selects between `BufferBacking.Transfer` (universal default) and
 * `BufferBacking.Shared` (optional detected `SharedArrayBuffer` + `Atomics` SPSC fast path,
 * with silent `DataCloneError` fallback to `Transfer` during `init-sab`).
 */
import type {
  TransferableBacking,
  TransitIndexBuffer,
  TransitXBuffer,
  TransitYBuffer,
} from "../buffers/brand.js";
import type { TransportStatsView } from "./backpressure.js";
import {
  type BufferPool,
  type BufferPoolConfig,
  type ReplacementViews,
  type SlotViews,
  createBufferPool,
} from "./buffer-pool.js";
import { BufferBacking, detectTransportCapabilities, selectBufferBacking } from "./capabilities.js";
import {
  DecimationKind,
  type DecimationPort,
  FailureReason,
  PortMode,
  type SettlementSink,
} from "./decimation-port.js";
import {
  type Lease,
  SATURATED,
  type Saturated,
  SlotState,
  collectTransferList,
  unpackGeneration,
  unpackSlot,
} from "./ownership.js";
import {
  SAB_ERROR_OUT_COUNT,
  type SabChannel,
  createSabChannel,
  drainSabResponses,
  enqueueSabJob,
  signalSabShutdown,
} from "./sab-channel.js";
import { MAX_BUCKETS } from "./streaming-contract.js";
import type {
  WorkerDisposeMessage,
  WorkerFactory,
  WorkerInitSabMessage,
  WorkerLike,
  WorkerMessageEventLike,
  WorkerOutboundMessage,
} from "./worker-channel.js";

const MIN_POOL_PAIRS = 1;
const MAX_POOL_PAIRS = 8;
const DEFAULT_POOL_PAIRS = 3;
const DEFAULT_TRANSIT_CAPACITY_SAMPLES = 65_536;

const DISPOSE_MESSAGE: WorkerDisposeMessage = { type: "dispose" };

interface MutableWorkerWorkMessage {
  type: "work";
  lease: number;
  workerEpoch: number;
  kind: DecimationKind;
  sampleCount: number;
  bucketCount: number;
  domainMin: number;
  domainMax: number;
  x: ArrayBuffer;
  y: ArrayBuffer;
  out: ArrayBuffer | undefined;
  indices: ArrayBuffer | undefined;
}

export interface WorkerDecimationPortConfig extends BufferPoolConfig {
  workerFactory: WorkerFactory;
}

function clampPoolPairs(value: number | undefined): number {
  const requested = value ?? DEFAULT_POOL_PAIRS;
  if (requested < MIN_POOL_PAIRS) return MIN_POOL_PAIRS;
  if (requested > MAX_POOL_PAIRS) return MAX_POOL_PAIRS;
  return requested;
}

export function createWorkerDecimationPort(
  config: WorkerDecimationPortConfig,
): DecimationPort {
  const poolPairs = clampPoolPairs(config.poolPairs);
  const transitCapacitySamples =
    config.transitCapacitySamples ?? DEFAULT_TRANSIT_CAPACITY_SAMPLES;
  const outCapacity = MAX_BUCKETS * 2;

  let activeBacking = selectBufferBacking(detectTransportCapabilities());
  let sabChannel: SabChannel | null =
    activeBacking === BufferBacking.Shared
      ? createSabChannel(poolPairs, transitCapacitySamples)
      : null;
  let sabEpoch = 0;
  const slotSabEpoch = new Int32Array(poolPairs);

  let worker: WorkerLike | null = null;
  let workerEpoch = 0;
  let awaitingRespawn = false;
  let disposed = false;
  let degraded = false;
  let inFailureHandling = false;

  function allocateTransferSlotViews(): SlotViews {
    return {
      x: new Float32Array(transitCapacitySamples),
      y: new Float32Array(transitCapacitySamples),
      out: new Float32Array(outCapacity),
      indices: new Int32Array(outCapacity),
    };
  }

  function allocateCurrentSlotViews(slot: number): SlotViews {
    if (activeBacking === BufferBacking.Shared && sabChannel !== null) {
      slotSabEpoch[slot] = sabEpoch;
      return sabChannel.slotViews[slot]!;
    }
    return allocateTransferSlotViews();
  }

  function teardownWorker(): void {
    const active = worker;
    worker = null;
    workerEpoch += 1;
    if (active === null) return;
    active.removeEventListener("message", onWorkerMessage);
    active.removeEventListener("error", onWorkerError);
    active.removeEventListener("messageerror", onWorkerMessageError);
    try {
      void active.terminate();
    } catch {
      // Ignore termination errors from already-crashed workers.
    }
  }

  function hasAnyLostSlot(): boolean {
    for (let slot = 0; slot < poolPairs; slot += 1) {
      if (pool.__debugState(slot) === SlotState.Lost) return true;
    }
    return false;
  }

  function handlePoolResponderFailure(_reason: FailureReason, willRemint: boolean): void {
    if (inFailureHandling) return;
    inFailureHandling = true;
    try {
      if (activeBacking === BufferBacking.Shared && sabChannel !== null) {
        signalSabShutdown(sabChannel);
      }
      teardownWorker();

      if (disposed) {
        degraded = true;
        awaitingRespawn = false;
        return;
      }

      const terminalDegraded = !willRemint && hasAnyLostSlot();
      if (terminalDegraded) {
        degraded = true;
        awaitingRespawn = false;
        sabChannel = null;
        return;
      }

      awaitingRespawn = true;
      if (activeBacking === BufferBacking.Shared) {
        sabChannel = createSabChannel(poolPairs, transitCapacitySamples);
        sabEpoch += 1;
      }
    } finally {
      inFailureHandling = false;
    }
  }

  const pool: BufferPool = createBufferPool(config, {
    backing: activeBacking,
    allocateSlotViews: allocateCurrentSlotViews,
    onResponderFailure: handlePoolResponderFailure,
  });

  const requestKind = new Int32Array(pool.poolPairs);
  const requestSampleCount = new Int32Array(pool.poolPairs);
  const requestBucketCount = new Int32Array(pool.poolPairs);
  const requestDomainMin = new Float64Array(pool.poolPairs);
  const requestDomainMax = new Float64Array(pool.poolPairs);

  // Preallocated per-slot message and replacement shells for zero extra Transfer allocations.
  const emptyBuffer = new ArrayBuffer(0);
  const emptyF32 = new Float32Array(0);
  const workMessages: MutableWorkerWorkMessage[] = [];
  const replacementSlots: ReplacementViews[] = [];
  for (let slot = 0; slot < pool.poolPairs; slot += 1) {
    workMessages.push({
      type: "work",
      lease: 0,
      workerEpoch: 0,
      kind: DecimationKind.MinMaxEnvelope,
      sampleCount: 0,
      bucketCount: 0,
      domainMin: 0,
      domainMax: 0,
      x: emptyBuffer,
      y: emptyBuffer,
      out: undefined,
      indices: undefined,
    });
    replacementSlots.push({
      x: emptyF32,
      y: emptyF32,
      out: undefined,
      indices: undefined,
    });
  }

  const sources3: TransferableBacking[] = [
    emptyF32 as TransitXBuffer,
    emptyF32 as TransitYBuffer,
    emptyF32 as TransitYBuffer,
  ];
  const sources4: TransferableBacking[] = [
    emptyF32 as TransitXBuffer,
    emptyF32 as TransitYBuffer,
    emptyF32 as TransitYBuffer,
    new Int32Array(0) as TransitIndexBuffer,
  ];
  const transferList3: ArrayBuffer[] = [emptyBuffer, emptyBuffer, emptyBuffer];
  const transferList4: ArrayBuffer[] = [emptyBuffer, emptyBuffer, emptyBuffer, emptyBuffer];

  function onWorkerError(): void {
    if (disposed || inFailureHandling) return;
    pool.reportResponderFailure(FailureReason.WorkerError);
  }

  function onWorkerMessageError(): void {
    if (disposed || inFailureHandling) return;
    pool.reportResponderFailure(FailureReason.MessageError);
  }

  function onWorkerMessage(event: WorkerMessageEventLike): void {
    const data = event.data;
    if (typeof data !== "object" || data === null || !("type" in data)) return;
    const msg = data as WorkerOutboundMessage;

    if (msg.type === "ready") return;

    if (msg.type === "error") {
      if (disposed || msg.workerEpoch !== workerEpoch) {
        pool.noteStaleSettlement();
        return;
      }
      if (msg.lease !== -1 && !pool.isInFlightLease(msg.lease)) {
        pool.noteStaleSettlement();
        return;
      }
      pool.reportResponderFailure(FailureReason.WorkerError);
      return;
    }

    if (msg.type !== "result") return;

    if (disposed || msg.workerEpoch !== workerEpoch || !pool.isInFlightLease(msg.lease)) {
      pool.noteStaleSettlement();
      return;
    }

    if (!(msg.x instanceof ArrayBuffer) || !(msg.y instanceof ArrayBuffer)) {
      pool.reportResponderFailure(FailureReason.MessageError);
      return;
    }

    const slot = unpackSlot(msg.lease);
    const replacement = replacementSlots[slot]!;

    if (msg.kind === DecimationKind.MinMaxEnvelope) {
      if (!(msg.out instanceof ArrayBuffer)) {
        pool.reportResponderFailure(FailureReason.MessageError);
        return;
      }
      replacement.x = new Float32Array(msg.x);
      replacement.y = new Float32Array(msg.y);
      replacement.out = new Float32Array(msg.out);
      replacement.indices = undefined;
    } else if (msg.kind === DecimationKind.MinMaxEnvelopeIndices) {
      if (!(msg.indices instanceof ArrayBuffer)) {
        pool.reportResponderFailure(FailureReason.MessageError);
        return;
      }
      replacement.x = new Float32Array(msg.x);
      replacement.y = new Float32Array(msg.y);
      replacement.out = undefined;
      replacement.indices = new Int32Array(msg.indices);
    } else {
      if (!(msg.out instanceof ArrayBuffer) || !(msg.indices instanceof ArrayBuffer)) {
        pool.reportResponderFailure(FailureReason.MessageError);
        return;
      }
      replacement.x = new Float32Array(msg.x);
      replacement.y = new Float32Array(msg.y);
      replacement.out = new Float32Array(msg.out);
      replacement.indices = new Int32Array(msg.indices);
    }

    pool.settle(msg.lease as Lease<"inflight">, msg.outCount, replacement);
  }

  function onSabResponse(lease: number, outCount: number): void {
    if (disposed || !pool.isInFlightLease(lease)) {
      pool.noteStaleSettlement();
      return;
    }
    if (outCount === SAB_ERROR_OUT_COUNT) {
      pool.reportResponderFailure(FailureReason.WorkerError);
      return;
    }
    pool.settle(lease as Lease<"inflight">, outCount);
  }

  function spawnWorker(): void {
    if (disposed || degraded) return;
    const nextWorker = config.workerFactory();
    worker = nextWorker;
    awaitingRespawn = false;
    nextWorker.addEventListener("message", onWorkerMessage);
    nextWorker.addEventListener("error", onWorkerError);
    nextWorker.addEventListener("messageerror", onWorkerMessageError);

    if (activeBacking === BufferBacking.Shared && sabChannel !== null) {
      const initMsg: WorkerInitSabMessage = {
        type: "init-sab",
        version: 1,
        workerEpoch,
        controlSab: sabChannel.controlSab,
        dataSab: sabChannel.dataSab,
      };
      try {
        nextWorker.postMessage(initMsg);
      } catch {
        // Defensive fallback: structured clone rejected SharedArrayBuffer across realms.
        // Switch silently to Transfer without throwing or counting a responder failure.
        sabChannel = null;
        activeBacking = BufferBacking.Transfer;
        pool.rebindSlotViews(allocateTransferSlotViews, BufferBacking.Transfer);
      }
    }
  }

  // Eager initial spawn so worker script compilation and optional init-sab handshake (including
  // any defensive DataCloneError fallback) complete before the first acquire().
  spawnWorker();

  const port: DecimationPort = {
    mode: PortMode.Asynchronous,
    poolPairs: pool.poolPairs,
    transitCapacitySamples: pool.transitCapacitySamples,

    setKind(lease, kind) {
      requestKind[unpackSlot(lease)] = kind;
    },
    setSampleCount(lease, count) {
      requestSampleCount[unpackSlot(lease)] = count;
    },
    setBucketCount(lease, buckets) {
      requestBucketCount[unpackSlot(lease)] = buckets;
    },
    setDomain(lease, min, max) {
      const slot = unpackSlot(lease);
      requestDomainMin[slot] = min;
      requestDomainMax[slot] = max;
    },

    acquire(): Lease<"acquired"> | Saturated {
      const lease = pool.acquire();
      if (lease === SATURATED) return SATURATED;

      if (activeBacking === BufferBacking.Shared && sabChannel !== null) {
        const slot = unpackSlot(lease);
        if (slotSabEpoch[slot] !== sabEpoch) {
          pool.replaceSlotViews(slot, sabChannel.slotViews[slot]!);
          slotSabEpoch[slot] = sabEpoch;
        }
      }

      if (awaitingRespawn && !disposed && !degraded) {
        spawnWorker();
      }
      return lease;
    },

    viewX(lease) {
      return pool.viewX(lease);
    },
    viewY(lease) {
      return pool.viewY(lease);
    },
    viewOut(lease) {
      return pool.viewOut(lease);
    },
    viewIndices(lease) {
      return pool.viewIndices(lease);
    },

    submit(lease: Lease<"acquired">): Lease<"inflight"> | Saturated {
      const slot = unpackSlot(lease);
      if (
        slot < 0 ||
        slot >= pool.poolPairs ||
        pool.__debugState(lease) !== SlotState.Acquired ||
        unpackGeneration(lease) !== pool.__debugGeneration(slot)
      ) {
        return pool.submit(lease);
      }

      if (awaitingRespawn && !disposed && !degraded) {
        spawnWorker();
      }

      const kind: DecimationKind = requestKind[slot] ?? DecimationKind.MinMaxEnvelope;
      const sampleCount = requestSampleCount[slot] ?? 0;
      const bucketCount = requestBucketCount[slot] ?? 0;
      const domainMin = requestDomainMin[slot] ?? 0;
      const domainMax = requestDomainMax[slot] ?? 0;

      if (activeBacking === BufferBacking.Shared && sabChannel !== null) {
        if (slotSabEpoch[slot] !== sabEpoch) {
          const oldX = pool.viewX(lease);
          const oldY = pool.viewY(lease);
          const newViews = sabChannel.slotViews[slot]!;
          const copyCount =
            sampleCount > transitCapacitySamples
              ? transitCapacitySamples
              : sampleCount < 0
                ? 0
                : sampleCount;
          for (let i = 0; i < copyCount; i += 1) {
            newViews.x[i] = oldX[i]!;
            newViews.y[i] = oldY[i]!;
          }
          pool.replaceSlotViews(slot, newViews);
          slotSabEpoch[slot] = sabEpoch;
        }

        const inflight = pool.submit(lease);
        if (inflight === SATURATED) return SATURATED;

        enqueueSabJob(
          sabChannel,
          slot,
          inflight,
          kind,
          sampleCount,
          bucketCount,
          domainMin,
          domainMax,
        );
        return inflight;
      }

      const xView = pool.viewX(lease);
      const yView = pool.viewY(lease);
      const outView = pool.viewOut(lease);
      const indicesView = pool.viewIndices(lease);

      const inflight = pool.submit(lease);
      if (inflight === SATURATED) return SATURATED;

      const activeWorker = worker;
      if (activeWorker === null) {
        pool.reportResponderFailure(FailureReason.WorkerError);
        return inflight;
      }

      const msg = workMessages[slot]!;
      msg.lease = inflight;
      msg.workerEpoch = workerEpoch;
      msg.kind = kind;
      msg.sampleCount = sampleCount;
      msg.bucketCount = bucketCount;
      msg.domainMin = domainMin;
      msg.domainMax = domainMax;
      msg.x = xView.buffer as ArrayBuffer;
      msg.y = yView.buffer as ArrayBuffer;

      try {
        if (kind === DecimationKind.MinMaxEnvelope) {
          msg.out = outView.buffer as ArrayBuffer;
          msg.indices = undefined;
          sources3[0] = xView as TransitXBuffer;
          sources3[1] = yView as TransitYBuffer;
          sources3[2] = outView as TransitYBuffer;
          collectTransferList(sources3, transferList3);
          activeWorker.postMessage(msg, transferList3);
        } else if (kind === DecimationKind.MinMaxEnvelopeIndices) {
          msg.out = undefined;
          msg.indices = indicesView.buffer as ArrayBuffer;
          sources3[0] = xView as TransitXBuffer;
          sources3[1] = yView as TransitYBuffer;
          sources3[2] = indicesView as TransitIndexBuffer;
          collectTransferList(sources3, transferList3);
          activeWorker.postMessage(msg, transferList3);
        } else {
          msg.out = outView.buffer as ArrayBuffer;
          msg.indices = indicesView.buffer as ArrayBuffer;
          sources4[0] = xView as TransitXBuffer;
          sources4[1] = yView as TransitYBuffer;
          sources4[2] = outView as TransitYBuffer;
          sources4[3] = indicesView as TransitIndexBuffer;
          collectTransferList(sources4, transferList4);
          activeWorker.postMessage(msg, transferList4);
        }
      } catch {
        pool.reportResponderFailure(FailureReason.WorkerError);
      }

      return inflight;
    },

    poll(sink: SettlementSink): number {
      if (!disposed && activeBacking === BufferBacking.Shared && sabChannel !== null) {
        drainSabResponses(sabChannel, onSabResponse);
      }
      return pool.poll(sink);
    },

    release(lease) {
      pool.release(lease);
      if (!disposed && activeBacking === BufferBacking.Shared && sabChannel !== null) {
        const slot = unpackSlot(lease);
        if (
          slot >= 0 &&
          slot < pool.poolPairs &&
          pool.__debugState(lease) === SlotState.Free &&
          slotSabEpoch[slot] !== sabEpoch
        ) {
          pool.replaceSlotViews(slot, sabChannel.slotViews[slot]!);
          slotSabEpoch[slot] = sabEpoch;
        }
      }
    },

    reportResponderFailure(reason: FailureReason) {
      pool.reportResponderFailure(reason);
    },
    noteDroppedSamples(count: number) {
      pool.noteDroppedSamples(count);
    },
    readStats(out: TransportStatsView) {
      pool.readStats(out);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      degraded = true;
      awaitingRespawn = false;
      if (activeBacking === BufferBacking.Shared && sabChannel !== null) {
        signalSabShutdown(sabChannel);
      } else if (worker !== null) {
        try {
          worker.postMessage(DISPOSE_MESSAGE);
        } catch {
          // Ignore postMessage failure on already-closed worker during disposal.
        }
      }
      teardownWorker();
      pool.dispose();
    },
  };

  return port;
}
