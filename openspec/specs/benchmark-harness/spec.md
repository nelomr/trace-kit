# Capability: benchmark-harness

> Change: `workspace-test-harness-bootstrap`. New capability.

## ADDED Requirements

### Requirement: Warm-Up and Median-of-N Reporting
The benchmark harness MUST perform an explicit warm-up phase before any timed iteration, MUST
report a median across N measured iterations, MUST report p95 alongside the median, **and MUST
now be invoked with a real first consumer** (`minMaxEnvelope` and `lttb` from this change)
against a declared reference-hardware record checked into the repository.
Per claim **C4b**, a cold first invocation of a numeric pass runs interpreted before TurboFan
tiering and can be 3-5x slower than the warm steady state, so a harness that reports a single
cold sample is a defect.

#### Scenario: The harness discards cold samples from its reported result
- **GIVEN**: a benchmark function that is deliberately 4x slower on its first call than on
  subsequent calls (simulating pre-JIT-tiering cost)
- **WHEN**: the benchmark harness runs the function with a configured warm-up count greater
  than zero and N measured iterations
- **THEN**: the reported median is within the steady-state range and is not inflated by the
  cold first-call sample

#### Scenario: The harness reports both median and p95
- **GIVEN**: a benchmark run of N >= 30 iterations
- **WHEN**: the harness completes and writes its result
- **THEN**: the machine-readable result file contains both a `median` field and a `p95` field,
  each a finite number

#### Scenario: The harness produces a baseline record for minMaxEnvelope and lttb
- **GIVEN**: the benchmark harness's `bench-results.json` output format
- **WHEN**: the harness runs against `minMaxEnvelope` and `lttb`
- **THEN**: the output file contains an entry for each function with `median`, `p95`, and
  `iterations` fields, usable as this change's recorded baseline

### Requirement: Machine-Readable Result Format
The harness MUST write its results to a machine-readable file (JSON) so that later changes can
compute a relative regression budget against a baseline recorded on the same runner.

#### Scenario: A later change can read the baseline
- **GIVEN**: the benchmark harness has run once and written `bench-results.json`
- **WHEN**: a downstream benchmark script reads `bench-results.json`
- **THEN**: the file parses as valid JSON containing, for each named benchmark, at least
  `median`, `p95`, and `iterations` fields

### Requirement: Isolated From CI Coverage and Shared Runners
The benchmark harness MUST run via its own dedicated script, MUST NOT run inside the coverage
job (instrumentation distorts timing, per exploration §1.5), and MUST NOT be gated on shared CI
runners.

#### Scenario: Coverage job does not invoke the benchmark script
- **GIVEN**: the repository's `ci.yml` coverage job configuration
- **WHEN**: a reviewer inspects the coverage job's step list
- **THEN**: no step in the coverage job invokes the benchmark harness script

#### Scenario: The benchmark script is documented as non-blocking on shared CI
- **GIVEN**: the committed benchmark harness documentation
- **WHEN**: a reviewer reads it
- **THEN**: it explicitly states the harness's timing output is informational on shared CI
  runners and is not a merge gate there

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
