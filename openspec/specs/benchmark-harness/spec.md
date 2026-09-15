# Capability: benchmark-harness

> Changes: `workspace-test-harness-bootstrap` (initial), `playground-shell` (the `/core-math`
> view's millisecond table now reuses this harness's warm-up/median-of-N logic).

## ADDED Requirements

### Requirement: Warm-Up and Median-of-N Reporting
The benchmark harness MUST perform an explicit warm-up phase before any timed iteration and MUST
report a median across N measured iterations, **and it now gains an interactive consumer**: the
playground's `/core-math` millisecond table calls into the same warm-up/median-of-N logic used
by the CI benchmark checks, so a number a human reads in the panel means the same thing the CI
benchmarks mean.

#### Scenario: The playground's millisecond table uses the harness, not an ad hoc timer
- **GIVEN**: the `/core-math` view's millisecond table implementation
- **WHEN**: a source-level check inspects how it computes its displayed timing value
- **THEN**: it calls the shared benchmark harness's warm-up + median-of-N function rather than
  wrapping a single `performance.now()` call around one invocation

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
