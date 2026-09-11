# Capability: spectrum-data-payload

> Change: `core-decimation-math`. New capability.
>
> This capability's shape is jointly determined by this proposal and by
> `core-transport-contract/design.md` §"Required Changes to `SpectrumDataPayload`". Per the
> orchestrator's explicit instruction, this spec absorbs those six required items now rather than
> shipping them as a later breaking change. Item 7 of that design section (extending
> `allocation-free-hot-path` to the transport path) belongs to the `allocation-free-hot-path`
> capability, not here, and is intentionally **not** applied — see the Contradiction note at the
> end of this file.

## ADDED Requirements

### Requirement: SpectrumDataPayload Domain Model Owned by the Core
`@trace-kit/core` MUST define `SpectrumDataPayload` as the domain model wrapping the branded X
and Y buffers plus metadata. Downstream packages (`renderers`, `vue`, `react`) MUST consume it
structurally and MUST NOT construct or mutate it.

#### Scenario: A payload is constructed only via a core factory
- **GIVEN**: `@trace-kit/core` exports `createSpectrumDataPayload(...)`
- **WHEN**: a consumer test constructs a payload using only this factory
- **THEN**: the returned value satisfies the `SpectrumDataPayload` structural type and its X/Y
  buffers are branded buffers from the `branded-buffers` capability

### Requirement: Payload Buffers Are Retained, Never Transferable
Per `core-transport-contract` design §D5, a `SpectrumDataPayload`'s buffers are normatively
**Retained**. A payload MUST NEVER appear in any transfer list, and its buffers MUST NOT share a
backing `ArrayBuffer` with any `Transit`-branded buffer.

#### Scenario: A payload buffer is rejected by the transfer-list builder
- **GIVEN**: a `SpectrumDataPayload` with `Retained<Float32Array>` buffers
- **WHEN**: a fixture attempts to pass the payload's X buffer to a function typed to accept only
  `TransferableBacking` (`Transit<Float32Array> | Transit<Int32Array>`)
- **THEN**: `tsc --noEmit` reports a type error for the fixture

#### Scenario: Payload buffers never share a backing store with a transit buffer
- **GIVEN**: a payload's Y buffer and a pool's transit Y buffer, both constructed during a test
- **WHEN**: `payload.y.buffer === transitSlot.yTransit.buffer` is evaluated
- **THEN**: the result is `false`

> The `Retained` / `Transit` ownership-class brand distinction is defined in the
> `branded-buffers` capability, not here — see `specs/branded-buffers/spec.md`'s "Retained /
> Transit Ownership-Class Brand" requirement. This capability only states that this payload's
> buffers use the `Retained` side of that distinction (the requirement below).

### Requirement: Monotonic Revision Field, Mutated Only Through `commitPayloadRevision`
`SpectrumDataPayload` MUST carry a `revision: number` field that increments on every
authoritative mutation of the payload's buffer contents, and MUST NEVER decrease or reset for
the lifetime of the payload instance. The **only** authorized mutation entry point is an exported
`commitPayloadRevision(payload: MutableSpectrumDataPayload, sampleCount: number): void` function,
owned by `@trace-kit/core`. Calling it MUST: validate `sampleCount` against the payload's fixed
`capacity`; write the new `sampleCount`; recompute `xMin`, `xMax`, `yMin`, and `yMax` over the new
`[0, sampleCount)` prefix; and increment `revision` by exactly `1`. No other exported function or
field assignment MUST be able to change `revision`, `sampleCount`, or the four extent fields. The
mutable payload type accepted by `commitPayloadRevision` MUST NOT itself be part of the package's
public export surface, so a downstream consumer cannot obtain a handle it can write through
without deliberately re-declaring the interface.

#### Scenario: Revision increments after a mutation
- **GIVEN**: a payload with `revision === 0`
- **WHEN**: `commitPayloadRevision(payload, 600)` runs after a decimation result is copied into
  the payload's buffers
- **THEN**: `payload.revision === 1` and `payload.sampleCount === 600`, and a second call to
  `commitPayloadRevision` makes `revision === 2`

