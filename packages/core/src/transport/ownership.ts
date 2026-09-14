/**
 * Lease handles and slot state for the pooled buffer-ownership protocol.
 *
 * Ownership is never expressed as "here is your `ArrayBuffer`". The public currency is an
 * opaque lease: a branded `number` packing a slot index and a generation counter. Phantom
 * typing catches the authoring-time mistake (reading a buffer after handing it to the port) as
 * a compile error; the packed generation catches everything the type system cannot see (a
 * plain-JS consumer, a handle smuggled through a `number[]`, a zombie responder's late reply)
 * as a counted runtime event. Neither check allocates: a lease is a small integer, comparisons
 * are integer compares, and packing/unpacking are bitwise operations.
 */
import type { TransferableBacking } from "../buffers/brand.js";

declare const LeaseBrand: unique symbol;
declare const LeaseState: unique symbol;

export type LeasePhase = "acquired" | "inflight" | "settled";

/** Opaque lease. Phantom-typed by ownership phase; a plain non-negative int32 at runtime. */
export type Lease<S extends LeasePhase> = number & {
  readonly [LeaseBrand]: "trace-kit.transit-lease";
  readonly [LeaseState]: S;
};

/** Returned by `acquire()` at saturation. No throw, no allocation. */
export const SATURATED = -1 as const;
export type Saturated = typeof SATURATED;

export const enum SlotState {
  Free = 0,
  Acquired = 1,
  InFlight = 2,
  Settled = 3,
  Lost = 4,
}

/** `poolPairs` is clamped to `[1, 8]`, so three bits index every slot. */
export const LEASE_SLOT_BITS = 3;
export const LEASE_SLOT_MASK = 0b111;
export const LEASE_GENERATION_SHIFT = 3;
export const LEASE_GENERATION_MASK = 0x0fff_ffff;

/** Packs a slot index and a generation counter into a single non-negative int32 lease. */
export function packLease<S extends LeasePhase>(
  slot: number,
  generation: number,
): Lease<S> {
  return (((generation & LEASE_GENERATION_MASK) << LEASE_GENERATION_SHIFT) |
    (slot & LEASE_SLOT_MASK)) as Lease<S>;
}

export function unpackSlot(lease: number): number {
  return lease & LEASE_SLOT_MASK;
}

export function unpackGeneration(lease: number): number {
  return (lease >>> LEASE_GENERATION_SHIFT) & LEASE_GENERATION_MASK;
}

/**
 * Writes the backing stores of `sources` into the caller-owned `out` array and returns how many
 * entries were written. Allocates nothing: both arrays are long-lived, and this function neither
 * constructs a new array nor copies element data — it only reads `.buffer` references.
 */
export function collectTransferList(
  sources: readonly TransferableBacking[],
  out: ArrayBufferLike[],
): number {
  let count = 0;
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (source === undefined) continue;
    out[count] = source.buffer;
    count += 1;
  }
  return count;
}
