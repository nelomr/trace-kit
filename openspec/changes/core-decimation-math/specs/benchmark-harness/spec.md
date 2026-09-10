# Capability: benchmark-harness

> Change: `core-decimation-math`. Modified capability — base introduced by
> `workspace-test-harness-bootstrap` (not yet archived into `openspec/specs/`; delta applies
> against that change's `specs/benchmark-harness/spec.md`).

## MODIFIED Requirements

### Requirement: Warm-Up and Median-of-N Reporting
The benchmark harness MUST perform an explicit warm-up phase before any timed iteration, MUST
report a median across N measured iterations, MUST report p95 alongside the median, **and MUST
now be invoked with a real first consumer** (`minMaxEnvelope` and `lttb` from this change)
against a declared reference-hardware record checked into the repository.

#### Scenario: The harness produces a baseline record for minMaxEnvelope and lttb
- **GIVEN**: the benchmark harness's `bench-results.json` output format
- **WHEN**: the harness runs against `minMaxEnvelope` and `lttb`
- **THEN**: the output file contains an entry for each function with `median`, `p95`, and
  `iterations` fields, usable as this change's recorded baseline

### Requirement: `--trace-deopt` Invocation Mode
The benchmark harness MUST support an invocation mode that runs its target under
`node --trace-deopt` and surfaces any reported deoptimization of the named target function as a
harness-level failure.

#### Scenario: The harness's trace-deopt mode fails on an injected deopt
- **GIVEN**: a fixture function that is deliberately polymorphic (called once with a
  `Float32Array` argument and once with a `Float64Array` argument) to force a deoptimization
- **WHEN**: the harness runs the fixture under its `--trace-deopt` mode
- **THEN**: the harness reports failure, naming the fixture function
