/**
 * Shared-memory SPSC ring transport over a 704-byte cache-line-separated control
 * `SharedArrayBuffer` and a single 64-byte-aligned contiguous data `SharedArrayBuffer`.
 *
 * Host-side functions (`createSabChannel`, `enqueueSabJob`, `drainSabResponses`,
 * `signalSabShutdown`) are strictly non-blocking and never invoke `Atomics.wait`.
 * Worker-side `runSabWorkerLoop` waits with a bounded 50 ms timeout and checks `CTRL_SHUTDOWN`
 * before and after waiting so disposal never hangs.
 */
import { lttb } from "../decimation/lttb.js";
import { minMaxEnvelope } from "../decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../decimation/min-max-indices.js";
import type { SlotViews } from "./buffer-pool.js";
import { DecimationKind } from "./decimation-port.js";
import { unpackSlot } from "./ownership.js";
import { MAX_BUCKETS } from "./streaming-contract.js";

/** Total byte length of the control `SharedArrayBuffer` (176 Int32 words = 88 Float64 words). */
export const SAB_CONTROL_BYTE_LENGTH = 704;

/** ASCII `"TKSB"` magic header value verifying control-block compatibility. */
export const CTRL_MAGIC = 0x544b_5342;
export const CTRL_VERSION = 1;

// Cache Line 0 (bytes 0..63, Int32[0..15]) — Immutable header written once before init-sab
export const CTRL_HEADER_MAGIC = 0;
export const CTRL_HEADER_VERSION = 1;
export const CTRL_HEADER_POOL_PAIRS = 2;
export const CTRL_HEADER_CAPACITY_SAMPLES = 3;
export const CTRL_HEADER_SLOT_STRIDE = 4;
export const CTRL_HEADER_Y_OFFSET = 5;
export const CTRL_HEADER_OUT_OFFSET = 6;
export const CTRL_HEADER_INDICES_OFFSET = 7;

// Cache Line 1 (bytes 64..127, Int32[16..31]) — Host-written atomic control
export const CTRL_REQ_HEAD = 16;
export const CTRL_SHUTDOWN = 17;

// Cache Line 2 (bytes 128..191, Int32[32..47]) — Worker-written atomic control
export const CTRL_REQ_TAIL = 32;
export const CTRL_RES_HEAD = 33;
export const CTRL_WORKER_STATUS = 34;

// Cache Line 3 (bytes 192..255, Int32[48..63]) — Host-written response consumer cursor
export const CTRL_RES_TAIL = 48;

// Lines 4..10 (bytes 256..703, Int32[64..175]) — Fixed rings and per-slot parameter tables
export const SAB_RING_CAPACITY = 16;
export const SAB_RING_MASK = 15;

export const CTRL_REQ_RING_BASE = 64;
export const CTRL_RES_RING_BASE = 80;
export const CTRL_SLOT_PARAMS_I32_BASE = 112;
/** Float64 word index into `controlSab` (byte offset 576 = 72 * 8, 64-byte aligned). */
export const CTRL_SLOT_PARAMS_F64_BASE = 72;

/** Sentinel `outCount` written into `resRing` when a worker kernel throws. */
export const SAB_ERROR_OUT_COUNT = -1;

/** Bounded wait duration on the worker thread so lost wakeups can never wedge teardown. */
export const SAB_WAIT_TIMEOUT_MS = 50;

export const SAB_WORKER_STATUS_INIT = 0;
export const SAB_WORKER_STATUS_RUNNING = 1;
export const SAB_WORKER_STATUS_ERROR = 2;
export const SAB_WORKER_STATUS_STOPPED = 3;

export interface SabChannel {
  readonly poolPairs: number;
  readonly transitCapacitySamples: number;
  readonly controlSab: SharedArrayBuffer;
  readonly dataSab: SharedArrayBuffer;
  readonly ctrl: Int32Array;
  readonly ctrlF64: Float64Array;
  readonly slotViews: readonly SlotViews[];
  reqHead: number;
  resTail: number;
}

