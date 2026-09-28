# Technical Design: core-gap-and-multi-trace-model

> Roadmap `order: 5.7`. Inputs: `proposal.md` (scope, confirmed product decisions), `exploration.md`
> (gap-encoding options), the delta specs under `specs/`, and the current implementations of
> `packages/core/src/decimation/{lttb,min-max,min-max-indices}.ts`,
> `packages/core/src/payload/spectrum-data-payload.ts`, `packages/core/src/viewport/axes.ts`,
> `packages/renderers/src/path/build-trace-path.ts` and
> `packages/renderers/src/canvas2d/canvas2d-renderer.ts`.
>
> This document resolves **D1–D10**. Every exploration recommendation was re-checked against the
> code before adoption; where the check changed the recommendation, the decision says so. Delta
> specs were amended where they contradicted the chosen design (see "Spec Amendments").

---

## Context & Background

Three facts from the code drive this design:

1. `lttb` (`lttb.ts`) writes exactly `threshold` absolute indices in one forward traversal. The
   interior samples are read once while accumulating the bucket mean (`sumY += y[i]`) and once as
   triangle-area candidates. A `NaN` poisons `sumY`, then `avgY`, then every area in the next
   bucket; `area > bestArea` is then always `false`, so selection silently falls back to
   `prevStart`. The output looks valid and bridges the hole.
2. `minMaxEnvelope` already skips `NaN` (every comparison with `NaN` is `false`) and emits
   `NaN`/`NaN` for an all-`NaN` bucket. The archived `decimation-min-max` spec *requires* that a
   mixed bucket reports the envelope of its real samples only — that sentence is the defect this
   change closes, so it must be superseded explicitly, not "narrowed".
3. `minMaxEnvelopeIndices` initializes `loIndex = hiIndex = start`; an all-`NaN` bucket therefore
   emits `[start, start]`, an index pointing at a `NaN` sample. `buildTracePath` then draws a
   `NaN` coordinate. That fallback is **not** specified anywhere (`selectable-decimation` has no
   `NaN` scenario; the only related test, "all equal samples emit the same index twice", uses
   finite data). A repo-wide grep shows its only production caller is
   `Canvas2DRenderer#recomputeDecimationIfStale`; the other references are tests
   (`min-max-indices.test.ts`, `allocation-gate.test.ts`, `renderers/test/node/work-counts.test.ts`,
   `export-surface.test.ts`) and changelogs. None depends on the `[start, start]` value.

`buildTracePath` issues one `moveTo` then `n - 1` `lineTo` unconditionally, so even a correct
decimator output could not express a break. `SpectrumDataPayload` is single-trace; the renderer
holds one payload, one index buffer and one set of memo fields.

---

## Goals & Non-Goals

### Goals
- One break idiom end to end: `NaN` in source Y, `-1` in every emitted index stream, `NaN`/`NaN`
  in the value-space envelope. One consumer check per point.
- Gap-free input stays byte-identical in both decimators and pixel-identical in every existing
  golden.
- Zero allocation in every decimator call and in each per-trace point loop, with or without gaps.
- `TraceCollection` in core; per-trace transform, style, `Path2D` and memo in the Canvas2D
  renderer; axis binding resolved once per collection revision into an `Int32Array`.
- Every real measured sample is visible: a finite segment that references exactly one source
  sample (an isolated sample between gaps) is painted as a filled marker by default (D10).

### Non-Goals
- `NaN` in X, per-trace X units, resampling, gap filling, legends, visibility toggles.
- WebGL2 and SVG consumers (changes 6/7) — only the index contract they will consume, and the
  isolated-sample visibility requirement they must honor (D8, D10), are fixed here.
- Framework adapters. `packages/vue` and `packages/react` are untouched.

---

## Architecture & Data Flow

```text
 SpectrumDataPayload (per trace)          TraceCollection (core, frozen)
   x: Float32Array (offsets)                entries[i] = { id, payload, yAxisId, style }
   y: Float32Array  NaN = gap               xDomainMin/xDomainMax, revision
        |                                          |
        |                          resolveTraceAxisIndices(collection, axes, out: Int32Array)
        |                          (cold: setTraces / axis change; never per frame)
        v                                          v
 +------------------ Canvas2DRenderer.render() -------------------------------+
 | setTransform(1,0,0,1,0,0) once; grid; for each trace i (index loop):      |
 |   t_i   = #traceTransforms[i]   (axis Y params + payload i's xOrigin)     |
 |   memo_i stale? -> lttb(x_i, y_i, ..., #indices[i], 0, threshold)         |
 |                    returns threshold  -> decimated walk                   |
 |                    returns 0 (infeasible) -> minMaxEnvelopeIndices(...)   |
 |   path = new Path2D()                                                     |
 |   buildTracePath(path, t_i, x_i, y_i, #indices[i], count_i, sampleCount_i)|
 |       decimated: j < 0      -> pen up          direct: y[j] !== y[j] -> pen up
 |   strokeStyle/lineWidth/setLineDash from pre-resolved per-trace arrays    |
 |   stroke(path)                                                            |
 |   isolatedCount_i > 0 && markers_i ? (D10)                                |
 |     markers = new Path2D(); buildIsolatedMarkers(markers, t_i, ..., half) |
 |     fillStyle = stroke color_i; fill(markers)                             |
 | axes                                                                      |
 +---------------------------------------------------------------------------+

 Index stream contract (Int32Array, both decimators):
   [ 0, 7, 19, 39, -1, 45, 88, 131, 199, -1, -1 ]
     \_ segment A _/  ^  \____ segment B ____/  \_ padding (lttb) _/
                    break
   -1 as Int32 == 0xFFFFFFFF as Uint32 == WebGL2 primitive-restart index for UNSIGNED_INT.
```

