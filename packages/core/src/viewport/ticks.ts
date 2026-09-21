/**
 * `selectTicks` — a deterministic "nice" 1/2/5×10^k tick-value selector, writing into a
 * caller-owned `Float64Array` rather than returning a fresh array (no allocation, no
 * reallocation per `render()`). Finds the step magnitude by repeated integer multiply/divide
 * rather than a base-10 logarithm and a power function, so the module carries no
 * transcendental dependency — a base-10 logarithm of a power of ten can land a hair under the
 * exact integer on some inputs, which would otherwise make the step selection depend on
 * floating-point rounding rather than exact integer comparison.
 */

const NICE_STEPS = [1, 2, 5];

function niceStep(rawStep: number): number {
  if (rawStep <= 0 || !Number.isFinite(rawStep)) return 1;

  let magnitude = 1;
  if (rawStep >= 1) {
    while (magnitude * 10 <= rawStep) magnitude *= 10;
  } else {
    while (magnitude > rawStep) magnitude /= 10;
  }

  for (const base of NICE_STEPS) {
    const candidate = base * magnitude;
    if (candidate >= rawStep) return candidate;
  }
  return 10 * magnitude;
}

/**
 * Writes ascending tick values covering `[domainMin, domainMax]` into `out` starting at
 * `outputOffset`, never beyond `out.length`, and returns the count written. `targetCount` is a
 * hint, not a guarantee — the actual count is whatever the chosen nice step produces, clamped
 * to the available buffer capacity from `outputOffset`.
 */
export function selectTicks(
  domainMin: number,
  domainMax: number,
  targetCount: number,
  out: Float64Array,
  outputOffset: number,
): number {
  const capacity = out.length - outputOffset;
  if (capacity <= 0) return 0;

  if (domainMin === domainMax) {
    out[outputOffset] = domainMin;
    return 1;
  }

  const span = domainMax - domainMin;
  const rawStep = span / Math.max(1, targetCount - 1);
  const step = niceStep(rawStep);

  const start = Math.ceil(domainMin / step) * step;

  let count = 0;
  let value = start;
  while (value <= domainMax + step * 1e-9 && count < capacity) {
    out[outputOffset + count] = value;
    count += 1;
    value = start + count * step;
  }

  return count;
}

/**
 * Writes ascending base-10 log-axis tick values covering `[domainMin, domainMax]` into `out`
 * starting at `outputOffset`, never beyond `out.length`, and returns the count written. Fully
 * transcendental-free: the decade floor is found by the same integer multiply/divide magnitude
 * walk `niceStep` uses above, never by taking a base-10 logarithm or raising ten to a power —
 * classifying a value against an exact power of ten that way can land a hair under the exact
 * integer on some inputs, which would make decade selection depend on floating-point rounding
 * rather than exact comparison.
 * Never returns 0 for a valid domain (`domainMin > 0`, `domainMin < domainMax`, `capacity >= 1`):
 * the unconditional floor at the end guards the documented, unresolved d3-scale defect where a
 * narrow or sub-decade domain silently returns an empty tick set
 * (<https://github.com/d3/d3-scale/issues/44>).
 */
export function selectLogTicks(
  domainMin: number,
  domainMax: number,
  targetCount: number,
  out: Float64Array,
  outputOffset: number,
): number {
  const capacity = out.length - outputOffset;
  if (capacity <= 0) return 0;
  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMin <= 0) return 0;
  if (domainMin === domainMax) {
    out[outputOffset] = domainMin;
    return 1;
  }
  if (domainMin > domainMax) return 0;

  // Decade floor: the largest power of ten <= domainMin, found by integer stepping.
  let decade = 1;
  if (domainMin >= 1) {
    while (decade * 10 <= domainMin) decade *= 10;
  } else {
    while (decade > domainMin) decade /= 10;
  }

  // Boundary count: how many powers of ten from `decade` up to `domainMax` (inclusive). The
  // number of decade *intervals* spanned is one less than the number of boundaries.
  let boundaryCount = 0;
  for (let d = decade; d <= domainMax; d *= 10) {
    boundaryCount += 1;
  }
  const decadeCount = boundaryCount - 1;

  let count = 0;

  if (decadeCount >= 2 && decadeCount > targetCount) {
    // THINNING: at most one tick per power of ten, stride computed by integer addition.
    let stride = 1;
    while (Math.ceil(decadeCount / stride) > targetCount) stride += 1;
    let d = decade;
    let stepIndex = 0;
    while (d <= domainMax && count < capacity) {
      if (d >= domainMin && d <= domainMax && stepIndex % stride === 0) {
        out[outputOffset + count] = d;
        count += 1;
      }
      d *= 10;
      stepIndex += 1;
    }
  } else if (decadeCount >= 2) {
    // FEW DECADES: emit every decade in range, plus 2..9 mantissa minors when there is room.
    const emitMantissas = decadeCount <= 2 && decadeCount * 9 <= Math.min(targetCount * 2, capacity);
    let d = decade;
    while (d <= domainMax && count < capacity) {
      if (d >= domainMin && d <= domainMax) {
        out[outputOffset + count] = d;
        count += 1;
        if (emitMantissas) {
          for (let m = 2; m <= 9 && count < capacity; m += 1) {
            const value = d * m;
            if (value >= domainMin && value <= domainMax) {
              out[outputOffset + count] = value;
              count += 1;
            }
          }
        }
      }
      d *= 10;
    }
  } else {
    // SUB-DECADE: linear nice ticks in value space are already well-placed and correctly
    // ordered under a smooth, monotone log map across less than one decade.
    count = selectTicks(domainMin, domainMax, targetCount, out, outputOffset);
  }

  // NON-EMPTY FLOOR — the load-bearing anti-defect guarantee. Runs unconditionally after every
  // other step; never skipped and never weakened.
  if (count === 0 && capacity >= 1) {
    out[outputOffset] = domainMin;
    count = 1;
  }

  return count;
}
