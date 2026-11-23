# Capability: streaming-contract

> Changes: `core-transport-contract` (frozen types, invariants, and factories),
> `worker-streaming-transport` (live `O(new samples)` incremental ingest, Tier-1/2/3 domain
> invalidation, `NaN` gap poisoning via `count[s] = -1`, `xOrigin` offset-space alignment, and
> zero-allocation materialization into `Retained` `SpectrumDataPayload`).

## Requirements

### Requirement: `RawSampleRing` Is a Frozen Public Structural Contract
`@trace-kit/core` MUST export an interface `RawSampleRing` from
`packages/core/src/transport/streaming-contract.ts`, re-exported through the transport barrel,
with exactly the members frozen by design.md §D6: `readonly capacity: number`,
`readonly x: Retained<Float32Array>`, `readonly y: Retained<Float32Array>`,
`totalWritten: number`, and `writeIndex: number`. `capacity` and the two buffer fields MUST be
`readonly`; `totalWritten` and `writeIndex` MUST be mutable. `totalWritten` is the monotonic
count of samples ever written and MUST NOT be documented or typed as a wrapping counter;
`writeIndex` is defined as `totalWritten & (capacity - 1)`.

#### Scenario: The declared member set matches the frozen contract exactly
- **GIVEN**: a type fixture that assigns an object literal carrying exactly those five members,
  and separately a literal carrying those five members plus one extra member
- **WHEN**: the fixture is compiled with `tsc --noEmit` under `exactOptionalPropertyTypes` and
  excess-property checking
- **THEN**: the exact-five literal compiles with no diagnostic
- **AND**: the six-member literal is rejected as an excess property, and a literal omitting any
  one of the five is rejected as missing that property

#### Scenario: Readonly and mutable members are enforced in opposite directions
- **GIVEN**: a type fixture containing one `// @ts-expect-error` assignment to each of
  `capacity`, `x`, and `y` on a `RawSampleRing` value, and one plain assignment to each of
  `totalWritten` and `writeIndex`
- **WHEN**: the fixture is compiled with `tsc --noEmit`
- **THEN**: compilation succeeds with zero diagnostics, which requires each `@ts-expect-error` to
  have actually suppressed a real readonly-assignment error and each plain assignment to have
  produced none — an implementation that marked all five `readonly`, or none of them, fails on
  the unused-`@ts-expect-error` diagnostic or on the assignment errors respectively

### Requirement: The Ring Is Overwrite-Oldest Over a Power-of-Two Capacity
The contract MUST state normatively that `RawSampleRing` is **overwrite-oldest** and that
`capacity` is a power of two, so indexing is the mask `i & (capacity - 1)` with no modulo and no
branch (design.md §D6, "Overwrite-oldest, masked indexing"). The oldest sample sequence still
resident is `totalWritten - capacity`. A constructor or factory declared in this change MUST
reject a non-power-of-two `capacity`; it MUST NOT silently round the value.

#### Scenario: A non-power-of-two capacity is rejected rather than rounded
- **GIVEN**: the ring factory declared by this change, invoked with `capacity` values `1024`,
  `1000`, `1025`, and `0`
- **WHEN**: each invocation is executed
- **THEN**: `1024` is accepted and the constructed value reports `capacity === 1024`
- **AND**: `1000`, `1025`, and `0` each reject, and no rejected invocation returns a value whose
  `capacity` differs from the argument it was given — an implementation that rounded `1000` up to
  `1024` and returned successfully fails this scenario

#### Scenario: The masked-index identity is stated and holds at the wrap boundary
- **GIVEN**: a ring contract with `capacity === 1024` and `totalWritten` set to each of `0`,
  `1023`, `1024`, and `1_048_577`
- **WHEN**: `writeIndex` is derived from the contract's stated identity
  `totalWritten & (capacity - 1)`
- **THEN**: the derived values are exactly `0`, `1023`, `0`, and `1` respectively

#### Scenario: The source declares no modulo or branch in the index derivation
- **GIVEN**: a source-level gate over `packages/core/src/transport/streaming-contract.ts`
  searching the index-derivation expressions for the `%` operator, and a fixture file in the same
  gate invocation that contains a modulo-based index derivation
- **WHEN**: the gate runs over both
- **THEN**: the count of matches in `streaming-contract.ts` is exactly `0`
- **AND**: the count of matches in the fixture is greater than `0`, proving the gate is live

