# Capability: webgl2-trace-rendering

## Requirements

### Requirement: `WebGL2FigureRenderer` Implements `FigureRenderer` With the Canvas2D Member Set
`@trace-kit/renderers/webgl2` MUST export a class `WebGL2FigureRenderer implements FigureRenderer`
whose `kind` is `"webgl2"` and whose public members are exactly those of `FigureRenderer`
(`kind`, `disposed`, `transform`, `setData`, `setTraces`, `setDomain`, `resize`, `render`, `clear`,
`dispose`, `setDecimation`) plus its constructor. It MUST also export the interface
`WebGL2FigureRendererOptions` whose fields are those of `Canvas2DRendererOptions` (`style`, `axes`,
`decimation`, `yAxes`, same types and meaning) except that the single `surface` is replaced by the
required `surfaces: WebGL2FigureSurfaces` (`underlay`, `plot`, `overlay`; `webgl2-plot-surface`), and
the type `WebGL2FigureSurfaces`. `FigureRenderer` MUST NOT gain any WebGL2-specific type or member. The
`./webgl2` entry MUST re-export nothing from the root entry that the root entry does not already
export.

#### Scenario: The class satisfies the interface with no extra public member
- **GIVEN**: the compiled declaration of `WebGL2FigureRenderer`
- **WHEN**: its public instance member names are enumerated
- **THEN**: the set equals the eleven `FigureRenderer` members, `kind` reads `"webgl2"`, and
  `tsc --noEmit` accepts `const r: FigureRenderer = new WebGL2FigureRenderer(...)`

#### Scenario: Options mirror the Canvas2D options
- **GIVEN**: the declarations of `WebGL2FigureRendererOptions` and `Canvas2DRendererOptions`
- **WHEN**: their field names and types are compared
- **THEN**: every field of `Canvas2DRendererOptions` other than `surface` exists with an identical
  type on `WebGL2FigureRendererOptions`, `surface` is absent, and `{ surfaces }` alone is a valid
  options value

### Requirement: Each Segment Is One Instanced Quad Expanded in the Vertex Shader
For each trace the renderer MUST draw the polyline as instanced geometry in which one instance is
one segment between consecutive vertices `i` and `i + 1` and each instance expands to a quad
(four vertices, triangle strip) in the vertex shader. The line pass for one trace MUST be exactly
one `drawArraysInstanced` call whose instance count is `vertexCount - 1`, where `vertexCount` is
`sampleCount` on the default path and the decimated vertex count when an explicit selection is in
effect. A trace with fewer than two vertices MUST issue no line-pass draw call. Joins MUST be
simple: no miter or round join geometry is generated.

#### Scenario: One instanced draw per trace with segmentCount instances
- **GIVEN**: a renderer over the recording fake GL context with one payload of 1,000 samples, no
  selection in effect
- **WHEN**: `render()` is called
- **THEN**: the fake records exactly one line-pass `drawArraysInstanced` with 4 vertices per
  instance and an instance count of 999

#### Scenario: A two-trace collection draws one line pass per trace in collection order
- **GIVEN**: a collection with traces of 500 and 800 samples
- **WHEN**: `render()` is called
- **THEN**: the line-pass `drawArraysInstanced` calls occur in collection order with instance
  counts 499 then 799, and no line-pass call is recorded for any other trace

#### Scenario: A single-sample trace draws no line pass
- **GIVEN**: a payload whose `sampleCount` is 1 (its sample finite)
- **WHEN**: `render()` is called
- **THEN**: no line-pass draw call is recorded for it

### Requirement: Edges Are Anti-Aliased by Alpha in the Fragment Shader
The fragment shader MUST derive edge coverage from the fragment's distance to the segment's
centreline and multiply the trace color's alpha by that coverage, over a transition band whose
width is a constant in device pixels. Blending MUST be enabled with a premultiplied-alpha blend
function for the line and marker passes. Anti-aliasing MUST NOT depend on multisampling: the GL
context MUST be requested with `antialias: false`.

