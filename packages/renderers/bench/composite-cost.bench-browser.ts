import { commands } from "vitest/browser";
import { describe, it } from "vitest";
import { median, percentile } from "@trace-kit/bench-harness";
import {
  PROJECTION_GLSL,
  SHARED_UNIFORMS_GLSL,
  VERSION_AND_PRECISION,
} from "../src/webgl2/shaders.js";

// Spike probe for the composited WebGL2 surface. Two measurements, both recorded as JSON next to
// this file and judged by a human reading the numbers; this file asserts nothing and carries no
// threshold, so it can never gate a test run.
//
//  1. Composite cost: how long copying a rendered WebGL canvas into a 2D canvas takes
//     (`drawImage` plus a 1x1 `getImageData` that forces the copy to complete), for both a
//     detached `OffscreenCanvas` and a detached `HTMLCanvasElement` as the GL host.
//  2. Deep-zoom probe: whether the shader compiler preserves the `(offset - hi) - lo`
//     evaluation order. A reassociated `offset - (hi + lo)` collapses back to a single float32
//     origin and loses the sub-pixel precision the hi/lo split exists to keep.

const WIDTH = 1600;
const HEIGHT = 1200;
const WARMUP_FRAMES = 50;
const MEASURED_FRAMES = 300;
const TRACE_POINTS = 1600;

type GlHost = "OffscreenCanvas" | "HTMLCanvasElement";

interface FrameStats {
  readonly host: GlHost;
  readonly warmup: number;
  readonly frames: number;
  readonly copyMedianMs: number;
  readonly copyP95Ms: number;
  readonly wholeFrameMedianMs: number;
  readonly wholeFrameP95Ms: number;
}

interface BaselineStats {
  readonly description: string;
  readonly medianMs: number;
  readonly p95Ms: number;
}

interface DeepZoomResult {
  readonly samples: number;
  readonly maxErrorPx: number;
  /** Float32 emulation with no `lo` term, as a control that the input is not trivially exact. */
  readonly naiveMaxErrorPx: number;
  readonly maxInkColumnDelta: number;
  readonly inkColumnsMatched: number;
  readonly failThresholdPx: number;
  readonly verdict: "PASS" | "FAIL";
}

const GL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "default",
  failIfMajorPerformanceCaveat: false,
  desynchronized: false,
};

const TRACE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const TRACE_FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(0.25, 0.7, 1.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("createShader returned null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader) ?? ""}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? ""}`);
  }
  return program;
}

