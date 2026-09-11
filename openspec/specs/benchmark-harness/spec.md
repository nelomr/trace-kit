# Capability: benchmark-harness

> Change: `workspace-test-harness-bootstrap`. New capability.

## ADDED Requirements

### Requirement: Warm-Up and Median-of-N Reporting
The benchmark harness MUST perform an explicit warm-up phase before any timed iteration, MUST
report a median across N measured iterations, and MUST also report p95 alongside the median.
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
