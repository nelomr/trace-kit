import {
  constants as perfConstants,
  type PerformanceEntry as NodePerformanceEntry,
  PerformanceObserver,
} from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeAllocating } from "./allocating-control.js";

// The gate must not be able to skip itself: this is the first assertion in the file, failing
// rather than skipping when `--expose-gc` is absent. `pool: 'forks'` +
// `poolOptions.forks.execArgv: ['--expose-gc']` on the root `vitest.config.ts` `test` object is
// the only wiring that can deliver this V8 flag (NODE_OPTIONS and worker_threads execArgv both
// reject it).
describe("allocation-gate", () => {
  it("exposes globalThis.gc under the forked pool's --expose-gc flag", () => {
    expect(typeof globalThis.gc).toBe("function");
  });
});

interface GcConfig {
  sampleCount: number;
  bucketCount: number;
  iterations: number;
}

const SMALL: GcConfig = { sampleCount: 4096, bucketCount: 512, iterations: 10_000 };
const LARGE: GcConfig = { sampleCount: 1_000_000, bucketCount: 1000, iterations: 200 };

interface GcEntryDetail {
  kind?: number;
  flags?: number;
}

/** Node's `gc`-kind `PerformanceEntry` carries `kind`/`flags`, undeclared in the base lib type. */
interface GcPerformanceEntry extends NodePerformanceEntry {
  kind?: number;
  flags?: number;
}

function kindName(kind: number | undefined): string {
  if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) return "GC_MAJOR";
  if (kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) return "GC_MINOR";
  if (kind === perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL)
    return "GC_INCREMENTAL";
  if (kind === perfConstants.NODE_PERFORMANCE_GC_WEAKCB) return "GC_WEAKCB";
  return `unknown(${String(kind)})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Measures GC events fired by `run()` over `iterations` calls, after a warm-up phase. The
 * pre-window `gc()` + drain makes the assertion about the measured window, not the preceding
 * warm-up.
 */
async function measureGcEvents(
  run: () => void,
  iterations: number,
): Promise<{ count: number; details: GcEntryDetail[] }> {
  const details: GcEntryDetail[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const detail = entry as GcPerformanceEntry;
      details.push({ kind: detail.kind, flags: detail.flags });
    }
  });
  observer.observe({ entryTypes: ["gc"] });

  // Warm-up: TurboFan must have tiered before the measured window opens.
  for (let i = 0; i < 20; i += 1) run();

  globalThis.gc?.();
  await sleep(30);
  details.length = 0;

  for (let i = 0; i < iterations; i += 1) run();

  await sleep(30);
  observer.disconnect();

  return { count: details.length, details };
}

describe.sequential("allocation-gate — minMaxEnvelope", () => {
  // Control-first discipline: a zero control invalidates the whole file, so this beforeAll
  // throws rather than letting a green "allocation-free" test stand beside a red control.
  beforeAll(async () => {
    for (const config of [SMALL, LARGE]) {
      const y = new Float32Array(config.sampleCount);
      for (let i = 0; i < y.length; i += 1) y[i] = i;
      const { count } = await measureGcEvents(
        () => minMaxEnvelopeAllocating(y, 0, config.sampleCount, config.bucketCount),
        config.iterations,
      );
      if (count === 0) {
        throw new Error(
          `allocating control reported 0 GC events at sampleCount=${config.sampleCount}; ` +
            "the instrument is not measuring anything and the allocation-free result would be meaningless.",
        );
      }
    }
  });

  it("the allocating control reports > 0 GC events (small)", async () => {
    const y = new Float32Array(SMALL.sampleCount);
    const { count } = await measureGcEvents(
      () => minMaxEnvelopeAllocating(y, 0, SMALL.sampleCount, SMALL.bucketCount),
      SMALL.iterations,
    );
    expect(count).toBeGreaterThan(0);
  });

  it("the allocating control reports > 0 GC events (large)", async () => {
    const y = new Float32Array(LARGE.sampleCount);
    const { count } = await measureGcEvents(
      () => minMaxEnvelopeAllocating(y, 0, LARGE.sampleCount, LARGE.bucketCount),
      LARGE.iterations,
    );
    expect(count).toBeGreaterThan(0);
  });

  it("minMaxEnvelope reports exactly 0 GC events (small)", async () => {
    const y = new Float32Array(SMALL.sampleCount);
    const out = new Float32Array(SMALL.bucketCount * 2);
    const { count, details } = await measureGcEvents(
      () => minMaxEnvelope(y, 0, SMALL.sampleCount, out, 0, SMALL.bucketCount),
      SMALL.iterations,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  });

  it("minMaxEnvelope reports exactly 0 GC events (large)", async () => {
    const y = new Float32Array(LARGE.sampleCount);
    const out = new Float32Array(LARGE.bucketCount * 2);
    const { count, details } = await measureGcEvents(
      () => minMaxEnvelope(y, 0, LARGE.sampleCount, out, 0, LARGE.bucketCount),
      LARGE.iterations,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  });
});
