/**
 * A caller-facing choice of decimation algorithm and its own parameter, kept mutually exclusive
 * at the type level so `{ algorithm: "lttb", bucketCount: n }` is a compile error rather than a
 * runtime surprise. Allocation-free hot path: `resolveDecimationParameter` below is arithmetic
 * only, no object/array literal, no closure construction.
 */
export type DecimationAlgorithm = "lttb" | "min-max";

export interface LttbSelection {
  readonly algorithm: "lttb";
  /** Vertices to emit. Omitted => derived from the plot-area width. */
  readonly threshold?: number;
  /** Present only to make `{ algorithm: "lttb", bucketCount: n }` a type error. Never assigned. */
  readonly bucketCount?: never;
}

export interface MinMaxSelection {
  readonly algorithm: "min-max";
  /** Buckets to emit; each yields two vertices. Omitted => derived from the plot-area width. */
  readonly bucketCount?: number;
  /** Present only to make `{ algorithm: "min-max", threshold: n }` a type error. Never assigned. */
  readonly threshold?: never;
}

export type DecimationSelection = LttbSelection | MinMaxSelection;

/** Pre-decimate to at most twice the plot-area width — matches the renderer's own default. */
const OVERSAMPLE = 2;

/**
 * Resolves a `DecimationSelection` (whose own parameter may be omitted) to a single scalar:
 * `threshold` for `lttb`, `bucketCount` for `min-max`. Both derive from the same viewport-width
 * budget so a default-selected `min-max` draws the same vertex count as a default-selected
 * `lttb` (each `min-max` bucket emits two vertices, so its budget is halved).
 */
export function resolveDecimationParameter(
  selection: DecimationSelection,
  plotWidth: number,
  sampleCount: number,
): number {
  const vertexBudget = Math.max(2, Math.ceil(plotWidth * OVERSAMPLE));
  if (selection.algorithm === "lttb") {
    const threshold = selection.threshold ?? vertexBudget;
    return Math.min(sampleCount, threshold);
  }
  const bucketCount = selection.bucketCount ?? Math.max(1, Math.floor(vertexBudget / 2));
  return Math.min(sampleCount, bucketCount);
}
