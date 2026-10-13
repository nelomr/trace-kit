import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportNpy, NPY_DEFAULT_CHUNK_BYTES, buildNpyHeader } from "../../src/export/npy.js";
import * as rootEntry from "../../src/index.js";
import type { SpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";
import { buildPayload } from "../support/payload-builder.js";
import { concatCopies, decodeNpyData, parseNpyHeader } from "../support/npy-read.js";

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

const EXPECTED_DICT_F8 = "{'descr': '<f8', 'fortran_order': False, 'shape': (3,), }";

describe("exportNpy: byte-exact header", () => {
  const payload = buildPayload({ xOrigin: 1550, x: [0, 0.5, 1], y: [1, 2, 3] });

  it("writes the 128-byte header of a three-sample <f8 array", () => {
    // Copy each chunk: they are views of one scratch buffer that the next chunk overwrites.
    const chunks = Array.from(exportNpy(payload, "x", -Infinity, Infinity), (chunk) => chunk.slice());
    const header = chunks[0];
    expect(header).toBeDefined();
    if (header === undefined) return;
    expect(Array.from(header.subarray(0, 8))).toEqual([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00]);
    expect(Array.from(header.subarray(8, 10))).toEqual([0x76, 0x00]);
    expect(ascii(header, 10, 10 + EXPECTED_DICT_F8.length)).toBe(EXPECTED_DICT_F8);
    expect(EXPECTED_DICT_F8.length).toBe(57);
    const padding = header.subarray(10 + 57, 127);
    expect(padding.length).toBe(60);
    expect(padding.every((byte) => byte === 0x20)).toBe(true);
    expect(header[127]).toBe(0x0a);
    expect(header.length).toBe(128);
    expect(concatCopies(exportNpy(payload, "x", -Infinity, Infinity)).length).toBe(128 + 24);
  });

  it("writes the same-structure header for <f4 with 12 data bytes", () => {
    const bytes = concatCopies(exportNpy(payload, "y", -Infinity, Infinity));
    const header = parseNpyHeader(bytes);
    expect(header.headerLen).toBe(118);
    expect(header.dict).toContain("'descr': '<f4'");
    expect(header.dataOffset).toBe(128);
    expect(bytes.length).toBe(128 + 12);
  });

  it("writes a header-only file for a zero-sample window", () => {
    const chunks = Array.from(exportNpy(payload, "x", 100, 200), (chunk) => chunk.slice());
    expect(chunks.length).toBe(1);
    const header = parseNpyHeader(chunks[0] ?? new Uint8Array(0));
    expect(header.shape).toEqual([0]);
    expect(header.dict).toContain("'shape': (0,)");
    expect((10 + header.headerLen) % 64).toBe(0);
    expect(chunks[0]?.length).toBe(10 + header.headerLen);
  });

  it("keeps 10 + HEADER_LEN a multiple of 64 and pads minimally", () => {
    const scratch = new Uint8Array(128);
    for (const count of [0, 1, 9, 99, 1000, 123456789]) {
      for (const descr of ["<f8", "<f4"] as const) {
        const length = buildNpyHeader(descr, count, scratch);
        const headerLen = length - 10;
        expect(length % 64).toBe(0);
        expect(scratch[length - 1]).toBe(0x0a);
        const text = ascii(scratch, 10, length - 1);
        expect(text).toMatch(/^\{.*\}\s*$/);
        // The padding is exactly the minimum: one less 64-byte block would not hold the dict.
        const dictEnd = text.lastIndexOf("}") + 1;
        expect(10 + dictEnd + 1 + 64).toBeGreaterThan(length);
        expect(headerLen).toBe(text.length + 1);
      }
    }
  });

  it("stays aligned and inside one 128-byte scratch for any count up to 2^53", () => {
    const scratch = new Uint8Array(128);
    fc.assert(
      fc.property(
        fc.oneof(fc.maxSafeNat(), fc.constant(2 ** 53)),
        fc.constantFrom("<f8", "<f4"),
        (count, descr) => {
          const length = buildNpyHeader(descr, count, scratch);
          return length % 64 === 0 && length <= 128 && scratch[length - 1] === 0x0a;
        },
      ),
    );
  });
});

describe("exportNpy: values", () => {
  it("writes absolute X as little-endian f64", () => {
    const offset = Math.fround(0.123456);
    const payload = buildPayload({ xOrigin: 1550, x: [offset], y: [1] });
    const bytes = concatCopies(exportNpy(payload, "x", -Infinity, Infinity));
    expect(decodeNpyData(bytes)).toEqual([1550 + offset]);
  });

  it("keeps Y bits for finite values, infinities and negative zero", () => {
    const payload = buildPayload({ x: [0, 1, 2, 3], y: [1.5, NaN, Infinity, -0] });
    const bytes = concatCopies(exportNpy(payload, "y", -Infinity, Infinity));
    const header = parseNpyHeader(bytes);
    expect(header.descr).toBe("<f4");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = (i: number): number => view.getUint32(header.dataOffset + 4 * i, true);
    expect(at(0)).toBe(0x3fc00000);
    expect(Number.isNaN(view.getFloat32(header.dataOffset + 4, true))).toBe(true);
    expect(at(2)).toBe(0x7f800000);
    expect(at(3)).toBe(0x80000000);
  });

  it("writes only the resolved window and keeps X and Y index-aligned", () => {
    const payload = buildPayload({
      x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      y: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    });
    const x = concatCopies(exportNpy(payload, "x", 3, 6));
    const y = concatCopies(exportNpy(payload, "y", 3, 6));
    expect(parseNpyHeader(x).shape).toEqual([4]);
    expect(parseNpyHeader(y).shape).toEqual([4]);
    expect(decodeNpyData(x)).toEqual([3, 4, 5, 6]);
    expect(decodeNpyData(y)).toEqual([13, 14, 15, 16]);
  });

  it("honours includeNeighbours", () => {
    const payload = buildPayload({ x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
    const bytes = concatCopies(exportNpy(payload, "x", 3, 6, { includeNeighbours: true }));
    expect(parseNpyHeader(bytes).shape).toEqual([6]);
    expect(decodeNpyData(bytes)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("decodes little-endian regardless of the host byte order", () => {
    const payload = buildPayload({ x: [1], y: [1] });
    const bytes = concatCopies(exportNpy(payload, "y", 0, 2));
    // 1.0f as little-endian bytes is 00 00 80 3F on every host.
    expect(Array.from(bytes.subarray(bytes.length - 4))).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });
});

describe("exportNpy: chunking", () => {
  const count = 3000;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = i * 0.5;
    y[i] = Math.sin(i);
  }
  const payload = buildPayload({ xOrigin: 100, x, y });

  it("produces the same bytes for every chunkBytes", () => {
    for (const array of ["x", "y"] as const) {
      const reference = concatCopies(exportNpy(payload, array, -Infinity, Infinity));
      for (const chunkBytes of [128, 1024, 65536]) {
        const bytes = concatCopies(exportNpy(payload, array, -Infinity, Infinity, { chunkBytes }));
        expect(Array.from(bytes)).toEqual(Array.from(reference));
      }
    }
  });

  it("yields chunks no larger than chunkBytes", () => {
    for (const chunk of exportNpy(payload, "x", -Infinity, Infinity, { chunkBytes: 1024 })) {
      expect(chunk.length).toBeLessThanOrEqual(1024);
    }
  });

  it("rejects an invalid chunkBytes with a RangeError before any payload read", () => {
    let reads = 0;
    const spy: SpectrumDataPayload = {
      ...payload,
      get x() {
        reads += 1;
        return payload.x;
      },
      get sampleCount() {
        reads += 1;
        return payload.sampleCount;
      },
    };
    for (const chunkBytes of [100, 64, 130, 1.5, NaN, Infinity, -128, 0]) {
      expect(() => exportNpy(spy, "x", 0, 1, { chunkBytes })).toThrow(RangeError);
    }
    expect(reads).toBe(0);
  });

  it("reuses one ArrayBuffer for every chunk of a 1M-sample export", () => {
    const big = 1_000_000;
    const bx = new Float32Array(big);
    for (let i = 0; i < big; i += 1) bx[i] = i;
    const large = buildPayload({ x: bx, y: bx });
    const buffers = new Set<ArrayBufferLike>();
    let chunks = 0;
    let bytes = 0;
    for (const chunk of exportNpy(large, "x", -Infinity, Infinity)) {
      buffers.add(chunk.buffer);
      chunks += 1;
      bytes += chunk.length;
    }
    expect(buffers.size).toBe(1);
    expect(chunks).toBeGreaterThan(100);
    expect(bytes).toBe(128 + big * 8);
  }, 60_000);

  it("is lazy: nothing is read before the first next()", () => {
    let reads = 0;
    const spy: SpectrumDataPayload = {
      ...payload,
      get x() {
        reads += 1;
        return payload.x;
      },
      get sampleCount() {
        reads += 1;
        return payload.sampleCount;
      },
    };
    const generator = exportNpy(spy, "x", 0, 1);
    expect(reads).toBe(0);
    expect(generator.next()).not.toBeInstanceOf(Promise);
    expect(reads).toBeGreaterThan(0);
  });
});

describe("root entry", () => {
  it("exports the writer and its default chunk size", () => {
    expect(rootEntry.exportNpy).toBe(exportNpy);
    expect(rootEntry.NPY_DEFAULT_CHUNK_BYTES).toBe(NPY_DEFAULT_CHUNK_BYTES);
    expect(NPY_DEFAULT_CHUNK_BYTES).toBe(65536);
  });
});
