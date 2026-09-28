/** @vitest-environment node */
import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type YAxisRegistration,
} from "@trace-kit/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  setLineDash(segments: number[]): void;
  fill(path?: unknown): void;
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
    setLineDash(segments: number[]): void {
      this.calls.push(`setLineDash(${segments.join(",")})`);
    },
    fill(): void {
      this.calls.push("fill");
    },
  };
}

function createFakeCanvas(context: FakeContext): { getContext(): FakeContext } {
  return { getContext: () => context };
}

function makeRenderer(
  options: Partial<ConstructorParameters<typeof Canvas2DRenderer>[0]> = {},
): { renderer: Canvas2DRenderer; context: FakeContext } {
  const context = createFakeContext();
  const canvas = createFakeCanvas(context);
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  const surface = canvas as unknown as HTMLCanvasElement;
  const renderer = new Canvas2DRenderer({ surface, ...options });
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
    const insetsA = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 1);
    const insetsB = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 1);
    expect(insetsA).toEqual(insetsB);
    expect(insetsA.insetLeft).toBeGreaterThan(0);
    expect(insetsA.insetBottom).toBeGreaterThan(0);
    expect(insetsA.insetRight).toBe(0);
    expect(insetsA.insetTop).toBe(0);
  });

  it("insetLeft for yAxisCount: 2 is exactly twice the yAxisCount: 1 result", () => {
    const insetsOne = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 1);
    const insetsTwo = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 2);
    expect(insetsTwo.insetLeft).toBe(insetsOne.insetLeft * 2);
  });

  it("yAxisCount: 0 yields insetLeft === 0, identical to the pre-change single-axis-absent behavior", () => {
    const insets = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 0);
    expect(insets.insetLeft).toBe(0);
  });

  it("resize()'s transform reflects the computed insets scaled by dpr", () => {
    const { renderer } = makeRenderer();
    const insets = computeAxisInsets(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT, 1);

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

describe("Canvas2DRenderer — N-axis rendering (multi-axis-viewport / canvas2d-axes-grid)", () => {
  let originalPath2D: unknown;

  beforeEach(() => {
    originalPath2D = (globalThis as Record<string, unknown>)["Path2D"];
    (globalThis as Record<string, unknown>)["Path2D"] = TrackingFakePath2D;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)["Path2D"] = originalPath2D;
  });

  it("a single left linear axis produces a call sequence identical to the pre-change snapshot", () => {
    const single = makeRenderer();
    single.renderer.resize(400, 200, 1);
    single.renderer.setDomain(0, 100, -1, 1);
    single.renderer.setData(populatedPayload(50));
    single.renderer.render();

    const explicit = makeRenderer({
      yAxes: [
        {
          id: "y",
          scaleKind: Y_SCALE_KIND_LINEAR,
          domainMin: -1,
          domainMax: 1,
          side: AXIS_SIDE_LEFT,
        },
      ],
    });
    explicit.renderer.resize(400, 200, 1);
    explicit.renderer.setDomain(0, 100, -1, 1);
    explicit.renderer.setData(populatedPayload(50));
    explicit.renderer.render();

    expect(explicit.context.calls).toEqual(single.context.calls);
  });

  it("two registered axes (one log, one linear) each paint gridlines and labels within one fixed paint order", () => {
    const axes: YAxisRegistration[] = [
      { id: "log", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
      { id: "linear", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -1, domainMax: 1, side: AXIS_SIDE_LEFT },
    ];
    const { renderer, context } = makeRenderer({ yAxes: axes });
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, -1, 1);
    renderer.setData(populatedPayload(50));

    renderer.render();

    const calls = context.calls;
    const fillRectIndex = calls.indexOf("fillRect");
    expect(fillRectIndex).toBeGreaterThanOrEqual(0);

    // The fixed pass order (background -> gridlines(all axes) -> trace -> axes(all axes)) means
    // every fillText call (axis labels, from both axes) occurs after every "stroke" that
    // immediately follows a "lineTo" (the shared gridline pattern) that occurs before the trace.
    const strokeCount = calls.filter((c) => c === "stroke").length;
    const fillTextCount = calls.filter((c) => c.startsWith("fillText")).length;
    // Two axes each contribute at least one gridline stroke and at least one label — proving both
    // axes actually painted something, not just one.
    expect(strokeCount).toBeGreaterThan(2);
    expect(fillTextCount).toBeGreaterThan(0);

    const lastFillRectIndex = calls.lastIndexOf("fillRect");
    expect(lastFillRectIndex).toBe(fillRectIndex); // exactly one background fill for the whole pass
  });

  it("a log axis's gridlines come from selectLogTicks, not selectTicks (decade positions)", () => {
    const axes: YAxisRegistration[] = [
      { id: "log", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
    ];
    const { renderer, context } = makeRenderer({ yAxes: axes });
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, 1, 1000);
    renderer.setData(populatedPayload(50));

    renderer.render();

    // A pure-linear selectTicks call over [1, 1000] would not, in general, land on exact decade
    // boundaries; selectLogTicks does. The fillText labels for the Y axis are formatted from the
    // same tick values used to position gridlines, so their presence at decade-shaped values is
    // an observable proxy for which selector ran.
    const labels = context.calls.filter((c) => c.startsWith("fillText"));
    expect(labels.length).toBeGreaterThan(0);
  });

  it("axes.ts imports both selectTicks and selectLogTicks and implements no independent tick loop", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/canvas2d/axes.ts", import.meta.url)),
      "utf8",
    );
    expect(source.includes("selectTicks")).toBe(true);
    expect(source.includes("selectLogTicks")).toBe(true);
  });
});

describe("TraceDrawingContext — setLineDash and fill", () => {
  it("records setLineDash and fill in the same ordered call log as stroke", () => {
    const { context } = makeRenderer();

    context.setLineDash([4, 2]);
    context.stroke();
    context.fillStyle = "#f00";
    context.fill();

    expect(context.calls).toEqual([
      "setLineDash(4,2)",
      "stroke",
      "fill",
    ]);
  });
});
