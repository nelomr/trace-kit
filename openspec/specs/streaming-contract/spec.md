# Capability: streaming-contract

> Change: `core-transport-contract`. New capability. Encodes design.md §D6 — the frozen data
> structures and invalidation policy for incremental streaming decimation, plus the file
> manifest's constraint on `packages/core/src/transport/streaming-contract.ts`: *types and
> invariants frozen here, implementation in change 8*.
>
> §D6 opens by correcting the proposal: the incremental decimation **implementation** is deferred
> to change 8 (`worker-streaming-transport`), but its **contract cannot be**, because the
> retained/transit split (§D5) and the transit pool capacity (§D2) are both derived from the fact
> that only a delta travels. This capability freezes that contract and nothing more. It is the
> same boundary the proposal's non-goal states; this delta does not move it.
>
> Consequently every requirement below is asserted **statically** — by a type fixture compiled
> under `tsc --noEmit`, or by a source-level gate over `streaming-contract.ts` — because no
> runtime ingest, rotation, or rebuild behaviour exists in this change to observe. Each gate that
> asserts an absence is paired with a fixture in the same run that drives the same gate to a
> non-zero result, per the control pattern established by `ownership-prototype-gate` P3/P10.

## ADDED Requirements

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
The contract MUST state normatively that a bucket with `count[s] === 0` carries **no data**, and
that such a bucket MUST NEVER be populated with an interpolated, extrapolated, carried-forward, or
otherwise fabricated value. Consumers MUST treat `count[s] === 0` as a **gap** and MUST NOT draw a
connecting segment across it. This is why `count` is part of the frozen contract rather than an
implementation detail (design.md §D6, "History underrun"), and it is the direct mitigation for the
design's risk entry "History underrun silently rendering as interpolated data". No other field,
sentinel value, or `NaN` convention may be introduced as an alternative no-data signal; in
particular `min[s]`/`max[s]` for an empty bucket carry no defined meaning and MUST NOT be read.

#### Scenario: The contract exposes no competing no-data sentinel
- **GIVEN**: a source-level gate over `streaming-contract.ts` looking for any declared sentinel
  constant or `NaN`-based emptiness convention on `min` or `max`, plus a fixture in the same gate
  invocation that declares such a sentinel
- **WHEN**: the gate runs over both
- **THEN**: the count of matches in `streaming-contract.ts` is exactly `0`
- **AND**: the count of matches in the fixture is greater than `0`, proving the gate is live

#### Scenario: The gap rule is stated as a consumer obligation in the published type documentation
- **GIVEN**: the doc comment attached to `BucketAccumulator.count` in `streaming-contract.ts`, and
  the emitted `.d.ts` for the transport barrel
- **WHEN**: a documentation gate reads both
- **THEN**: both state that `0` means no data and that an empty bucket renders as a gap and is
  never interpolated
- **AND**: the gate fails when run against a fixture whose doc comment describes `count` only as a
  sample tally, proving it checks the obligation and not merely the presence of a comment

### Requirement: `partialHistory` Is Declared on the Tier Result, Not on the Accumulator
The contract MUST declare a `partialHistory` boolean carrying: the requested domain reaches
earlier than `ring.totalWritten - ring.capacity`, so the ring no longer holds the samples for part
of the requested span. When it is `true`, the uncovered buckets are left with `count === 0` and
are therefore gaps under the requirement above; it MUST NOT be interpreted as a general error, a
failure of the accumulator, or a reason to substitute values. `partialHistory` MUST be a distinct
signal from `count[s] === 0`: the flag says *why* a span is empty, the counts say *which* buckets
are.

`partialHistory` MUST be declared on the **tier result**, and MUST NOT be a member of
`BucketAccumulator`, whose member set is frozen at exactly the nine members above (design.md §D6,
"`partialHistory` lives on the tier result, not on `BucketAccumulator`"). Coverage is a property
of a rebuild evaluated against a requested domain, not a standing property of the accumulator; the
accumulator's own coverage is `coveredFromSeq`, and a second derived copy alongside it could
disagree with it.

#### Scenario: The flag is boolean, on the tier result, and documented against the underrun condition
- **GIVEN**: a type fixture reading `partialHistory` from a tier result into a `boolean`-typed
  binding, a second fixture reading `partialHistory` from a `BucketAccumulator` value under a
  `// @ts-expect-error`, and the doc comment attached to the declaration
- **WHEN**: both fixtures are compiled with `tsc --noEmit` and a documentation gate reads the
  comment
- **THEN**: compilation succeeds with zero diagnostics, which requires the tier-result read to be
  legal and the accumulator read to be an actual "property does not exist" error — an
  implementation that added `partialHistory` as a tenth accumulator member fails on the unused
  `@ts-expect-error`
- **AND**: the comment states the `totalWritten - capacity` underrun condition and states that
  uncovered buckets are left at `count === 0` rather than filled

#### Scenario: The flag does not substitute for the per-bucket signal
- **GIVEN**: a type fixture attempting to determine bucket emptiness from `partialHistory` alone,
  against the contract's declared tier-selection and coverage signatures
