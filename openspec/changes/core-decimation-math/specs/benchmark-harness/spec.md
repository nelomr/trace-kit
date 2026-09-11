# Capability: benchmark-harness

> Change: `core-decimation-math`. Modified capability — base introduced and archived by
> `workspace-test-harness-bootstrap`; delta applies against
> `openspec/specs/benchmark-harness/spec.md`.

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

## ADDED Requirements

### Requirement: `--trace-deopt` Invocation Mode
The benchmark harness MUST support an invocation mode that runs its target under
`node --trace-deopt` and surfaces any reported deoptimization of the named target function as a
harness-level failure. This mode MUST NOT be required to run in CI: it is a pre-merge and
pre-release local check, consistent with this change's `bench` separation, and the harness's
obligation is to support the mode, not for any CI job to invoke it.

The fixture proving this mode MUST force a deoptimization via a **map transition**, not via a
polymorphic typed-array argument. A fixture called once with a `Float32Array` argument and once
with a `Float64Array` argument commonly yields a polymorphic inline cache under modern V8 and
often emits **no** `[deoptimizing …]` trace line, making it an unreliable sentinel in the one
place that must not be flaky. The fixture MUST instead: warm the target function on repeated
calls with an object shaped `{ a }`, then call it with an object shaped `{ a, b }`, triggering a
hidden-class (map) transition that V8 reliably deoptimizes against.

#### Scenario: The harness's trace-deopt mode fails on a map-transition-induced deopt
- **GIVEN**: a fixture function warmed on repeated calls with an object shaped `{ a }`, then
  called with an object shaped `{ a, b }`, to force a deoptimization via a map transition
- **WHEN**: the harness runs the fixture under its `--trace-deopt` mode
- **THEN**: the harness reports failure, naming the fixture function

#### Scenario: The trace-deopt mode is not invoked by CI
- **GIVEN**: the repository's `turbo.json` and CI workflow configuration
- **WHEN**: a reviewer inspects them for a step invoking the harness's `--trace-deopt` mode
- **THEN**: no such step exists; the mode is documented as a local pre-merge and pre-release
  check only
