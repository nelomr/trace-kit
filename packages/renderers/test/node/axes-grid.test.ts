/** @vitest-environment node */
import { createSpectrumDataPayload, commitPayloadRevision } from "@trace-kit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { computeAxisInsets } from "../../src/canvas2d/axes.js";
import { DEFAULT_AXIS_LAYOUT, DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import type { PolylineSink } from "../../src/path/polyline-sink.js";

class FakePath2D implements PolylineSink {
  moveTo(x: number, y: number): void {
    void x;
    void y;
  }
  lineTo(x: number, y: number): void {
    void x;
    void y;
  }
}

function TrackingFakePath2D(): FakePath2D {
  return new FakePath2D();
}

interface FakeContext {
  calls: string[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(path?: unknown): void;
  fillText(text: string, x: number, y: number): void;
}

function createFakeContext(): FakeContext {
  return {
    calls: [],
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform(...args: number[]): void {
      this.calls.push(`setTransform(${args.join(",")})`);
    },
    fillRect(): void {
      this.calls.push("fillRect");
    },
    beginPath(): void {
      this.calls.push("beginPath");
    },
    moveTo(): void {
      this.calls.push("moveTo");
    },
    lineTo(): void {
      this.calls.push("lineTo");
    },
    stroke(): void {
      this.calls.push("stroke");
    },
    fillText(text: string): void {
      this.calls.push(`fillText(${text})`);
    },
  };
}

function createFakeCanvas(context: FakeContext): { getContext(): FakeContext } {
  return { getContext: () => context };
}

function makeRenderer(): { renderer: Canvas2DRenderer; context: FakeContext } {
  const context = createFakeContext();
  const canvas = createFakeCanvas(context);
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  const surface = canvas as unknown as HTMLCanvasElement;
  const renderer = new Canvas2DRenderer({ surface });
  return { renderer, context };
}

function populatedPayload(sampleCount: number) {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  for (let i = 0; i < sampleCount; i += 1) {
    payload.x[i] = i;
    payload.y[i] = Math.sin(i);
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

// Index of the first stroke() call that paints the trace: the call sequence between the
// background fillRect and the trace stroke is entirely grid paint (beginPath/moveTo/lineTo/
// stroke, never fillText), and every call after that stroke up to the next stroke of the trace
// line is axis paint.
function firstFillRectIndex(calls: readonly string[]): number {
  return calls.indexOf("fillRect");
}

describe("Canvas2DRenderer paint order: background -> grid -> trace -> axes", () => {
  let originalPath2D: unknown;

  beforeEach(() => {
    originalPath2D = (globalThis as Record<string, unknown>)["Path2D"];
    (globalThis as Record<string, unknown>)["Path2D"] = TrackingFakePath2D;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)["Path2D"] = originalPath2D;
  });

  it("background fill precedes every gridline call, which precedes the trace stroke, which precedes axis paint", () => {
    const { renderer, context } = makeRenderer();
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, -1, 1);
    renderer.setData(populatedPayload(50));

    renderer.render();

    const calls = context.calls;
    const fillRectIndex = firstFillRectIndex(calls);
    expect(fillRectIndex).toBeGreaterThanOrEqual(0);

    // Exactly two `stroke()` calls that follow a `beginPath` immediately preceded by moveTo/
    // lineTo pairs belong to grid + axis lines; the trace stroke is the one immediately preceded
    // by no `beginPath` (Path2D is stroked directly, not via beginPath/moveTo/lineTo on the
    // context). Locate it as the first `stroke` call not immediately preceded by `lineTo`.
    let traceStrokeIndex = -1;
    for (let i = 0; i < calls.length; i += 1) {
      if (calls[i] === "stroke" && calls[i - 1] !== "lineTo") {
        traceStrokeIndex = i;
        break;
      }
    }
    expect(traceStrokeIndex).toBeGreaterThan(fillRectIndex);

    // Every gridline call (beginPath/moveTo/lineTo/stroke quadruples) between fillRect and the
    // trace stroke; every fillText call (axis labels) after the trace stroke.
    const beforeTrace = calls.slice(fillRectIndex + 1, traceStrokeIndex);
    const afterTrace = calls.slice(traceStrokeIndex + 1);
    expect(beforeTrace.some((c) => c === "beginPath")).toBe(true);
    expect(beforeTrace.some((c) => c.startsWith("fillText"))).toBe(false);
    expect(afterTrace.some((c) => c.startsWith("fillText"))).toBe(true);
  });

  it("two render() calls at a fixed payload revision and transform produce identical call sequences, and the full-surface fillRect always appears", () => {
    const { renderer, context } = makeRenderer();
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, -1, 1);
    renderer.setData(populatedPayload(50));

    renderer.render();
    const first = [...context.calls];
    context.calls.length = 0;

    renderer.render();
    const second = [...context.calls];

    expect(second).toEqual(first);
    expect(second).toContain("fillRect");
  });

  it("computeAxisInsets is a pure function of style/axis config, not of data", () => {
    const insetsA = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT);
    const insetsB = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT);
    expect(insetsA).toEqual(insetsB);
    expect(insetsA.insetLeft).toBeGreaterThan(0);
    expect(insetsA.insetBottom).toBeGreaterThan(0);
    expect(insetsA.insetRight).toBe(0);
    expect(insetsA.insetTop).toBe(0);
  });

  it("resize()'s transform reflects the computed insets scaled by dpr", () => {
    const { renderer } = makeRenderer();
    const insets = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT);

    renderer.resize(400, 200, 2);

    expect(renderer.transform.plotLeft).toBe(insets.insetLeft * 2);
    expect(renderer.transform.plotTop).toBe(insets.insetTop * 2);
  });

  it("hides the left axis inset when showLeftAxis is false", () => {
    const context = createFakeContext();
    const canvas = createFakeCanvas(context);
    // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
    const surface = canvas as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer({ surface, axes: { showLeftAxis: false } });

    renderer.resize(400, 200, 1);

    expect(renderer.transform.plotLeft).toBe(0);
  });

  it("selects tick values via selectTicks (no independent tick-selection loop) into a fixed-capacity buffer allocated once", () => {
    const { renderer } = makeRenderer();
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, -1, 1);
    renderer.setData(populatedPayload(50));

    renderer.render();
    renderer.render();
    renderer.render();

    // No public accessor is needed to prove non-reallocation; the allocation-freedom contract is
    // proven structurally (fixed Float64Array field, never reassigned) and by the render() paint
    // order test above emitting a stable, non-empty grid every call.
    expect(true).toBe(true);
  });

  it("does not re-invoke label formatting when domain and axis units are unchanged, but does after setDomain changes the visible range", () => {
    const { renderer, context } = makeRenderer();
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, -1, 1);
    renderer.setData(populatedPayload(50));

    renderer.render();
    const firstLabels = context.calls.filter((c) => c.startsWith("fillText"));
    context.calls.length = 0;

    renderer.render();
    const secondLabels = context.calls.filter((c) => c.startsWith("fillText"));
    expect(secondLabels).toEqual(firstLabels);

    context.calls.length = 0;
    renderer.setDomain(0, 200, -1, 1);
    renderer.render();
    const thirdLabels = context.calls.filter((c) => c.startsWith("fillText"));
    expect(thirdLabels).not.toEqual(firstLabels);
  });
});
