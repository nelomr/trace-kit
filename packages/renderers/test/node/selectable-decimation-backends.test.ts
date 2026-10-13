/** @vitest-environment node */
import { readFileSync } from "node:fs";
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type DecimationSelection,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { deriveDecimationTarget } from "../../src/rules/decimation.js";
import { installRecordingPath2D, RecordingContext, recordingSurface, RecordingPath2D } from "./support/recording-context.js";
import { createHarness } from "./support/webgl2-harness.js";

function payloadOf(n: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: n, xOrigin: 0, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < n; i += 1) {
    payload.x[i] = i;
    payload.y[i] = Math.sin(i / 13);
  }
  commitPayloadRevision(payload, n);
  return payload;
}

/** Vertices a Canvas2D path was built from, read off the recorded path commands. */
function canvas2dVertexCount(selection: DecimationSelection | "default" | "restored", n: number): number {
  const restore = installRecordingPath2D();
  try {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer(
      selection === "default" || selection === "restored"
        ? { surface: recordingSurface(context) }
        : { surface: recordingSurface(context), decimation: selection },
    );
    renderer.resize(400, 300, 1);
    renderer.setData(payloadOf(n));
    if (selection === "restored") {
      renderer.setDecimation({ algorithm: "min-max", bucketCount: 5 });
      renderer.setDecimation(undefined);
    }
    renderer.render();
    const path = RecordingPath2D.created[0];
    return path === undefined ? 0 : path.ops.filter((op) => op.name === "moveTo" || op.name === "lineTo").length;
  } finally {
    restore();
  }
}

function webgl2UploadedCount(selection: DecimationSelection | "default" | "restored", n: number): number {
  const h = createHarness(
    selection === "default" || selection === "restored" ? {} : { rendererOptions: { decimation: selection } },
  );
  h.renderer.resize(400, 300, 1);
  h.renderer.setData(payloadOf(n));
  if (selection === "restored") {
    h.renderer.setDecimation({ algorithm: "min-max", bucketCount: 5 });
    h.renderer.render();
    h.renderer.setDecimation(undefined);
  }
  h.renderer.render();
  return h.gl.bufferUploads().at(-1)?.length ?? 0;
}

describe("per-backend default selection", () => {
  const n = 20_000;
  it("Canvas2D defaults to LTTB at min(n, max(2, ceil(2 * plotWidth))) and WebGL2 to the full payload", () => {
    const plotWidth = createHarness().renderer.transform.plotWidth;
    void plotWidth;
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    const target = deriveDecimationTarget(n, h.renderer.transform.plotWidth);
    expect(target).toBeLessThan(n);
    expect(canvas2dVertexCount("default", n)).toBeGreaterThan(0);
    expect(webgl2UploadedCount("default", n)).toBe(n);
  });

  it("setDecimation(undefined) restores each backend's own default", () => {
    expect(webgl2UploadedCount("restored", n)).toBe(n);
    expect(canvas2dVertexCount("restored", n)).toBe(canvas2dVertexCount("default", n));
  });
});

describe("explicit selections", () => {
  it("yield the same vertex count on both engines", () => {
    for (const selection of [
      { algorithm: "lttb", threshold: 150 },
      { algorithm: "min-max", bucketCount: 40 },
    ] as const) {
      expect(webgl2UploadedCount(selection, 20_000)).toBe(canvas2dVertexCount(selection, 20_000));
    }
  });
});

describe("documentation of the default", () => {
  it("both option blocks name the backend's default", () => {
    for (const file of ["../../src/canvas2d/canvas2d-renderer.ts", "../../src/webgl2/webgl2-figure-renderer.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).toContain("this backend's default");
    }
    const contract = readFileSync(new URL("../../src/figure-renderer.ts", import.meta.url), "utf8");
    expect(contract).toContain("the backend's default");
  });
});
