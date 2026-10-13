/** @vitest-environment node */
import { readFileSync } from "node:fs";
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  createViewportTransform,
  type DecimationSelection,
  type SpectrumDataPayload,
  type ViewportTransform,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
} from "@trace-kit/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GL_BLEND,
  GL_COLOR_BUFFER_BIT,
  GL_ONE,
  GL_ONE_MINUS_SRC_ALPHA,
  GL_SCISSOR_TEST,
  GL_TRIANGLE_STRIP,
} from "../../src/webgl2/gl-context.js";
import { drawGlFrame, FrameState, UNIFORM_ROW_STRIDE } from "../../src/webgl2/frame.js";
import { createGlPrograms } from "../../src/webgl2/program.js";
import { GUARD_BAND_PX } from "../../src/webgl2/shaders.js";
import { splitFloat64ToHiLo } from "../../src/webgl2/precision.js";
import { createTraceSlot, type TraceGpuSlot } from "../../src/webgl2/trace-slot.js";
import { FakeUniformLocation, RecordingGl2Context } from "./support/recording-gl2-context.js";

interface TraceSpec {
  readonly payload: SpectrumDataPayload;
  readonly transform: ViewportTransform;
  readonly lineWidthCss?: number;
  readonly color?: readonly [number, number, number, number];
  readonly markIsolated?: boolean;
}

function transformFor(options: {
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
  xDomainMin?: number;
  xDomainMax?: number;
  yDomainMin?: number;
  yDomainMax?: number;
  yScaleKind?: number;
  xOrigin?: number;
  insetLeft?: number;
}): ViewportTransform {
  return createViewportTransform({
    cssWidth: options.cssWidth ?? 500,
    cssHeight: options.cssHeight ?? 300,
    dpr: options.dpr ?? 1,
    insetLeft: options.insetLeft ?? 56,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 28,
    xDomainMin: options.xDomainMin ?? 0,
    xDomainMax: options.xDomainMax ?? 100,
    yDomainMin: options.yDomainMin ?? -1,
    yDomainMax: options.yDomainMax ?? 1,
    xOrigin: options.xOrigin ?? 0,
    ...(options.yScaleKind === undefined ? {} : { yScaleKind: options.yScaleKind }),
  });
}

function payloadOf(n: number, y: (i: number) => number = (i) => Math.sin(i / 5)): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: Math.max(1, n), xOrigin: 0, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < n; i += 1) {
    payload.x[i] = i;
    payload.y[i] = y(i);
  }
  commitPayloadRevision(payload, n);
  return payload;
}

interface Harness {
  readonly gl: RecordingGl2Context;
  readonly frame: FrameState;
  readonly slots: TraceGpuSlot[];
}

function harness(specs: readonly TraceSpec[], selection: DecimationSelection | null = null): Harness {
  const gl = new RecordingGl2Context();
  const programs = createGlPrograms(gl);
  const first = specs[0]?.transform ?? transformFor({});
  const frame = new FrameState(gl, programs, first);
  frame.allocate(specs.length);
  frame.selection = selection;
  const slots: TraceGpuSlot[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    frame.transforms[i] = spec.transform;
    frame.payloads[i] = spec.payload;
    frame.lineWidthCss[i] = spec.lineWidthCss ?? 1.5;
    frame.markIsolated[i] = spec.markIsolated === false ? 0 : 1;
    const color = spec.color ?? [0.25, 0.5, 0.75, 1];
    for (let c = 0; c < 4; c += 1) frame.rows[i * UNIFORM_ROW_STRIDE + 14 + c] = color[c] ?? 0;
    slots.push(createTraceSlot());
  }
  return { gl, frame, slots };
}

function drawNames(gl: RecordingGl2Context): string[] {
  return gl.log.map((call) => call.name);
}

let h: Harness;

