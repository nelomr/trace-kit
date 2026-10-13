import {
  constants as perfConstants,
  type PerformanceEntry as NodePerformanceEntry,
  PerformanceObserver,
} from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createSampleSpan,
  resolveSampleWindow,
  type SampleSpan,
  type SampleWindowOptions,
} from "../../src/viewport/window.js";
import { buildPayload } from "../support/payload-builder.js";

// Mirrors `transform-allocation.test.ts`: GC events observed over a steady-state loop are the
// evidence, and an allocating control proves the instrument can see an allocation at all.
describe("window-allocation-gate", () => {
  it("exposes globalThis.gc under the forked pool's --expose-gc flag", () => {
    expect(typeof globalThis.gc).toBe("function");
  });
});

interface GcPerformanceEntry extends NodePerformanceEntry {
  detail?: { kind?: number; flags?: number };
}

function kindName(kind: number | undefined): string {
  if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) return "GC_MAJOR";
  if (kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) return "GC_MINOR";
  if (kind === perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL) return "GC_INCREMENTAL";
  if (kind === perfConstants.NODE_PERFORMANCE_GC_WEAKCB) return "GC_WEAKCB";
  return `unknown(${String(kind)})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureGcEvents(
  run: () => void,
  iterations: number,
): Promise<{ count: number; kinds: string[] }> {
  const kinds: string[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      kinds.push(kindName((entry as GcPerformanceEntry).detail?.kind));
    }
  });
  observer.observe({ entryTypes: ["gc"] });

  // Warm-up lets the optimizing compiler settle, so its own transient allocation is not
  // attributed to the steady-state resolver.
  for (let i = 0; i < 500; i += 1) run();

  globalThis.gc?.();
  await sleep(50);
  globalThis.gc?.();
  await sleep(50);
  kinds.length = 0;

  for (let i = 0; i < iterations; i += 1) run();

  await sleep(30);
  observer.disconnect();
  return { count: kinds.length, kinds };
}

const SAMPLES = 4096;
const CALLS_PER_RUN = 10_000;
const ITERATIONS = 400;

const offsets = new Float32Array(SAMPLES);
for (let i = 0; i < SAMPLES; i += 1) offsets[i] = i * 0.5;
const payload = buildPayload({ x: offsets, xOrigin: 1550 });

const STRICT: SampleWindowOptions | undefined = undefined;
const NEIGHBOURS: SampleWindowOptions = { includeNeighbours: true };

function makeRun(options: SampleWindowOptions | undefined): {
  run: () => void;
  span: SampleSpan;
  identityPreserved: () => boolean;
} {
  const span = createSampleSpan();
  let identity = true;
  const run = (): void => {
    for (let i = 0; i < CALLS_PER_RUN; i += 1) {
      const lo = 1550 + (i % 1000);
      const result = resolveSampleWindow(payload, lo, lo + 300.25, span, options);
      if (result !== span) identity = false;
    }
  };
  return { run, span, identityPreserved: () => identity };
}

// Deliberately allocates one record per call, proving the instrument measures something.
function runAllocatingControl(): void {
  const sink: SampleSpan[] = [];
  const scratch = createSampleSpan();
  for (let i = 0; i < CALLS_PER_RUN; i += 1) {
    const lo = 1550 + (i % 1000);
    const result = resolveSampleWindow(payload, lo, lo + 300.25, scratch);
    sink.push({ start: result.start, end: result.end });
  }
  sink.length = 0;
}

describe("allocation-gate: resolveSampleWindow", () => {
  beforeAll(async () => {
    const { count } = await measureGcEvents(runAllocatingControl, ITERATIONS);
    if (count === 0) {
      throw new Error("allocating control reported 0 GC events; the instrument sees nothing.");
    }
  }, 60_000);

  it("the allocating control reports > 0 GC events", async () => {
    const { count } = await measureGcEvents(runAllocatingControl, ITERATIONS);
    expect(count).toBeGreaterThan(0);
  }, 60_000);

  for (const [label, options] of [
    ["strict", STRICT],
    ["with neighbours", NEIGHBOURS],
  ] as const) {
    it(`reports 0 GC events over ${String(ITERATIONS * CALLS_PER_RUN)} calls (${label}) and keeps the output identity`, async () => {
      const { run, identityPreserved } = makeRun(options);
      const { count, kinds } = await measureGcEvents(run, ITERATIONS);
      expect(count, kinds.join(", ")).toBe(0);
      expect(identityPreserved()).toBe(true);
    }, 60_000);
  }
});
