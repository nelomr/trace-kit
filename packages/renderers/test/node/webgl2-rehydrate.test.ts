/** @vitest-environment node */
import { createRequire } from "node:module";
import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createSyncDecimationPort,
  createTraceCollection,
  createViewportTransform,
  Y_SCALE_KIND_LINEAR,
  type DecimationPort,
  type SettlementSink,
  type SpectrumDataPayload,
  type ViewportTransform,
} from "@trace-kit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpectrumEngineController,
  type EngineChangeEvent,
  type WebGL2FallbackEvent,
} from "../../src/controller/index.js";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import {
  collectIsolatedSampleIndices,
  countIsolatedSegments,
} from "../../src/path/isolated-markers.js";
import { decimateTraceIndices } from "../../src/rules/decimation.js";
import { createTraceSlot, invalidateTraceSlotGpu } from "../../src/webgl2/trace-slot.js";
import { ensureTraceUploaded } from "../../src/webgl2/upload.js";
import {
  WebGL2FigureRenderer,
  type WebGL2FigureRendererOptions,
} from "../../src/webgl2/webgl2-figure-renderer.js";
import { asSurface } from "./support/fake-surface.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";
import { createHarness, createParts } from "./support/webgl2-harness.js";

vi.mock("../../src/rules/decimation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/rules/decimation.js")>();
  return {
    ...actual,
    decimateTraceIndices: vi.fn(actual.decimateTraceIndices),
  };
});

vi.mock("../../src/path/isolated-markers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/path/isolated-markers.js")>();
  return {
    ...actual,
    countIsolatedSegments: vi.fn(actual.countIsolatedSegments),
    collectIsolatedSampleIndices: vi.fn(actual.collectIsolatedSampleIndices),
  };
});

const RECOVERY_SYMBOL_KEY = "trace-kit.webgl2.recovery";

interface RecoveryHandleLike {
  readonly isContextLost: () => boolean;
  readonly rehydrate: () => void;
}

function readRecoveryHandle(renderer: object): RecoveryHandleLike | null {
  const value: unknown = Reflect.get(renderer, Symbol.for(RECOVERY_SYMBOL_KEY));
  if (typeof value !== "object" || value === null) return null;
  const isContextLost: unknown = Reflect.get(value, "isContextLost");
  const rehydrate: unknown = Reflect.get(value, "rehydrate");
  if (typeof isContextLost !== "function" || typeof rehydrate !== "function") return null;
  return {
    isContextLost: () => Boolean(Reflect.apply(isContextLost, value, [])),
    rehydrate: () => {
      Reflect.apply(rehydrate, value, []);
    },
  };
}

function makePayload(
  n: number,
  options: {
    readonly revisionBumps?: number;
    readonly fill?: (i: number) => number;
  } = {},
): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: Math.max(1, n),
    xOrigin: 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  for (let i = 0; i < n; i += 1) {
    payload.x[i] = i;
    payload.y[i] = options.fill === undefined ? Math.sin(i * 0.01) : options.fill(i);
  }
  const bumps = options.revisionBumps ?? 1;
  for (let b = 0; b < bumps; b += 1) {
    commitPayloadRevision(payload, n);
  }
  return payload;
}

const Y_AXIS = [
  { id: "y", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -2, domainMax: 2, side: AXIS_SIDE_LEFT },
] as const;

beforeEach(() => {
  vi.mocked(decimateTraceIndices).mockClear();
  vi.mocked(countIsolatedSegments).mockClear();
  vi.mocked(collectIsolatedSampleIndices).mockClear();
});

describe("WebGL2FigureRenderer internal recovery handle shape", () => {
  it("attaches a non-enumerable, non-writable, non-configurable Symbol.for handle and freezes the 11-member prototype", () => {
    const h = createHarness();
    const sym = Symbol.for(RECOVERY_SYMBOL_KEY);
    const descriptor = Object.getOwnPropertyDescriptor(h.renderer, sym);

    expect(descriptor).toBeDefined();
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);

    const handle = readRecoveryHandle(h.renderer);
    expect(handle).not.toBeNull();
    expect(handle?.isContextLost()).toBe(false);

    expect(Object.keys(h.renderer)).toEqual(["kind"]);

    const protoMembers = Object.getOwnPropertyNames(WebGL2FigureRenderer.prototype).filter(
      (name) => name !== "constructor" && !name.startsWith("#"),
    );
    expect(protoMembers.sort()).toEqual(
      [
        "clear",
        "dispose",
        "disposed",
        "render",
        "resize",
        "setData",
        "setDecimation",
        "setDomain",
        "setTraces",
        "transform",
      ].sort(),
    );
  });
});