### Requirement: Ring Buffers Are `Retained` and Never Appear in a Transfer List
`RawSampleRing.x` and `RawSampleRing.y` MUST carry the `Retained` brand (design.md §D6: the ring
is "Retained, so it survives every responder failure and every context loss"; design.md §D5 and
the diagram at design.md:109 place the ring in the retained class). It MUST therefore be a
**compile-time** error to pass a ring buffer to the transfer-list builder, and the ring MUST NOT
share a backing store with any `Transit` buffer. This is the same retained-isolation rule stated
by `buffer-ownership-protocol` and `spectrum-data-payload`; this requirement binds the ring to it.

#### Scenario: A ring buffer cannot type-check into the transfer-list builder
- **GIVEN**: a type fixture that passes `ring.x` to the transfer-list builder under a
  `// @ts-expect-error`, and in the same fixture passes a genuine `Transit<Float32Array>` to the
  same builder with no suppression
- **WHEN**: the fixture is compiled with `tsc --noEmit`
- **THEN**: compilation succeeds with zero diagnostics — the `Transit` call proves the builder
  accepts a correctly branded argument, so the suppressed line proves the `Retained` rejection is
  a real brand error and not a signature that rejects everything

### Requirement: `BucketAccumulator` Is a Frozen Public Structural Contract
`@trace-kit/core` MUST export an interface `BucketAccumulator` with exactly the members frozen by
design.md §D6: `readonly bucketCount: number`, `readonly min: Retained<Float32Array>`,
`readonly max: Retained<Float32Array>`, `readonly count: Retained<Int32Array>`,
`bucketOrigin: number`, `domainMin: number`, `invBucketWidth: number`, `coveredFromSeq: number`,
and `revision: number`. `min`, `max`, and `count` MUST each be `bucketCount` elements long.
`count` MUST be an `Int32Array`, never a floating-point array. `bucketOrigin` is the circular
origin that makes an aligned pan a rotation rather than a rebuild; `coveredFromSeq` is the oldest
sample sequence represented, comparable against `ring.totalWritten - ring.capacity`.

#### Scenario: The declared member set matches the frozen contract exactly
- **GIVEN**: a type fixture asserting the exact key union of `BucketAccumulator` equals the
  nine-member union above, via a bidirectional conditional-type equality check
- **WHEN**: the fixture is compiled with `tsc --noEmit`
- **THEN**: the equality check resolves to `true` with zero diagnostics
- **AND**: a companion fixture asserting equality against the same union minus `coveredFromSeq`
  resolves to `false`, proving the check discriminates rather than always passing

#### Scenario: `count` is integer-typed and rejects a float array
- **GIVEN**: a type fixture assigning a `Retained<Int32Array>` to `count`, and under a
  `// @ts-expect-error` assigning a `Retained<Float32Array>` to `count`
- **WHEN**: the fixture is compiled with `tsc --noEmit`
- **THEN**: compilation succeeds with zero diagnostics, which requires the `Int32Array`
  assignment to be legal and the `Float32Array` assignment to be an actual type error

### Requirement: `count[s] === 0` Is the Sole Normative "No Data" Signal
`BucketAccumulator.count` MUST remain the sole normative emptiness and gap signal within the
frozen nine-member `BucketAccumulator` layout:
- `count[s] === 0` MUST mean **no data / empty bucket** (no sample fell into slot `s`, including
  buckets uncovered by history underrun).
- `count[s] < 0` (specifically `count[s] = -1`, sticky until the bucket is cleared on rotation or
  rebuilt) MUST mean **gap-poisoned bucket** (at least one `NaN` sample fell into slot `s`),
  honoring Change 5.7 `gap-sentinel-semantics` so no rendered segment ever bridges a source `NaN`.
- `count[s] > 0` MUST mean **populated finite bucket** holding valid `min[s]` and `max[s]`
  extrema.

Consumers MUST treat every bucket with `count[s] <= 0` as a **gap** and MUST NEVER interpolate,
extrapolate, carry forward, or fabricate values across it. No tenth field and no competing `NaN`
emptiness sentinel on `min`/`max` may be introduced; `min[s]`/`max[s]` carry no defined meaning
whenever `count[s] <= 0` and MUST NOT be read. `RawSampleRing.y` MUST still store every ingested
`NaN` faithfully so a subsequent Tier-2 zoom-in exposes the exact gap position at higher resolution.

