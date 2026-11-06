# Proposal: canvas2d-parity-fixes (roadmap 7.6)

## Problem / Motivation

`renderers-webgl2` (archived as `openspec/changes/archive/2026-10-13-renderers-webgl2/`) records
five known divergences in its design, under "Known Divergences (recorded, not fixed here)". Three
of them are Canvas2D defects against the shared contract. The archive wording is:

> 2. **Clipping** (B(a)): WebGL2 scissors to the plot; Canvas2D does not clip. To be aligned in a
>    separate Canvas2D change.
> 3. **±Infinity**: WebGL2 reaches the plot edge through the guard band (C(a)); Canvas2D's
>    `lineTo(±Infinity)` is ignored by the Canvas specification, so the line bridges the sample.
> 4. **Infeasible LTTB on a single payload**: Canvas2D's single-payload path has no min-max fallback
>    and draws the payload whole when `lttb` returns 0; WebGL2 uses `decimateTraceIndices` on both
>    paths (the collection behaviour). No fixture reaches this.

Divergence 1 (WebGL2 draws dashes solid) stays a documented divergence. Divergence 5 (X-domain
space) is being closed by `x-domain-space-reconciliation` (7.5). This change builds on 7.5's
implemented state (absolute X domain, `ViewportTransform.xOffsetMin`, origin-free
`xGridPositions`, WebGL2 `u_xOffsetMin`) and does not touch anything 7.5 owns.

I checked each divergence against the current code. All three are still present:

- **No clip.** `Canvas2DRenderer.render()` (`packages/renderers/src/canvas2d/canvas2d-renderer.ts`)
  strokes and fills each trace `Path2D` straight onto the context. There is no clip region, and
  `TraceDrawingContext` (`src/surface.ts`) does not expose `save`, `restore`, `rect` or `clip`. SVG
  wraps traces and markers in `<g clip-path="url(#<idPrefix>-plot-clip)">`
  (`svg/export-to-svg.ts`, `svg-vector-export` "The Plot Area Is Clipped With a Deterministic
  `clipPath`"). WebGL2 scissors to the plot rectangle (`webgl2-trace-rendering` "Traces Are
  Clipped to the Plot Rectangle"). That WebGL2 requirement still says this is "a deliberate
  difference from Canvas2D, which does not clip". The committed `resonance-peak.png` golden shows
  the defect: its domain is `[1748, 2348]` over a `0..4095` payload, so the Lorentzian wing is
  painted across the left axis gutter. I measured 17 trace-colored pixels left of the Y axis in the
  committed image, and 0 in `webgl2-resonance-peak.png`.
- **±Infinity bridges.** `buildTracePath` (`src/path/build-trace-path.ts`) treats only `NaN` as a
  gap (`y[j] !== y[j]`). An infinite `y` passes through and `projectY` returns `∓Infinity`. The
  Canvas 2D specification ignores `lineTo`/`moveTo` with a non-finite argument, so the subpath
  continues and the stroke bridges the sample. WebGL2 instead classifies infinity by bit pattern and
  maps it to `GUARD_BAND_PX = 65536` device pixels beyond the plot edge, on the side the axis
  direction implies (`webgl2/shaders.ts` `projectYDevice`). It then clamps every projected
  coordinate into that band. `gap-sentinel-semantics` requires ±Infinity to be "a real over-range
  reading, not a gap", and that is what WebGL2 draws.
- **No fallback on the single-payload path.** `#recomputeDecimationIfStale` calls `lttb` directly.
  When `lttb` returns `0` (the input has more fragments than the threshold can represent),
  `#decimatedCount` is `0` and `buildTracePath` walks the direct range `[0, sampleCount)`, which
  draws every sample. The collection path (`#recomputeTraceDecimationIfStale`), `exportToSvg` and
  WebGL2 (`webgl2/upload.ts`) all call `decimateTraceIndices` (`src/rules/decimation.ts`), which
  falls back to `minMaxEnvelopeIndices` with `bucketCount = max(1, floor(threshold / 2))`. Drawing
  the whole payload is a parity defect, and it also breaks the decimation budget on the hot path:
  a 1M-sample fragmented payload strokes 1M vertices per frame.

### A related divergence the archive does not list

The same code path has a sixth divergence that the archive does not record. It is the
non-positive sample on a log axis. `webgl2-trace-rendering` ("Y Projection Reproduces the Shared
`ViewportTransform`") requires that "a sample with `y <= 0` on a log axis MUST be treated as
unrepresentable: the segment is collapsed like a gap". Its scenario `[10, 0, 100]` paints nothing.
On Canvas2D, `projectY` returns `+Infinity` (for `0`) or `NaN` (for a negative value or
`-Infinity`). The Canvas spec drops that `lineTo`, so Canvas2D bridges `10 → 100`. The WebGL2 spec
justified its rule with "a non-finite coordinate that `Path2D` consumers skip". That is true, but
skipping the point bridges the line instead of breaking it. Fixing ±Infinity means classifying
non-finite samples in the walker anyway, and on a log axis `-Infinity` must fall into this rule
rather than reach the bottom edge. This proposal therefore includes the log `y <= 0` pen-lift in
scope (see Decision D3).

## Proposed Approach

### 1. Clip traces and markers to the plot rectangle (Canvas2D only)

In `render()`, wrap the whole trace section in one clip, for both the single-payload branch and
`#renderTraces`:
`save() → beginPath() → rect(plotLeft, plotTop, plotWidth, plotHeight) → clip()` → line strokes
and marker fills → `restore()`. The rectangle comes from the primary transform. Every axis
transform and every per-trace transform shares the same plot geometry, because
`buildTraceTransforms` takes the layout insets. Gridlines are painted before the clip and axes
after `restore()`, so neither is clipped. This matches SVG ("Gridlines and axes MUST NOT be
clipped").

- `TraceDrawingContext` gains `save()`, `restore()`, `rect(x, y, w, h)` and `clip()`. These are
  all members of `CanvasRenderingContext2D`, and `OffscreenCanvasRenderingContext2D` has them too.
  The Node fake `RecordingContext` (`test/node/support/recording-context.ts`) has to implement
  them.
- `restore()` also resets the line dash. The two existing `setLineDash(EMPTY_DASH)` calls are
  there to stop a trace's dash leaking into the axes, so the design should decide whether the
  restore replaces the post-trace one. The pre-gridline reset still covers a dash left over from
  the previous frame.
- Zero allocation: the clip uses the context's current default path, not a `Path2D`. The frame
  constructs no new object. The per-trace `Path2D` count ("Exactly One `Path2D` Is Constructed Per
  Trace Per `render()` Call") does not change.

### 2. ±Infinity reaches the plot edge; log `y <= 0` lifts the pen (shared walker)

The sample is classified in the walker before it is projected. A comparison on the sample value
is exact in JS, and unlike GLSL, JS guarantees IEEE semantics, so no bit test is needed:

- `y === Infinity` / `y === -Infinity` on a linear axis: the vertex goes to the guard band on the
  side the axis direction implies, mirroring `projectYDevice`. That is
  `plotTop - GUARD_BAND` when the value grows upward (`yScale >= 0`), and
  `plotTop + plotHeight + GUARD_BAND` otherwise. Deciding by the sign of the sample instead of
  computing `yBase - y * yScale` avoids `Infinity * 0 = NaN` on a zero-span axis.
- `+Infinity` on a log axis behaves like the linear case (top edge for a positive `yLogScale`).
- Any `y <= 0` on a log axis, `-Infinity` included, is unrepresentable. The walker lifts the pen
  exactly as for a `NaN` gap, which mirrors WebGL2's `isUnrepresentable`.
- Every projected X and Y is then clamped into
  `[plotLeft - G, plotLeft + plotWidth + G] × [plotTop - G, plotTop + plotHeight + G]` with
  `Math.min`/`Math.max`, as WebGL2 does. Huge finite values then stay finite, and the clip from
  step 1 hides everything past the edge.
- `GUARD_BAND_PX` moves into a backend-neutral rules module (`src/rules/`). `webgl2/shaders.ts`
  interpolates it from there, so there is one definition. Its unit is "pixels of the transform",
  which means device px on raster backends and CSS px for SVG (`dpr = 1`). 65536 CSS px is far
  below `formatSvgNumber`'s `1e9` clamp.

The walker is the shared `buildTracePath`. The isolated-segment walk (`path/isolated-markers.ts`)
has to agree on the same pen-lift rule, or a sample flanked by log-non-positive samples would be
left without a marker. `countIsolatedSegments` does not take a transform today, so its signature
probably changes; the design settles that. The loop stays inside the existing hot-path ESLint ban
list: it uses only scalar locals and branches, with no literals, closures or `.subarray`. The
`buildTracePath` GC gate (100,000 samples, `--expose-gc`, zero GC events) must stay green.

### 3. Single-payload decimation goes through `decimateTraceIndices`

`#recomputeDecimationIfStale` replaces its inline `lttb` / `minMaxEnvelopeIndices` branches with
one `decimateTraceIndices(algorithm, parameter, x, y, sampleCount, this.#indices)` call. That is
the call the collection path, SVG and WebGL2 already make. The capacity reserved for the LTTB
attempt already fits the fallback (`2 * floor(parameter / 2) <= parameter`). The memo key and
the bypass rule stay as they are, and the isolated count is still refreshed only on recompute.

## Decisions (genuine forks, with recommendation)

### D1 — How Canvas2D clips

- **(a) Context clip (recommended).** `save / rect / clip / restore` once per frame. It covers
  everything drawn, including the stroke half-width that sticks past the edge and the markers. It
  matches SVG's `clipPath` exactly (a pixel-snapped rectangle at `dpr 2`, anti-aliased edges at a
  fractional dpr). It allocates nothing, adds four context calls per frame, and leaves the shared
  walker and the SVG text alone.
- (b) Geometric clipping (Liang–Barsky per segment in the walker). The walker is shared, so this
  changes the SVG path text for `resonance-peak` and **moves an SVG golden**. It adds a `moveTo`
  on every re-entry into the plot, which changes the specified call sequence. It still needs (a),
  because an oblique butt-capped stroke that ends at the edge sticks out by up to half the line
  width. On top of that it puts per-segment branching into the hottest loop.
- Sub-detail for design: WebGL2 widens the scissor to whole pixels (`floor`/`ceil`), while SVG uses
  the exact rectangle. I recommend the exact rectangle (the SVG behaviour). The two differ by less
  than a device pixel, only at a fractional dpr, and no fixture uses a fractional dpr.

### D2 — Where ±Infinity is mapped to the edge

- **(a) In the shared `buildTracePath` (recommended).** All three engines then agree. SVG also
  stops sending `-Infinity` the wrong way: today `formatSvgNumber` writes any non-finite
  coordinate as `"0"`, the document's top edge, so a linear `-Infinity` goes up instead of down,
  and a log non-positive sample draws a line to the top. This adds `svg-vector-export` to the
  contract as MODIFIED. SVG goldens do not move, because no fixture contains ±Infinity, a log
  non-positive value, or a coordinate beyond the guard band. The largest off-plot coordinate is
  `resonance-peak` at about −2,300 CSS px, well inside 65,536. The node `svg-golden` test proves
  it.
- (b) A Canvas2D-only wrapper or a second walker. SVG keeps its current wrong `-Infinity` and log
  behaviour, and there would be two walkers that both have to maintain the gap rules
  (`gap-sentinel-semantics` wants a single definition).

### D3 — Include the log `y <= 0` pen-lift (newly found divergence)

- **Include (recommended).** It is the same classification branch D2 introduces, and `-Infinity`
  on a log axis has to land somewhere: WebGL2 treats it as non-positive and collapses it. Leaving
  finite `y <= 0` bridging while fixing `-Infinity` would split one rule in two.
- Exclude: keep the change strictly to the roadmap's three items, and record a sixth divergence
  for a later change.

## Capabilities (Contract for sdd-spec)

### New Capabilities

None.

### Modified Capabilities

- `canvas2d-trace-rendering`:
  - New requirement: traces and isolated-sample markers are clipped to the plot rectangle of the
    primary transform. Gridlines and axes are not clipped. The clip allocates nothing, and the
    frame issues exactly one `save`/`clip`/`restore` sequence.
  - New requirement: `+Infinity`/`-Infinity` samples are drawn to the guard band on the side the
    axis direction implies, and every projected coordinate is clamped to the guard band.
  - New requirement: a log-axis sample `y <= 0` lifts the pen like a gap.
  - "Infeasible LTTB Falls Back to `minMaxEnvelopeIndices`" is extended to the single-payload
    (`setData`) path.
  - "`buildTracePath` Issues One `moveTo` Per Finite Segment…": the segment definition now also
    breaks on log `y <= 0`, and the coordinate scenario reads "clamped projection".
  - `TraceDrawingContext` gains `save`, `restore`, `rect`, `clip`.
- `svg-vector-export` (only if D2(a) is accepted): trace paths and markers use the shared
  ±Infinity edge mapping, the guard-band clamp and the log `y <= 0` pen-lift. No non-finite
  coordinate reaches `formatSvgNumber` from a trace path.
- `webgl2-trace-rendering`: the clip requirement drops "a deliberate difference from Canvas2D,
  which does not clip". The guard-band constant comes from the shared rules module. The behaviour
  does not change.
- `webgl2-golden-parity`: the structural cross-check gains the parity proofs described under
  "Cross-engine parity" below.
- `browser-visual-regression`: the `visual` project also hosts Canvas2D behaviour probes (pixel
  reads, no goldens, no fakes), alongside the existing WebGL2 ones.

Not modified: `gap-sentinel-semantics` (its ±Infinity rule is what this change implements),
`decimation-lttb`, `decimation-min-max`, `scale-logarithmic-transform` (`projectY` keeps returning
a non-finite value for `y <= 0`; only the renderer's reaction changes), `visual-golden-corpus`
(no fixture is added or changed), `viewport-transform` (7.5 owns it).

## Golden Impact

The goldens are 800×400 CSS screenshots compared with pixelmatch at `threshold 0.1` and
`allowedMismatchedPixelRatio 0.001` (320 px). `insetTop` and `insetRight` are `0`
(`figure-layout.ts`), so ink above the top or right of the plot was already off-canvas. Only the
left and bottom gutters can change.

| Golden set | Expected | Why |
|---|---|---|
| Canvas2D `resonance-peak.png` | Changes, about 17 px (CSS) disappear from the left gutter, plus their AA fringe. Expected to stay **within** tolerance, so the comparison still passes. | It is the only fixture whose payload extends outside its X domain. |
| Canvas2D `log-axis`, `dual-axis`, `overlay-two-axis` | At most about 1 px. | The log samples dip slightly below `1` (noise ×0.95) under the plot bottom, where the X axis line, painted after the traces, already covers them. |
| Canvas2D `simple-trace`, `axes-grid`, `noise-floor`, `decimation-minmax`, `gapped-trace` | None. | All samples are inside the domain. |
| Any golden, ±Infinity, log `y <= 0`, LTTB fallback | None. | No fixture contains ±Infinity or a log non-positive value, and no fixture makes LTTB infeasible (the archive notes this too). |
| WebGL2 `webgl2-*.png` | None. | WebGL2 behaviour is unchanged. The `GUARD_BAND_PX` value is the same and only moves module. |
| SVG `test/svg-goldens/*.svg` | None. | D1(a) leaves path text alone. D2(a) changes no fixture's output (see D2). |

So I expect no golden to need regeneration. A reference that passes within tolerance is not
rewritten by `--update`, so `resonance-peak.png` keeps its 17 stale gutter pixels. The clipping
behaviour is proven by the probes below, not by that image.

**Verification, local only, no CI runs to probe.** First run the baseline on the untouched tree,
then run again after apply:
1. SVG: `pnpm --filter @trace-kit/renderers test` without `TRACEKIT_UPDATE_SVG_GOLDENS`. After it,
   `git status --porcelain` must show nothing under `packages/renderers/test/svg-goldens`.
2. Visual: run in `mcr.microsoft.com/playwright:v1.63.0-noble` (this matches the catalog
   `playwright: 1.63.0`), with the repo mounted read-only and the work done in a container-local
   copy, the same procedure `x-domain-space-reconciliation`'s design documents.
   `pnpm --filter @trace-kit/renderers test:visual` without `--update` must exit 0.
3. If step 2 fails on a Canvas2D golden only because of removed gutter ink, the diff is the
   evidence. The fix is to push the change, then dispatch `update-visual-goldens` manually and
   commit its output. Goldens are never regenerated locally and never "on merge". That path needs
   the user's approval, because it involves a push.

## Cross-Engine Parity

The current `engine-crosscheck.visual.test.ts` compares ink **inside** the plot rectangle inset by
`K_INSET`, so it cannot see gutter ink and cannot prove the clip. The change adds:

- **Out-of-plot ink check (cross-engine).** For every `SCENARIO_FIXTURES` entry and both engines,
  count the pixels within `INK_DELTA` of any trace color outside the plot rectangle grown by
  `ceil(lineWidthCss * dpr)`. It must be zero on both engines. Before the fix, `resonance-peak`
  fails on Canvas2D, which shows the check is not vacuous.
- **Canvas2D behaviour probes**, as test-local payloads (no new fixture, so no new goldens), each
  reading Canvas2D and WebGL2 pixels in the same page:
  - `[0.5, 0.5, +Infinity, 0.5, 0.5]` on domain `[0, 1]`: trace ink in the plot's top row band at
    sample 2's column on both engines. `-Infinity` reaches the bottom row band.
  - A log-axis `[10, 0, 100]`: no trace ink in either segment on either engine, matching the
    existing WebGL2 probe.
  - Alternating `±Infinity`: no trace ink outside the plot rectangle on Canvas2D (the Canvas2D twin
    of "draws nothing outside the plot rectangle").
- **Node-level unit tests** (fake context): `save → beginPath → rect(plot) → clip` before the
  first trace stroke, and `restore` before the first axis call. Exact clamped coordinates for
  ±Infinity on linear, inverted and log axes. Pen-lift call counts for log `y <= 0`. A
  single-payload fragmented trace above the threshold calls `lttb` and `minMaxEnvelopeIndices`
  once each across two unchanged renders.

The existing per-trace extent comparison stays as it is. The out-of-plot check is new and does not
loosen any existing tolerance.

## Impact on TraceKit Packages

- `packages/core`: none. `projectX`/`projectY`, decimators and the 7.5 transform shape are
  untouched.
- `packages/renderers`:
  - `canvas2d/canvas2d-renderer.ts`: the clip, and the single-payload fallback.
  - `surface.ts`: four new `TraceDrawingContext` members.
  - `path/build-trace-path.ts` and `path/isolated-markers.ts`: classification and clamp.
  - A new or extended `rules/` module for `GUARD_BAND_PX`.
  - `webgl2/shaders.ts`: imports the constant.
  - `webgl2/webgl2-figure-renderer.ts`: the doc comment that lists the divergences is updated, and
    only dash remains.
  - Tests in `test/node` and `test/visual`.
- `packages/vue` / `packages/react`: none.
- `apps/playground`: no code change. The engine-parity view shows the alignment.
- Release: one `.changeset/*.md` with `"@trace-kit/renderers": patch`. It covers the Canvas2D
  plot clip, ±Infinity to the plot edge, log non-positive samples not bridged, the single-payload
  LTTB fallback, and (with D2(a)) the matching SVG path behaviour.

## Scope & Non-Goals

- **Out of scope:** dashed traces drawn solid on WebGL2. It stays a documented divergence, and the
  cross-check keeps treating dashed traces as one-directional.
- No engine switching, hysteresis or context-loss handling (roadmap 9 / 9.5).
- No change to the decimators. If `lttb` sees an infinite sample, its triangle areas become
  `Infinity` or `NaN`, so which index it picks near that sample is unspecified. WebGL2 draws at
  full resolution by default, so parity for a *decimated* trace with infinities stays
  one-directional, as it is for every decimated trace today. This change does not try to fix that.
- No new scenario fixture and no fixture edit, so no new golden.
- Nothing in `openspec/changes/x-domain-space-reconciliation/`.
- No X-domain or transform semantics change.

## Risks

- The pixel counts in Golden Impact were measured on the committed PNGs with a color-distance
  heuristic. The local Docker run is the real acceptance signal.
- `restore()` resets the dash and every other piece of context state saved by `save()`. The
  painters that run after it must still set their own state. A missed reset there would show up
  as an axis styling regression on the goldens.
- With D2(a), SVG output for ±Infinity and log non-positive input changes (it gets fixed). Anyone
  who parsed the old `"0"` coordinates would see different documents. The package is pre-1.0, and
  the old output was wrong.
- The guard-band clamp bends the slope of a visible segment whose far end is clamped. The error is
  below `segmentDx * plotHeight / GUARD_BAND_PX`, the same bound WebGL2 documents.
- Changing the isolated-marker walk's signature touches SVG and WebGL2 call sites, which are
  cold-path, and has to keep the "isolated count computed once per memo recompute" guarantee.

---

**Status**: success
**Summary**: Wrote the proposal for `canvas2d-parity-fixes`. It grounds the three archived
Canvas2D divergences (no clip, ±Infinity bridging, no single-payload LTTB fallback) in the current
code, and adds one divergence the archive does not list: the log `y <= 0` bridge on Canvas2D.
Golden impact is expected to stay within tolerance, with no regeneration.
**Artifacts**: `openspec/changes/canvas2d-parity-fixes/proposal.md`
**Next Recommended**: `sdd-spec` and `sdd-design` (`/sdd:spec`, `/sdd:design`), after the user
confirms D2 and D3.
**Risks**: the golden pixel counts are heuristic until the Docker run confirms them; the
`restore()` state reset; with D2(a), SVG output changes for non-finite input.