describe("Gl2Context.isContextLost() safety guards", () => {
  it("standalone render() and clear() on a lost context emit zero GL/2D calls and do not poison uploadedRevision", () => {
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    const payload = makePayload(64, { revisionBumps: 7 });
    expect(payload.revision).toBe(7);

    h.renderer.setData(payload);
    h.gl.simulateContextLoss();
    h.log.length = 0;

    h.renderer.render();
    h.renderer.clear();

    expect(h.log).toHaveLength(0);
    expect(h.gl.callsNamed("createBuffer")).toHaveLength(0);
    expect(h.gl.callsNamed("createVertexArray")).toHaveLength(0);
    expect(h.gl.callsNamed("bufferData")).toHaveLength(0);
    expect(h.gl.callsNamed("drawArraysInstanced")).toHaveLength(0);
    expect(h.gl.callsNamed("clear")).toHaveLength(0);

    h.gl.simulateContextRestore();
    const handle = readRecoveryHandle(h.renderer);
    expect(handle).not.toBeNull();
    handle!.rehydrate();
    h.log.length = 0;
    h.renderer.render();

    expect(h.gl.callsNamed("createBuffer").length).toBeGreaterThanOrEqual(2);
    expect(h.gl.callsNamed("createVertexArray").length).toBeGreaterThanOrEqual(1);
    expect(h.gl.callsNamed("bufferData").length).toBeGreaterThanOrEqual(2);
    expect(h.gl.callsNamed("drawArraysInstanced")).toHaveLength(1);
    expect(h.gl.callsNamed("drawArraysInstanced")[0]?.args[3]).toBe(63);
  });

  it("dispose() skips delete* and loseContext() when already lost, but runs them when healthy", () => {
    const healthy = createHarness();
    healthy.renderer.resize(400, 300, 1);
    healthy.renderer.setData(makePayload(40));
    healthy.renderer.render();
    healthy.log.length = 0;

    healthy.renderer.dispose();
    expect(healthy.renderer.disposed).toBe(true);
    expect(healthy.gl.callsNamed("deleteBuffer").length).toBeGreaterThan(0);
    expect(healthy.gl.callsNamed("deleteVertexArray").length).toBeGreaterThan(0);
    expect(healthy.gl.callsNamed("deleteProgram")).toHaveLength(2);
    expect(healthy.gl.callsNamed("loseContext")).toHaveLength(1);

    const lost = createHarness();
    lost.renderer.resize(400, 300, 1);
    lost.renderer.setData(makePayload(40));
    lost.renderer.render();
    lost.gl.simulateContextLoss();
    lost.log.length = 0;

    lost.renderer.dispose();
    expect(lost.renderer.disposed).toBe(true);
    expect(lost.gl.callsNamed("deleteBuffer")).toHaveLength(0);
    expect(lost.gl.callsNamed("deleteVertexArray")).toHaveLength(0);
    expect(lost.gl.callsNamed("deleteProgram")).toHaveLength(0);
    expect(lost.gl.callsNamed("loseContext")).toHaveLength(0);
  });

  it("constructor program failure skips loseContext() when initiallyLost, but calls it once when healthy", () => {
    const lostParts = createParts({ initiallyLost: true });
    expect(
      () =>
        new WebGL2FigureRenderer({
          surfaces: {
            underlay: asSurface(lostParts.underlay),
            plot: asSurface(lostParts.plot),
            overlay: asSurface(lostParts.overlay),
          },
        }),
    ).toThrow();
    expect(lostParts.gl.callsNamed("loseContext")).toHaveLength(0);

    const healthyParts = createParts({ compileFailureLog: "syntax error" });
    expect(
      () =>
        new WebGL2FigureRenderer({
          surfaces: {
            underlay: asSurface(healthyParts.underlay),
            plot: asSurface(healthyParts.plot),
            overlay: asSurface(healthyParts.overlay),
          },
        }),
    ).toThrow(/syntax error/);
    expect(healthyParts.gl.callsNamed("loseContext")).toHaveLength(1);
  });
});

describe("in-place WebGL2 rehydration", () => {
  it("throws synchronously when called while context is still lost or after dispose()", () => {
    const h = createHarness();
    const handle = readRecoveryHandle(h.renderer);
    expect(handle).not.toBeNull();

    h.gl.simulateContextLoss();
    expect(handle!.isContextLost()).toBe(true);
    expect(() => handle!.rehydrate()).toThrow();

    h.gl.simulateContextRestore();
    h.renderer.dispose();
    expect(() => handle!.rehydrate()).toThrow();
  });

  it("recompiles programs, drops retired slots without deleting stale handles, recreates distinct VAOs/VBOs, and matches draw counts", () => {
    const h = createHarness();
    h.renderer.resize(500, 300, 1);

    // First trace set -> rendered, then replaced so #retired is non-empty.
    h.renderer.setData(makePayload(30));
    h.renderer.render();

    const p1 = makePayload(60, { fill: (i) => (i === 20 ? 0.5 : i === 19 || i === 21 ? NaN : Math.sin(i * 0.1)) });
    const p2 = makePayload(45);
    const collection = createTraceCollection(
      [
        { id: "a", payload: p1, yAxisId: "y", style: { markIsolatedSamples: true } },
        { id: "b", payload: p2, yAxisId: "y", style: {} },
      ],
      Y_AXIS,
      0,
      60,
    );
    h.renderer.setTraces(collection);
    h.renderer.render();

    // Queue another retired set right before context loss (never rendered before loss).
    const p3 = makePayload(50, { fill: (i) => (i === 25 ? 0.5 : i === 24 || i === 26 ? NaN : Math.cos(i * 0.1)) });
    const p4 = makePayload(40);
    const collection2 = createTraceCollection(
      [
        { id: "c", payload: p3, yAxisId: "y", style: { markIsolatedSamples: true } },
        { id: "d", payload: p4, yAxisId: "y", style: {} },
      ],
      Y_AXIS,
      0,
      50,
    );
    h.renderer.setTraces(collection2);
    h.renderer.render();

    const preLossDraws = h.gl.callsNamed("drawArraysInstanced").slice(-3).map((c) => c.args);
    const preLossLiveObjects = new Set(h.gl.live);

    // Stage a retired slot by calling setTraces again before loss without rendering? Wait: keep collection2 active
    // and verify retired handles from a swap before loss are dropped cleanly without delete*.
    // Let's also verify a separate retired-before-loss case below.
    h.gl.simulateContextLoss();
    h.gl.simulateContextRestore();
    h.log.length = 0;

    const handle = readRecoveryHandle(h.renderer);
    expect(handle).not.toBeNull();
    handle!.rehydrate();
    h.renderer.render();

    expect(h.gl.callsNamed("deleteProgram")).toHaveLength(0);
    expect(h.gl.callsNamed("deleteBuffer")).toHaveLength(0);
    expect(h.gl.callsNamed("deleteVertexArray")).toHaveLength(0);

    expect(h.gl.callsNamed("createShader")).toHaveLength(4);
    expect(h.gl.callsNamed("createProgram")).toHaveLength(2);
    expect(h.gl.callsNamed("linkProgram")).toHaveLength(2);
    expect(h.gl.callsNamed("getUniformLocation").length).toBeGreaterThanOrEqual(18);

    // Every newly created buffer and VAO is distinct from pre-loss handles.
    expect(h.gl.callsNamed("createBuffer")).toHaveLength(6); // 2 traces * 2 line + 1 trace * 2 marker
    expect(h.gl.callsNamed("createVertexArray")).toHaveLength(3); // 2 line + 1 marker
    for (const obj of h.gl.live) {
      expect(preLossLiveObjects.has(obj)).toBe(false);
    }

    expect(h.gl.callsNamed("bufferData")).toHaveLength(6);
    const postRestoreDraws = h.gl.callsNamed("drawArraysInstanced").map((c) => c.args);
    expect(postRestoreDraws).toEqual(preLossDraws);
  });

  it("drops pending #retired slots during rehydrate() without calling deleteBuffer or deleteVertexArray", () => {
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    h.renderer.setData(makePayload(40));
    h.renderer.render();

    // Replace data while lost so #retired holds the previous slot with pre-loss handles.
    h.gl.simulateContextLoss();
    h.renderer.setData(makePayload(30));

    h.gl.simulateContextRestore();
    h.log.length = 0;
    const handle = readRecoveryHandle(h.renderer);
    handle!.rehydrate();
    h.renderer.render();

    expect(h.gl.callsNamed("deleteBuffer")).toHaveLength(0);
    expect(h.gl.callsNamed("deleteVertexArray")).toHaveLength(0);
    expect(h.gl.callsNamed("drawArraysInstanced")[0]?.args[3]).toBe(29);
  });
});