#### Scenario: Ingesting a NaN sample poisons the bucket without bridging across the gap
- **GIVEN**: a `RawSampleRing` and `BucketAccumulator` covering `[0, 10)` with `bucketCount = 10`
- **WHEN**: samples `(0.2, 1.0)`, `(0.5, NaN)`, and `(0.8, 2.0)` are ingested into bucket `0`, and
  sample `(2.5, 4.0)` is ingested into bucket `2`
- **THEN**: bucket `0` has `count[s0] === -1` (gap-poisoned), bucket `1` has `count[s1] === 0`
  (empty), bucket `2` has `count[s2] === 1` with `min[s2] === 4.0` and `max[s2] === 4.0`, and
  `ring.y[1]` is `NaN`

#### Scenario: Zooming in via Tier-2 rebuild resolves a sub-bucket gap cleanly
- **GIVEN**: the ring above containing `(0.2, 1.0)`, `(0.5, NaN)`, `(0.8, 2.0)`
- **WHEN**: `rebuildDomain` runs over `[0, 1)` with `bucketCount = 10`
- **THEN**: bucket `2` (`[0.2, 0.3)`) has `count > 0` (`min = max = 1.0`), bucket `5`
  (`[0.5, 0.6)`) has `count === -1`, bucket `8` (`[0.8, 0.9)`) has `count > 0`
  (`min = max = 2.0`), and all untouched buckets have `count === 0`

#### Scenario: Frozen nine-member layout has no competing emptiness sentinel
- **GIVEN**: a type check on `keyof BucketAccumulator` and a source-level gate over
  `streaming-contract.ts`
- **WHEN**: compiled with `tsc --noEmit` and checked
- **THEN**: `BucketAccumulator` has exactly the nine frozen members, and `min`/`max` are never
  compared to `NaN` to detect emptiness

### Requirement: `partialHistory` Is Declared on the Tier Result, Not on the Accumulator
`partialHistory` MUST remain declared on `TierResult` (`Tier1Result`, `Tier2Result`, `Tier3Result`)
and MUST NOT be added to `BucketAccumulator`. Both `applyDomainChange` (Tier 1 / Tier 2 / Tier 3)
and `rebuildDomain` MUST compute and return `partialHistory` accurately at runtime:
- `partialHistory` MUST be `true` when the ring has overwritten samples (`ring.totalWritten >
  ring.capacity`) and the requested domain's lower bound (`domainMin`) reaches earlier than the
  oldest resident sample still in the ring (sequence `ring.totalWritten - ring.capacity`), leaving
  the uncovered span with `count[s] === 0`.
- `partialHistory` MUST be `false` when no history has been overwritten or when the oldest resident
  sample lies at or before the requested `domainMin`.

#### Scenario: History underrun sets partialHistory to true and leaves uncovered buckets at count 0
- **GIVEN**: a `RawSampleRing` of `capacity = 64` that has ingested `128` monotonically spaced
  samples at `x = 0..127` (so sequences `0..63` were overwritten and resident samples cover `64..127`)
- **WHEN**: `rebuildDomain` (or `applyDomainChange`) is requested for domain `[0, 128)`
- **THEN**: the returned result has `partialHistory === true`, every bucket covering `[0, 64)` has
  `count[s] === 0`, and buckets covering `[64, 128)` carry the exact resident min/max extrema

#### Scenario: In-history domain reports partialHistory as false
- **GIVEN**: the same ring with resident samples covering `64..127`
- **WHEN**: `rebuildDomain` is requested for domain `[64, 128)`
- **THEN**: the returned result has `partialHistory === false`

### Requirement: Tier-1/2/3 Domain-Change Invalidation Executes Incrementally
`@trace-kit/core` MUST implement all three domain-change invalidation tiers over `RawSampleRing`
and `BucketAccumulator` without allocating arrays or per-sample objects on the hot path:
- **Tier 1 (Aligned Pan via `applyDomainChange(accumulator, ring, request, stats?)` /
  `rotateBucketOrigin`)**: When `selectTier` selects tier `1` with signed integer shift `k`
  (`k !== 0`, `|k| < bucketCount`), the system MUST rotate `accumulator.bucketOrigin` into
  `[0, bucketCount)` in both positive and negative directions, adopt the requested `domainMin`
  verbatim, clear **only** the `|k|` newly exposed bucket slots (`count[s] = 0`), scan **only**
  resident ring samples falling within the newly exposed X span to populate those `|k|` buckets,
  increment `accumulator.revision` by `1`, update `coveredFromSeq`, and increment
  `stats.counters[StatCounter.DomainShifts]` by `1` when `stats` is provided. The resulting bucket
  contents MUST be exact-equal to a full Tier-2 rebuild over the same domain.
