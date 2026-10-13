/**
 * The per-frame GL work: global state, then for every trace its uniforms and its instanced draws.
 * Everything here runs on every `render()`, so it is allocation-free: uniforms are written into
 * rows of one preallocated `Float32Array` and uploaded through the WebGL 2 offset overloads
 * (`uniform4fv(location, rows, base + 10, 4)`), never through a sliced view or a temporary array.
 *
 * One row per trace, `UNIFORM_ROW_STRIDE` floats:
 *
 *   [0..1] x origin hi, lo   [2] x scale        [3] line width (device px)
 *   [4..7] plot left, top, width, height        [8..9] device width, height
 *   [10..13] y base, y scale, y log domain min, y log scale
 *   [14..17] color (straight alpha)             [18] marker side (device px)   [19] one (always 1)
 */
import type { DecimationSelection, SpectrumDataPayload, ViewportTransform } from "@trace-kit/core";
import { Y_SCALE_KIND_LOG } from "@trace-kit/core";
import { isolatedMarkerHalfSide } from "../path/isolated-markers.js";
import {
  GL_BLEND,
  GL_COLOR_BUFFER_BIT,
  GL_ONE,
  GL_ONE_MINUS_SRC_ALPHA,
  GL_SCISSOR_TEST,
  GL_TRIANGLE_STRIP,
  type Gl2Context,
} from "./gl-context.js";
import { splitFloat64ToHiLo } from "./precision.js";
import type { GlPrograms, SharedUniforms } from "./program.js";
import type { TraceGpuSlot } from "./trace-slot.js";
import { ensureTraceUploaded } from "./upload.js";

export const UNIFORM_ROW_STRIDE = 20;

const ROW_ORIGIN = 0;
const ROW_X_SCALE = 2;
const ROW_LINE_WIDTH = 3;
const ROW_PLOT = 4;
const ROW_DEVICE = 8;
const ROW_Y = 10;
const ROW_COLOR = 14;
const ROW_MARKER_SIDE = 18;
/** The padding float carries `u_one`, a constant 1 the shader multiplies the first X difference by. */
const ROW_ONE = 19;

/**
 * Everything the frame needs, built once by the renderer and grown only when the trace set
 * changes. The per-trace columns are parallel arrays indexed by collection position.
 */
export class FrameState {
  readonly gl: Gl2Context;
  readonly programs: GlPrograms;
  /** The primary axis transform: its device size sets the viewport and its plot rectangle the
   * scissor, since every axis shares one plot geometry. */
  primary: ViewportTransform;
  /** `null` is the backend default: draw the full payload. */
  selection: DecimationSelection | null = null;

  transforms: ViewportTransform[] = [];
  payloads: SpectrumDataPayload[] = [];
  rows: Float32Array = new Float32Array(0);
  scaleKinds: Int32Array = new Int32Array(0);
  lineWidthCss: Float64Array = new Float64Array(0);
  markIsolated: Uint8Array = new Uint8Array(0);

  constructor(gl: Gl2Context, programs: GlPrograms, primary: ViewportTransform) {
    this.gl = gl;
    this.programs = programs;
    this.primary = primary;
  }

  /** Sizes the per-trace columns for `count` traces. Cold: called when the trace set changes. */
  allocate(count: number): void {
    this.transforms = [];
    this.payloads = [];
    this.rows = new Float32Array(count * UNIFORM_ROW_STRIDE);
    this.scaleKinds = new Int32Array(count);
    this.lineWidthCss = new Float64Array(count);
    this.markIsolated = new Uint8Array(count);
  }
}

/** Writes the uniforms both programs share from one row. */
function uploadSharedUniforms(
  gl: Gl2Context,
  u: SharedUniforms,
  rows: Float32Array,
  scaleKinds: Int32Array,
  base: number,
  index: number,
): void {
  gl.uniform2fv(u.xOrigin, rows, base + ROW_ORIGIN, 2);
  gl.uniform1fv(u.one, rows, base + ROW_ONE, 1);
  gl.uniform1fv(u.xScale, rows, base + ROW_X_SCALE, 1);
  gl.uniform4fv(u.plot, rows, base + ROW_PLOT, 4);
  gl.uniform2fv(u.device, rows, base + ROW_DEVICE, 2);
  gl.uniform4fv(u.y, rows, base + ROW_Y, 4);
  gl.uniform1iv(u.yScaleKind, scaleKinds, index, 1);
  gl.uniform4fv(u.color, rows, base + ROW_COLOR, 4);
}

/** Clears the plot canvas to transparent. The scissor is disabled first so the clear covers the
 * gutters too, not just the plot rectangle the previous frame drew into. */
