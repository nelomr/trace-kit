import { describe, expect, it } from "vitest";

// The attribute set the renderer will request. Kept literal here (rather than imported) so the
// smoke test proves WebGL2 availability independently of any renderer source.
const SMOKE_ATTRIBUTES: WebGLContextAttributes = {
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

function describeRenderer(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  if (info === null) return "WEBGL_debug_renderer_info unavailable";
  return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
}

function clearAndRead(gl: WebGL2RenderingContext): Uint8Array {
  gl.viewport(0, 0, 4, 4);
  gl.clearColor(0.25, 0.5, 0.75, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return pixel;
}

function expectClearColor(pixel: Uint8Array): void {
  // 0.25 / 0.5 / 0.75 of 255 with the rounding GL implementations are allowed.
  expect(Math.abs((pixel[0] ?? 0) - 64)).toBeLessThanOrEqual(1);
  expect(Math.abs((pixel[1] ?? 0) - 128)).toBeLessThanOrEqual(1);
  expect(Math.abs((pixel[2] ?? 0) - 191)).toBeLessThanOrEqual(1);
  expect(pixel[3]).toBe(255);
}

describe("WebGL2 availability smoke", () => {
  it("creates a webgl2 context on an OffscreenCanvas and reads back a cleared pixel", () => {
    expect(typeof OffscreenCanvas).toBe("function");
    const canvas = new OffscreenCanvas(4, 4);
    const gl = canvas.getContext("webgl2", SMOKE_ATTRIBUTES);
    expect(gl).not.toBeNull();
    if (gl === null) return;
    console.info(`webgl2 OffscreenCanvas renderer: ${describeRenderer(gl)}`);
    expectClearColor(clearAndRead(gl));
  });

  it("creates a webgl2 context on a detached HTMLCanvasElement and reads back a cleared pixel", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const gl = canvas.getContext("webgl2", SMOKE_ATTRIBUTES);
    expect(gl).not.toBeNull();
    if (gl === null) return;
    console.info(`webgl2 HTMLCanvasElement renderer: ${describeRenderer(gl)}`);
    expectClearColor(clearAndRead(gl));
  });
});