- **Tier 2 (Settled Zoom or Non-Aligned Pan via `rebuildDomain(accumulator, ring, domainMin,
  invBucketWidth, stats?)` / `applyDomainChange`)**: Clear all `bucketCount` slots in place
  (`count.fill(0)` into the same preallocated typed arrays), set `bucketOrigin = 0`, adopt the
  requested `domainMin` and `invBucketWidth`, fold every resident ring sample within the domain
  into its bucket, update `coveredFromSeq`, increment `accumulator.revision` by `1`, increment
  `stats.counters[StatCounter.DomainRebuilds]` by `1` when `stats` is provided, and report
  `partialHistory`.
- **Tier 3 (Continuous Gesture in Progress via `projectTier3(accumulator, requestedDomainMin,
  requestedInvBucketWidth, targetBucketCount, out: Tier3ProjectionTarget, ring?)` /
  `applyDomainChange`)**: MUST NOT mutate `accumulator.min`, `accumulator.max`, `accumulator.count`,
  `accumulator.bucketOrigin`, `accumulator.domainMin`, `accumulator.invBucketWidth`, or
  `accumulator.revision`. `projectTier3` MUST project the existing accumulator's buckets into the
  caller-provided preallocated `Tier3ProjectionTarget` (`min`, `max`, `count`) for the requested
  domain by merging or re-indexing existing buckets, preserving every gap (`count[s] <= 0`) and
  guaranteeing the bounding invariant `outMin <= y <= outMax` for every finite sample covered
  without fabricating, interpolating, or extrapolating any value.

#### Scenario: Tier-1 aligned pan matches a full Tier-2 rebuild bit-for-bit in both directions
- **GIVEN**: a `fast-check` property test generating random `RawSampleRing` histories (including
  wrap-around and `NaN` gaps), non-power-of-two `bucketCount`, and positive or negative aligned
  shifts `k` with `1 <= |k| < bucketCount`
- **WHEN**: one accumulator applies Tier-1 aligned pan via `applyDomainChange` and a twin
  accumulator runs a full `rebuildDomain` on the target domain
- **THEN**: for every logical bucket `b` in `[0, bucketCount)`, both accumulators produce identical
  `count`, and whenever `count > 0`, identical `min` and `max`

#### Scenario: Tier-2 rebuild reuses the exact preallocated typed arrays
- **GIVEN**: a `BucketAccumulator` whose `min`, `max`, and `count` array references are captured
  beforehand
- **WHEN**: `rebuildDomain` executes across multiple domain changes
- **THEN**: `accumulator.min`, `accumulator.max`, and `accumulator.count` remain strictly
  reference-identical (`===`) to the pre-rebuild instances, and `bucketOrigin === 0`

#### Scenario: Tier-3 projection never mutates the accumulator
- **GIVEN**: a populated `BucketAccumulator` at `revision === 3` with a snapshot of all its arrays
  and scalar fields
- **WHEN**: `projectTier3` evaluates at zoom factors `0.25x`, `1x`, `4x`, and `16x` and panned
  offsets
- **THEN**: every array element and every scalar field on `accumulator` (including `revision === 3`)
  is byte-for-byte unchanged

### Requirement: The Circular Bucket Wrap Is a Conditional Subtraction Over an Unconstrained `bucketCount`
The contract MUST state normatively that the accumulator's circular index is computed as a
conditional subtraction and never as a mask or a modulo:

```ts
let s = b + bucketOrigin;
if (s >= bucketCount) s -= bucketCount;
```

`bucketCount` MUST therefore be **unconstrained beyond being an integer in `[1, MAX_BUCKETS]`**:
this change MUST NOT introduce a power-of-two requirement, a rounding step, or a `bucketMask`
field on `BucketAccumulator`, whose member set stays exactly the nine members frozen above. The
contract MUST record why this differs from `RawSampleRing.capacity`, which *is* power-of-two and
masked: `bucketCount` is output resolution mapped to device pixels, so quantising it to the
256/512/1024 ladder would discard resolution the display can show, whereas `capacity` is an
internal history-depth detail no consumer observes.

