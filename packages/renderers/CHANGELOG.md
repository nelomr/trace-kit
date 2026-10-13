# @trace-kit/renderers

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
