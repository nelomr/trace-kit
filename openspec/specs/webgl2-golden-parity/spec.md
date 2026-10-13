# Capability: webgl2-golden-parity

## Requirements

### Requirement: A Recording Fake WebGL2 Context Backs the Node Unit Suite
The `renderers` (Node) Vitest project MUST provide a recording fake of the narrow GL context
interface the renderer depends on, at `packages/renderers/test/node/support/recording-gl2-context.ts`
as `RecordingGl2Context`, in the same style as `RecordingContext`. It MUST log every method call
and property assignment with its arguments in one ordered list; capture the arguments of
`bufferData`, `uniform*v`, `scissor`, `viewport`, `blendFunc*`, `drawArraysInstanced` and
`shaderSource`; track the live set of created objects by kind; support injected failures
(`getContext` returning `null`, link failure with an info log, `WEBGL_lose_context` present or
absent); and share one ordered log with the underlay and overlay recording 2D contexts for layer-order assertions. WebGL2
unit tests MUST NOT require a browser, a GPU or `happy-dom`.

#### Scenario: Every call is recorded in order with arguments
- **GIVEN**: a `RecordingGl2Context`
- **WHEN**: `createBuffer`, `bindBuffer`, `bufferData(target, data, usage)` and
  `drawArraysInstanced(mode, 0, 4, 10)` are called
- **THEN**: the log lists those calls in order with their arguments, and the `bufferData` data
  array is retrievable by reference

#### Scenario: Live objects are tracked by kind
- **GIVEN**: a fake after two `createBuffer`, one `createProgram` and one `deleteBuffer`
- **WHEN**: its live set is read
- **THEN**: it holds one buffer and one program

#### Scenario: The suite runs under Node
- **GIVEN**: the `renderers` project configuration
- **WHEN**: the WebGL2 unit files under `test/node/` run
- **THEN**: they execute with `environment: "node"` and import no DOM global

### Requirement: Shader X Arithmetic Is Verified by `Math.fround` Emulation Against a Float64 Reference
A unit test module MUST emulate the vertex shader's X path with `Math.fround` applied after every
float32 operation, in the shader's evaluation order `((offset - hi) * one - lo) * scale + plotLeft` with `one = 1`,
using `splitFloat64ToHiLo` from the renderer sources, and compare it with a binary64 reference
`plotLeft + (offset - xDomainMin) * (plotWidth / (xDomainMax - xDomainMin))` (the domain in the offset space `projectX` uses) evaluated
from the same Float32 offset values. The comparison MUST be expressed in device pixels. The suite
MUST include a deep-zoom scenario with offsets near `1000`, a window of about `0.01`
(`xDomainMax - xDomainMin`), and an offset-space `xDomainMin` not representable in float32 (for example
`1000.00002`). Tests MUST fail if the shader formula is edited without updating the emulation: the
emulation MUST be generated from, or asserted equal to, the formula text in the shader source
constant.

#### Scenario: Deep zoom stays under a hundredth of a device pixel
- **GIVEN**: offset-space `xDomainMin = 1000.00002`, `xDomainMax = 1000.01002`,
  `plotLeft = 56`, `plotWidth = 1000`, and 1,001 float32 offsets evenly spaced from `1000.00002`
  to `1000.01002`
- **WHEN**: each is projected by the fround emulation and by the float64 reference
- **THEN**: the maximum absolute difference is below `0.01` device pixels

#### Scenario: The naive single-float origin fails the same test
- **GIVEN**: the same inputs and an emulation that uses a single float32 origin
  `Math.fround(xDomainMin)` and no `lo`
- **WHEN**: compared with the float64 reference
- **THEN**: the maximum difference exceeds `1` device pixel, demonstrating the hi/lo pair is
  necessary

#### Scenario: A shallow-zoom window agrees as well
- **GIVEN**: a 1500-unit offset-space window `[0, 1500]` with offsets across it
- **WHEN**: compared as above
- **THEN**: the maximum difference is below `0.01` device pixels

#### Scenario: Emulation is bound to the shader text
- **GIVEN**: the shader source constant
- **WHEN**: the test extracts the X expression
- **THEN**: it equals `(offset - hi) * one - lo` modulo whitespace, and a mutated shader constant
  (`offset - (hi + lo)`) makes the test fail

