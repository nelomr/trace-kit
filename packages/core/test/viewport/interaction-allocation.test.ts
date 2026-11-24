import {
  constants as perfConstants,
  type PerformanceEntry as NodePerformanceEntry,
  PerformanceObserver,
} from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";
import { DecimationKind } from "../../src/transport/decimation-port.js";
import {
  createBucketAccumulator,
  createRawSampleRing,
  ingestBatch,
  rebuildDomain,
} from "../../src/transport/streaming-contract.js";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import {
  createStreamingInvalidationAdapter,
  createWindowDecimationAdapter,
} from "../../src/transport/window-invalidation.js";
import {
  AXIS_MASK_X,
  AXIS_MASK_XY,
  AXIS_MASK_Y,
  capturePanGestureSnapshot,
  clampViewportDomain,
  computeBoxZoomDomain,
  computePanDomain,
  computeZoomDomain,
  createMutableViewportDomain,
  createPanGestureSnapshot,
  type MutableViewportDomain,
  type ViewportDomainConstraints,
} from "../../src/viewport/interaction.js";
import {
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  createViewportTransform,
  type ViewportTransform,
} from "../../src/viewport/transform.js";
import { buildPayload } from "../support/payload-builder.js";

// Mirrors `window-allocation.test.ts`: GC events observed over a warmed-up steady-state loop are
// the evidence, and a deliberately allocating control proves the instrument can see an
// allocation at all. Run under `--expose-gc --no-concurrent-recompilation` (see the root
// `vitest.config.ts` `core` project).
describe("interaction-allocation-gate", () => {
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
  warmupRuns: number,
): Promise<{ count: number; kinds: string[] }> {
  const kinds: string[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      kinds.push(kindName((entry as GcPerformanceEntry).detail?.kind));
    }
  });
  observer.observe({ entryTypes: ["gc"] });

  // Warm-up lets the optimizing compiler settle, so its own transient allocation is not
  // attributed to the steady-state code under test.
  for (let i = 0; i < warmupRuns; i += 1) run();

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

function makeTransform(yMin: number, yMax: number, yScaleKind: number): ViewportTransform {
  return createViewportTransform({
    cssWidth: 900,
    cssHeight: 380,
    dpr: 1,
    insetLeft: 80,
    insetRight: 20,
    insetTop: 20,
    insetBottom: 60,
    xDomainMin: 1550,
    xDomainMax: 1551,
    yDomainMin: yMin,
    yDomainMax: yMax,
    xOrigin: 1550,
    yScaleKind,
  });
}

const LINEAR_TRANSFORM = makeTransform(-10, 10, Y_SCALE_KIND_LINEAR);
const LOG_TRANSFORM = makeTransform(1e-3, 1e3, Y_SCALE_KIND_LOG);
const CONSTRAINTS: ViewportDomainConstraints = {
  bounds: { xMin: 1500, xMax: 1600, yMin: -100, yMax: 100 },
  minSpanX: 1e-6,
  minSpanY: 1e-3,
};
const LOG_CONSTRAINTS: ViewportDomainConstraints = {
  bounds: { yMin: 1e-9, yMax: 1e9 },
  minLogDecadesY: 1e-3,
};

const TICKS_PER_RUN = 10_000;
const MATH_ITERATIONS = 10; // 10 * 10_000 = 100_000 ticks per function
const MATH_WARMUP_RUNS = 50;

