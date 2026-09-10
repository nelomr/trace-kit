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

### Requirement: Retained / Transit Brand Distinction
The branded-buffer types MUST gain a `Retained` / `Transit` ownership-class brand, orthogonal to
the X/Y/index axis brand, so a function accepting `Transit<T>` rejects a `Retained<T>` value at
compile time.

#### Scenario: A Retained buffer does not satisfy a Transit-typed parameter
- **GIVEN**: a function `submitToPool(buf: Transit<Float32Array>): void`
- **WHEN**: a `Retained<Float32Array>` value is passed to it in a fixture
- **THEN**: `tsc --noEmit` reports a type error

### Requirement: Monotonic Revision Field
`SpectrumDataPayload` MUST carry a `revision: number` field that increments on every
authoritative mutation of the payload's buffer contents, and MUST NEVER decrease or reset for
the lifetime of the payload instance.

#### Scenario: Revision increments after a mutation
- **GIVEN**: a payload with `revision === 0`
- **WHEN**: the payload's authoritative buffers are updated through the core's mutation entry
  point (e.g. after a decimation result is copied in)
- **THEN**: `payload.revision === 1`, and a second mutation makes it `2`

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

### Requirement: Explicit Output Offset and Count on Decimation Functions
`minMaxEnvelope` and `lttb` MUST accept an explicit output offset and count parameter pair for
writing into a caller-supplied window of a larger preallocated output array, because `.subarray`
is banned by the allocation-free-hot-path ban list.

#### Scenario: minMaxEnvelope writes into a sub-window of a larger buffer
- **GIVEN**: a preallocated `Float32Array` of length `4096` and an intent to write bucket output
  starting at offset `1024` for `512` elements
- **WHEN**: `minMaxEnvelope(x, y, out, { outputOffset: 1024, outputCount: 512, ... })` runs
- **THEN**: only indices `[1024, 1536)` of `out` are written, and no `.subarray` call appears
  anywhere in the implementation (asserted by a source-level lint rule or grep-based CI check)

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
