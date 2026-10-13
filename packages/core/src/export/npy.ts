/**
 * NumPy `.npy` format version 1.0 writer: one one-dimensional C-order array per export, streamed
 * through a single reused scratch buffer so memory stays bounded whatever the sample count.
 */
import type { SpectrumDataPayload } from "../payload/spectrum-data-payload.js";
import {
  createSampleSpan,
  resolveSampleWindow,
  type SampleWindowOptions,
} from "../viewport/window.js";
import type { BinaryArrayExport } from "./binary-export.js";

export type NpyArrayKind = "x" | "y";

export interface NpyExportOptions extends SampleWindowOptions {
  /** Scratch size in bytes. Multiple of 8, at least 128; default `NPY_DEFAULT_CHUNK_BYTES`. */
  readonly chunkBytes?: number;
}

/** 64 KiB: a few thousand elements per chunk amortises generator resumption at a small footprint. */
export const NPY_DEFAULT_CHUNK_BYTES = 65536;

/**
 * Smallest legal scratch. The v1.0 header is `10 + HEADER_LEN` bytes with HEADER_LEN a multiple
 * of 64 minus 10; for any element count up to 2^53 (16 digits) it is at most 128 bytes, so the
 * header always fits in a single chunk.
 */
const MIN_CHUNK_BYTES = 128;

/** NumPy's v1.0 alignment: the data section starts on a 64-byte boundary. */
const HEADER_ALIGNMENT = 64;

/**
 * Writes the v1.0 header for a one-dimensional array of `count` elements into `out` from byte 0
 * and returns its total length (`10 + HEADER_LEN`). Built byte by byte from `charCodeAt` because
 * the text is pure ASCII and a text encoder is not part of this module's runtime assumptions.
 */
export function buildNpyHeader(descr: "<f8" | "<f4", count: number, out: Uint8Array): number {
  const dict =
    "{'descr': '" + descr + "', 'fortran_order': False, 'shape': (" + String(count) + ",), }";
  // Magic (6) + version (2) + HEADER_LEN (2) precede the dict; the final byte is the newline.
  const unpadded = 10 + dict.length + 1;
  const padding = (HEADER_ALIGNMENT - (unpadded % HEADER_ALIGNMENT)) % HEADER_ALIGNMENT;
  const headerLen = dict.length + padding + 1;

  out[0] = 0x93;
  out[1] = 0x4e;
  out[2] = 0x55;
  out[3] = 0x4d;
  out[4] = 0x50;
  out[5] = 0x59;
  out[6] = 0x01;
  out[7] = 0x00;
  out[8] = headerLen & 0xff;
  out[9] = (headerLen >>> 8) & 0xff;
  for (let i = 0; i < dict.length; i += 1) out[10 + i] = dict.charCodeAt(i);
  for (let i = 0; i < padding; i += 1) out[10 + dict.length + i] = 0x20;
  out[10 + headerLen - 1] = 0x0a;
  return 10 + headerLen;
}

/**
 * Exports one array of `payload` over the window `[xMin, xMax]` as a `.npy` file, one chunk at a
 * time: the header first, then the data. X is dtype `<f8` holding the absolute `xOrigin + x[i]`
 * summed in f64; Y keeps its stored `<f4` bits (gaps and infinities included; a NaN is written as
 * a NaN pattern, its payload bits are not guaranteed). Every multi-byte write goes through
 * `DataView` with an explicit little-endian flag, so the bytes are identical on any host.
 *
 * Exporting X and Y with the same window and options resolves the same span, so the two files
 * are index-aligned. The span is resolved on the first `next()`; nothing is read before it.
 *
 * Yielded chunks are views of one scratch buffer and follow the `BinaryArrayExport` validity rule:
 * copy a chunk before advancing.
 *
 * @throws RangeError when `chunkBytes` is not a multiple of 8 of at least 128 (before any read).
 */
export function exportNpy(
  payload: SpectrumDataPayload,
  array: NpyArrayKind,
  xMin: number,
  xMax: number,
  options?: NpyExportOptions,
): BinaryArrayExport {
  const chunkBytes = options?.chunkBytes ?? NPY_DEFAULT_CHUNK_BYTES;
  if (!Number.isInteger(chunkBytes) || chunkBytes < MIN_CHUNK_BYTES || chunkBytes % 8 !== 0) {
    throw new RangeError(
      `chunkBytes must be a multiple of 8 and at least ${String(MIN_CHUNK_BYTES)}; received ${String(chunkBytes)}.`,
    );
  }
  if (array !== "x" && array !== "y") {
    throw new TypeError(`array must be "x" or "y"; received ${String(array)}.`);
  }
  // Calling a generator function runs none of its body, so validation above is the only eager step.
  return npyChunks(payload, array === "x", xMin, xMax, options, chunkBytes);
}

/**
 * One view of the scratch buffer per yielded chunk. Kept out of the fill loop's syntax on
 * purpose: this is the per-chunk allocation budget, whereas the loop-allocation rule exists to
 * stop per-element allocation.
 */
function chunkView(scratch: Uint8Array, length: number): Uint8Array {
  return scratch.subarray(0, length);
}

function* npyChunks(
  payload: SpectrumDataPayload,
  isX: boolean,
  xMin: number,
  xMax: number,
  options: SampleWindowOptions | undefined,
  chunkBytes: number,
): BinaryArrayExport {
  const span = createSampleSpan();
  resolveSampleWindow(payload, xMin, xMax, span, options);
  const start = span.start;
  const end = span.end;

  // Allocated per export, never at module level, so concurrent exports cannot share state.
  const scratch = new Uint8Array(chunkBytes);
  const view = new DataView(scratch.buffer);

  yield chunkView(scratch, buildNpyHeader(isX ? "<f8" : "<f4", end - start, scratch));

  const elementSize = isX ? 8 : 4;
  const elementsPerChunk = chunkBytes / elementSize;
  const origin = payload.xOrigin;
  const source = isX ? payload.x : payload.y;

  let index = start;
  while (index < end) {
    const batchEnd = Math.min(end, index + elementsPerChunk);
    let offset = 0;
    if (isX) {
      for (let i = index; i < batchEnd; i += 1) {
        view.setFloat64(offset, origin + (source[i] as number), true);
        offset += 8;
      }
    } else {
      for (let i = index; i < batchEnd; i += 1) {
        view.setFloat32(offset, source[i] as number, true);
        offset += 4;
      }
    }
    yield chunkView(scratch, offset);
    index = batchEnd;
  }
}
