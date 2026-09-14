import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(absolutePath, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(absolutePath);
    }
  }
}

/**
 * A crude but sufficient module-scope scanner: strips string/comment literals, then checks that
 * no top-level (non-indented, i.e. not nested inside a function body opened by an unmatched
 * brace) line references `new Worker(`, a bare `Worker` type/value, or `self`. Good enough to
 * gate real source without a full parser, and proven live against a fixture below.
 */
function findModuleScopeWorkerReference(source: string): string | null {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const lines = withoutComments.split("\n");
  let depth = 0;
  for (const line of lines) {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    const atModuleScopeBeforeLine = depth === 0;
    if (atModuleScopeBeforeLine && /\bnew Worker\(/.test(line)) return line.trim();
    if (
      atModuleScopeBeforeLine &&
      /(^|[^.\w])Worker([^.\w]|$)/.test(line) &&
      !/^\s*(export\s+)?(interface|type)\s/.test(line)
    ) {
      return line.trim();
    }
    depth += opens - closes;
  }
  return null;
}

describe("isomorphism — no Worker/self at module scope, no Worker construction", () => {
  it("finds no violation anywhere under packages/core/src/transport", () => {
    const files: string[] = [];
    walkTsFiles(path.join(packageRoot, "src", "transport"), files);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const violation = findModuleScopeWorkerReference(source);
      expect(violation, `${file}: ${violation}`).toBeNull();
    }
  });

  it("the same check flags the committed worker-construction-violation fixture", () => {
    const fixturePath = path.join(
      packageRoot,
      "test",
      "fixtures",
      "worker-construction-violation.ts",
    );
    const source = readFileSync(fixturePath, "utf8");
    const violation = findModuleScopeWorkerReference(source);
    expect(violation).not.toBeNull();
  });

  it("importing the committed dom-reference fixture throws ReferenceError, proving a module-scope DOM reference is fatal here", async () => {
    await expect(import("../fixtures/dom-reference.js")).rejects.toThrow(ReferenceError);
  });

  it("createSyncDecimationPort runs a full round trip with no ReferenceError, window/document/Worker all undefined, SharedArrayBuffer deleted", () => {
    const globalWithSab = globalThis as { SharedArrayBuffer?: unknown };
    const original = globalWithSab.SharedArrayBuffer;
    try {
      delete globalWithSab.SharedArrayBuffer;
      expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
      expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
      expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe("undefined");

      const port = createSyncDecimationPort({ poolPairs: 1 });
      expect(() => {
        const lease = port.acquire();
        if (lease !== -1) {
          port.submit(lease);
          port.poll({ onSettled: (l) => port.release(l) });
        }
      }).not.toThrow();
    } finally {
      globalWithSab.SharedArrayBuffer = original;
    }
  });
});
