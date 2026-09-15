/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { generateLorentzian, type LorentzianParams } from "../../src/views/core-math/lorentzian.js";

const PARAMS: LorentzianParams = {
  seed: 7,
  centerFrequency: 400,
  fwhm: 30,
  noiseFloor: 0.01,
};

async function countGcEvents(run: () => void): Promise<number> {
  if (typeof globalThis.gc !== "function") {
    throw new Error("run with --expose-gc");
  }
  let events = 0;
  const observer = new PerformanceObserver((list) => {
    events += list.getEntriesByType("gc").length;
  });
  observer.observe({ entryTypes: ["gc"] });

  // Warm-up: let JIT tiering and any one-time allocation happen before the measured pass.
  for (let i = 0; i < 5; i += 1) {
    run();
  }
  globalThis.gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
  events = 0;

  for (let i = 0; i < 50; i += 1) {
    run();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer.disconnect();
  return events;
}

describe("Lorentzian generator allocation gate", () => {
  it.each([1_000, 100_000])(
    "reports 0 GC events at sampleCount %i after warm-up",
    async (sampleCount) => {
      const x = new Float32Array(sampleCount);
      const y = new Float32Array(sampleCount);
      const events = await countGcEvents(() => {
        generateLorentzian(x, y, sampleCount, PARAMS);
      });
      expect(events).toBe(0);
    },
    60_000,
  );

  it("the allocating control variant reports non-zero GC events", async () => {
    // 200 iterations of 2x 1e6-element Float32Array allocation, deliberately uncollected
    // between iterations. The timeout is generous (matching the equivalent core-package gate's
    // own 60s budget) because this suite and the core package's own GC-event gate can run
    // concurrently under the workspace test runner, and both compete for CPU and GC pauses —
    // 20s was observed to time out under that contention even though the same case completes
    // in ~1-2s when run in isolation.
    const sampleCount = 1_000_000;
    let events = 0;
    if (typeof globalThis.gc !== "function") {
      throw new Error("run with --expose-gc");
    }
    const observer = new PerformanceObserver((list) => {
      events += list.getEntriesByType("gc").length;
    });
    observer.observe({ entryTypes: ["gc"] });
    // Deliberately allocates a fresh pair of large output arrays per call, unlike the real
    // generator, and does not force a `gc()` between iterations — enough garbage accumulates
    // across the loop that V8 collects it without prompting.
    for (let i = 0; i < 200; i += 1) {
      const x = new Float32Array(sampleCount);
      const y = new Float32Array(sampleCount);
      generateLorentzian(x, y, sampleCount, PARAMS);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    expect(events).toBeGreaterThan(0);
  }, 60_000);
});
