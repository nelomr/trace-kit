import { projectX, projectY, type ViewportTransform } from "@trace-kit/core";

/**
 * A real measured sample must never be invisible: when a finite segment (the same
 * gap-vs-segment split `buildTracePath` walks) collapses to exactly one distinct source index,
 * stroking it draws nothing (a zero-length subpath under `butt` cap). `MarkerSink` is the seam a
 * filled marker is painted through instead — satisfied structurally by `Path2D` (no adapter, no
 * cast) and by a counting fixture in tests, mirroring `PolylineSink`.
 */
export interface MarkerSink {
  rect(x: number, y: number, w: number, h: number): void;
}

/**
 * The one pen-state walk behind every isolated-sample consumer: a finite segment (the same
 * gap-vs-segment split `buildTracePath` walks — a decimated break is `indices[i] < 0`, a
 * direct-path gap is `y[j] !== y[j]`) whose real samples all resolve to the same source index is
 * isolated. Covers an LTTB singleton, a min-max `[i, i]` bucket between two `[-1, -1]` buckets
 * and a length-1 direct-path run. Counting, index collection and painting share this walk so the
 * three can never disagree on which samples are isolated.
 *
 * `out`, `sink` and `t` are each optional: a counting pass passes none, an index-collecting pass
 * passes `out`, a painting pass passes `sink` and `t`. Integer locals only and no allocation, so
 * it stays valid on the per-key-change path of a GPU backend as well as a cold painter.
 */
function walkIsolatedSegments(
  x: Float32Array,
  y: Float32Array,
  indices: Int32Array,
  decimatedCount: number,
  directCount: number,
  out: Int32Array | null,
  sink: MarkerSink | null,
  t: ViewportTransform | null,
  halfSide: number,
): number {
  const decimated = decimatedCount > 0;
  const n = decimated ? decimatedCount : directCount;
  if (n === 0) return 0;

  const side = halfSide * 2;
  let count = 0;
  let penDown = false;
  let segmentFirstIndex = -1;
  let segmentDistinct = false;

  for (let i = 0; i < n; i += 1) {
    const j = decimated ? (indices[i] ?? -1) : i;
    const breaks = j < 0 || (y[j] ?? NaN) !== (y[j] ?? NaN);
    if (breaks) {
      if (penDown && !segmentDistinct) {
        if (out !== null) out[count] = segmentFirstIndex;
        if (sink !== null && t !== null) {
          const px = projectX(t, x[segmentFirstIndex] ?? 0);
          const py = projectY(t, y[segmentFirstIndex] ?? 0);
          sink.rect(px - halfSide, py - halfSide, side, side);
        }
        count += 1;
      }
      penDown = false;
      continue;
    }
    if (!penDown) {
      segmentFirstIndex = j;
      segmentDistinct = false;
      penDown = true;
    } else if (j !== segmentFirstIndex) {
      segmentDistinct = true;
    }
  }
  if (penDown && !segmentDistinct) {
    if (out !== null) out[count] = segmentFirstIndex;
    if (sink !== null && t !== null) {
      const px = projectX(t, x[segmentFirstIndex] ?? 0);
      const py = projectY(t, y[segmentFirstIndex] ?? 0);
      sink.rect(px - halfSide, py - halfSide, side, side);
    }
    count += 1;
  }

  return count;
}

/**
 * Counts isolated segments. Run once per memo recompute (or per GPU upload key change) rather
 * than once per frame, so `render()` never walks the samples to rediscover it.
 */
export function countIsolatedSegments(
  x: Float32Array,
  y: Float32Array,
  indices: Int32Array,
  decimatedCount: number,
  directCount: number,
): number {
  return walkIsolatedSegments(x, y, indices, decimatedCount, directCount, null, null, null, 0);
}

/**
 * Writes the source sample index of every isolated segment into `out[0 .. count)`, in stream
 * order, and returns `count` (equal to `countIsolatedSegments` for the same stream). The caller
 * sizes `out` to at least that count; a GPU backend gathers marker positions from these indices
 * without re-deriving the pen-state rules.
 */
export function collectIsolatedSampleIndices(
  x: Float32Array,
  y: Float32Array,
  indices: Int32Array,
  decimatedCount: number,
  directCount: number,
  out: Int32Array,
): number {
  return walkIsolatedSegments(x, y, indices, decimatedCount, directCount, out, null, null, 0);
}

/**
 * Walks the same stream `countIsolatedSegments` counts and, on each isolated segment's close,
 * calls `sink.rect` for an axis-aligned square centered on that segment's one sample, side
 * `2 * halfSide`. Runs only on traces `countIsolatedSegments` already reported `> 0` for; a
 * gap-free trace never enters this function's caller. Returns the number of markers drawn.
 */
export function buildIsolatedMarkers(
  sink: MarkerSink,
  t: ViewportTransform,
  x: Float32Array,
  y: Float32Array,
  indices: Int32Array,
  decimatedCount: number,
  directCount: number,
  halfSide: number,
): number {
  return walkIsolatedSegments(x, y, indices, decimatedCount, directCount, null, sink, t, halfSide);
}

/**
 * Half the side of an isolated-sample marker square, in the unit of `dpr` (device pixels for a
 * raster backend, CSS pixels when `dpr` is 1). The side is `2 * lineWidthCss * dpr`, so the
 * marker is exactly as wide as the stroke it stands in for.
 */
export function isolatedMarkerHalfSide(lineWidthCss: number, dpr: number): number {
  return lineWidthCss * dpr;
}
