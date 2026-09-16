import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// `@trace-kit/renderers` is a headless drawing surface, not a transport: it never spawns a
// worker, never posts a message, and never transfers a buffer. Those concerns belong entirely
// to the host application (mirrors `apps/playground/test/node/no-transport-imports.test.ts`).
// This scans the actual compiled-from source, not a snapshot, so it stays accurate as files
// are added by later phases.
function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entryPath = path.join(dir, entries[i] ?? "");
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      const nested = listFiles(entryPath);
      for (let j = 0; j < nested.length; j += 1) {
        files.push(nested[j] ?? "");
      }
    } else if (entryPath.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

describe("packages/renderers/src — no worker/transport references", () => {
  it("contains none of Worker, postMessage, transferControlToOffscreen, structuredClone, self", () => {
    const srcDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src",
    );
    const files = listFiles(srcDir);
    const forbidden = [
      /\bWorker\b/,
      /\bpostMessage\b/,
      /\btransferControlToOffscreen\b/,
      /\bstructuredClone\b/,
      /\bself\b/,
    ];
    for (let i = 0; i < files.length; i += 1) {
      const filePath = files[i] ?? "";
      const source = readFileSync(filePath, "utf8");
      for (let j = 0; j < forbidden.length; j += 1) {
        expect(source, `${filePath} must not reference ${forbidden[j]}`).not.toMatch(
          forbidden[j] ?? /$^/,
        );
      }
    }
  });
});
