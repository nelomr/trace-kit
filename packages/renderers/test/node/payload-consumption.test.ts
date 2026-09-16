/** @vitest-environment node */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commitPayloadRevision, createSpectrumDataPayload } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";

function collectSourceFiles(dirPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
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
