# @trace-kit/core

## 0.0.7

### Patch Changes

- [`6865e69`](https://github.com/nelomr/trace-kit/commit/6865e6983d1c812279c86e97fe36bfdee7459a85) Thanks [@nelomr](https://github.com/nelomr)! - Add `ViewportTransform` and `selectTicks` to `@trace-kit/core`, and introduce `@trace-kit/renderers`: a headless Canvas2D `FigureRenderer` (trace, grid, and axes) that draws from a `SpectrumDataPayload` without assuming a specific DOM host.

  Add `DecimationSelection`/`resolveDecimationParameter`/`minMaxEnvelopeIndices` to `@trace-kit/core`, and widen `FigureRenderer`/`Canvas2DRenderer` with `setDecimation` so a caller can choose LTTB or min-max decimation (and its own threshold/bucketCount) at runtime instead of always defaulting to LTTB.

## 0.0.6

### Patch Changes

- [`e31a3bb`](https://github.com/nelomr/trace-kit/commit/e31a3bb21e73f162a034e7e5f08c98076142809e) Thanks [@nelomr](https://github.com/nelomr)! - Fix `minMaxEnvelope`'s missing `out.length` boundary check (it now throws `RangeError` on an undersized output buffer, matching `lttb`) and split `bench/runner.ts` into an isomorphic `bench/runner-core.ts` half (no `node:*` import) plus the existing Node-coupled reporting half, so the shared benchmark harness is reachable from a browser bundle.

## 0.0.5

### Patch Changes

- [`923f5a4`](https://github.com/nelomr/trace-kit/commit/923f5a402f816380b1c35a954a0be763742ccd28) Thanks [@nelomr](https://github.com/nelomr)! - Add the `DecimationPort` transport contract: a pooled single-ownership buffer round trip with a synchronous in-thread default implementation, drop-and-count backpressure, bounded failure recovery, and the frozen streaming-contract types for incremental decimation.

## 0.0.4

### Patch Changes

- [`3b83a2d`](https://github.com/nelomr/trace-kit/commit/3b83a2da297b0cceb8384a914b0d70d8ff146c9f) Thanks [@nelomr](https://github.com/nelomr)! - Add `minMaxEnvelope` and `lttb` decimation algorithms, a branded typed-buffer vocabulary, and `SpectrumDataPayload`, each allocation-free on the hot path and enforced by a loop-scoped lint rule and a GC-event gate.

## 0.0.3

### Patch Changes

- [`c254f5a`](https://github.com/nelomr/trace-kit/commit/c254f5acbad2c8616308bd7e36f203f3e18aa6d4) Thanks [@nelomr](https://github.com/nelomr)! - chore(scripts): migrate catalog-discipline/no-root-exports guards to Vitest, fix JSONC fail-open, derive changelog package list from workspace globs, require add-changeset message

## 0.0.2

### Patch Changes

- [`4fd9a13`](https://github.com/nelomr/trace-kit/commit/4fd9a13ea1db037e5b3d4b6cc5ac48a27c6b602e) Thanks [@nelomr](https://github.com/nelomr)! - Add the workspace test harness: Vitest, ESLint, tsup dual-format build, benchmark harness, and CI wiring for @trace-kit/core

## 0.0.1

### Patch Changes

- [`1cd3f44`](https://github.com/nelomr/trace-kit/commit/1cd3f441df5d5f5d1478ff9c05554ee95ed5e8bb) Thanks [@nelomr](https://github.com/nelomr)! - setup automated changeset workflow and initialize core package