No new worker boundary is introduced. When decimation later runs in a worker (existing
`transport/decimation-port.ts` contract), the index buffer crosses as a Transferable exactly as
today; `-1` needs no side channel because it lives inside the same `ArrayBuffer`.

---

## Technical Decisions

### D1 — LTTB break encoding: `-1` sentinel inside the `Int32Array`

**Decision.** `lttb` marks a break by writing `-1` into the output slot between the last index of
one finite segment and the first index of the next. Every other written slot is a valid absolute
index in `[sourceOffset, sourceOffset + sampleCount)` whose `y` is finite. `-1` never appears for
gap-free input.

**Verified against code.** The output type is `Int32Array`, which represents `-1` natively; every
real index is `>= 0` (validation already restricts `sourceOffset` to `[0, 2^31)`), so the sentinel
is out of band. A `Uint32Array` view over the same buffer reads `0xFFFFFFFF`, the fixed WebGL2
primitive-restart index for `UNSIGNED_INT` (WebGL2 always enables primitive restart with the
maximum index) — change 7 can upload the bytes unchanged.

**Alternatives considered.**
- *Gap sample's own index* — the consumer must dereference `y[j]` to learn it is a break, a float
  self-compare plus a memory read per vertex, and it is not consumable by primitive restart.
  Rejected.
- *Parallel segment-offset buffer* — an eighth positional parameter, a second caller buffer whose
  worst-case size is unknowable without a pre-scan, and two cursors in the render walk. Offsets are
  derivable from a `-1` stream downstream if a consumer ever needs them. Rejected.

**Trade-offs.** One integer compare per emitted index in the consumer; no memory cost. Break slots
consume output budget (one slot per interior gap run), which D2 accounts for.

### D2 — LTTB return-count contract and threshold apportionment

**Decision — return count.**
- Gap-free input: writes and returns exactly `threshold`, byte-identical to today.
- Gapped input, feasible (see below): writes exactly `threshold` slots and returns `threshold`.
  Slots are, in order: segment 1 indices, `-1`, segment 2 indices, `-1`, …, last segment indices,
  then trailing `-1` padding up to `threshold`. Breaks are only written *between* segments; a
  leading or trailing gap produces no leading break (the first slot is the first finite index).
- All-`NaN` input: writes `threshold` slots, all `-1`, returns `threshold`.
- Gapped input, infeasible: returns `0` and leaves `out` contents unspecified. `0` means "this
  input cannot be represented within `threshold` without dropping a segment or bridging a gap".

The exploration recommended preserving the `threshold` return count; that is kept for every
representable case. The infeasible case was not covered by the exploration and is added here
because the apportionment minimums can exceed `threshold` (e.g. 1,000 alternating finite/`NaN`
samples at `threshold = 64`).

**Decision — apportionment.** Let `S` be the number of finite segments, `L_s` their lengths,
`F = sum(L_s)` the finite sample count, and `min_s = 2` if `L_s >= 2`, else `1` (singleton emitted
as an isolated point, per the exploration; dropping it would be silent data loss).
1. Budget `B = min(threshold - (S - 1), F)`.
2. Required `M = sum(min_s)`. If `M > B`, the input is infeasible: return `0`.
3. Extra `E = B - M`, spare capacity `C = F - M`. Walking segments in order with running spare
   `cum` (before) and `cum + (L_s - min_s)` (after), segment `s` receives
   `k_s = min_s + floor(E * after / C) - floor(E * before / C)` (`k_s = min_s` when `C === 0`).
   This is the same cumulative-floor idiom already used for bucket boundaries in `lttb.ts`, so the
   sum is exactly `B`, it is order-deterministic, and `k_s <= L_s` always holds because `E <= C`.
4. Per segment: `k_s === 1` writes its only index; `k_s === 2` writes its two endpoints;
   `k_s >= 3` runs the existing LTTB core over `[segStart, segStart + L_s)` with threshold `k_s`,
   which retains both endpoints by construction.
5. `threshold - (B + S - 1)` trailing slots are padded with `-1`.