#### Scenario: No mask, modulo, or power-of-two constraint governs `bucketCount`
- **GIVEN**: a source-level gate over `packages/core/src/transport/streaming-contract.ts`
  searching the bucket-index derivation for a `%` operator, for a `&` mask applied to a bucket
  index, and for any `bucketMask` identifier; plus a fixture in the same gate invocation
  containing one masked bucket-index derivation and one `bucketMask` declaration
- **WHEN**: the gate runs over both
- **THEN**: the count of matches in `streaming-contract.ts` is exactly `0`
- **AND**: the count of matches in the fixture is exactly `2`, proving the gate both fires and
  counts rather than reporting `0` for everything

#### Scenario: The accumulator factory accepts a non-power-of-two `bucketCount`
- **GIVEN**: the accumulator factory declared by this change, invoked with `bucketCount` values
  `1440`, `2`, `1`, and `8192`
- **WHEN**: each invocation is executed
- **THEN**: each is accepted and the constructed value reports `bucketCount` exactly equal to the
  argument it was given, with `min`, `max`, and `count` each exactly that many elements long — an
  implementation that rounded `1440` up to `2048` fails on both the reported value and the array
  lengths
- **AND**: in the same run, `bucketCount` values `0`, `-1`, `1.5`, and `MAX_BUCKETS + 1` are each
  rejected, so the acceptance above is a discrimination and not a factory that validates nothing

### Requirement: `bucketOrigin` Stays in `[0, bucketCount)` and a Violation Is Detectable
Because the wrap above is a **single** conditional subtraction, it can correct at most one
`bucketCount` of overshoot. The contract MUST state as an invariant that
`0 <= bucketOrigin < bucketCount` holds at every observable point, and MUST make a violation
**detectable rather than silently wrong**: an out-of-range `bucketOrigin` would index a
neighbouring bucket, corrupting data in a way `count[s] === 0` can never reveal. The accumulator
factory MUST reject an out-of-range `bucketOrigin`, and any declared rotation entry point MUST be
documented as normalising `bucketOrigin + k` into `[0, bucketCount)` in both directions rather
than assuming the result is already in range.

#### Scenario: The factory rejects an out-of-range origin and accepts every in-range one
- **GIVEN**: the accumulator factory with `bucketCount = 1440`, invoked with `bucketOrigin` values
  `0`, `1`, and `1439`, and separately with `1440`, `1441`, `-1`, and `1.5`
- **WHEN**: each invocation is executed
- **THEN**: `0`, `1`, and `1439` are each accepted and the constructed value reports that exact
  `bucketOrigin`
- **AND**: `1440`, `1441`, `-1`, and `1.5` are each rejected, so the boundary is at exactly
  `bucketCount` — an implementation validating only `bucketOrigin >= 0` accepts `1440` and fails,
  and one rejecting everything fails on the `1439` acceptance

#### Scenario: The rotation contract documents normalisation in both directions
- **GIVEN**: the doc comment on the declared rotation entry point
- **WHEN**: a documentation gate reads it
- **THEN**: it states the `0 <= bucketOrigin < bucketCount` invariant and states that a rotation
  by a negative `k` is normalised by addition just as a positive `k` is normalised by subtraction
- **AND**: the gate fails against a fixture comment that states only the invariant without the
  negative-`k` obligation, proving it checks the obligation and not merely the invariant's presence

### Requirement: The Tier-1 Alignment Predicate Is Exact, With No Epsilon and No Snapping
The contract MUST declare the tier-1 selection predicate as the exact conjunction frozen by
design.md §D6, evaluated against the accumulator's stored values: zoom identity by
`Object.is(requestedInvBucketWidth, accumulator.invBucketWidth)`; `shift =
(requestedDomainMin - accumulator.domainMin) * accumulator.invBucketWidth`; `Number.isFinite(shift)`;
`shift === Math.round(shift)` by **exact IEEE-754 equality**; `k !== 0`; and
`Math.abs(k) < bucketCount`. No epsilon, tolerance, or snapping step may appear in the predicate
or in the value it stores: a request that misses exact integrality falls to tier 2, which is
slower and always correct. The contract MUST state that tier 1 adopts the **requested**
`domainMin` verbatim, so each pan is re-tested against the newly stored value and drift cannot
accumulate unchecked.

#### Scenario: The predicate contains no tolerance constant
- **GIVEN**: a source-level gate over the tier-selection declaration searching for a floating-point
  tolerance constant, an `EPSILON` identifier, or a comparison of the form
  `Math.abs(... ) < <literal>` in the alignment path; plus a fixture in the same gate invocation
  containing exactly one epsilon-tolerant alignment comparison