#### Scenario: Blending is enabled with a premultiplied-alpha function
- **GIVEN**: a renderer over the recording fake GL
- **WHEN**: `render()` is called
- **THEN**: the fake records `enable(BLEND)` and a `blendFunc` (or `blendFuncSeparate`) whose
  source factor is `ONE` and destination factor is `ONE_MINUS_SRC_ALPHA`, before the first draw
  call

#### Scenario: The context is requested without multisampling
- **GIVEN**: the recording fake GL's `getContext("webgl2", attributes)` hook
- **WHEN**: the renderer is constructed
- **THEN**: the recorded `attributes.antialias` is `false`

#### Scenario: A diagonal edge produces partially covered pixels in a real browser
- **GIVEN**: a two-vertex trace from the lower-left to the upper-right of the plot on a real
  Chromium canvas
- **WHEN**: it is rendered at `dpr = 1` and the composed layer pixels along the line's border are read
- **THEN**: at least one border pixel has an alpha strictly between 0 and the color's full alpha

### Requirement: Line Width Honours `trace-style` at Any Device Pixel Ratio
The line's full width in device pixels MUST equal `lineWidthCss * dpr`, where `lineWidthCss` is the
trace's resolved value from `resolveTraceStyle` (explicit `TraceStyle.lineWidthCss`, otherwise
`FigureStyle.lineWidthCss`) and `dpr` is the value injected through `resize`. It MUST NOT be
snapped to an integer and MUST NOT read `window.devicePixelRatio`. The width and the resolved
color MUST be set once per trace per frame from preallocated storage resolved in `setTraces`
or construction, not recomputed from style objects per frame.

#### Scenario: The width uniform scales with dpr
- **GIVEN**: a trace with `lineWidthCss = 1.5`, resized at `dpr = 1`, `1.5`, `2` and `3` in turn
- **WHEN**: `render()` runs after each resize
- **THEN**: the recorded line-width value handed to the shader is `1.5`, `2.25`, `3` and `4.5`
  device pixels respectively

#### Scenario: Per-trace width wins over the figure width
- **GIVEN**: two traces, the first with `style.lineWidthCss = 3` and the second with no explicit
  width, on a renderer whose `FigureStyle.lineWidthCss` is `1.5`, at `dpr = 2`
- **WHEN**: `render()` is called
- **THEN**: the recorded widths are `6` and `3` device pixels in trace order

#### Scenario: dpr is never read from a global
- **GIVEN**: the `webgl2` source files
- **WHEN**: they are searched for `devicePixelRatio`
- **THEN**: there is no match

### Requirement: A NaN Y Sample Is Dropped in the Vertex Shader by Bit Pattern
The vertex shader MUST classify a Y sample as a gap by reinterpreting its bits with
`floatBitsToUint` and testing exponent-all-ones with a non-zero mantissa
(`(bits & 0x7F800000u) == 0x7F800000u && (bits & 0x007FFFFFu) != 0u`). It MUST NOT use `isnan()` or
any floating-point comparison to detect NaN. A segment with at least one NaN endpoint MUST be
collapsed to a degenerate (zero-area) quad so that nothing is rasterized for it. A NaN MUST NOT be
interpolated across, coerced to a finite value or replaced on the CPU before upload: the Y
buffer is uploaded as stored (`gap-sentinel-semantics`).

#### Scenario: The vertex shader source contains the bit-pattern test and no isnan
- **GIVEN**: the vertex shader source string handed to `shaderSource` on the recording fake GL
- **WHEN**: it is searched
- **THEN**: it contains `floatBitsToUint`, `0x7F800000u` and `0x007FFFFFu`, and contains neither
  `isnan` nor a `!= y`/`== y` self-comparison of a Y value

#### Scenario: The CPU reference of the classifier agrees on every IEEE-754 class
- **GIVEN**: the TypeScript reference implementation of the shader's classifier, fed the float32
  bit patterns of `+0`, `-0`, `1`, a subnormal, `+Infinity`, `-Infinity`, the canonical quiet NaN
  `0x7FC00000`, a signalling NaN `0x7F800001`, and a negative NaN `0xFFC00000`