**Decision — traversal strategy (the exploration's open item 1).** Gap-free input keeps the
single forward traversal; gapped input uses a bounded multi-pass path. Concretely:
- The current loop body is extracted verbatim into a private `lttbCore(x, y, start, count, out,
  cursor, k)` (no validation, returns `-1` on abort). The accumulation read becomes
  `const v = y[i]!; if (v !== v) return ABORT; sumY += v;` — the same value, the same summation
  order, so the arithmetic is bit-identical. Endpoints `y[sourceOffset]` and `y[lastIndex]` are
  self-compared before the loop.
- `lttb` calls `lttbCore` over the whole range first. On gap-free input it completes and nothing
  else runs: one traversal, at most two reads per interior sample, as archived.
- On abort, `lttb` runs the gapped path: one counting scan (`S`, `F`, `M`; no allocation, three
  integers), then the per-segment walk, which finds each segment's end by scanning forward and
  calls `lttbCore` (which cannot abort on a `NaN`-free segment). Worst case per sample: 2 reads in
  the aborted pass, 1 in the counting scan, 1 in the segment-end scan, 2 in the segment core — at
  most **6 reads**, O(n), zero allocation.

**Alternatives considered.**
- *Always pre-scan, then decimate* — adds a third read per sample to gap-free input, breaking the
  archived two-read bound and costing ~30% on the common case. Rejected.
- *Single-pass lazy apportionment* — a segment's share depends on `F`, which is unknown until the
  end of input, so a single pass requires either backtracking writes (not possible in a fixed-slot
  stream without a scratch buffer) or a scratch `Int32Array` parameter, reopening the API-surface
  cost of the parallel-buffer option. Rejected.
- *Equal split per segment* — starves long segments, wastes slots on short ones. Rejected.
- *Throw on infeasible input* — turns a data property into an exception in the render loop.
  Rejected; D3 handles `0` in the renderer.
- *Grow the output past `threshold` when infeasible* — the caller cannot size `out` without
  knowing `S`. Rejected.

**Trade-offs.** Gapped input costs up to ~3x the read work of gap-free input; still linear and
allocation-free. Accepted because gaps are the exceptional case and correctness is the point.
`E * after` can exceed `2^53` only when both operands exceed `2^26`, the same precision domain as
the existing `bucket * interior` expression; the result is deterministic in either case.

### D3 — Renderer fallback for infeasible LTTB

**Decision.** When `lttb` returns `0`, `Canvas2DRenderer` immediately calls
`minMaxEnvelopeIndices` for the same trace with `bucketCount = floor(threshold / 2)` (at least 1)
into the same index buffer, and draws that. Min-max has a fixed `2 * bucketCount` output that is
always representable (D4), so the fallback always succeeds. The memo records the fallback result
under the `lttb` key, so the fallback does not re-run on unchanged frames.

**Alternatives considered.** Drawing undecimated (`decimatedCount = 0`) would be correct but can
push hundreds of thousands of points through `Path2D` for a pathologically fragmented sweep.
Rejected in favor of the bounded min-max output.

**Trade-offs.** A fragmented trace may silently switch visual character (envelope instead of
LTTB polyline). Acceptable: the data is fragmented below pixel resolution, and min-max is the
peak-preserving choice at that density.

### D4 — Min-max break encoding: any gap collapses the bucket, fixed `2 * bucketCount` kept

**Decision.**
- `minMaxEnvelope`: a bucket containing at least one `NaN` sample emits `NaN`/`NaN`. This
  supersedes the archived "emit the min/max of its non-`NaN` samples only" sentence. The all-`NaN`
  case is the same rule. `±Infinity` propagates unchanged only in buckets containing no `NaN`; in a
  mixed bucket the break takes precedence.
- `minMaxEnvelopeIndices`: a bucket containing at least one `NaN` sample emits `[-1, -1]`,
  replacing the unspecified `[start, start]` fallback for all-`NaN` buckets and the real-sample
  indices for mixed buckets.
- Output length stays exactly `2 * bucketCount` for both functions; return values unchanged.
- Implementation: one `sawGap` register per bucket, set by `if (value !== value) sawGap = true`
  on the value already read. One read per sample, one pass. The pinned write lines
  `out[writeCursor] = lo;` / `out[writeCursor + 1] = hi;` in `min-max.ts` are preserved (the
  collapse assigns `lo = hi = NaN` before them), so the existing source-pin test holds.

**Migration of `[start, start]` → `[-1, -1]`: adopted.** Grep evidence (Context point 3) shows no
caller depends on the old value and the old value draws a `NaN` coordinate, i.e. it was already
broken. Because it is still a visible return-value change of a shipped function, the
`decimation-min-max` delta now carries an explicit MODIFIED requirement for it.

**Agreement requirement.** The archived `selectable-decimation` requirement "`minMaxEnvelopeIndices`
agrees bucket-for-bucket with `minMaxEnvelope`'s extremes" remains true under decoding: a `NaN`/`NaN`
bucket corresponds to a `[-1, -1]` bucket; every other bucket is unchanged.

**Alternatives considered.** *Split buckets at the gap* breaks the fixed output length and
reintroduces per-bucket x ranges in the renderer. Rejected. *Keep the real-sample envelope and add
a flag* needs a second output. Rejected.

**Trade-offs.** Peak fidelity is lost for the full width of any bucket touching a gap: a real
peak sharing a bucket with one dead sample disappears. This is stated in the spec as the price of
never bridging; LTTB does not pay it because it segments at sample granularity.

### D5 — Unified break idiom in `buildTracePath`

**Decision.** Signature unchanged (required by `multi-axis-viewport`). The body becomes a pen-state
walk:

```ts
let penDown = false;
for (let i = 0; i < n; i += 1) {
  const j = decimated ? (indices[i] ?? -1) : i;
  if (j < 0) { penDown = false; continue; }             // decimated break (-1)
  const yj = y[j] ?? NaN;
  if (yj !== yj) { penDown = false; continue; }          // direct-path gap (NaN)
  const px = projectX(t, x[j] ?? 0), py = projectY(t, yj);
  if (penDown) sink.lineTo(px, py); else { sink.moveTo(px, py); penDown = true; }
}
```

The decimated path never needs the `NaN` check (decimators never emit an index to a `NaN`
sample), but the single loop keeps one shape for both modes and one self-compare is cheaper than
two specialised loops' code size; the branch is perfectly predicted on gap-free data. Consecutive
`-1` values (padding, adjacent min-max gap buckets) are idempotent. Return value stays `n`.

For gap-free input the sequence is exactly one `moveTo` then `n - 1` `lineTo` with identical
arguments, so existing goldens and call-sequence tests hold.

**Alternatives considered.** Separate loops per mode (marginally faster, duplicated projection
code); a `NaN`-coordinate "break" relying on canvas no-op behavior (undefined across engines and
not a break in `Path2D` semantics). Both rejected.

### D6 — `TraceCollection` shape and lifecycle

**Decision.** New module `packages/core/src/payload/trace-collection.ts`:

```ts
export interface TraceStyle {
  readonly color?: string;
  readonly lineWidthCss?: number;
  readonly dash?: readonly number[];   // CSS pixels; frozen
  readonly markIsolatedSamples?: boolean; // absent = true; renderer-resolved (D10)
}
export interface TraceEntry {
  readonly id: string;
  readonly payload: SpectrumDataPayload;
  readonly yAxisId: string;
  readonly style: TraceStyle;          // frozen, possibly empty
}
export interface TraceCollection {
  readonly entries: readonly TraceEntry[];
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly revision: number;
}
createTraceCollection(entries, axes, xDomainMin, xDomainMax): TraceCollection
withTraceAxis(collection, traceId, yAxisId, axes): TraceCollection      // revision + 1
withTraceStyle(collection, traceId, style): TraceCollection             // revision + 1
resolveTraceAxisIndices(collection, axes, out: Int32Array): number
```

- Immutability by replacement: every update returns a new frozen collection with `revision + 1`;
  payload references are shared, not copied. Member `commitPayloadRevision` never touches the
  collection revision.
- Validation (unknown `yAxisId`, duplicate `id`) runs over the inputs before anything is frozen;
  the error is a `RangeError` naming the offending value. Validation uses a local `Set` — cold path.
- `resolveTraceAxisIndices` writes `out[i] = index of axes[k].id === entries[i].yAxisId`, a nested
  linear scan (trace and axis counts are tiny), and returns the entry count. It lives here, not in
  `axes.ts`, per the `multi-axis-viewport` amendment.
- No default palette and no default line width in core.

**Alternatives considered.** A mutable collection with methods (conflicts with the frozen-entry
requirement and hides revision bumps); widening `SpectrumDataPayload` (explicitly not changed by
the proposal); a `Map<yAxisId, index>` cached on the collection (a keyed lookup the spec forbids
in the frame loop, and a non-plain value that fails `structuredClone` to a worker).

**Trade-offs.** Each update allocates a new small collection object — cold path, acceptable.

### D7 — Per-trace state in `Canvas2DRenderer` (zero-GC in `render()`)

**Decision.**
- New `setTraces(collection: TraceCollection): void` on `Canvas2DRenderer` and on the
  `FigureRenderer` interface. `setData(payload)` is retained as a separate, mutually exclusive
  entry point rather than being rewritten in terms of `setTraces`: it keeps its own legacy
  single-payload state and render branch, while `setTraces` owns the per-trace state described
  below and its own render branch. Calling one clears the other's state. The two paths are
  behaviorally equivalent for a single trace (same Path2D/transform/memo output), which is what
  the delta spec requires, but they are not implemented as one path reduced to a single entry —
  keeping `setData` self-contained avoided threading a one-entry `TraceCollection` (and its
  frozen-array/style-resolution overhead) through the hot legacy path for existing callers who
  never adopt multi-trace. All allocation happens on `setTraces`/`setData`, never in `render()`.
- On `setTraces` (or when the collection reference or its revision changes), the renderer
  allocates parallel per-trace state sized to `entries.length`:
  - `#traceAxisIndex: Int32Array` filled by `resolveTraceAxisIndices`;
  - `#traceIndices: IndexBuffer[]` (one per trace, capacity per the existing
    `#ensureIndexCapacity` rule);
  - `#traceDecimatedCount: Int32Array`;
  - memo columns: `#memoRevision: Float64Array`, `#memoParameter: Int32Array`,
    `#memoAlgorithm: Uint8Array`, `#memoXMin/#memoXMax/#memoYMin/#memoYMax: Float64Array`;
  - resolved style columns: `#traceStroke: string[]`, `#traceLineWidthCss: Float64Array`,
    `#traceDashDevice: number[][]` (dash pre-multiplied by `dpr`, rebuilt on `resize`), with
    defaults from a fixed renderer palette `TRACE_PALETTE[i % length]` in `style.ts` and
    `FigureStyle.lineWidthCss`.
- `#traceTransforms: ViewportTransform[]`, rebuilt on `setTraces`/`resize`/`setDomain`: for each
  trace, `createViewportTransform` with the bound axis's Y domain and scale kind and **that trace's
  payload `xOrigin`**. Payloads may carry different `xOrigin` values (Confirmed Product Decision 2);
  sharing one axis transform across them would misplace every trace but the first.
- The collection's `xDomainMin/xDomainMax` seed the view X domain on `setTraces`; `setDomain`
  remains the view window thereafter (pan/zoom is a view concern, not a data concern).
- `render()` loops `for (let i = 0; i < count; i += 1)`, reads only typed columns and the
  pre-resolved arrays, constructs one `Path2D` per trace, sets `strokeStyle`, `lineWidth`,
  `setLineDash(#traceDashDevice[i])` (reference, no allocation), and strokes. `setTransform` is
  still called once per frame. `TraceDrawingContext` gains `setLineDash(segments: number[]): void`.
- Memo per trace: stale when payload revision, algorithm, parameter, or the trace's bound X/Y
  domain changed. A revision bump on one trace re-decimates only that trace.

**Alternatives considered.** An array of per-trace state objects (object reads in the frame loop
are fine, but creating them on each `setTraces` is equivalent; parallel typed columns were chosen
because they match the existing field-per-memo style and make the zero-GC gate trivially
auditable). Keeping one shared index buffer and re-decimating per trace per frame (violates the
per-trace memo requirement).

**Trade-offs.** Memory: one index buffer per trace (`~2 x plotWidth` Int32 each, ~15 KB at
1920 px). Negligible.

### D8 — Engine strategy

**Decision.** This change touches only the Canvas2D engine. The 80k-point engine switch is out of
scope and unchanged; the index contract (D1, D4) is chosen so the WebGL2 engine consumes the
same buffer as a primitive-restart element array with no conversion. The per-trace model (D7) is
the shape change 7 mirrors with one VBO pair per trace. Engine selection remains per figure, not
per trace — a trace collection above the switch threshold moves wholesale.

**WebGL2 parity requirement for change 7 (no code here).** The isolated-sample marker (D10) is a
visibility requirement, not a Canvas2D detail. Primitive restart alone draws nothing for a
one-vertex strip, so change 7 MUST render every isolated segment (same definition as D10) as a
point primitive: a second draw call per trace with `gl.POINTS` over an isolated-index element
buffer (or an instanced quad), `gl_PointSize` equal to the D10 marker side in device pixels, a
square (unrounded) fragment so it matches the Canvas2D shape, the trace color, and the same
per-trace `markIsolatedSamples` flag. The isolated-index list is derived from the same `-1`
stream on the same memo key as D10's isolated count; `gl_PointSize` is clamped by
`ALIASED_POINT_SIZE_RANGE`, which change 7 must query and document (the spec minimum of 1 px is
the only guaranteed value). Change 7's proposal must carry this as a MODIFIED/ADDED requirement.

**Alternatives considered.** Per-trace engine selection (mixing two canvases per figure) —
compositing and draw-order complexity with no stated need. Rejected.

### D9 — Reactivity isolation (forward contract for adapters 10/11)

**Decision.** `TraceCollection` is frozen and holds payload references whose typed arrays must
never be proxied. Adapters MUST hold a collection in `shallowRef` (Vue 3) or `useRef` (React) and
pass it to `setTraces` by reference; `markRaw` on each payload remains the existing rule. Because
updates replace the collection object, a `shallowRef` assignment is the only reactive signal
needed — no deep watch. No adapter code changes in this change; the rule is recorded here so
changes 10/11 do not rediscover it.

### D10 — Isolated samples are painted as filled square markers (default on)

**Definition.** An *isolated segment* is a finite segment (per `gap-sentinel-semantics`) that
references exactly one distinct source index. Direct path: a segment of length 1. Decimated path:
a segment whose non-`-1` indices are all equal — this covers an LTTB singleton (`k_s === 1`, D2)
and a min-max bucket emitting `[i, i]` between two `[-1, -1]` buckets, which would otherwise be a
zero-length stroke (invisible under `butt` cap).

**Decision.**
- Each isolated segment is painted as an axis-aligned **filled square** centered on
  `(projectX(t, x[j]), projectY(t, y[j]))`, side `s = 2 * lineWidthDevice` where
  `lineWidthDevice = traceLineWidthCss[i] * dpr` (the same value assigned to `ctx.lineWidth`), i.e.
  `rect(px - s / 2, py - s / 2, s, s)`. Color is the trace's resolved stroke color, applied as
  `fillStyle`. No stroke, so `lineCap`, `lineJoin` and `setLineDash` never affect it.
- **Default on.** `TraceStyle` gains `markIsolatedSamples?: boolean`; absent or `true` paints
  markers, `false` disables them for that trace. The single-trace `setData` path uses the default
  (on). A real measured sample must never be invisible in a characterization tool; the opt-out
  exists for callers who render their own markers.
- **Batching: a second `Path2D` per trace, filled once, only when needed.** The line path is
  stroked, the marker path is filled; one `Path2D` cannot serve both (filling the line path would
  implicitly close and fill every polyline subpath). `Path2D` has no reset method, so a marker path
  cannot be preallocated across frames; it is constructed in `render()` exactly like the existing
  per-trace line `Path2D` (archived per-render construction, constant per trace, never per point),
  and **only when** `#traceIsolatedCount[i] > 0` and the flag is on. Per trace, the call order is
  `strokeStyle`, `lineWidth`, `setLineDash`, `stroke(line)`, then — only if markers are drawn —
  `fillStyle`, `fill(markers)`. Markers therefore sit above their own line and below the next
  trace, preserving collection draw order.
- **Counting on the cold path.** `#traceIsolatedCount: Int32Array(entries.length)` is allocated in
  `setTraces` and refreshed whenever that trace's decimation memo is recomputed (payload revision,
  algorithm, parameter or domain change — the same key, D7) by a pure counting walk
  `countIsolatedSegments(x, y, indices, decimatedCount, directCount): number` (integer locals only).
  Unchanged frames never recount.
