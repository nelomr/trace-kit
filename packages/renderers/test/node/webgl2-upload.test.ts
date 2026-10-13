/** @vitest-environment node */
import {
  asXBuffer,
  asYBuffer,
  commitPayloadRevision,
  createSpectrumDataPayload,
  type DecimationSelection,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectIsolatedSampleIndices } from "../../src/path/isolated-markers.js";
import { decimateTraceIndices, resolveDecimationTarget } from "../../src/rules/decimation.js";
import { GL_ARRAY_BUFFER, GL_DYNAMIC_DRAW, GL_FLOAT } from "../../src/webgl2/gl-context.js";
import { createTraceSlot, releaseTraceSlot } from "../../src/webgl2/trace-slot.js";
import { ensureTraceUploaded } from "../../src/webgl2/upload.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";

// Counts calls to the core decimators while still running them, so a test can prove the default
// path never reaches one and an explicit selection reaches exactly the one selected.
const decimatorCalls = vi.hoisted(() => ({ lttb: 0, minMax: 0, minMaxEnvelope: 0 }));
vi.mock("@trace-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trace-kit/core")>();
  return {
    ...actual,
    lttb: (...args: Parameters<typeof actual.lttb>) => {
      decimatorCalls.lttb += 1;
      return actual.lttb(...args);
    },
    minMaxEnvelopeIndices: (...args: Parameters<typeof actual.minMaxEnvelopeIndices>) => {
      decimatorCalls.minMax += 1;
      return actual.minMaxEnvelopeIndices(...args);
    },
    minMaxEnvelope: (...args: Parameters<typeof actual.minMaxEnvelope>) => {
      decimatorCalls.minMaxEnvelope += 1;
      return actual.minMaxEnvelope(...args);
    },
  };
});

function makePayload(n: number, fill?: (i: number) => number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: Math.max(1, n), xOrigin: 0, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < n; i += 1) {
    payload.x[i] = i;
    payload.y[i] = fill === undefined ? Math.sin(i / 7) : fill(i);
  }
  commitPayloadRevision(payload, n);
  return payload;
}

function bump(payload: SpectrumDataPayload, n: number): void {
  commitPayloadRevision(payload, n);
}

const LTTB_100: DecimationSelection = { algorithm: "lttb", threshold: 100 };
const MINMAX_20: DecimationSelection = { algorithm: "min-max", bucketCount: 20 };

let gl: RecordingGl2Context;
beforeEach(() => {
  gl = new RecordingGl2Context();
  decimatorCalls.lttb = 0;
  decimatorCalls.minMax = 0;
  decimatorCalls.minMaxEnvelope = 0;
});

describe("full-resolution upload", () => {
  it("uploads x and y once per revision through the srcOffset/length overload, with no copy", () => {
    const payload = makePayload(1000);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, false);

    const uploads = gl.bufferUploads();
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.data).toBe(payload.x);
    expect(uploads[1]?.data).toBe(payload.y);
    for (const upload of uploads) {
      expect(upload.target).toBe(GL_ARRAY_BUFFER);
      expect(upload.srcOffset).toBe(0);
      expect(upload.length).toBe(1000);
    }
    expect(gl.callsNamed("bufferData")[0]?.args[2]).toBe(GL_DYNAMIC_DRAW);
    expect(slot.vertexCount).toBe(1000);
    expect(uploads[0]?.buffer).not.toBe(uploads[1]?.buffer);
  });

  it("uploads once for sixty identical renders and again after a revision bump", () => {
    const payload = makePayload(500);
    const slot = createTraceSlot();
    for (let i = 0; i < 60; i += 1) ensureTraceUploaded(gl, slot, payload, 800, null, false);
    expect(gl.bufferUploads()).toHaveLength(2);

    bump(payload, 500);
    ensureTraceUploaded(gl, slot, payload, 800, null, false);
    expect(gl.bufferUploads()).toHaveLength(4);
  });

  it("skips the upload entirely for an empty payload, creating nothing", () => {
    const payload = makePayload(0);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, true);

    expect(gl.bufferUploads()).toHaveLength(0);
    expect(gl.created.buffer).toBe(0);
    expect(slot.vertexCount).toBe(0);
    expect(slot.markerCount).toBe(0);
  });

  it("uploads NaN gap samples exactly as stored", () => {
    const payload = makePayload(20, (i) => (i % 5 === 2 ? NaN : i));
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, false);

    const snapshot = gl.bufferUploads()[1]?.snapshot;
    expect(snapshot).toHaveLength(20);
    for (let i = 0; i < 20; i += 1) {
      expect(Object.is(snapshot?.[i], payload.y[i])).toBe(true);
    }
  });

  it("invokes no decimator on a one-million-sample default path", () => {
    const payload = makePayload(1_000_000, (i) => i % 1000);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, false);

    expect(decimatorCalls).toEqual({ lttb: 0, minMax: 0, minMaxEnvelope: 0 });
    expect(gl.bufferUploads()[0]?.length).toBe(1_000_000);
  });

  it("uploads a SharedArrayBuffer-backed view without copying it", () => {
    const base = makePayload(64);
    const shared = new Float32Array(new SharedArrayBuffer(64 * 4));
    const sharedY = new Float32Array(new SharedArrayBuffer(64 * 4));
    shared.set(base.x.subarray(0, 64));
    sharedY.set(base.y.subarray(0, 64));
    const payload: SpectrumDataPayload = { ...base, x: asXBuffer(shared), y: asYBuffer(sharedY) };
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, false);

    expect(gl.bufferUploads()[0]?.data).toBe(shared);
    expect(gl.bufferUploads()[1]?.data).toBe(sharedY);
  });
});