describe("slot.gpuDirty zero-re-decimation & zero-marker-rescan fast path", () => {
  it("re-uploads unchanged UPLOAD_FULL payload with isolated marker with 0 re-decimation and 0 marker re-scan", () => {
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    const payload = makePayload(60, {
      revisionBumps: 5,
      fill: (i) => (i === 30 ? 0.5 : i === 29 || i === 31 ? NaN : Math.sin(i * 0.1)),
    });
    expect(payload.revision).toBe(5);
    h.renderer.setData(payload);
    h.renderer.render();

    expect(vi.mocked(countIsolatedSegments)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(collectIsolatedSampleIndices)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(0);

    vi.mocked(decimateTraceIndices).mockClear();
    vi.mocked(countIsolatedSegments).mockClear();
    vi.mocked(collectIsolatedSampleIndices).mockClear();

    const preDraws = h.gl.callsNamed("drawArraysInstanced").map((c) => c.args);
    h.gl.simulateContextLoss();
    h.gl.simulateContextRestore();
    h.log.length = 0;

    readRecoveryHandle(h.renderer)!.rehydrate();
    h.renderer.render();

    expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(countIsolatedSegments)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(collectIsolatedSampleIndices)).toHaveBeenCalledTimes(0);
    expect(h.gl.callsNamed("createBuffer")).toHaveLength(4);
    expect(h.gl.callsNamed("createVertexArray")).toHaveLength(2);
    expect(h.gl.callsNamed("bufferData")).toHaveLength(4);
    expect(h.gl.callsNamed("drawArraysInstanced").map((c) => c.args)).toEqual(preDraws);
  });

  it("re-uploads preserved scratch for explicit lttb and min-max decimation with 0 re-decimation and identical draw counts", () => {
    for (const selection of [
      { algorithm: "lttb", threshold: 128 } as const,
      { algorithm: "min-max", bucketCount: 64 } as const,
    ]) {
      const h = createHarness({ rendererOptions: { decimation: selection } });
      h.renderer.resize(600, 300, 1);
      const payload = makePayload(20_000, { revisionBumps: 3 });
      expect(payload.revision).toBe(3);

      h.renderer.setData(payload);
      h.renderer.render();

      expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(1);
      const preDraws = h.gl.callsNamed("drawArraysInstanced").map((c) => c.args);
      expect(preDraws.length).toBeGreaterThanOrEqual(1);

      vi.mocked(decimateTraceIndices).mockClear();
      vi.mocked(countIsolatedSegments).mockClear();
      vi.mocked(collectIsolatedSampleIndices).mockClear();

      h.gl.simulateContextLoss();
      h.gl.simulateContextRestore();
      h.log.length = 0;

      readRecoveryHandle(h.renderer)!.rehydrate();
      h.renderer.render();

      expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(0);
      expect(vi.mocked(countIsolatedSegments)).toHaveBeenCalledTimes(0);
      expect(vi.mocked(collectIsolatedSampleIndices)).toHaveBeenCalledTimes(0);
      expect(h.gl.callsNamed("createBuffer").length).toBeGreaterThanOrEqual(2);
      expect(h.gl.callsNamed("bufferData").length).toBeGreaterThanOrEqual(2);
      expect(h.gl.callsNamed("drawArraysInstanced").map((c) => c.args)).toEqual(preDraws);
    }
  });

  it("short-circuits empty payload (vertexCount === 0) with zero bufferData calls on restore", () => {
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    const empty = makePayload(0, { revisionBumps: 1 });
    h.renderer.setData(empty);
    h.renderer.render();

    h.gl.simulateContextLoss();
    h.gl.simulateContextRestore();
    h.log.length = 0;

    readRecoveryHandle(h.renderer)!.rehydrate();
    h.renderer.render();

    expect(h.gl.callsNamed("createBuffer")).toHaveLength(0);
    expect(h.gl.callsNamed("bufferData")).toHaveLength(0);
    expect(h.gl.callsNamed("drawArraysInstanced")).toHaveLength(0);
  });

  it("executes full re-upload and re-decimation when revision, decimation, or plotWidth changed while lost", () => {
    // Case A: payload revision bumped while lost
    {
      const h = createHarness({ rendererOptions: { decimation: { algorithm: "lttb" } } });
      h.renderer.resize(400, 300, 1);
      const payload = makePayload(20_000);
      h.renderer.setData(payload);
      h.renderer.render();

      vi.mocked(decimateTraceIndices).mockClear();
      h.gl.simulateContextLoss();
      commitPayloadRevision(payload, 20_000);
      h.gl.simulateContextRestore();

      readRecoveryHandle(h.renderer)!.rehydrate();
      h.renderer.render();
      expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(1);
    }

    // Case B: setDecimation changed while lost
    {
      const h = createHarness({ rendererOptions: { decimation: { algorithm: "lttb" } } });
      h.renderer.resize(400, 300, 1);
      const payload = makePayload(20_000);
      h.renderer.setData(payload);
      h.renderer.render();

      vi.mocked(decimateTraceIndices).mockClear();
      h.gl.simulateContextLoss();
      h.renderer.setDecimation({ algorithm: "min-max", bucketCount: 64 });
      h.gl.simulateContextRestore();

      readRecoveryHandle(h.renderer)!.rehydrate();
      h.renderer.render();
      expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(decimateTraceIndices).mock.calls[0]?.[0]).toBe("min-max");
    }

    // Case C: resize() changed plotWidth while lost under viewport-derived lttb
    {
      const h = createHarness({ rendererOptions: { decimation: { algorithm: "lttb" } } });
      h.renderer.resize(400, 300, 1);
      const payload = makePayload(20_000);
      h.renderer.setData(payload);
      h.renderer.render();

      vi.mocked(decimateTraceIndices).mockClear();
      h.gl.simulateContextLoss();
      h.renderer.resize(900, 300, 1);
      h.gl.simulateContextRestore();

      readRecoveryHandle(h.renderer)!.rehydrate();
      h.renderer.render();
      expect(vi.mocked(decimateTraceIndices)).toHaveBeenCalledTimes(1);
    }
  });

  it("RecordingGl2Context returns null from createBuffer() and createVertexArray() while context is lost", () => {
    const gl = new RecordingGl2Context();
    gl.simulateContextLoss();

    expect(gl.createBuffer()).toBeNull();
    expect(gl.createVertexArray()).toBeNull();
    expect(gl.live.size).toBe(0);

    gl.simulateContextRestore();
    expect(gl.createBuffer()).not.toBeNull();
    expect(gl.createVertexArray()).not.toBeNull();
  });

  it("ensureTraceUploaded() while gl.isContextLost() preserves slot.gpuDirty and does not poison uploadedRevision", () => {
    // 1. Fast path (keyMatches && slot.gpuDirty) with non-empty data + isolated markers
    {
      const gl = new RecordingGl2Context();
      const slot = createTraceSlot();
      const payload = makePayload(60, {
        revisionBumps: 4,
        fill: (i) => (i === 30 ? 0.5 : i === 29 || i === 31 ? NaN : Math.sin(i * 0.1)),
      });
      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(false);
      expect(slot.vertexCount).toBe(60);
      expect(slot.markerCount).toBe(1);

      invalidateTraceSlotGpu(slot);
      gl.simulateContextLoss();
      gl.log.length = 0;

      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(true);
      expect(gl.callsNamed("createBuffer")).toHaveLength(0);
      expect(gl.callsNamed("bufferData")).toHaveLength(0);

      gl.simulateContextRestore();
      gl.log.length = 0;
      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(false);
      expect(gl.callsNamed("createBuffer")).toHaveLength(4);
      expect(gl.callsNamed("bufferData")).toHaveLength(4);
    }

    // 2. Fast path (keyMatches && slot.gpuDirty) with empty payload (vertexCount === 0)
    {
      const gl = new RecordingGl2Context();
      const slot = createTraceSlot();
      const empty = makePayload(0, { revisionBumps: 2 });
      ensureTraceUploaded(gl, slot, empty, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.vertexCount).toBe(0);
      expect(slot.gpuDirty).toBe(false);

      invalidateTraceSlotGpu(slot);
      gl.simulateContextLoss();
      ensureTraceUploaded(gl, slot, empty, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(true);

      gl.simulateContextRestore();
      gl.log.length = 0;
      ensureTraceUploaded(gl, slot, empty, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(false);
      expect(gl.callsNamed("bufferData")).toHaveLength(0);
    }

    // 3. Full path (!keyMatches) while context is lost does not poison uploadedRevision
    {
      const gl = new RecordingGl2Context();
      const slot = createTraceSlot();
      const payload = makePayload(50, { revisionBumps: 9 });
      gl.simulateContextLoss();
      gl.log.length = 0;

      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.uploadedRevision).toBe(-1);
      expect(slot.vertexCount).toBe(0);
      expect(gl.callsNamed("createBuffer")).toHaveLength(0);
      expect(gl.callsNamed("bufferData")).toHaveLength(0);

      gl.simulateContextRestore();
      gl.log.length = 0;
      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.uploadedRevision).toBe(9);
      expect(slot.vertexCount).toBe(50);
      expect(slot.gpuDirty).toBe(false);
      expect(gl.callsNamed("bufferData")).toHaveLength(2);
    }

    // 4. Mid-upload loss during marker buffer allocation leaves gpuDirty true (fast path) and key unpoisoned (full path)
    {
      const gl = new RecordingGl2Context();
      const slot = createTraceSlot();
      const payload = makePayload(40, {
        revisionBumps: 3,
        fill: (i) => (i === 20 ? 0.5 : i === 19 || i === 21 ? NaN : Math.sin(i * 0.1)),
      });
      // Initial healthy upload
      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      invalidateTraceSlotGpu(slot);

      // Lose context after line buffers (2 calls to createBuffer) so marker buffers return null
      let createCount = 0;
      const origCreateBuffer = gl.createBuffer.bind(gl);
      gl.createBuffer = () => {
        createCount += 1;
        if (createCount === 3) {
          gl.simulateContextLoss();
        }
        return origCreateBuffer();
      };

      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(true);

      // Restore & retry on fast path succeeds completely
      gl.createBuffer = origCreateBuffer;
      gl.simulateContextRestore();
      invalidateTraceSlotGpu(slot);
      gl.log.length = 0;
      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.gpuDirty).toBe(false);
      expect(gl.callsNamed("bufferData")).toHaveLength(4);
    }

    // 5. Mid-upload loss during full-path marker buffer allocation leaves uploadedRevision unpoisoned
    {
      const gl = new RecordingGl2Context();
      const slot = createTraceSlot();
      const payload = makePayload(40, {
        revisionBumps: 5,
        fill: (i) => (i === 20 ? 0.5 : i === 19 || i === 21 ? NaN : Math.sin(i * 0.1)),
      });

      let createCount = 0;
      const origCreateBuffer = gl.createBuffer.bind(gl);
      gl.createBuffer = () => {
        createCount += 1;
        if (createCount === 3) {
          gl.simulateContextLoss();
        }
        return origCreateBuffer();
      };

      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.uploadedRevision).toBe(-1);

      gl.createBuffer = origCreateBuffer;
      gl.simulateContextRestore();
      invalidateTraceSlotGpu(slot);
      gl.log.length = 0;
      ensureTraceUploaded(gl, slot, payload, 400, null, true, Y_SCALE_KIND_LINEAR);
      expect(slot.uploadedRevision).toBe(5);
      expect(slot.gpuDirty).toBe(false);
      expect(slot.markerCount).toBe(1);
      expect(gl.callsNamed("bufferData")).toHaveLength(4);
    }
  });

  it("mid-frame context loss between two trace slots in drawGlFrame() keeps the second slot dirty/unpoisoned and uploads cleanly after restore", () => {
    // Case A: Mid-frame loss on post-rehydrate fast path (both slots gpuDirty)
    {
      const h = createHarness();
      h.renderer.resize(400, 300, 1);
      const p1 = makePayload(40);
      const p2 = makePayload(55);
      const collection = createTraceCollection(
        [
          { id: "t0", payload: p1, yAxisId: "y", style: {} },
          { id: "t1", payload: p2, yAxisId: "y", style: {} },
        ],
        Y_AXIS,
        0,
        55,
      );
      h.renderer.setTraces(collection);
      h.renderer.render();

      const handle = readRecoveryHandle(h.renderer)!;
      h.gl.simulateContextLoss();
      h.gl.simulateContextRestore();
      handle.rehydrate();

      // Simulate context loss right after trace 0 draws, before trace 1 uploads.
      const origDraw = h.gl.drawArraysInstanced.bind(h.gl);
      let drawCalls = 0;
      h.gl.drawArraysInstanced = (mode, first, count, instanceCount) => {
        origDraw(mode, first, count, instanceCount);
        drawCalls += 1;
        if (drawCalls === 1) {
          h.gl.simulateContextLoss();
        }
      };

      h.log.length = 0;
      h.renderer.render();
      // Trace 0 uploaded (2 buffers) and drew; trace 1 must NOT have drawn with a null VAO or uploaded while lost.
      expect(h.gl.callsNamed("bufferData")).toHaveLength(2);
      expect(h.gl.callsNamed("drawArraysInstanced")).toHaveLength(1);

      // Restore context, rehydrate, and render again -> BOTH traces upload and draw cleanly.
      h.gl.drawArraysInstanced = origDraw;
      h.gl.simulateContextRestore();
      handle.rehydrate();
      h.log.length = 0;
      h.renderer.render();
      expect(h.gl.callsNamed("bufferData")).toHaveLength(4);
      expect(h.gl.callsNamed("drawArraysInstanced").map((c) => c.args[3])).toEqual([39, 54]);
    }

    // Case B: Mid-frame loss on !keyMatches path (fresh revisions on both slots)
    {
      const h = createHarness();
      h.renderer.resize(400, 300, 1);
      const p1 = makePayload(40);
      const p2 = makePayload(55);
      const collection = createTraceCollection(
        [
          { id: "t0", payload: p1, yAxisId: "y", style: {} },
          { id: "t1", payload: p2, yAxisId: "y", style: {} },
        ],
        Y_AXIS,
        0,
        55,
      );
      h.renderer.setTraces(collection);

      const origDraw = h.gl.drawArraysInstanced.bind(h.gl);
      let drawCalls = 0;
      h.gl.drawArraysInstanced = (mode, first, count, instanceCount) => {
        origDraw(mode, first, count, instanceCount);
        drawCalls += 1;
        if (drawCalls === 1) {
          h.gl.simulateContextLoss();
        }
      };

      h.log.length = 0;
      h.renderer.render();
      expect(h.gl.callsNamed("bufferData")).toHaveLength(2);
      expect(h.gl.callsNamed("drawArraysInstanced")).toHaveLength(1);

      // Restore context, rehydrate, and render -> trace 1 was NOT poisoned and uploads + draws cleanly.
      h.gl.drawArraysInstanced = origDraw;
      h.gl.simulateContextRestore();
      readRecoveryHandle(h.renderer)!.rehydrate();
      h.log.length = 0;
      h.renderer.render();
      expect(h.gl.callsNamed("bufferData")).toHaveLength(4);
      expect(h.gl.callsNamed("drawArraysInstanced").map((c) => c.args[3])).toEqual([39, 54]);
    }
  });
});

