# Capability: canvas2d-trace-rendering

> Change: `renderers-canvas2d`. New capability.
>
> Source: `design.md` §D5 (identity CTM, per-frame `Path2D`), §D6 (decimation call boundary),
> §D7 (`PolylineSink`), §D8 (zero-allocation assertion mechanism and the honest gap: no test in
> this change asserts a painted pixel because happy-dom's `getContext("2d")` returns `null`).
> Requirements here are written against what §D8 states IS asserted: call sequence against a
> fake context, exact work counts, and the allocation gate — never against rasterized pixel
> output.

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
`Canvas2DRenderer` MUST derive its decimation threshold as
`min(sampleCount, max(2, ceil(transform.plotWidth * 2)))` — twice the plot area's device-pixel
width — and MUST recompute it whenever `transform.plotWidth` changes. When `sampleCount` is less
than or equal to that threshold, the renderer MUST bypass decimation and walk the direct sample
range `[0, sampleCount)` rather than invoking `lttb`.

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
- **THEN**: `lttb` is invoked exactly once with `threshold === T`, and returns indices consumed
  by `buildTracePath`

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
