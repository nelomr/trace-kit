---
"@trace-kit/core": patch
"@trace-kit/renderers": patch
"@trace-kit/playground": patch
---

Adds SVG export, raw-data viewport export and a WebGL2 renderer.

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