- **Marker walk in a sibling function.** `buildIsolatedMarkers(sink: MarkerSink, t, x, y, indices,
  decimatedCount, directCount, halfSide): number` walks the same stream with the same pen-state
  rules as D5, tracks the current segment's first index and a "distinct" flag in locals, and on
  each segment close (break or end of stream) calls `sink.rect(...)` if the segment was isolated.
  It returns the marker count. `MarkerSink` is `{ rect(x, y, w, h): void }`, satisfied by `Path2D`
  and by a counting fake. It runs only on traces with `isolatedCount > 0`.
- **`TraceDrawingContext` extension.** Gains `fill(path: Path2D): void` (alongside
  `setLineDash`, D7). `fillStyle` already exists; axis label drawing (`axes.ts`) and background
  fill set `fillStyle` explicitly before use, so the marker `fillStyle` assignment does not leak
  into later draws. The fake context records `fill` in the same ordered call log as `stroke`.

**Why square, not arc.** At marker sizes of 2–6 device pixels a circle and a square are visually
equivalent, but an axis-aligned `rect` rasterizes identically across engines (four edges, no
curve tessellation or anti-aliasing variance along a curve), which keeps the new golden stable on
the single Linux corpus; it takes 4 scalars instead of 6; and it maps one-to-one onto a WebGL2
point sprite, which is square by default (D8 parity). A circle would need `arc` + `closePath` per
marker and a `discard`-based round fragment shader in change 7.

