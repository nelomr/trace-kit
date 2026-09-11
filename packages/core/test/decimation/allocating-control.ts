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
