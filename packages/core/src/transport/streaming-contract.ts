/**
 * Streaming data contract and incremental `O(new samples)` decimation engine: `RawSampleRing`,
 * `BucketAccumulator`, Tier-1/2/3 domain-change invalidation (`applyDomainChange`, `rebuildDomain`,
 * `projectTier3`), and allocation-free incremental ingest (`ingestSample`, `ingestBatch`).
 */
import type { Retained } from "../buffers/brand.js";
import { StatCounter, type TransportStatsView } from "./backpressure.js";

/**
 * Buckets per device pixel. Default 2 — the oversample tier 3's zoom-in reuse depends on.
 *
 * This boundary marks a continuous degradation in resolution, not a pass/fail gate: nothing
 * changes state at the boundary for an assertion to anchor on, and the literal `2` MUST appear
 * only as this default value or in documentation, never in a comparison that gates behavior.
 * What is guaranteed instead is bounding — a merged or re-indexed min/max bucket still bounds
 * every sample it contains (`min <= y <= max` for every sample in the bucket's span, at any
 * zoom factor including well beyond 2x); no value is interpolated, extrapolated, or fabricated;
 * and the gesture-end tier-2 rebuild is mandatory rather than best-effort.
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
 *
 * Coordinate space (`xOrigin` convention): `x` stores `Float32` offsets relative to a caller-owned
 * `Float64` `xOrigin` (matching `SpectrumDataPayload.x`, equal to absolute physical X when
 * `xOrigin === 0`), preserving sub-picometer resolution on high-offset physical axes such as
 * optical wavelengths near `1550.xxx nm`. `y` stores every ingested `NaN` faithfully so a Tier-2
 * zoom-in rebuild isolates sub-bucket gaps at full sample resolution.
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
 * Circular per-bucket min/max accumulator operating in the same `xOrigin`-relative offset X space
 * as `RawSampleRing.x` (`domainMin = absDomainMin - xOrigin`, equal to absolute space when
 * `xOrigin === 0`).
 *
 * `count[s] === 0` is the sole normative "no data" signal: an empty bucket renders as a gap and
 * is never interpolated. `count[s] < 0` (`-1`, sticky until bucket reset or rebuild) marks a
 * gap-poisoned bucket touched by at least one `NaN` sample so no rendered segment ever bridges a
 * source `NaN`. `min[s]`/`max[s]` carry no defined meaning whenever `count[s] <= 0`.
 */
