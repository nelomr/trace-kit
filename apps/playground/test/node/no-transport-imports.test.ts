/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TRANSPORT_EXPORTS = [
  "DecimationPort",
  "Lease",
  "SettlementSink",
  "RawSampleRing",
  "SyncDecimationPortConfig",
  "collectTransferList",
  "createSyncDecimationPort",
  "detectTransportCapabilities",
];

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

describe("no @trace-kit/core transport-surface import, no Worker construction", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.join(dir, "../../src");
  const files = collectTsFiles(srcDir);

  it("imports no name from @trace-kit/core's transport export block", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const match = /import\s*\{([^}]*)\}\s*from\s*["']@trace-kit\/core["']/.exec(source);
      if (!match) continue;
      const importedNames = match[1]?.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]) ?? [];
      if (importedNames.some((name) => TRANSPORT_EXPORTS.includes(name ?? ""))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("constructs no Worker anywhere under the tree", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/new Worker\(/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
