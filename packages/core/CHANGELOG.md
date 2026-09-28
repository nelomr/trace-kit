# @trace-kit/core

## 0.0.9

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

## 0.0.8

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
