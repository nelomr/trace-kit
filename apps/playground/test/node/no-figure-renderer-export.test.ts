/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FigureRenderer } from "@trace-kit/renderers";
import type { ViewportTransform } from "@trace-kit/core";

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("FigureRenderer comes from @trace-kit/renderers, not the playground", () => {
  it("imports FigureRenderer and ViewportTransform from @trace-kit/renderers", () => {
    // Type-only fixtures: these never execute, but they fail `tsc --noEmit` if either name
    // stops being importable from the renderers package's public surface.
    const _figureRenderer: FigureRenderer | undefined = undefined;
    const _viewportTransform: ViewportTransform | undefined = undefined;
    expect(_figureRenderer).toBeUndefined();
    expect(_viewportTransform).toBeUndefined();
  });

  it("apps/playground/src does not re-declare FigureRenderer or ViewportTransform locally", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const srcDir = path.join(dir, "../../src");
    const offenders: string[] = [];
    for (const file of collectTsFiles(srcDir)) {
      const source = readFileSync(file, "utf8");
      if (/export\s+(type\s+|interface\s+|class\s+)?(FigureRenderer|ViewportTransform)\b/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
