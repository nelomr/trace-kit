/** @vitest-environment node */
import { createTraceCollection } from "@trace-kit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { scaleFontSize } from "../../src/layout/figure-layout.js";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import {
  installRecordingPath2D,
  RecordingContext,
  recordingSurface,
  RecordingPath2D,
  type RecordedCall,
} from "./support/recording-context.js";
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
  /** Index of the `save` and `restore` that bracket each frame's trace section. */
  function brackets(calls: readonly RecordedCall[]): { save: number; restore: number }[] {
    const saves = indicesOf(calls, "save");
    const restores = indicesOf(calls, "restore");
    return saves.map((save, i) => ({ save, restore: restores[i] ?? -1 }));
  }

  it("strokes the first gridline and every axis stroke after the restore solid on every frame", () => {
    const { calls } = dashedCollectionRender(2);
    const frames = indicesOf(calls, "fillRect");
    expect(frames).toHaveLength(2);
    for (const [frame, start] of frames.entries()) {
      const end = frames[frame + 1] ?? calls.length;
      const strokes = indicesOf(calls, "stroke").filter((i) => i > start && i < end);
      const { save, restore } = brackets(calls)[frame] ?? { save: -1, restore: -1 };
      const firstGrid = strokes.find((i) => i < save);
      const axisStrokes = strokes.filter((i) => i > restore);
      expect(firstGrid).toBeDefined();
      expect(axisStrokes.length).toBeGreaterThan(1);
      expect(calls[firstGrid ?? -1]?.lineDash).toEqual([]);
      // Every axis line and tick mark, not only the first stroke after the restore.
      for (const i of axisStrokes) expect(calls[i]?.lineDash).toEqual([]);
    }
  });

  it("sets the dash only inside the save/restore bracket", () => {
    const { calls } = dashedCollectionRender(2);
    const dashes = indicesOf(calls, "setLineDash");
    expect(dashes.length).toBeGreaterThan(0);
    const frames = brackets(calls);
    for (const i of dashes) {
      expect(frames.some((f) => i > f.save && i < f.restore)).toBe(true);
    }
  });

  it("records no setLineDash call at all for a solid single payload", () => {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.resize(400, 200, 2);
    renderer.setData(payloadOf([1, 2, 3]));
    renderer.setDomain(0, 2, 0, 4);
    renderer.render();
    expect(context.calls.some((c) => c.name === "setLineDash")).toBe(false);
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

describe("RecordingContext models the canvas state stack", () => {
  it("records save, beginPath, rect, clip and restore with their arguments, in order", () => {
    const context = new RecordingContext();
    context.save();
    context.beginPath();
    context.rect(1, 2, 3, 4);
    context.clip();
    context.restore();
    expect(context.calls.map((c) => [c.name, ...c.args])).toEqual([
      ["save"],
      ["beginPath"],
      ["rect", 1, 2, 3, 4],
      ["clip"],
      ["restore"],
    ]);
  });

  it("restores the line dash set inside a save/restore pair", () => {
    const context = new RecordingContext();
    context.save();
    context.setLineDash([6, 3]);
    expect(context.lineDash).toEqual([6, 3]);
    context.restore();
    expect(context.lineDash).toEqual([]);
  });

  it("restores strokeStyle, lineWidth and fillStyle too", () => {
    const context = new RecordingContext();
    context.strokeStyle = "#111";
    context.lineWidth = 1;
    context.fillStyle = "#222";
    context.save();
    context.strokeStyle = "#f00";
    context.lineWidth = 5;
    context.fillStyle = "#0f0";
    context.restore();
    expect([context.strokeStyle, context.lineWidth, context.fillStyle]).toEqual(["#111", 1, "#222"]);
  });

  it("snapshots the dash in effect on every recorded stroke without touching its args", () => {
    const context = new RecordingContext();
    context.stroke();
    context.save();
    context.setLineDash([6, 3]);
    context.stroke({});
    context.restore();
    context.stroke();
    const strokes: RecordedCall[] = context.calls.filter((c) => c.name === "stroke");
    expect(strokes.map((c) => c.lineDash)).toEqual([[], [6, 3], []]);
    expect(strokes.map((c) => c.args.length)).toEqual([0, 1, 0]);
  });

  it("treats an unbalanced restore as a no-op, as the DOM does", () => {
    const context = new RecordingContext();
    context.setLineDash([2, 2]);
    context.strokeStyle = "#abc";
    context.restore();
    expect(context.lineDash).toEqual([2, 2]);
    expect(context.strokeStyle).toBe("#abc");
    expect(context.calls[context.calls.length - 1]?.name).toBe("restore");
  });
});

function ramp(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i / count);
}

function indicesOf(calls: readonly RecordedCall[], name: string): number[] {
  const out: number[] = [];
  calls.forEach((c, i) => {
    if (c.name === name) out.push(i);
  });
  return out;
}

describe("the trace section is clipped to the plot rectangle", () => {
  it("brackets the trace stroke of a single payload in one save/clip/restore", () => {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.resize(800, 400, 2);
    renderer.setData(payloadOf(ramp(100)));
    renderer.setDomain(0, 99, 0, 1);
    renderer.render();
    const t = renderer.transform;
    const { calls } = context;

    expect(indicesOf(calls, "save")).toHaveLength(1);
    expect(indicesOf(calls, "clip")).toHaveLength(1);
    expect(indicesOf(calls, "restore")).toHaveLength(1);
    const save = indicesOf(calls, "save")[0] ?? -1;
    expect(calls.slice(save, save + 4).map((c) => [c.name, ...c.args])).toEqual([
      ["save"],
      ["beginPath"],
      ["rect", t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight],
      ["clip"],
    ]);

    const traceStroke = calls.findIndex((c) => c.name === "stroke" && c.args.length === 1);
    const lastGridStroke = Math.max(
      ...indicesOf(calls, "stroke").filter((i) => i < save),
    );
    expect(lastGridStroke).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(lastGridStroke);
    expect(traceStroke).toBeGreaterThan(save + 3);

    const restoreIndex = indicesOf(calls, "restore")[0] ?? -1;
    expect(restoreIndex).toBeGreaterThan(traceStroke);
    // The bottom axis opens by setting its own stroke color, and nothing precedes it after the
    // restore.
    expect(calls[restoreIndex + 1]).toEqual({
      name: "set strokeStyle",
      args: [DEFAULT_FIGURE_STYLE.axisColor],
    });
  });

  it("shares one clip across a multi-trace collection and its marker fill", () => {
    const axes = [linearAxis("y", 0, 10)];
    const collection = createTraceCollection(
      [
        { id: "a", payload: payloadOf([1, 2, 3, 4]), yAxisId: "y", style: {} },
        { id: "b", payload: payloadOf([NaN, 5, NaN, NaN]), yAxisId: "y", style: {} },
        { id: "c", payload: payloadOf([4, 3, 2, 1]), yAxisId: "y", style: {} },
      ],
      axes,
      0,
      3,
    );
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context), yAxes: axes });
    renderer.setTraces(collection);
    renderer.resize(400, 200, 2);
    renderer.render();
    const { calls } = context;

    expect(indicesOf(calls, "save")).toHaveLength(1);
    expect(indicesOf(calls, "clip")).toHaveLength(1);
    expect(indicesOf(calls, "restore")).toHaveLength(1);
    const clip = indicesOf(calls, "clip")[0] ?? -1;
    const restoreIndex = indicesOf(calls, "restore")[0] ?? -1;
    const traceStrokes = indicesOf(calls, "stroke").filter((i) => calls[i]?.args.length === 1);
    expect(traceStrokes).toHaveLength(3);
    for (const i of [...traceStrokes, ...indicesOf(calls, "fill")]) {
      expect(i).toBeGreaterThan(clip);
      expect(i).toBeLessThan(restoreIndex);
    }
    expect(indicesOf(calls, "fill")).toHaveLength(1);
    expect(RecordingPath2D.created).toHaveLength(4);
  });

  it("issues the clip once per frame even with nothing to draw", () => {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.resize(800, 400, 2);
    renderer.render();
    renderer.render();
    const { calls } = context;
    expect(indicesOf(calls, "save")).toHaveLength(2);
    expect(indicesOf(calls, "clip")).toHaveLength(2);
    expect(indicesOf(calls, "restore")).toHaveLength(2);
    expect(calls.some((c) => c.name === "stroke" && c.args.length === 1)).toBe(false);
  });

  it("uses the exact, unrounded rectangle at a fractional dpr", () => {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.resize(801, 399, 1.3);
    renderer.setData(payloadOf(ramp(100)));
    renderer.setDomain(0, 99, 0, 1);
    renderer.render();
    const t = renderer.transform;
    const rect = context.calls.find((c) => c.name === "rect");
    expect(rect?.args).toEqual([t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight]);
    // The scenario is only meaningful if at least one edge is a fractional device pixel.
    expect([t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight].some((v) => !Number.isInteger(v))).toBe(true);
  });
});
