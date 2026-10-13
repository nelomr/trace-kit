import {
  lttb,
  minMaxEnvelopeIndices,
  resolveDecimationParameter,
  type DecimationAlgorithm,
  type DecimationSelection,
} from "@trace-kit/core";

const DEFAULT_LTTB: DecimationSelection = Object.freeze({ algorithm: "lttb" });

/**
 * Vertex budget for a default LTTB pass: `min(sampleCount, max(2, ceil(plotWidth * 2)))`.
 * Delegated to core so the oversampling factor has exactly one definition; a second copy in the
 * renderers would silently drift the day core retunes it.
 */
export function deriveDecimationTarget(sampleCount: number, plotWidth: number): number {
  return resolveDecimationParameter(DEFAULT_LTTB, plotWidth, sampleCount);
}

/**
 * Resolves a selection to its scalar parameter (`threshold` for lttb, `bucketCount` for
 * min-max). A default lttb selection takes the derived target; everything else is core's own
 * resolution, which already honours an explicit threshold or bucket count.
 */
export function resolveDecimationTarget(
  selection: DecimationSelection,
  plotWidth: number,
  sampleCount: number,
): number {
  if (selection.algorithm === "lttb" && selection.threshold === undefined) {
    return deriveDecimationTarget(sampleCount, plotWidth);
  }
  return resolveDecimationParameter(selection, plotWidth, sampleCount);
}

/**
 * Runs the selected decimator into `indices` and returns the number of slots written. The caller
 * guarantees `sampleCount` exceeds the emitted vertex count (the bypass decision is the caller's)
 * and that `indices` holds at least that many slots.
 *
 * LTTB returns 0 when the input is fragmented into more segments than `parameter` vertices can
 * represent without bridging a gap. Min-max always has a representable answer (a fixed
 * `2 * bucketCount` slots), so the fallback uses `bucketCount = floor(parameter / 2)`: that emits
 * `2 * floor(parameter / 2) <= parameter` slots and therefore fits the capacity already reserved
 * for the LTTB attempt.
 */
export function decimateTraceIndices(
  algorithm: DecimationAlgorithm,
  parameter: number,
  x: Float32Array,
  y: Float32Array,
  sampleCount: number,
  indices: Int32Array,
): number {
  if (algorithm === "lttb") {
    const count = lttb(x, y, 0, sampleCount, indices, 0, parameter);
    if (count !== 0) return count;
    const bucketCount = Math.max(1, (parameter / 2) | 0);
    return minMaxEnvelopeIndices(y, 0, sampleCount, indices, 0, bucketCount);
  }
  return minMaxEnvelopeIndices(y, 0, sampleCount, indices, 0, parameter);
}