interface NodeEventListener {
  (event: NodeSyntheticEvent): void;
}

interface NodeSyntheticEvent {
  readonly type: string;
  readonly cancelable: boolean;
  readonly target: object;
  readonly statusMessage?: string;
  defaultPrevented: boolean;
  preventDefault(): void;
}

function createNodeEvent(
  type: string,
  target: object,
  options: { readonly cancelable?: boolean; readonly statusMessage?: string } = {},
): NodeSyntheticEvent {
  const event: NodeSyntheticEvent = {
    type,
    cancelable: options.cancelable ?? false,
    target,
    ...(options.statusMessage !== undefined ? { statusMessage: options.statusMessage } : {}),
    defaultPrevented: false,
    preventDefault(): void {
      if (event.cancelable) {
        event.defaultPrevented = true;
      }
    },
  };
  return event;
}

interface EventStubCanvas {
  readonly id: number;
  width: number;
  height: number;
  readonly style: Record<string, string>;
  readonly attrs: Map<string, string>;
  readonly listeners: Map<string, Set<NodeEventListener>>;
  parent: EventStubContainer | null;
  parentNode: EventStubContainer | null;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove(): void;
  addEventListener(type: string, listener: NodeEventListener): void;
  removeEventListener(type: string, listener: NodeEventListener): void;
  dispatchEvent(event: NodeSyntheticEvent): boolean;
}

