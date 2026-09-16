/**
 * Bucketed min/max envelope over `y[sourceOffset … sourceOffset + sampleCount)`, expressed as
 * absolute indices rather than values. Writes `bucketCount * 2` Int32 indices into `out` starting
 * at `outputOffset`: per bucket, the argmin and the argmax indices emitted in ascending index
 * order (temporal order), so the whole output is monotone non-decreasing — the alternating
 * min/max polyline technique with its one known defect (a backwards step whenever the maximum
 * occurs first in the bucket) removed. Sibling to `minMaxEnvelope`, not a replacement: that
 * function still owns the filled-envelope-band use case, which has no index to emit. Allocation-
 * free hot path: no object/array literal, no `.subarray`, no banned transcendental `Math.*`
 * call — enforced by the `packages/core/src/decimation/**` ESLint scope in addition to this
 * function's own discipline.
 *
 * @returns the number of indices written (`bucketCount * 2`).
 */
export function minMaxEnvelopeIndices(
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Int32Array,
  outputOffset: number,
  bucketCount: number,
): number {
  if (
    !Number.isInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset >= 2147483648
  ) {
    throw new RangeError(
      `sourceOffset must be an integer in [0, 2^31); received ${sourceOffset}.`,
    );
  }
  if (
    !Number.isInteger(sampleCount) ||
    sampleCount < 0 ||
    sampleCount >= 2147483648
  ) {
    throw new RangeError(
      `sampleCount must be an integer in [0, 2^31); received ${sampleCount}.`,
    );
  }
  if (
    !Number.isInteger(outputOffset) ||
    outputOffset < 0 ||
    outputOffset >= 2147483648
  ) {
    throw new RangeError(
      `outputOffset must be an integer in [0, 2^31); received ${outputOffset}.`,
    );
  }
  if (
    !Number.isInteger(bucketCount) ||
    bucketCount < 0 ||
    bucketCount >= 2147483648
  ) {
    throw new RangeError(
      `bucketCount must be an integer in [0, 2^31); received ${bucketCount}.`,
    );
  }
  if (bucketCount > sampleCount) {
    throw new RangeError(
      `bucketCount (${bucketCount}) must be <= sampleCount (${sampleCount}); ` +
        "an upsample request has no correct answer for a downsampler.",
    );
  }
  if (out.length < outputOffset + bucketCount * 2) {
    throw new RangeError(
      `out (length ${out.length}) is too small for outputOffset (${outputOffset}) + ` +
        `bucketCount * 2 (${bucketCount * 2}).`,
    );
  }

  let writeCursor = outputOffset;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start =
      sourceOffset + (((bucket * sampleCount) / bucketCount) | 0);
    const end =
      sourceOffset + ((((bucket + 1) * sampleCount) / bucketCount) | 0);

    // Initialised to `start`, not a sentinel: a bucket whose samples are all `NaN` (both
    // comparisons below stay false) still emits two valid indices — its own first one, twice —
    // rather than an unset value, deterministically breaking the drawn subpath instead of
    // corrupting it.
    let loIndex = start;
    let hiIndex = start;
    let lo = Infinity;
    let hi = -Infinity;

    for (let i = start; i < end; i += 1) {
      // `noUncheckedIndexedAccess` types `y[i]` as `number | undefined`; the boundary validation
      // above already proves `i` is in range, so the non-null assertion is a documented
      // consequence of that proof rather than a per-sample branch.
      const value = y[i]!;
      if (value < lo) {
        lo = value;
        loIndex = i;
      }
      if (value > hi) {
        hi = value;
        hiIndex = i;
      }
    }

    if (loIndex <= hiIndex) {
      out[writeCursor] = loIndex;
      out[writeCursor + 1] = hiIndex;
    } else {
      out[writeCursor] = hiIndex;
      out[writeCursor + 1] = loIndex;
    }
    writeCursor += 2;
  }

  return bucketCount * 2;
}
