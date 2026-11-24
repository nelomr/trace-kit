# @trace-kit/playground

## 0.0.12

### Patch Changes

- Updated dependencies [[`78434d7`](https://github.com/nelomr/trace-kit/commit/78434d7839ed78ac854a784d75ed53061e98b792)]:
  - @trace-kit/renderers@0.0.11

## 0.0.11

### Patch Changes

- [`91bb692`](https://github.com/nelomr/trace-kit/commit/91bb6926d4349f149bbc6667e27d19d2755967d1) Thanks [@nelomr](https://github.com/nelomr)! - - Implement pure, DOM-free, allocation-free viewport interaction math (`computeZoomDomain`, `computePanDomain`, `computeBoxZoomDomain`, `clampViewportDomain`, `createPanGestureSnapshot`, `capturePanGestureSnapshot`, `computeUlpMinSpan`, `createMutableViewportDomain`) and decimation-invalidation bridge helpers (`createStreamingInvalidationAdapter`, `createWindowDecimationAdapter`) in `@trace-kit/core`.
  - Implement Option 2A single-axis `yAxes.length === 1` `setDomain` support in `Canvas2DRenderer` and `WebGL2FigureRenderer`, preserving the frozen 11-member `FigureRenderer` contract and multi-axis registrations.
  - Implement framework-agnostic `createViewportInteractionController` composing over `SpectrumEngineController` under `@trace-kit/renderers/controller` with pointer/wheel input normalization (`classifyPointerRegion`, `normalizeWheelDeltaPx`, `resolveWheelAxisMask`), CSS-composited sibling box-zoom overlay (`<div data-trace-kit-overlay="box-zoom">`) with 5-state machine, and frame-budget-debounced invalidation scheduler coordinating `gesture`/`settled` phases with `setGestureActive` hysteresis deferral.
  - Add `/viewport-interaction` view to `@trace-kit/playground` demonstrating pan, cursor-anchored wheel zoom, axis-gutter gestures, Shift+drag box-zoom, deep zoom near 1550.0001 nm, single-axis log-Y interaction, live debounced re-decimation, and telemetry HUD.
- Updated dependencies [[`91bb692`](https://github.com/nelomr/trace-kit/commit/91bb6926d4349f149bbc6667e27d19d2755967d1)]:
  - @trace-kit/core@0.0.13
  - @trace-kit/renderers@0.0.10

## 0.0.10

### Patch Changes

- [`d0bc2a8`](https://github.com/nelomr/trace-kit/commit/d0bc2a8c2c761d0ec5d5fb659032ea0a38852536) Thanks [@nelomr](https://github.com/nelomr)! - Implement the dual-engine controller (`@trace-kit/renderers/controller`) and the `/engine-controller` interactive view in `@trace-kit/playground`.

  **Renderers (`@trace-kit/renderers`).**

  - **Controller subpath & lifecycle management:** Add `SpectrumEngineController` and `createSpectrumEngineController` in a dedicated, tree-shakable `@trace-kit/renderers/controller` entry point (keeping root `"."` free of WebGL2 and `./controller` free of `./svg` and `./font` bundles), supporting `"auto" | "canvas2d" | "webgl2"` modes, `setData` / `setTraces` with in-place `payload.revision` tracking and `xOrigin` reconciliation, zero-allocation `setDomain`, `setDecimation(undefined)` backend-default preservation, optional `DecimationPort.poll(settlementSink)` drainage, `ResizeObserver` auto-resizing, `requestAnimationFrame` coalescing, and idempotent `dispose()`.
  - **Hysteresis policy & gesture deferral:** Export pure hysteresis helpers (`DEFAULT_HYSTERESIS_CONFIG`, `resolveHysteresisConfig`, `classifyHysteresisBand`, `evaluateHysteresisTarget`, `computePayloadSampleCount`, `computeTracesSampleCount`) with configurable two-threshold deadband (`upThreshold = 80_000`, `downThreshold = 64_000`, `0 < downThreshold < upThreshold`) and `setGestureActive(boolean)` mid-gesture switch deferral.
  - **Zero-flicker atomic DOM swap & leak-free WebGL2 fallback:** Stage incoming 1-canvas (`Canvas2DRenderer`) or 3-stacked-canvas (`WebGL2FigureRenderer`) surfaces off-DOM, replay authoritative state (`resize` -> `setData`/`setTraces` -> `setDomain` -> `setDecimation`), pre-render synchronously, swap DOM nodes preserving sibling overlay z-order via `insertBefore`, and dispose the outgoing renderer synchronously; on WebGL2 construction, replay, or pre-render failure, dispose any partial incoming renderer, latch `webgl2Fallback`, mount `Canvas2DRenderer`, and notify `onWebGL2Fallback` / `onEngineChange`.

  **Playground (`@trace-kit/playground`).**

  - **Interactive `/engine-controller` view:** Register `/engine-controller` via the additive route registry with sample-count presets (`10k`–`250k`) and slider across the `64k ↔ 80k` hysteresis deadband, mode override (`auto` / `canvas2d` / `webgl2`), decimation controls, gesture-lock deferral toggle, simulated WebGL2 failure fallback toggle, and a live 9-field telemetry HUD.

- Updated dependencies [[`d0bc2a8`](https://github.com/nelomr/trace-kit/commit/d0bc2a8c2c761d0ec5d5fb659032ea0a38852536)]:
  - @trace-kit/renderers@0.0.9

## 0.0.9

### Patch Changes

- [`c764e9c`](https://github.com/nelomr/trace-kit/commit/c764e9cc427367a52353e441637b3910fa0b7d61) Thanks [@nelomr](https://github.com/nelomr)! - Implement the asynchronous off-thread worker decimation transport (`Transfer` and optional `SharedArrayBuffer` + `Atomics` SPSC fast path) and the incremental `O(new samples)` streaming pipeline.

  **Core (`@trace-kit/core`).**

  - **Worker decimation port & subpaths:** Add `createWorkerDecimationPort`, DOM-free `WorkerLike`/`WorkerFactory`/`WorkerMessageEndpoint` contracts, the effect-free `@trace-kit/core/worker` subpath (`handleDecimationMessage`, `attachDecimationWorker`, `attachCurrentDecimationWorker`), and the isolated `@trace-kit/core/node` `node:worker_threads` adapter (`adaptNodeWorker`, `createNodeParentPortEndpoint`) with compile-time Node type isolation (`tsconfig.node.json`) and zero `node:*` leakage into browser bundles.
  - **Dual backing (`Transfer` + optional `Shared` SPSC):** Add realm-aware `crossOriginIsolated` gating in `selectBufferBacking()` with defensive `DataCloneError` fallback to `Transfer` (zero COOP/COEP requirement for consumers), kind-specific 3-vs-4 buffer Transfer round-trips, and an internal 704-byte cache-line-separated Control SAB + 64-byte-aligned Data SAB SPSC ring with bounded 50 ms `Atomics.wait` teardown, cross-epoch `sabEpoch` safety, unified timeout/crash termination + bounded lazy respawn up to `maxRemintEvents`, and terminal idempotent `dispose()`.
  - **Pool & telemetry updates:** Add `DecimationKind.MinMaxEnvelopeIndices = 2`, enlarge `BufferPool.viewIndices` to `MAX_BUCKETS * 2` (`16,384`), enforce terminal `SATURATED` on `acquire()` after `TransportHealth.Degraded` across all `poolPairs`, track live `LeasesOutstanding` and `OldestInFlightMs`, and convert public transport enums from `const enum` to `enum` (`/* @__PURE__ */`) for `isolatedModules: true` consumers.
  - **Incremental streaming pipeline:** Implement `ingestSample`, `ingestBatch`, Tier 1/2/3 invalidation (`rebuildDomain`, `applyDomainChange`, `projectTier3`), sticky `NaN` gap poisoning (`count[s] = -1`), `xOrigin` offset alignment, and allocation-free `materializeBucketsToPayload` / `materializeTier3ToPayload`.
  - **Dual browser & Node verification:** Add Node `worker_threads` (`--expose-gc` 0-GC) suites plus two headless Playwright Chromium projects (`core-worker-transfer` non-isolated and `core-worker-shared` test-only COOP/COEP) wired into Turborepo and CI.

  **Playground (`@trace-kit/playground`).**

  - Add the interactive `/streaming-transport` view backed by a real ES module Web Worker (`attachCurrentDecimationWorker`), incremental streaming + `Canvas2DRenderer`, reused `TransportStatsView` HUD, Tier 1/2/3 controls, and stall/crash fault injection, lifting the temporary Change 4 ban on transport imports and `new Worker(`.

- Updated dependencies [[`c764e9c`](https://github.com/nelomr/trace-kit/commit/c764e9cc427367a52353e441637b3910fa0b7d61)]:
  - @trace-kit/core@0.0.12
  - @trace-kit/renderers@0.0.8

## 0.0.8

### Patch Changes

- Updated dependencies [[`cce4290`](https://github.com/nelomr/trace-kit/commit/cce429069f73ad214ba3ade0d99919917be97c10)]:
  - @trace-kit/renderers@0.0.7

## 0.0.7

### Patch Changes

- Updated dependencies [[`e5cb27e`](https://github.com/nelomr/trace-kit/commit/e5cb27e78ac9ca7bb322df9124e5c0cd23f0e1d1)]:
  - @trace-kit/core@0.0.11
  - @trace-kit/renderers@0.0.6

## 0.0.6

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
  - @trace-kit/renderers@0.0.5

## 0.0.5

### Patch Changes

- Updated dependencies [[`2f9de6d`](https://github.com/nelomr/trace-kit/commit/2f9de6dbabdc8faa56b8dee8d771036cd6a2c0bf)]:
  - @trace-kit/core@0.0.9
  - @trace-kit/renderers@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [[`b14d389`](https://github.com/nelomr/trace-kit/commit/b14d389546e316ba2487db7253c30fa8f21cef3c)]:
  - @trace-kit/core@0.0.8
  - @trace-kit/renderers@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [[`8b0b8d8`](https://github.com/nelomr/trace-kit/commit/8b0b8d861032e176e96ea11085bbe96b88af8d7b)]:
  - @trace-kit/renderers@0.0.2

## 0.0.2

### Patch Changes

- Updated dependencies [[`6865e69`](https://github.com/nelomr/trace-kit/commit/6865e6983d1c812279c86e97fe36bfdee7459a85)]:
  - @trace-kit/core@0.0.7
  - @trace-kit/renderers@0.0.1

## 0.0.1

### Patch Changes

- Updated dependencies [[`e31a3bb`](https://github.com/nelomr/trace-kit/commit/e31a3bb21e73f162a034e7e5f08c98076142809e)]:
  - @trace-kit/core@0.0.6
