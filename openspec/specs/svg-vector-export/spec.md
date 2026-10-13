# Capability: svg-vector-export

> Change: `svg-vector-export` (roadmap `order: 6`). New capability.
>
> Source: `proposal.md` Problem 1-2, Approach 1, 2, 4, 5, 6. Governs `exportToSvg`, a pure,
> DOM-free, dependency-free function shipped as the `@trace-kit/renderers/svg` subpath. Layout
> inputs (insets, transforms, ticks, labels) are governed by `figure-scene-layout`; golden
> comparison by `svg-golden-corpus`; shared decimation/style/marker rules by the MODIFIED
> `canvas2d-trace-rendering` delta.

## ADDED Requirements

### Requirement: `exportToSvg` Is a Pure Function Returning a Standalone SVG Document String
`exportToSvg(scene, options?)` MUST return a `string` containing one complete, standalone SVG
document: an XML declaration is NOT required, but the root MUST be a single `<svg>` element
declaring `xmlns="http://www.w3.org/2000/svg"`, `width`, `height` (CSS px, from the scene), and a
`viewBox` of `0 0 <width> <height>`. The scene MUST be a plain description comprising: a
`TraceCollection` (or a single `SpectrumDataPayload` as the one-trace convenience), the visible
domain, the Y-axis registrations, `width`/`height` in CSS px, and a `FigureStyle`. The function
MUST NOT be a `FigureRenderer`, MUST hold no state between calls, MUST NOT mutate, transfer or
retain the scene's buffers, and MUST NOT reference `document`, `window`, `XMLSerializer`,
`Path2D`, `HTMLCanvasElement` or any other browser global.

#### Scenario: The result is a standalone SVG root
- **GIVEN**: a valid single-trace scene of `800 x 400` CSS px
- **WHEN**: `exportToSvg(scene)` is called
- **THEN**: the result is a string whose root element is `<svg>` with the SVG namespace,
  `width="800"`, `height="400"`, and `viewBox="0 0 800 400"`, and it contains no reference to
  external resources

#### Scenario: It runs in plain Node with no DOM
- **GIVEN**: a Node unit test running without any DOM environment or global stubs
- **WHEN**: `exportToSvg` is called with a valid scene
- **THEN**: it returns a string and throws no `ReferenceError`

#### Scenario: A single payload is accepted as a one-trace scene
- **GIVEN**: a scene whose data is a bare `SpectrumDataPayload`
- **WHEN**: `exportToSvg` is called
- **THEN**: the output is identical to the output for a `TraceCollection` holding that payload as
  its sole trace with style `{ color: style.traceColor }` and bound to the first registered axis
  (the implicit axis when none is registered), matching Canvas2D's single-payload color

#### Scenario: Scene buffers are untouched
- **GIVEN**: a scene whose payload buffers are snapshotted by value and by `byteLength`
- **WHEN**: `exportToSvg` is called
- **THEN**: every buffer is byte-identical afterwards, none is detached, and `revision` is
  unchanged

### Requirement: The Exporter Lives in `@trace-kit/renderers/svg` With Zero Runtime Dependencies
`exportToSvg` MUST be implemented under `packages/renderers/src/svg/` and exposed only through
the `@trace-kit/renderers/svg` subpath. It MUST NOT be exported from `@trace-kit/core` and MUST
NOT be re-exported from the `@trace-kit/renderers` root entry. The `svg` module MUST import at
runtime only from `@trace-kit/core` and from other modules in `@trace-kit/renderers`; it MUST NOT
add any third-party runtime dependency (no d3).

#### Scenario: The root entry does not expose the exporter
- **GIVEN**: the built `@trace-kit/renderers` root entry
- **WHEN**: its export names are enumerated
- **THEN**: `exportToSvg` is not among them

#### Scenario: Core contains no exporter
- **GIVEN**: the source of `packages/core`
- **WHEN**: it is searched for `exportToSvg`
- **THEN**: there is no match

#### Scenario: No new runtime dependency is introduced
- **GIVEN**: `packages/renderers/package.json` before and after this change
- **WHEN**: the `dependencies` field is compared
- **THEN**: no entry has been added