- **WHEN**: the fixture is compiled with `tsc --noEmit`
- **THEN**: no declared function in `streaming-contract.ts` returns per-bucket emptiness derived
  from `partialHistory`, and per-bucket emptiness is reachable only through `count`

### Requirement: Tier-1/2/3 Invalidation Is Frozen as a Signature Surface Only
The contract MUST declare the three-tier domain-change invalidation policy of design.md §D6 as a
**typed selection surface**: a discriminated tier result covering tier 1 (aligned pan — zoom
unchanged and the new `domainMin` differs by an exact integer multiple `k` of the bucket width;
carries `k`), tier 2 (zoom change or non-aligned pan with the gesture settled — full rebuild into
the same preallocated arrays), and tier 3 (continuous gesture in progress — render from the
existing accumulator, no rebuild). The tier-**selection** function signature MUST be declared. The
rebuild **bodies** MUST NOT be implemented in this change. The contract MUST additionally state
the fidelity guarantee §D6 makes: a merged or re-indexed min/max bucket still bounds every sample
it contains, so tier 3 degrades *resolution*, never *correctness*, and fabricates no value.

#### Scenario: The tier result is a discriminated union with exactly three variants
- **GIVEN**: a type fixture exhaustively switching on the tier discriminant with no `default`
  branch and a `never`-typed exhaustiveness check, plus a companion fixture handling only two of
  the variants
- **WHEN**: both are compiled with `tsc --noEmit`
- **THEN**: the three-branch fixture compiles with zero diagnostics
- **AND**: the two-branch fixture fails the `never` assignment, proving the exhaustiveness check
  is live rather than trivially satisfied

#### Scenario: Tier 1 carries the integer shift and tier 3 carries no rebuild output
- **GIVEN**: a type fixture reading `k` from the tier-1 variant into a `number` binding, and under
  a `// @ts-expect-error` reading `k` from the tier-3 variant
- **WHEN**: the fixture is compiled with `tsc --noEmit`
- **THEN**: compilation succeeds with zero diagnostics, which requires `k` to exist on tier 1 and
  to be absent from tier 3

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
The contract MUST define `BucketAccumulator.revision` normatively as a **bucket-layout
generation**: it starts at `0`, is monotonically non-decreasing, is never reset, and increments by
exactly `1` when and only when the mapping from bucket index to domain changes — on a completed
tier-1 rotation and on a completed tier-2 rebuild. It MUST NOT increment on ingest and MUST NOT
increment on tier 3, which mutates nothing. The contract MUST record the reason (design.md §D6,
§D5): `revision` exists for dirty-checking and GL-restore re-upload detection by integer compare,
and a counter that moves per ingested sample answers "is anything different?" with "yes" on every
read, making the compare worthless; content freshness is carried at the right granularity by
`SpectrumDataPayload.revision`.

#### Scenario: The declared policy names the two bumping events and excludes ingest and tier 3
- **GIVEN**: the doc comment on `BucketAccumulator.revision` and the emitted `.d.ts` for the
  transport barrel
- **WHEN**: a documentation gate reads both
- **THEN**: both state that `revision` increments by exactly `1` on a completed tier-1 rotation and
  on a completed tier-2 rebuild, and that it does not increment on ingest or on tier 3
- **AND**: the gate fails against a fixture comment stating only that `revision` is monotonic,
  proving it checks the increment policy rather than the word "monotonic"

#### Scenario: The deferred entry points leave `revision` untouched
- **GIVEN**: the declared ingest entry point and the declared tier-3 evaluation entry point,
  each invoked once with otherwise valid arguments on an accumulator at `revision === 7`
- **WHEN**: each invocation throws its deferred-to-change-8 error and `revision` is read
- **THEN**: `revision` is still exactly `7` after each
- **AND**: in the same run, an accumulator whose `revision` is incremented directly reads back
  exactly `8`, so the unchanged reading above comes from a field that is observably writable

### Requirement: The Tier-3 2x Zoom Boundary Is a Documented Characteristic With No Gate
The contract MUST state that the `bucketOversample` boundary (default `2`) marks a **continuous**
degradation in resolution and carries **no pass/fail gate**, and MUST state why: nothing changes
state at the boundary for an assertion to anchor on, so a threshold there would be a gate on a
continuous quantity of exactly the kind confirmed decision 3 rules out, and the only alternative
observable — perceived blockiness — has no deterministic work-count expression. The literal `2`
MUST appear only as a default value and in documentation, never in a gating comparison.

What the contract MUST assert instead is the bounding property the design's Risks table already
takes as its position: a merged or re-indexed min/max bucket still bounds every sample it
contains (`min <= y <= max` for every sample in the bucket's span, at every zoom factor including
well beyond 2x), no value is interpolated, extrapolated, or fabricated, and the gesture-end tier-2
rebuild is **mandatory rather than best-effort**. Because no tier-3 body ships in this change, the
bounding property is frozen as documented normative text binding change 8 and MUST NOT be claimed
as measured here.

