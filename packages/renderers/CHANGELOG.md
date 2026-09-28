# @trace-kit/renderers

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