export interface SabWorkerState {
  readonly poolPairs: number;
  readonly transitCapacitySamples: number;
  readonly ctrl: Int32Array;
  readonly ctrlF64: Float64Array;
  readonly slotViews: readonly SlotViews[];
  reqTail: number;
  resHead: number;
}

function align64(bytes: number): number {
  return Math.ceil(bytes / 64) * 64;
}

function bindDataSabSlotViews(
  dataSab: SharedArrayBuffer,
  poolPairs: number,
  transitCapacitySamples: number,
  slotByteStride: number,
  yOffset: number,
  outOffset: number,
  indicesOffset: number,
): SlotViews[] {
  const outLen = MAX_BUCKETS * 2;
  const views: SlotViews[] = [];
  for (let slot = 0; slot < poolPairs; slot += 1) {
    const base = slot * slotByteStride;
    views.push({
      x: new Float32Array(dataSab, base, transitCapacitySamples),
      y: new Float32Array(dataSab, base + yOffset, transitCapacitySamples),
      out: new Float32Array(dataSab, base + outOffset, outLen),
      indices: new Int32Array(dataSab, base + indicesOffset, outLen),
    });
  }
  return views;
}

export function createSabChannel(
  poolPairs: number,
  transitCapacitySamples: number,
): SabChannel {
  const sampleBytes = transitCapacitySamples * 4;
  const outBytes = MAX_BUCKETS * 2 * 4;
  const yOffset = align64(sampleBytes);
  const outOffset = align64(yOffset + sampleBytes);
  const indicesOffset = align64(outOffset + outBytes);
  const slotByteStride = align64(indicesOffset + outBytes);

  const controlSab = new SharedArrayBuffer(SAB_CONTROL_BYTE_LENGTH);
  const dataSab = new SharedArrayBuffer(poolPairs * slotByteStride);
  const ctrl = new Int32Array(controlSab);
  const ctrlF64 = new Float64Array(controlSab);

  ctrl[CTRL_HEADER_MAGIC] = CTRL_MAGIC;
  ctrl[CTRL_HEADER_VERSION] = CTRL_VERSION;
  ctrl[CTRL_HEADER_POOL_PAIRS] = poolPairs;
  ctrl[CTRL_HEADER_CAPACITY_SAMPLES] = transitCapacitySamples;
  ctrl[CTRL_HEADER_SLOT_STRIDE] = slotByteStride;
  ctrl[CTRL_HEADER_Y_OFFSET] = yOffset;
  ctrl[CTRL_HEADER_OUT_OFFSET] = outOffset;
  ctrl[CTRL_HEADER_INDICES_OFFSET] = indicesOffset;

  const slotViews = bindDataSabSlotViews(
    dataSab,
    poolPairs,
    transitCapacitySamples,
    slotByteStride,
    yOffset,
    outOffset,
    indicesOffset,
  );

  return {
    poolPairs,
    transitCapacitySamples,
    controlSab,
    dataSab,
    ctrl,
    ctrlF64,
    slotViews,
    reqHead: 0,
    resTail: 0,
  };
}

/**
 * Host-side non-blocking job enqueue. Writes slot parameters and publishes the packed lease via
 * release `Atomics.store` + `Atomics.notify`. Never allocates and never calls `Atomics.wait`.
 */
export function enqueueSabJob(
  channel: SabChannel,
  slot: number,
  lease: number,
  kind: DecimationKind,
  sampleCount: number,
  bucketCount: number,
  domainMin: number,
  domainMax: number,
): void {
  const ctrl = channel.ctrl;
  const ctrlF64 = channel.ctrlF64;

  const i32Base = CTRL_SLOT_PARAMS_I32_BASE + (slot << 2);
  ctrl[i32Base] = kind;
  ctrl[i32Base + 1] = sampleCount;
  ctrl[i32Base + 2] = bucketCount;
  ctrl[i32Base + 3] = 0;

  const f64Base = CTRL_SLOT_PARAMS_F64_BASE + (slot << 1);
  ctrlF64[f64Base] = domainMin;
  ctrlF64[f64Base + 1] = domainMax;

  const reqHead = channel.reqHead;
  ctrl[CTRL_REQ_RING_BASE + (reqHead & SAB_RING_MASK)] = lease;
  const nextHead = (reqHead + 1) | 0;
  channel.reqHead = nextHead;
  Atomics.store(ctrl, CTRL_REQ_HEAD, nextHead);
  Atomics.notify(ctrl, CTRL_REQ_HEAD, 1);
}

