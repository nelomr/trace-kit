/** @vitest-environment node */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  lttb,
  minMaxEnvelopeIndices,
} from "@trace-kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { buildTracePath } from "../../src/path/build-trace-path.js";
import type { PolylineSink } from "../../src/path/polyline-sink.js";

// This file's module-scoped mock: every named export of `@trace-kit/core` passes through
// unchanged except `lttb`/`minMaxEnvelopeIndices`, wrapped in a `vi.fn` so tests below can assert
// exact invocation counts — proving decimation is memoized and not re-run every frame — without a
// fragile spy against a live ESM binding.
vi.mock("@trace-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trace-kit/core")>();
  return {
    ...actual,
    lttb: vi.fn(actual.lttb),
    minMaxEnvelopeIndices: vi.fn(actual.minMaxEnvelopeIndices),
  };
});

// Counts constructions rather than allocating a real `Path2D` (this project's `renderers`
// vitest project runs in the `node` environment, which has no `Path2D` global). Standing in
// for `Canvas2DRenderer.render()`'s per-frame `new Path2D()` call until phase 7 lands the real
// renderer (task 6.8 is a no-op checkpoint against that phase, re-run once it exists).
class CountingPath implements PolylineSink {
  static constructions = 0;
  constructor() {
    CountingPath.constructions += 1;
  }
  moveTo(x: number, y: number): void {
    void x;
    void y;
  }
  lineTo(x: number, y: number): void {
    void x;
    void y;
  }
}

/** The per-point-allocating variant `buildTracePath`'s own ESLint hot-path block rejects. */
class PerPointPathVariant implements PolylineSink {
  static constructions = 0;
  moveTo(x: number, y: number): void {
    void x;
    void y;
    PerPointPathVariant.constructions += 1;
  }
  lineTo(x: number, y: number): void {
    void x;
    void y;
    PerPointPathVariant.constructions += 1;
  }
}

describe("Path2D-per-frame work count", () => {
  it("a render()-style caller constructs exactly one path per call across 10 calls", () => {
    CountingPath.constructions = 0;
    const frameCount = 10;
    for (let frame = 0; frame < frameCount; frame += 1) {
      // Exactly one `new Path2D()` per `render()` call, reused for every point drawn in that
      // frame — never one per point, since per-point construction would defeat the whole point
      // of batching the draw into a single path.
      const path = new CountingPath();
      const x = new Float32Array([0, 1, 2]);
      const y = new Float32Array([0, 1, 0]);
      buildTracePath(
        path,
        {
          xDomainMin: 0,
          xDomainMax: 2,
          yDomainMin: -1,
          yDomainMax: 1,
          xOrigin: 0,
          deviceWidth: 100,
          deviceHeight: 100,
          dpr: 1,
          plotLeft: 0,
          plotTop: 0,
          plotWidth: 100,
          plotHeight: 100,
          xScale: 50,
          yScale: 50,
          yBase: 50,
        },
        x,
        y,
        new Int32Array(0),
        0,
        3,
      );
    }
    expect(CountingPath.constructions).toBe(frameCount);
  });

  it("a per-point construction variant is distinguishable from the one-per-frame contract", () => {
    PerPointPathVariant.constructions = 0;
    const sink = new PerPointPathVariant();
    const x = new Float32Array([0, 1, 2, 3, 4]);
    const y = new Float32Array([0, 1, 0, 1, 0]);
    const n = buildTracePath(
      sink,
      {
        xDomainMin: 0,
        xDomainMax: 4,
        yDomainMin: -1,
        yDomainMax: 1,
        xOrigin: 0,
        deviceWidth: 100,
        deviceHeight: 100,
        dpr: 1,
        plotLeft: 0,
        plotTop: 0,
        plotWidth: 100,
        plotHeight: 100,
        xScale: 25,
        yScale: 50,
        yBase: 50,
      },
      x,
      y,
      new Int32Array(0),
      0,
      5,
    );
    // Once per point, not once per frame — the shape the ESLint hot-path check independently
    // rejects when expressed as an in-loop `new Path2D()`/object literal (task 6.5/6.6).
    expect(PerPointPathVariant.constructions).toBe(n);
    expect(PerPointPathVariant.constructions).not.toBe(1);
  });
});

