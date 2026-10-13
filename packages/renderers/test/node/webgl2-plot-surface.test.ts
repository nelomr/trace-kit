/** @vitest-environment node */
import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as axes from "../../src/canvas2d/axes.js";
import { WebGL2FigureRenderer } from "../../src/webgl2/webgl2-figure-renderer.js";
import { asSurface, FakeSurface } from "./support/fake-surface.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";
import { RecordingOverlayContext } from "./support/recording-overlay-context.js";
import { createHarness, createParts, type Harness } from "./support/webgl2-harness.js";

vi.mock("../../src/canvas2d/axes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/canvas2d/axes.js")>();
  return {
    ...actual,
    drawXGridlines: vi.fn(actual.drawXGridlines),
    drawYGridlines: vi.fn(actual.drawYGridlines),
    drawBottomAxis: vi.fn(actual.drawBottomAxis),
    drawLeftAxis: vi.fn(actual.drawLeftAxis),
  };
});

function payloadOf(n: number, y: (i: number) => number = (i) => Math.sin(i / 9)): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: Math.max(1, n), xOrigin: 0, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < n; i += 1) {
    payload.x[i] = i;
    payload.y[i] = y(i);
  }
  commitPayloadRevision(payload, n);
  return payload;
}

let h: Harness;
beforeEach(() => {
  vi.clearAllMocks();
  h = createHarness();
});

describe("context requests", () => {
  it("asks each surface for exactly its own context and nothing else", () => {
    expect(h.underlay.getContextCalls).toEqual([{ id: "2d", attributes: { alpha: false } }]);
    expect(h.overlay.getContextCalls).toEqual([{ id: "2d", attributes: { alpha: true } }]);
    expect(h.plot.getContextCalls).toHaveLength(1);
    expect(h.plot.getContextCalls[0]?.id).toBe("webgl2");
  });

  it("rejects identical surfaces with a TypeError before requesting any context", () => {
    const parts = createParts();
    const same = asSurface(parts.underlay);
    expect(
      () => new WebGL2FigureRenderer({ surfaces: { underlay: same, plot: asSurface(parts.plot), overlay: same } }),
    ).toThrow(TypeError);
    expect(
      () => new WebGL2FigureRenderer({ surfaces: { underlay: asSurface(parts.underlay), plot: same, overlay: asSurface(parts.overlay) } }),
    ).toThrow(TypeError);
    expect(parts.underlay.getContextCalls).toHaveLength(0);
    expect(parts.plot.getContextCalls).toHaveLength(0);
    expect(parts.overlay.getContextCalls).toHaveLength(0);
  });

  it("names the context type and the failing surface when a context is unavailable", () => {
    const parts = createParts();
    const build = (underlay: object, plot: object, overlay: object) => () =>
      new WebGL2FigureRenderer({
        surfaces: {
          underlay: asSurface(underlay as FakeSurface<object>),
          plot: asSurface(plot as FakeSurface<object>),
          overlay: asSurface(overlay as FakeSurface<object>),
        },
      });
    expect(build(new FakeSurface<RecordingOverlayContext>(null), parts.plot, parts.overlay)).toThrow(/underlay/);
    expect(build(parts.underlay, parts.plot, new FakeSurface<RecordingOverlayContext>(null))).toThrow(/overlay/);
    const noGl = createParts();
    expect(build(noGl.underlay, new FakeSurface<RecordingGl2Context>(null), noGl.overlay)).toThrow(/webgl2/);
    expect(build(noGl.underlay, new FakeSurface<RecordingGl2Context>(null), noGl.overlay)).toThrow(/plot/);
  });

  it("requests contexts in the order underlay, overlay, plot, then compiles programs", () => {
    const order: string[] = [];
    const parts = createParts();
    const wrap = <T extends object>(name: string, surface: FakeSurface<T>): FakeSurface<T> => {
      const original = surface.getContext.bind(surface);
      surface.getContext = (id, attributes) => {
        order.push(name);
        return original(id, attributes);
      };
      return surface;
    };
    new WebGL2FigureRenderer({
      surfaces: {
        underlay: asSurface(wrap("underlay", parts.underlay)),
        plot: asSurface(wrap("plot", parts.plot)),
        overlay: asSurface(wrap("overlay", parts.overlay)),
      },
    });
    expect(order).toEqual(["underlay", "overlay", "plot"]);
    expect(parts.gl.callsNamed("createProgram")).toHaveLength(2);
  });

  it("releases the GL context and its objects when program compilation fails", () => {
    const parts = createParts({ compileFailureLog: "boom" });
    expect(
      () =>
        new WebGL2FigureRenderer({
          surfaces: {
            underlay: asSurface(parts.underlay),
            plot: asSurface(parts.plot),
            overlay: asSurface(parts.overlay),
          },
        }),
    ).toThrow(/boom/);
    expect(parts.gl.liveCount("shader")).toBe(0);
    expect(parts.gl.liveCount("program")).toBe(0);
    expect(parts.gl.callsNamed("loseContext")).toHaveLength(1);
  });
});

