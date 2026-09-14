/**
 * `DecimationPort` — pull-based settlement, numeric handles, no `Promise` and no callback in
 * the hot path. The synchronous in-thread default and a future asynchronous worker
 * implementation (change 8) satisfy the same interface with identical caller control flow; no
 * `workerFactory` field or `Worker` type reference is declared anywhere in this module.
 */
import type { Lease, Saturated } from "./ownership.js";
import type { TransportStatsView } from "./backpressure.js";

export const enum DecimationKind {
  MinMaxEnvelope = 0,
  Lttb = 1,
}

export const enum PortMode {
  Synchronous = 0,
  Asynchronous = 1,
}

export const enum FailureReason {
  WorkerError = 0,
  MessageError = 1,
  Timeout = 2,
  Disposed = 3,
}

/** Per-lease request parameters, written in place into slot-resident storage. */
export interface DecimationRequestWriter {
  setKind(lease: Lease<"acquired">, kind: DecimationKind): void;
  setSampleCount(lease: Lease<"acquired">, count: number): void;
  setBucketCount(lease: Lease<"acquired">, buckets: number): void;
  setDomain(lease: Lease<"acquired">, min: number, max: number): void;
}

/** Implemented by the caller; instance is long-lived, so no per-settlement allocation. */
export interface SettlementSink {
  onSettled(lease: Lease<"settled">, outCount: number): void;
}

export interface DecimationPort extends DecimationRequestWriter {
  readonly mode: PortMode;
  readonly poolPairs: number;
  readonly transitCapacitySamples: number;

  /** Claims a free slot, or SATURATED. Runs the lazy deadline sweep. Never throws, never allocates. */
  acquire(): Lease<"acquired"> | Saturated;

  /**
   * Writable views onto the claimed slot. Reading through a lease in an illegal phase is a
   * caller contract violation: the accessor never throws on the hot path, it returns the
   * port's preallocated zero-length sentinel view and increments `OwnershipViolations`.
   */
  viewX(lease: Lease<"acquired"> | Lease<"settled">): Float32Array;
  viewY(lease: Lease<"acquired"> | Lease<"settled">): Float32Array;
  viewOut(lease: Lease<"acquired"> | Lease<"settled">): Float32Array;
  viewIndices(lease: Lease<"acquired"> | Lease<"settled">): Int32Array;

  /**
   * Hands ownership to the responder. Consumes the acquired-phase handle: the caller MUST NOT
   * read through it again. Reading a submitted lease is a contract violation reported via
   * `OwnershipViolations`, never a throw.
   */
  submit(lease: Lease<"acquired">): Lease<"inflight"> | Saturated;

  /** Drains settled leases into a caller-owned sink. Returns how many were drained. */
  poll(sink: SettlementSink): number;

  /** Returns the slot to the pool. Mandatory after reading a settled lease. */
  release(lease: Lease<"acquired"> | Lease<"settled">): void;

  reportResponderFailure(reason: FailureReason): void;
  /** Adds to `SamplesDropped` after `acquire()` returned `SATURATED`. Allocation-free. */
  noteDroppedSamples(count: number): void;
  readStats(out: TransportStatsView): void;
  /** Terminal. Idempotent: a second call changes no counter. */
  dispose(): void;
}