- **WHEN**: the gate runs over both
- **THEN**: the count in `streaming-contract.ts` is exactly `0`
- **AND**: the count in the fixture is exactly `1`, proving the gate fires

#### Scenario: The predicate's declared conjuncts are exactly the six frozen ones
- **GIVEN**: the doc comment on the tier-selection signature, and a documentation gate enumerating
  the alignment conditions it states
- **WHEN**: the gate runs
- **THEN**: it finds exactly the six conjuncts above — zoom identity by `Object.is`, finiteness,
  exact integrality against `Math.round`, `k !== 0`, and `|k| < bucketCount`
- **AND**: the gate fails against a fixture comment omitting the `|k| < bucketCount` bound, proving
  it enumerates the conjuncts rather than matching the word "aligned"

#### Scenario: The `|k| < bucketCount` bound routes a whole-window shift to tier 2
- **GIVEN**: the declared tier-selection function invoked with `bucketCount = 1024`, zoom
  unchanged, and requested domains producing `shift` of exactly `1`, `1023`, `1024`, and `2048`
- **WHEN**: each selection is evaluated
- **THEN**: `1` and `1023` select tier 1 and report `k` of exactly `1` and `1023`
- **AND**: `1024` and `2048` select tier 2, so the bound is at exactly `bucketCount` rather than
  at some larger value or absent

### Requirement: `revision` Is a Bucket-Layout Generation, Never a Per-Sample Counter
`BucketAccumulator.revision` MUST start at `0`, MUST be monotonically non-decreasing, MUST never be
reset, and MUST increment by exactly `1` on a completed Tier-1 rotation and on a completed Tier-2
rebuild. It MUST NOT increment during `ingestSample`, `ingestBatch`, or Tier-3 `projectTier3`.

#### Scenario: Ingest and Tier-3 leave revision unchanged while Tier-1 and Tier-2 each bump by 1
- **GIVEN**: a fresh `BucketAccumulator` initialized at `revision === 0`
- **WHEN**: `1_000` samples are ingested via `ingestSample` and `ingestBatch`, then `projectTier3`
  runs, then one Tier-1 aligned pan runs, then one Tier-2 rebuild runs
- **THEN**: `revision` is `0` after ingest, `0` after `projectTier3`, `1` after the Tier-1 pan,
  and `2` after the Tier-2 rebuild