/**
 * Host-side non-blocking response drain. Reads every completed `(lease, outCount)` entry from
 * `resRing` and invokes `onResponse` (expected to be a pre-bound callback). Never allocates.
 */
export function drainSabResponses(
  channel: SabChannel,
  onResponse: (lease: number, outCount: number) => void,
): number {
  const ctrl = channel.ctrl;
  const resHead = Atomics.load(ctrl, CTRL_RES_HEAD);
  let resTail = channel.resTail;
  if (resTail === resHead) return 0;

  let drained = 0;
  while (resTail !== resHead) {
    const entryBase = CTRL_RES_RING_BASE + ((resTail & SAB_RING_MASK) << 1);
    const lease = ctrl[entryBase]!;
    const outCount = ctrl[entryBase + 1]!;
    resTail = (resTail + 1) | 0;
    channel.resTail = resTail;
    drained += 1;
    onResponse(lease, outCount);
    if (Atomics.load(ctrl, CTRL_SHUTDOWN) !== 0) break;
  }
  Atomics.store(ctrl, CTRL_RES_TAIL, resTail);
  return drained;
}

/** Host-side non-blocking shutdown signal waking the worker before termination. */
export function signalSabShutdown(channel: SabChannel): void {
  Atomics.store(channel.ctrl, CTRL_SHUTDOWN, 1);
  Atomics.notify(channel.ctrl, CTRL_REQ_HEAD, 1);
}

/** Worker-side one-time attachment binding persistent typed-array views onto the shared buffers. */
export function attachSabWorkerState(
  controlSab: SharedArrayBuffer,
  dataSab: SharedArrayBuffer,
): SabWorkerState {
  if (controlSab.byteLength < SAB_CONTROL_BYTE_LENGTH) {
    throw new RangeError("Control SharedArrayBuffer is smaller than SAB_CONTROL_BYTE_LENGTH");
  }
  const ctrl = new Int32Array(controlSab);
  const ctrlF64 = new Float64Array(controlSab);
  if (ctrl[CTRL_HEADER_MAGIC] !== CTRL_MAGIC) {
    throw new RangeError("Invalid control SharedArrayBuffer magic header");
  }
  if (ctrl[CTRL_HEADER_VERSION] !== CTRL_VERSION) {
    throw new RangeError("Unsupported control SharedArrayBuffer protocol version");
  }

  const poolPairs = ctrl[CTRL_HEADER_POOL_PAIRS]!;
  const transitCapacitySamples = ctrl[CTRL_HEADER_CAPACITY_SAMPLES]!;
  const slotByteStride = ctrl[CTRL_HEADER_SLOT_STRIDE]!;
  const yOffset = ctrl[CTRL_HEADER_Y_OFFSET]!;
  const outOffset = ctrl[CTRL_HEADER_OUT_OFFSET]!;
  const indicesOffset = ctrl[CTRL_HEADER_INDICES_OFFSET]!;

  if (poolPairs < 1 || poolPairs > 8) {
    throw new RangeError("Invalid poolPairs in control SharedArrayBuffer header");
  }
  if (dataSab.byteLength < poolPairs * slotByteStride) {
    throw new RangeError("Data SharedArrayBuffer is smaller than required by header stride");
  }

  const slotViews = bindDataSabSlotViews(
    dataSab,
    poolPairs,
    transitCapacitySamples,
    slotByteStride,
    yOffset,
    outOffset,
    indicesOffset,
  );

  return {
    poolPairs,
    transitCapacitySamples,
    ctrl,
    ctrlF64,
    slotViews,
    reqTail: Atomics.load(ctrl, CTRL_REQ_TAIL),
    resHead: Atomics.load(ctrl, CTRL_RES_HEAD),
  };
}

