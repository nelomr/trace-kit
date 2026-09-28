/**
 * Largest-Triangle-Three-Buckets index selection over `x`/`y[sourceOffset … sourceOffset +
 * sampleCount)`. Writes indices (into the original `x`/`y` buffers, inclusive of
 * `sourceOffset`) as an `Int32Array` into `out` starting at `outputOffset`. Allocation-free hot
 * path: no object/array literal, no `.subarray`, no banned transcendental `Math.*` call —
 * enforced by the `packages/core/src/decimation/**` ESLint scope in addition to this function's
 * own discipline.
 *
 * A `NaN` sample in `y` is a gap, never a value: bucketing never crosses a gap, and every finite
 * run between gaps ("segment") keeps its own first and last sample. A break between two segments
 * is written as `-1`, an index value no real sample can ever have (indices are validated `>= 0`).
 *
 * @returns `threshold` for every representable input, including gap-free input (byte-identical
 * to the single-segment case) and all-`NaN` input (every slot `-1`). Returns `0` when the input
 * cannot be represented within `threshold` without dropping a segment or bridging a gap — in
 * that case `out`'s contents are unspecified.
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

  const whole = lttbCore(x, y, sourceOffset, sampleCount, out, outputOffset, threshold);
  if (whole !== ABORT) {
    // Gap-free input: one traversal, at most two reads per interior sample, byte-identical to
    // the pre-gap-awareness implementation.
    return threshold;
  }

  return lttbGapped(x, y, sourceOffset, sampleCount, out, outputOffset, threshold);
}

/**
 * Sentinel distinguishing "a `NaN` sample was read" from every legitimate return count (always
 * `>= 2`), so the caller can branch on the read result of a single arithmetic comparison instead
 * of a second pass over the range just to look for a gap.
 */
const ABORT = -1;

/**
 * The unmodified LTTB selection loop, generalized to an arbitrary sub-range and write cursor so
 * both the whole-range gap-free attempt and each per-segment decimation in the gapped path share
 * one implementation. Aborts as soon as a `NaN` is read — via the same comparison already
 * performed to accumulate the bucket mean, so a gap-free call pays no extra read over the
 * pre-gap-awareness implementation.
 *
 * Caller contract: `count >= 2`, `k` in `[2, count]`, `out` has room for `k` slots starting at
 * `cursor`. Not validated here — this is the hot inner loop, called up to once per segment.
 */
function lttbCore(
  x: Float32Array,
  y: Float32Array,
  start: number,
  count: number,
  out: Int32Array,
  cursor: number,
  k: number,
): number {
  const lastIndex = start + count - 1;

  // `noUncheckedIndexedAccess` types every indexed read as `T | undefined`; the caller contract
  // above proves every index used in this function is in range, so each non-null assertion is a
  // documented consequence of that proof rather than a per-sample branch.
  const firstY = y[start]!;
  if (firstY !== firstY) return ABORT;
  const lastY = y[lastIndex]!;
  if (lastY !== lastY) return ABORT;

  out[cursor] = start;

  if (k === 2) {
    out[cursor + 1] = lastIndex;
    return k;
  }

  out[cursor + k - 1] = lastIndex;

  const interior = count - 2;
  const buckets = k - 2;

  let selectedX = x[start]!;
  let selectedY = firstY;

  let writeCursor = cursor + 1;
  let prevStart = 0;
  let prevEnd = 0;
  let havePrevBucket = false;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const bucketStart = start + 1 + (((bucket * interior) / buckets) | 0);
    const bucketEnd = start + 1 + ((((bucket + 1) * interior) / buckets) | 0);

    let sumX = 0;
    let sumY = 0;
    for (let i = bucketStart; i < bucketEnd; i += 1) {
      const v = y[i]!;
      if (v !== v) return ABORT;
      sumX += x[i]!;
      sumY += v;
    }
    const count2 = bucketEnd - bucketStart;
    const avgX = sumX / count2;
    const avgY = sumY / count2;

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

    prevStart = bucketStart;
    prevEnd = bucketEnd;
    havePrevBucket = true;
  }

  const finalX = x[lastIndex]!;
  const finalY = lastY;
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

  return k;
}