describe("Canvas2DRenderer decimation boundary and per-frame paint sequence", () => {
  class FakePath2D implements PolylineSink {
    readonly recorded: Array<{ method: "moveTo" | "lineTo"; x: number; y: number }> = [];
    moveTo(x: number, y: number): void {
      this.recorded.push({ method: "moveTo", x, y });
    }
    lineTo(x: number, y: number): void {
      this.recorded.push({ method: "lineTo", x, y });
    }
  }

  // A plain function (not a class) so `new Path2D()` in production code can construct and
  // track the instance without a class constructor aliasing `this` to an outer variable.
  function TrackingFakePath2D(): FakePath2D {
    const instance = new FakePath2D();
    lastFakePath = instance;
    return instance;
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
      fillText(): void {
        this.calls.push("fillText");
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

  let lastFakePath: FakePath2D | null = null;
  let originalPath2D: unknown;

  beforeEach(() => {
    originalPath2D = (globalThis as Record<string, unknown>)["Path2D"];
    (globalThis as Record<string, unknown>)["Path2D"] = TrackingFakePath2D;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)["Path2D"] = originalPath2D;
    lastFakePath = null;
    vi.clearAllMocks();
  });

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

  it("decimates 100,000 and 1,000,000 samples to the same, threshold-bounded point count", () => {
    const { renderer: rendererA } = makeRenderer();
    rendererA.resize(400, 200, 1);
    rendererA.setData(populatedPayload(100_000));
    rendererA.render();
    const countA = lastFakePath?.recorded.length ?? 0;

    const { renderer: rendererB } = makeRenderer();
    rendererB.resize(400, 200, 1);
    rendererB.setData(populatedPayload(1_000_000));
    rendererB.render();
    const countB = lastFakePath?.recorded.length ?? 0;

    expect(countA).toBeGreaterThan(0);
    expect(countA).toBe(countB);
  });

  it("bypasses lttb entirely when sampleCount <= threshold", () => {
    const { renderer } = makeRenderer();
    renderer.resize(400, 200, 1);
    const sampleCount = 10; // far below any plausible plot-width-derived threshold
    renderer.setData(populatedPayload(sampleCount));
    renderer.render();

    expect(vi.mocked(lttb)).not.toHaveBeenCalled();
    expect(lastFakePath?.recorded.length).toBe(sampleCount);
  });

  it("invokes lttb exactly once across 60 unchanged render() calls", () => {
    const { renderer } = makeRenderer();
    renderer.resize(400, 200, 1);
    renderer.setData(populatedPayload(100_000));

    for (let i = 0; i < 60; i += 1) {
      renderer.render();
    }

    expect(vi.mocked(lttb)).toHaveBeenCalledTimes(1);
  });

  it("invokes lttb exactly once more after a commitPayloadRevision bump", () => {
    const { renderer } = makeRenderer();
    renderer.resize(400, 200, 1);
    const payload = populatedPayload(100_000);
    renderer.setData(payload);

    renderer.render();
    renderer.render();
    expect(vi.mocked(lttb)).toHaveBeenCalledTimes(1);

    commitPayloadRevision(payload, payload.sampleCount);
    renderer.render();

    expect(vi.mocked(lttb)).toHaveBeenCalledTimes(2);
  });

  it("records setTransform(1,0,0,1,0,0) exactly once per render() as the first call, and never scale/translate/rotate", () => {
    const { renderer, context } = makeRenderer();
    renderer.resize(400, 200, 1);
    renderer.setDomain(0, 100, -1, 1);
    renderer.setData(populatedPayload(50));
    context.calls.length = 0;

    renderer.render();

    expect(context.calls[0]).toBe("setTransform(1,0,0,1,0,0)");
    expect(context.calls.filter((c) => c.startsWith("setTransform")).length).toBe(1);
    for (const call of context.calls) {
      expect(call).not.toMatch(/^(scale|translate|rotate)/);
    }
  });

  it("derives lineWidth only from injected dpr, never from devicePixelRatio", () => {
    const { renderer, context } = makeRenderer();
    renderer.resize(400, 200, 3);
    renderer.setData(populatedPayload(50));

    renderer.render();

    expect(context.lineWidth).toBe(1.5 * 3);
  });

  it("packages/renderers/src/canvas2d/** and src/path/** never reference devicePixelRatio", () => {
    const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src");
    const dirs = ["canvas2d", "path"];
    for (const dir of dirs) {
      const dirPath = path.join(srcRoot, dir);
      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith(".ts")) continue;
        const source = readFileSync(path.join(dirPath, file), "utf8");
        expect(source).not.toMatch(/devicePixelRatio/);
      }
    }
  });

  // Task 14.5: with no `decimation` option, the resolved threshold must match the literal
  // formula inline here — never `resolveDecimationParameter`'s own output — so the renderer's
  // default and the core helper's formula cannot silently drift apart from each other.
  it("with no decimation option, invokes lttb exactly once at the plot-width-derived threshold and never invokes minMaxEnvelopeIndices", () => {
    const { renderer } = makeRenderer();
    renderer.resize(400, 200, 1);
    const sampleCount = 100_000;
    renderer.setData(populatedPayload(sampleCount));

    renderer.render();

    const plotWidth = renderer.transform.plotWidth;
    const expectedThreshold = Math.min(sampleCount, Math.max(2, Math.ceil(plotWidth * 2)));

    expect(vi.mocked(lttb)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lttb).mock.calls[0]?.[6]).toBe(expectedThreshold);
    expect(vi.mocked(minMaxEnvelopeIndices)).not.toHaveBeenCalled();
  });

  describe("setDecimation", () => {
    it("issues no drawing-surface call, and does not run decimation before the next render()", () => {
      const { renderer, context } = makeRenderer();
      renderer.resize(400, 200, 1);
      renderer.setData(populatedPayload(100_000));
      context.calls.length = 0;

      renderer.setDecimation({ algorithm: "min-max", bucketCount: 500 });

      expect(context.calls.length).toBe(0);
      expect(vi.mocked(lttb)).not.toHaveBeenCalled();
      expect(vi.mocked(minMaxEnvelopeIndices)).not.toHaveBeenCalled();
    });

    it("the next render() after setDecimation invokes minMaxEnvelopeIndices with the selected bucketCount and never lttb", () => {
      const { renderer } = makeRenderer();
      renderer.resize(400, 200, 1);
      renderer.setData(populatedPayload(100_000));

      renderer.setDecimation({ algorithm: "min-max", bucketCount: 500 });
      renderer.render();

      expect(vi.mocked(minMaxEnvelopeIndices)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(minMaxEnvelopeIndices).mock.calls[0]?.[5]).toBe(500);
      expect(vi.mocked(lttb)).not.toHaveBeenCalled();
    });

    it("setDecimation(undefined) restores the no-selection default drawn index set byte-for-byte", () => {
      const { renderer: rendererA } = makeRenderer();
      rendererA.resize(400, 200, 1);
      rendererA.setData(populatedPayload(100_000));
      rendererA.setDecimation({ algorithm: "min-max" });
      rendererA.render();
      rendererA.setDecimation(undefined);
      rendererA.render();
      const recordedA = lastFakePath?.recorded ?? [];

      const { renderer: rendererB } = makeRenderer();
      rendererB.resize(400, 200, 1);
      rendererB.setData(populatedPayload(100_000));
      rendererB.render();
      const recordedB = lastFakePath?.recorded ?? [];

      expect(recordedA).toEqual(recordedB);
    });

    it("switching algorithm at the same revision/domain forces recomputation and a different drawn index set", () => {
      const { renderer } = makeRenderer();
      renderer.resize(400, 200, 1);
      renderer.setData(populatedPayload(100_000));

      renderer.setDecimation({ algorithm: "lttb", threshold: 1920 });
      renderer.render();
      const recordedLttb = [...(lastFakePath?.recorded ?? [])];

      renderer.setDecimation({ algorithm: "min-max", bucketCount: 1920 });
      renderer.render();
      const recordedMinMax = [...(lastFakePath?.recorded ?? [])];

      expect(vi.mocked(minMaxEnvelopeIndices)).toHaveBeenCalledTimes(1);
      expect(recordedMinMax).not.toEqual(recordedLttb);
    });

    it("the resolved decimation function runs exactly once across 60 unchanged render() calls under a fixed selection", () => {
      const { renderer } = makeRenderer();
      renderer.resize(400, 200, 1);
      renderer.setData(populatedPayload(100_000));
      renderer.setDecimation({ algorithm: "min-max", bucketCount: 500 });

      for (let i = 0; i < 60; i += 1) {
        renderer.render();
      }

      expect(vi.mocked(minMaxEnvelopeIndices)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(lttb)).not.toHaveBeenCalled();
    });
  });

  // Task 14.11: regression guard for the memo-key widening — the per-frame Path2D contract and
  // `build-trace-path.ts`'s exact bytes must both be unaffected by the algorithm dimension added
  // to the memo key.
  describe("memo-widening regression guard", () => {
    it("render() still constructs exactly one Path2D per call after the memo widening", () => {
      const { renderer } = makeRenderer();
      renderer.resize(400, 200, 1);
      renderer.setData(populatedPayload(50));
      renderer.setDecimation({ algorithm: "min-max", bucketCount: 20 });

      let constructions = 0;
      (globalThis as Record<string, unknown>)["Path2D"] = class {
        constructor() {
          constructions += 1;
          return new FakePath2D();
        }
      };

      renderer.render();
      renderer.render();

      expect(constructions).toBe(2);
    });

    it("build-trace-path.ts is byte-identical to its pre-widening (phase 7-9) state", () => {
      const filePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src/path/build-trace-path.ts",
      );
      const source = readFileSync(filePath, "utf8");
      const hash = createHash("sha256").update(source).digest("hex");
      // Recaptured for the gap-aware pen-state walk (one moveTo per finite segment, none across
      // a break): the previous hash pinned the pre-gap-awareness unconditional-moveTo body. Any
      // further edit to build-trace-path.ts changes this hash and fails the guard, same as before.
      expect(hash).toBe(
        "7c2cec8e5240d06697a9ce2f0f36093d02cb221b373dacc7180a6344d3bc74ad",
      );
    });
  });
});
