/**
 * The frozen streaming-contract: types and invariants only. `RawSampleRing`, `BucketAccumulator`,
 * the tier-1/2/3 domain-change invalidation surface and `partialHistory` are declared here as
 * the incremental-decimation data contract; change 8 ships the incremental ingest and rebuild
 * bodies. Every entry point below that would need a working body instead throws a documented
 * deferred-to-change-8 error and mutates nothing.
 */
import type { Retained } from "../buffers/brand.js";

/**
 * Buckets per device pixel. Default 2 — the oversample tier 3's zoom-in reuse depends on.
 *
 * This boundary marks a continuous degradation in resolution, not a pass/fail gate: nothing
 * changes state at the boundary for an assertion to anchor on, and the literal `2` MUST appear
 * only as this default value or in documentation, never in a comparison that gates behavior.
 * What is guaranteed instead is bounding — a merged or re-indexed min/max bucket still bounds
 * every sample it contains (`min <= y <= max` for every sample in the bucket's span, at any
 * zoom factor including well beyond 2x); no value is interpolated, extrapolated, or fabricated;
 * and the gesture-end tier-2 rebuild is mandatory rather than best-effort. No tier-3 rebuild
 * body ships in this change, so this bounding property is documented normative text binding the
 * implementing change and is not claimed as a measured result here.
 */
export const BUCKET_OVERSAMPLE_DEFAULT = 2;
/** Hard cap on `bucketCount`. Bounds accumulator memory against a pathological viewport width. */
export const MAX_BUCKETS = 8192;

export function computeBucketCount(
  viewportWidthPx: number,
  bucketOversample: number = BUCKET_OVERSAMPLE_DEFAULT,
): number {
  return Math.max(
    1,
    Math.min(Math.floor(bucketOversample * Math.floor(viewportWidthPx)), MAX_BUCKETS),
  );
}

/**
 * Overwrite-oldest, masked indexing over a power-of-two capacity. `capacity` is an internal
 * sizing detail: it is how much history the ring holds, and nothing about a displayed result
 * changes if it is 65,536 rather than 60,000 — unlike `BucketAccumulator.bucketCount`, which is
 * observed output resolution and is deliberately NOT constrained to a power of two.
 */