**Why a sibling function, not a wider `buildTracePath`.** The `multi-axis-viewport` delta requires
`buildTracePath`'s signature to stay identical, and `PolylineSink` is its contract. Adding a
marker sink parameter or widening `PolylineSink` breaks that requirement. The cost of the separate
walk is paid only by traces that actually contain an isolated segment; gap-free traces run
neither the marker walk nor the fill.

**Golden invariance.** Gap-free input has exactly one segment, which is isolated only when the
whole trace is one sample (`sampleCount === 1`, not present in any existing golden). So
`isolatedCount === 0`, no marker `Path2D` is constructed, no `fillStyle`/`fill` call is issued,
and the recorded call sequence and pixels of every existing golden are unchanged.

**Alternatives considered.**
- *Defer (status quo `moveTo` only).* The sample is kept in the data but invisible: the exact
  failure class this change exists to close, for the highest-diagnostic-value case (a lone valid
  sample between dropouts). Rejected.
- *Zero-length segment + `lineCap: round|square`.* `lineCap` is per `stroke()` call, so it changes
  every segment end on the shared path (breaks goldens), and zero-length dashed segments are
  engine-dependent. Scoping it to a second stroked path is equivalent to D10 with less control.
  Rejected.
- *Markers appended to the line `Path2D`, one `stroke()`.* A stroked `rect` outline, not a filled
  dot; affected by `setLineDash`; size coupled to line width twice. Rejected.