- **WHEN**: each is classified
- **THEN**: exactly the three NaN patterns are classified as gaps; `+Infinity` and `-Infinity` are
  not

#### Scenario: A gapped payload is uploaded unmodified
- **GIVEN**: a payload whose Y buffer has `NaN` at index 50 among 200 samples
- **WHEN**: `render()` uploads it
- **THEN**: the array recorded by the fake's `bufferData` for Y has a NaN at index 50 and is
  element-for-element equal to the payload's Y over `[0, sampleCount)`

#### Scenario: Gapped pixels are blank in a real browser
- **GIVEN**: a payload with a flat trace and a NaN run in the middle, on a real Chromium canvas
- **WHEN**: it is rendered
- **THEN**: the composed columns over the NaN run contain only the background and grid, with no
  trace-colored pixel on the trace's row

### Requirement: ±Infinity Is a Real Value and Is Clamped, Not Dropped
A Y sample of `+Infinity` or `-Infinity` MUST be treated as a real over-range reading
(`gap-sentinel-semantics`): the vertex shader MUST classify an infinite Y sample by bit pattern
with `floatBitsToUint` (`(bits & 0x7FFFFFFFu) == 0x7F800000u`) before any arithmetic on it, and map
it to the finite guard band on the side the axis direction implies, then clamp every projected
device coordinate to that guard band with min/max style operations, and draw the segment, so the
trace visibly reaches the plot edge. The guard band's finite bound MUST be at least the plot height
beyond the plot edge. The handling MUST NOT depend on IEEE infinity or NaN arithmetic in the shader.
On a log axis, `-Infinity` is non-positive and is collapsed like a gap (see the Y projection
requirement).

#### Scenario: The classifier does not treat Infinity as a gap
- **GIVEN**: the CPU reference of the classifier
- **WHEN**: it is fed `+Infinity` (`0x7F800000`) and `-Infinity` (`0xFF800000`)
- **THEN**: it reports not-a-gap for both

#### Scenario: An Infinity sample reaches the plot edge in a real browser
- **GIVEN**: a linear-axis payload `[0.5, 0.5, +Infinity, 0.5, 0.5]` with a visible Y domain of
  `[0, 1]`
- **WHEN**: it is rendered
- **THEN**: trace-colored pixels exist in the plot's top row band in the column of sample 2, and
  no trace-colored pixel exists outside the plot rectangle

### Requirement: Isolated Samples Are Drawn by a Separate Marker Pass
An isolated segment (the shared definition of `countIsolatedSegments`: a finite segment referencing
exactly one distinct source index) MUST be painted as an axis-aligned filled square centred on the
projected sample with side `2 * isolatedMarkerHalfSide(lineWidthCss, dpr)` (that is,
`2 * lineWidthCss * dpr` device pixels) in the trace's resolved color, matching
`canvas2d-trace-rendering`. The marker pass MUST be a draw call separate from, and issued after,
that trace's line pass. It MUST be issued only for a trace whose resolved `markIsolatedSamples` is
`true` (default `true`; a single payload always marks) and whose isolated-segment count is greater
than zero. The isolated-segment count MUST be computed with the shared `countIsolatedSegments`
walk once per upload (cold path), never per frame.

#### Scenario: An isolated sample yields a marker pass of side 2 * lineWidth * dpr
- **GIVEN**: a trace below any decimation with `y = [NaN, 2, 3, NaN, 5, NaN, 2, 3]`, default style
  `lineWidthCss = 1.5`, `dpr = 2`, on the recording fake GL
- **WHEN**: `render()` is called
- **THEN**: the fake records the trace's line pass, then exactly one marker-pass draw call, and
  the marker side value handed to the shader is `6` device pixels

#### Scenario: No marker pass when the trace has no isolated sample
- **GIVEN**: a gap-free trace of 100 samples
- **WHEN**: `render()` is called
- **THEN**: no marker-pass draw call is recorded