### Requirement: The Tier-3 2x Zoom Boundary Is a Documented Characteristic With No Gate
`BUCKET_OVERSAMPLE_DEFAULT = 2` MUST remain a default value and documented characteristic only,
never a gating comparison operand. At every zoom factor — including `0.1x`, `0.5x`, `1x`, `2x`,
`4x`, `8x`, and `16x` — `projectTier3` MUST satisfy the runtime bounding invariant: for every
finite sample `(x, y)` resident in the accumulator's covered buckets falling within a projected
output bucket's X span (and not gap-poisoned), the projected output satisfies `outMin <= y <=
outMax`, no value is fabricated for empty or gap buckets, and no comparison gates behavior on the
literal `2`.

#### Scenario: Tier-3 projection bounds every covered sample across 0.1x through 16x zoom
- **GIVEN**: a `fast-check` property test populating a `RawSampleRing` and `BucketAccumulator`
  across arbitrary finite spectra
- **WHEN**: `projectTier3` projects the accumulator across zoom factors `0.1`, `0.5`, `1`, `2`, `4`,
  `8`, and `16`
- **THEN**: every populated projected bucket encloses `[min, max]` of every underlying accumulator
  bucket overlapping it (`outMin <= y <= outMax` for all covered finite samples), and every
  uncovered or gap-poisoned bucket produces no fabricated finite value

### Requirement: `MAX_BUCKETS` and `BUCKET_OVERSAMPLE_DEFAULT` Are Exported Named Constants
The contract MUST export `MAX_BUCKETS = 8192` and `BUCKET_OVERSAMPLE_DEFAULT = 2` as named
constants, and MUST define the derivation
`bucketCount = max(1, min(floor(bucketOversample * floor(viewportWidthPx)), MAX_BUCKETS))`. The
cap MUST be documented as a memory bound — three arrays of `MAX_BUCKETS` elements is 96 KB — that
does not bind at any realistic viewport width, since the default oversample over a 3840 px
viewport asks for 7,680 buckets. `MAX_BUCKETS` being a power of two MUST NOT be stated or relied
upon as a constraint on `bucketCount`.

#### Scenario: The constants are exported with exactly those values
- **GIVEN**: the transport barrel's emitted `.d.ts` and the runtime exports
- **WHEN**: `MAX_BUCKETS` and `BUCKET_OVERSAMPLE_DEFAULT` are read
- **THEN**: they are exactly `8192` and `2`, asserted by exact equality

#### Scenario: The derivation clamps at both ends
- **GIVEN**: the declared derivation evaluated at `viewportWidthPx` of `0`, `1`, `1440`, `3840`,
  and `100_000`, with `bucketOversample = BUCKET_OVERSAMPLE_DEFAULT`
- **WHEN**: each `bucketCount` is computed
- **THEN**: the results are exactly `1`, `2`, `2880`, `7680`, and `8192`
- **AND**: the `3840` case is strictly below `MAX_BUCKETS` while the `100_000` case is exactly
  `MAX_BUCKETS`, so the cap is observed to bind in one case and not the other rather than being
  applied unconditionally

### Requirement: Allocation-Free Incremental Ingest
`@trace-kit/core` MUST provide working `ingestSample(ring, x, y, accumulator?)` and
`ingestBatch(ring, xs, ys, offset, count, accumulator?)` executing in `O(new samples)` time with
zero heap allocation on the hot path:
- Every ingested sample MUST be written to `ring.x[ring.writeIndex]` and `ring.y[ring.writeIndex]`,
  incrementing `ring.totalWritten` by `1` and updating
  `ring.writeIndex = ring.totalWritten & (ring.capacity - 1)` using masked indexing (never `%`).
- When an `accumulator` with `invBucketWidth > 0` is supplied, any sample whose `x` maps to logical
  bucket `b = Math.floor((x - accumulator.domainMin) * accumulator.invBucketWidth)` with
  `0 <= b < accumulator.bucketCount` MUST resolve its circular slot via conditional subtraction
  (`let s = b + accumulator.bucketOrigin; if (s >= accumulator.bucketCount) s -=
  accumulator.bucketCount;`) and update `min[s]`/`max[s]`/`count[s]` in place (or poison
  `count[s] = -1` if `y !== y`). Samples outside `[0, bucketCount)` MUST still be stored in `ring`
  and MUST NOT mutate any accumulator bucket.

#### Scenario: Ring wrap-around and incremental bucket updates match a fresh rebuild
- **GIVEN**: a `RawSampleRing` of `capacity = 256` and a `BucketAccumulator` over `[0, 256)`
- **WHEN**: `500` samples are ingested via `ingestSample` and `ingestBatch` (wrapping the ring),
  with samples both inside and outside the accumulator domain
- **THEN**: `ring.totalWritten === 500`, `ring.writeIndex === (500 & 255)`, out-of-domain samples
  did not mutate any bucket, and for in-domain samples ingested since the last overwrite,
  `accumulator` holds the exact min/max/count/gap state

#### Scenario: ingestBatch reports zero GC events under --expose-gc with a live allocating control
- **GIVEN**: a warmed-up `RawSampleRing` and `BucketAccumulator` ingesting `1_000` batches of
  `256` samples via `ingestBatch` under `--expose-gc --no-concurrent-recompilation`, paired in the
  same test run with an allocating control variant
- **WHEN**: `PerformanceObserver({ entryTypes: ['gc'] })` measures both windows
- **THEN**: `ingestBatch` records exactly `0` GC events while the allocating control records `> 0`

### Requirement: Ring and Accumulator Operate in xOrigin-Aligned Offset X Space
`RawSampleRing.x` (`Retained<Float32Array>`) MUST follow the same `xOrigin` offset convention as
`SpectrumDataPayload.x` (Change 7.5 `x-domain-space-reconciliation`): callers with high-offset
physical axes (e.g., optical wavelengths near `1550.123456 nm`) store `Float32` offsets relative to
a caller-owned `Float64` `xOrigin`, and `BucketAccumulator.domainMin` operates in that identical
ring X space (`absDomainMin - xOrigin`, which equals absolute space when `xOrigin === 0`). This
convention MUST be documented normatively in JSDoc on `RawSampleRing` and `BucketAccumulator`.

#### Scenario: High-offset optical wavelength stream preserves sub-picometer bucket resolution
- **GIVEN**: `xOrigin = 1550.0` (f64) and samples at absolute wavelengths `1550.000100 nm` through
  `1550.000900 nm` stored as f32 offsets (`0.0001`..`0.0009`) in `RawSampleRing.x` with
  `BucketAccumulator.domainMin = 0` and `invBucketWidth = 10_000`
- **WHEN**: the samples are ingested and materialized into a `SpectrumDataPayload` with
  `xOrigin = 1550.0`
- **THEN**: distinct samples `0.0001 nm` apart land in distinct buckets without collapsing to a
  single f32 quantization step, and the materialized payload carries `payload.xOrigin === 1550.0`

### Requirement: Zero-Allocation Materialization Into Retained SpectrumDataPayload
`@trace-kit/core` MUST export `materializeBucketsToPayload(accumulator, payload, ringXOrigin?)`
and `materializeTier3ToPayload(target, targetBucketCount, domainMin, invBucketWidth, payload,
ringXOrigin?)`, each writing directly into a caller-preallocated `Retained` `SpectrumDataPayload`
with zero heap allocation, committing the emitted sample count via `commitPayloadRevision`, and
returning the emitted sample count:
- Walking logical buckets `b = 0..bucketCount - 1` (resolving circular slot `s` via conditional
  subtraction wrap for `BucketAccumulator`), compute bucket center X
  `xCenter = domainMin + (b + 0.5) / invBucketWidth + ((ringXOrigin ?? payload.xOrigin) - payload.xOrigin)`.
- For each populated bucket (`count[s] > 0`), emit two vertices `(xCenter, min[s])` and
  `(xCenter, max[s])`.
- For each empty or gap-poisoned bucket (`count[s] <= 0`), emit one gap-break vertex
  `(xCenter, NaN)` so no renderer segment ever spans an empty or gap-poisoned bucket.
- The caller's `payload.capacity` MUST be validated at the boundary (throwing a `RangeError` if
  smaller than `bucketCount * 2`), and `payload.revision` MUST increment by `1` on completion.

#### Scenario: Materialization writes valid Retained payload consumable by Canvas2D and WebGL2
- **GIVEN**: a `BucketAccumulator` (and separately a `Tier3ProjectionTarget`) containing populated
  buckets, an empty bucket (`count === 0`), and a gap-poisoned bucket (`count === -1`), plus a
  preallocated `Retained` `SpectrumDataPayload`
- **WHEN**: `materializeBucketsToPayload` (and `materializeTier3ToPayload`) executes
- **THEN**: `payload.revision` increments by `1`, populated buckets emit exact `(xCenter, min)` /
  `(xCenter, max)` pairs, empty and gap-poisoned buckets emit `NaN` in `payload.y`, and passing
  `payload` to `Canvas2DRenderer` or `WebGL2FigureRenderer` renders without error and without
  bridging any gap

#### Scenario: Materialization reports zero GC events under --expose-gc
- **GIVEN**: a warmed-up `BucketAccumulator` and preallocated `SpectrumDataPayload` materialized
  `1_000` times under `--expose-gc --no-concurrent-recompilation`, paired with an allocating control
- **WHEN**: `PerformanceObserver({ entryTypes: ['gc'] })` measures both windows
- **THEN**: `materializeBucketsToPayload` records `0` GC events while the allocating control
  records `> 0`

### Requirement: Streaming Primitives Are Re-Exported From `@trace-kit/core`
`@trace-kit/core` (root `.` entry) MUST export `MAX_BUCKETS`, `BUCKET_OVERSAMPLE_DEFAULT`,
`computeBucketCount`, `createRawSampleRing`, `createBucketAccumulator`, `selectTier`,
`rotateBucketOrigin`, `ingestSample`, `ingestBatch`, `applyDomainChange`, `rebuildDomain`,
`projectTier3`, `materializeBucketsToPayload`, and `materializeTier3ToPayload` together with their
public interfaces (`RawSampleRing`, `BucketAccumulator`, `TierResult`, `Tier1Result`,
`Tier2Result`, `Tier3Result`, `TierSelectionRequest`, `Tier3ProjectionTarget`).

#### Scenario: Root entry exposes the full streaming API in ESM and CJS
- **GIVEN**: the built `@trace-kit/core` package
- **WHEN**: imported via ESM `import('@trace-kit/core')` and CJS `require('@trace-kit/core')`
- **THEN**: every listed streaming function and constant is defined and callable in both formats
