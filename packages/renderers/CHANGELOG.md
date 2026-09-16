# @trace-kit/renderers

## 0.0.1

### Patch Changes

- [`6865e69`](https://github.com/nelomr/trace-kit/commit/6865e6983d1c812279c86e97fe36bfdee7459a85) Thanks [@nelomr](https://github.com/nelomr)! - Add `ViewportTransform` and `selectTicks` to `@trace-kit/core`, and introduce `@trace-kit/renderers`: a headless Canvas2D `FigureRenderer` (trace, grid, and axes) that draws from a `SpectrumDataPayload` without assuming a specific DOM host.

  Add `DecimationSelection`/`resolveDecimationParameter`/`minMaxEnvelopeIndices` to `@trace-kit/core`, and widen `FigureRenderer`/`Canvas2DRenderer` with `setDecimation` so a caller can choose LTTB or min-max decimation (and its own threshold/bucketCount) at runtime instead of always defaulting to LTTB.

- Updated dependencies [[`6865e69`](https://github.com/nelomr/trace-kit/commit/6865e6983d1c812279c86e97fe36bfdee7459a85)]:
  - @trace-kit/core@0.0.7
