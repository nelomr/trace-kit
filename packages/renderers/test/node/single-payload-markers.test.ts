/** @vitest-environment node */
import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  projectX,
  projectY,
  Y_SCALE_KIND_LOG,
} from "@trace-kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { countIsolatedSegments } from "../../src/path/isolated-markers.js";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import {
  installRecordingPath2D,
  RecordingContext,
  RecordingPath2D,
  recordingSurface,
} from "./support/recording-context.js";

vi.mock("../../src/path/isolated-markers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/path/isolated-markers.js")>();
  return { ...actual, countIsolatedSegments: vi.fn(actual.countIsolatedSegments) };
});

function payloadOf(y: readonly number[]) {
  const payload = createSpectrumDataPayload({
    capacity: y.length,
    xOrigin: 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  for (let i = 0; i < y.length; i += 1) {
    payload.x[i] = i;
    payload.y[i] = y[i] ?? NaN;
  }
  commitPayloadRevision(payload, y.length);
  return payload;
}

describe("single-payload isolated-sample markers", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installRecordingPath2D();
    vi.mocked(countIsolatedSegments).mockClear();
  });
  afterEach(() => {
    restore();
  });

  function setup(y: readonly number[]) {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.resize(400, 200, 2);
    renderer.setDomain(0, y.length - 1, 0, 6);
    renderer.setData(payloadOf(y));
    return { context, renderer };
  }

  it("fills one square of half-side lineWidthCss * dpr after the stroke", () => {
    const { context, renderer } = setup([NaN, 2, 3, NaN, 5, NaN, 2, 3]);
    renderer.render();
    const t = renderer.transform;

    expect(RecordingPath2D.created.length).toBe(2);
    const [line, markers] = RecordingPath2D.created;
    expect(line?.ops.some((op) => op.name === "rect")).toBe(false);
    const px = projectX(t, 4);
    const py = projectY(t, 5);
    expect(markers?.ops).toEqual([{ name: "rect", args: [px - 3, py - 3, 6, 6] }]);

    const strokeIndex = context.calls.findIndex((c) => c.name === "stroke" && c.args[0] === line);
    const fillIndex = context.calls.findIndex((c) => c.name === "fill");
    expect(strokeIndex).toBeGreaterThanOrEqual(0);
    expect(fillIndex).toBeGreaterThan(strokeIndex);
    expect(context.calls[fillIndex]?.args[0]).toBe(markers);
    expect(context.calls[fillIndex - 1]).toEqual({
      name: "set fillStyle",
      args: [DEFAULT_FIGURE_STYLE.traceColor],
    });
    expect(context.calls.filter((c) => c.name === "fill").length).toBe(1);
  });

  it("records no marker path and no fill for a gap-free payload", () => {
    const { context, renderer } = setup([1, 2, 3, 4, 5, 6]);
    renderer.render();
    expect(RecordingPath2D.created.length).toBe(1);
    expect(context.calls.some((c) => c.name === "fill")).toBe(false);
  });

  it("memoizes the isolated count with the decimation result", () => {
    const { renderer } = setup([NaN, 2, 3, NaN, 5, NaN, 2, 3]);
    renderer.render();
    renderer.render();
    renderer.render();
    expect(vi.mocked(countIsolatedSegments)).toHaveBeenCalledTimes(1);
  });
});

describe("single-payload markers on a log axis", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installRecordingPath2D();
    vi.mocked(countIsolatedSegments).mockClear();
  });
  afterEach(() => {
    restore();
  });

  it("marks the samples a non-positive neighbour isolates, counting once across 60 renders", () => {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({
      surface: recordingSurface(context),
      yAxes: [{ id: "y", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT }],
    });
    renderer.resize(400, 200, 2);
    renderer.setDomain(0, 2, 1, 1000);
    renderer.setData(payloadOf([10, 0, 100]));
    for (let frame = 0; frame < 60; frame += 1) renderer.render();

    expect(vi.mocked(countIsolatedSegments)).toHaveBeenCalledTimes(1);
    const markers = RecordingPath2D.created[1];
    expect(markers?.ops.map((op) => op.name)).toEqual(["rect", "rect"]);
    const t = renderer.transform;
    const half = 3;
    expect(markers?.ops[0]?.args).toEqual([projectX(t, 0) - half, projectY(t, 10) - half, 2 * half, 2 * half]);
    expect(markers?.ops[1]?.args).toEqual([projectX(t, 2) - half, projectY(t, 100) - half, 2 * half, 2 * half]);
    expect(context.calls.filter((c) => c.name === "fill")).toHaveLength(60);
  });
});

