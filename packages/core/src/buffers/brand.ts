/**
 * Branded typed-buffer vocabulary.
 *
 * Two orthogonal `unique symbol` brand axes — data axis (`x` / `y` / `index`) and ownership
 * class (`retained` / `transit`) — implemented as intersection types over the underlying
 * `Float32Array` / `Int32Array`. `declare const … : unique symbol` is type-only: `tsc` emits
 * nothing for it, so a branded value is runtime-identical to a plain typed array (same
 * prototype, same own properties, same V8 hidden class). No `any` in any form.
 */

declare const AxisTag: unique symbol;
declare const OwnershipTag: unique symbol;

export type BufferAxis = "x" | "y" | "index";
export type OwnershipClass = "retained" | "transit";

export type Branded<
  TView extends ArrayBufferView,
  TAxis extends BufferAxis,
  TOwnership extends OwnershipClass,
> = TView & {
  readonly [AxisTag]: TAxis;
  readonly [OwnershipTag]: TOwnership;
};

export type Retained<TView extends ArrayBufferView> = TView & {
  readonly [OwnershipTag]: "retained";
};
export type Transit<TView extends ArrayBufferView> = TView & {
  readonly [OwnershipTag]: "transit";
};

export type XBuffer = Branded<Float32Array, "x", "retained">;
export type YBuffer = Branded<Float32Array, "y", "retained">;
export type IndexBuffer = Branded<Int32Array, "index", "retained">;

export type TransitXBuffer = Branded<Float32Array, "x", "transit">;
export type TransitYBuffer = Branded<Float32Array, "y", "transit">;
export type TransitIndexBuffer = Branded<Int32Array, "index", "transit">;

/** The only type change 3's transfer-list builder accepts. Declared here, used there. */
export type TransferableBacking =
  | TransitXBuffer
  | TransitYBuffer
  | TransitIndexBuffer;

/**
 * Rejects a detached source (`byteLength === 0` while `length > 0`). Internal — not exported
 * from the package (branded-buffers spec's "Public Export Surface" requirement).
 */
function assertUsableBuffer(source: Float32Array | Int32Array): void {
  if (source.byteLength === 0 && source.length > 0) {
    throw new RangeError(
      "Cannot brand a detached buffer (byteLength === 0 while length > 0).",
    );
  }
}

/**
 * Rejects a negative or non-integer capacity. Internal — not exported from the package.
 */
function assertCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError(
      `capacity must be a non-negative integer; received ${capacity}.`,
    );
  }
}

export function asXBuffer(source: Float32Array): XBuffer {
  assertUsableBuffer(source);
  return source as XBuffer;
}

export function asYBuffer(source: Float32Array): YBuffer {
  assertUsableBuffer(source);
  return source as YBuffer;
}

export function asIndexBuffer(source: Int32Array): IndexBuffer {
  assertUsableBuffer(source);
  return source as IndexBuffer;
}

export function allocateXBuffer(capacity: number): XBuffer {
  assertCapacity(capacity);
  return new Float32Array(capacity) as XBuffer;
}

export function allocateYBuffer(capacity: number): YBuffer {
  assertCapacity(capacity);
  return new Float32Array(capacity) as YBuffer;
}

export function allocateIndexBuffer(capacity: number): IndexBuffer {
  assertCapacity(capacity);
  return new Int32Array(capacity) as IndexBuffer;
}
