import fc from "fast-check";
import { describe, it } from "vitest";
import {
  createSampleSpan,
  resolveSampleWindow,
  type SampleSpan,
} from "../../src/viewport/window.js";
import { isNonDecreasingAbsoluteX } from "../support/monotonic.js";
import { buildPayload } from "../support/payload-builder.js";
import type { SpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

const finiteF32 = fc.float({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 });
const origin = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e4, max: 1e4 });
const bound = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true, min: -2e6, max: 2e6 }),
  fc.constantFrom(Infinity, -Infinity),
);
const anyBound = fc.oneof(bound, fc.constant(NaN));

const sortedOffsets = fc
  .array(finiteF32, { maxLength: 40 })
  .map((values) => [...values].sort((a, b) => a - b));
const anyOrderOffsets = fc.array(finiteF32, { maxLength: 40 });

function absoluteAt(payload: SpectrumDataPayload, i: number): number {
  return payload.xOrigin + (payload.x[i] ?? 0);
}

/** Linear-scan definition: first and last index with `xMin <= abs <= xMax`, else empty. */
function referenceStrict(
  payload: SpectrumDataPayload,
  xMin: number,
  xMax: number,
): { start: number; end: number } {
  let first = -1;
  let last = -1;
  for (let i = 0; i < payload.sampleCount; i += 1) {
    const abs = absoluteAt(payload, i);
    if (abs >= xMin && abs <= xMax) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) {
    // Empty: the resolver reports the insertion point, which is the first index with abs >= xMin
    // (or `n`) whenever the window is not inverted; callers must only rely on `start === end`.
    return { start: -1, end: -1 };
  }
  return { start: first, end: last + 1 };
}

function emptyInsertionPoint(payload: SpectrumDataPayload, xMin: number): number {
  let i = 0;
  while (i < payload.sampleCount && absoluteAt(payload, i) < xMin) i += 1;
  return i;
}

describe("resolveSampleWindow properties", () => {
  it("matches a linear-scan reference on non-decreasing X", () => {
    fc.assert(
      fc.property(sortedOffsets, origin, anyBound, anyBound, (offsets, xOrigin, xMin, xMax) => {
        const payload = buildPayload({ x: offsets, xOrigin });
        if (!isNonDecreasingAbsoluteX(payload)) return true;
        const out = createSampleSpan();
        resolveSampleWindow(payload, xMin, xMax, out);
        const expected = referenceStrict(payload, xMin, xMax);
        if (expected.start < 0) return out.start === out.end;
        return out.start === expected.start && out.end === expected.end;
      }),
    );
  });

  it("stays within [0, n] and terminates for any order of X", () => {
    fc.assert(
      fc.property(
        anyOrderOffsets,
        origin,
        anyBound,
        anyBound,
        fc.boolean(),
        (offsets, xOrigin, xMin, xMax, includeNeighbours) => {
          const payload = buildPayload({ x: offsets, xOrigin, capacity: offsets.length + 3, staleTail: 0 });
          const out = createSampleSpan();
          resolveSampleWindow(payload, xMin, xMax, out, { includeNeighbours });
          return 0 <= out.start && out.start <= out.end && out.end <= payload.sampleCount;
        },
      ),
    );
  });

  it("extends the strict span per the neighbour rules", () => {
    fc.assert(
      fc.property(
        sortedOffsets,
        origin,
        anyBound,
        anyBound,
        (offsets, xOrigin, xMin, xMax) => {
          const payload = buildPayload({ x: offsets, xOrigin });
          if (!isNonDecreasingAbsoluteX(payload)) return true;
          const n = payload.sampleCount;
          const strict: SampleSpan = createSampleSpan();
          const wide: SampleSpan = createSampleSpan();
          resolveSampleWindow(payload, xMin, xMax, strict);
          resolveSampleWindow(payload, xMin, xMax, wide, { includeNeighbours: true });
          if (strict.end > strict.start) {
            return wide.start === Math.max(0, strict.start - 1) && wide.end === Math.min(n, strict.end + 1);
          }
          // Strict empty: bracketed only for a real, non-inverted window strictly inside the data.
          const valid = xMin <= xMax;
          const insertion = emptyInsertionPoint(payload, xMin);
          if (valid && insertion > 0 && insertion < n) {
            return wide.start === insertion - 1 && wide.end === insertion + 1;
          }
          return wide.start === wide.end;
        },
      ),
    );
  });
});