#### Scenario: A trace that opts out of markers gets none
- **GIVEN**: a collection trace with `style.markIsolatedSamples = false` and an isolated sample
- **WHEN**: `render()` is called
- **THEN**: no marker-pass draw call is recorded for that trace

#### Scenario: The isolated count is computed once per upload
- **GIVEN**: a spy on `countIsolatedSegments` and a renderer rendering the same payload revision
  60 times
- **WHEN**: all 60 `render()` calls complete
- **THEN**: the spy was called exactly once

### Requirement: The Default Path Draws the Full Payload With No CPU Decimation
When no `DecimationSelection` is in effect, `WebGL2FigureRenderer` MUST draw every sample in
`[0, sampleCount)` of each trace. It MUST NOT invoke `lttb`, `minMaxEnvelopeIndices` or
`decimateTraceIndices` and MUST NOT allocate an index buffer. This is the WebGL2 meaning of
`setDecimation(undefined)` and of an omitted `decimation` option (`selectable-decimation`).

#### Scenario: A 1,000,000-sample payload is drawn whole
- **GIVEN**: a payload of 1,000,000 samples, a spy on every decimator, and no selection
- **WHEN**: `render()` is called
- **THEN**: no decimator is invoked and the line-pass instance count is 999,999

#### Scenario: setDecimation(undefined) after a selection returns to full resolution
- **GIVEN**: a renderer with `setDecimation({ algorithm: "lttb" })` already rendered once
- **WHEN**: `setDecimation(undefined)` is called and `render()` runs
- **THEN**: the line-pass instance count equals `sampleCount - 1` again

### Requirement: An Explicit Selection Decimates Exactly as on Canvas2D
When a `DecimationSelection` is in effect (constructor `decimation` or `setDecimation`), the
renderer MUST resolve the scalar parameter with `resolveDecimationTarget` over the trace's plot
width and `sampleCount` and run `decimateTraceIndices` (including the infeasible-LTTB fallback to
`minMaxEnvelopeIndices`), producing the same index set as `Canvas2DRenderer` for the same payload,
selection and plot width. The decimation bypass rule MUST match Canvas2D: when `sampleCount` is not
greater than the emitted vertex count, the full payload is drawn. A decimated break (`-1`) MUST
render as a gap. The decimated vertex stream MUST be uploaded to the GPU only when the payload
`revision`, the selection's algorithm or the resolved parameter changes; a `setDomain` call that
changes none of these MUST NOT re-run a decimator nor re-upload.

#### Scenario: The drawn indices equal Canvas2D's
- **GIVEN**: a 100,000-sample payload, `setDecimation({ algorithm: "min-max" })`, the same plot
  width on both a `Canvas2DRenderer` and a `WebGL2FigureRenderer`
- **WHEN**: both render, and the WebGL2 upload is gathered back through the fake's `bufferData`
  records
- **THEN**: the uploaded X/Y vertex streams equal the payload gathered through the index set the
  Canvas2D renderer held, with each `-1` as a NaN gap vertex

#### Scenario: A pan does not re-decimate or re-upload
- **GIVEN**: a rendered renderer with `{ algorithm: "lttb" }` selected
- **WHEN**: `setDomain` is called with a shifted window and `render()` runs again
- **THEN**: no decimator is invoked and no `bufferData` call is recorded for the trace

#### Scenario: A resize that changes the plot width re-decimates
- **GIVEN**: the same renderer
- **WHEN**: `resize` changes the plot width such that the resolved threshold changes, and
  `render()` runs
- **THEN**: `lttb` is invoked once and the trace's decimated stream is uploaded once

### Requirement: Data Is Uploaded Once per Payload `revision` as Instanced Attributes
On the default path the renderer MUST upload each trace's X offsets and Y values to GPU buffers
as Float32 instance attributes (`vertexAttribDivisor` of 1), copying no data on the CPU: the
payload's `Float32Array`s (range `[0, sampleCount)`) are passed directly to `bufferData`. It MUST
re-upload a trace only when that trace's `payload.revision` differs from the revision last
uploaded, compared fresh on every `render()` (`figure-renderer-contract`). `setDomain`, `resize`
and style changes MUST NOT re-upload. X MUST NOT be split, renormalized or rewritten on the CPU
before upload.