function createGlHost(host: GlHost): { gl: WebGL2RenderingContext; resize: () => void } {
  if (host === "OffscreenCanvas") {
    const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    const gl = canvas.getContext("webgl2", GL_ATTRIBUTES);
    if (gl === null) throw new Error("webgl2 unavailable on OffscreenCanvas");
    return { gl, resize: () => undefined };
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl2", GL_ATTRIBUTES);
  if (gl === null) throw new Error("webgl2 unavailable on HTMLCanvasElement");
  return { gl, resize: () => undefined };
}

function measureComposite(host: GlHost): FrameStats {
  const { gl } = createGlHost(host);
  const glCanvas = gl.canvas;

  const target = document.createElement("canvas");
  target.width = WIDTH;
  target.height = HEIGHT;
  const ctx = target.getContext("2d", { alpha: false });
  if (ctx === null) throw new Error("2d context unavailable");

  const program = link(gl, TRACE_VERTEX, TRACE_FRAGMENT);
  const positions = new Float32Array(TRACE_POINTS * 2);
  for (let i = 0; i < TRACE_POINTS; i += 1) {
    const t = i / (TRACE_POINTS - 1);
    positions[i * 2] = t * 2 - 1;
    positions[i * 2 + 1] = 0.6 * Math.sin(t * 40) * Math.exp(-t);
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  gl.viewport(0, 0, WIDTH, HEIGHT);

  const copy: number[] = [];
  const whole: number[] = [];
  const total = WARMUP_FRAMES + MEASURED_FRAMES;
  for (let frame = 0; frame < total; frame += 1) {
    const frameStart = performance.now();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.LINE_STRIP, 0, TRACE_POINTS);
    // Excludes the GL execution itself from the timed copy: only the transfer into the 2D
    // backing store and the readback that forces it to complete are measured below.
    gl.finish();
    const copyStart = performance.now();
    ctx.drawImage(glCanvas, 0, 0);
    ctx.getImageData(0, 0, 1, 1);
    const end = performance.now();
    if (frame >= WARMUP_FRAMES) {
      copy.push(end - copyStart);
      whole.push(end - frameStart);
    }
  }
  copy.sort((a, b) => a - b);
  whole.sort((a, b) => a - b);
  return {
    host,
    warmup: WARMUP_FRAMES,
    frames: MEASURED_FRAMES,
    copyMedianMs: median(copy),
    copyP95Ms: percentile(copy, 95),
    wholeFrameMedianMs: median(whole),
    wholeFrameP95Ms: percentile(whole, 95),
  };
}

// Control for the composite measurement: the same readback on the same-size 2D canvas with a
// plain `fillRect` instead of a `drawImage` of a GL canvas. Whatever this costs is the price of
// forcing the 2D backing store to flush, not of the GL-to-2D copy, so it is reported next to the
// composite numbers to let a reader tell the two apart.
function measureReadbackBaseline(): BaselineStats {
  const target = document.createElement("canvas");
  target.width = WIDTH;
  target.height = HEIGHT;
  const ctx = target.getContext("2d", { alpha: false });
  if (ctx === null) throw new Error("2d context unavailable");
  const samples: number[] = [];
  for (let frame = 0; frame < WARMUP_FRAMES + MEASURED_FRAMES; frame += 1) {
    const start = performance.now();
    ctx.fillStyle = frame % 2 === 0 ? "#102030" : "#203040";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.getImageData(0, 0, 1, 1);
    const end = performance.now();
    if (frame >= WARMUP_FRAMES) samples.push(end - start);
  }
  samples.sort((a, b) => a - b);
  return {
    description: "fillRect of the full 2D canvas + getImageData(0,0,1,1), no GL canvas involved",
    medianMs: median(samples),
    p95Ms: percentile(samples, 95),
  };
}

// Evaluates the production `projectXDevice` (the exported shader chunk, not a copy) with `u_one`
// set to 1 and writes the resulting device-pixel X of every sample into one texel of a float render
// target, so the value is read back exactly rather than through 1 px ink columns.
const PROBE_VERTEX = `${VERSION_AND_PRECISION}${SHARED_UNIFORMS_GLSL}
uniform float u_count;
layout(location = 0) in float a_offset;
flat out float v_px;
${PROJECTION_GLSL}
void main() {
  v_px = projectXDevice(a_offset);
  float column = float(gl_VertexID);
  gl_Position = vec4((column + 0.5) / u_count * 2.0 - 1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const PROBE_FRAGMENT = `#version 300 es
precision highp float;
flat in float v_px;
out vec4 outColor;
void main() {
  outColor = vec4(v_px, 0.0, 0.0, 1.0);
}`;

/** Threshold, in device pixels, above which the probe flags a FAIL. Reported, never asserted. */
const PROBE_FAIL_PX = 0.01;

function runDeepZoomProbe(): DeepZoomResult {
  const canvas = new OffscreenCanvas(1001, 1);
  const context = canvas.getContext("webgl2", GL_ATTRIBUTES);
  if (context === null) throw new Error("webgl2 unavailable for the deep-zoom probe");
  const gl: WebGL2RenderingContext = context;
  if (gl.getExtension("EXT_color_buffer_float") === null) {
    throw new Error("EXT_color_buffer_float unavailable: cannot read back exact positions");
  }

  const count = 1001;
  const d = 1000.00002;
  const span = 0.01;
  const plotLeft = 56;
  const plotWidth = 1000;
  const scale64 = plotWidth / span;

  const offsets = new Float32Array(count);
  for (let i = 0; i < count; i += 1) offsets[i] = d + (i / (count - 1)) * span;

  const hi = Math.fround(d);
  const lo = Math.fround(d - hi);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, count, 1);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("float framebuffer incomplete");
  }

  const program = link(gl, PROBE_VERTEX, PROBE_FRAGMENT);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  gl.viewport(0, 0, count, 1);
  gl.uniform2f(gl.getUniformLocation(program, "u_xOrigin"), hi, lo);
  gl.uniform1f(gl.getUniformLocation(program, "u_one"), 1);
  gl.uniform1f(gl.getUniformLocation(program, "u_xScale"), scale64);
  gl.uniform4f(gl.getUniformLocation(program, "u_plot"), plotLeft, 0, plotWidth, 100);
  gl.uniform2f(gl.getUniformLocation(program, "u_device"), 1200, 200);
  gl.uniform4f(gl.getUniformLocation(program, "u_y"), 100, 1, 0, 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_yScaleKind"), 0);
  gl.uniform1f(gl.getUniformLocation(program, "u_count"), count);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.POINTS, 0, count);
  const gpuPositions = new Float32Array(count * 4);
  gl.readPixels(0, 0, count, 1, gl.RGBA, gl.FLOAT, gpuPositions);

  const f = Math.fround;
  let maxError = 0;
  let naiveMaxError = 0;
  let maxInkColumnDelta = 0;
  let inkColumnsMatched = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = offsets[i] ?? 0;
    const reference = plotLeft + (offset - d) * scale64;
    const gpu = gpuPositions[i * 4] ?? NaN;
    const naive = f(f(f(offset - hi) * f(scale64)) + f(plotLeft));
    maxError = Math.max(maxError, Math.abs(gpu - reference));
    naiveMaxError = Math.max(naiveMaxError, Math.abs(naive - reference));
    const inkDelta = Math.abs(Math.floor(gpu) - Math.floor(reference));
    maxInkColumnDelta = Math.max(maxInkColumnDelta, inkDelta);
    if (inkDelta === 0) inkColumnsMatched += 1;
  }
  return {
    samples: count,
    maxErrorPx: maxError,
    naiveMaxErrorPx: naiveMaxError,
    maxInkColumnDelta,
    inkColumnsMatched,
    failThresholdPx: PROBE_FAIL_PX,
    verdict: maxError < PROBE_FAIL_PX ? "PASS" : "FAIL",
  };
}

describe("composite cost and deep-zoom spike", () => {
  it("measures the composite copy for both hidden-canvas kinds and probes the deep-zoom order", async () => {
    const renderer = (() => {
      const gl = new OffscreenCanvas(1, 1).getContext("webgl2", GL_ATTRIBUTES);
      if (gl === null) return "webgl2 unavailable";
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return info === null ? "renderer hidden" : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    })();

    const results = {
      renderer,
      userAgent: navigator.userAgent,
      canvas: { width: WIDTH, height: HEIGHT },
      offscreen: measureComposite("OffscreenCanvas"),
      element: measureComposite("HTMLCanvasElement"),
      readbackBaseline: measureReadbackBaseline(),
      deepZoom: runDeepZoomProbe(),
    };
    await commands.writeFile(
      "bench/composite-cost-results.json",
      `${JSON.stringify(results, null, 2)}\n`,
    );
  });
});