describe("per-frame GL state", () => {
  beforeEach(() => {
    h = harness([{ payload: payloadOf(100), transform: transformFor({ dpr: 1 }) }]);
    drawGlFrame(h.frame, h.slots, 1);
  });

  it("clears with the scissor disabled, then enables scissor and premultiplied blending", () => {
    const names = drawNames(h.gl).filter((name) =>
      ["gl.disable", "gl.viewport", "gl.clearColor", "gl.clear", "gl.enable", "gl.scissor", "gl.blendFuncSeparate"].includes(name),
    );
    expect(names.slice(0, 7)).toEqual([
      "gl.disable",
      "gl.viewport",
      "gl.clearColor",
      "gl.clear",
      "gl.enable",
      "gl.scissor",
      "gl.enable",
    ]);
    const calls = h.gl.log.filter((call) => ["gl.disable", "gl.enable", "gl.clear", "gl.clearColor"].includes(call.name));
    expect(calls[0]).toMatchObject({ name: "gl.disable", args: [GL_SCISSOR_TEST] });
    expect(calls[1]).toMatchObject({ name: "gl.clearColor", args: [0, 0, 0, 0] });
    expect(calls[2]).toMatchObject({ name: "gl.clear", args: [GL_COLOR_BUFFER_BIT] });
    expect(calls[3]).toMatchObject({ name: "gl.enable", args: [GL_SCISSOR_TEST] });
    expect(calls[4]).toMatchObject({ name: "gl.enable", args: [GL_BLEND] });
    expect(h.gl.callsNamed("blendFuncSeparate")[0]?.args).toEqual([
      GL_ONE,
      GL_ONE_MINUS_SRC_ALPHA,
      GL_ONE,
      GL_ONE_MINUS_SRC_ALPHA,
    ]);
  });

  it("sets the viewport from the primary transform's device size", () => {
    expect(h.gl.callsNamed("viewport")[0]?.args).toEqual([0, 0, 500, 300]);
  });

  it("scissors the plot rectangle in GL's bottom-left space", () => {
    // plot: left 56, top 0, width 444, height 272 at dpr 1 -> GL y = 300 - 272 = 28.
    expect(h.gl.callsNamed("scissor")[0]?.args).toEqual([56, 28, 444, 272]);
  });
});

describe("scissor rounding", () => {
  it("contains a fractional plot inset with floor and ceil at dpr 1.5", () => {
    const t = transformFor({ dpr: 1.5, cssWidth: 501, cssHeight: 317, insetLeft: 55 });
    const local = harness([{ payload: payloadOf(10), transform: t }]);
    drawGlFrame(local.frame, local.slots, 1);

    const x0 = Math.floor(t.plotLeft);
    const x1 = Math.ceil(t.plotLeft + t.plotWidth);
    const glBottom = Math.floor(t.deviceHeight - (t.plotTop + t.plotHeight));
    const glTop = Math.ceil(t.deviceHeight - t.plotTop);
    expect(t.plotLeft).toBe(82.5);
    expect(Number.isInteger(t.plotLeft) && Number.isInteger(t.plotWidth)).toBe(false);
    expect(local.gl.callsNamed("scissor")[0]?.args).toEqual([x0, glBottom, x1 - x0, glTop - glBottom]);
    expect(x1 - x0).toBeGreaterThanOrEqual(t.plotWidth);
  });
});

