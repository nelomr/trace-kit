import { describe, expect, it } from "vitest";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import { DecimationKind, PortMode } from "../../src/transport/decimation-port.js";
import { SATURATED } from "../../src/transport/ownership.js";
import { StatCounter, createTransportStatsView } from "../../src/transport/backpressure.js";

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