#### Scenario: `bucketOversample` appears as a default and never as a gating comparison
- **GIVEN**: a source-level gate over `streaming-contract.ts` classifying every occurrence of
  `bucketOversample` and of `BUCKET_OVERSAMPLE_DEFAULT` as either a default-value initialiser or a
  comparison operand, plus a fixture in the same gate invocation containing exactly one comparison
  operand use
- **WHEN**: the gate runs over both
- **THEN**: the count of comparison-operand uses in `streaming-contract.ts` is exactly `0` while
  the count of default-value uses is greater than `0`, so the zero is read from a classifier that
  found the identifier at all
- **AND**: the count of comparison-operand uses in the fixture is exactly `1`, proving the
  classifier distinguishes the two uses

#### Scenario: The fidelity text states bounding, mandatory rebuild, and the absence of a gate
- **GIVEN**: the tier-3 doc comment and this change's verification report
- **WHEN**: a documentation gate reads both
- **THEN**: the comment states that a merged or re-indexed bucket bounds every sample it contains,
  that no value is interpolated or fabricated, that the gesture-end tier-2 rebuild is mandatory,
  and that the 2x boundary carries no gate
- **AND**: neither the comment nor the verification report claims a measured tier-3 fidelity result
  for this change, and the gate fails against a fixture report that does claim one

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

### Requirement: This Change Freezes Types and Invariants Only and Ships No Working Rebuild
Per the design.md file manifest entry for `packages/core/src/transport/streaming-contract.ts`
("types and invariants frozen here, implementation in change 8") and the proposal's non-goal
deferring incremental `O(new samples)` streaming decimation to change 8, this change MUST NOT
ship a working ingest loop, a working `bucketOrigin` rotation, or a working tier-1/2/3 rebuild.
`streaming-contract.ts` MUST contain type declarations, documented invariants, constants, the
argument-validating ring and accumulator factories required above, and function **signatures**.
Those factories DO allocate their backing arrays and return a fully-formed, zero-filled value —
construction is not a hot path and a factory that allocated nothing could not validate array
lengths — but they MUST perform no ingest, no rotation, and no rebuild. any declared
rebuild or ingest entry point MUST be unimplemented in a way that fails loudly if called, never a
silent no-op that a consumer could mistake for a completed rebuild.

#### Scenario: No declared rebuild or ingest entry point has a working body
- **GIVEN**: each rebuild and ingest entry point declared by `streaming-contract.ts`, invoked
  once with otherwise valid arguments
- **WHEN**: each invocation is executed
- **THEN**: each throws a deferred-to-change-8 error
- **AND**: the accumulator's `min`, `max`, `count`, `bucketOrigin`, and `revision` are byte-for-
  byte and value-for-value unchanged after each invocation, so no partial work was performed

#### Scenario: The module writes to no accumulator or ring buffer
- **GIVEN**: a source-level gate over `streaming-contract.ts` counting indexed writes and `fill`
  calls against `min`, `max`, `count`, `x`, and `y`, plus a fixture in the same gate invocation
  containing exactly three such writes
- **WHEN**: the gate runs over both
- **THEN**: the count in `streaming-contract.ts` is exactly `0`
- **AND**: the count in the fixture is exactly `3`, proving the gate both fires and counts
  correctly rather than reporting `0` for everything

### Requirement: Allocation-Free Ingest Is a Frozen Invariant on Change 8, Structurally Guarded Here
Design.md §D6 states that ingest is `O(new samples)` **with no allocation** — per new sample two
compares, one store-if, one increment, and no object, closure, or array. Because no ingest body
ships in this change, that invariant MUST be frozen as documented normative text binding the
change-8 implementation, and MUST NOT be claimed as measured in this change: a GC-event or
allocation-counter gate run against an entry point that throws measures nothing. What this change
MUST assert is structural — `streaming-contract.ts` contains no construct from the
`allocation-free-hot-path` banned list (object literals, array literals, spreads, closures
allocated per call, and `.subarray`) in any hot-path declaration — and tier 2's rebuild is frozen
as writing into the **same preallocated arrays** via `fill` and an indexed loop, never into newly
allocated ones.

#### Scenario: The banned-construct gate reports zero over the module and is proven live
- **GIVEN**: the `allocation-free-hot-path` banned-construct gate extended to cover
  `packages/core/src/transport/streaming-contract.ts`, plus the gate's existing live-proof fixture
  containing banned constructs
- **WHEN**: the gate runs over both in the same invocation
- **THEN**: the violation count for `streaming-contract.ts` is exactly `0`
- **AND**: the violation count for the fixture is greater than `0`

#### Scenario: The invariant is recorded as change 8's obligation, not as a measurement taken here
- **GIVEN**: the doc comment on the declared ingest entry point and this change's verification
  report
- **WHEN**: a documentation gate reads both
- **THEN**: the comment states the per-sample cost and the no-allocation obligation as binding on
  the implementing change
- **AND**: neither the comment nor the verification report claims a measured allocation or
  GC-event result for ingest in this change