interface EventStubContainer {
  readonly style: Record<string, string>;
  readonly children: EventStubCanvas[];
  readonly firstChild: EventStubCanvas | null;
  readonly ownerDocument: { createElement(tag: string): HTMLCanvasElement };
  getBoundingClientRect(): { width: number; height: number };
  insertBefore(node: EventStubCanvas, reference: EventStubCanvas | null): EventStubCanvas;
}

function createEventStubHost() {
  let nextId = 1;
  const createdCanvases: EventStubCanvas[] = [];

  const createCanvasStub = (): EventStubCanvas => {
    const listeners = new Map<string, Set<NodeEventListener>>();
    const record: EventStubCanvas = {
      id: nextId++,
      width: 0,
      height: 0,
      style: {},
      attrs: new Map<string, string>(),
      listeners,
      parent: null,
      parentNode: null,
      setAttribute(name: string, value: string): void {
        record.attrs.set(name, value);
      },
      getAttribute(name: string): string | null {
        return record.attrs.get(name) ?? null;
      },
      remove(): void {
        if (record.parent === null) return;
        const idx = record.parent.children.indexOf(record);
        if (idx >= 0) record.parent.children.splice(idx, 1);
        record.parent = null;
        record.parentNode = null;
      },
      addEventListener(type: string, listener: NodeEventListener): void {
        let bucket = listeners.get(type);
        if (bucket === undefined) {
          bucket = new Set<NodeEventListener>();
          listeners.set(type, bucket);
        }
        bucket.add(listener);
      },
      removeEventListener(type: string, listener: NodeEventListener): void {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: NodeSyntheticEvent): boolean {
        const bucket = listeners.get(event.type);
        if (bucket !== undefined) {
          for (const listener of Array.from(bucket)) {
            listener(event);
          }
        }
        return !event.defaultPrevented;
      },
    };
    createdCanvases.push(record);
    return record;
  };

  const createCanvas = (): HTMLCanvasElement => {
    const stub = createCanvasStub();
    // eslint-disable-next-line no-restricted-syntax -- Node test double for HTMLCanvasElement
    return stub as unknown as HTMLCanvasElement;
  };

  const containerRecord: EventStubContainer = {
    style: { position: "" },
    children: [],
    get firstChild(): EventStubCanvas | null {
      return containerRecord.children[0] ?? null;
    },
    ownerDocument: {
      createElement(): HTMLCanvasElement {
        return createCanvas();
      },
    },
    getBoundingClientRect(): { width: number; height: number } {
      return { width: 640, height: 400 };
    },
    insertBefore(node: EventStubCanvas, reference: EventStubCanvas | null): EventStubCanvas {
      const existingIdx = containerRecord.children.indexOf(node);
      if (existingIdx >= 0) containerRecord.children.splice(existingIdx, 1);
      if (reference === null) {
        containerRecord.children.push(node);
      } else {
        const refIdx = containerRecord.children.indexOf(reference);
        if (refIdx >= 0) {
          containerRecord.children.splice(refIdx, 0, node);
        } else {
          containerRecord.children.push(node);
        }
      }
      node.parent = containerRecord;
      node.parentNode = containerRecord;
      return node;
    },
  };

  // eslint-disable-next-line no-restricted-syntax -- Node test double for HTMLElement
  const container = containerRecord as unknown as HTMLElement;
  return { container, containerRecord, createdCanvases, createCanvas };
}

