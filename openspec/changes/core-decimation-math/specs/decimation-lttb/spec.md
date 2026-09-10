# Capability: decimation-lttb

> Change: `core-decimation-math`. New capability.
>
> Correction to the input brief, per exploration §3.11: `lttb` emits an `Int32Array` of selected
> indices, not a `Float32Array` per axis.

## ADDED Requirements

### Requirement: Single-Pass Index Selection Into a Caller-Preallocated Buffer
`lttb` MUST perform a single O(n) pass over the input and MUST emit its result as an
`Int32Array` of selected sample indices, written into a caller-preallocated output buffer with
an explicit output offset and count. It MUST NOT emit a `Float32Array` per axis.

#### Scenario: lttb writes an Int32Array of indices into the caller's buffer
- **GIVEN**: a preallocated `Int32Array` of length `threshold` passed as `out`
- **WHEN**: `lttb(x, y, out, { threshold, sampleCount })` runs
- **THEN**: `out` is unmodified in type (`Int32Array`) and contains exactly `threshold` indices
  into the original `x`/`y` buffers

### Requirement: Subset, Monotonicity, and Endpoint-Retention Properties
The emitted indices MUST be a subset of `[0, sampleCount)`, MUST be strictly increasing, and
MUST always include index `0` and index `sampleCount - 1` (first and last point retained).

#### Scenario: Property-based check across random inputs
- **GIVEN**: a `fast-check` arbitrary generating random Y series of varying length and a random
  valid `threshold`
- **WHEN**: `lttb` runs against each generated case
- **THEN**: for every case, the output length equals `threshold`, every index lies in
  `[0, sampleCount)`, indices are strictly increasing, index `0` is present, and index
  `sampleCount - 1` is present

### Requirement: Zero Allocation, Asserted by GC-Event Count
`lttb` MUST NOT allocate on its hot path, asserted by zero `PerformanceObserver` `gc` entries
over N warm iterations under `--expose-gc` (claim **C4b**), with an allocating control variant
in the same test file reporting non-zero events.

#### Scenario: lttb reports zero GC events over warm iterations
- **GIVEN**: `lttb` invoked 10,000 times after warm-up under `node --expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events during the measured
  window
- **THEN**: the observed count is exactly `0`

#### Scenario: The allocating control variant proves the gate is live
- **GIVEN**: a deliberately allocating variant (e.g. one using `.slice()` per bucket average)
  invoked the same number of times in the same test file
- **WHEN**: the same observer measures it
- **THEN**: the observed GC event count is greater than `0`

### Requirement: Deopt Freedom
`lttb` MUST NOT deoptimize under `--trace-deopt` across its tested input shapes, maintaining
strict argument monomorphism.

#### Scenario: No deoptimization reported for lttb
- **GIVEN**: a benchmark script invoking `lttb` repeatedly with monomorphic typed-array
  arguments
- **WHEN**: `node --trace-deopt` runs the script
- **THEN**: the trace output contains no deoptimization entry naming `lttb`

### Requirement: Determinism Across Runs and Node Versions
Repeated invocation of `lttb` over identical input MUST yield byte-identical index output.
Bucket averages MUST accumulate in `number` (f64) and the implementation MUST avoid
implementation-dependent `Math` functions, relying only on IEEE-754 operations that are
deterministic across platforms.

#### Scenario: Byte-identical indices across repeated runs
- **GIVEN**: a fixed input X/Y series and `threshold`
- **WHEN**: `lttb` runs twice against fresh output buffers
- **THEN**: the two output `Int32Array`s are element-wise identical

#### Scenario: A recorded golden output stays stable
- **GIVEN**: a committed golden fixture (input + expected indices)
- **WHEN**: `lttb` runs against the fixture input
- **THEN**: the output matches the committed golden indices exactly

### Requirement: Randomised Peak-Fidelity Property
Per CLAUDE.md rule 6, `lttb` MUST NOT apply naive uniform sub-sampling, and a randomised test
varying peak position and peak width across the domain MUST assert the peak survives
decimation (at least one selected index falls within the peak's half-maximum window).

#### Scenario: A randomised narrow peak survives decimation
- **GIVEN**: a `fast-check` arbitrary generating a synthetic peak (Lorentzian or Gaussian shape)
  at a random position and random width within the domain, superimposed on a noise floor
- **WHEN**: `lttb` decimates the series to a `threshold` well below the sample count
- **THEN**: at least one selected index's Y-domain sample lies within the peak's half-maximum
  width, for every generated case

### Requirement: No Coverage-Percentage Acceptance Criterion
Line or branch coverage percentage MUST NOT be used as an acceptance criterion for `lttb`,
because exploration §1.5 records it as unfalsifiable for numeric loops.

#### Scenario: CI does not gate on a coverage threshold for this module
- **GIVEN**: the CI configuration for `packages/core`
- **WHEN**: a reviewer inspects the coverage step for `lttb.ts`
- **THEN**: no step fails the build based on a coverage percentage threshold for that file

### Requirement: Relative Regression Budget (Self-Calibrating)
`lttb`'s warm, median-of-N throughput MUST be measured against a baseline recorded on the same
runner, and a relative regression beyond the declared tolerance MUST fail the benchmark check.

#### Scenario: A regression beyond tolerance fails the benchmark check
- **GIVEN**: a recorded baseline median for `lttb` on the executing runner
- **WHEN**: a subsequent run's median exceeds the baseline by more than the declared relative
  tolerance
- **THEN**: the benchmark check reports failure

### Requirement: Informational Reference-Hardware Benchmark (Non-Blocking)
The literal figure "LTTB over 1e6 samples: under 12 ms" MUST be recorded only as an
informational benchmark on declared reference hardware, warm, median-of-N, and MUST NOT be
gated on shared CI runners.

#### Scenario: The 12 ms figure is documented as informational, not a CI gate
- **GIVEN**: the committed benchmark documentation for `lttb`
- **WHEN**: a reviewer inspects CI configuration for a blocking step tied to this figure
- **THEN**: no such blocking step exists
