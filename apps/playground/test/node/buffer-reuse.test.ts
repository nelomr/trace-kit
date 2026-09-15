/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { createCoreMathState } from "../../src/views/core-math/mount.js";

async function countGcEvents(run: () => void): Promise<number> {
  if (typeof globalThis.gc !== "function") {
    throw new Error("run with --expose-gc");
  }
  let events = 0;
  const observer = new PerformanceObserver((list) => {
    events += list.getEntriesByType("gc").length;
  });
  observer.observe({ entryTypes: ["gc"] });
  run();
  globalThis.gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
  events = 0;
  run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer.disconnect();
  return events;
}

describe("output buffer reuse across LTTB <-> Min-Max toggles", () => {
  it("reports 0 GC events across three toggles and keeps buffer identity", async () => {
    const state = createCoreMathState();
    state.regenerate({ seed: 1, centerFrequency: 500, fwhm: 40, noiseFloor: 0.01 }, 10_000);

    const lttbOutBefore = state.lttbOut;
    const minMaxOutBefore = state.minMaxOut;

    const events = await countGcEvents(() => {
      state.run("lttb", 500);
      state.run("min-max", 200);
      state.run("lttb", 500);
    });

    expect(events).toBe(0);
    expect(state.lttbOut).toBe(lttbOutBefore);
    expect(state.minMaxOut).toBe(minMaxOutBefore);
  }, 60_000);
});