#### Scenario: Sixty renders at a fixed revision upload exactly once
- **GIVEN**: a renderer rendering one payload at a fixed `revision`
- **WHEN**: `render()` is called 60 times, with `setDomain` and `resize` interleaved
- **THEN**: the fake records exactly one `bufferData` for X and one for Y

#### Scenario: A revision bump re-uploads
- **GIVEN**: a rendered renderer; `commitPayloadRevision` bumps the payload in place
- **WHEN**: `render()` runs again with no `setData` call
- **THEN**: X and Y are each uploaded once more

#### Scenario: The uploaded X array is the payload's own offsets
- **GIVEN**: a payload with `xOrigin = 1550.123456` and X offsets `[0, 0.001, 0.002]`
- **WHEN**: it is uploaded
- **THEN**: the array recorded for X is the payload's `Float32Array` (same buffer identity) or
  holds the identical float32 values, and contains no value near `1550`

### Requirement: X Uses a Hi/Lo Float32 Origin Derived in Float64
The X domain of a `ViewportTransform` (`xDomainMin`, `xDomainMax`) is in the same offset space as the payload's X offsets: `projectX` computes `plotLeft + (xOffset - t.xDomainMin) * t.xScale` and does not read `xOrigin`. Each trace's transform is the one built for that trace.
Per trace and per frame the renderer MUST take `originOffset = t.xDomainMin` from that trace's
own `ViewportTransform` (an IEEE-754 binary64 value in offset space), split it as `hi = Math.fround(originOffset)` and
`lo = Math.fround(originOffset - hi)`, and pass `hi` and `lo` as two float32 uniforms. The vertex
shader MUST compute the normalized X as `((offset - hi) * one - lo)`, where `one` is a float32
uniform (`u_one`) that the renderer always sets to `1`. Multiplying the first difference by a value
the compiler cannot know stops it from reassociating the expression into `offset - (hi + lo)`; measured on the Metal GPU, that reassociation produces a 2.0 px error, while SwiftShader preserves the order. The expression is then
scale by the plot width over the X span (itself computed in binary64 and passed as a float32
uniform). The shader therefore reproduces `projectX` exactly. The renderer MUST NOT pass
`xOrigin`, `xDomainMin` or `xDomainMax` to the shader as a single float32 each, and MUST NOT
compute `xOrigin + offset` in the shader. The split MUST be done
by a pure exported function `splitFloat64ToHiLo(value: number, out: Float32Array, index: number):
void` (module `packages/renderers/src/webgl2/precision.ts`) that allocates nothing, so tests
exercise the exact code the renderer runs. This is the only permitted float32 subtraction
involving the X origin (`viewport-transform`).

The hardened form MUST be validated by a deep-zoom probe (exact X read back from a float
render target, `d = 1000.00002`, span `0.01`, 1,001 offsets) on both SwiftShader and the Metal GPU,
with a maximum error below `0.01` device px on each. If it fails on either
renderer, implementation MUST stop: the documented contingency (CPU binary64 renormalisation with
re-upload keyed on domain change) requires a user decision and amends
`viewport-transform` before it can be adopted.

#### Scenario: The one uniform is set to 1 and the shader uses it
- **GIVEN**: a renderer on the recording fake GL
- **WHEN**: `render()` runs
- **THEN**: the recorded `u_one` value is `1` for every line and marker pass, and the vertex shader
  source contains `(offset - hi) * one - lo`

#### Scenario: The split reproduces the float64 value to float32-pair precision
- **GIVEN**: `value = 1000.00002`
- **WHEN**: `splitFloat64ToHiLo(value, out, 0)` runs
- **THEN**: `out[0] === Math.fround(value)` and `Math.abs((out[0] + out[1]) - value) < 1e-9`

