# Capability: gap-sentinel-semantics

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). New capability.
>
> Source: `proposal.md` Intent ("Gaps"), Scope, Confirmed Product Decision 1, Approach step 1.
> States the normative meaning of `NaN` in a payload's Y buffer, independent of which decimator
> or renderer consumes it. `decimation-lttb`, `decimation-min-max`, and
> `canvas2d-trace-rendering` each carry their own MODIFIED requirements describing how they
> individually honor the guarantees stated here; this capability is the single place the
> guarantee itself is stated so it is not restated (and cannot drift) across three files.

## ADDED Requirements

### Requirement: `NaN` in a Y Sample Denotes a Gap, Never a Value
A `NaN` at index `i` of a payload's Y buffer (`y[i] !== y[i]`) MUST be interpreted as "no
measurement at this X" (a telemetry gap: a dead detector pixel, an aborted sweep segment, a
saturated-and-discarded ADC sample) by every consumer that reads Y sample values — decimators,
path builders, and any future exporter. A `NaN` sample MUST NOT be treated as a numeric value,
MUST NOT be averaged, summed, compared, or otherwise combined with a real value to produce a
result that is itself treated as real data, and MUST NOT be silently coerced to `0` or to any
other finite sentinel by a consumer.

#### Scenario: A single NaN sample is recognized as a gap by a self-comparison check
- **GIVEN**: a Y buffer containing a `NaN` at index `42` among otherwise finite samples
- **WHEN**: a consumer evaluates `y[42] !== y[42]`
- **THEN**: the expression is `true`, and the consumer's gap-handling path is taken for index
  `42`

#### Scenario: A NaN sample is never coerced to a finite sentinel
- **GIVEN**: a Y buffer containing one `NaN` sample
- **WHEN**: any consumer in this change's scope (a decimator or the Canvas2D path builder)
  processes that buffer
- **THEN**: no emitted output attributes a finite numeric value to the `NaN` sample's index

### Requirement: `±Infinity` Is a Real, Finite-Input Value, Never a Gap Sentinel
A `+Infinity` or `-Infinity` sample present in a payload's Y buffer MUST be treated as a real
over-range reading, not a gap. It MUST propagate through decimation and rendering exactly as any
other real (non-`NaN`) sample would, subject only to existing clamping behavior already defined
by `decimation-min-max` and by the renderer's own value handling. This requirement introduces no
new sentinel type: `NaN` remains the only gap sentinel, per Confirmed Product Decision 1.

#### Scenario: An Infinity sample is not treated as a gap
- **GIVEN**: a Y buffer containing a `+Infinity` sample at index `10` among finite samples
- **WHEN**: a consumer's gap check (`y[10] !== y[10]`) evaluates that sample
- **THEN**: the check is `false`, and the sample is processed on the real-value path, not the
  gap path

### Requirement: A Gap Is Never Interpolated Across
No consumer in this change's scope MUST draw, compute, or emit a value that bridges — by
interpolation, averaging, or straight-line connection — the real sample immediately before a gap
and the real sample immediately after it. A rendered trace MUST show a visible break at a gap's
location, not a connecting line or a fabricated intermediate value. This guarantee MUST hold
whether the gap survives all the way to render time unchanged (small inputs, decimation
bypassed) or is first processed by `lttb` or `minMaxEnvelope` (decimation active): the specific
encoding each decimator uses to carry the gap through its output is that decimator's own MODIFIED
requirement (`decimation-lttb`, `decimation-min-max`); this requirement states only that
whichever encoding is chosen, no downstream consumer may bridge across it.

#### Scenario: An undecimated gap produces a visible break, not a connecting line
- **GIVEN**: a payload with a `NaN` at index `50` among 200 samples, small enough that the
  Canvas2D renderer bypasses decimation
- **WHEN**: `buildTracePath` walks the direct sample range
- **THEN**: no `lineTo` call connects the sample at index `49` directly to the sample at index
  `51`; the path breaks at the gap

#### Scenario: A decimated gap still produces a visible break
- **GIVEN**: a payload large enough that the Canvas2D renderer invokes `lttb`, containing one
  interior gap
- **WHEN**: `lttb` decimates the input and `buildTracePath` consumes the result
- **THEN**: no `lineTo` call connects the last finite point before the gap directly to the first
  finite point after it; the path breaks at the gap

#### Scenario: Property check — no emitted path segment spans a source NaN
- **GIVEN**: a `fast-check` arbitrary generating a Y series with 0 or more randomly placed `NaN`
  gaps, decimated at a random valid threshold or bucket count and then rendered via
  `buildTracePath`
- **WHEN**: the emitted sequence of `moveTo`/`lineTo` calls is inspected against the source
  buffer's gap indices
- **THEN**: for every generated case, no line segment drawn between two consecutively-issued
  points has a source `NaN` sample strictly between the X positions of those two points

### Requirement: Leading, Trailing, and All-Gap Series Are Defined, Not Undefined Behavior
A gap at the first sample, a gap at the last sample, a run of consecutive gaps, and a series
whose every sample is `NaN` MUST all be handled without throwing and without producing a
fabricated finite value. A leading gap MUST produce a path with no point drawn until the first
finite sample. A trailing gap MUST produce a path with no point drawn after the last finite
sample. An all-`NaN` series MUST produce an empty rendered path (zero `moveTo`/`lineTo` calls)
rather than a crash or a spurious single point at some default coordinate.

#### Scenario: A leading gap suppresses drawing until the first finite sample
- **GIVEN**: a Y buffer whose first 10 samples are `NaN`, followed by finite samples
- **WHEN**: the trace is rendered
- **THEN**: the first drawing call (`moveTo`) corresponds to the first finite sample, not to
  index `0`

#### Scenario: A trailing gap suppresses drawing after the last finite sample
- **GIVEN**: a Y buffer whose last 10 samples are `NaN`, preceded by finite samples
- **WHEN**: the trace is rendered
- **THEN**: no drawing call is issued for any of the trailing `NaN` samples, and the path ends at
  the last finite sample

#### Scenario: An all-NaN series renders an empty path without throwing
- **GIVEN**: a Y buffer whose every sample is `NaN`
- **WHEN**: the trace is decimated (if above the decimation threshold) and rendered
- **THEN**: no exception is thrown at any stage, and the rendered path issues zero `moveTo` and
  zero `lineTo` calls

### Requirement: `NaN` in the X Buffer Is Out of Contract
The X buffer MUST be finite at every index; it is the sampling grid, not a data channel, and
carries no gap semantics. A `NaN` in the X buffer is a producer-side contract violation, not a
gap. No decimator or renderer in this change's scope MUST perform a per-point runtime check for
`NaN` in X on its hot path; behavior when the X contract is violated is unspecified, and no test
in this change's scope MUST assert a particular recovery behavior for it.

#### Scenario: No hot-path NaN check exists for X
- **GIVEN**: `packages/core/src/decimation/**` and the Canvas2D trace-path module
- **WHEN**: their per-sample hot-path loops are inspected
- **THEN**: no loop performs a `x[i] !== x[i]` (or equivalent) check on the X buffer

#### Scenario: X-buffer validity is documented as a producer contract, not a runtime guarantee
- **GIVEN**: the committed type or JSDoc contract for a payload's X buffer
- **WHEN**: it is inspected
- **THEN**: it states the X buffer MUST be finite at every index, and does not claim any
  decimator or renderer detects or recovers from a violation
