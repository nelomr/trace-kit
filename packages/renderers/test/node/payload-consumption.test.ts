/** @vitest-environment node */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commitPayloadRevision, createSpectrumDataPayload, projectX } from "@trace-kit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import {
  installRecordingPath2D,
  RecordingContext,
  RecordingPath2D,
  recordingSurface,
} from "./support/recording-context.js";

function collectSourceFiles(dirPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // `src/fixtures/**` is a deliberate, documented exception: it builds real
      // `SpectrumDataPayload` fixtures once at module load, to hand to a caller's renderer by
      // reference — the same shape a real application's own payload-owning code would produce.
      // The rule this file enforces is scoped to the renderer's own *runtime painting path*
      // never constructing a payload during a render call, not to every file under `src/`
      // never mentioning these two function names anywhere.
      if (entry.name === "fixtures") continue;
      const entryPath = path.join(dirPath, entry.name);
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      files.push(path.join(dirPath, entry.name));
    }
  }
  return files;
}

describe("renderer payload consumption (renderers never construct, mutate, or transfer payload buffers)", () => {
  const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src");

  it("packages/renderers/src/** never constructs, mutates, or transfers payload buffers", () => {
    for (const file of collectSourceFiles(srcRoot)) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/createSpectrumDataPayload/);
      expect(source).not.toMatch(/commitPayloadRevision/);
      expect(source).not.toMatch(/postMessage/);
    }
  });

  it("payload.x/payload.y byteLength are unchanged by setData + render()", () => {
    const context: {
      calls: string[];
      fillStyle: string;
      strokeStyle: string;
      lineWidth: number;
      font: string;
      textAlign: string;
      textBaseline: string;
      setTransform(): void;
      fillRect(): void;
      beginPath(): void;
      moveTo(): void;
      lineTo(): void;
      stroke(): void;
      fillText(): void;
      save(): void;
      restore(): void;
      rect(): void;
      clip(): void;
    } = {
      calls: [],
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      setTransform(): void {
        this.calls.push("setTransform");
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
      save(): void {},
      restore(): void {},
      rect(): void {},
      clip(): void {},
    };
    const canvas = { getContext: () => context };
    // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
    const surface = canvas as unknown as HTMLCanvasElement;
    const originalPath2D = (globalThis as Record<string, unknown>)["Path2D"];
    (globalThis as Record<string, unknown>)["Path2D"] = class {
      moveTo(): void {}
      lineTo(): void {}
    };

    try {
      const renderer = new Canvas2DRenderer({ surface });
      renderer.resize(200, 100, 1);
      const payload = createSpectrumDataPayload({
        capacity: 16,
        xOrigin: 0,
        xUnit: "nm",
        yUnit: "dBm",
      });
      for (let i = 0; i < 16; i += 1) {
        payload.x[i] = i;
        payload.y[i] = i;
      }
      commitPayloadRevision(payload, 16);
      const xByteLengthBefore = payload.x.byteLength;
      const yByteLengthBefore = payload.y.byteLength;

      renderer.setData(payload);
      renderer.render();

      expect(payload.x.byteLength).toBe(xByteLengthBefore);
      expect(payload.y.byteLength).toBe(yByteLengthBefore);
    } finally {
      (globalThis as Record<string, unknown>)["Path2D"] = originalPath2D;
    }
  });
});

describe("single payload under an absolute X domain", () => {
  let restorePath2D: () => void;
  beforeEach(() => {
    restorePath2D = installRecordingPath2D();
  });
  afterEach(() => {
    restorePath2D();
  });

  function drawn(xOrigin: number, offsets: readonly number[], xMin: number, xMax: number) {
    const payload = createSpectrumDataPayload({
      capacity: offsets.length,
      xOrigin,
      xUnit: "nm",
      yUnit: "dBm",
    });
    offsets.forEach((x, i) => {
      payload.x[i] = x;
      payload.y[i] = i;
    });
    commitPayloadRevision(payload, offsets.length);
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context) });
    renderer.setData(payload);
    renderer.resize(400, 200, 1);
    renderer.setDomain(xMin, xMax, -1, 1);
    RecordingPath2D.created.length = 0;
    renderer.render();
    const xs = (RecordingPath2D.created[0]?.ops ?? []).map((op) => Number(op.args[0]));
    return { renderer, payload, xs };
  }

  it("spans the plot for a non-zero origin whose domain is absolute", () => {
    const { renderer, xs } = drawn(1550, [0, 0.5, 1], 1550, 1551);
    const t = renderer.transform;
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBe(t.plotLeft);
    expect(xs[1]).toBeCloseTo(t.plotLeft + t.plotWidth / 2, 9);
    expect(xs[2]).toBeCloseTo(t.plotLeft + t.plotWidth, 9);
  });

  it("reads setDomain bounds as absolute X and keeps the offset-space left edge in xOffsetMin", () => {
    const { renderer } = drawn(1550, [0, 0.5, 1], 1550, 1551);
    const t = renderer.transform;
    expect(t.xDomainMin).toBe(1550);
    expect(t.xDomainMax).toBe(1551);
    expect(t.xOffsetMin).toBe(0);
    expect(projectX(t, 0.5)).toBeCloseTo(t.plotLeft + t.plotWidth / 2, 9);
  });

  it("puts a zero-origin payload far outside the same absolute window", () => {
    const { renderer, xs } = drawn(0, [0, 1], 1550, 1551);
    const t = renderer.transform;
    expect(t.xOffsetMin).toBe(1550);
    expect(xs[0]).toBeLessThan(t.plotLeft - 1000);
    expect(xs[1]).toBeLessThan(t.plotLeft - 1000);
  });

  it("draws a zero-origin payload at plotLeft + (x - 0) * xScale", () => {
    const offsets = [0, 3.5, 64, 511];
    const { renderer, xs } = drawn(0, offsets, 0, 512);
    const t = renderer.transform;
    expect(xs).toEqual(offsets.map((x) => t.plotLeft + (x - 0) * t.xScale));
  });
});
