/** @vitest-environment node */
import { commitPayloadRevision, createSpectrumDataPayload, type SpectrumDataPayload } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import type { OverlayDrawingContext } from "../../src/webgl2/surfaces.js";
import { WebGL2FigureRenderer } from "../../src/webgl2/webgl2-figure-renderer.js";
import { asSurface, FakeSurface } from "./support/fake-surface.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";

const SAMPLE_COUNT = 100_000;
const FRAMES = 1_000;

/** A 2D context that does nothing and keeps nothing, so the gate sees only the renderer's own allocations. */
class QuietContext implements OverlayDrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineJoin: CanvasLineJoin = "miter";
  font = "";
  textAlign: CanvasTextAlign = "left";
  textBaseline: CanvasTextBaseline = "alphabetic";
  setTransform(): void {}
  fillRect(): void {}
  clearRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  fillText(): void {}
  setLineDash(): void {}
  fill(): void {}
}

function sweep(): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: SAMPLE_COUNT, xOrigin: 0, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    payload.x[i] = i;
    payload.y[i] = i % 5000 === 17 ? NaN : Math.sin(i * 0.001);
  }
  commitPayloadRevision(payload, SAMPLE_COUNT);
  return payload;
}

function build(recording: boolean) {
  const gl = new RecordingGl2Context();
  gl.recording = recording;
  const renderer = new WebGL2FigureRenderer({
    surfaces: {
      underlay: asSurface(new FakeSurface(new QuietContext())),
      plot: asSurface(new FakeSurface(gl)),
      overlay: asSurface(new FakeSurface(new QuietContext())),
    },
  });
  const payload = sweep();
  renderer.setData(payload);
  renderer.setDomain(0, SAMPLE_COUNT, -1.2, 1.2);
  renderer.resize(1920, 1080, 1);
  return { renderer, gl, payload };
}

async function countGcEvents(run: () => void, frames: number): Promise<number> {
  if (typeof globalThis.gc !== "function") throw new Error("run with --expose-gc");
  let events = 0;
  const observer = new PerformanceObserver((list) => {
    events += list.getEntriesByType("gc").length;
  });
  observer.observe({ entryTypes: ["gc"] });
  for (let i = 0; i < 20; i += 1) run();
  globalThis.gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
  events = 0;
  for (let i = 0; i < frames; i += 1) run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer.disconnect();
  return events;
}

describe("WebGL2FigureRenderer frame allocation gate", () => {
  it("reports 0 GC events over 1,000 render() calls on 100,000 samples", async () => {
    const { renderer, gl } = build(false);
    renderer.render();
    expect(gl.liveCount("buffer")).toBeGreaterThan(0);
    const events = await countGcEvents(() => {
      renderer.render();
    }, FRAMES);
    expect(events).toBe(0);
  }, 120_000);

  it("the control, bumping the revision every frame against a recording fake, reports GC events", async () => {
    const { renderer, payload } = build(true);
    renderer.render();
    const events = await countGcEvents(() => {
      commitPayloadRevision(payload, SAMPLE_COUNT);
      renderer.render();
    }, 100);
    expect(events).toBeGreaterThan(0);
  }, 120_000);
});
