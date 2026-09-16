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