describe("GPU object layout", () => {
  it("creates two buffers and one VAO on first upload, with four instanced attribute pointers", () => {
    const payload = makePayload(100);
    const slot = createTraceSlot();
    expect(gl.created.buffer).toBe(0);
    ensureTraceUploaded(gl, slot, payload, 800, null, false);

    expect(gl.created.buffer).toBe(2);
    expect(gl.created.vertexArray).toBe(1);
    const pointers = gl.callsNamed("vertexAttribPointer").map((c) => c.args);
    expect(pointers).toEqual([
      [0, 1, GL_FLOAT, false, 4, 0],
      [1, 1, GL_FLOAT, false, 4, 4],
      [2, 1, GL_FLOAT, false, 4, 0],
      [3, 1, GL_FLOAT, false, 4, 4],
    ]);
    expect(gl.callsNamed("vertexAttribDivisor").map((c) => c.args)).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });

  it("creates the GPU objects once and releases every one of them", () => {
    const payload = makePayload(100, (i) => (i === 50 ? NaN : i % 2));
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, true);
    bump(payload, 100);
    ensureTraceUploaded(gl, slot, payload, 800, null, true);
    const createdBefore = { ...gl.created };

    releaseTraceSlot(gl, slot);

    expect(createdBefore.buffer).toBe(gl.created.buffer);
    expect(gl.liveCount("buffer")).toBe(0);
    expect(gl.liveCount("vertexArray")).toBe(0);
  });
});

