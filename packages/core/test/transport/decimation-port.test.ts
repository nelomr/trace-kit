import { describe, expect, it } from "vitest";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import { DecimationKind, PortMode } from "../../src/transport/decimation-port.js";
import { SATURATED } from "../../src/transport/ownership.js";
import { StatCounter, createTransportStatsView } from "../../src/transport/backpressure.js";
import { MAX_BUCKETS } from "../../src/transport/streaming-contract.js";

const REQUIRED_MEMBERS = [
  "mode",
  "poolPairs",
  "transitCapacitySamples",
  "acquire",
  "viewX",
  "viewY",
  "viewOut",
  "viewIndices",
  "submit",
  "poll",
  "release",
  "reportResponderFailure",
  "noteDroppedSamples",
  "readStats",
  "dispose",
  "setKind",
  "setSampleCount",
  "setBucketCount",
  "setDomain",
] as const;

describe("DecimationPort surface", () => {
  it("exposes exactly the members the interface declares", () => {
    const port = createSyncDecimationPort();
    for (const member of REQUIRED_MEMBERS) {
      expect(port).toHaveProperty(member);
    }
  });

  it("no method returns a Promise", () => {
    const port = createSyncDecimationPort();
    const lease = port.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    port.setKind(lease, DecimationKind.MinMaxEnvelope);
    port.setSampleCount(lease, 4);
    port.setBucketCount(lease, 2);
    const result = port.submit(lease);
    // `result` is a branded number (a lease handle or SATURATED), never an object — asserting
    // its runtime type directly is the honest form of "not a Promise" for a numeric handle.
    expect(typeof result).toBe("number");
  });

  it("dispose() is terminal and idempotent", () => {
    const port = createSyncDecimationPort();
    port.dispose();
    port.dispose();
    expect(port.acquire()).toBe(SATURATED);
  });

  it("declares no workerFactory field and no Worker-typed member on the port instance", () => {
    const port = createSyncDecimationPort();
    expect(Object.keys(port)).not.toContain("workerFactory");
  });
});

describe("createSyncDecimationPort", () => {
  it("drives a lease through Free -> Acquired -> InFlight -> Settled via minMaxEnvelope, with no browser global reference", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");

    const port = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 16 });
    expect(port.mode).toBe(PortMode.Synchronous);

    const lease = port.acquire();
    if (lease === SATURATED) throw new Error("unreachable");

    const y = port.viewY(lease);
    for (let i = 0; i < 8; i += 1) y[i] = Math.sin(i);
    port.setKind(lease, DecimationKind.MinMaxEnvelope);
    port.setSampleCount(lease, 8);
    port.setBucketCount(lease, 4);

    port.submit(lease);

    let settledCount = 0;
    let outCount = 0;
    port.poll({
      onSettled(settled, count) {
        settledCount += 1;
        outCount = count;
        expect(port.viewOut(settled).length).toBeGreaterThan(0);
        port.release(settled);
      },
    });

    expect(settledCount).toBe(1);
    expect(outCount).toBe(8); // bucketCount * 2
  });

  it("runs an lttb request end to end", () => {
    const port = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 16 });
    const lease = port.acquire();
    if (lease === SATURATED) throw new Error("unreachable");

    const x = port.viewX(lease);
    const y = port.viewY(lease);
    for (let i = 0; i < 10; i += 1) {
      x[i] = i;
      y[i] = Math.sin(i);
    }
    port.setKind(lease, DecimationKind.Lttb);
    port.setSampleCount(lease, 10);
    port.setBucketCount(lease, 4);

    port.submit(lease);

    let outCount = 0;
    port.poll({
      onSettled(settled, count) {
        outCount = count;
        port.release(settled);
      },
    });
    expect(outCount).toBe(4);
  });

  it("runs a MinMaxEnvelopeIndices request matching minMaxEnvelopeIndices bit-for-bit, including MAX_BUCKETS", () => {
    const port = createSyncDecimationPort({
      poolPairs: 1,
      transitCapacitySamples: MAX_BUCKETS * 2,
    });
    expect(DecimationKind.MinMaxEnvelopeIndices).toBe(2);

    const sampleCount = MAX_BUCKETS * 2;
    const expectedIndices = new Int32Array(MAX_BUCKETS * 2);

    const lease1 = port.acquire();
    if (lease1 === SATURATED) throw new Error("unreachable");
    const y1 = port.viewY(lease1);
    for (let i = 0; i < sampleCount; i += 1) {
      y1[i] = Math.sin(i * 0.013) + Math.cos(i * 0.007);
    }
    const directCount = minMaxEnvelopeIndices(
      y1,
      0,
      sampleCount,
      expectedIndices,
      0,
      MAX_BUCKETS,
    );

    expect(port.viewIndices(lease1).length).toBe(MAX_BUCKETS * 2);
    port.setKind(lease1, DecimationKind.MinMaxEnvelopeIndices);
    port.setSampleCount(lease1, sampleCount);
    port.setBucketCount(lease1, MAX_BUCKETS);
    port.submit(lease1);

    let outCount = 0;
    const actualIndices = new Int32Array(MAX_BUCKETS * 2);
    port.poll({
      onSettled(settled, count) {
        outCount = count;
        const indicesView = port.viewIndices(settled);
        expect(indicesView.length).toBe(MAX_BUCKETS * 2);
        for (let i = 0; i < count; i += 1) {
          actualIndices[i] = indicesView[i]!;
        }
        port.release(settled);
      },
    });

    expect(outCount).toBe(directCount);
    expect(outCount).toBe(MAX_BUCKETS * 2);
    expect(actualIndices).toEqual(expectedIndices);

    // Fixed capacity invariant: viewIndices.length stays MAX_BUCKETS * 2 even for bucketCount = 1.
    const lease2 = port.acquire();
    if (lease2 === SATURATED) throw new Error("unreachable");
    port.setKind(lease2, DecimationKind.MinMaxEnvelopeIndices);
    port.setSampleCount(lease2, 16);
    port.setBucketCount(lease2, 1);
    port.submit(lease2);
    let outCount2 = 0;
    port.poll({
      onSettled(settled, count) {
        outCount2 = count;
        expect(port.viewIndices(settled).length).toBe(MAX_BUCKETS * 2);
        port.release(settled);
      },
    });
    expect(outCount2).toBe(2);
    expect(outCount2).not.toBe(outCount);
  });

  it("readStats reports a clean run with zero ownership violations", () => {
    const port = createSyncDecimationPort({ poolPairs: 1 });
    const lease = port.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    port.setKind(lease, DecimationKind.MinMaxEnvelope);
    port.setSampleCount(lease, 0);
    port.setBucketCount(lease, 0);
    port.submit(lease);
    port.poll({ onSettled: (settled) => port.release(settled) });

    const stats = createTransportStatsView();
    port.readStats(stats);
    expect(stats.counters[StatCounter.OwnershipViolations]).toBe(0);
  });
});
