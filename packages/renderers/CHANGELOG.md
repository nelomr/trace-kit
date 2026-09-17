# @trace-kit/renderers

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
