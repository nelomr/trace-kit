# Capability: canvas2d-trace-rendering

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). MODIFIED delta against the
> archived baseline at `openspec/specs/canvas2d-trace-rendering/spec.md`.
>
> Source: `proposal.md` Scope ("Canvas2D"), Modified Capabilities, Approach steps 3-5. This delta
> changes the archived exact-call-sequence requirement to account for gap breaks, moves from one
> `Path2D` per `render()` to one per trace per `render()`, and adds per-trace style/transform
> resolution and per-trace memoization sourced from a `TraceCollection`, and paints isolated
> samples between gaps as filled markers. Every other archived
> requirement (identity CTM, zero-allocation point loop, decimation-threshold derivation,
> device-pixel sizing from injected `dpr`, no payload mutation/transfer, the `OffscreenCanvas`
> constructor arm) holds unchanged for gap-free, single-trace input and is not restated here
> except where this delta narrows or extends it.

## MODIFIED Requirements

### Requirement: `buildTracePath` Issues One `moveTo` Per Finite Segment, `lineTo` Within Segments, None Across a Gap
The archived "Exact, Deterministic Call Sequence" requirement (one `moveTo` and `n - 1` `lineTo`
for `n` points) is superseded for gap-containing input by this rule: `buildTracePath` MUST issue
exactly one `moveTo` at the first point of each finite segment (per `gap-sentinel-semantics`), and
`lineTo` for every subsequent point within that same segment; it MUST NOT issue a `lineTo` call
connecting the last point of one finite segment to the first point of the next. For gap-free
input (no source `NaN`, no break marker in the decimated index stream), this reduces exactly to
the archived one-`moveTo`/`n - 1`-`lineTo` behavior, unchanged. Detecting a segment boundary MUST
use the `-1` sentinel in the decimated index stream (`j < 0`, when decimation is active; this
covers both `lttb` and `minMaxEnvelopeIndices`) or the inline `y[i] !== y[i]` self-comparison (when
decimation is bypassed), per `gap-sentinel-semantics`. Consecutive `-1` slots MUST be treated as a
single break.

#### Scenario: Gap-free input still issues exactly one moveTo and n-1 lineTo calls
- **GIVEN**: a counting `PolylineSink` and a fixed gap-free point set of `n = 500` points
  (post-decimation)
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records exactly `1` `moveTo` call and exactly `499` `lineTo` calls, in that
  order — identical to the archived requirement

#### Scenario: A single interior gap splits the call sequence into two moveTo-led segments
- **GIVEN**: a counting `PolylineSink` and a point set of `n = 500` points containing one gap
  splitting it into a segment of `200` points and a segment of `299` points (one point is the
  gap itself and issues no call)
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records exactly `2` `moveTo` calls and exactly `497` `lineTo` calls
  (`199 + 298`), and no `lineTo` call connects the last point of the first segment to the first
  point of the second

#### Scenario: Coordinates still match the transform's projection within a segment
- **GIVEN**: a known `ViewportTransform` and a known sample at index `i` within a finite segment
- **WHEN**: `buildTracePath` issues the call corresponding to that sample
- **THEN**: the recorded `(x, y)` arguments equal `(projectX(t, x[i]), projectY(t, y[i]))`
  exactly — unchanged from the archived requirement