#### Scenario: The uniforms handed to the shader are the hi/lo pair
- **GIVEN**: a payload with `xOrigin = 1550` and a domain `xMin = 1000.00002` (offset space)
- **WHEN**: `render()` runs on the recording fake GL
- **THEN**: the recorded hi/lo uniform values equal `splitFloat64ToHiLo(1000.00002)` and the
  vertex shader source contains no use of a single-float origin uniform summed with the offset

#### Scenario: Each trace gets its own pair from its own transform
- **GIVEN**: a collection of two traces with `xOrigin` 1550 and 1560 sharing one X domain
- **WHEN**: `render()` runs
- **THEN**: each line pass's recorded hi/lo uniforms equal `splitFloat64ToHiLo` of that trace's
  own transform `xDomainMin`; the two pairs are identical because the traces share one
  offset-space X domain, and neither pair depends on `xOrigin`

### Requirement: Y Projection Reproduces the Shared `ViewportTransform` for Linear and Log Axes
The vertex shader MUST project Y with the same formulas as `projectY`: on a linear axis
`yBase - y * yScale`, on a log axis `yBase - (log10(y) - yLogDomainMin) * yLogScale` (with
`log10` computed as `log2(y) * 0.30102999566398120`, or equivalent, in float32). The uniforms
(`yBase`, `yScale`, `yLogDomainMin`, `yLogScale`, the scale kind, `plotLeft`, `plotTop`,
`plotWidth`, `plotHeight`, `deviceWidth`, `deviceHeight`) MUST be taken from the trace's
`ViewportTransform` as produced by the shared `FigureLayout`, never recomputed independently. A
sample with `y <= 0` on a log axis MUST be treated as unrepresentable: the segment is collapsed
like a gap (this mirrors `scale-logarithmic-transform`, where such a sample projects to a
non-finite coordinate that `Path2D` consumers skip). The `y <= 0` test MUST use a comparison, not
NaN detection.

#### Scenario: Uniforms equal the transform fields on a log axis
- **GIVEN**: a payload bound to a log axis (`yDomainMin = 1`, `yDomainMax = 1000`)
- **WHEN**: `render()` runs on the recording fake GL
- **THEN**: the recorded uniforms equal `Math.fround` of `transform.yBase`, `yLogDomainMin` and
  `yLogScale`, the scale-kind uniform selects log, and `yScale` is not read from the transform
  (it is `NaN` on a log axis)

#### Scenario: The float32 emulation of the log projection matches projectY
- **GIVEN**: a Math.fround emulation of the shader's log projection and values `1`, `2.5`, `10`,
  `999`
- **WHEN**: each is projected and compared with `projectY` of the same transform
- **THEN**: the absolute difference is below `0.01` device pixels for each

#### Scenario: A non-positive sample on a log axis is not drawn
- **GIVEN**: a log-axis trace `[10, 0, 100]`
- **WHEN**: `render()` runs in a real browser
- **THEN**: neither the segment from index 0 to 1 nor from 1 to 2 paints a trace-colored pixel

### Requirement: Multi-Trace Collections Draw With Per-Trace Style, Axis and Origin, in Collection Order
`setTraces(collection)` MUST be supported with the same semantics as Canvas2D: per-trace axis
binding via `resolveTraceAxisIndices`, per-trace `ViewportTransform` carrying the trace's own
`xOrigin`, per-trace color and width from `resolveTraceStyle` (palette cycling by trace index),
and drawing in collection order (later traces over earlier). `setData(payload)` MUST be the
single-trace convenience, mutually exclusive with `setTraces`, as on Canvas2D. Replacing the trace
set MUST release the previous set's GL buffers (see the lifecycle requirement).

#### Scenario: Palette cycling matches Canvas2D
- **GIVEN**: a collection of 7 traces with no explicit colors
- **WHEN**: `render()` runs on the recording fake GL
- **THEN**: the recorded per-trace colors equal the parsed `TRACE_PALETTE` entries
  `0..5, 0` in order

#### Scenario: Dual-axis traces use their own axis transform
- **GIVEN**: a two-trace collection bound to a log axis and a linear axis (the
  `dual-axis` / `overlay-two-axis` fixture shapes)
