/**
 * Bucketed min/max envelope over `y[sourceOffset … sourceOffset + sampleCount)`. Writes
 * `bucketCount * 2` f32 values, interleaved `[min0, max0, min1, max1, …]`, into `out` starting
 * at `outputOffset`. Allocation-free hot path: no object/array literal, no `.subarray`, no
 * banned transcendental `Math.*` call — enforced by the `packages/core/src/decimation/**`
 * ESLint scope in addition to this function's own discipline.
 *
 * @returns the number of values written (`bucketCount * 2`).
 */
export function minMaxEnvelope(
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Float32Array,
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

    let lo = Infinity;
    let hi = -Infinity;
    let sawGap = false;

    for (let i = start; i < end; i += 1) {
      // `noUncheckedIndexedAccess` types `y[i]` as `number | undefined`; the boundary
      // validation above already proves `i` is in range, so the non-null assertion is a
      // documented consequence of that proof rather than a per-sample branch.
      const value = y[i]!;
      // `value !== value` is true only for NaN; a self-compare on the value already read costs
      // nothing extra and needs no `Number.isNaN` call in the hot loop.
      if (value !== value) sawGap = true;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }

    if (sawGap) {
      // A bucket that touches even one gap sample can never report a trustworthy envelope of
      // its neighbours: the missing sample could have been the true extreme. Collapsing to
      // NaN/NaN keeps the break visible instead of silently bridging over it.
      lo = NaN;
      hi = NaN;
    } else if (lo === Infinity && hi === -Infinity) {
      lo = NaN;
      hi = NaN;
    }

    out[writeCursor] = lo;
    out[writeCursor + 1] = hi;
    writeCursor += 2;
  }

  return bucketCount * 2;
}
