import { PerformanceObserver } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";
import { createTransportStatsView } from "../../src/transport/backpressure.js";
import { materializeBucketsToPayload } from "../../src/transport/materialize.js";
import {
  applyDomainChange,
  createBucketAccumulator,
  createRawSampleRing,
  ingestBatch,
  rebuildDomain,
} from "../../src/transport/streaming-contract.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureGcEvents(run: () => void, iterations: number): Promise<number> {
  let count = 0;
  const observer = new PerformanceObserver((list) => {
    count += list.getEntries().length;
  });
  observer.observe({ entryTypes: ["gc"] });

  for (let i = 0; i < 200; i += 1) run();

  globalThis.gc?.();
  await sleep(30);
  count = 0;

  for (let i = 0; i < iterations; i += 1) run();

  await sleep(30);
  observer.disconnect();
  return count;
}

describe("streaming-allocation-gate — zero-GC streaming hot paths", () => {
  it("live allocating control records > 0 GC events", async () => {
    const ring = createRawSampleRing(4096);
    const acc = createBucketAccumulator(256);
    acc.domainMin = 0;
    acc.invBucketWidth = 1;
    const xs = new Float32Array(256);
    const ys = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      xs[i] = i;
      ys[i] = Math.sin(i);
    }

    let retainedGarbage: Array<{ slice: Float32Array; padding: number[] }> = [];
    const count = await measureGcEvents(() => {
      ingestBatch(ring, xs, ys, 0, 256, acc);
      for (let k = 0; k < 64; k += 1) {
        retainedGarbage.push({
          slice: xs.slice(0, 64),
          padding: [1, 2, 3, 4],
        });
      }
      if (retainedGarbage.length > 20_000) retainedGarbage = [];
    }, 1_000);

    expect(count).toBeGreaterThan(0);
  }, 60_000);

  it("ingestBatch reports 0 GC events across 1,000 batches of 256 samples", async () => {
    const ring = createRawSampleRing(4096);
    const acc = createBucketAccumulator(256);
    acc.domainMin = 0;
    acc.invBucketWidth = 1;

    const xs = new Float32Array(256);
    const ys = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      xs[i] = i;
      ys[i] = i === 128 ? NaN : Math.sin(i * 0.1);
    }

    const count = await measureGcEvents(() => {
      ingestBatch(ring, xs, ys, 0, 256, acc);
    }, 1_000);

    expect(count).toBe(0);
  });

  it("rebuildDomain reports 0 GC events across 1,000 invocations", async () => {
    const ring = createRawSampleRing(1024);
    for (let i = 0; i < 1024; i += 1) {
      ring.x[i] = i;
      ring.y[i] = i === 500 ? NaN : Math.sin(i * 0.05);
    }
    ring.totalWritten = 1024;
    ring.writeIndex = 0;

    const acc = createBucketAccumulator(256);
    const stats = createTransportStatsView();

    const count = await measureGcEvents(() => {
      rebuildDomain(acc, ring, 0, 256 / 1024, stats);
    }, 1_000);

    expect(count).toBe(0);
  });

  it("Tier-1 applyDomainChange (+/-1 aligned pan) reports 0 GC events across 1,000 invocations", async () => {
    const ring = createRawSampleRing(1024);
    for (let i = 0; i < 1024; i += 1) {
      ring.x[i] = i;
      ring.y[i] = Math.sin(i * 0.05);
    }
    ring.totalWritten = 1024;
    ring.writeIndex = 0;

    const acc = createBucketAccumulator(256);
    const stats = createTransportStatsView();
    rebuildDomain(acc, ring, 100, 1, stats);

    // Preallocate two request objects to toggle between domainMin=101 (+1) and domainMin=100 (-1)
    const reqPlus = {
      requestedDomainMin: 101,
      requestedInvBucketWidth: 1,
      inGesture: false,
    };
    const reqMinus = {
      requestedDomainMin: 100,
      requestedInvBucketWidth: 1,
      inGesture: false,
    };
    let toggle = false;

    const count = await measureGcEvents(() => {
      toggle = !toggle;
      applyDomainChange(acc, ring, toggle ? reqPlus : reqMinus, stats);
    }, 1_000);

    expect(count).toBe(0);
  });

  it("materializeBucketsToPayload reports 0 GC events across 1,000 invocations", async () => {
    const ring = createRawSampleRing(1024);
    const acc = createBucketAccumulator(256);
    for (let i = 0; i < 1024; i += 1) {
      ring.x[i] = i;
      ring.y[i] = i % 64 === 0 ? NaN : Math.sin(i * 0.05);
    }
    ring.totalWritten = 1024;
    ring.writeIndex = 0;
    rebuildDomain(acc, ring, 0, 256 / 1024);

    const payload = createSpectrumDataPayload({
      capacity: 512,
      xOrigin: 1550.0,
      xUnit: "nm",
      yUnit: "dBm",
    });

    const count = await measureGcEvents(() => {
      materializeBucketsToPayload(acc, payload, 1550.0);
    }, 1_000);

    expect(count).toBe(0);
  });
});
