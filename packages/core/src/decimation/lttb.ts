/**
 * Largest-Triangle-Three-Buckets index selection over `x`/`y[sourceOffset … sourceOffset +
 * sampleCount)`. Writes `threshold` absolute indices (indices into the original `x`/`y`
 * buffers, inclusive of `sourceOffset`) as an `Int32Array` into `out` starting at
 * `outputOffset`. Allocation-free hot path: no object/array literal, no `.subarray`, no banned
 * transcendental `Math.*` call — enforced by the `packages/core/src/decimation/**` ESLint scope
 * in addition to this function's own discipline.
 *
 * One forward traversal, no scratch buffer: each interior sample's `y` value is read at most
 * twice — once while accumulating its own bucket's mean, once as a triangle-area candidate
 * evaluated against the following bucket's already-computed mean.
 *
 * @returns the number of indices written (`threshold`).
 */
export function lttb(
  x: Float32Array,
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Int32Array,
  outputOffset: number,
  threshold: number,
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
    sampleCount < 2 ||
    sampleCount >= 2147483648
  ) {
    throw new RangeError(
      `sampleCount must be an integer in [2, 2^31); received ${sampleCount}.`,
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
    !Number.isInteger(threshold) ||
    threshold < 2 ||
    threshold >= 2147483648
  ) {
    throw new RangeError(
      `threshold must be an integer in [2, 2^31); received ${threshold}.`,
    );
  }
  if (threshold > sampleCount) {
    throw new RangeError(
      `threshold (${threshold}) must be <= sampleCount (${sampleCount}); ` +
        "there are not enough samples to select that many indices.",
    );
  }
  if (out.length < outputOffset + threshold) {
    throw new RangeError(
      `out (length ${out.length}) is too small for outputOffset (${outputOffset}) + ` +
        `threshold (${threshold}).`,
    );
  }

  const lastIndex = sourceOffset + sampleCount - 1;
  out[outputOffset] = sourceOffset;

  if (threshold === 2) {
    out[outputOffset + 1] = lastIndex;
    return 2;
  }

  out[outputOffset + threshold - 1] = lastIndex;

  const interior = sampleCount - 2;
  const buckets = threshold - 2;

  // `noUncheckedIndexedAccess` types every indexed read as `T | undefined`; the boundary
  // validation above proves every index used below is in range, so each non-null assertion is
  // a documented consequence of that proof rather than a per-sample branch.
  let selectedX = x[sourceOffset]!;
  let selectedY = y[sourceOffset]!;

  let writeCursor = outputOffset + 1;
  let prevStart = 0;
  let prevEnd = 0;
  let havePrevBucket = false;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = sourceOffset + 1 + (((bucket * interior) / buckets) | 0);
    const end =
      sourceOffset + 1 + ((((bucket + 1) * interior) / buckets) | 0);

    let sumX = 0;
    let sumY = 0;
    for (let i = start; i < end; i += 1) {
      sumX += x[i]!;
      sumY += y[i]!;
    }
    const count = end - start;
    const avgX = sumX / count;
    const avgY = sumY / count;

    if (havePrevBucket) {
      let bestIndex = prevStart;
      let bestX = selectedX;
      let bestY = selectedY;
      let bestArea = -1;
      for (let i = prevStart; i < prevEnd; i += 1) {
        const candidateX = x[i]!;
        const candidateY = y[i]!;
        const signedArea =
          (selectedX - avgX) * (candidateY - selectedY) -
          (selectedX - candidateX) * (avgY - selectedY);
        const area = signedArea < 0 ? -signedArea : signedArea;
        if (area > bestArea) {
          bestArea = area;
          bestIndex = i;
          bestX = candidateX;
          bestY = candidateY;
        }
      }
      out[writeCursor] = bestIndex;
      writeCursor += 1;
      // Reuses the candidate's already-read value rather than re-reading `x[bestIndex]`/
      // `y[bestIndex]`, keeping each sample's read count at exactly two.
      selectedX = bestX;
      selectedY = bestY;
    }

    prevStart = start;
    prevEnd = end;
    havePrevBucket = true;
  }

  const finalX = x[lastIndex]!;
  const finalY = y[lastIndex]!;
  let bestIndex = prevStart;
  let bestArea = -1;
  for (let i = prevStart; i < prevEnd; i += 1) {
    const candidateX = x[i]!;
    const candidateY = y[i]!;
    const signedArea =
      (selectedX - finalX) * (candidateY - selectedY) -
      (selectedX - candidateX) * (finalY - selectedY);
    const area = signedArea < 0 ? -signedArea : signedArea;
    if (area > bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }
  out[writeCursor] = bestIndex;

  return threshold;
}
