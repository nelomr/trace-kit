// Type-only fixture (streaming-contract spec: frozen structural contracts, retained isolation,
// and the tier-discrimination surface). This file is never executed by Vitest; its only purpose
// is `tsc --noEmit`.
import type { Retained, TransitXBuffer } from "../../src/buffers/brand.js";
import { collectTransferList } from "../../src/transport/ownership.js";
import type {
  BucketAccumulator,
  RawSampleRing,
  Tier1Result,
  Tier3Result,
  TierResult,
} from "../../src/transport/streaming-contract.js";

// --- RawSampleRing: exact five-member structural contract ---------------------------------

declare const ring: RawSampleRing;

// Positive control: exactly the five frozen members compiles clean.
const exactRing: RawSampleRing = {
  capacity: 1024,
  x: ring.x,
  y: ring.y,
  totalWritten: 0,
  writeIndex: 0,
};
void exactRing;

const excessRing: RawSampleRing = {
  capacity: 1024,
  x: ring.x,
  y: ring.y,
  totalWritten: 0,
  writeIndex: 0,
  // @ts-expect-error — an extra member is rejected by excess-property checking on the literal.
  extra: true,
};
void excessRing;

// @ts-expect-error — omitting a required member is rejected.
const missingRing: RawSampleRing = {
  capacity: 1024,
  x: ring.x,
  y: ring.y,
  totalWritten: 0,
};
void missingRing;

// Readonly members reject assignment; mutable members accept it.
// @ts-expect-error — `capacity` is readonly.
ring.capacity = 2048;
// @ts-expect-error — `x` is readonly.
ring.x = ring.x;
// @ts-expect-error — `y` is readonly.
ring.y = ring.y;
ring.totalWritten = 5;
ring.writeIndex = 5;

// --- Ring buffers are Retained and never appear in a transfer list ------------------------

declare const transitX: TransitXBuffer;
const out: ArrayBufferLike[] = [];

// Positive control: a genuine Transit buffer type-checks cleanly against the builder.
collectTransferList([transitX], out);

// @ts-expect-error — `ring.x` carries the `Retained` brand, not `Transit`; it must not
// type-check into the transfer-list builder.
collectTransferList([ring.x], out);

// --- BucketAccumulator: exact nine-member structural contract ------------------------------

type BucketAccumulatorKeys = keyof BucketAccumulator;
type ExpectedBucketAccumulatorKeys =
  | "bucketCount"
  | "min"
  | "max"
  | "count"
  | "bucketOrigin"
  | "domainMin"
  | "invBucketWidth"
  | "coveredFromSeq"
  | "revision";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type ExactMatch = Equals<BucketAccumulatorKeys, ExpectedBucketAccumulatorKeys>;
type MissingOneMatch = Equals<
  BucketAccumulatorKeys,
  Exclude<ExpectedBucketAccumulatorKeys, "coveredFromSeq">
>;

// The exact key union equals the frozen nine-member union.
const exactMatch: ExactMatch = true;
void exactMatch;
// A union missing one member must NOT equal the real key set, proving the check discriminates.
const missingOneMatch: MissingOneMatch = false;
void missingOneMatch;

declare const accumulator: BucketAccumulator;

// `count` accepts a Retained<Int32Array> and rejects a Retained<Float32Array>.
declare const int32Count: Retained<Int32Array>;
declare const float32Count: Retained<Float32Array>;
const okCount: BucketAccumulator["count"] = int32Count;
void okCount;
// @ts-expect-error — `count` is typed `Retained<Int32Array>`, never a float array.
const badCount: BucketAccumulator["count"] = float32Count;
void badCount;
void accumulator;

// --- partialHistory lives on the tier result, never on BucketAccumulator -------------------

declare const tierResult: TierResult;
const flag: boolean = tierResult.partialHistory;
void flag;

// @ts-expect-error — `partialHistory` does not exist on `BucketAccumulator`.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the suppressed error above is exactly what's under test.
const notOnAccumulator = accumulator.partialHistory;
void notOnAccumulator;

// --- Tier result is a discriminated union with exactly three variants ----------------------

function assertNever(x: never): never {
  throw new Error(`unreachable tier: ${JSON.stringify(x)}`);
}

// Positive control: an exhaustive three-branch switch compiles clean.
function handleExhaustive(result: TierResult): number {
  switch (result.tier) {
    case 1:
      return result.k;
    case 2:
      return 0;
    case 3:
      return 0;
    default:
      return assertNever(result);
  }
}
void handleExhaustive;

// A two-branch switch leaves tier 3 unhandled, so `result` is not narrowed to `never` in the
// default branch — proving the exhaustiveness check above is live rather than trivially true.
function handleNonExhaustive(result: TierResult): number {
  switch (result.tier) {
    case 1:
      return result.k;
    case 2:
      return 0;
    default:
      // @ts-expect-error — tier 3 is unhandled, so `result` is `Tier3Result`, not `never`.
      return assertNever(result);
  }
}
void handleNonExhaustive;

// Tier 1 carries `k`; tier 3 does not.
declare const tier1: Tier1Result;
declare const tier3: Tier3Result;
const k: number = tier1.k;
void k;
// @ts-expect-error — `k` does not exist on the tier-3 variant.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the suppressed error above is exactly what's under test.
const noK = tier3.k;
void noK;
