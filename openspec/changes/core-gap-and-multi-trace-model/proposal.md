# Proposal: core-gap-and-multi-trace-model

> Roadmap `order: 5.7`. Prerequisite: `core-scale-transforms` (archived).
> Inputs: `openspec/roadmap.yaml` (5.7 comment block), `openspec/specs/{spectrum-data-payload,
> decimation-lttb,decimation-min-max,canvas2d-trace-rendering,visual-golden-corpus,multi-axis-viewport}`.

## Intent

Two data-model gaps are cheap to close now and breaking to close later.

**Gaps.** `decimation-min-max` already defines `NaN` as the "no sample" sentinel per bucket, but
only at bucket granularity: a bucket with one `NaN` among real samples reports the envelope of the
real samples, so a hole narrower than a bucket disappears and the rendered envelope bridges it.
`decimation-lttb` says nothing about `NaN` input at all: its triangle-area arithmetic over a `NaN`
sample yields `NaN` areas, candidate selection becomes order-dependent, and the path then draws a
straight line across the hole. `buildTracePath` issues exactly one `moveTo` and `n - 1` `lineTo`,
so it cannot express a break even if one survived decimation. A dead detector pixel, an aborted
sweep or a saturated ADC sample is therefore drawn as a measurement that never happened. The gap
must be decided in the decimator, because by render time the hole is gone.

**Multi-trace.** `SpectrumDataPayload` models exactly one trace. Before/after a thermal tune, two
output ports, reference versus device under test — the primary comparison workflow — is not
expressible. `multi-axis-viewport` (5.6) deliberately shipped N Y axes with no trace-to-axis
binding and reserved that seam for this change. Retrofitting multi-trace after the WebGL2 renderer
(7) and the adapters (10-11) is a breaking change to published component props.

## Scope

### In Scope
- Normative gap semantics: `NaN` in a Y buffer is a break, never a value, never interpolated.
- LTTB gap awareness: buckets never straddle a gap; the gap survives decimation as an explicit,
  consumer-detectable break in the emitted index stream.
- Min-max gap awareness: a hole inside a bucket is preserved as a break rather than absorbed into
  the envelope of its neighbours; the existing all-`NaN` bucket rule is kept.
- `TraceCollection`: N `SpectrumDataPayload`s sharing one X domain, each bound to a
  `YAxisRegistration.id`, with per-trace style.
- Canvas2D: `buildTracePath` breaks the path at gaps (`moveTo` after a gap); the renderer iterates
  the collection and resolves per-trace style and per-trace transform.
- Canvas2D: an isolated sample (a finite segment of one sample between gaps) is painted as a
  filled marker sized from the trace line width, on by default, with a per-trace style opt-out.
- Goldens for a gapped trace (including an isolated sample) and for overlaid traces on two axes.

### Out of Scope
- `NaN` in the X buffer. X is the sampling grid and MUST be finite; a `NaN` X is out of contract
  (not detected per point in the hot path). Gaps are expressed in Y only.
- Per-trace X domains, or traces on different X units. One shared X domain per collection.
- Resampling traces onto a common grid. Each payload keeps its own X buffer and sample count.
- Interpolated gap filling, gap-length thresholds, or "connect gaps" options.
- Legends, hover/tooltips, trace visibility toggles, draw-order UI — adapter and interaction work.
- WebGL2 and SVG gap/multi-trace paths — changes 6 and 7 consume this contract, including the
  isolated-sample visibility requirement (point primitive in WebGL2).
- Any change to `ViewportTransform` or scale kinds.

## Confirmed Product Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | `NaN` in Y is the only gap sentinel. `±Infinity` stays a (clamped) finite-input value, matching the existing `decimation-min-max` rule. | No new sentinel type; aligns with the archived spec and IEEE-754 conventions used by instrument exports. |
| 2 | A collection shares the X **domain**, not the X **buffer**. | Sweeps from two runs rarely share an identical sampling grid; forcing one buffer would require resampling, an implicit transformation CLAUDE.md rule 6 forbids. |
| 3 | Trace-to-axis binding is by `YAxisRegistration.id` (the seam 5.6 exposed), resolved once per collection revision, never per point. | Honors the `multi-axis-viewport` seam requirement; keeps the hot path index-based. |

These follow from archived specs and the roadmap rationale; none requires a new product call.

## Capabilities

> Contract with `sdd-spec`. Matches the roadmap `order: 5.7` comment block; additions noted.

### New Capabilities
- `gap-sentinel-semantics`: `NaN` in Y denotes a gap; defines segment boundaries, that no
  consumer (decimator, path builder, future exporter) may interpolate across a gap, the leading /
  trailing / all-gap cases, and that `NaN` X is out of contract.
- `trace-collection-payload`: `TraceCollection` — ordered, frozen list of trace entries
  (`id`, `SpectrumDataPayload`, `yAxisId`, style), one shared X domain, a collection-level
  revision distinct from per-payload revisions, a `markIsolatedSamples` style flag (default on),
  and validation at construction (unknown
  `yAxisId`, duplicate trace ids → `RangeError`). Core-owned, DOM-free.

### Modified Capabilities
- `decimation-lttb`: bucketing never crosses a gap; each finite segment keeps its endpoints; the
  emitted index stream carries a detectable break (representation decided in `sdd-design`, see
  below); zero-allocation, determinism and peak-fidelity requirements continue to hold with `NaN`
  input; all-`NaN` input is defined (no throw, no `NaN` selected as a point).
- `decimation-min-max`: a bucket containing both real samples and a gap emits a break marker
  instead of silently bridging; the all-`NaN` bucket rule and the `±Infinity` rule are retained
  unchanged.
