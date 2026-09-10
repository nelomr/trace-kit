# Capability: spectrum-data-payload

> Change: `core-transport-contract`. Modified capability — base introduced (as new) by
> `core-decimation-math` in this same spec batch (not yet archived; delta applies against that
> change's `specs/spectrum-data-payload/spec.md`).
>
> Note: the substantive additions this design requires (`Retained`/`Transit` split, `revision`,
> `sampleCount`, index/revision pairing, explicit output offset+count) were absorbed directly
> into `core-decimation-math`'s ADDED spec per the orchestrator's explicit instruction, since
> that change's spec is being written in the same batch and should not ship the gap and then
> immediately break it. This file records the transport-facing modification that is
> specifically owned by this change: the GL-restore re-upload guarantee that depends on the
> ownership protocol existing.

## MODIFIED Requirements

### Requirement: SpectrumDataPayload Domain Model Owned by the Core
`@trace-kit/core` MUST define `SpectrumDataPayload` as the domain model wrapping the branded X
and Y buffers plus metadata, its buffers MUST be `Retained` and structurally incapable of
sharing a backing store with a `Transit` buffer, **and it MUST be the only object a renderer
reads, so that on `webglcontextrestored`, re-upload from the payload's buffers is unconditionally
valid** because those buffers are never transferred away by the transport protocol.

#### Scenario: A renderer never observes a detached payload buffer
- **GIVEN**: a `SpectrumDataPayload` whose buffers are consumed by a simulated GL-restore
  re-upload routine, concurrently with 100 transport round trips on unrelated transit slots
- **WHEN**: the re-upload routine reads `payload.x.byteLength` and `payload.y.byteLength` at any
  point during the round trips
- **THEN**: both are always equal to their original configured capacity, never `0`

#### Scenario: revision distinguishes "restore" from "new data" with an integer compare
- **GIVEN**: a payload at `revision === 5` immediately after a `webglcontextlost` event
- **WHEN**: `webglcontextrestored` fires with no intervening data update
- **THEN**: the observed `revision` is still `5`, and the restore path re-uploads from the
  existing buffers without re-running decimation