export interface BucketAccumulator {
  readonly bucketCount: number;
  readonly min: Retained<Float32Array>;
  readonly max: Retained<Float32Array>;
  /** `count[s] === 0` means no data: an empty bucket renders as a gap and is never
   *  interpolated. `count[s] < 0` (`-1`) means gap-poisoned (at least one `NaN` sample landed in
   *  slot `s`). `min[s]`/`max[s]` carry no defined meaning while `count[s] <= 0`. */
  readonly count: Retained<Int32Array>;
  /** Circular origin so an aligned pan is a rotation, not a rebuild. `0 <= bucketOrigin < bucketCount`. */
  bucketOrigin: number;
  /** Lower bound of logical bucket `0` in `RawSampleRing.x` (`xOrigin`-relative) space. */
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

/** Caller-owned preallocated output buffers for non-mutating Tier-3 bounding projection. */
export interface Tier3ProjectionTarget {
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly count: Int32Array;
}

// Preallocated immutable result singletons eliminate heap allocations on `rebuildDomain`,
// `projectTier3`, and +/-1-bucket Tier-1 strip-chart scrolling while keeping the exact
// `TierResult` discriminated union contract.
const TIER1_PLUS1_COMPLETE: Tier1Result = { tier: 1, k: 1, partialHistory: false };
const TIER1_PLUS1_PARTIAL: Tier1Result = { tier: 1, k: 1, partialHistory: true };
const TIER1_MINUS1_COMPLETE: Tier1Result = { tier: 1, k: -1, partialHistory: false };
const TIER1_MINUS1_PARTIAL: Tier1Result = { tier: 1, k: -1, partialHistory: true };
const TIER2_COMPLETE: Tier2Result = { tier: 2, partialHistory: false };
const TIER2_PARTIAL: Tier2Result = { tier: 2, partialHistory: true };
const TIER3_COMPLETE: Tier3Result = { tier: 3, partialHistory: false };
const TIER3_PARTIAL: Tier3Result = { tier: 3, partialHistory: true };

function makeTier1Result(k: number, partialHistory: boolean): Tier1Result {
  if (k === 1) return partialHistory ? TIER1_PLUS1_PARTIAL : TIER1_PLUS1_COMPLETE;
  if (k === -1) return partialHistory ? TIER1_MINUS1_PARTIAL : TIER1_MINUS1_COMPLETE;
  return { tier: 1, k, partialHistory };
}

function oldestResidentSeq(ring: RawSampleRing): number {
  return ring.totalWritten > ring.capacity ? ring.totalWritten - ring.capacity : 0;
}

function computePartialHistory(ring: RawSampleRing, requestedDomainMin: number): boolean {
  const oldestSeq = oldestResidentSeq(ring);
  if (oldestSeq <= 0) return false;
  const mask = ring.capacity - 1;
  return requestedDomainMin < ring.x[oldestSeq & mask]!;
}

/**
 * Selects the invalidation tier for a domain change. The alignment predicate is exact, with no
 * epsilon and no snapping: zoom identity is `Object.is` on the stored `invBucketWidth`; the
 * shift must be finite (`Number.isFinite(shift)`); integrality is exact equality against
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

function foldSampleIntoSlot(
  mins: Float32Array,
  maxs: Float32Array,
  counts: Int32Array,
  slot: number,
  y: number,
): void {
  const currentCount = counts[slot]!;
  if (currentCount < 0) return;
  if (y !== y) {
    counts[slot] = -1;
    return;
  }
  if (currentCount === 0) {
    mins[slot] = y;
    maxs[slot] = y;
    counts[slot] = 1;
  } else {
    if (y < mins[slot]!) mins[slot] = y;
    if (y > maxs[slot]!) maxs[slot] = y;
    counts[slot] = currentCount + 1;
  }
}

/**
 * Allocation-free `O(new samples)` single-sample ingest into `ring`, optionally folding into
 * `accumulator` when `accumulator.invBucketWidth > 0`. Writes `(x, y)` into `ring` using masked
 * power-of-two indexing (`totalWritten & (capacity - 1)`). Samples outside `[0, bucketCount)`
 * remain stored in `ring` without mutating any accumulator bucket.
 */
export function ingestSample(
  ring: RawSampleRing,
  x: number,
  y: number,
  accumulator?: BucketAccumulator,
): void {
  const mask = ring.capacity - 1;
  const writeIndex = ring.totalWritten & mask;
  ring.x[writeIndex] = x;
  ring.y[writeIndex] = y;
  const storedX = ring.x[writeIndex];
  const storedY = ring.y[writeIndex];
  const nextTotal = ring.totalWritten + 1;
  ring.totalWritten = nextTotal;
  ring.writeIndex = nextTotal & mask;

  if (accumulator !== undefined && accumulator.invBucketWidth > 0) {
    const b = Math.floor((storedX - accumulator.domainMin) * accumulator.invBucketWidth);
    const bucketCount = accumulator.bucketCount;
    if (b >= 0 && b < bucketCount) {
      let s = b + accumulator.bucketOrigin;
      if (s >= bucketCount) s -= bucketCount;
      foldSampleIntoSlot(accumulator.min, accumulator.max, accumulator.count, s, storedY);
    }
  }
}

/**
 * Allocation-free `O(new samples)` batch ingest of `count` samples starting at `offset` from
 * `xs`/`ys` into `ring`, optionally folding in-domain samples into `accumulator`.
 */
export function ingestBatch(
  ring: RawSampleRing,
  xs: Float32Array,
  ys: Float32Array,
  offset: number,
  count: number,
  accumulator?: BucketAccumulator,
): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`offset must be a non-negative integer; received ${offset}.`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer; received ${count}.`);
  }
  if (offset + count > xs.length || offset + count > ys.length) {
    throw new RangeError(
      `batch range offset=${offset} count=${count} exceeds input lengths (xs=${xs.length}, ys=${ys.length}).`,
    );
  }
  if (count === 0) return;

  const mask = ring.capacity - 1;
  const ringX = ring.x;
  const ringY = ring.y;
  let totalWritten = ring.totalWritten;
  let writeIndex = totalWritten & mask;

  const hasAccumulator =
    accumulator !== undefined && accumulator.invBucketWidth > 0;
  const domainMin = hasAccumulator ? accumulator.domainMin : 0;
  const invBucketWidth = hasAccumulator ? accumulator.invBucketWidth : 0;
  const bucketCount = hasAccumulator ? accumulator.bucketCount : 0;
  const bucketOrigin = hasAccumulator ? accumulator.bucketOrigin : 0;
  const mins = hasAccumulator ? accumulator.min : null;
  const maxs = hasAccumulator ? accumulator.max : null;
  const counts = hasAccumulator ? accumulator.count : null;

  const end = offset + count;
  for (let i = offset; i < end; i += 1) {
    const x = xs[i]!;
    const y = ys[i]!;
    ringX[writeIndex] = x;
    ringY[writeIndex] = y;
    const storedX = ringX[writeIndex]!;
    const storedY = ringY[writeIndex]!;
    totalWritten += 1;
    writeIndex = totalWritten & mask;

    if (mins !== null && maxs !== null && counts !== null) {
      const b = Math.floor((storedX - domainMin) * invBucketWidth);
      if (b >= 0 && b < bucketCount) {
        let s = b + bucketOrigin;
        if (s >= bucketCount) s -= bucketCount;
        foldSampleIntoSlot(mins, maxs, counts, s, storedY);
      }
    }
  }

  ring.totalWritten = totalWritten;
  ring.writeIndex = writeIndex;
}

/**
 * Tier-2 full domain rebuild into `accumulator`'s preallocated arrays. Resets `bucketOrigin = 0`,
 * folds all resident ring samples in `[domainMin, domainMin + bucketCount / invBucketWidth)`,
 * bumps `accumulator.revision` by `1`, increments `StatCounter.DomainRebuilds` when `stats` is
 * provided, and returns a preallocated `Tier2Result` singleton.
 */
export function rebuildDomain(
  accumulator: BucketAccumulator,
  ring: RawSampleRing,
  domainMin: number,
  invBucketWidth: number,
  stats?: TransportStatsView,
): Tier2Result {
  if (!Number.isFinite(domainMin)) {
    throw new RangeError(`domainMin must be finite; received ${domainMin}.`);
  }
  if (!Number.isFinite(invBucketWidth) || invBucketWidth <= 0) {
    throw new RangeError(
      `invBucketWidth must be finite and > 0; received ${invBucketWidth}.`,
    );
  }

  const bucketCount = accumulator.bucketCount;
  const mins = accumulator.min;
  const maxs = accumulator.max;
  const counts = accumulator.count;
  counts.fill(0);

  accumulator.bucketOrigin = 0;
  accumulator.domainMin = domainMin;
  accumulator.invBucketWidth = invBucketWidth;

  const mask = ring.capacity - 1;
  const ringX = ring.x;
  const ringY = ring.y;
  const totalWritten = ring.totalWritten;
  const oldestSeq = oldestResidentSeq(ring);

  for (let seq = oldestSeq; seq < totalWritten; seq += 1) {
    const idx = seq & mask;
    const x = ringX[idx]!;
    const b = Math.floor((x - domainMin) * invBucketWidth);
    if (!(b >= 0 && b < bucketCount)) continue;
    foldSampleIntoSlot(mins, maxs, counts, b, ringY[idx]!);
  }

  accumulator.coveredFromSeq = oldestSeq;
  accumulator.revision += 1;
  if (stats !== undefined) {
    stats.counters[StatCounter.DomainRebuilds] =
      (stats.counters[StatCounter.DomainRebuilds] ?? 0) + 1;
  }

  const partialHistory = oldestSeq > 0 && domainMin < ringX[oldestSeq & mask]!;
  return partialHistory ? TIER2_PARTIAL : TIER2_COMPLETE;
}

/**
 * Executes a domain-change request across Tiers 1, 2, and 3:
 * - Tier 1 (aligned pan): rotates `bucketOrigin`, clears only the `|k|` newly exposed logical
 *   buckets, backfills those buckets from `ring` via binary search + exposed-span scan, bumps
 *   `revision` by `1`, and increments `StatCounter.DomainShifts` when `stats` is provided.
 * - Tier 2 (settled zoom or non-aligned pan): delegates to `rebuildDomain`.
 * - Tier 3 (in-gesture): mutates nothing on `accumulator` and returns `Tier3Result`.
 */
export function applyDomainChange(
  accumulator: BucketAccumulator,
  ring: RawSampleRing,
  request: TierSelectionRequest,
  stats?: TransportStatsView,
): TierResult {
  const tier = selectTier(accumulator, request);

  if (tier === 3) {
    const partialHistory = computePartialHistory(ring, request.requestedDomainMin);
    return partialHistory ? TIER3_PARTIAL : TIER3_COMPLETE;
  }

  if (tier === 2) {
    return rebuildDomain(
      accumulator,
      ring,
      request.requestedDomainMin,
      request.requestedInvBucketWidth,
      stats,
    );
  }

  // Tier 1: exact aligned pan
  const invBucketWidth = accumulator.invBucketWidth;
  const bucketCount = accumulator.bucketCount;
  const k = Math.round(
    (request.requestedDomainMin - accumulator.domainMin) * invBucketWidth,
  );
  const newOrigin = rotateBucketOrigin(accumulator, k);
  const newDomainMin = request.requestedDomainMin;

  accumulator.bucketOrigin = newOrigin;
  accumulator.domainMin = newDomainMin;

  const exposedStart = k > 0 ? bucketCount - k : 0;
  const exposedEnd = k > 0 ? bucketCount : -k;

  const mins = accumulator.min;
  const maxs = accumulator.max;
  const counts = accumulator.count;

  for (let b = exposedStart; b < exposedEnd; b += 1) {
    let s = b + newOrigin;
    if (s >= bucketCount) s -= bucketCount;
    counts[s] = 0;
  }

  const mask = ring.capacity - 1;
  const ringX = ring.x;
  const ringY = ring.y;
  const totalWritten = ring.totalWritten;
  const oldestSeq = oldestResidentSeq(ring);

  if (totalWritten > oldestSeq) {
    const exposedMinX = newDomainMin + exposedStart / invBucketWidth;
    let lo = oldestSeq;
    let hi = totalWritten;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) * 0.5);
      if (ringX[mid & mask]! < exposedMinX) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // Step backward across any floating-point boundary edge where `x < exposedMinX` still floors
    // into `exposedStart`.
    while (
      lo > oldestSeq &&
      Math.floor((ringX[(lo - 1) & mask]! - newDomainMin) * invBucketWidth) >= exposedStart
    ) {
      lo -= 1;
    }

    for (let seq = lo; seq < totalWritten; seq += 1) {
      const idx = seq & mask;
      const b = Math.floor((ringX[idx]! - newDomainMin) * invBucketWidth);
      if (b >= exposedEnd) break;
      if (!(b >= exposedStart)) continue;
      let s = b + newOrigin;
      if (s >= bucketCount) s -= bucketCount;
      foldSampleIntoSlot(mins, maxs, counts, s, ringY[idx]!);
    }
  }

  accumulator.coveredFromSeq = oldestSeq;
  accumulator.revision += 1;
  if (stats !== undefined) {
    stats.counters[StatCounter.DomainShifts] =
      (stats.counters[StatCounter.DomainShifts] ?? 0) + 1;
  }

  const partialHistory = oldestSeq > 0 && newDomainMin < ringX[oldestSeq & mask]!;
  return makeTier1Result(k, partialHistory);
}

/**
 * Non-mutating Tier-3 bounding projection from `accumulator` into caller-preallocated `out`.
 * Never mutates `accumulator` (`revision` and buffers remain untouched). Guarantees the bounding
 * invariant `out.min[t] <= y <= out.max[t]` across every covered finite sample at every zoom
 * factor without interpolating or fabricating values for empty or gap-poisoned buckets.
 */
export function projectTier3(
  accumulator: BucketAccumulator,
  requestedDomainMin: number,
  requestedInvBucketWidth: number,
  targetBucketCount: number,
  out: Tier3ProjectionTarget,
  ring?: RawSampleRing,
): Tier3Result {
  if (!Number.isFinite(requestedDomainMin)) {
    throw new RangeError(
      `requestedDomainMin must be finite; received ${requestedDomainMin}.`,
    );
  }
  if (!Number.isFinite(requestedInvBucketWidth) || requestedInvBucketWidth <= 0) {
    throw new RangeError(
      `requestedInvBucketWidth must be finite and > 0; received ${requestedInvBucketWidth}.`,
    );
  }
  if (
    !Number.isInteger(targetBucketCount) ||
    targetBucketCount < 1 ||
    targetBucketCount > MAX_BUCKETS
  ) {
    throw new RangeError(
      `targetBucketCount must be an integer between 1 and ${MAX_BUCKETS}; received ${targetBucketCount}.`,
    );
  }
  if (
    out.min.length < targetBucketCount ||
    out.max.length < targetBucketCount ||
    out.count.length < targetBucketCount
  ) {
    throw new RangeError(
      `Tier3ProjectionTarget buffers must have length >= ${targetBucketCount}.`,
    );
  }

  const outMin = out.min;
  const outMax = out.max;
  const outCount = out.count;
  for (let t = 0; t < targetBucketCount; t += 1) {
    outCount[t] = 0;
  }

  const srcInvBucketWidth = accumulator.invBucketWidth;
  if (srcInvBucketWidth > 0) {
    const srcBucketCount = accumulator.bucketCount;
    const srcOrigin = accumulator.bucketOrigin;
    const srcMin = accumulator.min;
    const srcMax = accumulator.max;
    const srcCount = accumulator.count;
    const ratio = requestedInvBucketWidth / srcInvBucketWidth;
    const offset = (accumulator.domainMin - requestedDomainMin) * requestedInvBucketWidth;

    for (let b = 0; b < srcBucketCount; b += 1) {
      let s = b + srcOrigin;
      if (s >= srcBucketCount) s -= srcBucketCount;
      const c = srcCount[s]!;
      if (c === 0) continue;

      const uLo = offset + b * ratio;
      const uHi = offset + (b + 1) * ratio;
      let tStart = Math.floor(uLo);
      let tEnd = Math.ceil(uHi) - 1;
      if (tEnd < tStart) tEnd = tStart;
      if (tEnd < 0 || tStart >= targetBucketCount) continue;
      if (tStart < 0) tStart = 0;
      if (tEnd >= targetBucketCount) tEnd = targetBucketCount - 1;

      if (c < 0) {
        for (let t = tStart; t <= tEnd; t += 1) {
          outCount[t] = -1;
        }
      } else {
        const sMin = srcMin[s]!;
        const sMax = srcMax[s]!;
        for (let t = tStart; t <= tEnd; t += 1) {
          const tc = outCount[t]!;
          if (tc < 0) continue;
          if (tc === 0) {
            outMin[t] = sMin;
            outMax[t] = sMax;
            outCount[t] = c;
          } else {
            if (sMin < outMin[t]!) outMin[t] = sMin;
            if (sMax > outMax[t]!) outMax[t] = sMax;
            outCount[t] = tc + c;
          }
        }
      }
    }
  }

  const partialHistory =
    ring !== undefined ? computePartialHistory(ring, requestedDomainMin) : false;
  return partialHistory ? TIER3_PARTIAL : TIER3_COMPLETE;
}