### Requirement: Trace Paths Use Only `M` and `L` Commands
Each trace's path data MUST be built from `M` (move) and `L` (line) commands only, with
absolute coordinates. The exporter MUST NOT emit `C`, `S`, `Q`, `T`, `A`, `H`, `V`, `Z` or any
relative (lowercase) command, because curve interpolation would fabricate data between samples.
Exactly one `M` MUST be emitted at the first point of each finite segment and `L` for every
subsequent point of that segment.

#### Scenario: A gap-free trace is one M followed by L commands
- **GIVEN**: a trace of `n = 5` finite samples below the decimation target
- **WHEN**: it is exported
- **THEN**: its `d` attribute contains exactly one `M` and exactly four `L` commands and no other
  command letter

#### Scenario: No curve command can appear
- **GIVEN**: every exported golden and a generated dense noisy trace
- **WHEN**: each `d` attribute is scanned for command letters
- **THEN**: only `M` and `L` occur

### Requirement: Gaps Break the Path With a New `M` and Never Connect Across
Gap handling MUST follow `gap-sentinel-semantics`: a source `NaN` (or a `-1` break in the
decimated index stream) ends the current segment, and the next finite sample starts a new
segment with `M`. No `L` MUST connect the last point of one finite segment to the first point of
the next.

#### Scenario: A NaN splits the path into two subpaths
- **GIVEN**: `y = [1, 2, NaN, 4, 5]`
- **WHEN**: it is exported
- **THEN**: the `d` attribute has two `M` commands, one `L` after the first and one `L` after the
  second, and no `L` spans index 2

#### Scenario: Leading, trailing and consecutive NaNs emit no empty subpath
- **GIVEN**: `y = [NaN, NaN, 1, 2, NaN, NaN, NaN, 3, 4, NaN]`
- **WHEN**: it is exported
- **THEN**: the `d` attribute contains exactly two `M` commands, none immediately followed by
  another `M`

#### Scenario: A trace of all NaN emits no path
- **GIVEN**: `y` containing only `NaN`
- **WHEN**: it is exported
- **THEN**: no `<path>` element is emitted for that trace and the document remains valid

