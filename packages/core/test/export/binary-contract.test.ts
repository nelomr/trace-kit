import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BinaryArrayExport } from "../../src/export/binary-export.js";
import { exportNpy } from "../../src/export/npy.js";
import type * as RootEntry from "../../src/index.js";
import { buildPayload } from "../support/payload-builder.js";
import { concat, concatCopies } from "../support/npy-read.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const contractSource = readFileSync(path.join(packageRoot, "src/export/binary-export.ts"), "utf8");

// Compile-time: the contract is a synchronous generator of byte chunks.
const syncExport: BinaryArrayExport = (function* (): Generator<Uint8Array, void, undefined> {
  yield new Uint8Array(1);
})();
// @ts-expect-error an async generator is not a synchronous byte-chunk generator
const asyncExport: BinaryArrayExport = (async function* (): AsyncGenerator<Uint8Array, void, undefined> {
  await Promise.resolve();
  yield new Uint8Array(1);
})();
// Compile-time: the type is reachable from the package root entry.
type RootContract = RootEntry.BinaryArrayExport;
const viaRoot: RootContract = syncExport;
void asyncExport;
void viaRoot;

describe("BinaryArrayExport contract", () => {
  it("returns a plain IteratorResult from next(), never a Promise", () => {
    const first = syncExport.next();
    expect(first).not.toBeInstanceOf(Promise);
    expect(first.done).toBe(false);
  });

  it("documents the validity rule for yielded chunks", () => {
    expect(contractSource).toMatch(/valid only until the next `next\(\)`/);
    expect(contractSource).toMatch(/copy/);
    expect(contractSource).toMatch(/transfer list/);
  });

  it("names HDF5 and .npz only as deferred formats", () => {
    const mentions = contractSource.split("\n").filter((line) => /HDF5|\.npz/.test(line));
    expect(mentions.length).toBeGreaterThan(0);
    expect(contractSource).toMatch(/[Dd]eferred[^]*HDF5/);
    expect(contractSource).not.toMatch(/export\s+(function|const|class)[^\n]*(hdf5|npz)/i);
  });
});

describe("binary contract: aliasing of reused chunks", () => {
  const count = 2000;
  const x = new Float32Array(count);
  for (let i = 0; i < count; i += 1) x[i] = i;
  const payload = buildPayload({ x, y: x });
  const window = [-Infinity, Infinity] as const;
  const options = { chunkBytes: 1024 };

  it("typechecks the npy writer as a BinaryArrayExport", () => {
    const contract: BinaryArrayExport = exportNpy(payload, "x", window[0], window[1], options);
    expect(contract.next().done).toBe(false);
  });

  it("gives correct bytes to a consumer that copies each chunk before advancing", () => {
    const reference = fullReference();
    const copied = concatCopies(exportNpy(payload, "x", window[0], window[1], options));
    expect(Array.from(copied)).toEqual(Array.from(reference));
  });

  it("corrupts a consumer that retains the yielded references", () => {
    const reference = fullReference();
    const retained: Uint8Array[] = [];
    for (const chunk of exportNpy(payload, "x", window[0], window[1], options)) retained.push(chunk);
    expect(retained.length).toBeGreaterThan(2);
    expect(Array.from(concat(retained))).not.toEqual(Array.from(reference));
  });

  function fullReference(): Uint8Array {
    // One chunk big enough for the header and every element: nothing is overwritten.
    return concatCopies(exportNpy(payload, "x", window[0], window[1], { chunkBytes: 65536 }));
  }
});