#### Scenario: commitPayloadRevision recomputes the extent fields
- **GIVEN**: a payload whose buffers have just been overwritten with new sample data
- **WHEN**: `commitPayloadRevision(payload, sampleCount)` runs
- **THEN**: `xMin`, `xMax`, `yMin`, and `yMax` reflect the new `[0, sampleCount)` prefix, not the
  previous revision's data

#### Scenario: The mutable payload type is not part of the public export surface
- **GIVEN**: the package entry point `packages/core/src/index.ts`
- **WHEN**: its exports are enumerated
- **THEN**: no exported binding exposes the mutable payload type, only `commitPayloadRevision`
  itself and the readonly `SpectrumDataPayload` type

### Requirement: X-Axis Precision via an f64 Origin With f32 Offsets
`SpectrumDataPayload` MUST NOT store absolute X values in an f32 buffer. An absolute
hardware-domain X value (e.g. an optical wavelength such as `1550.123456` nm) MUST be
representable at full instrument resolution, and `Float32Array`'s ~7 significant decimal digits
quantize such a value below that resolution. The payload MUST therefore carry a single f64
`xOrigin: number` field, fixed for the payload's lifetime, and its `x` buffer MUST hold **offsets
from `xOrigin`** — not absolute X — in a branded `Float32Array`. A consumer reconstructing an
absolute X value MUST compute `xOrigin + x[i]`, never read `x[i]` alone as an absolute value.

#### Scenario: A fine-resolution absolute X value survives origin/offset round-trip
- **GIVEN**: a payload constructed with `xOrigin = 1550.0` and an absolute sweep value of
  `1550.123456` nm
- **WHEN**: the value is stored as an offset (`1550.123456 - 1550.0`) in the payload's `x`
  buffer and later reconstructed as `xOrigin + x[i]`
- **THEN**: the reconstructed value equals `1550.123456` to instrument resolution (within f32
  offset precision applied to the small offset, not to the full absolute magnitude), whereas
  storing `1550.123456` directly in an f32 buffer measurably loses precision below that
  resolution

#### Scenario: xOrigin is f64 and fixed for the payload's lifetime
- **GIVEN**: a constructed `SpectrumDataPayload`
- **WHEN**: `payload.xOrigin` is read at construction and again after a subsequent
  `commitPayloadRevision` call
- **THEN**: `payload.xOrigin` is typed as `number` (f64), and its value is unchanged by
  `commitPayloadRevision`

#### Scenario: The x buffer is documented and typed as offsets, not absolute X
- **GIVEN**: the committed `SpectrumDataPayload` interface
- **WHEN**: its `x` field and JSDoc are inspected
- **THEN**: the field is documented as holding X offsets from `xOrigin`, and no requirement or
  scenario in this capability treats `x[i]` as an absolute X value on its own

### Requirement: sampleCount Distinct From Buffer Capacity
`SpectrumDataPayload` MUST carry a `sampleCount: number` field naming the length of the valid
data prefix, distinct from the underlying buffer's fixed capacity. Consumers MUST read only the
first `sampleCount` elements as real samples.

#### Scenario: A partially filled preallocated buffer reports the correct sample count
- **GIVEN**: a payload whose X/Y buffers have capacity `1024` but only `600` samples have been
  written
- **WHEN**: `payload.sampleCount` is read
- **THEN**: it equals `600`, while `payload.x.length === 1024`

### Requirement: LTTB Indices Valid Only Against Their Producing Revision
An `Int32Array` of LTTB-selected indices MUST be documented and typed as valid only against the
`revision` of the payload that produced it. A consumer MUST NOT reuse indices from an older
revision against current buffer contents.

#### Scenario: Index/revision pairing is part of the returned result shape
- **GIVEN**: `lttb` is invoked against a payload at `revision === 3`
- **WHEN**: the result is inspected
- **THEN**: the result carries (or is documented and typed to be used alongside) the producing
  `revision` value `3`, and the package's type-level or JSDoc contract states indices from
  revision `3` MUST NOT be applied to a payload at any other revision

