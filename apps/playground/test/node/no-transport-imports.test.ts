/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

describe("playground worker & transport import scope boundaries", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.join(dir, "../../src");
  const streamingViewDir = path.join(srcDir, "views/streaming-transport");
  const files = collectTsFiles(srcDir);

  function isInsideStreamingView(filePath: string): boolean {
    const rel = path.relative(streamingViewDir, filePath);
    return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  it("permits new Worker(...) strictly inside views/streaming-transport/ and keeps non-transport views free of worker construction", () => {
    const outsideOffenders: string[] = [];
    const streamingWorkers: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/new Worker\(/.test(source)) {
        if (isInsideStreamingView(file)) {
          streamingWorkers.push(file);
        } else {
          outsideOffenders.push(file);
        }
      }
    }
    expect(outsideOffenders).toEqual([]);
    expect(streamingWorkers.length).toBeGreaterThanOrEqual(1);
  });

  it("permits @trace-kit/core/worker imports strictly inside views/streaming-transport/", () => {
    const outsideOffenders: string[] = [];
    const streamingImports: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/from\s+["']@trace-kit\/core\/worker["']/.test(source)) {
        if (isInsideStreamingView(file)) {
          streamingImports.push(file);
        } else {
          outsideOffenders.push(file);
        }
      }
    }
    expect(outsideOffenders).toEqual([]);
    expect(streamingImports.length).toBeGreaterThanOrEqual(1);
  });

  it("never imports @trace-kit/core/node inside browser playground sources", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/from\s+["']@trace-kit\/core\/node["']/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not configure COOP/COEP headers in apps/playground/vite.config.ts", () => {
    const viteConfig = readFileSync(path.join(dir, "../../vite.config.ts"), "utf8");
    expect(viteConfig).not.toMatch(/Cross-Origin-Opener-Policy/i);
    expect(viteConfig).not.toMatch(/Cross-Origin-Embedder-Policy/i);
  });
});
