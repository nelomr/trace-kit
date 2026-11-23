import { describe, expect, it, vi } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import { DecimationKind } from "../../src/transport/decimation-port.js";
import { packLease } from "../../src/transport/ownership.js";
import {
  CTRL_HEADER_CAPACITY_SAMPLES,
  CTRL_HEADER_INDICES_OFFSET,
  CTRL_HEADER_MAGIC,
  CTRL_HEADER_OUT_OFFSET,
  CTRL_HEADER_POOL_PAIRS,
  CTRL_HEADER_SLOT_STRIDE,
  CTRL_HEADER_VERSION,
  CTRL_HEADER_Y_OFFSET,
  CTRL_MAGIC,
  CTRL_REQ_HEAD,
  CTRL_REQ_RING_BASE,
  CTRL_REQ_TAIL,
  CTRL_RES_HEAD,
  CTRL_RES_RING_BASE,
  CTRL_RES_TAIL,
  CTRL_SHUTDOWN,
  CTRL_SLOT_PARAMS_F64_BASE,
  CTRL_SLOT_PARAMS_I32_BASE,
  CTRL_VERSION,
  CTRL_WORKER_STATUS,
  SAB_CONTROL_BYTE_LENGTH,
  SAB_ERROR_OUT_COUNT,
  SAB_RING_CAPACITY,
  SAB_WAIT_TIMEOUT_MS,
  attachSabWorkerState,
  createSabChannel,
  drainSabRequests,
  drainSabResponses,
  enqueueSabJob,
  signalSabShutdown,
} from "../../src/transport/sab-channel.js";
import { MAX_BUCKETS } from "../../src/transport/streaming-contract.js";

function fillLorentzian(x: Float32Array, y: Float32Array, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    x[i] = t * 100;
    const dx = t - 0.42;
    y[i] = 1 / (1 + dx * dx * 400) + 0.05 * Math.sin(i * 0.13);
  }
}

describe("sab-channel — 704-byte control SAB and 64-byte-aligned data SAB layout", () => {
  it("enforces exact 704-byte cache-line-separated control layout and header fields", () => {
    expect(SAB_CONTROL_BYTE_LENGTH).toBe(704);
    expect(CTRL_MAGIC).toBe(0x544b_5342);
    expect(CTRL_VERSION).toBe(1);
    expect(SAB_RING_CAPACITY).toBe(16);
    expect(SAB_ERROR_OUT_COUNT).toBe(-1);
    expect(SAB_WAIT_TIMEOUT_MS).toBe(50);

    // Cache-line separation (64 bytes = 16 Int32 words per line)
    expect(CTRL_REQ_HEAD * 4).toBe(64);
    expect(CTRL_SHUTDOWN * 4).toBe(68);
    expect(CTRL_REQ_TAIL * 4).toBe(128);
    expect(CTRL_RES_HEAD * 4).toBe(132);
    expect(CTRL_WORKER_STATUS * 4).toBe(136);
    expect(CTRL_RES_TAIL * 4).toBe(192);

    // Ring buffers and parameter tables
    expect(CTRL_REQ_RING_BASE * 4).toBe(256);
    expect(CTRL_RES_RING_BASE * 4).toBe(320);
    expect(CTRL_SLOT_PARAMS_I32_BASE * 4).toBe(448);
    expect(CTRL_SLOT_PARAMS_F64_BASE * 8).toBe(576);
    expect((CTRL_SLOT_PARAMS_F64_BASE * 8) % 8).toBe(0);
    expect(CTRL_SLOT_PARAMS_F64_BASE * 8 + 8 * 2 * 8).toBe(704);

    const channel = createSabChannel(3, 1_024);
    expect(channel.controlSab).toBeInstanceOf(SharedArrayBuffer);
    expect(channel.dataSab).toBeInstanceOf(SharedArrayBuffer);
    expect(channel.controlSab.byteLength).toBe(704);

    expect(channel.ctrl[CTRL_HEADER_MAGIC]).toBe(CTRL_MAGIC);
    expect(channel.ctrl[CTRL_HEADER_VERSION]).toBe(CTRL_VERSION);
    expect(channel.ctrl[CTRL_HEADER_POOL_PAIRS]).toBe(3);
    expect(channel.ctrl[CTRL_HEADER_CAPACITY_SAMPLES]).toBe(1_024);
  });

  it("allocates a single 64-byte-aligned contiguous data SAB for all slot views", () => {
    // Non-multiple-of-64 sample count (100 samples = 400 bytes -> aligned to 448 bytes)
    const channel = createSabChannel(4, 100);
    const slotStride = channel.ctrl[CTRL_HEADER_SLOT_STRIDE]!;
    const yOffset = channel.ctrl[CTRL_HEADER_Y_OFFSET]!;
    const outOffset = channel.ctrl[CTRL_HEADER_OUT_OFFSET]!;
    const indicesOffset = channel.ctrl[CTRL_HEADER_INDICES_OFFSET]!;

    expect(slotStride % 64).toBe(0);
    expect(yOffset % 64).toBe(0);
    expect(outOffset % 64).toBe(0);
    expect(indicesOffset % 64).toBe(0);
    expect(channel.dataSab.byteLength).toBe(4 * slotStride);

    expect(channel.slotViews.length).toBe(4);
    for (let s = 0; s < 4; s += 1) {
      const v = channel.slotViews[s]!;
      const base = s * slotStride;
      expect(v.x.buffer).toBe(channel.dataSab);
      expect(v.y.buffer).toBe(channel.dataSab);
      expect(v.out.buffer).toBe(channel.dataSab);
      expect(v.indices.buffer).toBe(channel.dataSab);

      expect(v.x.byteOffset).toBe(base);
      expect(v.y.byteOffset).toBe(base + yOffset);
      expect(v.out.byteOffset).toBe(base + outOffset);
      expect(v.indices.byteOffset).toBe(base + indicesOffset);

      expect(v.x.length).toBe(100);
      expect(v.y.length).toBe(100);
      expect(v.out.length).toBe(MAX_BUCKETS * 2);
      expect(v.indices.length).toBe(MAX_BUCKETS * 2);
    }
  });

  it("rejects corrupted magic or version when attaching worker state", () => {
    const channel = createSabChannel(2, 64);
    channel.ctrl[CTRL_HEADER_MAGIC] = 0x1234_5678;
    expect(() => attachSabWorkerState(channel.controlSab, channel.dataSab)).toThrow();

    const channel2 = createSabChannel(2, 64);
    channel2.ctrl[CTRL_HEADER_VERSION] = 99;
    expect(() => attachSabWorkerState(channel2.controlSab, channel2.dataSab)).toThrow();
  });
});