### Requirement: Isolated Samples Are Emitted as Filled Square Markers Using the Canvas2D Rule
An isolated segment (per the `canvas2d-trace-rendering` definition) of a trace whose resolved
`markIsolatedSamples` is `true` (default when the style omits it) MUST be emitted as an
axis-aligned filled square centered on its projected point with side `s = 2 * lineWidthCss`
(CSS px, i.e. `dpr = 1` of the shared rule), filled with the trace's resolved stroke color and
with no stroke. Markers MUST be emitted as `<rect>` elements, in sample order, after that
trace's line `<path>`. A trace with zero isolated segments or with `markIsolatedSamples ===
false` MUST emit no marker element.

#### Scenario: An isolated sample becomes one rect
- **GIVEN**: a trace with `y = [1, NaN, 5, NaN, 2, 3]`, `lineWidthCss = 1`
- **WHEN**: it is exported
- **THEN**: exactly one `<rect>` is emitted for sample index 2, with `width="2"` and `height="2"`,
  centered on the projection of that sample, `fill` equal to the trace color, and no `stroke`
  attribute

#### Scenario: The per-trace flag disables markers
- **GIVEN**: the same trace with `markIsolatedSamples = false`
- **WHEN**: it is exported
- **THEN**: no `<rect>` is emitted for it and its line segments are unchanged

#### Scenario: A two-distinct-sample segment gets no marker
- **GIVEN**: a segment of exactly two distinct finite samples between gaps
- **WHEN**: it is exported
- **THEN**: it is drawn as a line only and no marker is emitted

### Requirement: Each Trace Is Decimated Using the Shared DecimationSelection Machinery
Before path construction each trace MUST be decimated with the same `DecimationSelection`
machinery and infeasible-LTTB fallback to `minMaxEnvelopeIndices` that `Canvas2DRenderer` uses.
The default decimation target MUST be `min(sampleCount, max(2, ceil(plotWidthCssPx * 2)))`,
where `plotWidthCssPx` is the plot-area width from `figure-scene-layout` (the shared rule at
`dpr = 1`). The scene MAY carry an optional `decimationTarget` option: when it is a finite number
`>= 2` it MUST be floored to an integer and used in place of the derived value (still capped at
`sampleCount`); when it is absent, non-finite, or `< 2`, the derived default MUST be used. A trace
MUST never be emitted at raw sample count when `sampleCount` exceeds the target.

#### Scenario: A dense trace is bounded by the derived target
- **GIVEN**: a trace of `1,000,000` samples and a plot width of `700` CSS px
- **WHEN**: it is exported without `decimationTarget`
- **THEN**: the path contains at most `1400` points across all subpaths

#### Scenario: A trace at or below the target bypasses decimation
- **GIVEN**: a trace with `sampleCount <= target`
- **WHEN**: it is exported
- **THEN**: no decimator is invoked and every finite sample is emitted

#### Scenario: Resonance peak and dip survive export
- **GIVEN**: a trace above target containing a single-sample peak and a single-sample dip
- **WHEN**: it is exported
- **THEN**: the path contains a point at the peak's projected Y and a point at the dip's projected
  Y (physics-preserving envelope, no uniform sub-sampling)

#### Scenario: `decimationTarget` overrides the derived default
- **GIVEN**: a trace of `100,000` samples and `decimationTarget: 5000.9`
- **WHEN**: it is exported
- **THEN**: the decimation target is `5000` and the path contains at most `5000` points

#### Scenario: An invalid `decimationTarget` falls back to the default
- **GIVEN**: `decimationTarget` values `NaN`, `Infinity`, `1`, `0` and `-10`
- **WHEN**: each is exported against the same scene
- **THEN**: all five outputs are byte-identical to the output with no `decimationTarget`

#### Scenario: `decimationTarget` is capped at the sample count
- **GIVEN**: a trace of `300` samples and `decimationTarget: 10000`
- **WHEN**: it is exported
- **THEN**: at most `300` points are emitted and decimation is bypassed

### Requirement: Per-Trace Style and Y-Axis Binding Resolve Exactly as in Canvas2D
Each trace's style (color, line width, dash, `markIsolatedSamples`) and its bound `ViewportTransform`
MUST be resolved through the shared rules declared by `canvas2d-trace-rendering`: an explicit style
wins, otherwise a fixed renderer-owned default palette entry is used (never read from core); the
bound transform is selected by the trace's `yAxisId`. Line width MUST be emitted as `stroke-width`
in CSS px, the color as `stroke`, a dash pattern as `stroke-dasharray` only when the style
declares one, and every line path MUST carry `fill="none"`.

#### Scenario: Two traces on two axes are projected with their own transforms
- **GIVEN**: two traces bound to two distinct `yAxisId`s with different Y domains
- **WHEN**: they are exported
- **THEN**: each path's Y coordinates are those of its own bound transform

#### Scenario: A trace without style receives the default palette color
- **GIVEN**: two traces with no style override
- **WHEN**: they are exported
- **THEN**: their `stroke` values equal the first two entries of the renderer's default palette

#### Scenario: A single payload honours `traceColor`
- **GIVEN**: a bare payload scene with `style.traceColor = "#ff0000"`
- **WHEN**: it is exported
- **THEN**: its path has `stroke="#ff0000"`

#### Scenario: Style attributes reflect the resolved style
- **GIVEN**: a trace with `lineWidthCss = 3` and a dash pattern `[4, 2]`
- **WHEN**: it is exported
- **THEN**: its path has `stroke-width="3"`, `stroke-dasharray="4 2"`, and `fill="none"`

### Requirement: Linear and Log Axes, N Y Axes, and Decade Gridlines Are Rendered
For every registered Y axis the document MUST contain its axis line, tick marks and tick labels
at the positions produced by `figure-scene-layout`, stacked left in registration order. A log axis
(`Y_SCALE_KIND_LOG`) MUST emit one gridline per decade tick at its projected position. The X axis
MUST be emitted at the bottom of the plot area. Gridlines MUST be emitted before traces, and axes
after traces, mirroring the Canvas2D paint order (background, gridlines, traces, axes).

#### Scenario: A log axis has one gridline per decade tick
- **GIVEN**: a log Y axis whose `selectLogTicks` output has `k` values
- **WHEN**: it is exported
- **THEN**: exactly `k` horizontal gridline elements are emitted for that axis at `projectY` of
  each tick value

#### Scenario: Two axes are stacked in registration order
- **GIVEN**: two registered Y axes
- **WHEN**: it is exported
- **THEN**: the first axis line is at `plotLeft - gutter` of the first slot and the second axis
  line is one per-axis gutter further left, and every tick and label of axis `i` lies in slot `i`

#### Scenario: Paint order is fixed
- **GIVEN**: any exported scene with gridlines, traces and axes
- **WHEN**: the document element order is inspected
- **THEN**: background precedes gridlines, gridlines precede traces, traces precede axes

### Requirement: The Plot Area Is Clipped With a Deterministic `clipPath`
Trace paths and markers MUST be wrapped in a group clipped to the plot area by a
`<clipPath>` containing one `<rect>` equal to the plot area. The `clipPath` id MUST be
`<idPrefix>-plot-clip`, where `idPrefix` is an optional string option defaulting to `tracekit`
and restricted to `[A-Za-z][A-Za-z0-9_-]*` (an invalid value MUST fall back to the default). No
other id MUST be emitted. Gridlines and axes MUST NOT be clipped.

#### Scenario: The default clip id is fixed
- **GIVEN**: a scene exported with no `idPrefix`
- **WHEN**: the document is inspected
- **THEN**: it contains one `clipPath` with `id="tracekit-plot-clip"` referenced by the trace
  group, and its rect equals the plot area

#### Scenario: Two documents can coexist via a distinct prefix
- **GIVEN**: two scenes exported with `idPrefix` `a` and `b`
- **WHEN**: both are inlined in one HTML page
- **THEN**: their clip ids are `a-plot-clip` and `b-plot-clip` and do not collide

#### Scenario: An invalid prefix falls back
- **GIVEN**: `idPrefix: "1 bad id"`
- **WHEN**: it is exported
- **THEN**: the clip id is `tracekit-plot-clip`

### Requirement: Labels Are `<text>` Elements With a Configurable Font Family
Tick labels MUST be emitted as `<text>` elements, never as paths or glyph outlines, with
`font-family` set to the configured family. The default family MUST be `TRACEKIT_INTER_FAMILY`
followed by a generic fallback (`sans-serif`). Text content MUST be XML-escaped (`&`, `<`, `>`,
`"`, `'`).