- *Opt-in (default off), matching uPlot/Plotly/ECharts.* Those are general charting libraries; a
  characterization tool must not hide measured data by default. Rejected by product decision.
- *Allocate the marker `Path2D` unconditionally per trace.* Harmless for pixels but adds a
  per-trace allocation and a `fill` call to every gap-free frame, and changes the call-sequence
  contract of existing tests. Rejected.

**Trade-offs.** One extra `Path2D` and one `fill` per trace per frame only for traces with
isolated segments; one extra O(n) walk on those traces per frame plus one counting walk per memo
recompute. A dense run of isolated samples (alternating finite/`NaN` below pixel resolution) is
normally routed through the min-max fallback (D3), where any gap collapses the bucket; markers
then appear only for genuinely isolated buckets.

---

## Zero-GC Buffer Sizing

| Buffer | Owner | Size | Allocated |
|---|---|---|---|
| LTTB output | renderer, per trace | `>= threshold` (unchanged rule: `max(2, ceil(plotWidth * 2), emitted)`) | `setTraces`, `resize`, capacity growth |
| Min-max indices output | same buffer | `2 * bucketCount <= threshold` | never separately |
| Axis index map | renderer | `Int32Array(entries.length)` | `setTraces` / collection revision |
| Per-trace memo/style columns | renderer | `entries.length` each | `setTraces` |
| Per-trace dash (device px) | renderer | `dash.length` per trace | `setTraces`, `resize` |
| Isolated-segment count, marker flag | renderer | `Int32Array` / `Uint8Array(entries.length)` | `setTraces`; count refreshed on memo recompute |
| Marker `Path2D` | renderer, per trace with markers | subpaths = isolated count | `render()`, only when count > 0 and flag on (same per-trace class as the line `Path2D`) |
| Decimator scratch | none | — | the gapped LTTB path uses only integer locals |

Break slots never require extra capacity: they are counted inside `threshold` (LTTB) or inside the
fixed `2 * bucketCount` (min-max).

---

## File Changes