### Requirement: Exactly One `Path2D` Is Constructed Per Trace Per `render()` Call
The archived "Exactly One `Path2D` Is Constructed Per `render()` Call" requirement is superseded:
`render()` MUST construct exactly one `Path2D` instance per trace entry in the collection, per
invocation — not one `Path2D` for the whole call regardless of trace count. For a
single-trace collection (the pre-this-change shape, expressed as a one-entry collection per
`proposal.md`'s rollback note), this reduces exactly to the archived one-`Path2D`-per-`render()`
behavior.

#### Scenario: One Path2D per trace per render call
- **GIVEN**: a `Canvas2DRenderer` wired to a `TraceCollection` with 3 trace entries, instrumented
  to count `Path2D` construction
- **WHEN**: `render()` is called once
- **THEN**: exactly 3 `Path2D` instances are constructed, one per trace entry

#### Scenario: A single-entry collection reduces to the archived one-per-render behavior
- **GIVEN**: a `Canvas2DRenderer` wired to a `TraceCollection` with exactly 1 trace entry,
  instrumented to count `Path2D` construction
- **WHEN**: `render()` is called 10 times in a row with data present
- **THEN**: exactly 10 `Path2D` instances are constructed, one per call — identical to the
  archived single-trace count

### Requirement: The Renderer Resolves Per-Trace Style and Per-Trace `ViewportTransform` From the Collection
`Canvas2DRenderer` MUST, for each trace entry in the collection, resolve that entry's style
(color, line width, dash) and its `ViewportTransform` (via the precomputed `yAxisId`-to-index
`Int32Array` owned by `trace-collection-payload`) before issuing that trace's drawing calls. A
trace entry lacking an explicit style MUST receive a default from a fixed palette owned by the
renderer, never by core (per `trace-collection-payload`'s "Core exposes no default color
palette" requirement). `ctx.lineWidth` for each trace MUST be derived from that trace's own style
and the injected `dpr`, exactly as the archived "Device-Pixel Sizing" requirement derives it for
the single-trace case.

#### Scenario: Two traces on two axes are drawn with their own resolved transform
- **GIVEN**: a `TraceCollection` with two entries bound to two distinct `yAxisId`s, backed by two
  distinct `ViewportTransform`s with different Y domains
- **WHEN**: `render()` draws both traces
- **THEN**: each trace's projected Y coordinates are computed using its own bound transform, not
  the other trace's transform

#### Scenario: A trace without explicit style receives the renderer's default palette color
- **GIVEN**: a trace entry constructed with no style override
- **WHEN**: `render()` draws that trace
- **THEN**: the stroke style applied comes from the renderer's fixed default palette, and no
  color is read from `@trace-kit/core`

#### Scenario: lineWidth is derived per-trace from that trace's style and the injected dpr
- **GIVEN**: two trace entries with `style.lineWidthCss` of `1` and `3` respectively, and the
  renderer resized with `dpr: 2`
- **WHEN**: `render()` draws both traces
- **THEN**: the fake context records `ctx.lineWidth === 2` before the first trace's `stroke` call
  and `ctx.lineWidth === 6` before the second trace's `stroke` call

### Requirement: Decimation Memoization Is Keyed Per Trace
The archived "Decimation Is Memoized by Revision, Threshold, and Domain" requirement is extended:
memoization MUST be keyed per trace entry (by that entry's own payload `revision`, the shared
decimation threshold, and the shared domain), so that a revision bump on one trace's payload MUST
NOT invalidate or force re-decimation of any other trace's cached index set.

#### Scenario: A revision bump on one trace does not re-decimate the other traces
- **GIVEN**: a `TraceCollection` with 3 trace entries, each already decimated and cached after an
  initial `render()`
- **WHEN**: `commitPayloadRevision` bumps only the second trace's payload revision, and `render()`
  is called again
- **THEN**: `lttb` is invoked exactly once more (for the second trace only) across this second
  call; the first and third traces' cached index sets are reused with no new `lttb` invocation

#### Scenario: 60 unchanged renders across a multi-trace collection invoke lttb once per trace
- **GIVEN**: a `TraceCollection` with 3 trace entries above the decimation threshold, all at a
  fixed revision, threshold, and domain
- **WHEN**: `render()` is called 60 times in a row
- **THEN**: `lttb` is invoked exactly 3 times in total across all 60 calls — once per trace, not
  once per call and not once per (trace x call)

### Requirement: Infeasible LTTB Falls Back to `minMaxEnvelopeIndices`
When `lttb` returns `0` for a trace (input too fragmented to represent within `threshold`, per
`decimation-lttb`), the renderer MUST, within the same decimation step, invoke
`minMaxEnvelopeIndices` for that trace with `bucketCount = max(1, floor(threshold / 2))` into the
same index buffer and draw its output. The fallback result MUST be memoized under the same per-trace
key so unchanged frames invoke neither decimator again.

#### Scenario: A fragmented trace is drawn via the min-max fallback
- **GIVEN**: a trace above the decimation threshold whose samples alternate finite and `NaN`
- **WHEN**: `render()` is called twice with no change
- **THEN**: `lttb` and `minMaxEnvelopeIndices` are each invoked exactly once in total, and no drawn
  line segment spans a source `NaN`

### Requirement: Isolated Samples Are Painted as Filled Square Markers by Default
An *isolated segment* is a finite segment (per `gap-sentinel-semantics`) that references exactly
one distinct source index: on the direct path a segment of length 1, on the decimated path a
segment whose non-`-1` indices are all equal (including an `lttb` singleton and a
`minMaxEnvelopeIndices` bucket `[i, i]` bounded by breaks). For every isolated segment of a trace
whose resolved `markIsolatedSamples` is `true` (the default when the style omits it), the renderer
MUST paint an axis-aligned filled square centered on `(projectX(t, x[i]), projectY(t, y[i]))` with
side `s = 2 * lineWidthCss * dpr`, issued as `rect(px - s / 2, py - s / 2, s, s)` on a marker
`Path2D` distinct from the trace's line `Path2D`, filled with exactly one `fill(markerPath)` call
per trace after that trace's `stroke(linePath)`, with `fillStyle` set to the trace's resolved
stroke color. The marker MUST NOT be stroked, so `lineCap`, `lineJoin` and the dash pattern never
affect it. The renderer MUST NOT construct a marker `Path2D` nor issue `fillStyle`/`fill` for a
trace with zero isolated segments or with `markIsolatedSamples === false`. The isolated-segment
count per trace MUST be held in a typed column allocated in `setTraces` and recomputed only when
that trace's decimation memo is recomputed. The marker walk and count MUST NOT allocate, and
`buildTracePath`'s signature and call sequence MUST remain as specified above.
`TraceDrawingContext` MUST expose `fill(path: Path2D): void`.

#### Scenario: An isolated sample on the direct path produces one marker
- **GIVEN**: a trace below the decimation threshold with `y = [1, NaN, 5, NaN, 2, 3]`, default
  style, `lineWidthCss = 1`, `dpr = 2`, and a fake `TraceDrawingContext` recording calls
- **WHEN**: `render()` is called
- **THEN**: the marker sink records exactly one `rect` call with arguments
  `(px - 2, py - 2, 4, 4)` where `(px, py)` is the projection of sample `2`, and the context
  records `stroke`, then `fillStyle` equal to the trace color, then exactly one `fill` for that
  trace

#### Scenario: An isolated sample on the decimated path produces one marker
- **GIVEN**: a trace above the decimation threshold whose decimated index stream contains one
  segment referencing a single source index (an `lttb` singleton, or a `minMaxEnvelopeIndices`
  bucket `[i, i]` between two `[-1, -1]` buckets)
- **WHEN**: `render()` is called
- **THEN**: exactly one marker `rect` is recorded for that segment, centered on the projection of
  sample `i`, and exactly one `fill` call is recorded for that trace

#### Scenario: A segment of two distinct samples produces no marker
- **GIVEN**: a decimated stream `[-1, -1, 5, 3, -1, -1]` (one bucket with distinct min/max indices)
- **WHEN**: the marker walk runs
- **THEN**: zero markers are recorded; the segment is drawn as a line only

#### Scenario: Gap-free input produces no marker and an unchanged call sequence
- **GIVEN**: a gap-free trace with more than one sample, on both the direct and the decimated path
- **WHEN**: `render()` is called
- **THEN**: no marker `Path2D` is constructed, no `fillStyle` assignment or `fill` call is recorded
  for the trace, and the recorded call sequence equals the pre-change sequence

#### Scenario: The per-trace flag disables markers
- **GIVEN**: the gapped trace of the direct-path scenario with `style.markIsolatedSamples = false`
- **WHEN**: `render()` is called
- **THEN**: no marker `Path2D` is constructed and no `fill` call is recorded for that trace; its
  line segments are drawn unchanged

#### Scenario: Marker rendering is zero-allocation and memoized
- **GIVEN**: a two-trace collection where one trace contains isolated segments, under
  `--expose-gc`, after warm-up, at a fixed revision, threshold and domain
- **WHEN**: `render()` is called 60 times
- **THEN**: the isolated-segment count is computed once per trace in total, and no GC event is
  reported beyond the per-trace `Path2D` constructions already required by this spec

### Requirement: All Other Archived Requirements Hold Unchanged for Gap-Free, Single-Trace Input
The archived requirements not listed above — identity CTM usage, `buildTracePath`'s
zero-allocation point loop, the decimation-threshold derivation from plot-area device width, no
`window.devicePixelRatio` reference, no payload construction/mutation/transfer, and the
`OffscreenCanvas` constructor arm's type-check and no-worker-reference guarantees — continue to
hold verbatim, extended transparently to iterate once per trace where the archived text describes
a single payload.

#### Scenario: setTransform is still called exactly once per frame regardless of trace count
- **GIVEN**: a `Canvas2DRenderer` wired to a `TraceCollection` with 3 trace entries, wired to a
  fake `TraceDrawingContext` that records call order and arguments
- **WHEN**: `render()` is called
- **THEN**: `setTransform(1, 0, 0, 1, 0, 0)` appears exactly once in the recorded call sequence,
  before any trace's drawing calls — not once per trace

#### Scenario: buildTracePath's point loop remains zero-allocation per trace
- **GIVEN**: a `Canvas2DRenderer` rendering a `TraceCollection` with 2 trace entries, each with
  100,000 samples decimated to roughly 2x a 1920px plot width, under `--expose-gc`, after warm-up
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures the full `render()` call
- **THEN**: zero GC events are reported across both traces' point loops combined
