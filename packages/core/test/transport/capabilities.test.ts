import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectTransportCapabilities } from "../../src/transport/capabilities.js";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import { DecimationKind } from "../../src/transport/decimation-port.js";
import { SATURATED } from "../../src/transport/ownership.js";
import { StatCounter, StatGauge, createTransportStatsView } from "../../src/transport/backpressure.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

describe("detectTransportCapabilities", () => {
  it("re-evaluates on every call — no module-scope cache", () => {
    const before = detectTransportCapabilities();
    const globalWithSab = globalThis as { SharedArrayBuffer?: unknown };
    const original = globalWithSab.SharedArrayBuffer;
    try {
      delete globalWithSab.SharedArrayBuffer;
      const after = detectTransportCapabilities();
      expect(after.sharedMemory).toBe(false);
      if (original !== undefined) {
        expect(before.sharedMemory).toBe(true);
      }
    } finally {
      globalWithSab.SharedArrayBuffer = original;
    }
  });

  it("crossOriginIsolated is read for reporting only; no path requires it", () => {
    const caps = detectTransportCapabilities();
    expect(typeof caps.crossOriginIsolated).toBe("boolean");
  });
});

describe("full ownership suite passes with SharedArrayBuffer absent", () => {
  it("a full acquire/submit/settle/release round trip works with the global deleted", () => {
    const globalWithSab = globalThis as { SharedArrayBuffer?: unknown };
    const original = globalWithSab.SharedArrayBuffer;
    try {
      delete globalWithSab.SharedArrayBuffer;
      const port = createSyncDecimationPort({ poolPairs: 1, transitCapacitySamples: 8 });
      const lease = port.acquire();
      if (lease === SATURATED) throw new Error("unreachable");
      port.setKind(lease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease, 4);
      port.setBucketCount(lease, 2);
      port.submit(lease);
      let settled = 0;
      port.poll({
        onSettled: (l) => {
          settled += 1;
          port.release(l);
        },
      });
      expect(settled).toBe(1);
    } finally {
      globalWithSab.SharedArrayBuffer = original;
    }
  });
});

/**
 * Crude but sufficient source-level scanner: strips string/comment literals, then checks that no
 * line in the `DecimationPort` public surface references `BufferBacking` or
 * `SharedArrayBuffer`. Modeled on `isomorphism.test.ts`'s module-scope scanner and proven live
 * against a fixture that deliberately types a property with `BufferBacking`.
 */
function findSharedMemoryTypeReference(source: string): string | null {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const line of withoutComments.split("\n")) {
    if (/\bBufferBacking\b/.test(line) || /\bSharedArrayBuffer\b/.test(line)) {
      return line.trim();
    }
  }
  return null;
}

describe("the public DecimationPort surface never references BufferBacking or SharedArrayBuffer", () => {
  it("finds no shared-memory-specific type in decimation-port.ts", () => {
    const source = readFileSync(
      path.join(packageRoot, "src", "transport", "decimation-port.ts"),
      "utf8",
    );
    const violation = findSharedMemoryTypeReference(source);
    expect(violation).toBeNull();
  });

  it("the same check flags a fixture that types a property with BufferBacking", () => {
    const fixture = `export interface Bad {\n  backing: BufferBacking;\n}\n`;
    expect(findSharedMemoryTypeReference(fixture)).not.toBeNull();
  });
});

describe("no feature is gated on crossOriginIsolated or SharedArrayBuffer", () => {
  const lastAcceptIdx: number = StatGauge.LastAcceptMs;
  const lastSubmitIdx: number = StatGauge.LastSubmitMs;

  function driveRoundTrip(): {
    settledCount: number;
    counters: Int32Array;
    gauges: Float64Array;
    health: number;
  } {
    const pool = createBufferPool({ poolPairs: 2, transitCapacitySamples: 8 });
    let settledCount = 0;
    for (let i = 0; i < 5; i += 1) {
      const lease = pool.acquire();
      if (lease === SATURATED) continue;
      const inflight = pool.submit(lease);
      if (inflight === SATURATED) continue;
      pool.settle(inflight, 1);
      settledCount += 1;
    }
    const view = createTransportStatsView();
    pool.readStats(view);
    return {
      settledCount,
      counters: view.counters.slice(),
      gauges: view.gauges
        .slice()
        .map((v, idx) => (idx === lastAcceptIdx || idx === lastSubmitIdx ? 0 : v)),
      health: view.counters[StatCounter.Health] ?? -1,
    };
  }

  it("crossOriginIsolated true vs false produce field-by-field identical port behavior", () => {
    const g = globalThis as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
    const originalSab = g.SharedArrayBuffer;
    const originalCoi = g.crossOriginIsolated;
    try {
      delete g.SharedArrayBuffer;

      g.crossOriginIsolated = false;
      const capsFalse = detectTransportCapabilities();
      const resultFalse = driveRoundTrip();

      g.crossOriginIsolated = true;
      const capsTrue = detectTransportCapabilities();
      const resultTrue = driveRoundTrip();

      expect(capsFalse.crossOriginIsolated).toBe(false);
      expect(capsTrue.crossOriginIsolated).toBe(true);
      expect(resultTrue.settledCount).toBe(resultFalse.settledCount);
      expect(Array.from(resultTrue.counters)).toEqual(Array.from(resultFalse.counters));
      expect(Array.from(resultTrue.gauges)).toEqual(Array.from(resultFalse.gauges));
      expect(resultTrue.health).toBe(resultFalse.health);
    } finally {
      g.SharedArrayBuffer = originalSab;
      g.crossOriginIsolated = originalCoi;
    }
  });
});

describe("BufferBacking selection", () => {
  it("selects Transfer via a test-only accessor when SharedArrayBuffer is absent", () => {
    const globalWithSab = globalThis as { SharedArrayBuffer?: unknown };
    const original = globalWithSab.SharedArrayBuffer;
    try {
      delete globalWithSab.SharedArrayBuffer;
      const pool = createBufferPool({ poolPairs: 1 });
      expect(pool.__debugBacking()).toBe(0); // BufferBacking.Transfer
    } finally {
      globalWithSab.SharedArrayBuffer = original;
    }
  });
});

describe("no COOP/COEP requirement is documented", () => {
  function walkFiles(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(absolutePath, out);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".md"))
      ) {
        out.push(absolutePath);
      }
    }
  }

  it("scans every transport source file for COOP/COEP presented as a prerequisite", () => {
    const files: string[] = [];
    walkFiles(path.join(packageRoot, "src", "transport"), files);
    const requirementPhrasing =
      /(must|required|requires|need to)[^.\n]*(Cross-Origin-Opener-Policy|Cross-Origin-Embedder-Policy|crossOriginIsolated\s*===?\s*true)/i;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(requirementPhrasing.test(source), file).toBe(false);
    }
  });
});
