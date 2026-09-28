import { projectX, projectY, type ViewportTransform } from "@trace-kit/core";
import type { PolylineSink } from "./polyline-sink.js";

/**
 * Walks either the decimated index set (`decimatedCount > 0`) or the direct sample range
 * (`decimatedCount === 0`, walking `[0, directCount)`) and issues one `moveTo` per finite
 * segment and `lineTo` within a segment, projecting every point through `t` on the way. A
 * decimated break (`indices[i] < 0`) or a direct-path gap (`y[j] !== y[j]`) lifts the pen: the
 * next finite sample starts a new segment with `moveTo` instead of continuing the current one
 * with `lineTo`. Returns the number of points walked (`n`), not the number of draw calls issued
 * — a heavily gapped trace walks every slot but draws far fewer segments.
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
  const decimated = decimatedCount > 0;
  const n = decimated ? decimatedCount : directCount;
  if (n === 0) return 0;

  let penDown = false;
  for (let i = 0; i < n; i += 1) {
    const j = decimated ? (indices[i] ?? -1) : i;
    if (j < 0) {
      // Decimated break: the emitting decimator already proved this slot spans a gap or is
      // padding. No `y` dereference needed — the index stream is the single source of truth.
      penDown = false;
      continue;
    }
    const yj = y[j] ?? NaN;
    if (yj !== yj) {
      // Direct-path gap: never produced by a decimator (they never emit an index into a NaN
      // sample), but the bypass path walks raw samples, so this loop compares the value
      // against its own reading here instead.
      penDown = false;
      continue;
    }
    const px = projectX(t, x[j] ?? 0);
    const py = projectY(t, yj);
    if (penDown) {
      sink.lineTo(px, py);
    } else {
      sink.moveTo(px, py);
      penDown = true;
    }
  }

  return n;
}
