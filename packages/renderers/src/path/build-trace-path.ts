import { Y_SCALE_KIND_LOG, type ViewportTransform } from "@trace-kit/core";
import { guardedProjectX, guardedProjectY, liftsPen } from "./guarded-projection.js";
import type { PolylineSink } from "./polyline-sink.js";

/**
 * Walks either the decimated index set (`decimatedCount > 0`) or the direct sample range
 * (`decimatedCount === 0`, walking `[0, directCount)`) and issues one `moveTo` per finite
 * segment and `lineTo` within a segment, projecting every point through `t` on the way. A
 * decimated break (`indices[i] < 0`), a `NaN` sample, or on a log axis a sample `<= 0` (which has
 * no position on that scale) lifts the pen: the next drawable sample starts a new segment with
 * `moveTo` instead of continuing the current one with `lineTo`. An infinite sample is drawn to
 * the plot edge on the side its sign and the axis direction imply, and every coordinate is
 * clamped into a guard band around the plot so a huge finite value stays finite for the sink.
 * Coordinates inside the band are exactly the plain projection. Returns the number of points
 * walked (`n`), not the number of draw calls issued: a heavily gapped trace walks every slot but
 * draws far fewer segments.
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

  const logAxis = t.yScaleKind === Y_SCALE_KIND_LOG;
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
    if (liftsPen(yj, logAxis)) {
      // Direct-path gap or an unrepresentable log value: a decimator never emits an index into
      // a NaN sample, but the bypass path walks raw samples, so the value is checked here.
      penDown = false;
      continue;
    }
    const px = guardedProjectX(t, x[j] ?? 0);
    const py = guardedProjectY(t, yj);
    if (penDown) {
      sink.lineTo(px, py);
    } else {
      sink.moveTo(px, py);
      penDown = true;
    }
  }

  return n;
}