### Requirement: WebGL2 Has Its Own Pixel Goldens, Generated Only by the Linux CI Workflow
The `visual` project MUST contain a WebGL2 pixel suite that renders fixtures with
`WebGL2FigureRenderer` on three stacked canvases and compares a screenshot of their common container
element (the browser-composited figure) to a committed WebGL2 golden. Goldens MUST be
named `webgl2-<fixture id>.png` and stored in the existing `test/visual/__screenshots__/`
directory (the flat layout of `visual-golden-corpus`; no OS suffix), separate from the Canvas2D
goldens, which the WebGL2 suites MUST NOT modify. The WebGL2 corpus MUST contain exactly nine
goldens, one per fixture of `PARITY_SCENARIO_FIXTURES` (5) and `SVG_EXTENDED_SCENARIO_FIXTURES`
(4), so that the gap, log, dual-axis and two-trace shader paths each have a pixel gate. Goldens
MUST be produced only by the existing `update-visual-goldens` workflow on `ubuntu-latest`; no
local script MUST write them. Visual cases MUST skip with an explicit message off Linux CI, as
for Canvas2D.

#### Scenario: Exactly nine WebGL2 goldens exist, with the right names
- **GIVEN**: the golden directory
- **WHEN**: files matching `webgl2-*.png` are listed
- **THEN**: their stems are `webgl2-` followed by each of the nine fixture ids, with no extra
  and no missing entry

#### Scenario: Generation is CI-only
- **GIVEN**: every script and workflow
- **WHEN**: searched for writers of `webgl2-*.png`
- **THEN**: the only writer is the `update-visual-goldens` workflow's regeneration step

#### Scenario: Off-Linux the cases skip with a message
- **GIVEN**: the WebGL2 pixel suite on macOS
- **WHEN**: it runs
- **THEN**: each case is reported skipped with a message naming the platform policy

### Requirement: The WebGL2 Pixel Comparison Declares Its Own Tolerance
The WebGL2 pixel assertions MUST use `toMatchScreenshot` with `pixelmatch` and an explicitly
declared non-zero `threshold` and `allowedMismatchedPixelRatio` held in one constant (the values are fixed), distinct from the Canvas2D project-level options, and MUST NOT rely on
byte-equality (`browser-visual-regression`). The constant MUST NOT be reused by the cross-engine
check below.

#### Scenario: The tolerance is declared once and non-zero
- **GIVEN**: the WebGL2 visual test sources
- **WHEN**: scanned for comparator options
- **THEN**: exactly one declaration of the WebGL2 tolerance exists, both values are greater than
  zero, and every WebGL2 `toMatchScreenshot` call references it

#### Scenario: A perturbed render fails
- **GIVEN**: a WebGL2 render of `simple-trace` whose trace is shifted by 4 device pixels, and an
  unshifted live WebGL2 render of the same fixture in the same page
- **WHEN**: the two are compared with `pixelmatch` under the WebGL2 tolerance constant (never through
  `toMatchScreenshot`, so a `--update` run cannot write a perturbed golden)
- **THEN**: the mismatch ratio exceeds the declared `allowedMismatchedPixelRatio`, and the failure
  reports the ratio and the threshold

### Requirement: A Looser Structural Cross-Check Compares WebGL2 With Canvas2D
For every fixture of the parity set and of the SVG-extended set the `visual` project MUST render
the fixture on both engines in the same page (the WebGL2 layers composed into one test-side image in
the same task as `render()`) and compare their plot interiors (the plot rectangle
inset by `K_INSET` device pixels, excluding axes and labels) with a structural metric, not a
pixel-exact one, evaluated per trace: "ink" is a pixel whose max-channel color distance from both
the background and the gridline colors exceeds `INK_DELTA`, attributed to the nearest resolved
trace color. For each trace and device-pixel column, the `[firstInkRow, lastInkRow]` extent of that
trace's ink on WebGL2 MUST lie within `K_ROWS` rows of the Canvas2D extent, for at least
`P_COLUMNS` of the columns where either engine has that trace's ink; and the fraction of columns
where exactly one engine has that trace's ink MUST NOT exceed `P_MISSING`. `K_INSET`, `K_ROWS`, `P_COLUMNS`, `P_MISSING`
and `INK_DELTA` are named constants. The check MUST NOT use the Canvas2D comparator
options and MUST NOT read goldens. A trace is one-directional when Canvas2D's default decimates it
(`deriveDecimationTarget(sampleCount, plotWidth) < sampleCount`: `resonance-peak`, `noise-floor`
and `decimation-minmax`) or when its style carries a non-empty `dash` (drawn solid on WebGL2). For a
one-directional trace the Canvas2D extent MUST lie within the WebGL2 extent expanded by `K_ROWS`,
and only columns where Canvas2D has ink and WebGL2 has none count toward `P_MISSING`.

#### Scenario: Every fixture passes the structural check
- **GIVEN**: all nine fixtures
- **WHEN**: each is rendered on both engines and compared
- **THEN**: each satisfies `K_ROWS`, `P_COLUMNS` and `P_MISSING`

