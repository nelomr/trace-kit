import {
  constants as perfConstants,
  type PerformanceEntry as NodePerformanceEntry,
  PerformanceObserver,
} from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createViewportTransform,
  projectX,
  projectY,
} from "../../src/viewport/transform.js";

// Mirrors packages/core/test/decimation/allocation-gate.test.ts's shape and rationale: the
// gate must not be able to skip itself.
describe("transform-allocation-gate", () => {
  it("exposes globalThis.gc under the forked pool's --expose-gc flag", () => {
    expect(typeof globalThis.gc).toBe("function");
  });
});

interface GcEntryDetail {
  kind?: number;
  flags?: number;
}

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

  for (let i = 0; i < 20; i += 1) run();

  globalThis.gc?.();
  await sleep(30);
  details.length = 0;

  for (let i = 0; i < iterations; i += 1) run();

  await sleep(30);
  observer.disconnect();

  return { count: details.length, details };
}

const POINT_COUNT = 100_000;

describe.sequential("allocation-gate — projectX/projectY", () => {
  const t = createViewportTransform({
    cssWidth: 800,
    cssHeight: 600,
    dpr: 2,
    insetLeft: 40,
    insetRight: 10,
    insetTop: 10,
    insetBottom: 30,
    xDomainMin: 0,
    xDomainMax: POINT_COUNT,
    yDomainMin: -1,
    yDomainMax: 1,
    xOrigin: 0,
  });

  function runAllocationFree(): void {
    let sinkX = 0;
    let sinkY = 0;
    for (let i = 0; i < POINT_COUNT; i += 1) {
      sinkX += projectX(t, i);
      sinkY += projectY(t, i % 2);
    }
    if (sinkX === Number.NaN || sinkY === Number.NaN) {
      throw new Error("unreachable");
    }
  }

  // Deliberately allocates one object per point, proving the instrument measures something.
  function runAllocatingControl(): void {
    const sink: { x: number; y: number }[] = [];
    for (let i = 0; i < POINT_COUNT; i += 1) {
      sink.push({ x: projectX(t, i), y: projectY(t, i % 2) });
    }
    sink.length = 0;
  }

  beforeAll(async () => {
    const { count } = await measureGcEvents(runAllocatingControl, 50);
    if (count === 0) {
      throw new Error(
        "allocating control reported 0 GC events; the instrument is not measuring anything.",
      );
    }
  }, 60_000);

  it("the allocating control reports > 0 GC events", async () => {
    const { count } = await measureGcEvents(runAllocatingControl, 50);
    expect(count).toBeGreaterThan(0);
  }, 60_000);

  it("projectX/projectY report exactly 0 GC events over 100,000 points", async () => {
    const { count, details } = await measureGcEvents(runAllocationFree, 50);
    expect(count, details.map((d) => kindName(d.kind)).join(", ")).toBe(0);
  }, 60_000);
});
