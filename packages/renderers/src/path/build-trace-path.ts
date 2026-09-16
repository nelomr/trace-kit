import { projectX, projectY, type ViewportTransform } from "@trace-kit/core";
import type { PolylineSink } from "./polyline-sink.js";

/**
 * Walks either the decimated index set (`decimatedCount > 0`) or the direct sample range
 * (`decimatedCount === 0`, walking `[0, directCount)`) and issues exactly one `moveTo` followed
 * by `n - 1` `lineTo` calls into `sink`, projecting every point through `t` on the way. Returns
 * the number of points walked.
 *
 * Allocation-free per the ban list this module's ESLint hot-path block enforces: no object or
 * array literal, no closure, no `.subarray`, no spread, no template literal, no `for...of`, no
 * rest parameter in the loop body. `noUncheckedIndexedAccess` is on workspace-wide, so every
 * typed-array read is defaulted with `??` rather than narrowed away.
 */
export function buildTracePath(
  sink: PolylineSink,
  t: ViewportTransform,
  x: Float32Array,
  y: Float32Array,
  indices: Int32Array,
  decimatedCount: number,
  directCount: number,
): number {
  const n = decimatedCount > 0 ? decimatedCount : directCount;
  if (n === 0) return 0;

  const first = decimatedCount > 0 ? (indices[0] ?? 0) : 0;
  sink.moveTo(projectX(t, x[first] ?? 0), projectY(t, y[first] ?? 0));

  for (let i = 1; i < n; i += 1) {
    const j = decimatedCount > 0 ? (indices[i] ?? 0) : i;
    sink.lineTo(projectX(t, x[j] ?? 0), projectY(t, y[j] ?? 0));
  }
  return n;
}
