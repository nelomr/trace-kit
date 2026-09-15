/**
 * The single chokepoint between a panel value and an algorithm argument. Total — never throws,
 * always returns an in-range value — so no interactive input can reach `lttb`/`minMaxEnvelope`
 * outside their own contract.
 */

export const MAX_SAMPLES = 1_000_000;
export const MAX_OUT_ELEMENTS = 65_536;

export interface ValidatedRun {
  /** Integer, [2, MAX_SAMPLES]. */
  readonly sampleCount: number;
  /** Integer, [2, min(sampleCount, MAX_OUT_ELEMENTS)]. */
  readonly threshold: number;
  /** Integer, [1, min(sampleCount, MAX_OUT_ELEMENTS / 2)]. */
  readonly bucketCount: number;
}

/**
 * `Math.trunc`/`Math.min`/`Math.max` only — exact operations, never a transcendental. `NaN`
 * and `Infinity` clamp to `lo`, since neither has a meaningful truncated integer value.
 */
export function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    return lo;
  }
  return Math.min(hi, Math.max(lo, Math.trunc(value)));
}

/**
 * Clamps `sampleCount` first, then `threshold` and `bucketCount` against the RESOLVED
 * `sampleCount` — not the raw input — because both of their upper bounds depend on it.
 */
export function validateRun(
  rawSampleCount: number,
  rawThreshold: number,
  rawBucketCount: number,
): ValidatedRun {
  const sampleCount = clampInt(rawSampleCount, 2, MAX_SAMPLES);
  const threshold = clampInt(rawThreshold, 2, Math.min(sampleCount, MAX_OUT_ELEMENTS));
  const bucketCount = clampInt(
    rawBucketCount,
    1,
    Math.min(sampleCount, MAX_OUT_ELEMENTS / 2),
  );
  return { sampleCount, threshold, bucketCount };
}