describe("explicit decimation selection", () => {
  function expectedGather(payload: SpectrumDataPayload, selection: DecimationSelection, plotWidth: number) {
    const parameter = resolveDecimationTarget(selection, plotWidth, payload.sampleCount);
    const indices = new Int32Array(parameter * 2 + 2);
    const count = decimateTraceIndices(selection.algorithm, parameter, payload.x, payload.y, payload.sampleCount, indices);
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const j = indices[i] ?? -1;
      x[i] = j < 0 ? NaN : (payload.x[j] ?? NaN);
      y[i] = j < 0 ? NaN : (payload.y[j] ?? NaN);
    }
    return { x, y, count };
  }

  for (const [label, selection] of [
    ["lttb", LTTB_100],
    ["min-max", MINMAX_20],
  ] as const) {
    it(`uploads the ${label} stream Canvas2D would draw, with -1 mapped to NaN`, () => {
      const payload = makePayload(5000, (i) => (i % 700 === 350 ? NaN : Math.sin(i / 11) * 5));
      const slot = createTraceSlot();
      ensureTraceUploaded(gl, slot, payload, 800, selection, false);

      const expected = expectedGather(payload, selection, 800);
      const [ux, uy] = gl.bufferUploads();
      expect(ux?.length).toBe(expected.count);
      expect(slot.vertexCount).toBe(expected.count);
      for (let i = 0; i < expected.count; i += 1) {
        expect(Object.is(ux?.snapshot[i], expected.x[i])).toBe(true);
        expect(Object.is(uy?.snapshot[i], expected.y[i])).toBe(true);
      }
      expect(ux?.data).not.toBe(payload.x);
    });
  }

  it("bypasses to the full payload when the sample count does not exceed the emitted count", () => {
    const payload = makePayload(100);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, { algorithm: "lttb", threshold: 100 }, false);
    expect(gl.bufferUploads()[0]?.data).toBe(payload.x);
    expect(decimatorCalls.lttb).toBe(0);

    const second = makePayload(40);
    const secondSlot = createTraceSlot();
    ensureTraceUploaded(gl, secondSlot, second, 800, { algorithm: "min-max", bucketCount: 20 }, false);
    expect(gl.bufferUploads()[2]?.data).toBe(second.x);
    expect(decimatorCalls.minMax).toBe(0);
  });

  it("re-uploads when the selection, the mode or a resize-derived parameter changes, never otherwise", () => {
    const payload = makePayload(20_000);
    const slot = createTraceSlot();
    const uploads = () => gl.bufferUploads().length;

    ensureTraceUploaded(gl, slot, payload, 400, { algorithm: "lttb" }, false);
    const first = uploads();
    ensureTraceUploaded(gl, slot, payload, 400, { algorithm: "lttb" }, false);
    expect(uploads()).toBe(first);

    ensureTraceUploaded(gl, slot, payload, 800, { algorithm: "lttb" }, false);
    expect(uploads()).toBeGreaterThan(first);

    const afterResize = uploads();
    ensureTraceUploaded(gl, slot, payload, 800, { algorithm: "min-max" }, false);
    expect(uploads()).toBeGreaterThan(afterResize);

    const afterAlgorithm = uploads();
    ensureTraceUploaded(gl, slot, payload, 800, null, false);
    expect(uploads()).toBeGreaterThan(afterAlgorithm);
  });

  it("runs the selected decimator once per key and never on a repeat render", () => {
    const payload = makePayload(20_000);
    const slot = createTraceSlot();
    for (let i = 0; i < 10; i += 1) ensureTraceUploaded(gl, slot, payload, 400, LTTB_100, false);
    expect(decimatorCalls.lttb).toBe(1);
  });

  it("grows its scratch buffers and index buffer and never shrinks them", () => {
    const payload = makePayload(20_000);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, { algorithm: "lttb", threshold: 1000 }, false);
    const sizes = [slot.scratchX.length, slot.scratchY.length, slot.indices.length];
    ensureTraceUploaded(gl, slot, payload, 800, { algorithm: "lttb", threshold: 100 }, false);
    expect(slot.scratchX.length).toBeGreaterThanOrEqual(sizes[0] ?? 0);
    expect(slot.scratchY.length).toBeGreaterThanOrEqual(sizes[1] ?? 0);
    expect(slot.indices.length).toBeGreaterThanOrEqual(sizes[2] ?? 0);
    expect(sizes[0]).toBeGreaterThanOrEqual(1000);
  });
});

describe("isolated-sample marker upload", () => {
  // Samples 0 and 4 are each surrounded by gaps (isolated); 7..9 form a normal run.
  const pattern = (i: number): number => (i === 0 || i === 4 || (i >= 7 && i <= 9) ? i : NaN);

  it("gathers marker positions from the isolated source samples, only when there are any", () => {
    const payload = makePayload(10, pattern);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, payload, 800, null, true);

    const expected = new Int32Array(10);
    const count = collectIsolatedSampleIndices(payload.x, payload.y, new Int32Array(0), 0, 10, expected);
    expect(count).toBe(2);
    expect(slot.markerCount).toBe(2);
    const uploads = gl.bufferUploads();
    expect(uploads).toHaveLength(4);
    expect(Array.from(uploads[2]?.snapshot ?? [])).toEqual([0, 4]);
    expect(Array.from(uploads[3]?.snapshot ?? [])).toEqual([0, 4]);
    expect(gl.created.buffer).toBe(4);
    expect(gl.created.vertexArray).toBe(2);
  });

  it("creates no marker objects for a gap-free trace or when the style opts out", () => {
    const smooth = makePayload(50);
    const slot = createTraceSlot();
    ensureTraceUploaded(gl, slot, smooth, 800, null, true);
    expect(slot.markerCount).toBe(0);
    expect(gl.created.buffer).toBe(2);

    const gapped = makePayload(10, pattern);
    const optedOut = createTraceSlot();
    ensureTraceUploaded(gl, optedOut, gapped, 800, null, false);
    expect(optedOut.markerCount).toBe(0);
    expect(gl.created.buffer).toBe(4);
  });

  it("recounts isolated samples once per key change, not per render", () => {
    const payload = makePayload(10, pattern);
    const slot = createTraceSlot();
    for (let i = 0; i < 20; i += 1) ensureTraceUploaded(gl, slot, payload, 800, null, true);
    expect(gl.bufferUploads()).toHaveLength(4);
  });
});
