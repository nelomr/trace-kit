// Type-only fixture (`selectable-decimation`'s "DecimationSelection Makes an Invalid
// Algorithm/Parameter Pairing Unrepresentable"). Never executed by Vitest; its only purpose is
// to be type-checked by `tsc --noEmit`.
import type { DecimationSelection } from "../../src/decimation/selection.js";

// @ts-expect-error — `lttb` selections carry `threshold`, not `bucketCount`.
const s1: DecimationSelection = { algorithm: "lttb", bucketCount: 10 };
void s1;

// @ts-expect-error — `min-max` selections carry `bucketCount`, not `threshold`.
const s2: DecimationSelection = { algorithm: "min-max", threshold: 10 };
void s2;

// The exclusion holds for a non-literal value too, not only object-literal excess-property
// checking: a value whose static type already carries an optional `bucketCount` alongside
// `algorithm: "lttb"` must not satisfy `DecimationSelection`.
declare function widen(value: { algorithm: "lttb"; bucketCount?: number }): DecimationSelection;
function accepts(value: { algorithm: "lttb"; bucketCount?: number }): DecimationSelection {
  // @ts-expect-error — a wider shape with both fields present is not assignable, even though it
  // shares `algorithm: "lttb"` with `LttbSelection`.
  return value;
}
void widen;
void accepts;