#### Scenario: Labels are real text
- **GIVEN**: any exported figure with ticks
- **WHEN**: the document is inspected
- **THEN**: every tick label is a `<text>` element whose content is the formatted label string,
  and the document contains no glyph `<path>` for labels

#### Scenario: Default font family includes a generic fallback
- **GIVEN**: no font option
- **WHEN**: it is exported
- **THEN**: label `font-family` is `TRACEKIT_INTER_FAMILY, sans-serif` (with the constant's
  resolved value)

#### Scenario: Text content is escaped
- **GIVEN**: a configured axis unit string `a<b&"c"`
- **WHEN**: it is exported
- **THEN**: the content contains `a&lt;b&amp;&quot;c&quot;` and the document is well-formed XML

### Requirement: Font Embedding Is Opt-In
By default the document MUST contain no `@font-face` rule and no base64 payload. When the caller
passes `options.embedFont` (shape `{ readonly dataUrl: string; readonly format: "woff2" }`), for
example the `TRACEKIT_INTER_EMBEDDED_FONT` constant exported by the `@trace-kit/renderers/font`
subpath, the exporter MUST emit exactly one `<defs><style>` block with one `@font-face` rule
whose `src` is a `data:` URI built from that data, and the family it declares MUST equal the
family used by labels. The exporter MUST NOT subset, transform or fetch the font, and
`@trace-kit/renderers/svg` MUST NOT import the font subpath itself.

#### Scenario: Default output has no embedded font
- **GIVEN**: a scene exported without the embedding option
- **WHEN**: the document is searched for `@font-face` and `base64,`
- **THEN**: neither occurs

#### Scenario: Opt-in embeds one @font-face
- **GIVEN**: the font data from `@trace-kit/renderers/font` passed via the option
- **WHEN**: it is exported
- **THEN**: the document contains exactly one `@font-face` whose `src` begins with a `data:` URI
  and whose `font-family` matches the label `font-family`

#### Scenario: The svg subpath does not statically depend on the font subpath
- **GIVEN**: the built `./svg` entry
- **WHEN**: its imports are inspected
- **THEN**: it does not import `./font`

