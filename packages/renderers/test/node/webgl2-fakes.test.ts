/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  GL_ARRAY_BUFFER,
  GL_COMPILE_STATUS,
  GL_DYNAMIC_DRAW,
  GL_FRAGMENT_SHADER,
  GL_LINK_STATUS,
  GL_TRIANGLE_STRIP,
  GL_VERTEX_SHADER,
} from "../../src/webgl2/gl-context.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";
import { RecordingOverlayContext } from "./support/recording-overlay-context.js";
import { FakeSurface } from "./support/fake-surface.js";
import { RecordingContext, type RecordedCall } from "./support/recording-context.js";

describe("RecordingGl2Context", () => {
  it("records ordered calls with a gl. prefix", () => {
    const gl = new RecordingGl2Context();
    gl.viewport(0, 0, 10, 20);
    gl.clearColor(0, 0, 0, 0);

    expect(gl.log.map((c) => c.name)).toEqual(["gl.viewport", "gl.clearColor"]);
    expect(gl.log[0]?.args).toEqual([0, 0, 10, 20]);
    expect(gl.callsNamed("viewport")).toHaveLength(1);
    expect(gl.callsNamed("gl.clearColor")).toHaveLength(1);
  });

  it("interleaves with a 2D recording when sharing its log", () => {
    const ctx = new RecordingContext();
    const gl = new RecordingGl2Context({ log: ctx.calls });
    ctx.fillRect(0, 0, 1, 1);
    gl.clear(0x4000);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    expect(ctx.calls.map((c) => c.name)).toEqual(["fillRect", "gl.clear", "setTransform"]);
  });

  it("keeps the bufferData reference and a snapshot of the uploaded range", () => {
    const gl = new RecordingGl2Context();
    const buffer = gl.createBuffer();
    gl.bindBuffer(GL_ARRAY_BUFFER, buffer);
    const data = new Float32Array([1, 2, 3, 4, 5]);
    gl.bufferData(GL_ARRAY_BUFFER, data, GL_DYNAMIC_DRAW, 1, 3);
    data[2] = 99;

    const uploads = gl.bufferUploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.data).toBe(data);
    expect(uploads[0]?.srcOffset).toBe(1);
    expect(uploads[0]?.length).toBe(3);
    expect(Array.from(uploads[0]?.snapshot ?? [])).toEqual([2, 3, 4]);
    expect(uploads[0]?.buffer).toBe(buffer);
  });

  it("treats a zero length as 'to the end of the view', as WebGL does", () => {
    const gl = new RecordingGl2Context();
    gl.bindBuffer(GL_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(GL_ARRAY_BUFFER, new Float32Array([1, 2, 3]), GL_DYNAMIC_DRAW, 0, 0);
    expect(Array.from(gl.bufferUploads()[0]?.snapshot ?? [])).toEqual([1, 2, 3]);
  });

  it("snapshots uniform vector slices at call time", () => {
    const gl = new RecordingGl2Context();
    const program = gl.createProgram();
    const loc = gl.getUniformLocation(program, "u_plot");
    const rows = new Float32Array([0, 0, 1, 2, 3, 4, 0]);
    gl.uniform4fv(loc, rows, 2, 4);
    rows.fill(-1);
    gl.uniform1iv(gl.getUniformLocation(program, "u_yScaleKind"), new Int32Array([0, 1]), 1, 1);

    expect(gl.uniformValues("u_plot")).toEqual([[1, 2, 3, 4]]);
    expect(gl.uniformValues("u_yScaleKind")).toEqual([[1]]);
  });

  it("counts created and deleted objects per kind and tracks the live set", () => {
    const gl = new RecordingGl2Context();
    const a = gl.createBuffer();
    gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.deleteBuffer(a);

    expect(gl.created.buffer).toBe(2);
    expect(gl.deleted.buffer).toBe(1);
    expect(gl.liveCount("buffer")).toBe(1);
    expect(gl.liveCount("vertexArray")).toBe(1);
    gl.deleteVertexArray(vao);
    expect(gl.liveCount("vertexArray")).toBe(0);
  });

  it("reports compile and link failure logs when configured", () => {
    const gl = new RecordingGl2Context({ compileFailureLog: "bad shader", linkFailureLog: "bad link" });
    const shader = gl.createShader(GL_VERTEX_SHADER);
    expect(shader).not.toBeNull();
    if (shader === null) return;
    gl.shaderSource(shader, "src");
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, GL_COMPILE_STATUS)).toBe(false);
    expect(gl.getShaderInfoLog(shader)).toBe("bad shader");
    const program = gl.createProgram();
    gl.linkProgram(program);
    expect(gl.getProgramParameter(program, GL_LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(program)).toBe("bad link");

    const ok = new RecordingGl2Context();
    const fragment = ok.createShader(GL_FRAGMENT_SHADER);
    if (fragment === null) throw new Error("fake returned a null shader");
    ok.compileShader(fragment);
    expect(ok.getShaderParameter(fragment, GL_COMPILE_STATUS)).toBe(true);
  });

  it("returns a recording WEBGL_lose_context extension or null", () => {
    const withExt = new RecordingGl2Context();
    withExt.getExtension("WEBGL_lose_context")?.loseContext();
    expect(withExt.callsNamed("loseContext")).toHaveLength(1);

    const without = new RecordingGl2Context({ loseContextExtension: false });
    expect(without.getExtension("WEBGL_lose_context")).toBeNull();
  });

  it("records nothing when recording is switched off but still balances object counts", () => {
    const gl = new RecordingGl2Context();
    gl.recording = false;
    const buffer = gl.createBuffer();
    gl.bindBuffer(GL_ARRAY_BUFFER, buffer);
    gl.bufferData(GL_ARRAY_BUFFER, new Float32Array(4), GL_DYNAMIC_DRAW, 0, 4);
    gl.drawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, 3);

    expect(gl.log).toHaveLength(0);
    expect(gl.bufferUploads()).toHaveLength(0);
    expect(gl.liveCount("buffer")).toBe(1);
  });
});