| Action | File Path | Description |
|---|---|---|
| MODIFY | `packages/core/src/decimation/lttb.ts` | Extract `lttbCore` with inline `v !== v` abort; gapped path (count scan, apportionment, per-segment walk, `-1` breaks and padding); return `0` when infeasible; JSDoc return contract |
| MODIFY | `packages/core/src/decimation/min-max.ts` | `sawGap` register; any-`NaN` bucket → `NaN`/`NaN`; pinned write lines preserved |
| MODIFY | `packages/core/src/decimation/min-max-indices.ts` | `sawGap` register; any-`NaN` bucket → `[-1, -1]` |
| NEW | `packages/core/src/payload/trace-collection.ts` | `TraceStyle` (incl. `markIsolatedSamples?: boolean`), `TraceEntry`, `TraceCollection`, `createTraceCollection`, `withTraceAxis`, `withTraceStyle`, `resolveTraceAxisIndices` |
| MODIFY | `packages/core/src/payload/spectrum-data-payload.ts` | JSDoc only: X finite-at-every-index producer contract; `NaN` in Y denotes a gap |
| MODIFY | `packages/core/src/index.ts` | Export collection API and types; `BREAK_INDEX = -1` constant |
| MODIFY | `packages/core/SIDE_EFFECTS_AUDIT.md` | Row for `trace-collection.ts` |
| MODIFY | `packages/renderers/src/path/build-trace-path.ts` | Pen-state walk (D5); signature unchanged |
| NEW | `packages/renderers/src/path/isolated-markers.ts` | `MarkerSink`, `countIsolatedSegments`, `buildIsolatedMarkers` (D10) |
| MODIFY | `packages/renderers/src/canvas2d/canvas2d-renderer.ts` | `setTraces`; per-trace columns, transforms, memo, style; LTTB→min-max fallback; `setData` as one-entry collection; isolated count on memo recompute, conditional marker `Path2D` + `fill` (D10) |
| MODIFY | `packages/renderers/src/figure-renderer.ts` | `setTraces(collection)` member |
| MODIFY | `packages/renderers/src/surface.ts` | `setLineDash` and `fill(path)` on `TraceDrawingContext` |
| MODIFY | `packages/renderers/src/style.ts` | `TRACE_PALETTE` (frozen, renderer-owned) |
| MODIFY | `packages/renderers/src/fixtures/scenarios.ts` | Gapped-trace (incl. one isolated sample) and two-trace/two-axis scenarios |
| NEW | `packages/core/test/decimation/lttb-gaps.test.ts` | Encoding, apportionment, singleton, leading/trailing/all-`NaN`, infeasible, property tests |
| NEW | `packages/core/test/decimation/min-max-gaps.test.ts` | Mixed/all-`NaN` buckets both variants, `±Infinity` precedence, read count |
| NEW | `packages/core/test/decimation/lttb-gapfree-golden.test.ts` | Byte-identical output vs committed pre-change fixtures |
| MODIFY | `packages/core/test/decimation/allocation-gate.test.ts` | Gapped configurations for both decimators |
| NEW | `packages/core/test/payload/trace-collection.test.ts` | Node env: freeze, validation, revision, resolution |
| MODIFY | `packages/core/test/export-surface.test.ts` | New exports; assert no palette export |
| MODIFY | `packages/renderers/test/node/build-trace-path.test.ts` | Segment call sequences, direct and decimated |
| NEW | `packages/renderers/test/node/isolated-markers.test.ts` | Count and marker walks, direct and decimated (LTTB singleton, min-max `[i, i]`), marker geometry |
| MODIFY | `packages/renderers/test/node/work-counts.test.ts` | Per-trace memo counts; fallback invocation |
| MODIFY | `packages/renderers/test/node/allocation-gate.test.ts` | Two-trace render zero-GC |
| MODIFY | `packages/renderers/test/node/figure-renderer-shape.test{,-d}.ts` | `setTraces` member |
| MODIFY | `packages/renderers/test/visual/canvas2d.visual.test.ts` + goldens | Gapped (with isolated-sample marker) and overlay goldens |
| NEW | `.changeset/*.md` | Patch bump for `@trace-kit/core` and `@trace-kit/renderers` |

---

## Test Strategy (TDD order)

Each step is RED → GREEN → REFACTOR; gates run after each layer.

1. **Gap-free regression first.** Capture current `lttb`, `minMaxEnvelope` and
   `minMaxEnvelopeIndices` outputs for the existing fixture signals into committed JSON fixtures
   *before* touching the code. These tests are green now and must stay green.
2. **min-max (both variants).** Mixed bucket (60 real + 1 `NaN`) → `NaN`/`NaN` and `[-1, -1]`;
   all-`NaN` → same; `+Infinity` in a gap-free bucket propagates; `+Infinity` + `NaN` → break;
   instrumented read count equals `sampleCount`; property: any bucket with a `NaN` is a break,
   every other bucket equals the pre-change result.
3. **LTTB `lttbCore` extraction** (pure refactor, step 1 fixtures guard it).
4. **LTTB gapped path.** Golden cases: segments `[0,40)` + `[45,200)` retain `0, 39, 45, 199`;
   single interior gap; leading gap (first slot is the first finite index); trailing gap;
   singleton segment emitted once; all-`NaN` → all `-1`; `y = [1, NaN, NaN, NaN, 2]`,
   `threshold = 5` → `[0, -1, 4, -1, -1]`; infeasible alternating input → returns `0`.
   Properties (`fast-check`): non-`-1` slots are strictly increasing, in range, finite in `y`; no
   two consecutive non-`-1` slots straddle a source `NaN`; every segment's endpoints present when
   feasible; determinism across two runs; peak-adjacent-to-gap fidelity.
5. **Zero-GC gates** for gapped input (5% `NaN`, fixed pattern) at the archived `small`
   configuration for all three decimators, plus the positive-control allocation.
6. **`TraceCollection`** under the `node` Vitest environment.
7. **`buildTracePath`**: 500-point gap-free (1/499), one interior gap (2/497), decimated stream
   with `-1` and padding, all-`NaN` (0/0), leading/trailing gaps.
8. **Isolated markers (pure)**: `countIsolatedSegments` and `buildIsolatedMarkers` against a
   counting `MarkerSink` — direct `[1, NaN, 5, NaN, 2, 3]` → 1 marker at index 2; decimated
   stream with an LTTB singleton → 1; min-max `[-1,-1, 7,7, -1,-1]` → 1; gap-free → 0;
   `[5, 3]` segment (two distinct indices) → 0; exact `rect` arguments `(px - s/2, py - s/2, s, s)`
   with `s = 2 * lineWidthCss * dpr`; zero allocation under `--expose-gc`.
