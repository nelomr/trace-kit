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
 * Counts isolated segments — finite segments (same pen-state rule as `buildTracePath`: a
 * decimated break is `indices[i] < 0`, a direct-path gap is `y[j] !== y[j]`) whose real samples
 * all resolve to the same source index. Covers an LTTB singleton, a min-max `[i, i]` bucket
 * between two `[-1, -1]` buckets, and a length-1 direct-path run. Cold-path counting walk:
 * integer locals only, no allocation, run once per memo recompute rather than once per frame.
 */
export function countIsolatedSegments(
  x: Float32Array,
  y: Float32Array,
  indices: Int32Array,
  decimatedCount: number,
  directCount: number,
): number {
  const decimated = decimatedCount > 0;
  const n = decimated ? decimatedCount : directCount;
  if (n === 0) return 0;

  let count = 0;
  let penDown = false;
  let segmentFirstIndex = -1;
  let segmentDistinct = false;

  for (let i = 0; i < n; i += 1) {
    const j = decimated ? (indices[i] ?? -1) : i;
    if (j < 0) {
      if (penDown && !segmentDistinct) count += 1;
      penDown = false;
      continue;
    }
    const yj = y[j] ?? NaN;
    if (yj !== yj) {
      if (penDown && !segmentDistinct) count += 1;
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
  if (penDown && !segmentDistinct) count += 1;

  return count;
}

/**
 * Walks the same stream `countIsolatedSegments` counts and, on each isolated segment's close
 * (a break or the end of the stream), calls `sink.rect` for an axis-aligned square centered on
 * that segment's one sample, side `2 * halfSide`. Runs only on traces `countIsolatedSegments`
 * already reported `> 0` for; a gap-free trace never enters this function's caller. Returns the
 * number of markers drawn.
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
  const decimated = decimatedCount > 0;
  const n = decimated ? decimatedCount : directCount;
  if (n === 0) return 0;

  const side = halfSide * 2;
  let markerCount = 0;
  let penDown = false;
  let segmentFirstIndex = -1;
  let segmentDistinct = false;

  for (let i = 0; i < n; i += 1) {
    const j = decimated ? (indices[i] ?? -1) : i;
    if (j < 0) {
      if (penDown && !segmentDistinct) {
        const px = projectX(t, x[segmentFirstIndex] ?? 0);
        const py = projectY(t, y[segmentFirstIndex] ?? 0);
        sink.rect(px - halfSide, py - halfSide, side, side);
        markerCount += 1;
      }
      penDown = false;
      continue;
    }
    const yj = y[j] ?? NaN;
    if (yj !== yj) {
      if (penDown && !segmentDistinct) {
        const px = projectX(t, x[segmentFirstIndex] ?? 0);
        const py = projectY(t, y[segmentFirstIndex] ?? 0);
        sink.rect(px - halfSide, py - halfSide, side, side);
        markerCount += 1;
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
    const px = projectX(t, x[segmentFirstIndex] ?? 0);
    const py = projectY(t, y[segmentFirstIndex] ?? 0);
    sink.rect(px - halfSide, py - halfSide, side, side);
    markerCount += 1;
  }

  return markerCount;
}