describe("backing store sizes", () => {
  it("sizes all three surfaces to the rounded device size and draws nothing", () => {
    h.log.length = 0;
    h.renderer.resize(800, 600, 2);
    for (const surface of [h.underlay, h.plot, h.overlay]) {
      expect([surface.width, surface.height]).toEqual([1600, 1200]);
    }
    h.renderer.resize(333, 211, 1.5);
    for (const surface of [h.underlay, h.plot, h.overlay]) {
      expect([surface.width, surface.height]).toEqual([500, 317]);
    }
    expect(h.log).toHaveLength(0);
  });

  it("sets the GL viewport at each render from the primary transform", () => {
    h.renderer.resize(800, 600, 2);
    h.renderer.render();
    expect(h.gl.callsNamed("viewport")[0]?.args).toEqual([0, 0, 1600, 1200]);
  });
});

describe("layer order", () => {
  function frameNames(harness: Harness): string[] {
    harness.log.length = 0;
    harness.renderer.render();
    return harness.log.map((call) => call.name);
  }

  it("paints underlay, then the GL plot, then the overlay, with no drawImage", () => {
    h.renderer.setData(payloadOf(200));
    h.renderer.resize(400, 300, 1);
    const names = frameNames(h);

    expect(names).not.toContain("drawImage");
    const firstTransform = names.indexOf("setTransform");
    const background = names.indexOf("fillRect");
    const firstStroke = names.indexOf("stroke");
    const glClear = names.indexOf("gl.clear");
    const draw = names.indexOf("gl.drawArraysInstanced");
    const overlayClear = names.indexOf("overlay.clearRect");
    const lastFillText = names.lastIndexOf("fillText");
    expect(firstTransform).toBe(0);
    expect(background).toBeGreaterThan(firstTransform);
    expect(firstStroke).toBeGreaterThan(background);
    expect(glClear).toBeGreaterThan(firstStroke);
    expect(draw).toBeGreaterThan(glClear);
    expect(overlayClear).toBeGreaterThan(draw);
    expect(lastFillText).toBeGreaterThan(overlayClear);
    // No gridline stroke after the plot: only axis strokes follow the overlay clear.
    expect(names.slice(0, glClear)).toContain("stroke");
  });

  it("still paints the underlay, clears GL and the overlay for empty and all-gap data", () => {
    for (const payload of [payloadOf(0), payloadOf(30, () => NaN)]) {
      const local = createHarness();
      local.renderer.setData(payload);
      local.renderer.resize(400, 300, 1);
      const names = frameNames(local);
      expect(names).toContain("fillRect");
      expect(names).toContain("gl.clear");
      expect(names).toContain("overlay.clearRect");
      expect(names).not.toContain("drawImage");
      if (payload.sampleCount === 0) expect(names).not.toContain("gl.drawArraysInstanced");
    }
  });

  it("clear() paints the underlay, clears the overlay and the plot canvas, creating no GL object", () => {
    h.renderer.resize(400, 300, 1);
    const created = { ...h.gl.created };
    h.log.length = 0;
    h.renderer.clear();
    const names = h.log.map((call) => call.name);

    expect(names).toContain("fillRect");
    expect(names).toContain("overlay.clearRect");
    expect(names).toContain("gl.clear");
    expect(h.log.find((call) => call.name === "gl.disable")?.args).toEqual([0x0c11]);
    expect(h.gl.created).toEqual(created);
  });
});

describe("shared layout reuse", () => {
  it("hands gridlines to the underlay and axes to the overlay with the shared layout, per axis", () => {
    const local = createHarness({
      rendererOptions: {
        yAxes: [
          { id: "a", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -1, domainMax: 1, side: AXIS_SIDE_LEFT },
          { id: "b", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
        ],
      },
    });
    local.renderer.setData(payloadOf(50));
    local.renderer.resize(400, 300, 1);
    local.renderer.render();

    expect(vi.mocked(axes.drawXGridlines)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(axes.drawYGridlines)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(axes.drawBottomAxis)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(axes.drawLeftAxis)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(axes.drawXGridlines).mock.calls[0]?.[0]).toBe(local.underlayContext);
    expect(vi.mocked(axes.drawYGridlines).mock.calls[0]?.[0]).toBe(local.underlayContext);
    expect(vi.mocked(axes.drawBottomAxis).mock.calls[0]?.[0]).toBe(local.overlayContext);
    expect(vi.mocked(axes.drawLeftAxis).mock.calls[0]?.[0]).toBe(local.overlayContext);
    const offsets = vi.mocked(axes.drawLeftAxis).mock.calls.map((call) => call[7]);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeGreaterThan(0);
    const secondTransform = vi.mocked(axes.drawLeftAxis).mock.calls[1]?.[1];
    expect(secondTransform?.yScaleKind).toBe(Y_SCALE_KIND_LOG);
  });
});