9. **Renderer**: 3-trace `Path2D` count, one `setTransform`, per-trace `lineWidth` with `dpr: 2`,
   per-trace memo (only the bumped trace re-decimates; 60 renders → 3 `lttb` calls), infeasible
   LTTB → exactly one `minMaxEnvelopeIndices` call, two-trace zero-GC. Markers: a gapped trace with
   one isolated sample records `stroke` then `fillStyle`, `fill` for that trace only, and constructs
   one extra `Path2D`; gap-free and `markIsolatedSamples: false` record no `fill` and no extra
   `Path2D`; isolated count is not recomputed on unchanged frames; zero-GC with markers.
10. **Visual**: existing goldens zero diff; new gapped (leading + interior + trailing gap plus one
   isolated sample) and overlay (two traces, two axes, linear + log, distinct colors and one
   dashed) goldens generated on CI.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Gap-free LTTB drifts from pre-change output after the `lttbCore` extraction | Fixtures captured before any edit (step 1); the accumulation keeps the same summation order and operands |
| 2 | Gap check deopts or slows the gap-free hot loop | Self-compare on an already-loaded value; existing deopt and benchmark gates run on the gap-free configuration |
| 3 | Infeasible LTTB (`0`) mistaken by a future caller for "bypass" | JSDoc and spec state the meaning; the renderer is the only caller and handles it explicitly; test asserts the fallback |
| 4 | Marker path changes pixels or call sequence of existing figures | Markers exist only when `isolatedCount > 0`, which gap-free input never yields (D10); existing call-sequence tests and goldens act as the guard; marker `fillStyle` cannot leak because every other fill sets its own `fillStyle` |
| 4b | WebGL2 (change 7) ships without isolated-sample parity | D8 records it as a requirement change 7 must carry (point primitive, square, same size and flag) |
| 5 | Min-max hides a real peak sharing a bucket with a gap | Named trade-off in the spec (D4); LTTB is the default algorithm and does not have this loss |
| 6 | All-`NaN` payload extents: `commitPayloadRevision` yields `yMin = Infinity`, `yMax = -Infinity` (NaN comparisons are skipped) | Not a regression and `spectrum-data-payload` is explicitly not changed here; recorded as a follow-up for any auto-domain feature |
| 7 | Traces with different `xOrigin` misplaced | Per-trace transform with its own `xOrigin` (D7); overlay golden uses two payloads with distinct origins |
| 8 | Collection API leaks into adapters prematurely | Core-only; adapters untouched; D9 records only the reactivity rule |
| 9 | Precision of `E * after` above `2^53` | Same domain as existing bucket math; deterministic; only reachable above ~67M samples per call |

---

## Spec Amendments

Made in this phase to keep the delta specs consistent with the design:

- `specs/decimation-lttb/spec.md` — design-owned note replaced by the chosen encoding; new
  requirement "Return-Count and Index-Content Contract" (`-1` breaks, padding, all-`NaN`,
  infeasible `0`) and "Threshold Apportionment" requirement; the read-bound requirement now
  distinguishes gap-free (≤ 2 reads, one traversal) from gapped (≤ 6 reads, bounded passes).
- `specs/decimation-min-max/spec.md` — explicitly supersedes the archived "mixed bucket reports
  its non-`NaN` envelope" sentence and scenario; the mixed `+Infinity` scenario now states that the
  break takes precedence; new MODIFIED requirement for `minMaxEnvelopeIndices` (`[-1, -1]` for any
  gap bucket, replacing `[start, start]`).
- `specs/canvas2d-trace-rendering/spec.md` — break detection wording pinned to `j < 0` /
  `y !== y`; new requirement for the infeasible-LTTB min-max fallback; new requirement for
  isolated-sample markers (D10).
- `specs/trace-collection-payload/spec.md` — `markIsolatedSamples` style flag.
- `specs/visual-golden-corpus/spec.md` — gapped golden includes an isolated-sample marker.

---

## Decision Status

| Decision | Status |
|---|---|
| D1 — LTTB break encoding | **Resolved** — `-1` in `Int32Array` |
| D2 — Return count, apportionment, traversal | **Resolved** — `threshold` preserved; proportional with minimums; single pass gap-free, bounded multi-pass gapped; infeasible returns `0` |
| D3 — Infeasible fallback | **Resolved** — renderer falls back to `minMaxEnvelopeIndices` |
| D4 — Min-max encoding and index migration | **Resolved** — any-`NaN` bucket collapses; `[start,start]` → `[-1,-1]` adopted |
| D5 — `buildTracePath` idiom | **Resolved** — pen-state walk, signature unchanged |
| D6 — `TraceCollection` | **Resolved** — frozen, replace-on-update, cold-path validation and resolution |
| D7 — Per-trace renderer state | **Resolved** — typed columns, per-trace transforms with own `xOrigin` |
| D8 — Engine strategy | **Resolved** — Canvas2D only; WebGL2-ready index contract |
| D9 — Reactivity isolation | **Resolved** — `shallowRef`/`useRef` forward rule |
| D10 — Isolated samples | **Resolved** — filled square marker, side `2 * lineWidth` device px, default on, per-trace opt-out, conditional second `Path2D` + one `fill`; WebGL2 parity required of change 7 |

**Nothing remains open. `sdd-tasks` is not blocked by an unresolved decision from this phase.**
