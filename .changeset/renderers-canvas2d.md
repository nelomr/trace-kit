---
"@trace-kit/core": patch
"@trace-kit/renderers": patch
---

Add `ViewportTransform` and `selectTicks` to `@trace-kit/core`, and introduce `@trace-kit/renderers`: a headless Canvas2D `FigureRenderer` (trace, grid, and axes) that draws from a `SpectrumDataPayload` without assuming a specific DOM host.

Add `DecimationSelection`/`resolveDecimationParameter`/`minMaxEnvelopeIndices` to `@trace-kit/core`, and widen `FigureRenderer`/`Canvas2DRenderer` with `setDecimation` so a caller can choose LTTB or min-max decimation (and its own threshold/bucketCount) at runtime instead of always defaulting to LTTB.
