/**
 * Per-trace GPU state: the X and Y buffers and the line VAO that reads them as instanced
 * attributes, the marker buffers and VAO (created only when a trace first has an isolated
 * sample), the upload key that says which payload revision and decimation the GPU copy was made
 * from, and the CPU scratch that decimated and marker streams are gathered into.
 *
 * Cold module: it creates and deletes GL objects and grows buffers. The per-frame code in
 * `upload.ts` and `frame.ts` calls into it only on a key change or a first use, never in steady
 * state.
 */
import type { DecimationAlgorithm } from "@trace-kit/core";
import {
  GL_ARRAY_BUFFER,
  GL_FLOAT,
  type Gl2Context,
} from "./gl-context.js";

/** Nothing uploaded yet. */
export const UPLOAD_NONE = 0;
/** The payload's own arrays were uploaded, whole. */
export const UPLOAD_FULL = 1;
/** A decimated stream was gathered into scratch and uploaded. */
export const UPLOAD_DECIMATED = 2;

/** Bytes per float32 element: the stride of a tightly packed single-component attribute. */
const FLOAT_BYTES = 4;

export class TraceGpuSlot {
  xBuffer: WebGLBuffer | null = null;
  yBuffer: WebGLBuffer | null = null;
  lineVao: WebGLVertexArrayObject | null = null;

  markerXBuffer: WebGLBuffer | null = null;
  markerYBuffer: WebGLBuffer | null = null;
  markerVao: WebGLVertexArrayObject | null = null;

  /** The key the GPU copy was made from. A change in any field means the copy is stale. */
  uploadedRevision = -1;
  uploadedMode = UPLOAD_NONE;
  uploadedAlgorithm: DecimationAlgorithm | null = null;
  uploadedParameter = -1;

  /** Vertices in the drawn polyline; the line pass draws `vertexCount - 1` instances. */
  vertexCount = 0;
  /** Isolated-sample markers in the uploaded stream. */
  markerCount = 0;

  /** Decimated stream gather targets and the index stream they are gathered from. Grow-only. */
  scratchX: Float32Array = new Float32Array(0);
  scratchY: Float32Array = new Float32Array(0);
  indices: Int32Array = new Int32Array(0);

  /** Marker source indices and gathered marker positions. Grow-only. */
  markerIndices: Int32Array = new Int32Array(0);
  markerX: Float32Array = new Float32Array(0);
  markerY: Float32Array = new Float32Array(0);
}

export function createTraceSlot(): TraceGpuSlot {
  return new TraceGpuSlot();
}

/** Binds `buffer` to two consecutive instanced attributes: element `i` and element `i + 1`. */
function bindInstancedPair(
  gl: Gl2Context,
  buffer: WebGLBuffer,
  firstLocation: number,
): void {
  gl.bindBuffer(GL_ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(firstLocation);
  gl.vertexAttribPointer(firstLocation, 1, GL_FLOAT, false, FLOAT_BYTES, 0);
  gl.vertexAttribDivisor(firstLocation, 1);
  gl.enableVertexAttribArray(firstLocation + 1);
  gl.vertexAttribPointer(firstLocation + 1, 1, GL_FLOAT, false, FLOAT_BYTES, FLOAT_BYTES);
  gl.vertexAttribDivisor(firstLocation + 1, 1);
}

/**
 * Creates the line buffers and VAO on a slot's first upload. Instance `i` reads elements `i` and
 * `i + 1` of each buffer, through two pointers at byte offsets 0 and 4, so the polyline needs no
 * CPU-side expansion. The VAO binds the pointers once; later `bufferData` calls on the same
 * buffers leave it valid.
 */
export function ensureLineObjects(gl: Gl2Context, slot: TraceGpuSlot): void {
  if (slot.lineVao !== null) return;
  const xBuffer = gl.createBuffer();
  const yBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  bindInstancedPair(gl, xBuffer, 0);
  bindInstancedPair(gl, yBuffer, 2);
  gl.bindVertexArray(null);
  slot.xBuffer = xBuffer;
  slot.yBuffer = yBuffer;
  slot.lineVao = vao;
}

/**
 * Creates the marker buffers and VAO the first time a trace has an isolated sample. One instance
 * per marker reads a single element of each buffer: X at location 0 and Y at location 2, the same
 * numbers the line program uses, so the projection code is shared.
 */
export function ensureMarkerObjects(gl: Gl2Context, slot: TraceGpuSlot): void {
  if (slot.markerVao !== null) return;
  const xBuffer = gl.createBuffer();
  const yBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(GL_ARRAY_BUFFER, xBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 1, GL_FLOAT, false, FLOAT_BYTES, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.bindBuffer(GL_ARRAY_BUFFER, yBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, GL_FLOAT, false, FLOAT_BYTES, 0);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);
  slot.markerXBuffer = xBuffer;
  slot.markerYBuffer = yBuffer;
  slot.markerVao = vao;
}

/** Grows the decimation scratch to hold `emitted` vertices. Never shrinks. */
export function growDecimationScratch(slot: TraceGpuSlot, emitted: number): void {
  if (slot.indices.length < emitted) slot.indices = new Int32Array(emitted);
  if (slot.scratchX.length < emitted) slot.scratchX = new Float32Array(emitted);
  if (slot.scratchY.length < emitted) slot.scratchY = new Float32Array(emitted);
}

/** Grows the marker scratch to hold `count` markers. Never shrinks. */
export function growMarkerScratch(slot: TraceGpuSlot, count: number): void {
  if (slot.markerIndices.length < count) slot.markerIndices = new Int32Array(count);
  if (slot.markerX.length < count) slot.markerX = new Float32Array(count);
  if (slot.markerY.length < count) slot.markerY = new Float32Array(count);
}

/** Deletes every GL object the slot owns and forgets them. Safe to call twice. */
export function releaseTraceSlot(gl: Gl2Context, slot: TraceGpuSlot): void {
  gl.deleteBuffer(slot.xBuffer);
  gl.deleteBuffer(slot.yBuffer);
  gl.deleteVertexArray(slot.lineVao);
  gl.deleteBuffer(slot.markerXBuffer);
  gl.deleteBuffer(slot.markerYBuffer);
  gl.deleteVertexArray(slot.markerVao);
  slot.xBuffer = null;
  slot.yBuffer = null;
  slot.lineVao = null;
  slot.markerXBuffer = null;
  slot.markerYBuffer = null;
  slot.markerVao = null;
  slot.uploadedRevision = -1;
  slot.uploadedMode = UPLOAD_NONE;
  slot.vertexCount = 0;
  slot.markerCount = 0;
}
