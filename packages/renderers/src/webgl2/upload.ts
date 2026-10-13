/**
 * Revision-keyed upload of one trace's samples to the GPU. Runs on every frame but does work only
 * when the key (payload revision, upload mode, decimation algorithm, decimation parameter)
 * changed since the last upload, so a steady-state frame is a handful of comparisons.
 *
 * The default path uploads the payload's own `Float32Array`s whole, through the WebGL 2
 * `srcOffset`/`length` overload: no `subarray`, no CPU copy. An explicit decimation selection runs
 * the same core decimators Canvas2D does and uploads the gathered stream. Pan and zoom change no
 * field of the key, so they never re-decimate and never re-upload.
 *
 * `bufferData` rather than `bufferSubData`: the store size follows the sample count and the
 * decimated count, and one `bufferData` reallocates it and lets the driver orphan the old store,
 * where a capacity-sized store would pin `payload.capacity` bytes on the GPU for every trace.
 */
import type { DecimationAlgorithm, DecimationSelection, SpectrumDataPayload } from "@trace-kit/core";
import { collectIsolatedSampleIndices, countIsolatedSegments } from "../path/isolated-markers.js";
import { decimateTraceIndices, resolveDecimationTarget } from "../rules/decimation.js";
import { GL_ARRAY_BUFFER, GL_DYNAMIC_DRAW, type Gl2Context } from "./gl-context.js";
import {
  ensureLineObjects,
  ensureMarkerObjects,
  growDecimationScratch,
  growMarkerScratch,
  UPLOAD_DECIMATED,
  UPLOAD_FULL,
  type TraceGpuSlot,
} from "./trace-slot.js";

/** Uploads the first `count` elements of an X array and a Y array into their buffers. `count` is
 * never zero here: WebGL reads `length: 0` as "to the end of the view". */
function uploadPair(
  gl: Gl2Context,
  xBuffer: WebGLBuffer,
  yBuffer: WebGLBuffer,
  x: Float32Array,
  y: Float32Array,
  count: number,
): void {
  gl.bindBuffer(GL_ARRAY_BUFFER, xBuffer);
  gl.bufferData(GL_ARRAY_BUFFER, x, GL_DYNAMIC_DRAW, 0, count);
  gl.bindBuffer(GL_ARRAY_BUFFER, yBuffer);
  gl.bufferData(GL_ARRAY_BUFFER, y, GL_DYNAMIC_DRAW, 0, count);
}

/**
 * Brings the slot's GPU copy up to date with `payload` under `selection` (`null` is the backend
 * default: the full payload). `plotWidth` only feeds the decimation target, and `markIsolated`
 * is the trace style's opt-in for isolated-sample markers.
 */
export function ensureTraceUploaded(
  gl: Gl2Context,
  slot: TraceGpuSlot,
  payload: SpectrumDataPayload,
  plotWidth: number,
  selection: DecimationSelection | null,
  markIsolated: boolean,
): void {
  const n = payload.sampleCount;

  let mode = UPLOAD_FULL;
  let algorithm: DecimationAlgorithm | null = null;
  let parameter = 0;
  let emitted = 0;
  if (selection !== null) {
    const target = resolveDecimationTarget(selection, plotWidth, n);
    emitted = selection.algorithm === "lttb" ? target : target * 2;
    // Canvas2D's bypass rule: a payload no longer than the emitted count is drawn whole.
    if (n > emitted) {
      mode = UPLOAD_DECIMATED;
      algorithm = selection.algorithm;
      parameter = target;
    }
  }

  if (
    slot.uploadedRevision === payload.revision &&
    slot.uploadedMode === mode &&
    slot.uploadedAlgorithm === algorithm &&
    slot.uploadedParameter === parameter
  ) {
    return;
  }

  slot.uploadedRevision = payload.revision;
  slot.uploadedMode = mode;
  slot.uploadedAlgorithm = algorithm;
  slot.uploadedParameter = parameter;
  slot.markerCount = 0;

  // `length: 0` means "to the end of the view" in WebGL 2, so an empty stream must not reach it.
  if (n === 0) {
    slot.vertexCount = 0;
    return;
  }

  ensureLineObjects(gl, slot);
  const xBuffer = slot.xBuffer;
  const yBuffer = slot.yBuffer;
  if (xBuffer === null || yBuffer === null) return;

  let drawnCount: number;
  if (mode === UPLOAD_FULL) {
    drawnCount = n;
    uploadPair(gl, xBuffer, yBuffer, payload.x, payload.y, n);
    slot.vertexCount = n;
  } else {
    growDecimationScratch(slot, emitted);
    drawnCount = decimateTraceIndices(algorithm ?? "lttb", parameter, payload.x, payload.y, n, slot.indices);
    const px = payload.x;
    const py = payload.y;
    const gatheredX = slot.scratchX;
    const gatheredY = slot.scratchY;
    const indices = slot.indices;
    for (let i = 0; i < drawnCount; i += 1) {
      const j = indices[i] ?? -1;
      // A break index becomes a NaN vertex, which the vertex shader reads as a pen-up gap.
      gatheredX[i] = j < 0 ? NaN : (px[j] ?? NaN);
      gatheredY[i] = j < 0 ? NaN : (py[j] ?? NaN);
    }
    slot.vertexCount = drawnCount;
    if (drawnCount > 0) uploadPair(gl, xBuffer, yBuffer, gatheredX, gatheredY, drawnCount);
  }

  if (!markIsolated || drawnCount === 0) return;
  uploadMarkers(gl, slot, payload, mode === UPLOAD_DECIMATED ? drawnCount : 0, n);
}

/**
 * Counts isolated samples in the stream just uploaded and, only if there are any, gathers their
 * source positions into the marker buffers. The pen-state rules are the shared walk's, so the GPU
 * path and the 2D painters agree on which samples are isolated.
 */
function uploadMarkers(
  gl: Gl2Context,
  slot: TraceGpuSlot,
  payload: SpectrumDataPayload,
  decimatedCount: number,
  directCount: number,
): void {
  const count = countIsolatedSegments(payload.x, payload.y, slot.indices, decimatedCount, directCount);
  if (count === 0) return;

  growMarkerScratch(slot, count);
  collectIsolatedSampleIndices(payload.x, payload.y, slot.indices, decimatedCount, directCount, slot.markerIndices);
  const px = payload.x;
  const py = payload.y;
  const markerIndices = slot.markerIndices;
  const markerX = slot.markerX;
  const markerY = slot.markerY;
  for (let k = 0; k < count; k += 1) {
    const j = markerIndices[k] ?? 0;
    markerX[k] = px[j] ?? NaN;
    markerY[k] = py[j] ?? NaN;
  }

  ensureMarkerObjects(gl, slot);
  const markerXBuffer = slot.markerXBuffer;
  const markerYBuffer = slot.markerYBuffer;
  if (markerXBuffer === null || markerYBuffer === null) return;
  uploadPair(gl, markerXBuffer, markerYBuffer, markerX, markerY, count);
  slot.markerCount = count;
}