- `canvas2d-trace-rendering`: the exact call-sequence requirement becomes "one `moveTo` per finite
  segment, `lineTo` within segments, none across a gap" (unchanged for gap-free input);
  one `Path2D` per trace per `render()` (replacing one per `render()`); per-trace style and
  per-trace `ViewportTransform` resolved from the collection; memoization keyed per trace;
  isolated samples painted as filled markers (default on, per-trace opt-out, zero-GC, no effect on
  gap-free input).
- `visual-golden-corpus`: adds a gapped-trace figure (leading, interior and trailing gaps, plus an
  isolated-sample marker) and an
  overlaid two-trace / two-axis figure; existing goldens MUST show zero diff.
- `multi-axis-viewport` *(addition to the roadmap block)*: its "no trace-to-axis binding"
  requirement is fulfilled and must be amended so `yAxisId` on a trace type is permitted — the
  positional `out[i] <-> axes[i]` correspondence and the ban on per-point lookup remain.

### Explicitly Not Changed
- `spectrum-data-payload`: stays single-trace; the collection composes payloads rather than
  widening the payload. Retained-buffer, revision and f64-origin guarantees are untouched.
- `viewport-transform`, `scale-logarithmic-transform`: projection is gap- and trace-agnostic.
- `allocation-free-hot-path`: its rules apply as-is to the new per-trace loops.

## Approach

1. **Gap detection is `y !== y`**, inline, no `Number.isNaN` call, no branch on the payload
   shape — cheap and deopt-free in the existing single traversal.
2. **LTTB segments, not buckets, are the unit.** A gap-free input takes the current code path
   bit-for-bit (determinism against existing fixtures). With gaps, the threshold is apportioned
   across finite segments and each segment is decimated with its own endpoints retained.
3. **Break representation travels with the indices**, so renderers stay stateless about gaps and
   the WebGL2 renderer (7) can reuse it for primitive restart.
4. **Collection is composition.** `TraceCollection` holds payload references and a frozen entry
   array; the renderer resolves each entry's transform from `createAxisTransforms` output via a
   `yAxisId -> index` resolution done once per collection revision into a caller-owned
   `Int32Array`, not a `Map` read in the frame loop.
5. **Style is data.** Per-trace style is a frozen plain object (color, line width, dash) resolved
   once; defaults come from a fixed palette in the renderer, not core.

## Open Technical Decisions Handed to `sdd-design`

1. **Break representation in decimated output.** Candidates: (a) emit the gap sample's own index
   as a marker (consumer sees `NaN` at that index and breaks); (b) a sentinel index (`-1`);
   (c) a parallel segment-offset buffer. (a) keeps one buffer and makes the check identical to the
   raw path, but changes LTTB's "returns exactly `threshold`" and subset/monotonicity wording.
   Design MUST pick one and word the MODIFIED return-count contract.
2. **Threshold apportioning across segments** (proportional to sample count, with a minimum of
   2 per segment of length >= 2; single-sample segments emitted as isolated points, never
   dropped, and painted as markers by the renderer).
   Must be deterministic and allocation-free.
3. **Min-max break encoding** for a mixed bucket (split the bucket at the gap vs. emit an explicit
   break slot), and its effect on the fixed `2 * bucketCount` output length.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/core/src/decimation/` | Modified | Gap-aware LTTB and min-max |
| `packages/core/src/` (payload area) | New | `TraceCollection` factory and types |
| `packages/renderers/` (Canvas2D) | Modified | Segment-breaking `buildTracePath`; per-trace loop, style, transform, memo |
| `packages/vue`, `packages/react` | None yet | Consume the collection in changes 10-11 |
| `apps/playground` | Optional | Gapped/overlay scenario fixtures via `render-scenario-fixtures` |
| `openspec/specs/*` | Modified | Deltas listed above |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Regression of LTTB output on gap-free input | Med | Bit-identical fixture comparison against the pre-change implementation. |
| 2 | Hot-path cost of the gap check | Low | One self-comparison per sample in an existing read; benchmark comparator (change 16 contract) and zero-GC gate per decimator. |
| 3 | Silent bridging survives in an edge case (gap at bucket edge, single-sample segment) | Med | Property test: no emitted segment spans a source `NaN`; explicit leading/trailing/adjacent-gap scenarios. |
| 4 | Collection API shape leaks into adapters prematurely | Low | Core-only type; adapters out of scope. |

## Rollback Plan

Gap handling is a no-op on gap-free data and the single-trace path is expressible as a one-entry
collection. Revert is the change's commit range in `packages/core/src/decimation`, the new
collection module and the Canvas2D renderer, plus the new goldens. Pre-`1.0.0`, no migration.

## Dependencies

- `core-scale-transforms` (archived) — `YAxisRegistration.id` and `createAxisTransforms`.
- `browser-visual-regression-harness` (archived) — goldens. No new runtime dependency.

## Success Criteria

- [ ] No decimator output or rendered path segment spans a source `NaN` (property-tested).
- [ ] Gap-free LTTB and min-max output is identical to the pre-change output.
- [ ] Two traces with distinct X grids render against one X domain on two Y axes.
- [ ] Zero-GC gate passes for gapped input in both decimators and the per-trace render loop.
- [ ] Every isolated sample is visible as a marker by default in Canvas2D; gap-free input draws none.
- [ ] Existing goldens show zero diff; new gapped (with isolated sample) and overlay goldens added.
- [ ] `pnpm exec turbo run typecheck lint build` and `pnpm run test` pass; no `any` introduced.
