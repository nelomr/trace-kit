import {
  constants as perfConstants,
  type PerformanceEntry as NodePerformanceEntry,
  PerformanceObserver,
} from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";
import { minMaxEnvelopeIndices } from "../../src/decimation/min-max-indices.js";
import { resolveDecimationParameter } from "../../src/decimation/selection.js";
import { lttbAllocating, minMaxEnvelopeAllocating } from "./allocating-control.js";

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

interface LttbGcConfig {
  sampleCount: number;
  threshold: number;
  iterations: number;
}

const LTTB_SMALL: LttbGcConfig = { sampleCount: 4096, threshold: 512, iterations: 10_000 };
const LTTB_LARGE: LttbGcConfig = {
  sampleCount: 1_000_000,
  threshold: 1000,
  iterations: 200,
};

interface GcEntryDetail {
  kind?: number;
  flags?: number;
}

/**
 * Node's `gc`-kind `PerformanceEntry` carries `kind`/`flags` on `detail`, not directly on the
 * entry — reading them off the entry itself triggers the `DEP0152` deprecation warning.
 */
interface GcPerformanceEntry extends NodePerformanceEntry {
  detail?: { kind?: number; flags?: number };
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
      const detail = (entry as GcPerformanceEntry).detail;
      details.push({ kind: detail?.kind, flags: detail?.flags });
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

describe("allocation-gate — minMaxEnvelope", () => {
  // Control-first discipline: a zero control invalidates the whole file, so this beforeAll
  // throws rather than letting a green "allocation-free" test stand beside a red control.
  // The explicit 60s timeout (well above the ~2s this warmup takes standalone) is load-bearing:
  // under full-monorepo test concurrency this hook competes for CPU with every other forked
  // process, and Vitest's 10s default has been observed to time it out spuriously.
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
  }, 60_000);

  it("the allocating control reports > 0 GC events (small)", async () => {
    const y = new Float32Array(SMALL.sampleCount);
    const { count } = await measureGcEvents(
      () => minMaxEnvelopeAllocating(y, 0, SMALL.sampleCount, SMALL.bucketCount),
      SMALL.iterations,
    );
    expect(count).toBeGreaterThan(0);
  }, 60_000);

  it("the allocating control reports > 0 GC events (large)", async () => {
    const y = new Float32Array(LARGE.sampleCount);
    const { count } = await measureGcEvents(
      () => minMaxEnvelopeAllocating(y, 0, LARGE.sampleCount, LARGE.bucketCount),
      LARGE.iterations,
    );
    expect(count).toBeGreaterThan(0);
  }, 60_000);