describe("uniform rows", () => {
  it("lays out one 20-float row per trace", () => {
    expect(UNIFORM_ROW_STRIDE).toBe(20);
  });

  it("uploads every uniform of a linear trace from its own transform", () => {
    const t = transformFor({ dpr: 2, xDomainMin: 1000.00002, xDomainMax: 1000.01002, yDomainMin: -3, yDomainMax: 5 });
    const local = harness([{ payload: payloadOf(50), transform: t, color: [0.1, 0.2, 0.3, 1], lineWidthCss: 1.5 }]);
    drawGlFrame(local.frame, local.slots, 1);

    const hiLo = new Float32Array(2);
    splitFloat64ToHiLo(t.xDomainMin, hiLo, 0);
    const f = Math.fround;
    expect(local.gl.uniformValues("u_xOrigin")[0]).toEqual([hiLo[0], hiLo[1]]);
    expect(local.gl.uniformValues("u_xScale")[0]).toEqual([f(t.xScale)]);
    expect(local.gl.uniformValues("u_lineWidth")[0]).toEqual([f(1.5 * 2)]);
    expect(local.gl.uniformValues("u_plot")[0]).toEqual([f(t.plotLeft), f(t.plotTop), f(t.plotWidth), f(t.plotHeight)]);
    expect(local.gl.uniformValues("u_device")[0]).toEqual([t.deviceWidth, t.deviceHeight]);
    expect(local.gl.uniformValues("u_y")[0]).toEqual([f(t.yBase), f(t.yScale), f(t.yLogDomainMin), f(t.yLogScale)]);
    expect(local.gl.uniformValues("u_yScaleKind")[0]).toEqual([Y_SCALE_KIND_LINEAR]);
    expect(local.gl.uniformValues("u_color")[0]).toEqual([f(0.1), f(0.2), f(0.3), 1]);
  });

  it("writes u_one as exactly 1 before every draw of both programs", () => {
    const t = transformFor({});
    const isolated = (i: number): number => (i === 3 ? 1 : NaN);
    const local = harness([
      { payload: payloadOf(10, isolated), transform: t },
      { payload: payloadOf(50), transform: t },
    ]);
    drawGlFrame(local.frame, local.slots, 2);

    const draws = local.gl.callsNamed("drawArraysInstanced").length;
    expect(draws).toBe(3);
    expect(local.gl.uniformValues("u_one")).toEqual([[1], [1], [1]]);
    let oneWritten = false;
    for (const call of local.gl.log) {
      if (call.name === "gl.uniform1fv" && call.args[0] instanceof FakeUniformLocation && call.args[0].name === "u_one") {
        oneWritten = true;
      }
      if (call.name === "gl.drawArraysInstanced") {
        expect(oneWritten).toBe(true);
        oneWritten = false;
      }
    }
  });

  it("derives the hi/lo origin in Float64 from the transform's xDomainMin, not xOrigin", () => {
    const t = transformFor({ xDomainMin: 12.5, xDomainMax: 20, xOrigin: 987654.321 });
    const local = harness([{ payload: payloadOf(20), transform: t }]);
    drawGlFrame(local.frame, local.slots, 1);

    const expected = new Float32Array(2);
    splitFloat64ToHiLo(12.5, expected, 0);
    expect(local.gl.uniformValues("u_xOrigin")[0]).toEqual([expected[0], expected[1]]);
  });

  it("multiplies the line width by dpr unsnapped, per trace", () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const t = transformFor({ dpr });
      const local = harness([
        { payload: payloadOf(20), transform: t, lineWidthCss: 1.5 },
        { payload: payloadOf(20), transform: t, lineWidthCss: 0.5 },
      ]);
      drawGlFrame(local.frame, local.slots, 2);
      expect(local.gl.uniformValues("u_lineWidth")).toEqual([[Math.fround(1.5 * dpr)], [Math.fround(0.5 * dpr)]]);
    }
  });

  it("writes zero for the Y scale on a log axis, never NaN, and the log uniforms from the transform", () => {
    const t = transformFor({ yDomainMin: 1, yDomainMax: 1000, yScaleKind: Y_SCALE_KIND_LOG });
    expect(Number.isNaN(t.yScale)).toBe(true);
    const local = harness([{ payload: payloadOf(20, (i) => i + 1), transform: t }]);
    drawGlFrame(local.frame, local.slots, 1);

    const y = local.gl.uniformValues("u_y")[0];
    expect(y?.[1]).toBe(0);
    expect(y?.some((v) => Number.isNaN(v))).toBe(false);
    expect(y?.[2]).toBe(Math.fround(t.yLogDomainMin));
    expect(y?.[3]).toBe(Math.fround(t.yLogScale));
    expect(local.gl.uniformValues("u_yScaleKind")[0]).toEqual([Y_SCALE_KIND_LOG]);
  });

  it("gives each trace the uniforms of its own transform on dual axes", () => {
    const linear = transformFor({ yDomainMin: -2, yDomainMax: 2 });
    const log = transformFor({ yDomainMin: 1, yDomainMax: 100, yScaleKind: Y_SCALE_KIND_LOG });
    const local = harness([
      { payload: payloadOf(20), transform: linear },
      { payload: payloadOf(20, (i) => i + 1), transform: log },
    ]);
    drawGlFrame(local.frame, local.slots, 2);

    expect(local.gl.uniformValues("u_yScaleKind")).toEqual([[Y_SCALE_KIND_LINEAR], [Y_SCALE_KIND_LOG]]);
    expect(local.gl.uniformValues("u_y")[0]?.[1]).toBe(Math.fround(linear.yScale));
    expect(local.gl.uniformValues("u_y")[1]?.[3]).toBe(Math.fround(log.yLogScale));
  });

  it("uploads the marker side as twice the isolated-marker half side", () => {
    const t = transformFor({ dpr: 2 });
    const gapped = payloadOf(10, (i) => (i === 4 ? 1 : NaN));
    const local = harness([{ payload: gapped, transform: t, lineWidthCss: 1.5 }]);
    drawGlFrame(local.frame, local.slots, 1);
    expect(local.gl.uniformValues("u_markerSide")[0]).toEqual([6]);
  });
});

