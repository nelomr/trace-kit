import type { DecimationSelection, SpectrumDataPayload, TraceCollection } from "@trace-kit/core";
import type { ViewportDomain } from "@trace-kit/renderers/controller";

/** Default viewport domain snapshot prior to controller attachment or during SSR. */
export const DEFAULT_DOMAIN_SNAPSHOT: ViewportDomain = Object.freeze({
  xMin: 0,
  xMax: 1,
  yMin: -1,
  yMax: 1,
});

/**
 * Returns a fresh, frozen plain `{ xMin, xMax, yMin, yMax }` snapshot detached from
 * `SpectrumEngineController`'s live `#domainView` getter object.
 */
export function snapshotDomain(domain: ViewportDomain): ViewportDomain {
  return Object.freeze({
    xMin: domain.xMin,
    xMax: domain.xMax,
    yMin: domain.yMin,
    yMax: domain.yMax,
  });
}

/** Compares two viewport domains across their four scalar coordinates. */
export function domainsEqual(a: ViewportDomain, b: ViewportDomain): boolean {
  return a.xMin === b.xMin && a.xMax === b.xMax && a.yMin === b.yMin && a.yMax === b.yMax;
}

/** Compares two optional decimation selections structurally by value. */
export function decimationEqual(
  a: DecimationSelection | undefined,
  b: DecimationSelection | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.algorithm !== b.algorithm) return false;
  if (a.algorithm === "lttb" && b.algorithm === "lttb") {
    return a.threshold === b.threshold;
  }
  if (a.algorithm === "min-max" && b.algorithm === "min-max") {
    return a.bucketCount === b.bucketCount;
  }
  return false;
}

/**
 * Enforces fail-fast mutual exclusivity between `data` and `traces`. Throws a synchronous
 * `TypeError` if both resolve to non-nullish values simultaneously.
 */
export function assertDataTracesExclusive(
  data: SpectrumDataPayload | undefined,
  traces: TraceCollection | undefined,
): void {
  if (data !== undefined && traces !== undefined) {
    throw new TypeError(
      "TraceKit React adapter: `data` and `traces` cannot be provided simultaneously.",
    );
  }
}

/** Normalizes `null | undefined` to `undefined`. */
export function normalizeOptional<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}