describe("sab-channel — SPSC execution, wraparound, error sentinel, and zero host Atomics.wait", () => {
  it("processes all three DecimationKind values bit-for-bit via enqueue/drainRequests/drainResponses", () => {
    const sampleCount = 512;
    const bucketCount = 32;
    const channel = createSabChannel(3, sampleCount);
    const workerState = attachSabWorkerState(channel.controlSab, channel.dataSab);

    const refX = new Float32Array(sampleCount);
    const refY = new Float32Array(sampleCount);
    fillLorentzian(refX, refY, sampleCount);

    const refMinMax = new Float32Array(MAX_BUCKETS * 2);
    const refMinMaxCount = minMaxEnvelope(refY, 0, sampleCount, refMinMax, 0, bucketCount);
    const refLttb = new Int32Array(MAX_BUCKETS * 2);
    const refLttbCount = lttb(refX, refY, 0, sampleCount, refLttb, 0, bucketCount);
    const refEnvIdx = new Int32Array(MAX_BUCKETS * 2);
    const refEnvIdxCount = minMaxEnvelopeIndices(
      refY,
      0,
      sampleCount,
      refEnvIdx,
      0,
      bucketCount,
    );

    // Populate all 3 slots
    for (let s = 0; s < 3; s += 1) {
      channel.slotViews[s]!.x.set(refX);
      channel.slotViews[s]!.y.set(refY);
    }

    const lease0 = packLease<"inflight">(0, 1);
    const lease1 = packLease<"inflight">(1, 2);
    const lease2 = packLease<"inflight">(2, 3);

    enqueueSabJob(channel, 0, lease0, DecimationKind.MinMaxEnvelope, sampleCount, bucketCount, 0, 100);
    enqueueSabJob(channel, 1, lease1, DecimationKind.Lttb, sampleCount, bucketCount, 0, 100);
    enqueueSabJob(
      channel,
      2,
      lease2,
      DecimationKind.MinMaxEnvelopeIndices,
      sampleCount,
      bucketCount,
      0,
      100,
    );

    // Verify slotParamsF64 wrote domainMin/domainMax at 8-byte-aligned offset
    expect(channel.ctrlF64[CTRL_SLOT_PARAMS_F64_BASE]).toBe(0);
    expect(channel.ctrlF64[CTRL_SLOT_PARAMS_F64_BASE + 1]).toBe(100);

    const processed = drainSabRequests(workerState);
    expect(processed).toBe(3);

    const results: Array<{ lease: number; outCount: number }> = [];
    const drained = drainSabResponses(channel, (lease, outCount) => {
      results.push({ lease, outCount });
    });
    expect(drained).toBe(3);
    expect(results).toEqual([
      { lease: lease0, outCount: refMinMaxCount },
      { lease: lease1, outCount: refLttbCount },
      { lease: lease2, outCount: refEnvIdxCount },
    ]);

    expect(Array.from(channel.slotViews[0]!.out.subarray(0, refMinMaxCount))).toEqual(
      Array.from(refMinMax.subarray(0, refMinMaxCount)),
    );
    expect(Array.from(channel.slotViews[1]!.indices.subarray(0, refLttbCount))).toEqual(
      Array.from(refLttb.subarray(0, refLttbCount)),
    );
    expect(Array.from(channel.slotViews[2]!.indices.subarray(0, refEnvIdxCount))).toEqual(
      Array.from(refEnvIdx.subarray(0, refEnvIdxCount)),
    );
  });

  it("handles 16-entry reqRing and resRing wraparound cleanly across 64 consecutive jobs", () => {
    const channel = createSabChannel(2, 32);
    const workerState = attachSabWorkerState(channel.controlSab, channel.dataSab);
    for (let s = 0; s < 2; s += 1) {
      fillLorentzian(channel.slotViews[s]!.x, channel.slotViews[s]!.y, 32);
    }

    let settled = 0;
    for (let i = 0; i < 64; i += 1) {
      const slot = i & 1;
      const lease = packLease<"inflight">(slot, i + 1);
      enqueueSabJob(channel, slot, lease, DecimationKind.MinMaxEnvelope, 32, 4, 0, 100);
      expect(drainSabRequests(workerState)).toBe(1);
      const count = drainSabResponses(channel, (resLease, outCount) => {
        expect(resLease).toBe(lease);
        expect(outCount).toBe(8);
        settled += 1;
      });
      expect(count).toBe(1);
    }
    expect(settled).toBe(64);
    expect(Atomics.load(channel.ctrl, CTRL_REQ_HEAD)).toBe(64);
    expect(Atomics.load(channel.ctrl, CTRL_REQ_TAIL)).toBe(64);
    expect(Atomics.load(channel.ctrl, CTRL_RES_HEAD)).toBe(64);
    expect(Atomics.load(channel.ctrl, CTRL_RES_TAIL)).toBe(64);
  });

  it("signals kernel errors via outCount === SAB_ERROR_OUT_COUNT (-1)", () => {
    const channel = createSabChannel(1, 32);
    const workerState = attachSabWorkerState(channel.controlSab, channel.dataSab);

    // Invalid negative sampleCount triggers kernel RangeError
    const lease = packLease<"inflight">(0, 1);
    enqueueSabJob(channel, 0, lease, DecimationKind.MinMaxEnvelope, -5, 4, 0, 100);
    expect(drainSabRequests(workerState)).toBe(1);

    const results: Array<{ lease: number; outCount: number }> = [];
    drainSabResponses(channel, (resLease, outCount) => {
      results.push({ lease: resLease, outCount });
    });
    expect(results).toEqual([{ lease, outCount: SAB_ERROR_OUT_COUNT }]);
  });

  it("sets CTRL_SHUTDOWN = 1 via signalSabShutdown and never invokes Atomics.wait on host paths", () => {
    const waitSpy = vi.spyOn(Atomics, "wait");
    try {
      const channel = createSabChannel(2, 64);
      const workerState = attachSabWorkerState(channel.controlSab, channel.dataSab);
      fillLorentzian(channel.slotViews[0]!.x, channel.slotViews[0]!.y, 64);

      const lease = packLease<"inflight">(0, 1);
      enqueueSabJob(channel, 0, lease, DecimationKind.MinMaxEnvelope, 64, 8, 0, 100);
      drainSabRequests(workerState);
      drainSabResponses(channel, () => {});
      signalSabShutdown(channel);

      expect(Atomics.load(channel.ctrl, CTRL_SHUTDOWN)).toBe(1);
      expect(waitSpy).toHaveBeenCalledTimes(0);
    } finally {
      waitSpy.mockRestore();
    }
  });
});