- **WHEN**: `render()` runs
- **THEN**: the first line pass is issued with the log axis's transform uniforms and the second
  with the linear axis's

#### Scenario: setData replaces a prior collection
- **GIVEN**: a renderer with `setTraces` applied
- **WHEN**: `setData(payload)` is called and `render()` runs
- **THEN**: exactly one trace is drawn

### Requirement: A Trace Style `dash` Is Not Honoured by This Engine
`TraceStyle.dash` has no WebGL2 implementation. A trace whose style carries a
non-empty `dash` MUST be drawn solid and MUST NOT throw. This divergence from Canvas2D (which
applies `setLineDash`) MUST be recorded in the `WebGL2FigureRenderer` documentation comment.

#### Scenario: A dashed style draws solid without error
- **GIVEN**: a trace with `style.dash = [6, 3]`
- **WHEN**: `render()` runs on the recording fake GL
- **THEN**: no error is thrown and the line pass is issued exactly as for the same trace without
  a dash

### Requirement: Traces Are Clipped to the Plot Rectangle
The line and marker passes MUST be confined to the plot rectangle (`plotLeft`, `plotTop`,
`plotWidth`, `plotHeight` of the trace's transform) by `scissor` with `SCISSOR_TEST` enabled, so
that samples outside the visible X/Y window never paint the axis gutters. This matches the
exported SVG (`clipPath` over the plot area) and is a deliberate difference from Canvas2D, which
does not clip.

#### Scenario: The scissor equals the plot rectangle in device pixels
- **GIVEN**: a renderer resized to `800 x 600` CSS pixels at `dpr = 2`
- **WHEN**: `render()` runs on the recording fake GL
- **THEN**: `enable(SCISSOR_TEST)` precedes the first draw and the recorded `scissor` rectangle
  equals the GL-space conversion of `(plotLeft, plotTop, plotWidth, plotHeight)` from the
  transform (GL's origin is bottom-left)

#### Scenario: An out-of-window sample leaves the gutter blank in a real browser
- **GIVEN**: a payload whose samples extend well left of the visible X window
- **WHEN**: it is rendered in Chromium
- **THEN**: no trace-colored pixel exists in the left axis gutter columns

### Requirement: GL Resources Are Created Once, Released Once, and Balanced
The renderer MUST create its GL objects (buffers, vertex arrays, shaders, programs and any
texture it uses) through `create*` calls only in construction, `setData`, `setTraces` and the
first upload of a payload, never inside `render()`, `resize()`, `setDomain()`, `setDecimation()`
or `clear()` except that an upload to an already-created buffer reuses that buffer. Shaders MUST
be deleted after the program is linked. Replacing a trace set MUST delete every buffer and vertex
array of the previous set at the start of the next `render()`, before the new set's are created
(`setData` and `setTraces` themselves issue no GL call). `dispose()` MUST delete every
remaining GL object so that, for each object kind, the count of `create*` calls equals the count
of `delete*` calls recorded by the fake. Program compile or link failure MUST throw synchronously
from the constructor with the GL info log in the message, after deleting whatever had been
created.

#### Scenario: Create and delete counts balance after dispose
- **GIVEN**: a renderer over the recording fake GL that has called `setData`, `setTraces` twice
  with different collections, rendered, and resized
- **WHEN**: `dispose()` is called
- **THEN**: for buffers, vertex arrays, programs, shaders and textures the recorded number of
  `create*` equals the number of `delete*`, and the live-object set is empty

#### Scenario: render, resize, setDomain and clear create nothing
- **GIVEN**: a rendered renderer and the recorded call count at that point
- **WHEN**: `resize`, `setDomain`, `setDecimation`, `clear` and `render` are called again with no
  new payload
- **THEN**: no `create*` call is recorded after the baseline

#### Scenario: A link failure throws and leaks nothing
- **GIVEN**: a fake GL whose `getProgramParameter(LINK_STATUS)` returns `false` with an info log
- **WHEN**: the constructor runs
- **THEN**: it throws an error whose message contains the info log, and the live-object set of
  the fake is empty afterwards

### Requirement: `dispose()` Is Terminal and Idempotent and Frees the GL Context Eagerly
After `dispose()` every other member MUST be a no-op that issues no GL call, throws nothing and
does not touch any surface; `disposed` MUST read `true` thereafter. `dispose()` MUST delete
every GL object, call `loseContext()` once through the `WEBGL_lose_context` extension when it is
available, and drop every reference to the GL and 2D contexts, surfaces, payloads and collections.
It MUST NOT resize, detach or otherwise modify the caller-owned surfaces; after disposal the plot
canvas is spent (its context is lost) and a new renderer needs a fresh plot canvas. A second `dispose()` MUST do nothing.

#### Scenario: A render after dispose issues no GL call
- **GIVEN**: a disposed renderer over the recording fake GL, the call count noted
- **WHEN**: `render()`, `clear()`, `resize(10, 10, 1)`, `setData(payload)`, `setTraces(c)`,
  `setDomain(0, 1, 0, 1)` and `setDecimation(undefined)` are each called
- **THEN**: the fake's recorded call count is unchanged and nothing throws

#### Scenario: dispose releases the context once
- **GIVEN**: a fake GL exposing `WEBGL_lose_context`
- **WHEN**: `dispose()` is called twice
- **THEN**: `loseContext` was called exactly once and the three surfaces keep their width and height

### Requirement: The Renderer Neither Listens for Nor Recovers From Context Loss
`WebGL2FigureRenderer` MUST NOT register `webglcontextlost` or `webglcontextrestored` listeners
and MUST NOT implement any recovery, retry or loop suspension. Context loss is owned by the later
`engine-context-recovery` step (out of scope for this capability).

#### Scenario: No context-loss listener is registered
- **GIVEN**: three surface fakes that record `addEventListener` calls
- **WHEN**: the renderer is constructed, rendered and disposed
- **THEN**: zero `addEventListener` calls are recorded for any event name

### Requirement: The Frame Path Allocates Nothing
`render()` MUST NOT allocate per frame beyond what a fixed, preallocated scratch permits: it MUST
NOT construct objects, arrays, closures, strings or typed arrays, and MUST NOT call `.map`,
`.filter`, `.slice`, `.subarray` or spread inside the per-trace loop. Uniform values MUST be
written into scratch `Float32Array`s allocated at construction or in `setTraces`, and passed with
the `uniform*v` family. The banned-construct lint rule block (`allocation-free-hot-path`) MUST
scope over the per-frame draw module(s) under `packages/renderers/src/webgl2/`; cold-path files there (shader source, program creation, color
parsing) are exempt. The zero-allocation GC gate MUST cover repeated `render()` calls.

#### Scenario: A banned construct in the frame module fails lint
- **GIVEN**: a fixture variant of the frame-draw module containing an array literal in its
  per-trace loop
- **WHEN**: the hot-path ESLint block scans `packages/renderers/src/webgl2/**` as configured
- **THEN**: the check fails and names the file and construct

#### Scenario: Repeated renders report zero GC events
- **GIVEN**: the allocation gate over a renderer with the recording fake GL (recording
  disabled for the measured section), a 100,000-sample payload and fixed state
- **WHEN**: `render()` runs 1,000 times after warm-up
- **THEN**: the gate reports zero allocation attributable to `render()`

#### Scenario: Core loads under a plain Node environment with no DOM globals
- **GIVEN**: `@trace-kit/core` under the root Vitest configuration, which pins the `node` environment
  and configures no DOM globals
- **WHEN**: the package is imported in that environment
- **THEN**: it loads, and `VERSION` is a non-empty string (`packages/core/test/isomorphism.test.ts`)

### Requirement: No `any` in the WebGL2 Sources
The `webgl2` sources MUST contain none of `: any`, `as any`, `<any>`, `, any>`, `as never`, and
`as unknown as`, including in the narrow GL context interface and its recording fake.

#### Scenario: The scan is clean
- **GIVEN**: every file under `packages/renderers/src/webgl2/`
- **WHEN**: scanned for the banned patterns
- **THEN**: none appears
