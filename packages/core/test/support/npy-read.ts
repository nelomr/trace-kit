export interface NpyHeader {
  readonly major: number;
  readonly minor: number;
  readonly headerLen: number;
  readonly dict: string;
  readonly descr: string;
  readonly shape: readonly number[];
  readonly fortranOrder: boolean;
  /** Offset of the first data byte. */
  readonly dataOffset: number;
}

/** Concatenates chunks after copying each one, the way a conforming consumer must. */
export function concatCopies(chunks: Iterable<Uint8Array>): Uint8Array {
  const copies: Uint8Array[] = [];
  let total = 0;
  for (const chunk of chunks) {
    const copy = chunk.slice();
    copies.push(copy);
    total += copy.length;
  }
  return concat(copies, total);
}

export function concat(parts: readonly Uint8Array[], total?: number): Uint8Array {
  const length = total ?? parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function parseNpyHeader(bytes: Uint8Array): NpyHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = Array.from(bytes.subarray(0, 6));
  if (magic.join(",") !== "147,78,85,77,80,89") throw new Error("bad magic");
  const headerLen = view.getUint16(8, true);
  let dict = "";
  for (let i = 0; i < headerLen; i += 1) dict += String.fromCharCode(bytes[10 + i] ?? 0);
  const descr = /'descr': '([^']+)'/.exec(dict)?.[1] ?? "";
  const shapeText = /'shape': \(([^)]*)\)/.exec(dict)?.[1] ?? "";
  const shape = shapeText
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);
  return {
    major: bytes[6] ?? -1,
    minor: bytes[7] ?? -1,
    headerLen,
    dict,
    descr,
    shape,
    fortranOrder: /'fortran_order': True/.test(dict),
    dataOffset: 10 + headerLen,
  };
}

/** Decodes the data section little-endian, independent of the host byte order. */
export function decodeNpyData(bytes: Uint8Array): number[] {
  const header = parseNpyHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = header.descr === "<f8" ? 8 : 4;
  const out: number[] = [];
  for (let offset = header.dataOffset; offset + size <= bytes.length; offset += size) {
    out.push(size === 8 ? view.getFloat64(offset, true) : view.getFloat32(offset, true));
  }
  return out;
}