function makeLinearZoomRun(): () => void {
  const out = createMutableViewportDomain();
  return (): void => {
    let acc = 0;
    for (let i = 0; i < TICKS_PER_RUN; i += 1) {
      const phase = i % 100;
      const anchorX = 80 + phase * 8;
      const anchorY = 20 + phase * 3;
      const factor = phase < 50 ? 0.9 : 1.1;
      if (computeZoomDomain(LINEAR_TRANSFORM, factor, factor, anchorX, anchorY, AXIS_MASK_XY, CONSTRAINTS, out)) {
        acc += out.xMax - out.xMin;
      }
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  };
}

function makeLogZoomRun(): () => void {
  const out = createMutableViewportDomain();
  return (): void => {
    let acc = 0;
    for (let i = 0; i < TICKS_PER_RUN; i += 1) {
      const phase = i % 100;
      const anchorX = 80 + phase * 8;
      const anchorY = 20 + phase * 3;
      const factor = phase < 50 ? 0.9 : 1.1;
      if (computeZoomDomain(LOG_TRANSFORM, factor, factor, anchorX, anchorY, AXIS_MASK_XY, LOG_CONSTRAINTS, out)) {
        acc += out.yMax;
      }
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  };
}

function makePanRun(): () => void {
  const out = createMutableViewportDomain();
  const snapshotLinear = createPanGestureSnapshot();
  const snapshotLog = createPanGestureSnapshot();
  capturePanGestureSnapshot(LINEAR_TRANSFORM, 400, 170, snapshotLinear);
  capturePanGestureSnapshot(LOG_TRANSFORM, 400, 170, snapshotLog);
  return (): void => {
    let acc = 0;
    for (let i = 0; i < TICKS_PER_RUN; i += 1) {
      const phase = i % 100;
      if (computePanDomain(snapshotLinear, 350 + phase, 140 + phase, AXIS_MASK_XY, CONSTRAINTS, out)) {
        acc += out.xMin;
      }
      if (computePanDomain(snapshotLog, 350 + phase, 140 + phase, AXIS_MASK_Y, LOG_CONSTRAINTS, out)) {
        acc += out.yMin;
      }
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  };
}

function makeLinearBoxZoomRun(): () => void {
  const out = createMutableViewportDomain();
  return (): void => {
    let acc = 0;
    for (let i = 0; i < TICKS_PER_RUN; i += 1) {
      const phase = i % 100;
      const anchorX = 80 + phase * 6;
      const anchorY = 20 + phase * 2;
      if (computeBoxZoomDomain(LINEAR_TRANSFORM, anchorX, anchorY, anchorX + 120, anchorY + 90, AXIS_MASK_XY, CONSTRAINTS, out)) {
        acc += out.xMax;
      }
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  };
}

function makeLogBoxZoomRun(): () => void {
  const out = createMutableViewportDomain();
  return (): void => {
    let acc = 0;
    for (let i = 0; i < TICKS_PER_RUN; i += 1) {
      const phase = i % 100;
      const anchorX = 80 + phase * 6;
      const anchorY = 20 + phase * 2;
      if (computeBoxZoomDomain(LOG_TRANSFORM, anchorX, anchorY, anchorX + 120, anchorY + 90, AXIS_MASK_Y, LOG_CONSTRAINTS, out)) {
        acc += out.yMax;
      }
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  };
}

function makeClampRun(): () => void {
  const clampTarget = createMutableViewportDomain(1549, 1552, -50, 50);
  const logClampTarget = createMutableViewportDomain(1549, 1552, 1e-12, 1e12);
  return (): void => {
    let acc = 0;
    for (let i = 0; i < TICKS_PER_RUN; i += 1) {
      const phase = i % 100;
      clampTarget.xMin = 1549 + phase * 0.001;
      clampTarget.xMax = 1552;
      if (clampViewportDomain(clampTarget, Y_SCALE_KIND_LINEAR, CONSTRAINTS, (i & 1) === 0)) {
        acc += clampTarget.xMin;
      }
      logClampTarget.yMin = 1e-12 * (1 + phase);
      logClampTarget.yMax = 1e12;
      if (clampViewportDomain(logClampTarget, Y_SCALE_KIND_LOG, LOG_CONSTRAINTS, (i & 1) === 1)) {
        acc += logClampTarget.yMin;
      }
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  };
}

// Deliberately allocates one fresh domain record per tick, proving the instrument sees it.
function makeAllocatingControl(): () => void {
  const scratch = createMutableViewportDomain();
  const retained: MutableViewportDomain[] = [];
  return (): void => {
    for (let i = 0; i < TICKS_PER_RUN * 10; i += 1) {
      const anchorX = 80 + (i % 100) * 8;
      computeZoomDomain(LINEAR_TRANSFORM, 0.9, 0.9, anchorX, 150, AXIS_MASK_X, undefined, scratch);
      retained.push({ xMin: scratch.xMin, xMax: scratch.xMax, yMin: scratch.yMin, yMax: scratch.yMax });
    }
    retained.length = 0;
  };
}

const ADAPTER_CYCLES_PER_RUN = 100;
const ADAPTER_ITERATIONS = 10; // 10 * 100 = 1_000 cycles
const ADAPTER_WARMUP_RUNS = 100;

function makeStreamingRun(): () => void {
  const ring = createRawSampleRing(4096);
  const accumulator = createBucketAccumulator(256);
  const count = 3000;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    xs[i] = i * 0.0003;
    ys[i] = ((i * 7) % 13) - 6;
  }
  ingestBatch(ring, xs, ys, 0, count, accumulator);
  rebuildDomain(accumulator, ring, 0, 256 / 0.9);
  const tier3Target = {
    min: new Float32Array(256),
    max: new Float32Array(256),
    count: new Int32Array(256),
  };
  const payload = createSpectrumDataPayload({
    capacity: 512,
    xOrigin: 1550,
    xUnit: "nm",
    yUnit: "dBm",
  });
  const adapter = createStreamingInvalidationAdapter({
    ring,
    accumulator,
    tier3Target,
    payload,
    ringXOrigin: 1550,
  });
  let cycle = 0;
  let emittedTotal = 0;
  return (): void => {
    for (let i = 0; i < ADAPTER_CYCLES_PER_RUN; i += 1) {
      const width = 0.2 + (cycle % 7) * 0.05;
      const lo = 1550.05 + (cycle % 5) * 0.01;
      for (let g = 0; g < 3; g += 1) {
        emittedTotal += adapter.invalidate("gesture", lo + g * 0.001, lo + width + g * 0.001);
      }
      emittedTotal += adapter.invalidate("settled", lo, lo + width);
      cycle += 1;
    }
    if (emittedTotal < 0) throw new Error("unreachable");
  };
}

function makeWindowRun(): () => void {
  const sampleCount = 20_000;
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    x[i] = (i * 10) / (sampleCount - 1);
    y[i] = Math.sin(i * 0.01);
  }
  const sourcePayload = buildPayload({ x, y, xOrigin: 1550 });
  const port = createSyncDecimationPort({ poolPairs: 2 });
  const adapter = createWindowDecimationAdapter({
    sourcePayload,
    port,
    kind: DecimationKind.MinMaxEnvelope,
    bucketCount: 128,
  });
  let seq = 0;
  let acceptedTotal = 0;
  const onAccepted = (_lease: unknown, outCount: number): void => {
    acceptedTotal += outCount;
  };
  return (): void => {
    for (let i = 0; i < ADAPTER_CYCLES_PER_RUN; i += 1) {
      seq += 1;
      const lo = 1551 + (seq % 40) * 0.1;
      adapter.request(lo, lo + 0.5, seq);
      adapter.poll(onAccepted);
    }
    if (acceptedTotal < 0) throw new Error("unreachable");
  };
}

describe("allocation-gate: viewport interaction math & invalidation adapters", () => {
  beforeAll(async () => {
    const { count } = await measureGcEvents(makeAllocatingControl(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    if (count === 0) {
      throw new Error("allocating control reported 0 GC events; the instrument sees nothing.");
    }
  }, 120_000);

  it("the allocating control reports > 0 GC events", async () => {
    const { count } = await measureGcEvents(makeAllocatingControl(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count).toBeGreaterThan(0);
  }, 120_000);

  it("reports 0 GC events over 100_000 ticks of computeZoomDomain (linear)", async () => {
    const { count, kinds } = await measureGcEvents(makeLinearZoomRun(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 100_000 ticks of computeZoomDomain (log-Y)", async () => {
    const { count, kinds } = await measureGcEvents(makeLogZoomRun(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 100_000 ticks of computePanDomain (linear & log-Y)", async () => {
    const { count, kinds } = await measureGcEvents(makePanRun(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 100_000 ticks of computeBoxZoomDomain (linear)", async () => {
    const { count, kinds } = await measureGcEvents(makeLinearBoxZoomRun(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 100_000 ticks of computeBoxZoomDomain (log-Y)", async () => {
    const { count, kinds } = await measureGcEvents(makeLogBoxZoomRun(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 100_000 ticks of clampViewportDomain (linear & log-Y)", async () => {
    const { count, kinds } = await measureGcEvents(makeClampRun(), MATH_ITERATIONS, MATH_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 1_000 gesture + settled cycles of the streaming adapter", async () => {
    const run = makeStreamingRun();
    const { count, kinds } = await measureGcEvents(run, ADAPTER_ITERATIONS, ADAPTER_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);

  it("reports 0 GC events over 1_000 request/poll cycles of the window adapter", async () => {
    const run = makeWindowRun();
    const { count, kinds } = await measureGcEvents(run, ADAPTER_ITERATIONS, ADAPTER_WARMUP_RUNS);
    expect(count, kinds.join(", ")).toBe(0);
  }, 120_000);
});
