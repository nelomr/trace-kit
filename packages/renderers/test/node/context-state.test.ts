/** @vitest-environment node */
import { createTraceCollection } from "@trace-kit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { scaleFontSize } from "../../src/layout/figure-layout.js";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { installRecordingPath2D, RecordingContext, recordingSurface } from "./support/recording-context.js";
import { linearAxis, payloadOf } from "./support/svg-helpers.js";

let restore: () => void;
beforeEach(() => {
  restore = installRecordingPath2D();
});
afterEach(() => {
  restore();
});

function dashedCollectionRender(frames: number) {
  const axes = [linearAxis("y", 0, 10)];
  const collection = createTraceCollection(
    [{ id: "t", payload: payloadOf([1, 2, 3, 4]), yAxisId: "y", style: { dash: [6, 4] } }],
    axes,
    0,
    3,
  );
  const context = new RecordingContext();
  const renderer = new Canvas2DRenderer({ surface: recordingSurface(context), yAxes: axes });
  renderer.setTraces(collection);
  renderer.resize(400, 200, 2);
  for (let i = 0; i < frames; i += 1) renderer.render();
  return context;
}

describe("dash state does not leak between traces, grid and axes", () => {
  it("restores a solid dash before the axes are stroked", () => {
    const { calls } = dashedCollectionRender(1);
    const traceStroke = calls.findIndex((c) => c.name === "stroke" && c.args.length === 1);
    const dashAfter = calls.slice(traceStroke + 1).find((c) => c.name === "setLineDash");
    expect(dashAfter?.args[0]).toEqual([]);
    const axisStroke = calls.findIndex((c, i) => i > traceStroke && c.name === "stroke");
    expect(calls.findIndex((c, i) => i > traceStroke && c.name === "setLineDash")).toBeLessThan(axisStroke);
  });

  it("starts every frame solid, so the next frame's gridlines are not dashed", () => {
    const { calls } = dashedCollectionRender(2);
    const secondFill = calls.map((c) => c.name).lastIndexOf("fillRect");
    const firstGridStroke = calls.findIndex((c, i) => i > secondFill && c.name === "stroke");
    const reset = calls.findIndex((c, i) => i > secondFill && c.name === "setLineDash");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(firstGridStroke);
  });
});

describe("label fonts are scaled to device pixels", () => {
  it("scaleFontSize rewrites only the leading size", () => {
    expect(scaleFontSize('10px "TraceKit Inter"', 2)).toBe('20px "TraceKit Inter"');
    expect(scaleFontSize("12.5px monospace", 1.5)).toBe("18.75px monospace");
    expect(scaleFontSize("bold monospace", 2)).toBe("bold monospace");
  });

  it("the renderer sets the scaled font for axis labels", () => {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.resize(400, 200, 2);
    renderer.setData(payloadOf([1, 2, 3]));
    renderer.setDomain(0, 2, 0, 4);
    const fonts: string[] = [];
    const original = Object.getOwnPropertyDescriptor(RecordingContext.prototype, "font");
    Object.defineProperty(context, "font", {
      get: () => fonts[fonts.length - 1] ?? "",
      set: (v: string) => void fonts.push(v),
    });
    renderer.render();
    expect(original).toBeDefined();
    expect(fonts.length).toBeGreaterThan(0);
    expect(new Set(fonts)).toEqual(new Set([scaleFontSize(DEFAULT_FIGURE_STYLE.font, 2)]));
  });
});
