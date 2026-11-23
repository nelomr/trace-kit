import { PerformanceObserver } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import { createNodeWorkerFactory } from "../../src/node/index.js";
import { StatCounter, createTransportStatsView } from "../../src/transport/backpressure.js";
import {
  DecimationKind,
  type DecimationPort,
  type SettlementSink,
} from "../../src/transport/decimation-port.js";
import { type Lease, SATURATED } from "../../src/transport/ownership.js";
import { MAX_BUCKETS } from "../../src/transport/streaming-contract.js";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import type { WorkerFactory, WorkerLike } from "../../src/transport/worker-channel.js";
import { createWorkerDecimationPort } from "../../src/transport/worker-port.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const workerScriptUrl = new URL(
  `file://${path.join(packageRoot, "test", "fixtures", "node-decimation-worker.mjs")}`,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fillLorentzian(x: Float32Array, y: Float32Array, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    x[i] = t * 100;
    const dx = t - 0.37;
    y[i] = i === Math.floor(count / 2) ? NaN : 1 / (1 + dx * dx * 300) + 0.02 * Math.sin(i * 0.17);
  }
}

async function withRealmIsolation<T>(
  isolated: boolean | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const g = globalThis as { crossOriginIsolated?: boolean };
  const hadCoi = "crossOriginIsolated" in g;
  const originalCoi = g.crossOriginIsolated;
  try {
    if (isolated === undefined) {
      delete g.crossOriginIsolated;
    } else {
      g.crossOriginIsolated = isolated;
    }
    return await fn();
  } finally {
    if (hadCoi) g.crossOriginIsolated = originalCoi;
    else delete g.crossOriginIsolated;
  }
}

async function pollUntilSettled(
  port: DecimationPort,
  onSettled: (lease: Lease<"settled">, outCount: number) => void,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  let done = false;
  const sink: SettlementSink = {
    onSettled(lease, outCount) {
      done = true;
      onSettled(lease, outCount);
    },
  };
  while (!done) {
    if (port.poll(sink) > 0) break;
    if (performance.now() > deadline) {
      throw new Error(`Timed out waiting for worker settlement after ${timeoutMs} ms`);
    }
    await sleep(2);
  }
}

