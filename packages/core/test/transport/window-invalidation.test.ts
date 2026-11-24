import { describe, expect, it } from "vitest";
import {
  createSpectrumDataPayload,
  type SpectrumDataPayload,
} from "../../src/payload/spectrum-data-payload.js";
import {
  DecimationKind,
  PortMode,
  type DecimationPort,
  type SettlementSink,
} from "../../src/transport/decimation-port.js";
import { SATURATED, type Lease, type Saturated } from "../../src/transport/ownership.js";
import {
  MAX_BUCKETS,
  createBucketAccumulator,
  createRawSampleRing,
  ingestBatch,
  rebuildDomain,
  type BucketAccumulator,
  type RawSampleRing,
  type Tier3ProjectionTarget,
} from "../../src/transport/streaming-contract.js";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import {
  createStreamingInvalidationAdapter,
  createWindowDecimationAdapter,
  type StreamingInvalidationAdapterOptions,
} from "../../src/transport/window-invalidation.js";
import { buildPayload } from "../support/payload-builder.js";

function makeTier3Target(length: number): Tier3ProjectionTarget {
  return {
    min: new Float32Array(length),
    max: new Float32Array(length),
    count: new Int32Array(length),
  };
}

function makeOutputPayload(capacity: number, xOrigin: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity,
    xOrigin,
    xUnit: "nm",
    yUnit: "dBm",
  });
  return payload;
}

interface StreamingFixture {
  readonly ring: RawSampleRing;
  readonly accumulator: BucketAccumulator;
  readonly tier3Target: Tier3ProjectionTarget;
  readonly payload: SpectrumDataPayload;
  readonly options: StreamingInvalidationAdapterOptions;
}

/**
 * Ring of `count` samples at offsets `i * step` (ring origin `origin`), accumulator seeded over
 * offset domain `[domainMin, domainMin + width)` so `accumulator.revision === 1`.
 */
function makeStreamingFixture(
  origin: number,
  count: number,
  step: number,
  domainMin: number,
  width: number,
  bucketCount: number,
): StreamingFixture {
  const ring = createRawSampleRing(4096);
  const accumulator = createBucketAccumulator(bucketCount);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    xs[i] = i * step;
    ys[i] = ((i * 7) % 13) - 6;
  }
  ingestBatch(ring, xs, ys, 0, count, accumulator);
  rebuildDomain(accumulator, ring, domainMin, bucketCount / width);
  const tier3Target = makeTier3Target(bucketCount);
  const payload = makeOutputPayload(bucketCount * 2, origin);
  return {
    ring,
    accumulator,
    tier3Target,
    payload,
    options: { ring, accumulator, tier3Target, payload, ringXOrigin: origin },
  };
}