describe("draw sequence", () => {
  it("draws one instanced strip per trace, in collection order, with n - 1 instances", () => {
    const t = transformFor({});
    const local = harness([
      { payload: payloadOf(1000), transform: t },
      { payload: payloadOf(500), transform: t },
    ]);
    drawGlFrame(local.frame, local.slots, 2);

    const draws = local.gl.callsNamed("drawArraysInstanced").map((call) => call.args);
    expect(draws).toEqual([
      [GL_TRIANGLE_STRIP, 0, 4, 999],
      [GL_TRIANGLE_STRIP, 0, 4, 499],
    ]);
    // Per trace: program, uniforms, VAO, draw, in that order.
    const names = drawNames(local.gl);
    const firstUse = names.indexOf("gl.useProgram");
    const firstDraw = names.indexOf("gl.drawArraysInstanced");
    expect(names.slice(firstUse, firstDraw)).toContain("gl.bindVertexArray");
    expect(names.slice(firstUse, firstDraw)).toContain("gl.uniform4fv");
  });

  it("draws a marker pass only for a trace that opts in and has isolated samples", () => {
    const t = transformFor({});
    const isolated = (i: number): number => (i === 3 ? 1 : NaN);
    const local = harness([
      { payload: payloadOf(10, isolated), transform: t, markIsolated: true },
      { payload: payloadOf(10, isolated), transform: t, markIsolated: false },
      { payload: payloadOf(10), transform: t, markIsolated: true },
    ]);
    drawGlFrame(local.frame, local.slots, 3);

    const draws = local.gl.callsNamed("drawArraysInstanced").map((call) => call.args);
    // Three line passes (the CPU does not know which instances the shader collapses) and exactly
    // one marker pass: trace 0 opts in and has an isolated sample, trace 1 opts out, trace 2 has
    // no isolated sample.
    expect(draws.filter((a) => a[3] === 9)).toHaveLength(3);
    expect(draws.filter((a) => a[3] === 1)).toHaveLength(1);
    expect(draws).toHaveLength(4);
  });

  it("draws no line pass for zero or one sample but still clears", () => {
    const empty = harness([{ payload: payloadOf(0), transform: transformFor({}) }]);
    drawGlFrame(empty.frame, empty.slots, 1);
    expect(empty.gl.callsNamed("drawArraysInstanced")).toHaveLength(0);
    expect(empty.gl.callsNamed("clear")).toHaveLength(1);

    // A lone sample has no segment, so no line instance; it is an isolated sample and is drawn
    // as a marker, because a real measurement must never be invisible.
    const single = harness([{ payload: payloadOf(1), transform: transformFor({}) }]);
    drawGlFrame(single.frame, single.slots, 1);
    expect(single.gl.callsNamed("clear")).toHaveLength(1);
    expect(single.gl.callsNamed("drawArraysInstanced").map((call) => call.args)).toEqual([
      [GL_TRIANGLE_STRIP, 0, 4, 1],
    ]);
    const programs = single.gl.callsNamed("useProgram").map((call) => call.args[0]);
    expect(programs).toEqual([single.frame.programs.marker]);

    const unmarked = harness([{ payload: payloadOf(1), transform: transformFor({}), markIsolated: false }]);
    drawGlFrame(unmarked.frame, unmarked.slots, 1);
    expect(unmarked.gl.callsNamed("drawArraysInstanced")).toHaveLength(0);
  });

  it("clears and draws nothing for an empty trace set", () => {
    const local = harness([]);
    drawGlFrame(local.frame, local.slots, 0);
    expect(local.gl.callsNamed("clear")).toHaveLength(1);
    expect(local.gl.callsNamed("drawArraysInstanced")).toHaveLength(0);
  });

  it("creates no GL object on a repeat frame", () => {
    const local = harness([{ payload: payloadOf(100), transform: transformFor({}) }]);
    drawGlFrame(local.frame, local.slots, 1);
    const created = { ...local.gl.created };
    local.gl.log.length = 0;
    drawGlFrame(local.frame, local.slots, 1);

    expect(local.gl.created).toEqual(created);
    expect(local.gl.log.filter((call) => call.name.startsWith("gl.create"))).toHaveLength(0);
    expect(local.gl.bufferUploads()).toHaveLength(2);
  });

  it("uploads through an explicit selection on the same machinery", () => {
    const local = harness([{ payload: payloadOf(5000), transform: transformFor({}) }], { algorithm: "lttb", threshold: 200 });
    drawGlFrame(local.frame, local.slots, 1);
    expect(local.gl.callsNamed("drawArraysInstanced")[0]?.args).toEqual([GL_TRIANGLE_STRIP, 0, 4, 199]);
  });
});