#### Scenario: A deliberately offset render fails the check
- **GIVEN**: the `simple-trace` fixture with the WebGL2 trace translated by `3 * K_ROWS` rows
  (via a shifted domain on only that renderer)
- **WHEN**: the structural check runs
- **THEN**: it fails, demonstrating the metric is not vacuous

#### Scenario: A missing trace fails the check
- **GIVEN**: the `gapped-trace` fixture rendered on WebGL2 with an empty payload
- **WHEN**: compared with Canvas2D's
- **THEN**: `P_MISSING` is exceeded and the check fails

#### Scenario: Gap and isolated-marker parity is observed
- **GIVEN**: the `gapped-trace` fixture
- **WHEN**: both engines render it
- **THEN**: for each gap column range of the payload, neither engine has ink on the trace row, and
  every isolated sample's marker location has ink on both engines

#### Scenario: The comparator constants are separate from the Canvas2D ones
- **GIVEN**: the sources
- **WHEN**: scanned for the constants
- **THEN**: the cross-check does not import or reference the `0.1` / `0.001` Canvas2D comparator
  options

### Requirement: The WebGL2 Suites Consume the Shared Parity Fixtures Unchanged
The WebGL2 pixel suite, the cross-check and the fake-GL parity tests MUST take their inputs from
`PARITY_SCENARIO_FIXTURES` and `SVG_EXTENDED_SCENARIO_FIXTURES` imported via
`@trace-kit/renderers/fixtures`, applying each fixture through `setData` or `setTraces`,
`setDomain` and `resize` with the fixture's own `dpr`. They MUST NOT add a fixture, edit a fixture
or define a WebGL2-specific scenario record. The parity loop of the WebGL2 pixel suite MUST iterate
`PARITY_SCENARIO_FIXTURES`; the four extended fixtures MUST be selected by id as the Canvas2D
suite does.

#### Scenario: The WebGL2 loop iterates exactly the parity set
- **GIVEN**: the WebGL2 pixel test enumeration
- **WHEN**: its parity loop's cases are listed
- **THEN**: they are exactly the five parity fixture ids

#### Scenario: dpr is taken from the fixture
- **GIVEN**: the `decimation-minmax` fixture (`dpr: 1`) and `simple-trace` (`dpr: 2`)
- **WHEN**: they are applied to the WebGL2 renderer on the recording fake GL
- **THEN**: the recorded GL viewport widths equal `round(viewport.width * fixture.dpr)` for each

### Requirement: Fake-GL Parity Tests Pin Dual-Axis, Log, Gap and Marker Behaviour Without a Browser
The Node suite MUST include tests, driven by the extended fixtures, asserting through the fake GL:
the per-trace transform uniforms for `dual-axis` and `overlay-two-axis`, the log-scale uniforms for
`log-axis`, the NaN-preserving Y upload and the marker-pass count for `gapped-trace`
(`countIsolatedSegments` over the fixture payload equals the number of isolated segments the
marker pass was issued for), and the line-pass instance count for each trace.

#### Scenario: The gapped fixture's marker pass matches the shared count
- **GIVEN**: the `gapped-trace` fixture on the fake GL
- **WHEN**: it renders
- **THEN**: a marker pass is recorded if and only if `countIsolatedSegments` over the payload is
  greater than zero

#### Scenario: The overlay fixture draws two traces on two axes
- **GIVEN**: `overlay-two-axis`
- **WHEN**: it renders
- **THEN**: two line passes are recorded, each with its own axis transform uniforms

### Requirement: A Non-Normative Crossover Benchmark Reports Frame Time and Memory per Point Count
The change MUST deliver a benchmark using the existing `benchmark-harness` conventions that renders
the same synthetic sweep with `Canvas2DRenderer` and `WebGL2FigureRenderer` at a ladder of point
counts and reports, per engine and count, the median and p95 `render()` time and the GPU/JS memory
estimate. The benchmark MUST NOT assert any threshold, MUST NOT fail a run on a result, and MUST
NOT be part of `pnpm run test`; its output (a committed table in the change's record) is input to
the `engine-controller` hysteresis band. The point-count ladder MUST include at least
`10_000`, `80_000`, `250_000`, `1_000_000`.

#### Scenario: The benchmark reports without asserting
- **GIVEN**: the benchmark source
- **WHEN**: it is searched for `expect(`, thresholds and process exit codes tied to results
- **THEN**: none exists

#### Scenario: Output covers both engines and the whole ladder
- **GIVEN**: a benchmark run
- **WHEN**: its output table is read
- **THEN**: it has a row for each engine at each ladder point count, each with median and p95
  frame time and a memory figure

#### Scenario: The default test run does not execute it
- **GIVEN**: `pnpm run test`
- **WHEN**: its executed project and file list is inspected
- **THEN**: the benchmark is absent