describe("createStreamingInvalidationAdapter — factory validation", () => {
  const fixture = makeStreamingFixture(1550, 1000, 0.001, 0, 1, 64);

  it("throws RangeError on a non-finite ringXOrigin", () => {
    expect(() =>
      createStreamingInvalidationAdapter({ ...fixture.options, ringXOrigin: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      createStreamingInvalidationAdapter({
        ...fixture.options,
        ringXOrigin: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError on an invalid targetBucketCount", () => {
    for (const targetBucketCount of [0, -4, 1.5, Number.NaN, MAX_BUCKETS + 1]) {
      expect(() =>
        createStreamingInvalidationAdapter({ ...fixture.options, targetBucketCount }),
      ).toThrow(RangeError);
    }
  });

  it("throws RangeError on an undersized tier3Target", () => {
    expect(() =>
      createStreamingInvalidationAdapter({
        ...fixture.options,
        tier3Target: makeTier3Target(32),
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError on an undersized payload capacity", () => {
    expect(() =>
      createStreamingInvalidationAdapter({
        ...fixture.options,
        payload: makeOutputPayload(100, 1550),
      }),
    ).toThrow(RangeError);
  });

  it("defaults ringXOrigin to payload.xOrigin and targetBucketCount to accumulator.bucketCount", () => {
    const adapter = createStreamingInvalidationAdapter({
      ring: fixture.ring,
      accumulator: fixture.accumulator,
      tier3Target: fixture.tier3Target,
      payload: fixture.payload,
    });
    expect(adapter.lastTier).toBe(0);
    expect(adapter.lastVertexCount).toBe(0);
  });
});

describe("createStreamingInvalidationAdapter — invalidate", () => {
  it("gesture phase reports Tier 3, keeps accumulator.revision, and bumps payload.revision", () => {
    const f = makeStreamingFixture(1550, 1000, 0.001, 0, 1, 64);
    const adapter = createStreamingInvalidationAdapter(f.options);
    expect(f.accumulator.revision).toBe(1);
    const startRevision = f.payload.revision;
    for (let i = 0; i < 5; i += 1) {
      const emitted = adapter.invalidate("gesture", 1550.2, 1550.6);
      expect(adapter.lastTier).toBe(3);
      expect(adapter.lastVertexCount).toBe(emitted);
      expect(emitted).toBeGreaterThan(0);
      expect(emitted).toBeLessThanOrEqual(128);
    }
    expect(f.accumulator.revision).toBe(1);
    expect(f.payload.revision).toBe(startRevision + 5);
  });

  it("gesture vertices are bounded envelopes inside the requested window", () => {
    const f = makeStreamingFixture(1550, 1000, 0.001, 0, 1, 64);
    const adapter = createStreamingInvalidationAdapter(f.options);
    const emitted = adapter.invalidate("gesture", 1550.2, 1550.6);
    const firstX = f.payload.xOrigin + (f.payload.x[0] as number);
    const lastX = f.payload.xOrigin + (f.payload.x[emitted - 1] as number);
    expect(firstX).toBeGreaterThanOrEqual(1550.2);
    expect(lastX).toBeLessThanOrEqual(1550.6);
    for (let i = 0; i < emitted; i += 1) {
      const y = f.payload.y[i] as number;
      expect(Number.isNaN(y) || (y >= -6 && y <= 6)).toBe(true);
    }
  });

  it("trailing settled call resolves Tier 1 or 2, bumps accumulator.revision, and materializes the window", () => {
    const f = makeStreamingFixture(1550, 1000, 0.001, 0, 1, 64);
    const adapter = createStreamingInvalidationAdapter(f.options);
    for (let i = 0; i < 5; i += 1) adapter.invalidate("gesture", 1550.2, 1550.6);
    const payloadRevision = f.payload.revision;
    const emitted = adapter.invalidate("settled", 1550.2, 1550.6);
    expect([1, 2]).toContain(adapter.lastTier);
    expect(f.accumulator.revision).toBe(2);
    expect(f.payload.revision).toBe(payloadRevision + 1);
    expect(adapter.lastVertexCount).toBe(emitted);
    expect(emitted).toBeGreaterThanOrEqual(64);
    const firstX = f.payload.xOrigin + (f.payload.x[0] as number);
    const lastX = f.payload.xOrigin + (f.payload.x[emitted - 1] as number);
    expect(firstX).toBeGreaterThanOrEqual(1550.2);
    expect(lastX).toBeLessThanOrEqual(1550.6 + 1e-9);
    // Full-resolution buckets: ~400 samples spread across 64 buckets are populated.
    let populated = 0;
    for (let i = 0; i < f.accumulator.bucketCount; i += 1) {
      if ((f.accumulator.count[i] as number) > 0) populated += 1;
    }
    expect(populated).toBe(64);
  });

  it("an exact aligned settled pan selects Tier 1", () => {
    // 64 buckets over 16 offset units -> invBucketWidth 4; a 1-unit pan is exactly 4 buckets.
    const f = makeStreamingFixture(0, 2000, 0.01, 0, 16, 64);
    const adapter = createStreamingInvalidationAdapter(f.options);
    adapter.invalidate("settled", 0, 16);
    // Zero shift selects no rotation: the identical window is a Tier-2 rebuild.
    expect(adapter.lastTier).toBe(2);
    expect(f.accumulator.revision).toBe(2);
    adapter.invalidate("settled", 1, 17);
    expect(adapter.lastTier).toBe(1);
    expect(f.accumulator.revision).toBe(3);
  });

  it("non-finite or zero-span bounds return 0 without mutating anything", () => {
    const f = makeStreamingFixture(1550, 1000, 0.001, 0, 1, 64);
    const adapter = createStreamingInvalidationAdapter(f.options);
    const payloadRevision = f.payload.revision;
    for (const phase of ["gesture", "settled"] as const) {
      expect(adapter.invalidate(phase, Number.NaN, 1551)).toBe(0);
      expect(adapter.invalidate(phase, 1550, Number.POSITIVE_INFINITY)).toBe(0);
      expect(adapter.invalidate(phase, 1550.5, 1550.5)).toBe(0);
      expect(adapter.invalidate(phase, 1551, 1550)).toBe(0);
    }
    expect(f.accumulator.revision).toBe(1);
    expect(f.payload.revision).toBe(payloadRevision);
  });
});

describe("createWindowDecimationAdapter — factory validation", () => {
  const sourcePayload = buildPayload({ x: new Float32Array([0, 1, 2, 3]), xOrigin: 0 });

  it("throws RangeError on bucketCount < 1 or non-integer", () => {
    const port = createSyncDecimationPort();
    for (const bucketCount of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        createWindowDecimationAdapter({
          sourcePayload,
          port,
          kind: DecimationKind.MinMaxEnvelope,
          bucketCount,
        }),
      ).toThrow(RangeError);
    }
    port.dispose();
  });

  it("requires bucketCount >= 2 for DecimationKind.Lttb", () => {
    const port = createSyncDecimationPort();
    expect(() =>
      createWindowDecimationAdapter({
        sourcePayload,
        port,
        kind: DecimationKind.Lttb,
        bucketCount: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createWindowDecimationAdapter({
        sourcePayload,
        port,
        kind: DecimationKind.MinMaxEnvelope,
        bucketCount: 1,
      }),
    ).not.toThrow();
    port.dispose();
  });
});

function makeDenseSource(sampleCount: number): SpectrumDataPayload {
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    x[i] = (i * 10) / (sampleCount - 1);
    y[i] = Math.sin(i * 0.01);
  }
  return buildPayload({ x, y, xOrigin: 1550 });
}

describe("createWindowDecimationAdapter — windowed slicing", () => {
  it("copies only the visible windowed slice of a 100,000-sample source and settles once", () => {
    const sourcePayload = makeDenseSource(100_000);
    const port = createSyncDecimationPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload,
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 64,
    });
    expect(adapter.request(1555.0, 1555.1, 1)).toBe(true);
    expect(adapter.inFlight).toBe(true);
    expect(adapter.activeSeq).toBe(1);
    expect(adapter.latestRequestedSeq).toBe(1);

    const accepted: Array<{ outCount: number; seq: number }> = [];
    const drained = adapter.poll((lease, outCount, seq) => {
      accepted.push({ outCount, seq });
      const out = port.viewOut(lease);
      let finite = 0;
      for (let i = 0; i < outCount; i += 1) {
        if (Number.isFinite(out[i])) finite += 1;
      }
      expect(finite).toBe(outCount);
    });
    expect(drained).toBe(1);
    expect(accepted).toEqual([{ outCount: 128, seq: 1 }]);
    expect(adapter.inFlight).toBe(false);
    expect(adapter.lastWindowSampleCount).toBeGreaterThanOrEqual(1000);
    expect(adapter.lastWindowSampleCount).toBeLessThan(1100);
    expect(adapter.lastWindowSampleCount).not.toBe(100_000);
    expect(adapter.droppedStaleCount).toBe(0);
    port.dispose();
  });

  it("supports LTTB with indices output over the window", () => {
    const sourcePayload = makeDenseSource(10_000);
    const port = createSyncDecimationPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload,
      port,
      kind: DecimationKind.Lttb,
      bucketCount: 100,
    });
    expect(adapter.request(1552, 1553, 1)).toBe(true);
    let outCount = -1;
    adapter.poll((_lease, count) => {
      outCount = count;
    });
    expect(outCount).toBe(100);
    port.dispose();
  });

  it("rejects invalid request bounds without submitting", () => {
    const sourcePayload = makeDenseSource(1000);
    const port = createSyncDecimationPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload,
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 16,
    });
    expect(adapter.request(Number.NaN, 1552, 1)).toBe(false);
    expect(adapter.request(1552, Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(adapter.request(1553, 1552, 1)).toBe(false);
    expect(adapter.request(1552, 1552, 1)).toBe(false);
    expect(adapter.inFlight).toBe(false);
    expect(adapter.poll(() => undefined)).toBe(0);
    port.dispose();
  });
});

describe("createWindowDecimationAdapter — deep-zoom kernel safety", () => {
  it("clamps effectiveBuckets to the window sample count and does not throw", () => {
    const sourcePayload = buildPayload({
      x: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      xOrigin: 100,
    });
    const port = createSyncDecimationPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload,
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 64,
      includeNeighbours: false,
    });
    expect(adapter.request(102, 104, 1)).toBe(true);
    expect(adapter.lastWindowSampleCount).toBe(3);
    let outCount = -1;
    adapter.poll((_lease, count) => {
      outCount = count;
    });
    expect(outCount).toBe(6);
    port.dispose();
  });

  it("LTTB on an empty or 1-sample window releases the lease and returns false", () => {
    const sourcePayload = buildPayload({
      x: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      xOrigin: 100,
    });
    const port = createSyncDecimationPort({ poolPairs: 1 });
    const adapter = createWindowDecimationAdapter({
      sourcePayload,
      port,
      kind: DecimationKind.Lttb,
      bucketCount: 32,
      includeNeighbours: false,
    });
    // Empty window (between samples, neighbours disabled).
    expect(() => adapter.request(102.25, 102.75, 1)).not.toThrow();
    expect(adapter.lastWindowSampleCount).toBe(0);
    expect(adapter.inFlight).toBe(false);
    // 1-sample window.
    expect(adapter.request(103, 103.5, 2)).toBe(false);
    expect(adapter.lastWindowSampleCount).toBe(1);
    expect(adapter.inFlight).toBe(false);
    const probe = port.acquire();
    expect(probe).not.toBe(SATURATED);
    if (probe !== SATURATED) port.release(probe);
    // The adapter is still usable afterwards.
    expect(adapter.request(102, 106, 3)).toBe(true);
    port.dispose();
  });

  it("MinMax on an empty window also releases the lease and returns false", () => {
    const sourcePayload = buildPayload({ x: new Float32Array([0, 1, 2]), xOrigin: 0 });
    const port = createSyncDecimationPort({ poolPairs: 1 });
    const adapter = createWindowDecimationAdapter({
      sourcePayload,
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 8,
      includeNeighbours: false,
    });
    expect(adapter.request(50, 60, 1)).toBe(false);
    const probe = port.acquire();
    expect(probe).not.toBe(SATURATED);
    if (probe !== SATURATED) port.release(probe);
    port.dispose();
  });
});

/**
 * Minimal single-slot asynchronous `DecimationPort` stub: `submit` never settles on its own;
 * the test calls `settle()` to move the in-flight lease to the settled queue.
 */
interface StubPort extends DecimationPort {
  readonly submitted: Array<{ min: number; max: number }>;
  readonly released: number[];
  settle(outCount: number): void;
}

const STUB_LEASE = 1;

function createStubPort(): StubPort {
  const x = new Float32Array(4096);
  const y = new Float32Array(4096);
  const out = new Float32Array(MAX_BUCKETS * 2);
  const indices = new Int32Array(MAX_BUCKETS * 2);
  const submitted: Array<{ min: number; max: number }> = [];
  const released: number[] = [];
  let domainMin = 0;
  let domainMax = 0;
  let slot: "free" | "acquired" | "inflight" | "settled" = "free";
  let settledOutCount = 0;

  const port: StubPort = {
    mode: PortMode.Asynchronous,
    poolPairs: 1,
    transitCapacitySamples: 4096,
    submitted,
    released,
    setKind() {},
    setSampleCount() {},
    setBucketCount() {},
    setDomain(_lease, min, max) {
      domainMin = min;
      domainMax = max;
    },
    acquire(): Lease<"acquired"> | Saturated {
      if (slot !== "free") return SATURATED;
      slot = "acquired";
      return STUB_LEASE as Lease<"acquired">;
    },
    viewX: () => x,
    viewY: () => y,
    viewOut: () => out,
    viewIndices: () => indices,
    submit(): Lease<"inflight"> | Saturated {
      slot = "inflight";
      submitted.push({ min: domainMin, max: domainMax });
      return STUB_LEASE as Lease<"inflight">;
    },
    poll(sink: SettlementSink): number {
      if (slot !== "settled") return 0;
      slot = "inflight"; // owned by the sink until it releases
      sink.onSettled(STUB_LEASE as Lease<"settled">, settledOutCount);
      return 1;
    },
    release() {
      released.push(STUB_LEASE);
      slot = "free";
    },
    reportResponderFailure() {},
    noteDroppedSamples() {},
    readStats() {},
    dispose() {},
    settle(outCount: number) {
      slot = "settled";
      settledOutCount = outCount;
    },
  };
  return port;
}

function makeLinearSource(): SpectrumDataPayload {
  const x = new Float32Array(101);
  for (let i = 0; i <= 100; i += 1) x[i] = i;
  return buildPayload({ x, xOrigin: 0 });
}

describe("createWindowDecimationAdapter — latest-wins superseding", () => {
  it("drops a stale settlement and automatically submits the newest pending window", () => {
    const port = createStubPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload: makeLinearSource(),
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 8,
      includeNeighbours: false,
    });

    expect(adapter.request(0, 100, 1)).toBe(true);
    expect(adapter.request(10, 90, 2)).toBe(false);
    expect(adapter.hasPending).toBe(true);
    expect(adapter.request(40, 60, 3)).toBe(false);
    expect(adapter.latestRequestedSeq).toBe(3);
    expect(port.submitted).toEqual([{ min: 0, max: 100 }]);

    port.settle(16);
    const acceptedSeqs: number[] = [];
    adapter.poll((_lease, _count, seq) => {
      acceptedSeqs.push(seq);
    });
    expect(acceptedSeqs).toEqual([]);
    expect(adapter.droppedStaleCount).toBe(1);
    expect(port.released).toHaveLength(1);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.inFlight).toBe(true);
    expect(adapter.activeSeq).toBe(3);
    expect(port.submitted).toEqual([
      { min: 0, max: 100 },
      { min: 40, max: 60 },
    ]);

    port.settle(16);
    adapter.poll((_lease, count, seq) => {
      acceptedSeqs.push(seq);
      expect(count).toBe(16);
    });
    expect(acceptedSeqs).toEqual([3]);
    expect(port.released).toHaveLength(2);
    expect(adapter.inFlight).toBe(false);
  });

  it("a saturated port stashes the request and retries it on the next poll", () => {
    const port = createStubPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload: makeLinearSource(),
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 8,
      includeNeighbours: false,
    });
    const held = port.acquire();
    expect(held).not.toBe(SATURATED);
    expect(adapter.request(10, 20, 1)).toBe(false);
    expect(adapter.hasPending).toBe(true);
    expect(adapter.inFlight).toBe(false);
    if (held !== SATURATED) port.release(held);
    adapter.poll(() => undefined);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.inFlight).toBe(true);
    expect(port.submitted).toEqual([{ min: 10, max: 20 }]);
  });

  it("supersedes a SATURATED pending window when a newer request submits directly", () => {
    const port = createStubPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload: makeLinearSource(),
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 8,
      includeNeighbours: false,
    });
    const held = port.acquire();
    expect(held).not.toBe(SATURATED);
    // Saturated request stashes seq 1 while inFlight is false.
    expect(adapter.request(0, 100, 1)).toBe(false);
    expect(adapter.hasPending).toBe(true);
    expect(adapter.inFlight).toBe(false);

    // Port frees up and a newer request (seq 2) submits directly.
    if (held !== SATURATED) port.release(held);
    expect(adapter.request(20, 40, 2)).toBe(true);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.inFlight).toBe(true);
    expect(adapter.activeSeq).toBe(2);
    expect(port.submitted).toEqual([{ min: 20, max: 40 }]);

    // Settling seq 2 must accept seq 2 and NEVER resurrect superseded seq 1.
    port.settle(16);
    const acceptedSeqs: number[] = [];
    adapter.poll((_lease, _count, seq) => {
      acceptedSeqs.push(seq);
    });
    expect(acceptedSeqs).toEqual([2]);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.inFlight).toBe(false);
    expect(port.submitted).toEqual([{ min: 20, max: 40 }]);
  });

  it("supersedes a SATURATED pending window when a newer request skips due to insufficient samples", () => {
    const port = createStubPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload: makeLinearSource(),
      port,
      kind: DecimationKind.Lttb,
      bucketCount: 8,
      includeNeighbours: false,
    });
    const held = port.acquire();
    expect(held).not.toBe(SATURATED);
    expect(adapter.request(0, 100, 1)).toBe(false);
    expect(adapter.hasPending).toBe(true);

    // Port frees up; newer request covers an empty window (between integer samples 50 and 51).
    if (held !== SATURATED) port.release(held);
    expect(adapter.request(50.2, 50.8, 2)).toBe(false);
    expect(adapter.lastWindowSampleCount).toBe(0);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.inFlight).toBe(false);

    // Subsequent poll must NOT resurrect stale seq 1.
    adapter.poll(() => undefined);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.inFlight).toBe(false);
    expect(port.submitted).toEqual([]);
  });
});