describe("node:worker_threads — Transfer and Shared parity, crash recovery, and clean disposal", () => {
  it("executes MinMaxEnvelope, Lttb, and MinMaxEnvelopeIndices bit-for-bit in both Transfer and Shared backings", async () => {
    const sampleCount = 4_096;
    const bucketCount = 128;
    const refX = new Float32Array(sampleCount);
    const refY = new Float32Array(sampleCount);
    fillLorentzian(refX, refY, sampleCount);

    const syncPort = createSyncDecimationPort({
      poolPairs: 1,
      transitCapacitySamples: sampleCount,
    });

    function runSync(kind: DecimationKind): { outCount: number; data: number[] } {
      const lease = syncPort.acquire();
      if (lease === SATURATED) throw new Error("unexpected saturation");
      syncPort.viewX(lease).set(refX);
      syncPort.viewY(lease).set(refY);
      syncPort.setKind(lease, kind);
      syncPort.setSampleCount(lease, sampleCount);
      syncPort.setBucketCount(lease, bucketCount);
      syncPort.setDomain(lease, 0, 100);
      syncPort.submit(lease);
      let outCount = 0;
      let data: number[] = [];
      syncPort.poll({
        onSettled(settled, count) {
          outCount = count;
          data =
            kind === DecimationKind.MinMaxEnvelope
              ? Array.from(syncPort.viewOut(settled).subarray(0, count))
              : Array.from(syncPort.viewIndices(settled).subarray(0, count));
          syncPort.release(settled);
        },
      });
      return { outCount, data };
    }

    const expectedByKind = new Map<DecimationKind, { outCount: number; data: number[] }>([
      [DecimationKind.MinMaxEnvelope, runSync(DecimationKind.MinMaxEnvelope)],
      [DecimationKind.Lttb, runSync(DecimationKind.Lttb)],
      [DecimationKind.MinMaxEnvelopeIndices, runSync(DecimationKind.MinMaxEnvelopeIndices)],
    ]);
    syncPort.dispose();

    // Direct reference sanity check
    const directOut = new Float32Array(MAX_BUCKETS * 2);
    expect(minMaxEnvelope(refY, 0, sampleCount, directOut, 0, bucketCount)).toBe(
      expectedByKind.get(DecimationKind.MinMaxEnvelope)!.outCount,
    );
    const directLttb = new Int32Array(MAX_BUCKETS * 2);
    expect(lttb(refX, refY, 0, sampleCount, directLttb, 0, bucketCount)).toBe(
      expectedByKind.get(DecimationKind.Lttb)!.outCount,
    );
    const directIdx = new Int32Array(MAX_BUCKETS * 2);
    expect(minMaxEnvelopeIndices(refY, 0, sampleCount, directIdx, 0, bucketCount)).toBe(
      expectedByKind.get(DecimationKind.MinMaxEnvelopeIndices)!.outCount,
    );

    // Run both Transfer (crossOriginIsolated = false) and Shared (plain Node realm)
    for (const mode of [
      { label: "Transfer", isolated: false as boolean | undefined, expectSab: false },
      { label: "Shared", isolated: undefined as boolean | undefined, expectSab: true },
    ]) {
      await withRealmIsolation(mode.isolated, async () => {
        const port = createWorkerDecimationPort({
          poolPairs: 2,
          transitCapacitySamples: sampleCount,
          workerFactory: createNodeWorkerFactory(workerScriptUrl),
        });
        try {
          for (const kind of [
            DecimationKind.MinMaxEnvelope,
            DecimationKind.Lttb,
            DecimationKind.MinMaxEnvelopeIndices,
          ]) {
            const lease = port.acquire();
            if (lease === SATURATED) throw new Error("unexpected saturation");
            expect(
              port.viewX(lease).buffer instanceof SharedArrayBuffer,
              `${mode.label} backing check`,
            ).toBe(mode.expectSab);

            port.viewX(lease).set(refX);
            port.viewY(lease).set(refY);
            port.setKind(lease, kind);
            port.setSampleCount(lease, sampleCount);
            port.setBucketCount(lease, bucketCount);
            port.setDomain(lease, 0, 100);
            port.submit(lease);

            let actualCount = -1;
            let actualData: number[] = [];
            await pollUntilSettled(port, (settled, outCount) => {
              actualCount = outCount;
              actualData =
                kind === DecimationKind.MinMaxEnvelope
                  ? Array.from(port.viewOut(settled).subarray(0, outCount))
                  : Array.from(port.viewIndices(settled).subarray(0, outCount));
              port.release(settled);
            });

            const expected = expectedByKind.get(kind)!;
            expect(actualCount).toBe(expected.outCount);
            expect(actualData).toEqual(expected.data);
          }
        } finally {
          port.dispose();
        }
      });
    }
  }, 20_000);

  it("recovers from both uncaught worker throw and unexpected non-zero process.exit(1) via lazy respawn", async () => {
    for (const crashMode of ["throw-on-first-work", "exit-on-first-work"] as const) {
      await withRealmIsolation(false, async () => {
        let spawns = 0;
        const factory: WorkerFactory = () => {
          spawns += 1;
          // First worker crashes; lazily respawned second worker runs normally
          const mode = spawns === 1 ? crashMode : "normal";
          return createNodeWorkerFactory(workerScriptUrl, { workerData: { mode } })();
        };

        const port = createWorkerDecimationPort({
          poolPairs: 1,
          transitCapacitySamples: 256,
          maxRemintEvents: 4,
          workerFactory: factory,
        });

        try {
          expect(spawns).toBe(1);
          const lease1 = port.acquire();
          if (lease1 === SATURATED) throw new Error("unexpected saturation");
          fillLorentzian(port.viewX(lease1), port.viewY(lease1), 128);
          port.setKind(lease1, DecimationKind.MinMaxEnvelope);
          port.setSampleCount(lease1, 128);
          port.setBucketCount(lease1, 16);
          port.submit(lease1);

          // Wait for real Node worker thread crash event to propagate
          const stats = createTransportStatsView();
          const deadline = performance.now() + 5_000;
          while (performance.now() < deadline) {
            port.readStats(stats);
            if (stats.counters[StatCounter.ResponderFailures]! >= 1) break;
            await sleep(5);
          }
          expect(stats.counters[StatCounter.ResponderFailures]).toBe(1);
          // Lazy respawn: second worker has not spawned until next acquire()
          expect(spawns).toBe(1);

          const lease2 = port.acquire();
          if (lease2 === SATURATED) throw new Error("expected recovered lease");
          expect(spawns).toBe(2);
          fillLorentzian(port.viewX(lease2), port.viewY(lease2), 128);
          port.setKind(lease2, DecimationKind.MinMaxEnvelope);
          port.setSampleCount(lease2, 128);
          port.setBucketCount(lease2, 16);
          port.submit(lease2);

          let settledOutCount = 0;
          await pollUntilSettled(port, (settled, outCount) => {
            settledOutCount = outCount;
            port.release(settled);
          });
          expect(settledOutCount).toBe(32);
        } finally {
          port.dispose();
        }
      });
    }
  }, 20_000);

  it("disposes cleanly without hanging while the Shared worker is blocked in Atomics.wait", async () => {
    await withRealmIsolation(undefined, async () => {
      const port = createWorkerDecimationPort({
        poolPairs: 2,
        transitCapacitySamples: 256,
        workerFactory: createNodeWorkerFactory(workerScriptUrl),
      });

      // Run one job to guarantee the worker has entered runSabWorkerLoop and returned to Atomics.wait
      const lease = port.acquire();
      if (lease === SATURATED) throw new Error("unexpected saturation");
      fillLorentzian(port.viewX(lease), port.viewY(lease), 64);
      port.setKind(lease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease, 64);
      port.setBucketCount(lease, 8);
      port.submit(lease);
      await pollUntilSettled(port, (settled) => {
        port.release(settled);
      });

      // Let the worker settle cleanly into Atomics.wait
      await sleep(25);
      const start = performance.now();
      port.dispose();
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1_000);
    });
  }, 10_000);
});