/**
 * Worker-side non-blocking request drain. Executes every currently queued decimation request in
 * place on the persistent SAB slot views and publishes `(lease, outCount)` into `resRing`.
 */
export function drainSabRequests(state: SabWorkerState): number {
  const ctrl = state.ctrl;
  const reqHead = Atomics.load(ctrl, CTRL_REQ_HEAD);
  let reqTail = state.reqTail;
  if (reqTail === reqHead) return 0;

  let resHead = state.resHead;
  let processed = 0;

  while (reqTail !== reqHead) {
    const lease = ctrl[CTRL_REQ_RING_BASE + (reqTail & SAB_RING_MASK)]!;
    const slot = unpackSlot(lease);
    const i32Base = CTRL_SLOT_PARAMS_I32_BASE + (slot << 2);
    const kind = ctrl[i32Base] as DecimationKind;
    const sampleCount = ctrl[i32Base + 1]!;
    const bucketCount = ctrl[i32Base + 2]!;
    const views = state.slotViews[slot];

    let outCount = SAB_ERROR_OUT_COUNT;
    if (views !== undefined) {
      try {
        if (kind === DecimationKind.MinMaxEnvelope) {
          outCount = minMaxEnvelope(views.y, 0, sampleCount, views.out, 0, bucketCount);
        } else if (kind === DecimationKind.Lttb) {
          outCount = lttb(views.x, views.y, 0, sampleCount, views.indices, 0, bucketCount);
        } else if (kind === DecimationKind.MinMaxEnvelopeIndices) {
          outCount = minMaxEnvelopeIndices(
            views.y,
            0,
            sampleCount,
            views.indices,
            0,
            bucketCount,
          );
        } else {
          outCount = SAB_ERROR_OUT_COUNT;
        }
      } catch {
        outCount = SAB_ERROR_OUT_COUNT;
        Atomics.store(ctrl, CTRL_WORKER_STATUS, SAB_WORKER_STATUS_ERROR);
      }
    }

    const resBase = CTRL_RES_RING_BASE + ((resHead & SAB_RING_MASK) << 1);
    ctrl[resBase] = lease;
    ctrl[resBase + 1] = outCount;

    reqTail = (reqTail + 1) | 0;
    resHead = (resHead + 1) | 0;
    state.reqTail = reqTail;
    state.resHead = resHead;
    Atomics.store(ctrl, CTRL_REQ_TAIL, reqTail);
    Atomics.store(ctrl, CTRL_RES_HEAD, resHead);
    processed += 1;

    if (Atomics.load(ctrl, CTRL_SHUTDOWN) !== 0) break;
  }

  return processed;
}

/**
 * Worker-side bounded blocking loop. Only ever executed inside a dedicated worker thread.
 * Uses `SAB_WAIT_TIMEOUT_MS` (50 ms) and double-checks `CTRL_SHUTDOWN` so teardown never hangs.
 */
export function runSabWorkerLoop(state: SabWorkerState): void {
  const ctrl = state.ctrl;
  Atomics.store(ctrl, CTRL_WORKER_STATUS, SAB_WORKER_STATUS_RUNNING);
  while (Atomics.load(ctrl, CTRL_SHUTDOWN) === 0) {
    if (drainSabRequests(state) > 0) continue;
    const observedHead = Atomics.load(ctrl, CTRL_REQ_HEAD);
    if (observedHead !== state.reqTail) continue;
    if (Atomics.load(ctrl, CTRL_SHUTDOWN) !== 0) break;
    Atomics.wait(ctrl, CTRL_REQ_HEAD, observedHead, SAB_WAIT_TIMEOUT_MS);
  }
  Atomics.store(ctrl, CTRL_WORKER_STATUS, SAB_WORKER_STATUS_STOPPED);
}
