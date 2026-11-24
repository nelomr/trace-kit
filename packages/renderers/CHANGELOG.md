# @trace-kit/renderers

## 0.0.11

### Patch Changes

- [`78434d7`](https://github.com/nelomr/trace-kit/commit/78434d7839ed78ac854a784d75ed53061e98b792) Thanks [@nelomr](https://github.com/nelomr)! - Implement WebGL2 context loss lifecycle management and in-place GPU resource rehydration in `SpectrumEngineController` and `WebGL2FigureRenderer`.

  - Add controller-owned lifecycle management for `webglcontextlost` and `webglcontextrestored` on the active WebGL2 plot canvas with mandatory `event.preventDefault()`, render-loop suspension (`requestAnimationFrame` cancellation, idle wakeup suppression, safe `clear()`), `DecimationPort.poll(settlementSink)` buffer drainage preservation, and `contextLost` / `onContextLost` / `onContextRestored` observables (`WebGL2ContextLostEvent`, `WebGL2ContextRestoredEvent`).
  - Implement package-internal in-place WebGL2 GPU resource rehydration seam via `Symbol.for("trace-kit.webgl2.recovery")` in `src/webgl2/rehydrate.ts` without expanding the frozen 11-member `FigureRenderer` interface or `@trace-kit/renderers/webgl2` export surface.
  - Rebuild shader programs, re-query uniform locations, reconstruct VAOs/VBOs, and perform revision-aware GPU buffer re-upload via `slot.gpuDirty` directly from retained CPU data or scratch buffers without re-running decimation.
  - Guard `WebGL2FigureRenderer.render()`, `clear()`, and `dispose()` with `Gl2Context.isContextLost()` to eliminate GL errors, Chromium `INVALID_OPERATION` warnings, and revision stamp poisoning on lost contexts.
  - Harden the 5-step atomic swap with swap-scoped context-loss listener and post-Step-4 verification aborting into deterministic Canvas2D fallback before DOM mutation on mid-switch context loss.
  - Add cross-platform Chromium Playwright visual regression probe for `WEBGL_lose_context` recovery alongside Node and DOM test suites.

## 0.0.10

### Patch Changes

- [`91bb692`](https://github.com/nelomr/trace-kit/commit/91bb6926d4349f149bbc6667e27d19d2755967d1) Thanks [@nelomr](https://github.com/nelomr)! - - Implement pure, DOM-free, allocation-free viewport interaction math (`computeZoomDomain`, `computePanDomain`, `computeBoxZoomDomain`, `clampViewportDomain`, `createPanGestureSnapshot`, `capturePanGestureSnapshot`, `computeUlpMinSpan`, `createMutableViewportDomain`) and decimation-invalidation bridge helpers (`createStreamingInvalidationAdapter`, `createWindowDecimationAdapter`) in `@trace-kit/core`.
  - Implement Option 2A single-axis `yAxes.length === 1` `setDomain` support in `Canvas2DRenderer` and `WebGL2FigureRenderer`, preserving the frozen 11-member `FigureRenderer` contract and multi-axis registrations.
  - Implement framework-agnostic `createViewportInteractionController` composing over `SpectrumEngineController` under `@trace-kit/renderers/controller` with pointer/wheel input normalization (`classifyPointerRegion`, `normalizeWheelDeltaPx`, `resolveWheelAxisMask`), CSS-composited sibling box-zoom overlay (`<div data-trace-kit-overlay="box-zoom">`) with 5-state machine, and frame-budget-debounced invalidation scheduler coordinating `gesture`/`settled` phases with `setGestureActive` hysteresis deferral.
  - Add `/viewport-interaction` view to `@trace-kit/playground` demonstrating pan, cursor-anchored wheel zoom, axis-gutter gestures, Shift+drag box-zoom, deep zoom near 1550.0001 nm, single-axis log-Y interaction, live debounced re-decimation, and telemetry HUD.
- Updated dependencies [[`91bb692`](https://github.com/nelomr/trace-kit/commit/91bb6926d4349f149bbc6667e27d19d2755967d1)]:
  - @trace-kit/core@0.0.13

## 0.0.9

### Patch Changes

- [`d0bc2a8`](https://github.com/nelomr/trace-kit/commit/d0bc2a8c2c761d0ec5d5fb659032ea0a38852536) Thanks [@nelomr](https://github.com/nelomr)! - Implement the dual-engine controller (`@trace-kit/renderers/controller`) and the `/engine-controller` interactive view in `@trace-kit/playground`.

  **Renderers (`@trace-kit/renderers`).**

  - **Controller subpath & lifecycle management:** Add `SpectrumEngineController` and `createSpectrumEngineController` in a dedicated, tree-shakable `@trace-kit/renderers/controller` entry point (keeping root `"."` free of WebGL2 and `./controller` free of `./svg` and `./font` bundles), supporting `"auto" | "canvas2d" | "webgl2"` modes, `setData` / `setTraces` with in-place `payload.revision` tracking and `xOrigin` reconciliation, zero-allocation `setDomain`, `setDecimation(undefined)` backend-default preservation, optional `DecimationPort.poll(settlementSink)` drainage, `ResizeObserver` auto-resizing, `requestAnimationFrame` coalescing, and idempotent `dispose()`.
  - **Hysteresis policy & gesture deferral:** Export pure hysteresis helpers (`DEFAULT_HYSTERESIS_CONFIG`, `resolveHysteresisConfig`, `classifyHysteresisBand`, `evaluateHysteresisTarget`, `computePayloadSampleCount`, `computeTracesSampleCount`) with configurable two-threshold deadband (`upThreshold = 80_000`, `downThreshold = 64_000`, `0 < downThreshold < upThreshold`) and `setGestureActive(boolean)` mid-gesture switch deferral.
  - **Zero-flicker atomic DOM swap & leak-free WebGL2 fallback:** Stage incoming 1-canvas (`Canvas2DRenderer`) or 3-stacked-canvas (`WebGL2FigureRenderer`) surfaces off-DOM, replay authoritative state (`resize` -> `setData`/`setTraces` -> `setDomain` -> `setDecimation`), pre-render synchronously, swap DOM nodes preserving sibling overlay z-order via `insertBefore`, and dispose the outgoing renderer synchronously; on WebGL2 construction, replay, or pre-render failure, dispose any partial incoming renderer, latch `webgl2Fallback`, mount `Canvas2DRenderer`, and notify `onWebGL2Fallback` / `onEngineChange`.

  **Playground (`@trace-kit/playground`).**

  - **Interactive `/engine-controller` view:** Register `/engine-controller` via the additive route registry with sample-count presets (`10k`–`250k`) and slider across the `64k ↔ 80k` hysteresis deadband, mode override (`auto` / `canvas2d` / `webgl2`), decimation controls, gesture-lock deferral toggle, simulated WebGL2 failure fallback toggle, and a live 9-field telemetry HUD.

## 0.0.8

### Patch Changes

- Updated dependencies [[`c764e9c`](https://github.com/nelomr/trace-kit/commit/c764e9cc427367a52353e441637b3910fa0b7d61)]:
  - @trace-kit/core@0.0.12

## 0.0.7

### Patch Changes

- [`cce4290`](https://github.com/nelomr/trace-kit/commit/cce429069f73ad214ba3ade0d99919917be97c10) Thanks [@nelomr](https://github.com/nelomr)! - Canvas2D, SVG export and WebGL2 now agree on traces that leave the plot, on infinite samples and on
  log-axis samples that cannot be drawn. Canvas2D no longer paints trace ink outside the plot
  rectangle, and the three backends share one rule for each of these cases.

  **Canvas2D: plot clipping.** Traces and isolated-sample markers are clipped to the plot rectangle,
  so a payload that extends past the visible X domain (or below a log axis) no longer paints into the
  axis gutters. The axes, tick marks and labels are drawn afterwards and stay unclipped. The clip is
  one `save` / `clip` / `restore` bracket per frame with no extra allocation.

  **Canvas2D and SVG: `±Infinity`.** A `+Infinity` or `-Infinity` Y sample is drawn to the plot edge
  (top for `+Infinity`, bottom for `-Infinity` on an ascending axis, mirrored on an inverted one)
  instead of being bridged on Canvas2D. SVG used to write the non-finite coordinate as `0`, which put
  a linear `-Infinity` at the top of the document; it now reaches the plot edge too. Coordinates are
  clamped to a guard band so no non-finite number reaches the path.

  **All engines: log-axis `y <= 0`.** On a logarithmic Y axis a sample that is `0` or negative lifts
  the pen like a gap on Canvas2D and SVG (WebGL2 already collapsed it), and a sample isolated by such
  a gap now gets an isolated-sample marker on every engine. Marker output on WebGL2 and in exported
  SVG therefore changes for log-axis input that contains non-positive samples; linear axes and
  positive log samples are unchanged, and no committed golden needs regenerating.

  **Canvas2D: single-payload decimation.** `setData` now goes through the same decimation rule as the
  trace-collection path, so when LTTB is infeasible for a fragmented payload it falls back to the
  min-max envelope, as WebGL2 and SVG already did.

  **Migration.** `TraceDrawingContext` gains `save()`, `restore()`, `rect(x, y, w, h)` and `clip()`.
  A custom context passed to `Canvas2DRenderer` must provide them; `CanvasRenderingContext2D` and
  `OffscreenCanvasRenderingContext2D` already do. The only recorded divergence left between Canvas2D
  and WebGL2 is that a trace `dash` style is ignored on WebGL2.

## 0.0.6

### Patch Changes

- [`e5cb27e`](https://github.com/nelomr/trace-kit/commit/e5cb27e78ac9ca7bb322df9124e5c0cd23f0e1d1) Thanks [@nelomr](https://github.com/nelomr)! - The X domain now lives in one space everywhere: absolute physical X (`xOrigin + x[i]`). Before,
  the projection, ticks and GPU path read it as payload offsets while the export window, CSV and
  `.npy` read it as absolute X, so a payload with a non-zero `xOrigin` was drawn over one range and
  exported from another.

  **Migration.** Payloads with `xOrigin = 0` are unaffected: projection, ticks, gridlines, uniforms
  and exports are bit-identical. If you passed offsets as the domain for a payload with a non-zero
  `xOrigin`, add `xOrigin` to both bounds.

  **Core.**

  - `ViewportTransform` gains `xOffsetMin` (`xDomainMin - xOrigin`, binary64, computed once at
    construction; construction throws if it overflows). It now has 19 fields.
  - `projectX(t, xOffset)` keeps its signature and its payload-offset input, and now subtracts
    `xOffsetMin`, so the hot loop stays one subtraction and one multiplication.
  - `unprojectX` returns absolute X, the same space as `xDomainMin`.
  - `TraceCollection.xDomainMin`/`xDomainMax` are documented as absolute X, shared by entries with
    different `xOrigin`.

  **Renderers.**

  - `setDomain` bounds and `TraceCollection` X bounds are absolute X. X tick labels show absolute
    values, and traces with different `xOrigin` in one collection are placed at their physical X.
  - Gridlines and tick marks are computed once in the shared layout from the absolute domain and
    no longer depend on any trace's origin.
  - WebGL2: the uniform `u_xOrigin` is renamed `u_xOffsetMin` and carries the hi/lo split of
    `xOffsetMin`, so deep zooms keep their float32 precision under a non-zero origin.
  - `setTraces` resets the origin remembered from a previous `setData`, so a collection never
    inherits a stale single-payload origin.
  - The `overlay-two-axis` fixture's log trace keeps `xOrigin = 1000` with offsets `-1000..-701`,
    so its absolute X matches the linear trace and its CSV/`.npy` are no longer empty for the
    default window. No golden changes.

- Updated dependencies [[`e5cb27e`](https://github.com/nelomr/trace-kit/commit/e5cb27e78ac9ca7bb322df9124e5c0cd23f0e1d1)]:
  - @trace-kit/core@0.0.11

## 0.0.5

### Patch Changes

- [`45a6308`](https://github.com/nelomr/trace-kit/commit/45a63087a6a1af55f110c1ec23809935559dc385) Thanks [@nelomr](https://github.com/nelomr)! - Adds SVG export, raw-data viewport export and a WebGL2 renderer.

  **Renderers: SVG export.** `exportToSvg(scene, options?)` behind the new `@trace-kit/renderers/svg`
  subpath is a pure, DOM-free function that returns a standalone, byte-deterministic SVG document
  (paths built from `M`/`L` only, gaps never bridged, isolated samples as filled squares, labels as
  real `<text>`, plot area clipped). Axes, ticks, labels, the decimation budget, trace style and the
  isolated-sample rule come from the same shared layout and rules modules Canvas2D now uses, so the
  backends cannot drift. Font embedding is opt-in through `embedFont`, with
  `TRACEKIT_INTER_EMBEDDED_FONT` exported from `@trace-kit/renderers/font`. `SCENARIO_FIXTURES`
  becomes a discriminated union (`kind: "payload" | "collection"`) and gains
  `PARITY_SCENARIO_FIXTURES` and `SVG_EXTENDED_SCENARIO_FIXTURES`.

  **Renderers: Canvas2D output changes in three declared ways.**

  - Each registered Y axis is drawn in its own stacked column instead of all of them overlapping at
    the innermost one.
  - Axis lines and tick marks are stroked at the new `AxisLayout.axisLineWidthCss` (default `1.5`)
    instead of inheriting the width the last trace left on the context; the last trace's dash no
    longer leaks onto the axes.
  - A single payload paints isolated-sample markers, as a collection trace already did, and axis
    label fonts are scaled by the device pixel ratio.

  **Core: raw-data viewport export.** X windows are read from the authoritative samples and never
  decimated.

  - `resolveSampleWindow(payload, xMin, xMax, out, options?)` and `createSampleSpan()` map a domain
    range to the half-open index span `[start, end)` of one payload, decided on the f64 absolute X
    (`xOrigin + x[i]`) by lower/upper-bound binary search, with an opt-in one-sample neighbour
    extension. It is allocation-free, never throws and always returns
    `0 <= start <= end <= sampleCount`; ascending X is a documented precondition.
  - `exportCsv(source, xMin, xMax, options?)` is a lazy synchronous generator of string chunks of a
    tidy `trace_id,x,y` document: absolute X, shortest round-trip numbers, `NaN` for gaps,
    `Infinity` / `-Infinity` literals, RFC 4180 quoting of ids, locale-independent.
  - `BinaryArrayExport` is the format-agnostic contract of a binary export: a synchronous generator of
    `Uint8Array` chunks, each valid only until the next `next()`. `exportNpy(payload, "x" | "y", xMin,
xMax, options?)` writes a NumPy `.npy` v1.0 file per array (X as `<f8` absolute, Y as stored
    `<f4`), little-endian on any host. HDF5, `.npz`, `.mat` and Parquet are deferred.

  **Renderers: WebGL2.** `WebGL2FigureRenderer` behind the new `@trace-kit/renderers/webgl2` subpath
  draws every sample on the GPU as instanced line quads (edges anti-aliased by coverage, gaps and
  isolated samples preserved, linear and log Y, multi-trace and multi-axis). It takes three
  caller-supplied, distinct canvases stacked in one CSS box (`surfaces: { underlay, plot, overlay }`):
  an opaque 2D underlay for background and gridlines, a transparent WebGL2 plot canvas and a
  transparent 2D overlay for axes and labels. The X origin is passed to the shader as a hi/lo float32
  pair derived in Float64, so deep zooms stay within 0.01 device pixels of the Float64 projection.

  `setDecimation(undefined)` now restores the backend's own default: Canvas2D still decimates with
  LTTB to a plot-width budget, WebGL2 draws the full payload. An explicit selection runs the same core
  decimators on both. Recorded divergences from Canvas2D: a trace `dash` is ignored on WebGL2, traces
  are scissored to the plot rectangle, and a `+-Infinity` Y sample reaches the plot edge through a
  guard band.

  **Playground.** The SVG export view gains CSV and `.npy` downloads of the current window, and a new
  `/engine-parity` route draws one shared fixture on Canvas2D and WebGL2 side by side with each
  engine's vertex count.

- Updated dependencies [[`45a6308`](https://github.com/nelomr/trace-kit/commit/45a63087a6a1af55f110c1ec23809935559dc385)]:
  - @trace-kit/core@0.0.10

## 0.0.4

### Patch Changes

- [`2f9de6d`](https://github.com/nelomr/trace-kit/commit/2f9de6dbabdc8faa56b8dee8d771036cd6a2c0bf) Thanks [@nelomr](https://github.com/nelomr)! - Define `NaN` in a Y buffer as a gap sentinel that no decimator or renderer may bridge:
  `lttb` and `minMaxEnvelope`/`minMaxEnvelopeIndices` now preserve a gap through decimation
  instead of silently absorbing it into a neighbouring bucket, emitting `-1`/`NaN` break markers
  consumers can detect without re-scanning the source buffer. Gap-free input is unchanged —
  `lttb`'s single-traversal path and both min-max functions' output are byte-identical to before
  this change.

  Adds `TraceCollection` to `@trace-kit/core`: an ordered, frozen set of `SpectrumDataPayload`
  entries sharing one X domain, each bound to a `YAxisRegistration.id` with its own style.

  `Canvas2DRenderer` gains `setTraces(collection)`, drawing one `Path2D` per trace against its
  own resolved transform and style, with per-trace decimation memoization (a revision bump on one
  trace never re-decimates its siblings) and a `minMaxEnvelopeIndices` fallback when `lttb` cannot
  represent a trace's gaps within its threshold. `setData(payload)` keeps its existing single-trace
  behavior unchanged. A finite segment that resolves to exactly one source sample (an isolated
  sample between two gaps) is painted as a filled square marker by default, so a real measured
  sample is never silently invisible; opt out per trace via `TraceStyle.markIsolatedSamples`.

- Updated dependencies [[`2f9de6d`](https://github.com/nelomr/trace-kit/commit/2f9de6dbabdc8faa56b8dee8d771036cd6a2c0bf)]:
  - @trace-kit/core@0.0.9

## 0.0.3

### Patch Changes

- [`b14d389`](https://github.com/nelomr/trace-kit/commit/b14d389546e316ba2487db7253c30fa8f21cef3c) Thanks [@nelomr](https://github.com/nelomr)! - Generalize the viewport transform to support a base-10 logarithmic Y scale
  (`Y_SCALE_KIND_LOG`) with a total, finite inverse, and N independent Y axes sharing one X
  domain (`createAxisTransforms`, `YAxisRegistration`). Adds `selectLogTicks`, a fully
  transcendental-free decade tick selector with a non-empty-result guarantee. The existing
  linear, single-axis path is unchanged — every field, coefficient and rendered pixel stays
  byte-identical.

  `@trace-kit/renderers`'s `Canvas2DRenderer` gains an optional `yAxes` registration list
  (`computeAxisInsets` now takes a `yAxisCount`), painting N left-stacked axes with decade
  gridlines for a log-kind axis, dispatching to `selectLogTicks` or `selectTicks` per axis.

- Updated dependencies [[`b14d389`](https://github.com/nelomr/trace-kit/commit/b14d389546e316ba2487db7253c30fa8f21cef3c)]:
  - @trace-kit/core@0.0.8

## 0.0.2

### Patch Changes

- [`8b0b8d8`](https://github.com/nelomr/trace-kit/commit/8b0b8d861032e176e96ea11085bbe96b88af8d7b) Thanks [@nelomr](https://github.com/nelomr)! - `DEFAULT_FIGURE_STYLE.font` no longer requests the generic `sans-serif` family — it requests `"TraceKit Inter"`, a self-hosted subset of Inter Regular (SIL OFL 1.1) shipped and embedded in the package itself.

  **This changes the default rendered output for every consumer who does not already override `style.font`.** Axis-label glyph shapes will look different after this upgrade, since they now come from a fixed embedded font instead of whatever `sans-serif` resolves to on the host operating system. A consumer who wants the previous behaviour back can set `style: { ...DEFAULT_FIGURE_STYLE, font: '10px sans-serif' }` explicitly.

  `TRACEKIT_INTER_FAMILY` is exported from the package root. The font subset itself, and the `ensureDefaultFont()` helper that registers it with `document.fonts` for a DOM-attached consumer, are exported from the new `@trace-kit/renderers/font` subpath — the renderer itself never imports or calls either, since it stays DOM-free and paints on `OffscreenCanvas` in a worker.

## 0.0.1

### Patch Changes

- [`6865e69`](https://github.com/nelomr/trace-kit/commit/6865e6983d1c812279c86e97fe36bfdee7459a85) Thanks [@nelomr](https://github.com/nelomr)! - Add `ViewportTransform` and `selectTicks` to `@trace-kit/core`, and introduce `@trace-kit/renderers`: a headless Canvas2D `FigureRenderer` (trace, grid, and axes) that draws from a `SpectrumDataPayload` without assuming a specific DOM host.

  Add `DecimationSelection`/`resolveDecimationParameter`/`minMaxEnvelopeIndices` to `@trace-kit/core`, and widen `FigureRenderer`/`Canvas2DRenderer` with `setDecimation` so a caller can choose LTTB or min-max decimation (and its own threshold/bucketCount) at runtime instead of always defaulting to LTTB.

- Updated dependencies [[`6865e69`](https://github.com/nelomr/trace-kit/commit/6865e6983d1c812279c86e97fe36bfdee7459a85)]:
  - @trace-kit/core@0.0.7