export interface RawSampleRing {
  readonly capacity: number;
  readonly x: Retained<Float32Array>;
  readonly y: Retained<Float32Array>;
  /** Monotonic count of samples ever written. Never wraps in f64 at any realistic rate. */
  totalWritten: number;
  /** `totalWritten & (capacity - 1)`. */
  writeIndex: number;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function createRawSampleRing(capacity: number): RawSampleRing {
  if (!isPowerOfTwo(capacity)) {
    throw new RangeError(
      `RawSampleRing capacity must be a power of two; received ${capacity}.`,
    );
  }
  return {
    capacity,
    x: new Float32Array(capacity) as Retained<Float32Array>,
    y: new Float32Array(capacity) as Retained<Float32Array>,
    totalWritten: 0,
    writeIndex: 0,
  };
}

/**
 * `count[s] === 0` is the sole normative "no data" signal. An empty bucket renders as a gap and
 * is never interpolated; `min[s]`/`max[s]` carry no defined meaning while `count[s] === 0`.
 */
export interface BucketAccumulator {
  readonly bucketCount: number;
  readonly min: Retained<Float32Array>;
  readonly max: Retained<Float32Array>;
  /** `count[s] === 0` means no data: an empty bucket renders as a gap and is never
   *  interpolated. `min[s]`/`max[s]` carry no defined meaning while `count[s] === 0`. */
  readonly count: Retained<Int32Array>;
  /** Circular origin so an aligned pan is a rotation, not a rebuild. `0 <= bucketOrigin < bucketCount`. */
  bucketOrigin: number;
  domainMin: number;
  invBucketWidth: number;
  /** Oldest sample sequence represented; compared against `ring.totalWritten - capacity`. */
  coveredFromSeq: number;
  /** Bucket-layout generation. Bumped by exactly 1 on a completed tier-1 rotation or tier-2
   *  rebuild; never on ingest and never on tier 3, which reads the accumulator and mutates
   *  nothing. Monotonically non-decreasing, initialised to 0, never reset. */
  revision: number;
}

export function createBucketAccumulator(bucketCount: number): BucketAccumulator {
  if (
    !Number.isInteger(bucketCount) ||
    bucketCount < 1 ||
    bucketCount > MAX_BUCKETS
  ) {
    throw new RangeError(
      `bucketCount must be an integer in [1, ${MAX_BUCKETS}]; received ${bucketCount}.`,
    );
  }
  return {
    bucketCount,
    min: new Float32Array(bucketCount) as Retained<Float32Array>,
    max: new Float32Array(bucketCount) as Retained<Float32Array>,
    count: new Int32Array(bucketCount) as Retained<Int32Array>,
    bucketOrigin: 0,
    domainMin: 0,
    invBucketWidth: 0,
    coveredFromSeq: 0,
    revision: 0,
  };
}

function assertBucketOriginRange(bucketOrigin: number, bucketCount: number): void {
  if (
    !Number.isInteger(bucketOrigin) ||
    bucketOrigin < 0 ||
    bucketOrigin >= bucketCount
  ) {
    throw new RangeError(
      `bucketOrigin must satisfy 0 <= bucketOrigin < bucketCount (${bucketCount}); received ${bucketOrigin}.`,
    );
  }
}

/**
 * `partialHistory` lives on the tier result, never on `BucketAccumulator` (a tenth accumulator
 * member would duplicate `coveredFromSeq` and break the frozen nine-member shape).
 */
export interface Tier1Result {
  readonly tier: 1;
  /** Signed bucket shift. Never `0` — a zero shift selects no tier at all. */
  readonly k: number;
  /** True when the requested domain reaches earlier than `totalWritten - capacity`, so the
   *  ring no longer holds the samples for part of the requested span. Uncovered buckets are
   *  left at `count === 0` rather than filled with a substituted value. */
  readonly partialHistory: boolean;
}
export interface Tier2Result {
  readonly tier: 2;
  /** Same underrun signal as {@link Tier1Result.partialHistory}. */
  readonly partialHistory: boolean;
}
export interface Tier3Result {
  readonly tier: 3;
  /** Same underrun signal as {@link Tier1Result.partialHistory}. */
  readonly partialHistory: boolean;
}
export type TierResult = Tier1Result | Tier2Result | Tier3Result;

export interface TierSelectionRequest {
  readonly requestedDomainMin: number;
  readonly requestedInvBucketWidth: number;
  readonly inGesture: boolean;
}

/**
 * Tier **selection** only — no rebuild body. The alignment predicate is exact, with no epsilon
 * and no snapping: zoom identity is `Object.is` on the stored `invBucketWidth`; the shift must
 * be finite (`Number.isFinite(shift)`); integrality is exact equality against
 * `Math.round(shift)`; `k !== 0`; and `Math.abs(k) < bucketCount`.
 */
export function selectTier(
  accumulator: BucketAccumulator,
  request: TierSelectionRequest,
): 1 | 2 | 3 {
  if (request.inGesture) return 3;

  const zoomUnchanged = Object.is(
    request.requestedInvBucketWidth,
    accumulator.invBucketWidth,
  );
  const shift =
    (request.requestedDomainMin - accumulator.domainMin) *
    accumulator.invBucketWidth;
  const k = Math.round(shift);
  const aligned =
    zoomUnchanged &&
    Number.isFinite(shift) &&
    shift === k &&
    k !== 0 &&
    Math.abs(k) < accumulator.bucketCount;

  return aligned ? 1 : 2;
}

/**
 * Rotates `bucketOrigin` by `k` (may be negative). The invariant `0 <= bucketOrigin < bucketCount`
 * holds at every observable point, so the result is normalised into `[0, bucketCount)` in both
 * directions: a positive `k` that overshoots is normalised by subtraction, and a negative `k`
 * that undershoots is normalised by addition, via a bounded loop of conditional adds/subtractions
 * — executed once per settled pan, off the hot ingest path.
 */
export function rotateBucketOrigin(
  accumulator: BucketAccumulator,
  k: number,
): number {
  assertBucketOriginRange(accumulator.bucketOrigin, accumulator.bucketCount);
  let next = accumulator.bucketOrigin + k;
  while (next < 0) next += accumulator.bucketCount;
  while (next >= accumulator.bucketCount) next -= accumulator.bucketCount;
  return next;
}

const DEFERRED_MESSAGE =
  "Deferred to change 8 (worker-streaming-transport): this change freezes the " +
  "streaming-contract's types and invariants only and ships no working ingest or rebuild body.";

/**
 * Deferred to change 8. Throws loudly rather than silently no-opping; mutates nothing.
 *
 * The implementing change binds ingest to `O(new samples)` with no allocation — per new sample
 * two compares, one store-if, and one increment, with no object, closure, or array allocated.
 * That cost is not measured by this change, since no working body ships here to measure.
 */
export function ingestSample(ring: RawSampleRing, x: number, y: number): never {
  void ring;
  void x;
  void y;
  throw new Error(DEFERRED_MESSAGE);
}

/** Deferred to change 8. Throws loudly rather than silently no-opping; mutates nothing. */
export function rebuildDomain(
  accumulator: BucketAccumulator,
  ring: RawSampleRing,
  domainMin: number,
  invBucketWidth: number,
): never {
  void accumulator;
  void ring;
  void domainMin;
  void invBucketWidth;
  throw new Error(DEFERRED_MESSAGE);
}
