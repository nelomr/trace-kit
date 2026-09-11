/**
 * Deliberately allocating control variants of the decimation algorithms, used only by
 * `allocation-gate.test.ts` to prove the GC-event instrument is live: the control's failure
 * invalidates the real variant's pass. Test-only: never imported from `src/`, so `tsup` never
 * sees it and the hot-path lint glob never matches it.
 */

/** Builds a `{ lo, hi }` object per bucket into a growing array, allocating on every call. */
export function minMaxEnvelopeAllocating(
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  bucketCount: number,
): Array<{ lo: number; hi: number }> {
  const result: Array<{ lo: number; hi: number }> = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = sourceOffset + Math.floor((bucket * sampleCount) / bucketCount);
    const end =
      sourceOffset + Math.floor(((bucket + 1) * sampleCount) / bucketCount);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i += 1) {
      const v = y[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    result.push({ lo, hi });
  }
  return result;
}

/**
 * Selects `threshold` indices using the same bucket partition as `lttb`, but averages each
 * bucket over a `.slice()` copy (a fresh typed-array view allocated per bucket) instead of an
 * accumulate loop, allocating on every call.
 */
export function lttbAllocating(
  x: Float32Array,
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  threshold: number,
): Int32Array {
  const lastIndex = sourceOffset + sampleCount - 1;
  const selected: number[] = [sourceOffset];

  if (threshold === 2) {
    selected.push(lastIndex);
    return Int32Array.from(selected);
  }

  const interior = sampleCount - 2;
  const buckets = threshold - 2;
  let anchorX = x[sourceOffset]!;
  let anchorY = y[sourceOffset]!;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = sourceOffset + 1 + Math.floor((bucket * interior) / buckets);
    const end =
      sourceOffset + 1 + Math.floor(((bucket + 1) * interior) / buckets);
    // Allocates a fresh view every call — the control's whole point.
    const bucketSliceY = y.slice(start, end);
    const bucketSliceX = x.slice(start, end);

    let bestOffset = 0;
    let bestArea = -1;
    for (let i = 0; i < bucketSliceY.length; i += 1) {
      const area = Math.abs(
        (anchorX - bucketSliceX[i]!) * (bucketSliceY[i]! - anchorY),
      );
      if (area > bestArea) {
        bestArea = area;
        bestOffset = i;
      }
    }
    const bestIndex = start + bestOffset;
    selected.push(bestIndex);
    anchorX = x[bestIndex]!;
    anchorY = y[bestIndex]!;
  }

  selected.push(lastIndex);
  return Int32Array.from(selected);
}