describe("createWindowDecimationAdapter — exception safety & disposal", () => {
  it("releases the lease even when onAccepted throws, and stays usable", () => {
    const port = createStubPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload: makeLinearSource(),
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 8,
      includeNeighbours: false,
    });
    expect(adapter.request(0, 100, 1)).toBe(true);
    port.settle(16);
    expect(() =>
      adapter.poll(() => {
        throw new Error("consumer failure");
      }),
    ).toThrow("consumer failure");
    expect(port.released).toHaveLength(1);
    expect(adapter.inFlight).toBe(false);
    expect(adapter.request(10, 20, 2)).toBe(true);
  });

  it("dispose is idempotent, clears the pending slot and blocks further requests", () => {
    const port = createStubPort();
    const adapter = createWindowDecimationAdapter({
      sourcePayload: makeLinearSource(),
      port,
      kind: DecimationKind.MinMaxEnvelope,
      bucketCount: 8,
      includeNeighbours: false,
    });
    expect(adapter.request(0, 100, 1)).toBe(true);
    expect(adapter.request(10, 20, 2)).toBe(false);
    expect(adapter.hasPending).toBe(true);
    adapter.dispose();
    adapter.dispose();
    expect(adapter.disposed).toBe(true);
    expect(adapter.hasPending).toBe(false);
    expect(adapter.request(30, 40, 3)).toBe(false);
    expect(port.submitted).toHaveLength(1);

    // A settlement arriving after dispose releases the lease and never reaches the consumer.
    port.settle(16);
    let called = false;
    adapter.poll(() => {
      called = true;
    });
    expect(called).toBe(false);
    expect(port.released).toHaveLength(1);
    expect(port.submitted).toHaveLength(1);
  });
});