export function clearGlCanvas(gl: Gl2Context, primary: ViewportTransform): void {
  gl.disable(GL_SCISSOR_TEST);
  gl.viewport(0, 0, primary.deviceWidth, primary.deviceHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(GL_COLOR_BUFFER_BIT);
}

/**
 * Clears the plot canvas to transparent and draws every trace, in collection order, so a later
 * trace paints over an earlier one and a trace's markers paint over its own line.
 */
export function drawGlFrame(frame: FrameState, slots: readonly TraceGpuSlot[], count: number): void {
  const gl = frame.gl;
  const primary = frame.primary;

  // The clear must not be clipped by the scissor of the previous frame, or the gutters would keep
  // stale ink: scissor off, clear, then scissor to the plot rectangle for the draws.
  clearGlCanvas(gl, primary);
  gl.enable(GL_SCISSOR_TEST);
  // floor/ceil so a fractional plot inset (dpr 1.5) never clips the outermost ink column; GL's
  // origin is bottom-left, hence the flipped Y.
  const scissorX = Math.floor(primary.plotLeft);
  const scissorRight = Math.ceil(primary.plotLeft + primary.plotWidth);
  const scissorBottom = Math.floor(primary.deviceHeight - (primary.plotTop + primary.plotHeight));
  const scissorTop = Math.ceil(primary.deviceHeight - primary.plotTop);
  gl.scissor(scissorX, scissorBottom, scissorRight - scissorX, scissorTop - scissorBottom);
  gl.enable(GL_BLEND);
  gl.blendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);

  const programs = frame.programs;
  const rows = frame.rows;
  const scaleKinds = frame.scaleKinds;

  for (let i = 0; i < count; i += 1) {
    const slot = slots[i];
    const payload = frame.payloads[i];
    const t = frame.transforms[i];
    if (slot === undefined || payload === undefined || t === undefined) continue;
    const markIsolated = (frame.markIsolated[i] ?? 1) === 1;

    ensureTraceUploaded(gl, slot, payload, t.plotWidth, frame.selection, markIsolated);
    const drawLine = slot.vertexCount >= 2;
    const drawMarkers = markIsolated && slot.markerCount > 0;
    if (!drawLine && !drawMarkers) continue;

    const base = i * UNIFORM_ROW_STRIDE;
    const lineWidthCss = frame.lineWidthCss[i] ?? 0;
    splitFloat64ToHiLo(t.xDomainMin, rows, base + ROW_ORIGIN);
    rows[base + ROW_X_SCALE] = t.xScale;
    rows[base + ROW_LINE_WIDTH] = lineWidthCss * t.dpr;
    rows[base + ROW_PLOT] = t.plotLeft;
    rows[base + ROW_PLOT + 1] = t.plotTop;
    rows[base + ROW_PLOT + 2] = t.plotWidth;
    rows[base + ROW_PLOT + 3] = t.plotHeight;
    rows[base + ROW_DEVICE] = t.deviceWidth;
    rows[base + ROW_DEVICE + 1] = t.deviceHeight;
    rows[base + ROW_Y] = t.yBase;
    // `yScale` is NaN on a log axis by design; the shader reads the log scale there and a NaN
    // uniform would poison nothing but is meaningless, so the slot carries a defined zero.
    const isLog = t.yScaleKind === Y_SCALE_KIND_LOG;
    rows[base + ROW_Y + 1] = isLog ? 0 : t.yScale;
    rows[base + ROW_Y + 2] = t.yLogDomainMin;
    rows[base + ROW_Y + 3] = t.yLogScale;
    rows[base + ROW_ONE] = 1;
    rows[base + ROW_MARKER_SIDE] = 2 * isolatedMarkerHalfSide(lineWidthCss, t.dpr);
    scaleKinds[i] = t.yScaleKind;

    if (drawLine) {
      gl.useProgram(programs.line);
      uploadSharedUniforms(gl, programs.lineUniforms, rows, scaleKinds, base, i);
      gl.uniform1fv(programs.lineUniforms.lineWidth, rows, base + ROW_LINE_WIDTH, 1);
      gl.bindVertexArray(slot.lineVao);
      gl.drawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, slot.vertexCount - 1);
    }
    if (drawMarkers) {
      gl.useProgram(programs.marker);
      uploadSharedUniforms(gl, programs.markerUniforms, rows, scaleKinds, base, i);
      gl.uniform1fv(programs.markerUniforms.markerSide, rows, base + ROW_MARKER_SIDE, 1);
      gl.bindVertexArray(slot.markerVao);
      gl.drawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, slot.markerCount);
    }
  }
  gl.bindVertexArray(null);
}
