import { describe, expect, it } from "vitest";
import { asIndexBuffer, asXBuffer, asYBuffer } from "../../src/buffers/brand.js";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
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
  FailureReason,
  PortMode,
  type SettlementSink,
} from "../../src/transport/decimation-port.js";
import { type Lease, SATURATED } from "../../src/transport/ownership.js";
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
  throw new Error("Timed out waiting for browser SharedArrayBuffer worker settlement");
}

describe("browser worker transport — Shared backing (COOP/COEP-isolated Chromium)", () => {
  it("runs in a cross-origin-isolated Chromium realm and auto-selects BufferBacking.Shared", () => {
    expect(globalThis.crossOriginIsolated).toBe(true);
    const caps = detectTransportCapabilities();
    expect(caps.sharedMemory).toBe(true);
    expect(caps.workerConstructor).toBe(true);
    expect(caps.crossOriginIsolated).toBe(true);
    expect(selectBufferBacking(caps)).toBe(BufferBacking.Shared);
  });

  it("executes bit-exact real Chromium SharedArrayBuffer + Atomics SPSC round trips across all 3 DecimationKinds with 0 view re-mints", async () => {
    const sampleCount = 4_096;
    const bucketCount = 128;
    const port = createWorkerDecimationPort({
      workerFactory: () =>
        new Worker(new URL("./fixtures/decimation.worker.ts", import.meta.url), {
          type: "module",
        }),
      poolPairs: 1,
      transitCapacitySamples: sampleCount,
    });

    const stats = createTransportStatsView();
    try {
      expect(port.mode).toBe(PortMode.Asynchronous);

      const refX = asXBuffer(new Float32Array(sampleCount));
      const refY = asYBuffer(new Float32Array(sampleCount));
      fillDeterministicSignal(refX, refY, sampleCount);

      let firstXView: Float32Array | null = null;
      let firstYView: Float32Array | null = null;
      let firstOutView: Float32Array | null = null;
      let firstIndicesView: Int32Array | null = null;

      // 1) MinMaxEnvelope
      {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        firstXView = port.viewX(lease);
        firstYView = port.viewY(lease);
        firstOutView = port.viewOut(lease);
        firstIndicesView = port.viewIndices(lease);
        expect(firstXView.buffer instanceof SharedArrayBuffer).toBe(true);
        expect(firstYView.buffer instanceof SharedArrayBuffer).toBe(true);
        expect(firstOutView.buffer instanceof SharedArrayBuffer).toBe(true);
        expect(firstIndicesView.buffer instanceof SharedArrayBuffer).toBe(true);

        firstXView.set(refX);
        firstYView.set(refY);
        port.setKind(lease, DecimationKind.MinMaxEnvelope);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, sampleCount - 1);
        port.submit(lease);

        const { lease: settled, outCount } = await waitForSettlement(port);
        const expectedOut = asYBuffer(new Float32Array(bucketCount * 2));
        const expectedCount = minMaxEnvelope(refY, 0, sampleCount, expectedOut, 0, bucketCount);
        expect(outCount).toBe(expectedCount);

        const settledOut = port.viewOut(settled);
        expect(settledOut).toBe(firstOutView);
        expect(port.viewX(settled)).toBe(firstXView);
        expect(port.viewY(settled)).toBe(firstYView);
        expect(port.viewIndices(settled)).toBe(firstIndicesView);
        for (let i = 0; i < expectedCount; i += 1) {
          expect(settledOut[i]).toBe(expectedOut[i]);
        }
        port.release(settled);
      }

      // 2) MinMaxEnvelopeIndices — exact same view object identities (0 re-mints)
      {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        expect(port.viewX(lease)).toBe(firstXView);
        expect(port.viewY(lease)).toBe(firstYView);
        expect(port.viewOut(lease)).toBe(firstOutView);
        expect(port.viewIndices(lease)).toBe(firstIndicesView);

        port.viewX(lease).set(refX);
        port.viewY(lease).set(refY);
        port.setKind(lease, DecimationKind.MinMaxEnvelopeIndices);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, sampleCount - 1);
        port.submit(lease);

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

        const settledIndices = port.viewIndices(settled);
        expect(settledIndices).toBe(firstIndicesView);
        for (let i = 0; i < expectedCount; i += 1) {
          expect(settledIndices[i]).toBe(expectedIndices[i]);
        }
        port.release(settled);
      }

      // 3) Lttb — exact same view object identities (0 re-mints)
      {
        const lease = port.acquire();
        expect(lease).not.toBe(SATURATED);
        if (lease === SATURATED) return;

        expect(port.viewX(lease)).toBe(firstXView);
        expect(port.viewY(lease)).toBe(firstYView);
        expect(port.viewOut(lease)).toBe(firstOutView);
        expect(port.viewIndices(lease)).toBe(firstIndicesView);

        port.viewX(lease).set(refX);
        port.viewY(lease).set(refY);
        port.setKind(lease, DecimationKind.Lttb);
        port.setSampleCount(lease, sampleCount);
        port.setBucketCount(lease, bucketCount);
        port.setDomain(lease, 0, sampleCount - 1);
        port.submit(lease);

        const { lease: settled, outCount } = await waitForSettlement(port);
        const expectedIndices = asIndexBuffer(new Int32Array(bucketCount));
        const expectedCount = lttb(refX, refY, 0, sampleCount, expectedIndices, 0, bucketCount);
        expect(outCount).toBe(expectedCount);

        const settledIndices = port.viewIndices(settled);
        expect(settledIndices).toBe(firstIndicesView);
        for (let i = 0; i < expectedCount; i += 1) {
          expect(settledIndices[i]).toBe(expectedIndices[i]);
        }
        port.release(settled);
      }

      port.readStats(stats);
      expect(stats.counters[StatCounter.ChunksAccepted]).toBe(3);
      expect(stats.counters[StatCounter.RemintEvents]).toBe(0);
    } finally {
      port.dispose();
    }
  });

  it("recovers from failure with a fresh SharedArrayBuffer re-mint and terminates cleanly without hanging on dispose()", async () => {
    const sampleCount = 512;
    const bucketCount = 32;
    let spawnCount = 0;

    const port = createWorkerDecimationPort({
      workerFactory: () => {
        spawnCount += 1;
        return new Worker(new URL("./fixtures/decimation.worker.ts", import.meta.url), {
          type: "module",
        });
      },
      poolPairs: 1,
      transitCapacitySamples: sampleCount,
      maxRemintEvents: 4,
    });

    const stats = createTransportStatsView();
    try {
      expect(spawnCount).toBe(1);

      const lease1 = port.acquire();
      expect(lease1).not.toBe(SATURATED);
      if (lease1 === SATURATED) return;

      const sabBefore = port.viewX(lease1).buffer;
      expect(sabBefore instanceof SharedArrayBuffer).toBe(true);
      fillDeterministicSignal(port.viewX(lease1), port.viewY(lease1), sampleCount);
      port.setKind(lease1, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease1, sampleCount);
      port.setBucketCount(lease1, bucketCount);
      port.setDomain(lease1, 0, sampleCount - 1);
      port.submit(lease1);

      // Simulate responder failure while a slot is InFlight; triggers fresh SAB pair allocation.
      port.reportResponderFailure(FailureReason.WorkerError);
      port.readStats(stats);
      expect(stats.counters[StatCounter.ResponderFailures]).toBe(1);
      expect(stats.counters[StatCounter.RemintEvents]).toBe(1);
      expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Ready);

      // Next acquire/submit spawns worker #2 bound to a brand-new SharedArrayBuffer.
      const lease2 = port.acquire();
      expect(lease2).not.toBe(SATURATED);
      if (lease2 === SATURATED) return;

      const sabAfter = port.viewX(lease2).buffer;
      expect(sabAfter instanceof SharedArrayBuffer).toBe(true);
      expect(sabAfter).not.toBe(sabBefore);

      const refX = asXBuffer(new Float32Array(sampleCount));
      const refY = asYBuffer(new Float32Array(sampleCount));
      fillDeterministicSignal(refX, refY, sampleCount, 7);
      port.viewX(lease2).set(refX);
      port.viewY(lease2).set(refY);
      port.setKind(lease2, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease2, sampleCount);
      port.setBucketCount(lease2, bucketCount);
      port.setDomain(lease2, 7, 7 + sampleCount - 1);
      port.submit(lease2);

      const { lease: settled, outCount } = await waitForSettlement(port);
      expect(spawnCount).toBe(2);
      const expectedOut = asYBuffer(new Float32Array(bucketCount * 2));
      const expectedCount = minMaxEnvelope(refY, 0, sampleCount, expectedOut, 0, bucketCount);
      expect(outCount).toBe(expectedCount);
      const actualOut = port.viewOut(settled);
      for (let i = 0; i < expectedCount; i += 1) {
        expect(actualOut[i]).toBe(expectedOut[i]);
      }
      port.release(settled);
    } finally {
      // Allow worker to enter Atomics.wait briefly, then verify dispose() never hangs.
      await new Promise((resolve) => setTimeout(resolve, 15));
      const disposeStart = performance.now();
      port.dispose();
      port.dispose();
      expect(performance.now() - disposeStart).toBeLessThan(1_000);
    }
  });
});
