# Capability: playground-core-math-view

## ADDED Requirements

### Requirement: Deterministic Synthetic Lorentzian Generator Into Preallocated Buffers
The `/core-math` view MUST include a synthetic Lorentzian signal generator that writes directly
into preallocated branded `Float32Array` buffers from `@trace-kit/core`, with no intermediate
array, and MUST be deterministic: identical seed and parameters produce byte-identical buffer
contents across runs.

#### Scenario: Identical seed and parameters produce byte-identical output
- **GIVEN**: a fixed seed, center frequency, FWHM, and noise-floor parameter set
- **WHEN**: the generator runs twice into two fresh preallocated buffers
- **THEN**: the two output buffers are byte-identical

#### Scenario: Generator allocation count does not vary with sample count
- **GIVEN**: two generator runs with `sampleCount` of `1_000` and `100_000`
- **WHEN**: each run is measured under `--expose-gc` with a `PerformanceObserver` counting `gc`
  entries
- **THEN**: both runs report `0` GC events after warm-up, and an allocating control variant in
  the same test file reports non-zero events, proving the gate is live

### Requirement: FWHM and Noise-Floor Controls Drive the Generator
The panel MUST expose FWHM and noise-floor controls that, when changed, regenerate the signal
with the new parameters.

#### Scenario: Changing FWHM regenerates the signal with the new width
- **GIVEN**: the view mounted with an initial FWHM value
- **WHEN**: the FWHM control's value is changed and the panel's change handler fires
- **THEN**: the generator re-runs and the resulting signal's measured half-maximum width
  (computed from the buffer contents) matches the new FWHM value within a documented numerical
  tolerance

### Requirement: LTTB vs Min-Max Toggle Renders the Contractually Correct Output Shape
Toggling between LTTB and Min-Max MUST invoke the corresponding `@trace-kit/core` function and
MUST produce output of the contractually correct shape for each — an `Int32Array` of
`threshold` indices for LTTB, `bucketCount * 2` values for Min-Max — with no reallocation across
toggles.

#### Scenario: Toggling to LTTB produces an Int32Array of threshold indices
- **GIVEN**: the view mounted with a `threshold` configured in the panel
- **WHEN**: the toggle is set to LTTB
- **THEN**: the view's output buffer is an `Int32Array` of length `threshold`

#### Scenario: Toggling to Min-Max produces bucketCount * 2 values
- **GIVEN**: the view mounted with a `bucketCount` configured in the panel
- **WHEN**: the toggle is set to Min-Max
- **THEN**: the view's output buffer contains exactly `bucketCount * 2` values

#### Scenario: Toggling back and forth does not reallocate output buffers
- **GIVEN**: the view already mounted with both output buffers preallocated
- **WHEN**: the toggle is switched LTTB -> Min-Max -> LTTB three times, measured under
  `--expose-gc`
- **THEN**: the observed GC event count over the toggles is `0`

### Requirement: Millisecond Table Reuses Warm-Up and Median-of-N Discipline
The millisecond table MUST report timing for the selected algorithm using the benchmark
harness's warm-up and median-of-N discipline, not a single cold call.

#### Scenario: The displayed figure is a warm median, not a cold sample
- **GIVEN**: an algorithm invocation whose first call is deliberately 4x slower than steady
  state (simulating pre-tiering cost)
- **WHEN**: the millisecond table computes its displayed value via the benchmark harness
- **THEN**: the displayed value falls within the steady-state range and is not the inflated cold
  sample

### Requirement: FWHM and Noise-Floor Controls Are Clamped to the Algorithms' Valid Ranges
Every control-driven value that reaches `lttb` or `minMaxEnvelope` MUST be validated or clamped
by the view before the call, so that no interactive control input can cause either function to
throw a `RangeError`. In particular, the `threshold` value driving `lttb` MUST be clamped to the
closed range `[2, sampleCount]` (per `packages/core/src/decimation/lttb.ts`'s own boundary
checks — `threshold` must be an integer `>= 2` and `<= sampleCount`), and the `bucketCount` value
driving `minMaxEnvelope` MUST be validated against that function's own documented boundary checks
before the call is made.

#### Scenario: A threshold control value above sampleCount is clamped, not passed through
- **GIVEN**: the view mounted with a fixed `sampleCount`, and the panel's threshold control set
  to a value greater than `sampleCount`
- **WHEN**: the LTTB toggle fires and the view computes the value it passes to `lttb`
- **THEN**: the value passed to `lttb` is `<= sampleCount`, and `lttb` does not throw

#### Scenario: A threshold control value below 2 is clamped, not passed through
- **GIVEN**: the view mounted with the panel's threshold control set to `0` or `1`
- **WHEN**: the LTTB toggle fires and the view computes the value it passes to `lttb`
- **THEN**: the value passed to `lttb` is `>= 2`, and `lttb` does not throw

### Requirement: Throwaway Drawing Routine Is Not a Renderer Contract
The view's plotting routine MUST be documented as a throwaway implementation, explicitly not a
prototype of `FigureRenderer`, and MUST be deleted and replaced by `packages/renderers`'
`Canvas2DRenderer` when change `renderers-canvas2d` (change 5) lands. This change MUST NOT
define or export any `FigureRenderer`-shaped type from the playground.

#### Scenario: The playground exports no FigureRenderer-shaped type
- **GIVEN**: the `apps/playground` source tree at the end of this change
- **WHEN**: a source-level check searches for an exported type or class named `FigureRenderer`
  or `ViewportTransform` anywhere under `apps/playground/src`
- **THEN**: no such export is found

#### Scenario: The drawing routine's documentation names its own deletion
- **GIVEN**: the source file implementing the throwaway plotting routine
- **WHEN**: its header comment or adjacent README is read
- **THEN**: it explicitly states the routine is throwaway and will be deleted by change 5
  (`renderers-canvas2d`)

### Requirement: Throwaway Drawing Routine Is Isolated Behind a Single Directory Boundary
The throwaway plotting routine MUST live entirely under a single, clearly named directory inside
`apps/playground/src`, such that change 5 can delete that one directory to remove the routine as
a unit, with no fragment of it left importable from elsewhere in the playground. The exact
directory name is an open decision deferred to `design.md`. No view other than `/core-math` MUST
import from that directory.

#### Scenario: The routine's implementation files all live under one directory
- **GIVEN**: `apps/playground/src` at the end of this change
- **WHEN**: every source file implementing the throwaway plotting routine is located
- **THEN**: all of them share a single common parent directory dedicated to the routine, with no
  routine-implementing file located outside it

#### Scenario: No view other than /core-math imports the throwaway routine
- **GIVEN**: `apps/playground/src` at the end of this change, with the `/core-math` view as the
  only registered view
- **WHEN**: a source-level check searches every file outside the throwaway routine's directory
  and outside the `/core-math` view's own module for an import resolving into that directory
- **THEN**: no such import is found

### Requirement: No VitePress Docs Portal in This Change
This change MUST NOT create `apps/docs` or any VitePress configuration.

#### Scenario: No apps/docs directory exists after this change
- **GIVEN**: the repository tree at the end of this change
- **WHEN**: `apps/docs` is checked for existence
- **THEN**: it does not exist
