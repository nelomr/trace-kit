import type { SpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

/**
 * Test-only partition predicate: is absolute X (`xOrigin + x[i]` in f64) non-decreasing over the
 * valid prefix? Property tests use it to separate inputs inside the resolver's precondition from
 * arbitrary-order inputs that only need to stay in bounds.
 */
export function isNonDecreasingAbsoluteX(payload: SpectrumDataPayload): boolean {
  for (let i = 1; i < payload.sampleCount; i += 1) {
    const previous = payload.xOrigin + (payload.x[i - 1] ?? 0);
    const current = payload.xOrigin + (payload.x[i] ?? 0);
    if (current < previous) return false;
  }
  return true;
}
