/**
 * Window resolution: maps a domain range to the half-open source index span of one payload.
 *
 * The span is decided on the authoritative samples (before any decimation), on the f64 absolute
 * X `xOrigin + x[i]`: the stored offsets are f32, so comparing them alone would put the window
 * on the wrong grid for any payload with a non-zero origin.
 */
import type { SpectrumDataPayload } from "../payload/spectrum-data-payload.js";

/** Half-open source index span `[start, end)`. Mutable: written in place by the resolver. */
export interface SampleSpan {
  start: number;
  end: number;
}

export interface SampleWindowOptions {
  /** Extend the strict span by one sample per side (clamped). Default `false` (strict). */
  readonly includeNeighbours?: boolean;
}

/** Allocates one reusable span record `{ start: 0, end: 0 }`. Cold path. */
export function createSampleSpan(): SampleSpan {
  return { start: 0, end: 0 };
}

/**
 * Writes into `out` the span of samples whose absolute X (`xOrigin + x[i]`, f64) lies in
 * `[xMin, xMax]`, both bounds inclusive, and returns `out`.
 *
 * Every sample equal to `xMin` or `xMax` is included, however many repeat, because the bounds are
 * a lower bound of `xMin` and an upper bound of `xMax`. Only `[0, sampleCount)` is read. An
 * inverted window, a `NaN` bound, a zero-sample payload and a window outside the data all give an
 * empty span; `+-Infinity` bounds select open-ended windows. With `includeNeighbours` the strict
 * span grows by one sample per side (clamped), and a window lying between two samples returns
 * those two bracketing samples; a window wholly outside the data stays empty.
 *
 * Precondition: absolute X is non-decreasing over `[0, sampleCount)`. No guard runs, because a
 * monotonicity scan would cost O(n) per call. On a payload that violates it the span is
 * unspecified, but the searches keep every probe inside `[0, sampleCount)` and always terminate,
 * so the result still satisfies `0 <= start <= end <= sampleCount`.
 *
 * Allocation-free: scalars only; callers pass `undefined` or a hoisted options object.
 */
export function resolveSampleWindow(
  payload: SpectrumDataPayload,
  xMin: number,
  xMax: number,
  out: SampleSpan,
  options?: SampleWindowOptions,
): SampleSpan {
  const n = payload.sampleCount;
  // `!(xMin <= xMax)` is true for an inverted window and for any NaN bound in one comparison.
  if (n === 0 || !(xMin <= xMax)) {
    out.start = 0;
    out.end = 0;
    return out;
  }

  const x = payload.x;
  const origin = payload.xOrigin;
  // Every probe index below is in [0, n) and n <= capacity, so the `as number` reads never see
  // `undefined`; a fallback branch here would only add work to a loop that must stay branch-light.

  // Lower bound of `xMin`: first index whose absolute X is >= xMin. `hi - lo` shrinks on every
  // iteration, so the loop ends in ceil(log2(n + 1)) steps whatever the order of X.
  // The midpoint is `lo + floor((hi - lo) / 2)`, not `(lo + hi) >>> 1`: the shift wraps at 2^32,
  // which a typed array longer than 4G elements would reach.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (origin + (x[mid] as number) < xMin) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const start = lo;

  // Upper bound of `xMax`, searched from `start` so that `end >= start` even on unsorted data.
  hi = n;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (origin + (x[mid] as number) <= xMax) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const end = lo;

  if (options !== undefined && options.includeNeighbours === true) {
    if (end > start) {
      out.start = start > 0 ? start - 1 : 0;
      out.end = end < n ? end + 1 : n;
      return out;
    }
    // Empty strict span: bracket the window only when samples exist on both sides of it.
    if (start > 0 && start < n) {
      out.start = start - 1;
      out.end = start + 1;
      return out;
    }
  }

  out.start = start;
  out.end = end;
  return out;
}