/**
 * Gapped path: reached only after the whole-range attempt aborted on a `NaN`. Runs a counting
 * scan (segment count `S`, finite sample count `F`, minimum-budget sum `M`), decides
 * feasibility, then re-walks the range apportioning `threshold` across segments and delegating
 * each segment `>= 3` samples wide to `lttbCore`. Bounded multi-pass, integer locals only, no
 * allocation: worst case per sample is 2 reads in the aborted whole-range pass, 1 in the
 * counting scan, 1 in the segment-boundary scan, 2 in the segment's own `lttbCore` call.
 */
function lttbGapped(
  x: Float32Array,
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Int32Array,
  outputOffset: number,
  threshold: number,
): number {
  const end = sourceOffset + sampleCount;

  let segmentCount = 0;
  let finiteCount = 0;
  let minimumBudget = 0;
  let currentSegmentLength = 0;
  let inSegment = false;
  for (let i = sourceOffset; i < end; i += 1) {
    const v = y[i]!;
    if (v === v) {
      if (!inSegment) {
        inSegment = true;
        currentSegmentLength = 0;
      }
      currentSegmentLength += 1;
      finiteCount += 1;
    } else if (inSegment) {
      segmentCount += 1;
      minimumBudget += currentSegmentLength >= 2 ? 2 : 1;
      inSegment = false;
    }
  }
  if (inSegment) {
    segmentCount += 1;
    minimumBudget += currentSegmentLength >= 2 ? 2 : 1;
  }

  if (segmentCount === 0) {
    // No finite sample anywhere: the break stream itself is the only representable answer.
    for (let i = 0; i < threshold; i += 1) out[outputOffset + i] = -1;
    return threshold;
  }

  // One slot per selected sample plus one `-1` between consecutive segments; a budget that
  // cannot fit every segment's own minimum means this input cannot be represented within
  // `threshold` without either dropping a whole segment or bridging a gap — both excluded by
  // contract, so the only honest answer is "not representable", not a degraded approximation.
  const budget = Math.min(threshold - (segmentCount - 1), finiteCount);
  if (minimumBudget > budget) {
    return 0;
  }

  const extra = budget - minimumBudget;
  const spareCapacity = finiteCount - minimumBudget;

  let writeCursor = outputOffset;
  let cumulativeSpareBefore = 0;
  let wroteFirstSegment = false;
  let i = sourceOffset;
  while (i < end) {
    const v = y[i]!;
    if (v !== v) {
      i += 1;
      continue;
    }
    const segmentStart = i;
    let segmentEnd = i;
    while (segmentEnd < end) {
      const inner = y[segmentEnd]!;
      if (inner !== inner) break;
      segmentEnd += 1;
    }
    const segmentLength = segmentEnd - segmentStart;
    const minimumForSegment = segmentLength >= 2 ? 2 : 1;
    const spareInSegment = segmentLength - minimumForSegment;
    const cumulativeSpareAfter = cumulativeSpareBefore + spareInSegment;
    const segmentShare =
      spareCapacity === 0
        ? minimumForSegment
        : minimumForSegment +
          (((extra * cumulativeSpareAfter) / spareCapacity) | 0) -
          (((extra * cumulativeSpareBefore) / spareCapacity) | 0);
    cumulativeSpareBefore = cumulativeSpareAfter;

    if (wroteFirstSegment) {
      // A leading or trailing gap never produces a break slot — only a gap strictly between two
      // finite segments does, matching the definition of "segment boundary" the reader detects.
      out[writeCursor] = -1;
      writeCursor += 1;
    }

    if (segmentShare === 1) {
      out[writeCursor] = segmentStart;
      writeCursor += 1;
    } else if (segmentShare === 2) {
      out[writeCursor] = segmentStart;
      out[writeCursor + 1] = segmentEnd - 1;
      writeCursor += 2;
    } else {
      lttbCore(x, y, segmentStart, segmentLength, out, writeCursor, segmentShare);
      writeCursor += segmentShare;
    }

    wroteFirstSegment = true;
    i = segmentEnd;
  }

  const stop = outputOffset + threshold;
  while (writeCursor < stop) {
    out[writeCursor] = -1;
    writeCursor += 1;
  }

  return threshold;
}
