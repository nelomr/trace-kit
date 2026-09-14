import { describe, expect, it } from "vitest";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { SATURATED } from "../../src/transport/ownership.js";
import {
  StatCounter,
  TransportHealth,
  createTransportStatsView,
} from "../../src/transport/backpressure.js";

describe("backpressure — saturation", () => {
  it("acquire() returns SATURATED at full saturation, drops counted exactly once, no allocation", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    pool.acquire();
    pool.acquire();

    const result = pool.acquire();
    expect(result).toBe(SATURATED);

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.ChunksDropped]).toBe(1);
  });
});

describe("backpressure — stats contract", () => {
  it("readStats writes in place with no per-call object allocation", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    const out = createTransportStatsView();
    const countersRef = out.counters;
    const gaugesRef = out.gauges;

    for (let i = 0; i < 1000; i += 1) {
      pool.readStats(out);
    }

    expect(out.counters).toBe(countersRef);
    expect(out.gauges).toBe(gaugesRef);
  });

  it("readStats rejects an undersized out view", () => {
    const pool = createBufferPool({ poolPairs: 2 });
    const undersized = { counters: new Int32Array(1), gauges: new Float64Array(1) };
    expect(() => pool.readStats(undersized)).toThrow(RangeError);
  });
});

describe("backpressure — healthy vs stalled discrimination", () => {
  it("ConsecutiveDrops <= poolPairs with ChunksAccepted increasing never reports Stalled", () => {
    const pool = createBufferPool({ poolPairs: 3, stallDropThreshold: 120 });
    pool.acquire();
    pool.acquire();
    pool.acquire();
    // 3 consecutive drops (== poolPairs), well under stallDropThreshold.
    pool.acquire();
    pool.acquire();
    pool.acquire();

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.Health]).not.toBe(TransportHealth.Stalled);
  });

  it("an injected 10-frame stall drops exactly 10 and never reports Stalled", () => {
    const pool = createBufferPool({ poolPairs: 1, stallDropThreshold: 120 });
    pool.acquire(); // occupy the only slot

    for (let i = 0; i < 10; i += 1) {
      expect(pool.acquire()).toBe(SATURATED);
    }

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.ChunksDropped]).toBe(10);
    expect(stats.counters[StatCounter.Health]).not.toBe(TransportHealth.Stalled);
  });

  it("an injected 200-frame stall reports Stalled and clears to Ready on the next accepted chunk", () => {
    const pool = createBufferPool({ poolPairs: 1, stallDropThreshold: 120 });
    const first = pool.acquire();
    if (first === SATURATED) throw new Error("unreachable");

    for (let i = 0; i < 200; i += 1) {
      pool.acquire();
    }

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Stalled);

    pool.release(first);
    const accepted = pool.acquire();
    expect(accepted).not.toBe(SATURATED);

    pool.readStats(stats);
    expect(stats.counters[StatCounter.Health]).toBe(TransportHealth.Ready);
  });
});

describe("backpressure — Health as an ordered, total function of port state", () => {
  it("counts ChunksDropped/PoolExhaustionEvents/MaxConsecutiveDrops/ConsecutiveDrops over a drop-accept-drop sequence", () => {
    const pool = createBufferPool({ poolPairs: 1, stallDropThreshold: 120 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");

    for (let i = 0; i < 50; i += 1) pool.acquire();
    pool.release(lease);
    const reAcquired = pool.acquire();
    if (reAcquired === SATURATED) throw new Error("unreachable");
    for (let i = 0; i < 50; i += 1) pool.acquire();

    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.ChunksDropped]).toBe(100);
    expect(stats.counters[StatCounter.PoolExhaustionEvents]).toBe(2);
    expect(stats.counters[StatCounter.MaxConsecutiveDrops]).toBe(50);
    expect(stats.counters[StatCounter.ConsecutiveDrops]).toBe(50);
  });

  it("SamplesDropped accumulates only through noteDroppedSamples", () => {
    const pool = createBufferPool({ poolPairs: 1 });
    pool.acquire();
    for (let i = 0; i < 10; i += 1) {
      const result = pool.acquire();
      if (result === SATURATED && i < 4) {
        pool.noteDroppedSamples(1_000);
      }
    }
    const stats = createTransportStatsView();
    pool.readStats(stats);
    expect(stats.counters[StatCounter.SamplesDropped]).toBe(4_000);
  });
});