describe("node:worker_threads — P5 Transfer payload-size invariance and Shared --expose-gc 0-GC gate", () => {
  it("preserves exact 3/3/4 per-settlement view re-mints in Transfer mode across 4,096 and 262,144 samples", async () => {
    await withRealmIsolation(false, async () => {
      async function measureRemints(deltaSamples: number): Promise<Record<DecimationKind, number>> {
        const transferCounts: number[] = [];
        const baseFactory = createNodeWorkerFactory(workerScriptUrl);
        const spyingFactory: WorkerFactory = () => {
          const inner: WorkerLike = baseFactory();
          return {
            postMessage(msg: unknown, transfer?: ArrayBuffer[]): void {
              if (transfer !== undefined) {
                transferCounts.push(transfer.length);
                inner.postMessage(msg, transfer);
              } else {
                inner.postMessage(msg);
              }
            },
            terminate: () => inner.terminate(),
            addEventListener: inner.addEventListener.bind(inner),
            removeEventListener: inner.removeEventListener.bind(inner),
          };
        };

        const port = createWorkerDecimationPort({
          poolPairs: 1,
          transitCapacitySamples: deltaSamples,
          workerFactory: spyingFactory,
        });

        try {
          const remints: Record<DecimationKind, number> = {
            [DecimationKind.MinMaxEnvelope]: -1,
            [DecimationKind.Lttb]: -1,
            [DecimationKind.MinMaxEnvelopeIndices]: -1,
          };

          for (const kind of [
            DecimationKind.MinMaxEnvelope,
            DecimationKind.MinMaxEnvelopeIndices,
            DecimationKind.Lttb,
          ]) {
            const lease = port.acquire();
            if (lease === SATURATED) throw new Error("unexpected saturation");
            const preX = port.viewX(lease);
            const preY = port.viewY(lease);
            const preOut = port.viewOut(lease);
            const preIdx = port.viewIndices(lease);
            fillLorentzian(preX, preY, deltaSamples);
            port.setKind(lease, kind);
            port.setSampleCount(lease, deltaSamples);
            port.setBucketCount(lease, 128);
            port.setDomain(lease, 0, 100);
            port.submit(lease);

            let countChanged = 0;
            await pollUntilSettled(port, (settled) => {
              if (port.viewX(settled) !== preX) countChanged += 1;
              if (port.viewY(settled) !== preY) countChanged += 1;
              if (port.viewOut(settled) !== preOut) countChanged += 1;
              if (port.viewIndices(settled) !== preIdx) countChanged += 1;
              port.release(settled);
            });
            remints[kind] = countChanged;
          }

          expect(transferCounts).toEqual([3, 3, 4]);
          return remints;
        } finally {
          port.dispose();
        }
      }

      const small = await measureRemints(4_096);
      const large = await measureRemints(262_144);

      expect(small[DecimationKind.MinMaxEnvelope]).toBe(3);
      expect(small[DecimationKind.MinMaxEnvelopeIndices]).toBe(3);
      expect(small[DecimationKind.Lttb]).toBe(4);
      expect(large).toEqual(small);
    });
  }, 30_000);

  it("records 0 GC events and 0 view re-mints across 1,000 Shared worker_threads round trips (paired with a live allocating control)", async () => {
    await withRealmIsolation(undefined, async () => {
      const sampleCount = 1_024;
      const bucketCount = 64;
      const port = createWorkerDecimationPort({
        poolPairs: 1,
        transitCapacitySamples: sampleCount,
        workerFactory: createNodeWorkerFactory(workerScriptUrl),
      });

      try {
        // Populate slot 0 once; Shared mode retains exact view identities and data across cycles
        const initLease = port.acquire();
        if (initLease === SATURATED) throw new Error("unexpected saturation");
        const initialX = port.viewX(initLease);
        const initialY = port.viewY(initLease);
        const initialOut = port.viewOut(initLease);
        const initialIdx = port.viewIndices(initLease);
        expect(initialX.buffer).toBeInstanceOf(SharedArrayBuffer);
        fillLorentzian(initialX, initialY, sampleCount);
        port.release(initLease);

        let viewRemints = 0;
        const sink: SettlementSink = {
          onSettled(settled) {
            if (port.viewX(settled) !== initialX) viewRemints += 1;
            if (port.viewY(settled) !== initialY) viewRemints += 1;
            if (port.viewOut(settled) !== initialOut) viewRemints += 1;
            if (port.viewIndices(settled) !== initialIdx) viewRemints += 1;
            port.release(settled);
          },
        };

        function runOneSharedRoundTrip(): void {
          const lease = port.acquire();
          if (lease === SATURATED) throw new Error("unexpected saturation");
          port.setKind(lease, DecimationKind.MinMaxEnvelope);
          port.setSampleCount(lease, sampleCount);
          port.setBucketCount(lease, bucketCount);
          port.submit(lease);
          const deadline = performance.now() + 5_000;
          while (port.poll(sink) === 0) {
            if (performance.now() > deadline) {
              throw new Error("Timed out in Shared worker_threads spin-poll");
            }
          }
        }

        // Warm up JIT + worker thread
        for (let i = 0; i < 200; i += 1) {
          runOneSharedRoundTrip();
        }
        viewRemints = 0;

        // 1. Measured Shared hot path: 1,000 real multi-threaded round trips
        let sharedGcCount = 0;
        const sharedObserver = new PerformanceObserver((list) => {
          sharedGcCount += list.getEntries().length;
        });
        sharedObserver.observe({ entryTypes: ["gc"] });
        globalThis.gc?.();
        await sleep(30);
        sharedGcCount = 0;

        for (let i = 0; i < 1_000; i += 1) {
          runOneSharedRoundTrip();
        }

        await sleep(30);
        sharedObserver.disconnect();

        expect(viewRemints).toBe(0);
        expect(sharedGcCount).toBe(0);

        // 2. Live allocating control in the same test run: must record > 0 GC events
        let controlGcCount = 0;
        const controlObserver = new PerformanceObserver((list) => {
          controlGcCount += list.getEntries().length;
        });
        controlObserver.observe({ entryTypes: ["gc"] });
        globalThis.gc?.();
        await sleep(30);
        controlGcCount = 0;

        let garbage: Array<{ copy: Float32Array; pad: number[] }> = [];
        for (let i = 0; i < 1_000; i += 1) {
          runOneSharedRoundTrip();
          for (let k = 0; k < 64; k += 1) {
            garbage.push({ copy: initialY.slice(0, 64), pad: [1, 2, 3, 4] });
          }
          if (garbage.length > 20_000) garbage = [];
        }

        await sleep(30);
        controlObserver.disconnect();
        expect(controlGcCount).toBeGreaterThan(0);
      } finally {
        port.dispose();
      }
    });
  }, 60_000);
});