describe("RecordingOverlayContext", () => {
  it("writes into a shared log and marks the overlay start with overlay.clearRect", () => {
    const log: RecordedCall[] = [];
    const gl = new RecordingGl2Context({ log });
    const overlay = new RecordingOverlayContext(log);
    gl.clear(0x4000);
    overlay.clearRect(0, 0, 10, 10);
    overlay.fillRect(0, 0, 1, 1);

    expect(log.map((c) => c.name)).toEqual(["gl.clear", "overlay.clearRect", "fillRect"]);
    expect(overlay.calls).toBe(log);
    expect(log[1]?.args).toEqual([0, 0, 10, 10]);
  });

  it("is a RecordingContext, left unmodified", () => {
    expect(new RecordingOverlayContext([])).toBeInstanceOf(RecordingContext);
  });
});

describe("FakeSurface", () => {
  it("has a size and records getContext and addEventListener", () => {
    const gl = new RecordingGl2Context();
    const surface = new FakeSurface(gl);
    surface.width = 12;
    surface.height = 7;
    expect(surface.getContext("webgl2", { alpha: true })).toBe(gl);
    surface.addEventListener("webglcontextlost", () => undefined);

    expect([surface.width, surface.height]).toEqual([12, 7]);
    expect(surface.getContextCalls).toEqual([{ id: "webgl2", attributes: { alpha: true } }]);
    expect(surface.listeners).toEqual(["webglcontextlost"]);
  });

  it("returns the supplied context, or null when none is supplied", () => {
    const overlay = new RecordingOverlayContext([]);
    expect(new FakeSurface(overlay).getContext("2d")).toBe(overlay);
    expect(new FakeSurface(null).getContext("2d")).toBeNull();
  });
});
