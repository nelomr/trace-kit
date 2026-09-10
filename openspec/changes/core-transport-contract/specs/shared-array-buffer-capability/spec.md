# Capability: shared-array-buffer-capability

> Change: `core-transport-contract`. New capability. Encodes design.md §D7 and confirmed
> decision 4.

## ADDED Requirements

### Requirement: SharedArrayBuffer Is an Internal-Only Backing Enum
`SharedArrayBuffer` support MUST be represented internally as a `BufferBacking` enum
(`Transfer` | `Shared`) and MUST NOT appear anywhere in the public `DecimationPort` surface. The
public interface MUST be identical regardless of which backing is selected internally.

#### Scenario: The public DecimationPort type does not reference BufferBacking
- **GIVEN**: the `DecimationPort` interface declaration
- **WHEN**: a source-level check inspects its exported method signatures and properties
- **THEN**: no method or property is typed with `BufferBacking`, `SharedArrayBuffer`, or any
  shared-memory-specific type

### Requirement: No Feature May Require Cross-Origin Isolation
No TraceKit feature may be gated on `crossOriginIsolated`, `SharedArrayBuffer`, or COOP/COEP.
Every ownership invariant from `buffer-ownership-protocol` MUST pass with `SharedArrayBuffer`
absent from the global environment.

#### Scenario: The full ownership-invariant suite passes with SharedArrayBuffer deleted
- **GIVEN**: a test environment where `globalThis.SharedArrayBuffer` is deleted before the suite
  runs
- **WHEN**: the `buffer-ownership-protocol` test suite runs in this environment
- **THEN**: every test in that suite passes

#### Scenario: Detection is lazy and reporting-only for crossOriginIsolated
- **GIVEN**: `detectTransportCapabilities()` reads `crossOriginIsolated` inside its function body
- **WHEN**: the port is constructed and operated with `crossOriginIsolated === false`
- **THEN**: no operation is gated or degraded because of that value; it is exposed for reporting
  only
