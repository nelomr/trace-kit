/**
 * Allocation-free materialization from incremental streaming accumulators (`BucketAccumulator`
 * and `Tier3ProjectionTarget`) into caller-owned `Retained` `SpectrumDataPayload` buffers.
 *
 * Bridges Change 8's incremental streaming pipeline directly to `Canvas2DRenderer` and
 * `WebGL2FigureRenderer` with zero renderer modifications: populated buckets emit `(xCenter, min)`
 * and `(xCenter, max)`, while empty (`count === 0`) and gap-poisoned (`count < 0`) buckets emit a
 * single `(xCenter, NaN)` gap-break vertex so no drawn segment ever bridges a gap.
 */
import {
  commitPayloadRevision,
  type SpectrumDataPayload,
} from "../payload/spectrum-data-payload.js";
import {
  MAX_BUCKETS,
  type BucketAccumulator,
  type Tier3ProjectionTarget,
} from "./streaming-contract.js";

/**
 * Materializes a `BucketAccumulator` into a preallocated `Retained` `SpectrumDataPayload` with
 * zero heap allocations, commits the emitted vertex count via `commitPayloadRevision`, and returns
 * the emitted vertex count.
 *
 * @param accumulator Source circular bucket accumulator.
 * @param payload Caller-owned `Retained` payload with `capacity >= accumulator.bucketCount * 2`.
 * @param ringXOrigin Optional f64 origin of the accumulator's X space; defaults to `payload.xOrigin`.
 */
export function materializeBucketsToPayload(
  accumulator: BucketAccumulator,
  payload: SpectrumDataPayload,
  ringXOrigin?: number,
): number {
  const bucketCount = accumulator.bucketCount;
  const requiredCapacity = bucketCount * 2;
  if (payload.capacity < requiredCapacity) {
    throw new RangeError(
      `payload.capacity (${payload.capacity}) must be >= bucketCount * 2 (${requiredCapacity}).`,
    );
  }
  const effectiveOrigin = ringXOrigin ?? payload.xOrigin;
  if (!Number.isFinite(effectiveOrigin)) {
    throw new RangeError(`ringXOrigin must be finite; received ${effectiveOrigin}.`);
  }

  const invBucketWidth = accumulator.invBucketWidth;
  if (invBucketWidth === 0) {
    commitPayloadRevision(payload, 0);
    return 0;
  }
  if (!Number.isFinite(invBucketWidth) || invBucketWidth < 0) {
    throw new RangeError(
      `accumulator.invBucketWidth must be finite and >= 0; received ${invBucketWidth}.`,
    );
  }

  const originDelta = effectiveOrigin - payload.xOrigin;
  const domainMin = accumulator.domainMin;
  const bucketOrigin = accumulator.bucketOrigin;
  const mins = accumulator.min;
  const maxs = accumulator.max;
  const counts = accumulator.count;
  const px = payload.x;
  const py = payload.y;

  let writeCursor = 0;
  for (let b = 0; b < bucketCount; b += 1) {
    let s = b + bucketOrigin;
    if (s >= bucketCount) s -= bucketCount;
    const xCenter = domainMin + (b + 0.5) / invBucketWidth + originDelta;
    if (counts[s]! > 0) {
      px[writeCursor] = xCenter;
      py[writeCursor] = mins[s]!;
      writeCursor += 1;
      px[writeCursor] = xCenter;
      py[writeCursor] = maxs[s]!;
      writeCursor += 1;
    } else {
      px[writeCursor] = xCenter;
      py[writeCursor] = NaN;
      writeCursor += 1;
    }
  }

  commitPayloadRevision(payload, writeCursor);
  return writeCursor;
}

/**
 * Materializes a Tier-3 projection target into a preallocated `Retained` `SpectrumDataPayload`
 * with zero heap allocations, commits the emitted vertex count via `commitPayloadRevision`, and
 * returns the emitted vertex count.
 */
export function materializeTier3ToPayload(
  target: Tier3ProjectionTarget,
  targetBucketCount: number,
  domainMin: number,
  invBucketWidth: number,
  payload: SpectrumDataPayload,
  ringXOrigin?: number,
): number {
  if (
    !Number.isInteger(targetBucketCount) ||
    targetBucketCount < 1 ||
    targetBucketCount > MAX_BUCKETS
  ) {
    throw new RangeError(
      `targetBucketCount must be an integer between 1 and ${MAX_BUCKETS}; received ${targetBucketCount}.`,
    );
  }
  if (!Number.isFinite(domainMin)) {
    throw new RangeError(`domainMin must be finite; received ${domainMin}.`);
  }
  if (!Number.isFinite(invBucketWidth) || invBucketWidth <= 0) {
    throw new RangeError(
      `invBucketWidth must be finite and > 0; received ${invBucketWidth}.`,
    );
  }
  if (
    target.min.length < targetBucketCount ||
    target.max.length < targetBucketCount ||
    target.count.length < targetBucketCount
  ) {
    throw new RangeError(
      `Tier3ProjectionTarget buffers must have length >= ${targetBucketCount}.`,
    );
  }
  const requiredCapacity = targetBucketCount * 2;
  if (payload.capacity < requiredCapacity) {
    throw new RangeError(
      `payload.capacity (${payload.capacity}) must be >= targetBucketCount * 2 (${requiredCapacity}).`,
    );
  }
  const effectiveOrigin = ringXOrigin ?? payload.xOrigin;
  if (!Number.isFinite(effectiveOrigin)) {
    throw new RangeError(`ringXOrigin must be finite; received ${effectiveOrigin}.`);
  }

  const originDelta = effectiveOrigin - payload.xOrigin;
  const mins = target.min;
  const maxs = target.max;
  const counts = target.count;
  const px = payload.x;
  const py = payload.y;

  let writeCursor = 0;
  for (let b = 0; b < targetBucketCount; b += 1) {
    const xCenter = domainMin + (b + 0.5) / invBucketWidth + originDelta;
    if (counts[b]! > 0) {
      px[writeCursor] = xCenter;
      py[writeCursor] = mins[b]!;
      writeCursor += 1;
      px[writeCursor] = xCenter;
      py[writeCursor] = maxs[b]!;
      writeCursor += 1;
    } else {
      px[writeCursor] = xCenter;
      py[writeCursor] = NaN;
      writeCursor += 1;
    }
  }

  commitPayloadRevision(payload, writeCursor);
  return writeCursor;
}