  it("minMaxEnvelope reports exactly 0 GC events (small)", async () => {
    const y = new Float32Array(SMALL.sampleCount);
    const out = new Float32Array(SMALL.bucketCount * 2);
    const { count, details } = await measureGcEvents(
      () => minMaxEnvelope(y, 0, SMALL.sampleCount, out, 0, SMALL.bucketCount),
      SMALL.iterations,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);

  it("minMaxEnvelope reports exactly 0 GC events (large)", async () => {
    const y = new Float32Array(LARGE.sampleCount);
    const out = new Float32Array(LARGE.bucketCount * 2);
    const { count, details } = await measureGcEvents(
      () => minMaxEnvelope(y, 0, LARGE.sampleCount, out, 0, LARGE.bucketCount),
      LARGE.iterations,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);
});

describe("allocation-gate — lttb", () => {
  // Control-first discipline, mirrored from the minMaxEnvelope half above: a zero control
  // invalidates the whole file. Same 60s timeout rationale as that half — see the comment there.
  beforeAll(async () => {
    for (const config of [LTTB_SMALL, LTTB_LARGE]) {
      const x = new Float32Array(config.sampleCount);
      const y = new Float32Array(config.sampleCount);
      for (let i = 0; i < y.length; i += 1) {
        x[i] = i;
        y[i] = i;
      }
      const { count } = await measureGcEvents(
        () => lttbAllocating(x, y, 0, config.sampleCount, config.threshold),
        config.iterations,
      );
      if (count === 0) {
        throw new Error(
          `allocating control reported 0 GC events at sampleCount=${config.sampleCount}; ` +
            "the instrument is not measuring anything and the allocation-free result would be meaningless.",
        );
      }
    }
  }, 60_000);

  it("the allocating control reports > 0 GC events (small)", async () => {
    const x = new Float32Array(LTTB_SMALL.sampleCount);
    const y = new Float32Array(LTTB_SMALL.sampleCount);
    const { count } = await measureGcEvents(
      () => lttbAllocating(x, y, 0, LTTB_SMALL.sampleCount, LTTB_SMALL.threshold),
      LTTB_SMALL.iterations,
    );
    expect(count).toBeGreaterThan(0);
  }, 60_000);

  it("the allocating control reports > 0 GC events (large)", async () => {
    const x = new Float32Array(LTTB_LARGE.sampleCount);
    const y = new Float32Array(LTTB_LARGE.sampleCount);
    const { count } = await measureGcEvents(
      () => lttbAllocating(x, y, 0, LTTB_LARGE.sampleCount, LTTB_LARGE.threshold),
      LTTB_LARGE.iterations,
    );
    expect(count).toBeGreaterThan(0);
  }, 60_000);

  it("lttb reports exactly 0 GC events (small)", async () => {
    const x = new Float32Array(LTTB_SMALL.sampleCount);
    const y = new Float32Array(LTTB_SMALL.sampleCount);
    const out = new Int32Array(LTTB_SMALL.threshold);
    const { count, details } = await measureGcEvents(
      () => lttb(x, y, 0, LTTB_SMALL.sampleCount, out, 0, LTTB_SMALL.threshold),
      LTTB_SMALL.iterations,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);

  it("lttb reports exactly 0 GC events (large)", async () => {
    const x = new Float32Array(LTTB_LARGE.sampleCount);
    const y = new Float32Array(LTTB_LARGE.sampleCount);
    const out = new Int32Array(LTTB_LARGE.threshold);
    const { count, details } = await measureGcEvents(
      () => lttb(x, y, 0, LTTB_LARGE.sampleCount, out, 0, LTTB_LARGE.threshold),
      LTTB_LARGE.iterations,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);
});

// Widening (`selectable-decimation`): the zero-GC guarantee extends to selection resolution and
// `minMaxEnvelopeIndices`, never to a new walk mode — `buildTracePath` itself is untouched and
// covered separately. Instrument liveness is already proven above by the `minMaxEnvelope`/`lttb`
// allocating controls in this same file; a third redundant allocating control here would prove
// nothing new.
describe("allocation-gate — widening (resolveDecimationParameter, minMaxEnvelopeIndices)", () => {
  it("resolveDecimationParameter reports exactly 0 GC events across varying selections and plot widths", async () => {
    const selections = [
      { algorithm: "lttb" as const },
      { algorithm: "lttb" as const, threshold: 777 },
      { algorithm: "min-max" as const },
      { algorithm: "min-max" as const, bucketCount: 333 },
    ];
    const plotWidths = [320, 960, 1920];
    let cursor = 0;
    const { count, details } = await measureGcEvents(() => {
      const selection = selections[cursor % selections.length]!;
      const plotWidth = plotWidths[cursor % plotWidths.length]!;
      cursor += 1;
      resolveDecimationParameter(selection, plotWidth, 1_000_000);
    }, 10_000);
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);

  it("minMaxEnvelopeIndices reports exactly 0 GC events over 100,000 samples at bucketCount 960", async () => {
    const sampleCount = 100_000;
    const bucketCount = 960;
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < y.length; i += 1) y[i] = i;
    const out = new Int32Array(bucketCount * 2);
    const { count, details } = await measureGcEvents(
      () => minMaxEnvelopeIndices(y, 0, sampleCount, out, 0, bucketCount),
      200,
    );
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);
});