### Requirement: Explicit Output Offset on Decimation Functions
`minMaxEnvelope` and `lttb` MUST accept an explicit `outputOffset` positional parameter (never an
options object) for writing into a caller-supplied window of a larger preallocated output array,
because `.subarray` is banned by the `allocation-free-hot-path` ban list. Neither function
accepts a separate `outputCount` input parameter: the write length is always a **derived value**,
not an independent input, because it would otherwise duplicate information the function already
receives and could disagree with it. For `minMaxEnvelope` the write length is `bucketCount * 2`;
for `lttb` it is `threshold`. Both functions return that derived count as their result, so a
caller advancing a cursor through a larger buffer uses the return value rather than
recomputing or independently supplying it. This requirement's call shapes MUST match the single
signature each function's own capability spec (`decimation-min-max`, `decimation-lttb`) states;
this file does not restate or vary either signature.

#### Scenario: minMaxEnvelope writes into a sub-window of a larger buffer
- **GIVEN**: a preallocated `Float32Array` of length `4096` and an intent to write bucket output
  starting at offset `1024` for a `bucketCount` of `256` (256 * 2 = 512 elements)
- **WHEN**: `minMaxEnvelope(y, sourceOffset, sampleCount, out, 1024, 256)` runs
- **THEN**: only indices `[1024, 1536)` of `out` are written, the function returns `512`, and no
  `.subarray` call appears anywhere in the implementation (asserted by a source-level lint rule
  or grep-based CI check)

#### Scenario: lttb writes into a sub-window of a larger buffer
- **GIVEN**: a preallocated `Int32Array` of length `256` and an intent to write `64` indices
  starting at offset `128`
- **WHEN**: `lttb(x, y, sourceOffset, sampleCount, out, 128, 64)` runs
- **THEN**: only indices `[128, 192)` of `out` are written, the function returns `64`, and no
  `.subarray` call appears anywhere in the implementation

#### Scenario: Neither function accepts an independent outputCount parameter
- **GIVEN**: the committed signatures of `minMaxEnvelope` and `lttb`
- **WHEN**: their parameter lists are inspected
- **THEN**: neither declares an `outputCount` parameter; the write length is derived from
  `bucketCount` (times 2) or `threshold` respectively, and returned by the function

## Contradiction Found (must not be silently resolved)

`core-transport-contract/design.md` item 7 asks this capability's sibling
(`allocation-free-hot-path`) to be extended so the transfer round trip is "`O(1)`-allocation
rather than zero." Claim **C1b** (the `transfer-roundtrip-probe.mjs` measurement cited in the
design's own §Context, and independently confirmed by the orchestrator) refutes the premise
behind that request: the design's own measured data shows **zero GC events** across 3,600
round trips and across a 64x range of payload size (4,096 to 262,144 samples). The design
document itself states, in the same section, "the gate stays strict... it keeps zero." The
`allocation-free-hot-path` spec in this change folder therefore does **not** weaken the
zero-allocation gate, and this file records the contradiction rather than silently picking a
side: design.md's normative narrative text (§Context item 2) already agrees with the refutation,
but its numbered "Required Changes" list item 7 still asks for the weakening. This spec follows
the evidence and the design's own resolved narrative, not item 7's literal ask.

---

## Contradiction Resolution (closed upstream)

The contradiction recorded above has been **resolved at the source**, after this spec was
written. `core-transport-contract/design.md` item 7 no longer asks for the weakening: it now
reads that the gate stays at zero, states explicitly that the earlier "`O(1)` per round trip
instead of zero" wording is **withdrawn and must not be applied**, and notes that it contradicted
the same document's §Context item 2. The `§D8` line that framed the gate as "not about scavenges"
was corrected in the same pass.

The design and this spec are therefore now in agreement, and the position this spec took —
following claim **C1b** and holding the gate at zero — is the design's own position. The note is
retained as an audit record of how the discrepancy was found and settled, not as an open issue.
No requirement or scenario in this file changes as a result.