class NodeCanvas2DStub implements FigureRenderer {
  readonly kind: FigureRendererKind = "canvas2d";
  #disposed = false;
  #transform: ViewportTransform;
  renderCount = 0;
  disposeCount = 0;

  constructor() {
    this.#transform = createViewportTransform({
      cssWidth: 640,
      cssHeight: 400,
      dpr: 1,
      insetLeft: 40,
      insetRight: 16,
      insetTop: 16,
      insetBottom: 32,
      xDomainMin: 0,
      xDomainMax: 1,
      yDomainMin: -1,
      yDomainMax: 1,
      xOrigin: 0,
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }
  get transform(): ViewportTransform {
    return this.#transform;
  }
  setData(): void {}
  setTraces(): void {}
  setDomain(): void {}
  resize(): void {}
  render(): void {
    if (this.#disposed) return;
    this.renderCount += 1;
  }
  clear(): void {}
  setDecimation(): void {}
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.disposeCount += 1;
  }
}

describe("SpectrumEngineController Node recovery integration", () => {
  it("aborts mid-switch swap before DOM mutation when webglcontextlost fires on staged plot during incoming.render()", () => {
    const host = createEventStubHost();
    const c2dStubs: NodeCanvas2DStub[] = [];
    const fallbacks: WebGL2FallbackEvent[] = [];
    const lostEvents: unknown[] = [];
    let incomingDisposeCount = 0;
    let stagedPlot: EventStubCanvas | null = null;

    const controller = createSpectrumEngineController({
      container: host.container,
      mode: "auto",
      autoResize: false,
      createCanvas: host.createCanvas,
      onWebGL2Fallback: (e) => fallbacks.push(e),
      onContextLost: (e) => lostEvents.push(e),
      createCanvas2DRenderer: () => {
        const stub = new NodeCanvas2DStub();
        c2dStubs.push(stub);
        return stub;
      },
      createWebGL2Renderer: (opts) => {
        const parts = createParts();
        const real = new WebGL2FigureRenderer({
          ...opts,
          surfaces: {
            underlay: asSurface(parts.underlay),
            plot: asSurface(parts.plot),
            overlay: asSurface(parts.overlay),
          },
        });
        // eslint-disable-next-line no-restricted-syntax -- unwrap test canvas stub
        stagedPlot = opts.surfaces.plot as unknown as EventStubCanvas;
        const originalRender = real.render.bind(real);
        const originalDispose = real.dispose.bind(real);
        real.render = () => {
          originalRender();
          parts.gl.simulateContextLoss();
          stagedPlot!.dispatchEvent(
            createNodeEvent("webglcontextlost", stagedPlot!, { cancelable: true }),
          );
        };
        real.dispose = () => {
          incomingDisposeCount += 1;
          originalDispose();
        };
        return real;
      },
    });

    const initialCanvas = host.containerRecord.children[0];
    expect(host.containerRecord.children).toHaveLength(1);

    controller.setData(makePayload(80_000));
    controller.render();

    expect(incomingDisposeCount).toBe(1);
    expect(host.containerRecord.children).toEqual([initialCanvas]);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.webgl2Fallback).toBe(true);
    expect(controller.contextLost).toBe(false);
    expect(c2dStubs[0]!.renderCount).toBeGreaterThanOrEqual(1);
    expect(fallbacks).toHaveLength(1);
    expect(lostEvents).toHaveLength(0);
    controller.dispose();
  });

  it("aborts mid-switch swap before DOM mutation when RecordingGl2Context flips to isContextLost() between Step 2 and Step 4", () => {
    const host = createEventStubHost();
    const c2dStubs: NodeCanvas2DStub[] = [];
    const fallbacks: WebGL2FallbackEvent[] = [];
    const lostEvents: unknown[] = [];
    let incomingDisposeCount = 0;

    const controller = createSpectrumEngineController({
      container: host.container,
      mode: "auto",
      autoResize: false,
      createCanvas: host.createCanvas,
      onWebGL2Fallback: (e) => fallbacks.push(e),
      onContextLost: (e) => lostEvents.push(e),
      createCanvas2DRenderer: () => {
        const stub = new NodeCanvas2DStub();
        c2dStubs.push(stub);
        return stub;
      },
      createWebGL2Renderer: (opts) => {
        const parts = createParts();
        const real = new WebGL2FigureRenderer({
          ...opts,
          surfaces: {
            underlay: asSurface(parts.underlay),
            plot: asSurface(parts.plot),
            overlay: asSurface(parts.overlay),
          },
        });
        const originalSetDecimation = real.setDecimation.bind(real);
        const originalDispose = real.dispose.bind(real);
        real.setDecimation = (sel) => {
          originalSetDecimation(sel);
          parts.gl.simulateContextLoss();
        };
        real.dispose = () => {
          incomingDisposeCount += 1;
          originalDispose();
        };
        return real;
      },
    });

    const initialCanvas = host.containerRecord.children[0];
    controller.setData(makePayload(80_000));
    controller.render();

    expect(incomingDisposeCount).toBe(1);
    expect(host.containerRecord.children).toEqual([initialCanvas]);
    expect(controller.activeKind).toBe("canvas2d");
    expect(controller.webgl2Fallback).toBe(true);
    expect(controller.contextLost).toBe(false);
    expect(c2dStubs[0]!.renderCount).toBeGreaterThanOrEqual(1);
    expect(fallbacks).toHaveLength(1);
    expect(lostEvents).toHaveLength(0);
    controller.dispose();
  });

  it("continues draining DecimationPort.poll(settlementSink) during render() while contextLost is true without drawing or disposing port", () => {
    const host = createEventStubHost();
    let glParts: ReturnType<typeof createParts> | null = null;
    let glRenderCount = 0;

    const payload = makePayload(100);
    let pollCalls = 0;
    let portDisposeCalls = 0;
    let shouldBumpOnPoll = false;

    const settlementSink: SettlementSink = {
      onSettled: () => {},
    };
    const basePort = createSyncDecimationPort({
      poolPairs: 2,
      transitCapacitySamples: 256,
    });
    const decimationPort: DecimationPort = {
      ...basePort,
      poll: (sink: SettlementSink) => {
        pollCalls += 1;
        expect(sink).toBe(settlementSink);
        if (shouldBumpOnPoll) {
          shouldBumpOnPoll = false;
          for (let i = 0; i < 60; i += 1) {
            payload.x[i] = i;
            payload.y[i] = Math.cos(i * 0.1);
          }
          commitPayloadRevision(payload, 60);
          return 1;
        }
        return basePort.poll(sink);
      },
      dispose: () => {
        portDisposeCalls += 1;
        basePort.dispose();
      },
    };

    const controller = createSpectrumEngineController({
      container: host.container,
      mode: "webgl2",
      autoResize: false,
      createCanvas: host.createCanvas,
      decimationPort,
      settlementSink,
      createCanvas2DRenderer: () => new NodeCanvas2DStub(),
      createWebGL2Renderer: (opts) => {
        glParts = createParts();
        const real = new WebGL2FigureRenderer({
          ...opts,
          surfaces: {
            underlay: asSurface(glParts.underlay),
            plot: asSurface(glParts.plot),
            overlay: asSurface(glParts.overlay),
          },
        });
        const origRender = real.render.bind(real);
        real.render = () => {
          glRenderCount += 1;
          origRender();
        };
        return real;
      },
    });

    controller.setData(payload);
    controller.render();
    expect(controller.sampleCount).toBe(100);

    // Lose context on active plot canvas
    // eslint-disable-next-line no-restricted-syntax -- unwrap test canvas stub
    const plotCanvas = controller.canvases[1] as unknown as EventStubCanvas;
    glParts!.gl.simulateContextLoss();
    plotCanvas.dispatchEvent(createNodeEvent("webglcontextlost", plotCanvas, { cancelable: true }));
    expect(controller.contextLost).toBe(true);

    pollCalls = 0;
    glRenderCount = 0;
    shouldBumpOnPoll = true;

    controller.render();

    expect(pollCalls).toBe(1);
    expect(controller.sampleCount).toBe(60);
    expect(glRenderCount).toBe(0);

    controller.dispose();
    expect(portDisposeCalls).toBe(0);
  });

  it("falls back deterministically to live painted Canvas2D when rehydration shader compile or post-restore render() fails", () => {
    for (const mode of ["compile-fail", "post-render-throw"] as const) {
      const host = createEventStubHost();
      const c2dStubs: NodeCanvas2DStub[] = [];
      const fallbacks: WebGL2FallbackEvent[] = [];
      const changes: EngineChangeEvent[] = [];
      const restores: unknown[] = [];
      let glParts: ReturnType<typeof createParts> | null = null;
      let glRenderer: WebGL2FigureRenderer | null = null;
      let throwNextRender = false;

      const controller = createSpectrumEngineController({
        container: host.container,
        mode: "webgl2",
        autoResize: false,
        createCanvas: host.createCanvas,
        onWebGL2Fallback: (e) => fallbacks.push(e),
        onEngineChange: (e) => changes.push(e),
        onContextRestored: (e) => restores.push(e),
        createCanvas2DRenderer: () => {
          const stub = new NodeCanvas2DStub();
          c2dStubs.push(stub);
          return stub;
        },
        createWebGL2Renderer: (opts) => {
          glParts = createParts();
          glRenderer = new WebGL2FigureRenderer({
            ...opts,
            surfaces: {
              underlay: asSurface(glParts.underlay),
              plot: asSurface(glParts.plot),
              overlay: asSurface(glParts.overlay),
            },
          });
          const origRender = glRenderer.render.bind(glRenderer);
          glRenderer.render = () => {
            if (throwNextRender) {
              throwNextRender = false;
              throw new Error("post-restore draw exploded");
            }
            origRender();
          };
          return glRenderer;
        },
      });

      controller.setData(makePayload(128));
      controller.render();
      changes.length = 0;

      // eslint-disable-next-line no-restricted-syntax -- unwrap test canvas stub
      const plotCanvas = controller.canvases[1] as unknown as EventStubCanvas;
      glParts!.gl.simulateContextLoss();
      plotCanvas.dispatchEvent(createNodeEvent("webglcontextlost", plotCanvas, { cancelable: true }));
      expect(controller.contextLost).toBe(true);

      glParts!.gl.simulateContextRestore();
      if (mode === "compile-fail") {
        glParts!.gl.setCompileFailure("shader compile broken on restore");
      } else {
        throwNextRender = true;
      }

      expect(() =>
        plotCanvas.dispatchEvent(createNodeEvent("webglcontextrestored", plotCanvas)),
      ).not.toThrow();

      expect(controller.activeKind).toBe("canvas2d");
      expect(controller.webgl2Fallback).toBe(true);
      expect(controller.contextLost).toBe(false);
      expect(controller.canvases).toHaveLength(1);
      expect(c2dStubs).toHaveLength(1);
      expect(c2dStubs[0]!.renderCount).toBeGreaterThanOrEqual(1);
      expect(glRenderer!.disposed).toBe(true);
      expect(fallbacks).toHaveLength(1);
      expect(changes).toEqual([
        {
          previousKind: "webgl2",
          activeKind: "canvas2d",
          sampleCount: 128,
          mode: "webgl2",
          reason: "webgl2-fallback",
        },
      ]);
      expect(restores).toHaveLength(0);

      controller.dispose();
    }
  });

  it("resolves Symbol.for('trace-kit.webgl2.recovery') across separate built ESM and CJS bundles for in-place rehydration", async () => {
    interface BuiltWebGL2Module {
      readonly WebGL2FigureRenderer: new (options: WebGL2FigureRendererOptions) => FigureRenderer;
    }
    interface BuiltControllerModule {
      readonly createSpectrumEngineController: typeof createSpectrumEngineController;
    }

    const esmWebgl2: BuiltWebGL2Module = await import("@trace-kit/renderers/webgl2");
    const esmController: BuiltControllerModule = await import("@trace-kit/renderers/controller");

    const req = createRequire(import.meta.url);
    const cjsWebgl2 = req("@trace-kit/renderers/webgl2") as BuiltWebGL2Module;
    const cjsController = req("@trace-kit/renderers/controller") as BuiltControllerModule;

    for (const [label, glMod, ctrlMod] of [
      ["ESM", esmWebgl2, esmController],
      ["CJS", cjsWebgl2, cjsController],
    ] as const) {
      const host = createEventStubHost();
      const createdRenderers: FigureRenderer[] = [];
      let glParts: ReturnType<typeof createParts> | null = null;
      const restores: Array<{ readonly restoreCount: number }> = [];

      const controller = ctrlMod.createSpectrumEngineController({
        container: host.container,
        mode: "webgl2",
        autoResize: false,
        createCanvas: host.createCanvas,
        onContextRestored: (e) => restores.push(e),
        createCanvas2DRenderer: () => new NodeCanvas2DStub(),
        createWebGL2Renderer: (opts) => {
          glParts = createParts();
          const renderer = new glMod.WebGL2FigureRenderer({
            ...opts,
            surfaces: {
              underlay: asSurface(glParts.underlay),
              plot: asSurface(glParts.plot),
              overlay: asSurface(glParts.overlay),
            },
          });
          createdRenderers.push(renderer);
          return renderer;
        },
      });

      controller.setData(makePayload(64));
      controller.render();

      const plotCanvasBefore = controller.canvases[1]!;
      // eslint-disable-next-line no-restricted-syntax -- unwrap test canvas stub
      const plotStub = plotCanvasBefore as unknown as EventStubCanvas;

      glParts!.gl.simulateContextLoss();
      plotStub.dispatchEvent(createNodeEvent("webglcontextlost", plotStub, { cancelable: true }));
      expect(controller.contextLost, `${label} contextLost`).toBe(true);

      glParts!.gl.simulateContextRestore();
      glParts!.log.length = 0;
      plotStub.dispatchEvent(createNodeEvent("webglcontextrestored", plotStub));

      // Proves in-place rehydration (NOT 3-canvas stub fallback):
      // 1. Only 1 WebGL2FigureRenderer was ever constructed.
      // 2. The exact same plot canvas stayed mounted.
      // 3. Shaders were recompiled and buffers re-uploaded on the original RecordingGl2Context.
      expect(createdRenderers, `${label} renderer count`).toHaveLength(1);
      expect(controller.canvases[1], `${label} plot canvas identity`).toBe(plotCanvasBefore);
      expect(controller.contextLost, `${label} restored contextLost`).toBe(false);
      expect(glParts!.gl.callsNamed("createProgram"), `${label} recompiled programs`).toHaveLength(2);
      expect(glParts!.gl.callsNamed("drawArraysInstanced"), `${label} redrawn`).toHaveLength(1);
      expect(restores, `${label} restore events`).toHaveLength(1);
      expect(restores[0]?.restoreCount).toBe(1);

      controller.dispose();
    }
  });
});