### Requirement: Numeric Formatting Is Fixed-Precision, Locale-Independent, Two Decimals in CSS px
Every coordinate, length and numeric attribute MUST be produced by a single formatter with the
spec-pinned constant `SVG_COORDINATE_DECIMALS = 2` (two decimal places, CSS px). The formatter
MUST: produce the same string as `Number.prototype.toFixed(2)` for a finite value; remove
trailing zeros and then a trailing decimal point (`12.50` becomes `12.5`, `3.00` becomes `3`);
never use exponent notation; normalize `-0` and any value that formats as `-0.00` to `0`; never
use `toLocaleString` or `Intl`; and use `.` as the decimal separator regardless of host locale. A
non-finite value MUST never reach the output (see the degenerate-input requirement). The
constant MUST be a named export of the svg module so goldens and tests reference it.

#### Scenario: Representative values format as pinned
- **GIVEN**: the formatter
- **WHEN**: it formats `12.345`, `12.5`, `3`, `0.004`, `-0.004`, `-0`, `1234567.891` and `0.1 + 0.2`
- **THEN**: the results equal `12.35`, `12.5`, `3`, `0`, `0`, `0`, `1234567.89` and `0.3`

#### Scenario: Exponent notation never appears
- **GIVEN**: a scene whose coordinates include values smaller than `1e-7`
- **WHEN**: it is exported
- **THEN**: the document contains no `e+`/`e-` numeric token in any attribute

#### Scenario: Host locale does not affect output
- **GIVEN**: a process whose default locale uses `,` as decimal separator
- **WHEN**: the same scene is exported
- **THEN**: the output is byte-identical to the output under an `en-US` locale

### Requirement: Output Is Byte-Deterministic
For equal input `exportToSvg` MUST return byte-identical output on every platform and across
repeated calls. Element and attribute order MUST be fixed by the implementation. The output MUST
contain no timestamps, random or counter-based ids, absolute paths, environment-derived values,
or generator comments with version numbers. Line endings MUST be `\n`.

#### Scenario: Repeated calls are identical
- **GIVEN**: one scene
- **WHEN**: `exportToSvg` is called twice
- **THEN**: the two strings are strictly equal

#### Scenario: Equal-by-value scenes are identical
- **GIVEN**: two independently constructed scenes with equal values
- **WHEN**: both are exported
- **THEN**: the strings are strictly equal

#### Scenario: No environment-derived content
- **GIVEN**: an exported document
- **WHEN**: it is scanned
- **THEN**: it contains no date/time string, no `Math.random`-derived token, and no `\r`

### Requirement: Empty and Degenerate Inputs Produce a Valid Document and Never Throw
`exportToSvg` MUST return a valid SVG document and MUST NOT throw for: an empty collection, a
zero-length payload, a payload of one sample, all-`NaN` data, a zero-width or zero-height
domain, non-finite scene width/height, width/height too small to fit the insets (plot area
`<= 0`), and an unregistered `yAxisId`. Non-finite scene dimensions MUST be treated as `0`. A
plot area of non-positive width or height MUST yield no trace elements and no clip area beyond
a zero-size rect. A trace bound to an unregistered `yAxisId` MUST be skipped. A zero-span
domain MUST follow the same widening rule as `viewport-transform`.

#### Scenario: Empty collection
- **GIVEN**: a `TraceCollection` with no traces
- **WHEN**: it is exported
- **THEN**: a valid `<svg>` with axes/grid but no `<path>` is returned

#### Scenario: Single-sample trace
- **GIVEN**: a payload with one finite sample
- **WHEN**: it is exported
- **THEN**: no line `<path>` with `L` is emitted; one marker is emitted when markers are enabled

#### Scenario: Too-small canvas
- **GIVEN**: `width = 10` with insets exceeding it
- **WHEN**: it is exported
- **THEN**: it returns a valid document containing no trace elements and no non-finite number

#### Scenario: Non-finite dimensions
- **GIVEN**: `width = NaN` and `height = Infinity`
- **WHEN**: it is exported
- **THEN**: no exception is thrown and the string contains neither `NaN` nor `Infinity`

#### Scenario: Unregistered axis id
- **GIVEN**: a trace whose `yAxisId` is absent from the axis registrations
- **WHEN**: it is exported
- **THEN**: the trace is omitted and the rest of the document is unaffected
