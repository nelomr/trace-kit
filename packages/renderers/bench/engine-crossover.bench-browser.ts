import { commands } from "vitest/browser";
import { describe, it } from "vitest";
import { runBenchmark } from "@trace-kit/bench-harness";
import { commitPayloadRevision, createSpectrumDataPayload, type SpectrumDataPayload } from "@trace-kit/core";
import { Canvas2DRenderer } from "../src/canvas2d/canvas2d-renderer.js";
import { WebGL2FigureRenderer } from "../src/webgl2/webgl2-figure-renderer.js";

// Non-normative crossover measurement: frame time and memory per engine and sample count. It
// reports numbers and asserts nothing, so it can never gate a run. Each iteration is `render()`
// followed by a one-pixel synchronising read, so GPU work is inside the timed region.

const COUNTS = [10_000, 30_000, 80_000, 250_000, 1_000_000] as const;
const CSS_WIDTH = 800;
const CSS_HEIGHT = 600;
const DPR = 2; // 1600 x 1200 device pixels
const WARMUP = 20;
const ITERATIONS = 60;

type Engine = "canvas2d" | "webgl2";

interface Row {
  readonly engine: Engine;
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly heapDeltaBytes: number | null;
  readonly gpuEstimateBytes: number;
}

/** xorshift32: deterministic noise, so every run measures the same sweep. */
function noiseSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** A Lorentzian resonance on a noise floor, the signal shape this engine targets. */
function sweepPayload(n: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: n, xOrigin: 1550, xUnit: "nm", yUnit: "dBm" });
  const noise = noiseSource(0x1234abcd);
  const centre = n / 2;
  const halfWidth = n / 200;
  for (let i = 0; i < n; i += 1) {
    const d = (i - centre) / halfWidth;
    payload.x[i] = (i / (n - 1)) * 10;
    payload.y[i] = -60 + 50 / (1 + d * d) + (noise() - 0.5) * 2;
  }
  commitPayloadRevision(payload, n);
  return payload;
}

function heapUsed(): number | null {
  const perf: Performance & { memory?: { usedJSHeapSize: number } } = performance;
  return perf.memory === undefined ? null : perf.memory.usedJSHeapSize;
}

function measureCanvas2d(payload: SpectrumDataPayload): Row {
  const before = heapUsed();
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const renderer = new Canvas2DRenderer({ surface: canvas });
  renderer.setData(payload);
  renderer.setDomain(0, 10, -70, -5);
  renderer.resize(CSS_WIDTH, CSS_HEIGHT, DPR);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  const result = runBenchmark(
    `canvas2d ${payload.sampleCount}`,
    () => {
      renderer.render();
      context.getImageData(0, 0, 1, 1);
    },
    { warmup: WARMUP, iterations: ITERATIONS },
  );
  const after = heapUsed();
  renderer.dispose();
  canvas.remove();
  return {
    engine: "canvas2d",
    samples: payload.sampleCount,
    medianMs: result.median,
    p95Ms: result.p95,
    heapDeltaBytes: before === null || after === null ? null : after - before,
    gpuEstimateBytes: 0,
  };
}

function measureWebGl2(payload: SpectrumDataPayload): Row {
  const before = heapUsed();
  const make = (): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    return canvas;
  };
  const underlay = make();
  const plot = make();
  const overlay = make();
  const renderer = new WebGL2FigureRenderer({ surfaces: { underlay, plot, overlay } });
  renderer.setData(payload);
  renderer.setDomain(0, 10, -70, -5);
  renderer.resize(CSS_WIDTH, CSS_HEIGHT, DPR);
  // The renderer's own context: `getContext("webgl2")` on a canvas returns the existing one.
  const gl = plot.getContext("webgl2");
  if (gl === null) throw new Error("the plot canvas has no webgl2 context");
  const pixel = new Uint8Array(4);
  const result = runBenchmark(
    `webgl2 ${payload.sampleCount}`,
    () => {
      renderer.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    },
    { warmup: WARMUP, iterations: ITERATIONS },
  );
  const after = heapUsed();
  renderer.dispose();
  for (const canvas of [underlay, plot, overlay]) canvas.remove();
  return {
    engine: "webgl2",
    samples: payload.sampleCount,
    medianMs: result.median,
    p95Ms: result.p95,
    heapDeltaBytes: before === null || after === null ? null : after - before,
    // Two float32 buffers of `n` samples; no markers on a gap-free sweep.
    gpuEstimateBytes: 8 * payload.sampleCount,
  };
}

describe("engine crossover", () => {
  it("measures frame time and memory per engine and sample count", async () => {
    const rendererString = (() => {
      const probe = new OffscreenCanvas(1, 1).getContext("webgl2");
      const info = probe?.getExtension("WEBGL_debug_renderer_info");
      return probe === null || info === null || info === undefined
        ? "unavailable"
        : String(probe.getParameter(info.UNMASKED_RENDERER_WEBGL));
    })();
    const rows: Row[] = [];
    for (const samples of COUNTS) {
      const payload = sweepPayload(samples);
      rows.push(measureCanvas2d(payload));
      rows.push(measureWebGl2(payload));
    }
    await commands.writeFile(
      "bench/engine-crossover-results.json",
      `${JSON.stringify({ renderer: rendererString, userAgent: navigator.userAgent, canvas: { width: CSS_WIDTH * DPR, height: CSS_HEIGHT * DPR }, rows }, null, 2)}\n`,
    );
  });
});
