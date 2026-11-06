# Capability: canvas2d-trace-rendering

> Change: `renderers-canvas2d`. New capability.
>
> Source: `design.md` §D5 (identity CTM, per-frame `Path2D`), §D6 (decimation call boundary),
> §D7 (`PolylineSink`), §D8 (zero-allocation assertion mechanism and the honest gap: no test in
> this change asserts a painted pixel because happy-dom's `getContext("2d")` returns `null`).
> Requirements here are written against what §D8 states IS asserted: call sequence against a
> fake context, exact work counts, and the allocation gate — never against rasterized pixel
> output.

## Notation

Notation used by this capability. `G` is `GUARD_BAND_PX` (`65536`), in pixels of the transform (device
pixels for a raster backend, CSS pixels for SVG, where `dpr = 1`). The *guard rectangle* of a
transform `t` is `[t.plotLeft - G, t.plotLeft + t.plotWidth + G]` on X and
`[t.plotTop - G, t.plotTop + t.plotHeight + G]` on Y. `clampX(v)` and `clampY(v)` clamp `v` into
that rectangle with `Math.min`/`Math.max`, and the *axis scale* is `t.yLogScale` on a log axis
(`t.yScaleKind === Y_SCALE_KIND_LOG`) and `t.yScale` on a linear axis.

Reference transform used by the coordinate scenarios: `createViewportTransform` with `cssWidth
450`, `cssHeight 330`, `dpr 1`, `insetLeft 50`, `insetRight 0`, `insetTop 0`, `insetBottom 30`,
`xOrigin 0`, X domain `[0, 4]` and linear Y domain `[0, 1]`. It gives `plotLeft 50`, `plotTop 0`,
`plotWidth 400`, `plotHeight 300`, so `projectX(i) = 50 + 100 * i`, `projectY(0.5) = 150`, the top
guard edge is `-65536` and the bottom guard edge is `65836`. The *reference log transform* is the
same with a log Y domain `[1, 1000]` (`yLogScale = 100`, `projectY(10) = 200`,
`projectY(100) = 100`).

## ADDED Requirements

### Requirement: The Rendering Context Uses an Identity CTM at All Times
`Canvas2DRenderer.render()` MUST call `ctx.setTransform(1, 0, 0, 1, 0, 0)` and MUST NOT call
`scale`, `translate`, or `rotate` on the drawing context at any point. All coordinate projection
MUST be performed in TypeScript via `projectX`/`projectY` before any drawing call, producing
device-pixel coordinates directly.

#### Scenario: setTransform is called with the identity matrix once per frame
- **GIVEN**: a `Canvas2DRenderer` wired to a fake `TraceDrawingContext` that records call order
  and arguments
- **WHEN**: `render()` is called
- **THEN**: `setTransform(1, 0, 0, 1, 0, 0)` appears exactly once in the recorded call sequence,
  and it is the first drawing-surface call in that sequence

#### Scenario: No non-identity transform call is ever issued
- **GIVEN**: the same fake context, across `render()` calls following a `resize`, a
  `setDomain`, and an unchanged frame
- **WHEN**: the full recorded call sequence is inspected
- **THEN**: it contains no call to `scale`, `translate`, or `rotate`

### Requirement: Exactly One `Path2D` Is Constructed Per `render()` Call
`render()` MUST construct exactly one `Path2D` instance per invocation, used for the trace
stroke. Allocation inside the per-point loop that populates it is separately governed by the
allocation-free requirement below; this requirement governs only the per-frame count.

#### Scenario: One Path2D per render call
- **GIVEN**: a `Canvas2DRenderer` instrumented to count `Path2D` construction
- **WHEN**: `render()` is called 10 times in a row with data present
- **THEN**: exactly 10 `Path2D` instances are constructed, one per call

### Requirement: `buildTracePath` Allocates Nothing Inside the Per-Point Loop
The function that walks the (possibly decimated) index set and issues `moveTo`/`lineTo` calls
against a `PolylineSink` MUST NOT construct an object literal, array literal, closure, or
template string, and MUST NOT call `.map`, `.filter`, `.subarray`, or use `for...of`, a spread,
or a rest parameter, anywhere inside its loop body. A warmed-up run of this function MUST report
zero garbage-collector events under the repository's `PerformanceObserver({ entryTypes: ["gc"] })`
gate running under `--expose-gc` in the `node` test environment, requiring no canvas.

#### Scenario: The point loop reports zero GC events
- **GIVEN**: `buildTracePath` driven by a preallocated counting `PolylineSink` over a payload of
  100,000 samples decimated to roughly 2x a 1920px plot width, under `--expose-gc`, after
  warm-up
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures the run
- **THEN**: zero GC events are reported

#### Scenario: An allocating control sink proves the gate is live
- **GIVEN**: a deliberately allocating `PolylineSink` variant that constructs a `{x, y}` object
  per `lineTo` call instead of accepting two number parameters
- **WHEN**: the same instrumentation measures a run against that control sink
- **THEN**: the observed GC event count is greater than `0`

#### Scenario: A source-level check rejects a banned construct in the loop
- **GIVEN**: a fixture variant of the trace-path module containing an array literal inside the
  loop body
- **WHEN**: the repository's hot-path ESLint rule block, extended to
  `packages/renderers/src/path/**`, lints the fixture
- **THEN**: the lint check fails and names the fixture file and the offending construct

### Requirement: `buildTracePath` Issues an Exact, Deterministic Call Sequence
For a non-empty point set of `n` points, `buildTracePath` MUST issue exactly one `moveTo` call
and exactly `n - 1` `lineTo` calls against the supplied `PolylineSink`, in that order. For `n ===
0`, it MUST issue zero calls. The projected coordinates passed to `moveTo`/`lineTo` MUST equal
`projectX`/`projectY` applied to the corresponding sample, whether iterating the decimated index
set or, when bypassed, the direct sample range.

#### Scenario: Exactly one moveTo and n-1 lineTo calls for n points
- **GIVEN**: a counting `PolylineSink` and a fixed point set of `n = 500` points (post-decimation)
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records exactly `1` `moveTo` call and exactly `499` `lineTo` calls, in that
  order

#### Scenario: Zero points issues zero calls
- **GIVEN**: a counting `PolylineSink` and an empty point set (`n = 0`)
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records zero calls

#### Scenario: Coordinates match the transform's projection
- **GIVEN**: a known `ViewportTransform` and a known sample at index `i`
- **WHEN**: `buildTracePath` issues the call corresponding to that sample
- **THEN**: the recorded `(x, y)` arguments equal `(projectX(t, x[i]), projectY(t, y[i]))`
  exactly

### Requirement: The Decimation Threshold Is Derived From Plot-Area Device Width
The threshold MUST be computed by a shared rule `deriveDecimationTarget(sampleCount, plotWidth)`
equal to `min(sampleCount, max(2, ceil(plotWidth * 2)))`, living in a module importable by both
`Canvas2DRenderer` and `exportToSvg`. `Canvas2DRenderer` MUST call it with
`transform.plotWidth` (device pixels) and recompute it whenever `transform.plotWidth` changes;
`exportToSvg` calls it with the plot width in CSS px (the rule at `dpr = 1`). When `sampleCount`
is less than or equal to the result, the renderer MUST bypass decimation and walk the direct
sample range `[0, sampleCount)` rather than invoking `lttb`.

#### Scenario: The decimated count is bounded by twice the plot width regardless of sample count
- **GIVEN**: a fixed plot width producing a threshold `T`, and sample counts of `100,000` and
  `1,000,000`
- **WHEN**: the renderer decimates each
- **THEN**: the resulting decimated count is `<= T` in both cases, and is exactly equal between
  the two sample counts

#### Scenario: A sample count at or below threshold bypasses decimation
- **GIVEN**: a plot width whose threshold is `T`, and `sampleCount <= T`
- **WHEN**: `render()` runs
- **THEN**: `lttb` is not invoked, and `buildTracePath` walks the direct range `[0, sampleCount)`

#### Scenario: A sample count above threshold invokes lttb with that threshold
- **GIVEN**: a plot width whose threshold is `T`, and `sampleCount > T`
- **WHEN**: `render()` runs for the first time at this revision and transform
- **THEN**: `lttb` is invoked exactly once with `threshold === T`

#### Scenario: Canvas2D and SVG derive the target through the same function
- **GIVEN**: sources of `canvas2d/` and `svg/`
- **WHEN**: they are inspected
- **THEN**: both call `deriveDecimationTarget` and neither contains an inline
  `ceil(plotWidth * 2)` expression

#### Scenario: The shared rule is pinned by table
- **GIVEN**: `(sampleCount, plotWidth)` of `(1000000, 700)`, `(100, 700)`, `(5, 0)`, `(1, 0)`
- **WHEN**: `deriveDecimationTarget` is called
- **THEN**: it returns `1400`, `100`, `2` and `1` respectively

### Requirement: Decimation Is Memoized by Revision, Threshold, and Domain
`Canvas2DRenderer` MUST NOT re-invoke `lttb` on a `render()` call when `payload.revision`, the
decimation threshold, and the domain are all unchanged since the index set currently held was
computed.

#### Scenario: lttb is invoked once across 60 unchanged renders
- **GIVEN**: a fixed payload revision, threshold, and transform
- **WHEN**: `render()` is called 60 times in a row
- **THEN**: `lttb` is invoked exactly once across all 60 calls

#### Scenario: A revision bump between renders triggers exactly one more invocation
- **GIVEN**: the same setup, after the initial `render()` call
- **WHEN**: `commitPayloadRevision` bumps the payload's revision and `render()` is called again
- **THEN**: `lttb` is invoked exactly twice in total (once for the first call, once for the
  second)

### Requirement: Device-Pixel Sizing Comes Only From the Injected `dpr`
`Canvas2DRenderer` MUST NOT read `window.devicePixelRatio` anywhere in its implementation. The
backing-store size and `ctx.lineWidth` MUST be derived only from the `dpr` value passed to
`resize(width, height, dpr)`.

#### Scenario: No reference to window.devicePixelRatio exists in the renderer source
- **GIVEN**: `packages/renderers/src/**`
- **WHEN**: the source is scanned for `devicePixelRatio`
- **THEN**: no occurrence appears in `packages/renderers/src/canvas2d/**` or
  `packages/renderers/src/path/**`

#### Scenario: lineWidth is derived from the injected dpr
- **GIVEN**: a renderer constructed with `style.lineWidthCss = 2` and resized with `dpr: 3`
- **WHEN**: `render()` runs
- **THEN**: the fake context records `ctx.lineWidth === 6` before the `stroke` call

### Requirement: The Renderer Never Constructs, Mutates, or Transfers Payload Buffers
`Canvas2DRenderer` MUST read `payload.x` and `payload.y` only by reference for projection and
decimation input. It MUST NOT construct a `SpectrumDataPayload`, MUST NOT mutate any of its
fields or buffers, and MUST NOT place either buffer in a transfer list.

#### Scenario: The renderer never places a payload buffer in a transfer list
- **GIVEN**: the renderer's full source under `packages/renderers/src/**`
- **WHEN**: the source is scanned for any call passing `payload.x` or `payload.y` to a
  transfer-list-accepting function, and for any reference to `Worker`, `postMessage`, or
  `structuredClone`
- **THEN**: no such call or reference exists

### Requirement: The `OffscreenCanvas` Constructor Arm Type-Checks Without a Worker Path
`Canvas2DRenderer`'s constructor MUST accept a `Canvas2DSurface` value typed as
`OffscreenCanvas` and behave identically to the `HTMLCanvasElement` arm — same context
acquisition, same drawing calls — except that it MUST NOT set `style` on the surface (sizing the
CSS box is the adapter's responsibility for a real element, and `OffscreenCanvas` has no
`style`). The package MUST NOT reference `Worker`, `postMessage`,
`transferControlToOffscreen`, `structuredClone`, or `self` anywhere in `src/**`.

#### Scenario: An OffscreenCanvas-typed value type-checks as a valid constructor argument
- **GIVEN**: a fixture value declared `const s: Canvas2DSurface = fakeOffscreenCanvas`
- **WHEN**: it is passed to the `Canvas2DRenderer` constructor under `tsc --noEmit`
- **THEN**: it type-checks with no assertion

#### Scenario: No worker-thread reference exists anywhere in the renderer package
- **GIVEN**: `packages/renderers/src/**`
- **WHEN**: the source is scanned for `Worker`, `postMessage`, `transferControlToOffscreen`,
  `structuredClone`, and `self`
- **THEN**: none of these identifiers appears

#### Scenario: The renderer never sets style on the surface
- **GIVEN**: the renderer's full implementation
- **WHEN**: its source is inspected for any assignment to `surface.style`
- **THEN**: no such assignment exists
## MODIFIED Requirements

### Requirement: `buildTracePath` Issues One `moveTo` Per Finite Segment, `lineTo` Within Segments, None Across a Gap
The archived "Exact, Deterministic Call Sequence" requirement (one `moveTo` and `n - 1` `lineTo`
for `n` points) is superseded for gap-containing input by this rule: `buildTracePath` MUST issue
exactly one `moveTo` at the first point of each finite segment (per `gap-sentinel-semantics`), and
`lineTo` for every subsequent point within that same segment; it MUST NOT issue a `lineTo` call
connecting the last point of one finite segment to the first point of the next. For gap-free
input (no source `NaN`, no break marker in the decimated index stream, and, on a log axis, no
sample `<= 0`), this reduces exactly to the archived one-`moveTo`/`n - 1`-`lineTo` behavior,
unchanged. Detecting a segment boundary MUST use the `-1` sentinel in the decimated index stream
(`j < 0`, when decimation is active; this covers both `lttb` and `minMaxEnvelopeIndices`) or the
inline `y[j] !== y[j]` self-comparison of the walked sample, per `gap-sentinel-semantics`, and, on a
log axis, the `y[j] <= 0` comparison of "A Non-Positive Sample on a Log Axis Lifts the Pen".
Consecutive breaks of any kind MUST be treated as a single break. The coordinates of every drawn
point MUST be the clamped projection of "±Infinity Samples Reach the Plot Edge and Every Projected
Coordinate Is Clamped to the Guard Band".

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

#### Scenario: A NaN next to a log non-positive sample is one break
- **GIVEN**: the reference log transform and `y = [10, NaN, 0, 100, 200]` over `x = 0..4`
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records `2` `moveTo` and `1` `lineTo` calls

#### Scenario: Coordinates are the clamped projection within a segment
- **GIVEN**: a known `ViewportTransform` and a known finite, representable sample at index `i`
  within a finite segment
- **WHEN**: `buildTracePath` issues the call corresponding to that sample
- **THEN**: the recorded `(x, y)` arguments equal
  `(clampX(projectX(t, x[i])), clampY(projectY(t, y[i])))` exactly, which equals
  `(projectX(t, x[i]), projectY(t, y[i]))` whenever that projection lies inside the guard
  rectangle

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
Per-trace style resolution (color, line width, dash, `markIsolatedSamples`) MUST be implemented
by a shared `resolveTraceStyle` rule, with the fixed default palette owned by `@trace-kit/renderers`
(never by core, per `trace-collection-payload`), importable by both backends. For each trace entry
`Canvas2DRenderer` MUST resolve that entry's style via the shared rule and its `ViewportTransform`
(via the precomputed `yAxisId`-to-index `Int32Array` owned by `trace-collection-payload`) before
issuing that trace's drawing calls. A trace lacking an explicit style MUST receive the
palette entry for its index. `ctx.lineWidth` MUST be derived from that trace's own resolved style
and the injected `dpr`, as the archived "Device-Pixel Sizing" requirement derives it. Resolution
MUST be allocation-free per frame in Canvas2D (resolved at `setTraces`).

Each trace's `ViewportTransform` MUST be built from the renderer's shared X domain, which is
absolute physical X (`figure-renderer-contract`), together with that trace's own payload `xOrigin`.
Line paths and isolated-sample markers MUST be projected by calling `projectX` on the payload's raw
`x[i]` offsets through that transform; the render loop MUST NOT add `xOrigin` to any sample and MUST
NOT read `xOrigin` itself. Two traces that sample the same absolute X MUST therefore be drawn at
the same device X whatever their origins. A payload with `xOrigin = 0` MUST draw exactly as it did
when the domain was taken as offsets (the paths are call-for-call identical).

#### Scenario: Two traces on two axes are drawn with their own resolved transform
- **GIVEN**: a `TraceCollection` with two entries bound to two distinct `yAxisId`s with different
  Y domains
- **WHEN**: `render()` draws both traces
- **THEN**: each trace's projected Y coordinates use its own bound transform

#### Scenario: A trace without explicit style receives the renderer's default palette color
- **GIVEN**: a trace entry constructed with no style override
- **WHEN**: `render()` draws that trace
- **THEN**: the stroke style comes from the fixed default palette, and no color is read from
  `@trace-kit/core`

#### Scenario: lineWidth is derived per-trace from that trace's style and the injected dpr
- **GIVEN**: two traces with `style.lineWidthCss` of `1` and `3`, and `dpr: 2`
- **WHEN**: `render()` draws both
- **THEN**: `ctx.lineWidth === 2` before the first `stroke` and `6` before the second

#### Scenario: Both backends resolve identical style for identical input
- **GIVEN**: one `TraceCollection` with a mix of styled and unstyled traces
- **WHEN**: it is resolved for Canvas2D and for `exportToSvg`
- **THEN**: the resolved color, line width, dash and marker flag per trace are equal

#### Scenario: Traces with different origins covering the same absolute range draw identical X
- **GIVEN**: a collection with domain `[0, 299]` holding trace A (`xOrigin: 0`, offsets `0..299`) and
  trace B (`xOrigin: 1000`, offsets `-1000..-701`), recorded on a fake `TraceDrawingContext`
- **WHEN**: `render()` runs
- **THEN**: the sequence of X arguments of the `moveTo`/`lineTo` calls of trace A equals that of
  trace B, element by element

#### Scenario: A non-zero origin trace is visible under an absolute domain
- **GIVEN**: a single payload with `xOrigin: 1550` and offsets `[0, 0.5, 1]`, `setDomain(1550, 1551,
  -1, 1)`
- **WHEN**: `render()` runs on the fake context
- **THEN**: the first path point is at `plotLeft`, the last at `plotLeft + plotWidth`, and the middle
  at the horizontal centre of the plot area

#### Scenario: A zero-origin payload draws bit-identically to the offset-domain behaviour
- **GIVEN**: a payload with `xOrigin: 0` and a domain `[0, 512]`
- **WHEN**: `render()` runs on the fake context
- **THEN**: every recorded path coordinate equals `plotLeft + (x[i] - 0) * xScale` computed in
  f64, the same values the render produced before the domain was defined as absolute

#### Scenario: The per-point loop adds no origin
- **GIVEN**: the source of `buildTracePath` and the marker pass
- **WHEN**: it is scanned for `xOrigin`
- **THEN**: no occurrence is found

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
same index buffer and draw its output. This MUST hold for every collection entry (`setTraces`) and
for the single payload (`setData`) alike: both paths MUST decimate through the shared
`decimateTraceIndices` rule (`src/rules/decimation.ts`), the call `exportToSvg` and WebGL2 also
make, and neither MAY call `lttb` or `minMaxEnvelopeIndices` directly. The fallback result MUST be
memoized under the same key as the decimation result (per trace for a collection, the single memo
for `setData`), so unchanged frames invoke neither decimator again, and the isolated-segment count
MUST be refreshed only when that memo recomputes. The bypass rule and the memo key are unchanged.

#### Scenario: A fragmented trace is drawn via the min-max fallback
- **GIVEN**: a collection trace above the decimation threshold whose samples alternate finite and
  `NaN`
- **WHEN**: `render()` is called twice with no change
- **THEN**: `lttb` and `minMaxEnvelopeIndices` are each invoked exactly once in total, and no drawn
  line segment spans a source `NaN`

#### Scenario: A fragmented single payload is drawn via the min-max fallback
- **GIVEN**: `setData` with a 10,000-sample payload whose samples alternate finite and `NaN`, and
  a plot width whose derived threshold `T` is `800`
- **WHEN**: `render()` is called twice with no change
- **THEN**: `lttb` is invoked exactly once with `threshold === 800`, `minMaxEnvelopeIndices` is
  invoked exactly once with `bucketCount === 400`, the trace's `RecordingPath2D` holds at most
  `800` `moveTo` + `lineTo` operations in total (not the 5,000 the whole payload would draw), and
  no drawn line segment spans a source `NaN`

#### Scenario: The single-payload path uses the shared rule
- **GIVEN**: the source of `canvas2d/canvas2d-renderer.ts`
- **WHEN**: it is inspected
- **THEN**: it imports neither `lttb` nor `minMaxEnvelopeIndices` from `@trace-kit/core`, and both
  the single-payload and the per-trace decimation steps call `decimateTraceIndices`

#### Scenario: A feasible single payload is unchanged
- **GIVEN**: `setData` with a gap-free 100,000-sample payload above the threshold
- **WHEN**: `render()` runs
- **THEN**: `lttb` is invoked once, `minMaxEnvelopeIndices` is not invoked, and the drawn index set
  equals the one `lttb` alone produced before this change

### Requirement: Isolated Samples Are Painted as Filled Square Markers by Default
The marker rule is unchanged for Canvas2D and is now a shared rule: the isolated-segment
definition and the side `s = 2 * lineWidthCss * dpr` MUST be implemented once in a module
importable by both backends. An *isolated segment* is a finite segment (per
`gap-sentinel-semantics`, with the same breaks `buildTracePath` applies, including a sample `<= 0`
on a log axis) that references exactly one distinct source index: on the direct path a segment of
length 1, on the decimated path a segment whose non-`-1` indices are all equal. For every isolated
segment of a trace whose resolved `markIsolatedSamples` is `true` (default when the style omits
it), `Canvas2DRenderer` MUST paint an axis-aligned filled square centered on `(px, py)`, the same
clamped, edge-mapped coordinates `buildTracePath` would produce for that sample (equal to
`(projectX(t, x[i]), projectY(t, y[i]))` inside the guard rectangle), with side `s`, issued as
`rect(px - s / 2, py - s / 2, s, s)` on a marker `Path2D` distinct from the trace's line `Path2D`,
filled with exactly one `fill(markerPath)` call per trace after that trace's `stroke(linePath)`,
with `fillStyle` set to the trace's resolved stroke color. The marker MUST NOT be stroked. The
renderer MUST NOT construct a marker `Path2D` nor issue `fillStyle`/`fill` for a trace with zero
isolated segments or `markIsolatedSamples === false`. The isolated-segment count MUST be held in a
typed column allocated in `setTraces` and recomputed only when that trace's decimation memo is
recomputed; the log break depends only on the scale kind of the trace's bound axis, which is fixed
for the life of the trace set, so the memo key does not change. The marker walk and count MUST NOT
allocate, and `buildTracePath`'s signature and call sequence MUST remain as specified.
`TraceDrawingContext` MUST expose `fill(path: Path2D): void`. `exportToSvg` and the WebGL2 upload
use the same isolated-segment definition, and `exportToSvg` uses the same `s` with `dpr = 1`.

#### Scenario: An isolated sample on the direct path produces one marker
- **GIVEN**: a trace below the decimation threshold with `y = [NaN, 2, 3, NaN, 5, NaN, 2, 3]`, default
  style, `lineWidthCss = 1`, `dpr = 2`, and a fake `TraceDrawingContext`
- **WHEN**: `render()` is called
- **THEN**: the marker sink records exactly one `rect` with arguments `(px - 2, py - 2, 4, 4)`
  for sample `4` (the only isolated sample; indices `1`-`2` and `6`-`7` are two-sample
  segments and produce no marker), and the context records `stroke`, then `fillStyle` equal to the trace color,
  then exactly one `fill` for that trace

#### Scenario: An isolated sample on the decimated path produces one marker
- **GIVEN**: a trace above the threshold whose decimated stream contains one segment referencing a
  single source index
- **WHEN**: `render()` is called
- **THEN**: exactly one marker `rect` is recorded for that segment and exactly one `fill` for the
  trace

#### Scenario: A segment of two distinct samples produces no marker
- **GIVEN**: a decimated stream `[-1, -1, 5, 3, -1, -1]`
- **WHEN**: the marker walk runs
- **THEN**: zero markers are recorded

#### Scenario: Samples isolated by log non-positive neighbours are marked
- **GIVEN**: the reference log transform with X domain `[0, 2]`, `y = [10, 0, 100]`,
  `x = [0, 1, 2]`, half side `h`
- **WHEN**: the isolated-segment count and marker walk run with that transform
- **THEN**: the count is `2`, and the sink records `rect(50 - h, 200 - h, 2h, 2h)` then
  `rect(450 - h, 100 - h, 2h, 2h)`

#### Scenario: A log non-positive sample is never itself marked
- **GIVEN**: the reference log transform and `y = [NaN, 0, NaN, -Infinity, NaN]`
- **WHEN**: the isolated-segment count runs
- **THEN**: it returns `0`

#### Scenario: An isolated infinite sample is marked at the guard edge
- **GIVEN**: the reference transform (linear), `y = [NaN, +Infinity, NaN]`, `x = [0, 1, 2]`, half
  side `h`
- **WHEN**: the marker walk runs
- **THEN**: it records exactly `rect(150 - h, -65536 - h, 2h, 2h)`, with every argument finite

#### Scenario: Gap-free input produces no marker and an unchanged call sequence
- **GIVEN**: a gap-free trace with more than one sample, direct and decimated
- **WHEN**: `render()` is called
- **THEN**: no marker `Path2D` is constructed and no `fillStyle`/`fill` is recorded for the trace

#### Scenario: The per-trace flag disables markers
- **GIVEN**: the gapped trace with `style.markIsolatedSamples = false`
- **WHEN**: `render()` is called
- **THEN**: no marker `Path2D` is constructed and no `fill` call is recorded for that trace

#### Scenario: Marker rendering is zero-allocation and memoized
- **GIVEN**: a two-trace collection with isolated segments under `--expose-gc`, after warm-up, at
  a fixed revision, threshold and domain
- **WHEN**: `render()` is called 60 times
- **THEN**: the isolated-segment count is computed once per trace in total, with no GC event
  beyond the per-trace `Path2D` constructions already required

#### Scenario: Both backends share the isolated-segment definition
- **GIVEN**: sources of `canvas2d/` and `svg/`
- **WHEN**: they are inspected
- **THEN**: both import the isolated-segment rule and neither re-implements it

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

## ADDED Requirements

### Requirement: The Shared Rules Module Is Backend-Neutral and Isomorphic
The shared rules (`deriveDecimationTarget`, `resolveTraceStyle`, default palette, isolated-segment
definition and marker side, and the guard-band constant `GUARD_BAND_PX = 65536`) MUST live outside
`canvas2d/`, `svg/` and `webgl2/`, MUST import only from `@trace-kit/core` and sibling neutral
modules, and MUST reference no browser global, so they run in Node. `GUARD_BAND_PX` MUST have
exactly one definition, in `src/rules/`; the path walkers and the WebGL2 shader sources MUST take it
from there.

#### Scenario: Shared rules run in Node
- **GIVEN**: a Node unit test without a DOM
- **WHEN**: each shared rule is invoked
- **THEN**: it returns without a `ReferenceError`

#### Scenario: No backend imports
- **GIVEN**: the shared rules module sources
- **WHEN**: their imports are inspected
- **THEN**: none targets `canvas2d/`, `svg/` or `webgl2/`

#### Scenario: The guard band has one definition
- **GIVEN**: `packages/renderers/src/**`
- **WHEN**: it is searched for TypeScript declarations (`const`/`export const`) of
  `GUARD_BAND_PX` and for the literal `65536`
- **THEN**: exactly one TypeScript declaration exists, under `src/rules/`, it equals `65536`, and
  no other file contains the literal (the GLSL `const float GUARD_BAND_PX` is interpolated from it)

### Requirement: A Single-Payload Trace Paints Isolated-Sample Markers
A trace set through `setData` MUST paint isolated-sample markers with the same isolated-segment
rule and side (`2 * lineWidthCss * dpr`) as a collection trace, filled with `style.traceColor`,
issued as one marker `Path2D` and one `fill` after the trace's `stroke`, only when its isolated
count is `> 0`. The isolated count MUST be memoized with the decimation result (no per-frame walk).
Markers are always on for a single payload (it carries no `TraceStyle`). A gap-free single payload
MUST keep its pre-change call sequence.

#### Scenario: A gapped single payload paints its isolated sample
- **GIVEN**: `setData` with `y = [NaN, 2, 3, NaN, 5, NaN, 2, 3]` below threshold, `lineWidthCss 1`, `dpr 2`
- **WHEN**: `render()` runs
- **THEN**: one marker `rect(px - 2, py - 2, 4, 4)` and one `fill` with `fillStyle === traceColor`
  follow the line `stroke`

#### Scenario: Gap-free single payload is unchanged
- **GIVEN**: a gap-free single payload
- **WHEN**: `render()` runs
- **THEN**: no marker `Path2D` or `fill` is recorded

### Requirement: Traces and Isolated-Sample Markers Are Clipped to the Plot Rectangle
`Canvas2DRenderer.render()` MUST confine every trace stroke and every isolated-sample marker fill
to the plot rectangle of the primary transform (`transform.plotLeft`, `plotTop`, `plotWidth`,
`plotHeight`, device pixels, exact values, not widened to whole pixels), using a context clip.
Each `render()` call MUST issue, exactly once and unconditionally (whether or not any trace is
drawn), the sequence `save()`, `beginPath()`, `rect(plotLeft, plotTop, plotWidth, plotHeight)`,
`clip()` after the last gridline stroke and before the first trace call, and exactly one
`restore()` after the last trace or marker call and before the first axis call. Gridlines and axes
MUST NOT be clipped. The single-payload (`setData`) branch and the collection (`setTraces`) branch
MUST share this one clip; a collection MUST NOT issue one clip per trace. The clip MUST use the
context's current default path: it MUST NOT construct a `Path2D` or any other object, so the
per-trace `Path2D` count of "Exactly One `Path2D` Is Constructed Per Trace Per `render()` Call" is
unchanged. Axes MUST still be stroked with a solid line after `restore()`, and every context state
an axis painter relies on (stroke style, line width, font, text alignment, line dash) MUST be the
state that painter sets or the solid state restored, never a trace's. Because trace dashes are set
only inside the `save()`/`restore()` bracket, `restore()` returns the line dash to the solid state
in effect at `save()`; `render()` MUST therefore no longer issue the two `setLineDash(EMPTY_DASH)`
resets (the one before the gridlines and the one after the trace section), and it MUST NOT set a
line dash outside the bracket.

`TraceDrawingContext` MUST expose `save(): void`, `restore(): void`,
`rect(x: number, y: number, w: number, h: number): void` and `clip(): void`, so that both
`CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` still satisfy it without a cast,
and the Node `RecordingContext` MUST record these four calls with their arguments.

#### Scenario: The clip brackets the trace section of a single payload
- **GIVEN**: a `Canvas2DRenderer` on a `RecordingContext`, `setData` with a gap-free 100-sample
  payload, `resize(800, 400, 2)` and a domain covering the payload
- **WHEN**: `render()` is called
- **THEN**: the recorded calls contain exactly one `save`, one `clip` and one `restore`; the four
  calls `save`, `beginPath`, `rect(t.plotLeft, t.plotTop, t.plotWidth, t.plotHeight)`, `clip` are
  consecutive; they follow the last gridline `stroke()` and precede the trace's `stroke(path)`;
  and `restore` follows the trace's `stroke(path)` and precedes the first call issued by the bottom
  axis painter

#### Scenario: A multi-trace collection shares one clip
- **GIVEN**: a `TraceCollection` with 3 trace entries, one of which has an isolated sample
- **WHEN**: `render()` is called once on a `RecordingContext`
- **THEN**: exactly one `save`/`clip`/`restore` is recorded, all three `stroke(path)` calls and
  the marker `fill(path)` lie between `clip` and `restore`, and exactly 4 `Path2D` instances are
  constructed (3 lines and 1 marker path)

#### Scenario: An empty frame still issues the clip once
- **GIVEN**: a renderer with no payload set
- **WHEN**: `render()` is called twice
- **THEN**: each call records exactly one `save`, `clip` and `restore`, and no `stroke(path)`

#### Scenario: The axes are stroked solid after restore
- **GIVEN**: a collection whose only trace has `style.dash = [6, 3]`
- **WHEN**: `render()` is called on a `RecordingContext` that models `save`/`restore` of the line
  dash
- **THEN**: the line dash in effect at the first axis `stroke()` is empty

#### Scenario: The context types still satisfy TraceDrawingContext
- **GIVEN**: `const a: TraceDrawingContext = canvas.getContext("2d")!` for an `HTMLCanvasElement`
  and for an `OffscreenCanvas`
- **WHEN**: `tsc --noEmit` runs
- **THEN**: both assignments type-check with no cast, and `acquire2dContext` still compiles
  without one

#### Scenario: Out-of-window samples leave the left gutter blank in a real browser
- **GIVEN**: a Chromium canvas at `dpr 1`, a 4096-sample payload with a flat trace at `y = 0.5`,
  `xOrigin 0`, offsets `0..4095`, and the domain `[1748, 2348] x [0, 1]`
- **WHEN**: `Canvas2DRenderer.render()` runs
- **THEN**: no pixel in the columns left of `floor(transform.plotLeft) - ceil(lineWidthCss * dpr)`
  and outside every label ink box (`webgl2-golden-parity`: the tick label's `measureText` bounds at
  the painters' `fillText` anchor, grown by 2 device pixels) is within `INK_DELTA` of the trace
  color, while the plot interior on row `projectY(0.5)` has trace ink

#### Scenario: Existing goldens pass without regeneration
- **GIVEN**: the committed Canvas2D, WebGL2 and SVG goldens, untouched by this change
- **WHEN**: `pnpm --filter @trace-kit/renderers test:visual` runs without `--update` in the
  `mcr.microsoft.com/playwright:v1.63.0-noble` container, and `pnpm --filter
  @trace-kit/renderers test` runs without `TRACEKIT_UPDATE_SVG_GOLDENS`
- **THEN**: both exit `0`, and `git status --porcelain` lists no file under
  `packages/renderers/test/visual/__screenshots__/` or `packages/renderers/test/svg-goldens/`

### Requirement: ±Infinity Samples Reach the Plot Edge and Every Projected Coordinate Is Clamped to the Guard Band
`buildTracePath` and the isolated-segment walk MUST classify each walked sample before projecting
it, by comparing the sample value (no NaN or infinity arithmetic):

- `y === +Infinity` on a linear or log axis, and `y === -Infinity` on a linear axis, is a real
  over-range reading (`gap-sentinel-semantics`) and MUST be drawn, not skipped. Its Y coordinate
  MUST be the guard edge on the side the axis direction implies: for `+Infinity`,
  `plotTop - G` when the axis scale is `>= 0` and `plotTop + plotHeight + G` otherwise; for
  `-Infinity` (linear only), the opposite edge. The edge MUST be chosen from the sign of the
  sample and of the axis scale, never by evaluating `projectY` on the infinite value, so a
  zero-span axis (`yScale === 0` or `yLogScale === 0`) yields a finite edge, not `NaN`.
- Every other drawn sample MUST be projected with `projectX`/`projectY` and then clamped:
  `(clampX(projectX(t, x[j])), clampY(projectY(t, y[j])))`. The X coordinate of an infinite
  sample MUST be clamped the same way. For a sample whose projection lies inside the guard
  rectangle the result MUST equal `projectX`/`projectY` exactly.

No `moveTo`, `lineTo` or marker `rect` argument produced by the walk MAY be non-finite for a sample
it draws. `G` MUST be the single `GUARD_BAND_PX` constant of the shared rules module (see "The
Shared Rules Module Is Backend-Neutral and Isomorphic"). The classification adds only scalar locals
and branches to the walk: the hot-path ESLint ban list and the zero-GC gate continue to apply.

#### Scenario: +Infinity on a linear axis reaches the top guard edge
- **GIVEN**: the reference transform, a counting `PolylineSink`, `x = [0, 1, 2, 3, 4]`,
  `y = [0.5, 0.5, +Infinity, 0.5, 0.5]`, decimation bypassed
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records `moveTo(50, 150)`, `lineTo(150, 150)`, `lineTo(250, -65536)`,
  `lineTo(350, 150)`, `lineTo(450, 150)`, in that order, and nothing else

#### Scenario: -Infinity on a linear axis reaches the bottom guard edge
- **GIVEN**: the same input with `y[2] = -Infinity`
- **WHEN**: `buildTracePath` runs
- **THEN**: the third call is `lineTo(250, 65836)` and the call counts are `1` `moveTo` and `4`
  `lineTo`

#### Scenario: An inverted axis sends +Infinity to the bottom guard edge
- **GIVEN**: the reference transform with the linear Y domain `[1, 0]` (`yScale = -300`) and
  `y = [0.5, 0.5, +Infinity, 0.5, 0.5]`
- **WHEN**: `buildTracePath` runs
- **THEN**: the third call is `lineTo(250, 65836)` and the other Y arguments are `150`

#### Scenario: A zero-span axis maps Infinity to a finite edge
- **GIVEN**: the reference transform with the linear Y domain `[0.5, 0.5]` (`yScale = 0`) and
  `y = [0.5, +Infinity, -Infinity]`
- **WHEN**: `buildTracePath` runs
- **THEN**: the recorded Y arguments are `300`, `-65536` and `65836`, and none is `NaN`

#### Scenario: +Infinity on a log axis reaches the top guard edge
- **GIVEN**: the reference log transform, `x = [0, 1, 2]`, `y = [10, +Infinity, 100]`
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records `moveTo(50, 200)`, `lineTo(150, -65536)`, `lineTo(250, 100)`

#### Scenario: Huge finite values are clamped to the guard rectangle
- **GIVEN**: the reference transform, `x = [0, 1e30, 2]`, `y = [0.5, 1e30, 0.5]` stored in
  `Float32Array`
- **WHEN**: `buildTracePath` runs
- **THEN**: the second call is `lineTo(65986, -65536)`, and every recorded argument is finite

#### Scenario: The renderer draws ±Infinity through the clamped walk
- **GIVEN**: a `Canvas2DRenderer` on a `RecordingContext`, `setData` with
  `y = [0.5, 0.5, +Infinity, 0.5, 0.5]`, domain `[0, 4] x [0, 1]`
- **WHEN**: `render()` is called
- **THEN**: the trace's `RecordingPath2D` holds `1` `moveTo` and `4` `lineTo`, and the third point's
  Y equals `transform.plotTop - 65536`

#### Scenario: ±Infinity reaches the plot edge in a real browser
- **GIVEN**: a Chromium canvas, a linear-axis payload `[0.5, 0.5, +Infinity, 0.5, 0.5]` with
  `x = [0, 1, 2, 3, 4]` and domain `[0, 4] x [0, 1]`, and the same payload with `-Infinity`
- **WHEN**: `Canvas2DRenderer.render()` runs for each
- **THEN**: trace-colored pixels exist in the plot's top row band (`+Infinity`) and bottom row band
  (`-Infinity`) in the columns from `column(1)` to `column(3)` (`column(i)` being the device column
  of sample `i`; the infinite sample is drawn at the guard edge beside its own X, so the two
  segments meeting there cross the plot edge next to samples 1 and 3, and the column of sample 2
  itself is geometrically empty)

#### Scenario: Alternating infinities draw nothing outside the plot rectangle
- **GIVEN**: a Chromium canvas and a 50-sample payload alternating `+Infinity` and `-Infinity`,
  domain `[0, 49] x [-1, 1]`
- **WHEN**: `Canvas2DRenderer.render()` runs
- **THEN**: no pixel outside the plot rectangle grown by `ceil(lineWidthCss * dpr)` and outside
  every label ink box (`webgl2-golden-parity`: the tick label's `measureText` bounds at the
  painters' `fillText` anchor, grown by 2 device pixels) is within `INK_DELTA` of the trace color

#### Scenario: Classification keeps the walk allocation-free
- **GIVEN**: `buildTracePath` driven by a preallocated counting `PolylineSink` over 100,000 samples
  in which every 100th sample is `+Infinity`, every 101st `-Infinity`, decimated to roughly 2x a
  1920px plot width, under `--expose-gc`, after warm-up
- **WHEN**: a `PerformanceObserver({ entryTypes: ["gc"] })` measures the run
- **THEN**: zero GC events are reported, and the hot-path lint block reports no violation in
  `packages/renderers/src/path/**`

### Requirement: A Non-Positive Sample on a Log Axis Lifts the Pen
On a trace whose transform has `yScaleKind === Y_SCALE_KIND_LOG`, a sample with `y <= 0` (`0`,
`-0`, any negative value and `-Infinity`) is unrepresentable and MUST be treated exactly like a
`NaN` gap by `buildTracePath` and by the isolated-segment walk: it ends the current segment, issues
no call, and the next drawable sample starts a new segment with `moveTo`. The test MUST be a value
comparison (`y <= 0`), applied on the direct path and to every non-negative index of a decimated
stream. On a linear axis a sample `<= 0` MUST be drawn as before. `projectY` and the decimators are
unchanged (`scale-logarithmic-transform`, `decimation-lttb`, `decimation-min-max`); only the walk's
reaction changes.

#### Scenario: A zero sample splits a log trace
- **GIVEN**: the reference log transform with X domain `[0, 2]`, a counting `PolylineSink`,
  `x = [0, 1, 2]`, `y = [10, 0, 100]`, decimation bypassed
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records exactly `moveTo(50, 200)` and `moveTo(450, 100)`, and no `lineTo`

#### Scenario: Negative values and -Infinity behave like zero on a log axis
- **GIVEN**: the same transform and `y = [10, -Infinity, 100]`, then `y = [10, -5, 100]`
- **WHEN**: `buildTracePath` runs for each
- **THEN**: each records exactly two `moveTo` calls, no `lineTo`, and no non-finite argument

#### Scenario: A non-positive run splits a log trace into two drawn segments
- **GIVEN**: the reference log transform and `y = [10, 20, -5, 0, 30, 40]` over `x = 0..5`
- **WHEN**: `buildTracePath` runs
- **THEN**: the sink records `2` `moveTo` and `2` `lineTo` calls, and no `lineTo` spans indices
  `2`-`3`

#### Scenario: A linear axis still draws non-positive samples
- **GIVEN**: the reference transform (linear) and `y = [0.5, 0, -0.5]` over `x = [0, 1, 2]`
- **WHEN**: `buildTracePath` runs
- **THEN**: it records `1` `moveTo` and `2` `lineTo` calls

#### Scenario: A non-positive log sample is not bridged in a real browser
- **GIVEN**: a Chromium canvas, a log-axis payload of 60 samples `10 + i` with `y[30] = 0` and
  `y[31] = -5`, domain `[0, 59] x [1, 1000]`
- **WHEN**: `Canvas2DRenderer.render()` runs
- **THEN**: the columns from `column(29) + 5` to `column(32) - 5` of the plot interior hold no
  trace-colored pixel, and the column of sample `10` does
