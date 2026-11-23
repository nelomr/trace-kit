import { describe, expect, it } from "vitest";
import { asIndexBuffer, asXBuffer, asYBuffer } from "../../src/buffers/brand.js";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
} from "../../src/payload/spectrum-data-payload.js";
import {
  StatCounter,
  TransportHealth,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";
import {
  BufferBacking,
  detectTransportCapabilities,
  selectBufferBacking,
} from "../../src/transport/capabilities.js";
import {
  DecimationKind,
  type DecimationPort,
  PortMode,
  type SettlementSink,
} from "../../src/transport/decimation-port.js";
import { materializeBucketsToPayload } from "../../src/transport/materialize.js";
import { type Lease, SATURATED } from "../../src/transport/ownership.js";
import {
  createBucketAccumulator,
  createRawSampleRing,
  ingestBatch,
  rebuildDomain,
} from "../../src/transport/streaming-contract.js";
import { createWorkerDecimationPort } from "../../src/transport/worker-port.js";

function fillDeterministicSignal(x: Float32Array, y: Float32Array, count: number, phase = 0): void {
  const halfWidthSq = 400;
  for (let i = 0; i < count; i += 1) {
    const xv = i + phase;
    const dx = (i % 512) - 256;
    x[i] = xv;
    y[i] = halfWidthSq / (dx * dx + halfWidthSq) + ((i * 17) % 13) * 0.004;
  }
}

async function waitForSettlement(
  port: DecimationPort,
  timeoutMs = 5_000,
): Promise<{ lease: Lease<"settled">; outCount: number }> {
  let settledLease: Lease<"settled"> | null = null;
  let settledCount = -1;
  const sink: SettlementSink = {
    onSettled(lease, outCount) {
      settledLease = lease;
      settledCount = outCount;
    },
  };
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (port.poll(sink) > 0 && settledLease !== null) {
      return { lease: settledLease, outCount: settledCount };
    }
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  throw new Error("Timed out waiting for browser worker settlement");
}

describe("browser worker transport — Transfer backing (non-isolated Chromium)", () => {
  it("runs in a non-isolated browser realm and auto-selects BufferBacking.Transfer", () => {
    expect(globalThis.crossOriginIsolated).toBe(false);
    const caps = detectTransportCapabilities();
    expect(caps.workerConstructor).toBe(true);
    expect(caps.crossOriginIsolated).toBe(false);
    expect(selectBufferBacking(caps)).toBe(BufferBacking.Transfer);
  });

  it("executes bit-exact real Web Worker Transfer round trips across all 3 DecimationKinds with genuine buffer detachment", async () => {
    const sampleCount = 4_096;
    const bucketCount = 128;
    const port = createWorkerDecimationPort({
      workerFactory: () =>
        new Worker(new URL("./fixtures/decimation.worker.ts", import.meta.url), {
          type: "module",
        }),
      poolPairs: 2,
      transitCapacitySamples: sampleCount,
    });

    try {
      expect(port.mode).toBe(PortMode.Asynchronous);

      const refX = asXBuffer(new Float32Array(sampleCount));
      const refY = asYBuffer(new Float32Array(sampleCount));
      fillDeterministicSignal(refX, refY, sampleCount);

      // 1) MinMaxEnvelope — transfers [x, y, out], preserves viewIndices
      {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        const preX = port.viewX(lease);
        const preY = port.viewY(lease);
        const preOut = port.viewOut(lease);
        const preIndices = port.viewIndices(lease);
        expect(preX.buffer instanceof ArrayBuffer).toBe(true);
        preX.set(refX);
        preY.set(refY);

        port.setKind(lease, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, sampleCount - 1);
        port.submit(lease);

        // Genuine zero-copy transfer detaches only [x, y, out].
        expect(preX.byteLength).toBe(0);
        expect(preY.byteLength).toBe(0);
        expect(preOut.byteLength).toBe(0);
        expect(preIndices.byteLength).toBeGreaterThan(0);

        const { lease: settled, outCount } = await waitForSettlement(port);
        const expectedOut = asYBuffer(new Float32Array(bucketCount * 2));
        const expectedCount = minMaxEnvelope(refY, 0, sampleCount, expectedOut, 0, bucketCount);
        expect(outCount).toBe(expectedCount);

        const actualOut = port.viewOut(settled);
        expect(actualOut.byteLength).toBeGreaterThan(0);
        expect(port.viewIndices(settled)).toBe(preIndices);
        for (let i = 0; i < expectedCount; i += 1) {
          expect(actualOut[i]).toBe(expectedOut[i]);
        }
        port.release(settled);
      }

      // 2) MinMaxEnvelopeIndices — transfers [x, y, indices], preserves viewOut
      {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        const preX = port.viewX(lease);
        const preY = port.viewY(lease);
        const preOut = port.viewOut(lease);
        const preIndices = port.viewIndices(lease);
        preX.set(refX);
        preY.set(refY);

        port.setKind(lease, DecimationKind.MinMaxEnvelopeIndices);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, sampleCount - 1);
        port.submit(lease);

        expect(preX.byteLength).toBe(0);
        expect(preY.byteLength).toBe(0);
        expect(preOut.byteLength).toBeGreaterThan(0);
        expect(preIndices.byteLength).toBe(0);

        const { lease: settled, outCount } = await waitForSettlement(port);
        const expectedIndices = asIndexBuffer(new Int32Array(bucketCount * 2));
        const expectedCount = minMaxEnvelopeIndices(
          refY,
          0,
          sampleCount,
          expectedIndices,
          0,
          bucketCount,
        );
        expect(outCount).toBe(expectedCount);

        const actualIndices = port.viewIndices(settled);
        expect(port.viewOut(settled)).toBe(preOut);
        for (let i = 0; i < expectedCount; i += 1) {
          expect(actualIndices[i]).toBe(expectedIndices[i]);
        }
        port.release(settled);
      }

      // 3) Lttb — transfers all 4 [x, y, out, indices]
      {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        const preX = port.viewX(lease);
        const preY = port.viewY(lease);
        const preOut = port.viewOut(lease);
        const preIndices = port.viewIndices(lease);
        preX.set(refX);
        preY.set(refY);

        port.setKind(lease, DecimationKind.Lttb);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, sampleCount - 1);
        port.submit(lease);

        expect(preX.byteLength).toBe(0);
        expect(preY.byteLength).toBe(0);
        expect(preOut.byteLength).toBe(0);
        expect(preIndices.byteLength).toBe(0);

        const { lease: settled, outCount } = await waitForSettlement(port);
        const expectedIndices = asIndexBuffer(new Int32Array(bucketCount));
        const expectedCount = lttb(refX, refY, 0, sampleCount, expectedIndices, 0, bucketCount);
        expect(outCount).toBe(expectedCount);

        const actualIndices = port.viewIndices(settled);
        for (let i = 0; i < expectedCount; i += 1) {
          expect(actualIndices[i]).toBe(expectedIndices[i]);
        }
        port.release(settled);
      }
    } finally {
      port.dispose();
      // Idempotent second dispose changes nothing.
      port.dispose();
    }
  });

  it("recovers from a real Chromium worker crash, re-mints lost slots, and respawns cleanly", async () => {
    const workers: Worker[] = [];
    const port = createWorkerDecimationPort({
      workerFactory: () => {
        const w = new Worker(
          new URL("./fixtures/crashable-decimation.worker.ts", import.meta.url),
          { type: "module" },
        );
        workers.push(w);
        return w;
      },
      poolPairs: 2,
      transitCapacitySamples: 512,
      maxRemintEvents: 4,
    });

    const stats = createTransportStatsView();
    try {
      expect(workers).toHaveLength(1);

      const lease1 = port.acquire();
      expect(lease1).not.toBe(SATURATED);
      if (lease1 === SATURATED) return;
      fillDeterministicSignal(port.viewX(lease1), port.viewY(lease1), 256);
      port.setKind(lease1, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease1, 256);
      port.setBucketCount(lease1, 32);
      port.setDomain(lease1, 0, 255);
      // Trigger crash before posting work so the worker crashes while a slot is InFlight.
      port.submit(lease1);
      workers[0]!.postMessage({ type: "__test_crash__" });

      const deadline = performance.now() + 5_000;
      while (performance.now() < deadline) {
        port.readStats(stats);
        if ((stats.counters[StatCounter.ResponderFailures] ?? 0) >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      port.readStats(stats);
      expect(stats.counters[StatCounter.ResponderFailures]).toBeGreaterThanOrEqual(1);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Ready);

      // Next acquire/submit lazily respawns a second worker and settles bit-exactly.
      const lease2 = port.acquire();
      expect(lease2).not.toBe(SATURATED);
      if (lease2 === SATURATED) return;
      fillDeterministicSignal(port.viewX(lease2), port.viewY(lease2), 256, 10);
      port.setKind(lease2, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease2, 256);
      port.setBucketCount(lease2, 32);
      port.setDomain(lease2, 10, 265);
      port.submit(lease2);

      const { lease: settled, outCount } = await waitForSettlement(port);
      expect(workers.length).toBeGreaterThanOrEqual(2);
      expect(outCount).toBe(64);
      port.release(settled);
    } finally {
      port.dispose();
    }
  });

  it("preserves Retained SpectrumDataPayload integrity across 60 real Chromium round trips painted to a canvas", async () => {
    const batchSize = 128;
    const bucketCount = 128;
    const ring = createRawSampleRing(16_384);
    const acc = createBucketAccumulator(bucketCount);
    rebuildDomain(acc, ring, 0, bucketCount / 8_192);
    const payload = createSpectrumDataPayload({
      capacity: bucketCount * 2,
      xOrigin: 0,
      xUnit: "sample",
      yUnit: "a.u.",
    });
    const batchX = new Float32Array(batchSize);
    const batchY = new Float32Array(batchSize);

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    expect(ctx).not.toBeNull();

    const port = createWorkerDecimationPort({
      workerFactory: () =>
        new Worker(new URL("./fixtures/decimation.worker.ts", import.meta.url), {
          type: "module",
        }),
      poolPairs: 3,
      transitCapacitySamples: 512,
    });

    try {
      let prevRev = payload.revision;
      for (let round = 0; round < 60; round += 1) {
        fillDeterministicSignal(batchX, batchY, batchSize, round * batchSize);
        ingestBatch(ring, batchX, batchY, 0, batchSize, acc);

        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        port.viewX(lease).set(batchX);
        port.viewY(lease).set(batchY);
        port.setKind(lease, DecimationKind.MinMaxEnvelopeIndices);
        port.setSampleCount(lease, batchSize);
        port.setBucketCount(lease, 32);
        port.setDomain(lease, round * batchSize, (round + 1) * batchSize - 1);
        port.submit(lease);

        const { lease: settled, outCount } = await waitForSettlement(port);
        expect(outCount).toBe(64);
        port.release(settled);

        const written = materializeBucketsToPayload(acc, payload);
        expect(written).toBeGreaterThan(0);
        expect(payload.revision).toBeGreaterThan(prevRev);
        prevRev = payload.revision;

        // Retained payload buffers MUST remain plain, non-detached ArrayBuffers on every round.
        expect(payload.x.buffer instanceof ArrayBuffer).toBe(true);
        expect(payload.y.buffer instanceof ArrayBuffer).toBe(true);
        expect(payload.x.buffer.byteLength).toBeGreaterThan(0);
        expect(payload.y.buffer.byteLength).toBeGreaterThan(0);

        if (ctx !== null) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#3fb6ff";
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < payload.sampleCount; i += 1) {
            const yVal = payload.y[i]!;
            if (Number.isNaN(yVal)) {
              started = false;
              continue;
            }
            const px = (payload.x[i]! / 8_192) * canvas.width;
            const py = canvas.height - yVal * (canvas.height * 0.8);
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }
      }

      // Confirm direct revision commit also leaves Retained buffers intact.
      commitPayloadRevision(payload, payload.sampleCount);
      expect(payload.x.buffer.byteLength).toBeGreaterThan(0);
      expect(payload.y.buffer.byteLength).toBeGreaterThan(0);
    } finally {
      port.dispose();
      canvas.remove();
    }
  });
});
