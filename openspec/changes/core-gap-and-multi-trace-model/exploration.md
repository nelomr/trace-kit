# Exploration: core-gap-and-multi-trace-model — gap encoding

> Read-only exploration for the three design-owned questions in `proposal.md` §"Open Technical
> Decisions Handed to `sdd-design`". Grounded in the current `lttb.ts`, `min-max.ts`,
> `min-max-indices.ts` and `build-trace-path.ts` implementations and their specs.

## Current state (relevant facts)

- `lttb` writes absolute sample indices into a caller-preallocated `Int32Array`, exactly
  `threshold` of them, one forward traversal, ≤2 reads/sample, no scratch buffer. Bucket
  boundaries are computed purely from `(bucket * interior) / buckets`, with no awareness of
  sample value at all — a bucket's start/end never depends on `y`.
- `minMaxEnvelope` (values) already has a "no sample" convention: `lo === hi === NaN` when a
  bucket is empty (only reachable today via `bucketCount > sampleCount`-adjacent edge cases,
  not via gaps, since there's no gap concept yet). Its output length is fixed at
  `2 * bucketCount`, always, unconditionally.
- `minMaxEnvelopeIndices` mirrors it in index space: an untouched bucket emits `[start, start]`
  (both indices collapse to the bucket's first slot) as its deliberate "deterministically
  breaking, not corrupting" fallback for an all-NaN bucket. This is the closest existing
  precedent for a break-encoding-via-index convention in this codebase.
- `buildTracePath` is a hard contract: **exactly one `moveTo`**, **exactly `n-1` `lineTo`**, no
  exceptions, for both the direct path (`decimatedCount === 0`) and the decimated path. It reads
  `x[j] ?? y[j] ?? 0` — a `0` fallback for `undefined`, not for `NaN`; today nothing in the
  pipeline can hand it a `NaN`-valued index-referenced sample and have it do anything but draw a
  literal `NaN` coordinate (which canvas silently no-ops on, producing an invisible/broken
  segment, not a break).

---

## Question 1 — How LTTB marks a break in its `Int32Array` index output

### Options

**(a) Gap-sample's own index as the marker.** The decimator, upon detecting a segment boundary,
emits the index of the `NaN` sample itself (or the boundary index) into the stream at the
position where a break falls. The renderer re-reads `y[index]`, sees `NaN`, and breaks.

- Zero-GC: free — no new type, no extra write.
- Buffer sizing: `out` stays `Int32Array[threshold]`; no widening.
- Renderer cost: one extra `Number.isNaN` check (or `y !== y`) per emitted index in
  `buildTracePath`'s loop — the same self-comparison the proposal already prescribes for gap
  *detection* upstream (Approach step 1), so this is not a new idiom, just relocating that same
  check into the render walk.
- WebGL2 reuse: primitive restart in WebGL2 conventionally uses a dedicated *index value*
  (`0xFFFFFFFF` for `GL_UNSIGNED_INT`) reserved out of the valid range — NOT "an index that
  happens to point at a NaN sample." Reusing (a) for WebGL2 means the VBO consumer must also
  dereference `y[index]` to test for NaN, which is an extra indirection per vertex in a shader
  or in the index-buffer-build step; a literal restart-index sentinel is what GPUs are built to
  consume for free. So (a) is renderer-friendly for Canvas2D specifically, less so as a direct
  handoff to primitive restart.
- Backward compat: **breaks the "exactly `threshold` indices, all meaningfully selected points"
  contract** only in the sense that one of the `threshold` slots now points at a hole rather
  than a drawn vertex — but the count contract (`returns threshold`) is literally preserved,
  and gap-free input is bit-identical (no NaN ever appears, so the marker path never triggers).
  This is the cheapest option to reconcile with `decimation-lttb`'s existing "returns the count
  of indices written (`threshold`)" wording — no renumbering of the return contract needed.
- Peak preservation: neutral — doesn't touch triangle-area selection logic, only what happens at
  a bucket that straddles/contains the gap.

**(b) Sentinel index (`-1`).** Emit `-1` at break positions instead of a real index.

- Zero-GC / sizing: same as (a), free.
- Renderer cost: cheaper per-element check than (a) — an integer compare (`j === -1`) is
  marginally cheaper than a float self-comparison, and does **not** require touching `y[j]` at
  all before deciding to break. Strictly simpler branch in the hot render loop.
- WebGL2 reuse: this *is* exactly the shape GPU primitive-restart wants — a reserved
  out-of-band index value, tested once at index-buffer-build time (or natively by the GPU if the
  restart index is set to match). `-1` as `Int32Array` is bit-identical to `0xFFFFFFFF` when
  reinterpreted as `Uint32Array` (two's complement), which is a pleasant, likely-intentional
  bridge to `GL_UNSIGNED_INT` primitive restart with zero conversion cost — cast the buffer view,
  done. This is the strongest argument for (b): it is the one option that hands change 7
  something it can consume with a `reinterpret_cast`-style view change rather than an extra
  pass.
- Backward compat: same neutral story as (a) — gap-free path never emits `-1`, so existing
  fixtures are untouched. Slightly clarifies the contract too: "emitted index is either a valid
  absolute sample index, or exactly `-1` meaning break" is easy to state as a MODIFIED
  requirement and easy to property-test ("every non -1 emitted index lies in
  `[sourceOffset, sourceOffset + sampleCount)`; -1 never appears in gap-free fixtures").
- Peak preservation: neutral, same as (a).
- Renderer consumption: `buildTracePath` gets one more branch per point: `if (j === -1) { start
  new segment } else { lineTo }`. This is a clean, well-precedented pattern (matches
  Plotly/uPlot/ECharts convention below) and reads naturally against the "one moveTo per finite
  segment" MODIFIED wording the proposal already commits to.

**(c) Parallel segment-offset buffer.** A second small buffer (e.g. `Int32Array` of segment
start offsets into the index stream) travels alongside the untouched index stream, so break
points are looked up out-of-band rather than inline.

- Zero-GC: requires either a second caller-preallocated buffer (more API surface, more
  parameters threaded through every call site — `lttb` already has 7 positional params; an 8th
  breaks the "one signature, no options object" simplicity the current spec is proud of) or a
  worst-case-sized scratch allocation, which the hot-path ESLint scope forbids inline.
- Buffer sizing: worst case is `min(threshold, gapCount+1)` segments — unknowable at the call
  site without pre-scanning `y` for gaps first (an extra full pass, defeating "one forward
  traversal").
- Renderer cost: two buffers to walk in lockstep is strictly more state to carry through
  `buildTracePath`'s already allocation-constrained loop — not free, and harder to keep
  allocation-free without a second cursor register.
- WebGL2 reuse: actually not bad for VBO index-buffer construction (segment offsets are exactly
  what `glMultiDrawArrays`/`glDrawElementsBaseVertex`-style multi-segment draws want) — but this
  benefit is realizable equally well by deriving offsets from a `-1`-delimited stream at
  index-buffer-build time, without paying the second-buffer cost in the hot decimation path.
- Backward compat: forces a signature change to `lttb` for every caller today, whether or not
  their data has gaps — the heaviest option for callers.
- **Verdict: rejected.** Higher API surface, extra pass or extra allocation, no clear advantage
  over (b) since (b)'s `-1` stream is trivially reducible to segment offsets downstream if ever
  needed.

### Recommendation: **(b), sentinel index `-1`**

- Simplest branch in the render hot path (integer compare, no float NaN check, no extra
  dereference).
- Directly compatible with WebGL2 `GL_UNSIGNED_INT` primitive restart (`0xFFFFFFFF` under
  `Uint32Array` reinterpretation of the same bytes) — the proposal explicitly asks for this
  reuse (Approach step 3: "the WebGL2 renderer (7) can reuse it for primitive restart").
- Matches how `uPlot` (dense typed-array mode, `null` in JS-array mode collapses to a documented
  break) and how index/vertex-buffer GPU pipelines in general encode restart: a reserved
  out-of-band value, not "the value at that slot happens to be missing." Plotly and ECharts (SVG/
  Canvas-batched libraries, not GPU-primitive-restart consumers) use `null`/`NaN` *values* in the
  data array itself rather than an index-stream sentinel, because they don't have a separate
  index buffer to begin with — not a directly transferable precedent here since TraceKit's LTTB
  output is an index stream, not a value stream. (Medium confidence on uPlot's exact internal
  encoding; high confidence on the general GPU primitive-restart convention.)
- `threshold` return-count contract is preserved as a literal count of written slots (still
  `threshold` values written, some of which may be `-1`), which is the least disruptive
  reconciliation of the existing "returns the count of indices written" wording — MODIFIED
  spec just needs to add "an emitted slot is either a valid absolute index or the sentinel `-1`;
  `-1` NEVER appears in gap-free input."

---

## Question 2 — Threshold apportionment across gap-separated segments

### Options

**(a) Proportional to segment sample count, minimum 2 per segment (length ≥ 2).** Each finite
segment `s` gets `round(threshold * segmentLength[s] / totalFiniteSamples)` output slots, floored
at 2 (both endpoints) if `segmentLength[s] >= 2`.

- Determinism: needs a defined, order-independent rounding rule (e.g. largest-remainder or
  running-cumulative-floor, the same technique used for bucket boundaries already —
  `((bucket * interior) / buckets) | 0` is exactly this pattern, applied once more at the
  segment level). Reuses an idiom already in the file; low risk.
- Zero-GC: requires knowing segment boundaries and lengths before allocating per-segment
  threshold shares — this means either (i) a first pass to find gap positions (extra full
  traversal, contradicts "one forward traversal"), or (ii) computing segment boundaries lazily
  as gaps are discovered mid-traversal, deferring the "how many output slots does this segment
  get" decision until the *next* gap or end-of-input is reached. (ii) is the only allocation-free
  route and pushes real complexity into the loop (variable-size sub-threshold accumulation, a
  segment's own bucket math starts only once its length is known). This is real design work, not
  free.
- Peak preservation: proportional-to-length is the "fair" allocation and is what LTTB variants
  in the wild that handle gaps (informally documented in a few open-source LTTB gap forks; low
  confidence on any canonical citation) converge to — a segment with more samples gets more
  representation, avoiding a short segment silently eating a full share of `threshold` while a
  long segment starves.
- Backward compat: for gap-free input (one segment, full `sampleCount`), this degenerates
  exactly to today's undivided calculation — bit-identical, since `segmentLength ===
  totalFiniteSamples` makes the proportion `1`.

**Single-sample segments (length exactly 1):** cannot get 2 endpoint slots (there's only one
point). Two sub-options:
  - Emit the lone sample as an isolated point (1 output slot) — matches the general spirit of
    "every finite segment survives decimation," and a single isolated point rendered as a
    degenerate `moveTo`-only "segment" (zero `lineTo`s) is directly expressible by the *already
    contract-shaped* `buildTracePath` MODIFIED wording ("moveTo per finite segment, lineTo
    within segments") — a segment of length 1 naturally produces `moveTo` and zero `lineTo`,
    which the walk loop gets "for free" if the per-segment loop bound is `n-1` generically (0
    when `n===1`).
  - Drop it — simpler bookkeeping, but silently discards a real sample, which conflicts with the
    proposal's Risk #3 ("silent bridging survives in an edge case... single-sample segment") —
    dropping isn't bridging, but it *is* silent data loss, which the proposal's own success
    criteria ("no decimator output... spans a source NaN," property-tested) doesn't explicitly
    forbid, but the broader spirit of "never interpolated, never silently discarded" argues
    against.
  - **Recommendation: emit as isolated point.** Consistent with "a dead detector pixel... is
    therefore drawn as a measurement that never happened" motivating language in the proposal —
    the inverse failure (a *real* isolated sample vanishing) is exactly the class of bug this
    change exists to close.

**(b) Equal split regardless of segment length.** Simpler bookkeeping (`threshold / segmentCount`
per segment), but a segment with 2 samples gets the same slot budget as a segment with 10,000 —
poor peak preservation for the larger segment, and wastes slots on a tiny segment that doesn't
need them. No clear zero-GC advantage over (a) since segment count also isn't known upfront
without a similar lazy-discovery approach. Rejected — no dimension where it dominates (a).

### Recommendation: **(a), proportional to segment length, minimum 2 (or 1 for a true
singleton), computed via lazy segment discovery in the same forward traversal**

Concretely this likely means: a first lightweight forward scan (still O(n), still no allocation —
just counting, not doing triangle-area work) to locate gap positions and segment lengths, feeding
a second pass that runs today's per-segment LTTB with its apportioned threshold share. This is
**two traversals**, not one — a real, spec-visible change to the "one forward traversal" wording
for the gapped case specifically (gap-free input can still special-case to the original
single-pass loop, preserving the existing zero-cost gap-free path). Flag this explicitly for
`sdd-design`: the MODIFIED `decimation-lttb` requirement needs to either (i) accept "two
traversals when gaps are present, one when absent" as the new work-count contract, or (ii) find
an allocation-free single-pass apportionment scheme (e.g. reserving a fixed-size on-stack-like
counter array is not possible in JS without an array literal — likely infeasible without a
pre-sized scratch `Int32Array` threaded as a new parameter, which reopens the API-surface cost
flagged in Q1's option (c)). This is the one open question here that genuinely needs a
design-time decision, not just an implementation detail.

---

## Question 3 — Min-max bucket containing both real samples and a gap

### Options

**(a) Split the bucket at the gap** — i.e. change bucket *boundaries* so no bucket ever straddles
a gap, mirroring the LTTB segment-respecting approach.

- Breaks the fixed `2 * bucketCount` output-length invariant that both `minMaxEnvelope` and
  `minMaxEnvelopeIndices` currently guarantee unconditionally (`out.length ===
  outputOffset + bucketCount * 2`, always) — a caller-visible contract both functions' docs and
  specs currently state as absolute ("Writes `bucketCount * 2` f32 values"). Splitting means a
  gap-containing region could produce *more* than `bucketCount` conceptual buckets to preserve
  bucket-count-proportional-to-width elsewhere, or fewer/uneven-width buckets near the gap —
  either way, this is a bigger, more invasive contract change than option (b) and it complicates
  the renderer's assumption that bucket `i` always maps to a fixed x-pixel/x-range slot (the
  renderer currently doesn't need per-bucket x-ranges at all since bucket width is uniform;
  splitting reintroduces that need).
- Rejected primarily because it breaks the fixed-length output contract the proposal explicitly
  lists as something to preserve ("effect on its fixed `2*bucketCount` output length" is framed
  in the proposal as a question to *answer*, not silently break).

**(b) Emit an explicit break marker for a mixed bucket**, keeping the fixed `2 * bucketCount`
length.

- The natural encoding, consistent with the already-shipped all-NaN-bucket rule
  (`decimation-min-max`'s "NaN Is the No-Sample Sentinel" requirement): a bucket containing *any*
  gap sample alongside real ones could either (i) still report min/max of only its non-NaN
  samples (today's literal behavior per the existing NaN-tolerant loop — `value < lo`/`value >
  hi` on a NaN comparison is always `false`, so NaN samples are silently skipped and the bucket's
  real-sample envelope is unaffected) — this is precisely the "narrower than a bucket disappears"
  bug the proposal opens with — or (ii) be redefined to emit a break (`NaN`/`NaN`, matching the
  all-gap case) whenever *any* sample in the bucket is a gap, collapsing "some gap" and "all gap"
  into the same sentinel.
- (ii) is the only option that actually fixes the described bug (sub-bucket-width holes
  disappearing) while keeping the fixed output length. It does mean min-max's peak-preservation
  guarantee gets *coarser* near any gap — a bucket adjacent to even a single dead sample now
  reports no envelope at all for that bucket's full width, potentially hiding real peaks that
  shared the bucket with the gap. This is a real, spec-worthy tradeoff to name explicitly:
  min-max trades some peak fidelity at gap-adjacent buckets for correct gap visibility, whereas
  LTTB (Q1/Q2) does not have to make this tradeoff because it operates on samples, not
  fixed-width buckets, and can shrink segment boundaries to exclude the gap precisely.
- Zero-GC / sizing: free — same `2 * bucketCount` fixed loop, same per-sample comparison count,
  just widening the loop's exit condition to also track "did I see any NaN in this bucket" (one
  boolean flag, register-cost only).
- Index-variant (`minMaxEnvelopeIndices`) analog: emit `[-1, -1]` (or reuse the collapsed
  `[start, start]` convention it already has for all-NaN) for a mixed-or-all-gap bucket, so both
  min-max functions and LTTB converge on the *same* `-1`-as-break-sentinel idiom recommended in
  Q1 — this is the cross-cutting consequence flagged below.
- Backward compat: gap-free input never has a NaN sample in any bucket, so the new "any-NaN →
  break" branch never fires — bit-identical to today's output for existing goldens.

### Recommendation: **(b)(ii)**, any gap sample in a bucket collapses that bucket to the break
sentinel (NaN/NaN for `minMaxEnvelope`, `-1`/`-1` for `minMaxEnvelopeIndices`), fixed
`2 * bucketCount` length preserved, unifying with the existing all-NaN-bucket rule rather than
introducing a third "partial" state.

Established-library cross-reference: uPlot, Plotly, and ECharts commonly represent a gap as a
`null`/`NaN` value at the affected data point and rely on their own internal
resampling/downsampling (when used) to propagate that null into whichever output bucket it falls
into, generally by NOT bridging across it — this is directionally consistent with (b)(ii), though
none of them expose a bucketed min-max envelope with a *fixed*-length-output contract as strict
as TraceKit's, so this is a supportive-but-not-exact precedent (medium confidence).

---

## Cross-cutting consequence: unify the break sentinel across both decimators

All three questions converge on the same shape: **`-1` (index space) / `NaN` (value space) as
the one break sentinel**, reusing the all-NaN-bucket convention `decimation-min-max` already
ships and extending it verbatim to `decimation-lttb` and to the "any gap in bucket" case rather
than inventing a second encoding. Concretely:

| Function | Break encoding | Precedent |
|---|---|---|
| `lttb` (Q1) | `-1` in the `Int32Array` output | new, but mirrors GPU primitive-restart convention |
| `minMaxEnvelope` (Q3) | `NaN`/`NaN` pair | already shipped for all-NaN bucket; extended to "any-NaN" |
| `minMaxEnvelopeIndices` (Q3) | `-1`/`-1` pair (or reuse `[start,start]`? — recommend switching to `-1`/`-1` for consistency with `lttb`, even though today's collapsed-`[start,start]` fallback technically already "works") | today: `[start,start]`; recommended: `-1`/`-1` for cross-function consistency |

This lets `buildTracePath` (Canvas2D) and the future WebGL2 consumer share **one** break-detection
idiom (`j === -1`) across both decimation strategies and the direct (non-decimated) path, rather
than branching on which decimator produced the index stream. It also means the WebGL2 primitive-
restart reuse the proposal asks for (Approach step 3) needs no per-decimator special-casing.

One implementation note for `sdd-design` to resolve explicitly: switching
`minMaxEnvelopeIndices`'s existing all-NaN-bucket encoding from `[start, start]` to `[-1, -1]` is
itself a **behavior change to an already-shipped function outside this proposal's nominal scope**
(that function predates this change and its spec already commits to the `[start,start]`
fallback). Recommend treating this as an explicit MODIFIED requirement on
`decimation-min-max`/its index sibling rather than a silent implementation detail, since it is a
visible return-value change for existing callers even though no current caller depends on the
all-NaN case today (worth confirming via a repo-wide usage check before design locks it in).

## Open items for `sdd-design`

> **Resolved.** All items below are closed by `design.md` (D1–D10). Kept as exploration history only.

1. Confirm the two-traversal cost for gapped LTTB (Q2) is acceptable, or find/reject an
   allocation-free single-pass alternative; word the MODIFIED work-count requirement accordingly
   (gap-free stays one traversal; gapped is two).
2. Decide whether `minMaxEnvelopeIndices`'s existing `[start, start]` all-NaN encoding should be
   migrated to `[-1, -1]` for cross-function consistency (recommended) or left as-is with `lttb`
   and `minMaxEnvelope` diverging from it.
3. Word the exact "every non-`-1` index lies in `[sourceOffset, sourceOffset + sampleCount)`,
   and `-1` never appears for gap-free input" property as the MODIFIED `decimation-lttb`
   requirement's replacement for today's "every emitted index lies in [...]" scenario.

---

## Isolated samples between gaps

> **Superseded.** The deferral recommended below was rejected. Isolated samples are painted in this change as filled square markers, on by default (`design.md` D10). Kept as exploration history only.

`design.md` already resolved this as Risk 4: "out of scope by design... a marker/cap rendering
option is a later adapter/renderer concern," i.e. option **(a)**. This section evaluates that
call against the alternatives, for `sdd-design` (or a follow-up change) to confirm or revisit.

### The four options

**(a) Accepted risk, defer to a future marker option.** `buildTracePath` still issues `moveTo`
with zero `lineTo` for a length-1 segment; Canvas2D strokes nothing; the sample is present in the
path data (correct for hit-testing/export/future consumers) but invisible on screen today.

- Zero-GC: free — no change to the hot path at all, this is the status quo `buildTracePath`
  contract applied literally to a segment of length 1.
- Data honesty: the sample is *not* lost or bridged — it is exactly as present as any other point,
  it just isn't *painted*. This is a strictly better failure mode than the bug this proposal
  exists to close (silent bridging/vanishing); "recorded but unpainted" is a rendering gap, not a
  data-integrity gap.
- Golden/lineCap impact: zero — no new draw call, no new stroke style, existing goldens (butt cap)
  untouched.
- Professional-tool honesty: **weakest of the four for a hardware-characterization tool**. A dead
  detector pixel sitting alone between two dropouts (proposal's own motivating scenario) is
  precisely the case an instrument operator most needs to *see* — a single anomalous point is
  higher-signal than a bridged line, not lower. Deferring it treats the rarest, highest-diagnostic-
  value case as the lowest priority, which inverts the proposal's own stated motivation.

**(b) Always draw a small dot/square sized from `lineWidth`.** Every isolated segment gets an
explicit filled marker (e.g. a `2*lineWidth`-diameter `arc`/`rect`) in addition to (or instead of)
the bare `moveTo`.

- Zero-GC / Path2D batching: **can** stay allocation-free and within the *same* `Path2D` per trace
  — `ctx.arc()`/`Path2D.prototype.arc()` and `.rect()` both append subpaths to an existing `Path2D`
  object with no new object allocation (no new `Path2D`, no new array), exactly like the existing
  `moveTo`/`lineTo` calls; the "one `Path2D` per trace" batching invariant the renderer already
  relies on survives unchanged. `.arc()` needs 5-6 scalar args, `.rect()` needs 4 — both are
  as cheap as a `lineTo` call, no new allocation per point.
- lineCap interaction: **irrelevant** — a filled arc/rect is not a stroked zero-length segment, so
  it is immune to the golden-breaking cap-style question in (c) below. This is a real advantage:
  it doesn't force a cap-style decision or touch any existing stroke rendering path.
  `stroke()` after the `arc/rect` subpaths still respects `lineCap` for the *line* segments
  elsewhere in the same `Path2D`, but if the marker is filled (`fill()`) rather than stroked, cap
  style never applies to it at all — cleanest separation.
- Determinism/golden cost: **highest of the four** — every gapped golden fixture that happens to
  produce an isolated segment needs a new visual baseline (new pixels appear that weren't there
  before); this is a real, non-trivial addition to this change's golden matrix (task 9 already
  lists "leading + interior + trailing" gapped goldens — those would need to specifically include
  a length-1 segment case, or a follow-up change captures it).
- Confidence in tool precedent: uPlot in `spanGaps: false` mode does not by default draw isolated-
  point markers either — it also leaves a `moveTo`-only segment unpainted unless the caller
  explicitly enables `points` mode (which uPlot supports as an opt-in, not automatic, decoration).
  Plotly's `mode: 'lines'` has the *identical* problem (isolated point invisible); Plotly's fix is
  `mode: 'lines+markers'`, an explicit, user-selected mode, not automatic marker-on-isolated-point
  behavior. ECharts line series similarly requires `showSymbol`/`symbol` config, not automatic
  gap-aware marker insertion. **This is the key precedent finding: no mainstream charting library
  auto-promotes an isolated point to a marker — marker rendering is opt-in everywhere it exists.**
  (Medium-high confidence — verified against each library's documented gap-handling behavior,
  not by running them.) Keysight/Tektronix bench-scope displays commonly *do* render a single
  live sample as a visible dot/crosshair in live acquisition mode, but that is a distinct
  "instantaneous live trace" convention, not a static/replay decimated-array line-chart convention
  — not a directly transferable precedent to TraceKit's `buildTracePath` contract.
- WebGL2 parity: a filled dot/square requires either a dedicated point-sprite draw call (`gl.POINTS`
  with `gl_PointSize`) or degenerate-triangle geometry injected into the same vertex stream — real,
  separate work in the WebGL2 renderer (future change 7), not something the `-1` primitive-restart
  convention gives for free. This is the same shape of asymmetry Q1 already flagged for other
  gap-encoding choices.

**(c) Zero-length segment with `lineCap: round`/`square`.** Emit a degenerate `moveTo` + `lineTo`
to the *same* coordinate for a length-1 segment, relying on the canvas spec's defined behavior
that a zero-length subpath still renders its `lineCap` shape when stroked with `round` or `square`
(butt-cap zero-length segments are specified to draw nothing — this is the literal bug being
worked around).

- Zero-GC / Path2D batching: free, same subpath machinery, one extra `lineTo` call to the same
  point — cheapest of the visible-marker options, no new draw primitive.
- **Breaks existing goldens or forces a global line-style decision**: `lineCap` is a single
  `ctx`/style property applied to the *entire* stroke call for a `Path2D`, not settable per-
  subpath. TraceKit's current default is (per design/spec silence, and canvas's own default)
  `butt`. Switching to `round`/`square` to make isolated points visible would change the rendered
  shape of **every other segment's end caps too** — not just isolated points — because there is no
  way to scope `lineCap` to one subpath within a single `stroke()` call on a shared `Path2D`. This
  is a hard global side effect, not a targeted fix, and directly threatens "existing goldens
  zero diff" (task 9's own acceptance bar) for any trace whose stroke width is thick enough for
  the cap style to be visible at line joins/ends.
  - Working around this (e.g. stroke the isolated points in a *second*, separate `Path2D`/`stroke()`
    call with its own `lineCap: round` while the main trace path keeps `butt`) reintroduces a
    second `Path2D`/second `stroke()` call per trace — breaking the "one `Path2D` per trace" /
    minimal-draw-call batching invariant the renderer's zero-GC design otherwise preserves, and is
    functionally equivalent to option (b) with worse ergonomics (still needs a marker-detection
    branch, still needs a second draw call, but gets a less controllable circle/square shape than
    an explicit `arc`/`rect`).
- Dashed lines: a zero-length segment under `setLineDash` interacts with the dash phase in
  implementation-defined ways across browsers for degenerate segments — an added cross-browser
  risk (c) carries that (b) does not (a filled `arc`/`rect` is dash-invariant since dashing only
  applies to `stroke()`, and a marker can simply always be filled, never stroked-with-dash).
- **Rejected**: strictly dominated by (b) — same zero-GC cost class, but (b) avoids the global
  `lineCap` side effect, avoids the second-`Path2D` fallback, and avoids the dash-interaction risk.

**(d) Other.** No other option surfaced better dimensions than the three above; not pursued
further.

### Recommendation

**Keep (a) as this change's committed contract** (matches `design.md` Risk 4 — no change needed
here), **but scope a named follow-up rather than leaving it an open-ended "later adapter
concern."** Reasoning:

- (a) is correct as the *decimation/path-building* contract: `lttb`/min-max and `buildTracePath`
  must never lose or bridge a real isolated sample, and they don't — the data survives the pipeline
  intact, which is the actual bug this proposal closes (Risk 3 in `design.md`, already covered by
  the property test "no emitted segment spans a source `NaN`").
- Whether an isolated sample is *painted* is a presentation decision, and the surveyed precedent
  (uPlot/Plotly/ECharts) confirms that mainstream tools treat marker rendering as opt-in, not part
  of the base line-chart contract — so shipping (a) without markers in this change is consistent
  with how the ecosystem actually draws this, not an outlier corner-cut.
- The professional-tool risk in (a) is real (a genuinely isolated live/valid sample can be
  invisible), but it's a visibility gap for a case that's already distinguishable in the data
  (callers can detect `moveTo`-with-no-`lineTo` segments from the same index stream this change
  already produces) — so nothing about shipping (a) now forecloses (b) later; (b) is additive.
- **Recommend (b), not (c), as the follow-up's shape** once scoped: same `Path2D`, filled
  `arc`/`rect` (not stroked, so `lineCap`/dash-invariant), because it's the only visible-marker
  option that doesn't touch the existing stroke/goldens/batching invariants this change already
  locks in, at the cost of new goldens and (later) WebGL2 point-sprite parity work — both bounded,
  known costs, not open-ended ones.

### Exact spec/design deltas implied

- **No delta to this change's specs** (`canvas2d-trace-rendering`, `decimation-lttb`,
  `decimation-min-max`, `gap-sentinel-semantics`) — option (a) is already the committed contract
  and needs no rewording; the property "a length-1 segment produces exactly one `moveTo` and zero
  `lineTo`" is already implied by the existing "one `moveTo` per finite segment, `lineTo` within
  segments" MODIFIED requirement (`specs/canvas2d-trace-rendering/spec.md`) applied to `n === 1`.
- **`design.md` Risk 4 wording**: tighten "a marker/cap rendering option is a later adapter/
  renderer concern" to name the recommended shape explicitly — "a later change adds an *opt-in*,
  filled (`arc`/`rect`, not stroked) isolated-point marker appended to the same `Path2D`, never a
  zero-length-segment/`lineCap` approach (rejected: forces a global cap-style change and reopens
  the one-`Path2D`-per-trace invariant)" — so the deferred decision isn't reopened from scratch.
- **New follow-up proposal** (not this change): an `isolated-point-marker` capability/requirement
  under `canvas2d-trace-rendering` (opt-in flag, default off to match today's silent behavior and
  avoid an automatic golden break for every existing gapped fixture), plus its own golden fixtures
  and, later, a WebGL2 point-sprite requirement for parity. Out of this change's scope per
  `design.md`.