describe("guard band contract", () => {
  it("feeds u_plot and u_device so the shader's guard band of GUARD_BAND_PX surrounds the plot", () => {
    const t = transformFor({ dpr: 2 });
    const local = harness([{ payload: payloadOf(20), transform: t }]);
    drawGlFrame(local.frame, local.slots, 1);

    const plot = local.gl.uniformValues("u_plot")[0] ?? [];
    const device = local.gl.uniformValues("u_device")[0] ?? [];
    expect(GUARD_BAND_PX).toBe(65536);
    expect((plot[1] ?? 0) - GUARD_BAND_PX).toBeLessThan(0);
    expect((plot[1] ?? 0) + (plot[3] ?? 0) + GUARD_BAND_PX).toBeGreaterThan(device[1] ?? 0);
    expect((plot[0] ?? 0) + (plot[2] ?? 0) + GUARD_BAND_PX).toBeGreaterThan(device[0] ?? 0);
    // The guard band must exceed the largest plot a browser can allocate (Chromium's limit).
    expect(GUARD_BAND_PX).toBeGreaterThanOrEqual(32767);
  });
});

describe("frame source", () => {
  it("never slices a typed array or allocates temporaries for uniforms", () => {
    const source = readFileSync(new URL("../../src/webgl2/frame.ts", import.meta.url), "utf8");
    expect(source).not.toContain("subarray");
    const frameFunction = source.slice(source.indexOf("export function drawGlFrame"));
    expect(frameFunction).not.toMatch(/new (Float32Array|Int32Array|Float64Array)/);
  });
});
