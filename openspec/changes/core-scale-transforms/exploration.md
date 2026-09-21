# Exploration: core-scale-transforms

> Roadmap `order: 5.6`. Adds logarithmic Y scales and multiple independent Y axes to the
> coordinate projection layer, before `svg-vector-export` (6) and `renderers-webgl2` (7) consume
> the projection contract.

## 1. Is `viewport-transform` genuinely linear-only and single-Y-only?

Confirmed. Quoting `openspec/specs/viewport-transform/spec.md`:

> `@trace-kit/core` MUST export `ViewportTransform` as a plain interface of `readonly number`
> fields only (`xDomainMin`, `xDomainMax`, `yDomainMin`, `yDomainMax`, `xOrigin`, `deviceWidth`,
> `deviceHeight`, `dpr`, `plotLeft`, `plotTop`, `plotWidth`, `plotHeight`, `xScale`, `yScale`,
> `yBase`)

Fourteen fields, exactly one `yDomainMin`/`yDomainMax`/`yScale`/`yBase` tuple — one Y axis. The
implementation (`packages/core/src/viewport/transform.ts`) confirms it: `yScale` is
`ySpan === 0 ? 0 : plotHeight / ySpan` (pure linear ratio) and `projectY` is
`t.yBase - yValue * t.yScale` — one multiply-subtract, no branch, no transcendental. The
orchestrator's reading is correct on both counts.

## 2. Migration shape

**Generalize in place by composition, not by wrapping or replacing.** `ViewportTransform`
continues to be one frozen flat object satisfying every existing requirement verbatim; multi-axis
is achieved by constructing **one `ViewportTransform` instance per Y-axis**, all sharing the same
X fields (`xDomainMin`, `xDomainMax`, `xOrigin`, `plotLeft`, `plotWidth`, `xScale`, `deviceWidth`,
`deviceHeight`, `dpr`). A trace binds to an axis by holding a reference to that axis's transform
instance, not by an axis index threaded through every call.

```
                         shared X domain (wavelength, nm)
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
 Y-axis 0 (power, log)          Y-axis 1 (phase, linear)
 ViewportTransform#0            ViewportTransform#1
 { xDomainMin, xDomainMax,      { xDomainMin, xDomainMax,   <- duplicated, cheap (numbers)
   yDomainMin, yDomainMax,        yDomainMin, yDomainMax,
   xScale, yScale, yBase,         xScale, yScale, yBase,
   yScaleKind: 1, ... }           yScaleKind: 0, ... }
        │                               │
   projectY(t0, mw) ---> px0       projectY(t1, rad) ---> px1
```

Archived scenario survival:
- Frozen / `Object.freeze` — survives verbatim, unchanged per instance.
- Survives `structuredClone` — survives verbatim (still a flat number object; two new numeric
  fields just ride along).
- Projection/inversion as free functions, not methods — survives verbatim.
- No DOM reference — survives verbatim.
- Zero-span domain → single line, no NaN — survives verbatim; the zero-span branch is checked
  before any scale-kind branch.
- Inverse is total and extrapolates — survives, but its **meaning** under log needs the
  decision in §4 (extrapolation of `unprojectY` below `yDomainMin` on a log axis is mathematically
  fine — it just returns a value with a smaller mantissa — but extrapolation below zero domain
  never occurs because log domains are constructor-validated `> 0`).
- Degenerate construction throws `RangeError` — survives verbatim, **plus** a new degenerate
  case: log domain with `yDomainMin <= 0`.
- Insets in CSS px, converted once — survives verbatim per axis; multi-axis adds a second
  question, "which side, and in what order," not a change to the conversion arithmetic itself.
- `selectTicks` no-transcendental / caller-buffer contract — survives verbatim **unmodified** for
  the linear case. Log ticks need a **new**, separate function (`selectLogTicks`), not a
  modification of `selectTicks` itself (see §5).

One requirement's **literal text**, not its intent, is genuinely in tension: "Forward Projection
Is Allocation-Free Per Point" states `projectX`/`projectY` MUST have no `Math.*` call in the
function body. A true log projection needs `Math.log10(y)` per point — there is no way to
precompute that away, because the argument is the per-point data value, not a domain constant.
This needs a **MODIFIED delta**, narrowing the "no `Math.*`" clause to the linear projection
path specifically, while adding a new requirement for a log-capable projection asserting the
property that actually matters: zero GC events per point (which `Math.log10` — non-allocating,
monomorphic — satisfies) rather than literally zero transcendental calls. I flag this as a
correction with one right technical answer (the *zero-GC* gate is the real invariant; "no
`Math.*`" was a stand-in for it that happened to be true only because nothing needed a log before
now), not a product decision.

## 3. Log projection without per-point virtual dispatch

Three shapes were compared, per the given options:

**(a) Precomputed coefficients baked into the flat transform at construction.** For a log axis,
`createViewportTransform` computes `yLogDomainMin = Math.log10(yDomainMin)`,
`yLogSpan = Math.log10(yDomainMax) - yLogDomainMin` **once**, at construction (a cold path), and
stores them as two more `readonly number` fields. `projectY` for that axis still needs exactly
one `Math.log10(yValue)` per point — irreducible, see §2 — but every other operation is
arithmetic over precomputed constants, identical in shape to the linear case.

**(b) A discriminated union branched per point.** Store `yScaleKind: 0 | 1` (numeric, so the
"readonly number fields only" constraint on `ViewportTransform` holds literally — a string union
would not) and branch inside one monomorphic `projectY(t, y)`:
```ts
return t.yScaleKind === 0
  ? t.yBase - y * t.yScale
  : t.yBase - (Math.log10(y) - t.yLogDomainMin) * t.yLogScale;
```

**(c) Separate monomorphic functions per scale kind, call site specialized once per frame.**
`projectYLinear(t, y)` and `projectYLog(t, y)`, with the renderer's per-frame setup (in
`buildTracePath`'s caller, once, outside the per-point loop) resolving a function reference based
on `t.yScaleKind` and passing that reference into the loop.

**Position: (a) + (b) as a single hybrid, not (c).** Precompute the coefficients per (a) — that
part is not optional, it is just correct engineering, independent of dispatch strategy — and
dispatch with the minimal in-function branch per (b), not with (c)'s per-frame function-reference
resolution. The reason (c) is not worth its complexity here: the branch in (b) is **loop-invariant**
— `t.yScaleKind` does not change within a single `render()` call, because it is fixed per
`ViewportTransform` instance — so the branch predictor learns it after the first iteration and
the cost converges to zero. This is categorically different from the megamorphic-call-site risk
CLAUDE.md's prompt correctly warns about (`.project()` on a polymorphic object): that risk comes
from the *call site* seeing multiple hidden classes/shapes, not from a stable, predictable branch
inside one monomorphic function operating on one flat object shape. `ViewportTransform` stays one
shape; `projectY` stays one function; V8 keeps a single compiled version.

**Cost of being wrong:** if in practice (rare, but possible if the function grows past an inlining
budget after other changes) V8 fails to keep the branch predicted or fails to inline, the fallback
is a mechanical, non-breaking refactor to (c): callers only ever invoke `projectY(t, y)` today, so
splitting the body into two functions selected once per frame behind the same exported name (or
a thin wrapper) requires no call-site changes elsewhere in the renderer. This is worth stating
explicitly because it means choosing (a)+(b) now is not a one-way door.

## 3a. Reconciliation with `research.md` (external evidence, added after initial exploration)

`sdd-research` ran concurrently and its findings arrived after this document's first draft. This
section, plus targeted edits below (marked "research update"), integrate that evidence rather
than rewriting the original analysis. Citations point to `research.md`'s own source URLs.

**On dispatch (§3):** the research does not contradict the (a)+(b) hybrid position — Lane 4
(Mathias Bynens, "Shapes and Inline Caches") confirms the qualitative mechanism (shape-stable
call sites stay monomorphic and inlinable) but flags that the specific "10–50x megamorphic
penalty" figure is community-sourced, not traceable to a primary V8 benchmark, and that no source
benchmarks a "scale.project() per point in a render loop" scenario directly
(`research.md` Lane 4, "Implication for this change"). This does not change the recommendation —
the architectural reasoning for (a)+(b) never depended on that specific multiplier — but it does
mean the stated fallback (mechanical refactor to (c) if wrong) should be treated as the
real safety net, not "unlikely to ever be needed": the magnitude of the risk being guarded against
is itself not independently verified.

**On zero-crossing domains, this changes the option space materially** — see the rewritten §4
and the corrected blocking decision #1 at the end of this document.

**On the Float32/WebGL2 precision question**, this is genuinely new — the original draft did not
consider it at all. See new §4a.

**On tick selection for sub-decade domains**, the research confirms the multiply/divide walk
approach is sound but surfaces a specific, documented failure mode this exploration's original
text did not account for. See the updated §5.

**On risk #1 (log inverse projection)**, the research strengthens rather than softens this
ranking. See the updated risk table.

## 4. Log-scale edge cases

Precision on the unit question the prompt raised: **dBm is already logarithmic.** The normal case
is dBm plotted on a *linear* Y axis (a straight line in dB is a straight line on screen — this is
what today's linear-only transform already does correctly for every existing optical-power
scenario). A **log scale axis is for raw linear power in mW** (or any other linearly-measured
quantity that spans decades — e.g. a raw ADC count). This change does not touch how dBm is
plotted; it adds the ability to plot mW logarithmically for the cases where the source instrument
reports linear power. Any design/spec work MUST keep these separate in naming — never call a
log-axis-of-dBm a real scenario, because that would double-log a quantity that is already a log
ratio.

- **Zero and negative domain values (research update).** A pure log scale requires
  `yDomainMin > 0` at construction (extends "Degenerate Construction Inputs Throw `RangeError`");
  this part of the original analysis stands. What the original draft got incomplete is the
  *option space* for handling a domain that legitimately includes or crosses zero — it only
  offered "throw" vs. "clamp/floor". `research.md` Lane 3 documents an established third answer:
  **`symlog`**, a scale with a linear region of half-width `linthresh`/`constant(k)` around zero
  and logarithmic behavior outside it, shipped by both d3-scale (`scaleSymlog`, `.constant(k)`,
  default `1`) and Matplotlib (`symlog`, `linthresh`, `linscale`) specifically because a pure log
  scale is undefined across zero — d3's own `scaleLog` documents that a domain crossing zero
  produces `NaN` (`research.md` Lane 3, citing
  <https://github.com/d3/d3/blob/main/docs/d3-scale/log.md> and
  <https://github.com/d3/d3/blob/main/docs/d3-scale/symlog.md>). This directly matters here: raw
  mW power is non-negative in this instrument domain, but a *signed* quantity on a future log-ish
  axis (a residual, a bipolar trace) is exactly the case symlog exists for, and "throw" vs. "clamp"
  were never adequate answers to that case — clamping a genuinely bipolar signal to a floor
  discards its sign, which a physics-preserving tool (CLAUDE.md rule 6) should not do silently.
  Re-derived as a three-option, genuinely blocking product decision — see the corrected list at
  the end of this document, including whether symlog's piecewise definition is compatible with
  the (a)+(b) monomorphic dispatch from §3 or forces a third `yScaleKind` value with its own
  precomputed coefficients (`linthresh`, plus separate linear-region and log-region scale
  factors) — it is compatible with the *architecture* (still a numeric discriminant, still
  loop-invariant per instance, still one more precomputed-coefficient case), it just is not free:
  it is more machinery than "throw", and that cost belongs in the decision, not hidden from it.
- **A domain spanning less than one decade.** `unprojectY`/`projectY` do not care — the
  arithmetic is continuous, not decade-quantized. Only tick *selection* needs decade-awareness
  (§5); projection itself has no special case here beyond the coefficients already computed.
- **Zero-span domain (`yDomainMin === yDomainMax`).** Still MUST hold under log: checked *before*
  taking any logarithm (same guard as today — `ySpan === 0 ? ... : ...` — just checked on the
  already-validated positive domain), so it collapses to `yBase` for every input exactly as it
  does today, with no `log(0/0)` or `NaN` risk introduced.
- **Inverse projection totality/extrapolation under log.** `unprojectY` for a log axis is
  `10 ** ((t.yBase - deviceY) / t.yLogScale + t.yLogDomainMin)`, defined for every finite
  `deviceY` including outside the plot area (matches the existing total/extrapolating contract).
  Numerically, this is the scenario worth the most care per the risk ranking below: `10 ** x`
  compounds any floating error in the intermediate log-space division, and a marker (change 13.5)
  reading this value directly is the failure mode that must be caught by an exact round-trip test
  (`unprojectY(t, projectY(t, v)) === v` within f64 tolerance) analogous to the existing linear
  scenario, extended to the log path specifically, including near the domain edges and just
  outside them.

## 4a. GPU float32 precision (research update — new; not in the original draft)

The original draft did not address this at all. It belongs here rather than in change 7
(`renderers-webgl2`) because the domain-to-clipspace uniform that change 7 will bake is *derived
from* this capability's transform, and if the transform does not state a normalization contract
now, change 7 either invents one unreviewed or re-derives the same math a second time.

**The problem, per the research.** GLSL ES 3.00 `highp float` guarantees only 2^-24 relative
precision (~1.19e-7, ~7 significant decimal digits), and WebGL2 exposes no double-precision
vertex or uniform type at all — GLSL ES 3.00 defines only `float`/`vec*` up to `highp` (32-bit);
desktop GLSL 4.00+ added `double`/`dvec*`, WebGL does not expose it (`research.md` Lane 1, citing
the Khronos GLSL ES 3.00 spec §"Precision and Precision Qualifiers"; the "no double type" claim
is flagged in the research as inferred from the spec's silence, not a quoted negative). Applied
to this domain: `1550.123456` nm to sub-picometre resolution needs ~10 significant digits against
a magnitude of ~1.5e3; float32 supplies ~7 — uploading the raw wavelength value directly is short
by roughly three orders of magnitude.

**The established mitigation, per the research.** Two variants of the same principle — reduce
magnitude before the float32 cast, because float32's *absolute* precision is a function of
magnitude, not a fixed decimal count:
- **Relative-to-Center (RTC).** Cesium's approach for massive-coordinate geospatial rendering
  (`CESIUM_RTC` glTF extension): store each vertex as an offset from a chosen origin, computed in
  float64 on the CPU, so the float32 offset stays small and precise; avoids GPU-side subtraction
  of two large float32 values, which is where catastrophic cancellation actually occurs
  (`research.md` Lane 1, citing the CESIUM_RTC glTF extension README and two Cesium engineering
  sources).
- **CPU-side float64 normalization to `[0, 1]` before the float32 cast.** Same principle, applied
  directly to a domain-relative fraction rather than a world-space offset. The research derives
  (not benchmarks) the resulting error from the cited 2^-24 relative precision applied near 1.0:
  ~1e-7 of the domain span — for a 100 nm span, ~1e-5 nm (10 fm); for the full 1500 nm span,
  ~1.5e-4 nm (150 fm). Both comfortably sub-picometre (`research.md` Lane 1, "derived arithmetic
  from the cited spec property, not an empirical measurement").

**Position: this is a 5.6 obligation, stated as an explicit contract, not a 5.6 implementation of
GPU code.** `@trace-kit/core` has no WebGL2 dependency (CLAUDE.md rule 5) and must not gain one to
satisfy change 7. But `ViewportTransform` already carries `xOrigin` (f64) precisely so a consumer
can reconstruct `xOrigin + x[i]` at full precision (per `spectrum-data-payload`'s existing
"X-Axis Precision via an f64 Origin With f32 Offsets" requirement) — the CPU-side normalization
principle above is the *same* pattern one level up: `xDomainMin`/`xDomainMax`/`xOrigin` are
already f64 fields on the frozen transform, so a GPU consumer already has everything it needs to
compute a `[0, 1]`-normalized, origin-relative offset in float64 *before* any float32 cast,
without this capability adding a single new field. The obligation this capability owes change 7 is
narrower than "solve GPU precision": it is **do not regress the existing guarantee** — keep
`xOrigin` f64, keep `xDomainMin`/`xDomainMax` f64, and state explicitly (as a note on
`viewport-transform`, not as new machinery) that a GPU consumer MUST normalize in float64 on the
CPU before any float32 upload and MUST NOT upload `xDomainMin + xOffset` as a single float32 sum.
Change 7 owns the actual GLSL/uniform work and the RTC-vs-normalize-to-[0,1] choice between the
two documented variants; 5.6's job is to not hand it a transform that has already lost the
precision it needs, and to say so in the spec rather than leaving it implicit. This is *not* a
new open product decision — there is one correct answer (don't regress an existing f64 guarantee,
document the obligation) — so it does not appear in the blocking-decisions list.

## 5. Tick selection under log

`selectTicks`'s existing "no `Math.log10`/`Math.pow`" ban is for a *different, still-valid*
reason (byte-identical cross-engine tick output, guarding against float drift when classifying an
exact power of ten) and does not need to be relaxed. Decade boundaries can be found with the
**same integer-multiply/divide magnitude walk `niceStep` already uses** — `while (magnitude * 10
<= x) magnitude *= 10` — with no logarithm needed to *classify* which decade a domain edge falls
in. This gives a `selectLogTicks(domainMin, domainMax, targetCount, out, outputOffset)`,
structurally parallel to `selectTicks`, that:
- walks decade boundaries (`..., 0.1, 1, 10, 100, ...`) covering `[domainMin, domainMax]` using
  the multiply/divide walk, never `Math.log10`/`Math.pow`;
- when the visible span covers many decades, emits one tick per decade;
- when it covers few decades, emits minor ticks at the `2..9` mantissas within each decade
  (matplotlib/d3-scale convention) — the same multiply/divide walk generates the decade's base
  value, and the `2..9` mantissas are then `base * 2 .. base * 9`, still no transcendental call;
- when the visible span is a **fraction of one decade**, decade/mantissa ticks degenerate to at
  most one or two labels — falls back to running the existing linear `niceStep` in **log space**
  on the two decade-relative endpoints, then exponentiating each selected *tick value* (not
  per-point, a handful of ticks, cold path, `Math.pow` is fine here — this is exactly the
  boundary the existing "no transcendental" ban is scoped to *not* cover, since that ban's own
  rationale text is about avoiding drift in "nice-number" classification, and a handful of label
  values computed once per `tickRevision` bump carries none of the hot-path pressure `selectTicks`
  was written against).

**Sub-decade fallback (research update).** `research.md` Lane 2 documents that d3-scale's
`log.ticks()` has an open, acknowledged defect for exactly this case: a domain of `[42, 43]`
returns an **empty array**, and a linked case (`[286.9252014, 329.4978332]`) returns only a
single tick where a 1–9 minor set was expected (`research.md` Lane 2, citing
<https://github.com/d3/d3-scale/issues/44>, `#192`, `#33` — acknowledged upstream, unresolved).
The research separately notes Matplotlib's documented behavior for domains under one decade was
not found (Unresolved list). This means the multiply/divide fallback described above (running
linear `niceStep` in log space, then exponentiating the selected tick values) is not just an
implementation convenience — it is the specific thing that must exist to avoid reproducing d3's
empty-result defect. `selectLogTicks` MUST NOT return `0` for a valid, non-degenerate domain the
way d3 does: a `sdd-spec` requirement should assert this directly (e.g. "for any domain with
`domainMin < domainMax`, `domainMin > 0`, `selectLogTicks` returns at least 1 tick"), because an
axis that silently renders with no ticks after a user zooms in is a defect a golden-image test
will not catch — the resulting image looks like a legitimate, intentionally sparse axis, not a
failure.

This slots into the existing caller-buffer contract unchanged: `selectLogTicks` writes into the
same kind of preallocated `Float64Array` at a caller-given offset and returns a count, so
`canvas2d-axes-grid`'s buffer-ownership and `tickRevision`-gated relabeling requirements extend
by substitution (call `selectLogTicks` instead of `selectTicks` when `axis.scaleKind === "log"`)
rather than by new architecture.

## 6. Multi-axis data model

- **Shared X, N independent Y domains:** one `ViewportTransform` per Y-axis (§2's diagram), all
  constructed from the same X domain/origin/inset inputs. No new "multi-transform" container type
  is needed at the projection layer itself — `multi-axis-viewport` is the *orchestration*
  capability (owns axis registration, binds a trace to an axis, and drives N calls to
  `createViewportTransform`), while `ViewportTransform` itself stays exactly what it is today,
  requirement-for-requirement, just instantiated N times per frame instead of once.
- **Trace-to-axis binding:** not resolved by this capability's projection layer alone — it is the
  join point with `core-gap-and-multi-trace-model` (5.7), which is what actually introduces
  multiple traces. For 5.6, the data model only needs to prove out N *axes*; binding N *traces*
  to them is 5.7's `trace-collection-payload` capability. Keeping that split is itself the
  minimum-cut argument in §8.
- **Per-axis gutter/inset ownership:** stays owned by the axis-layout module
  (`computeAxisInsets` today, generalized to something like `computeMultiAxisInsets(axes[])`),
  unchanged in *where* it lives, changed in *shape*: instead of one `insetLeft`/`insetRight`
  pair, it stacks N left-side gutters (and, if right-side axes are in scope — see the blocking
  decision list — N right-side gutters) outward from the plot area, in registration order. The
  plot area **does** shrink per axis: each additional left (or right) axis consumes more CSS
  width before `createViewportTransform` converts insets to device pixels, exactly as today's
  single-axis inset conversion already does per axis instance — this is an extension of the
  existing "insets are a pure function of style/layout, computed once, feeding
  `createViewportTransform`" requirement, not a new arithmetic model.

```
 insetLeft(axis1) insetLeft(axis0)                              insetRight(axis0, if any)
 ┌──────────┬──────────┬─────────────────── plot area ───────────────────┬──────────┐
 │  axis 1  │  axis 0  │                                                 │  axis N  │
 │  labels  │  labels  │        traces projected via their own           │  labels  │
 │  (log)   │ (linear) │        ViewportTransform instance                │          │
 └──────────┴──────────┴─────────────────────────────────────────────────┴──────────┘
```

## 7. Blast radius

| Capability | Change type | What breaks / changes |
|---|---|---|
| `viewport-transform` | MODIFIED | Add `yScaleKind`, `yLogDomainMin`, `yLogScale` numeric fields (additive, non-breaking to existing consumers reading only the original 14 fields). Add a log-degenerate `RangeError` case. Narrow the "no `Math.*`" clause's scope (linear path keeps it verbatim; a new log-projection requirement states the zero-GC invariant instead). All 8 original requirements otherwise survive verbatim as scenarios of the linear/`yScaleKind === 0` case. |
| `canvas2d-axes-grid` | MODIFIED | `computeAxisInsets` generalizes to N axes/sides; `drawGrid`/`drawAxes` iterate N `ViewportTransform` instances instead of one; add decade-gridline painting for log axes. |
| `canvas2d-trace-rendering` | Unaffected as committed | `buildTracePath` already takes a `ViewportTransform` + `projectX`/`projectY` by reference — it does not care which axis or scale kind produced them. No change needed to this capability itself; a *caller* now supplies one of N transforms per trace, which is `multi-axis-viewport`'s and 5.7's concern, not this one's. |
| `spectrum-data-payload` | Unaffected | Payload buffers stay raw domain values (mW, radians); scale kind is a projection-layer concept, never baked into stored data. |
| `svg-vector-export` (6) | Contract altered before it exists | Must emit ticks/paths against N axes and decade tick marks, not one linear axis — this is the entire reason 5.6 is sequenced first. |
| `renderers-webgl2` (7) | Contract altered before it exists | The domain-to-clipspace uniform must be built per-axis and must encode log coefficients, not just a linear scale/offset pair. |
| `raw-data-viewport-export` (6.5) | Minor | Window-resolution math (domain range → source index span) is X-only and untouched by Y-axis scale kind. |
| `viewport-interaction-controller` (9.3) | Contract altered before it exists | "Per-axis" wheel-zoom-anchoring and drag-pan already anticipate N axes in its own roadmap comment — 5.6 is what makes "per-axis" a real concept for it to bind to. |
| `analytical-measurement-markers` (13.5) | Contract altered before it exists | `delta-cursor-math` is explicitly "log-aware (dB is a ratio, not a difference)" in the roadmap — this directly depends on `unprojectY`'s log-path numerical exactness (§4's ranked #1 risk). |
| `visual-golden-corpus` | MODIFIED | New goldens for a log-scale axis and a dual-Y-axis figure; existing goldens for single-linear-axis figures MUST NOT change (zero visual diff for `yScaleKind === 0` figures is itself a regression check). |

## 8. Minimum viable cut for 5.6

In scope: log (base-10) scale on a single axis; N independent Y-axis *domains* sharing one X
domain at the projection/inset layer; decade + `2..9` minor tick selection; the frozen-object
migration in §2; numerical exactness proof for log inverse projection.

Deferred without creating a second rewrite later, because none of these touch the frozen
`ViewportTransform` shape or the `selectLogTicks` signature once shipped:
- **Binding actual multiple traces to multiple axes** — that is 5.7's `trace-collection-payload`.
  5.6 only proves N axes can coexist; 5.7 decides how a trace picks one.
- **Right-side Y axes** — see blocking decision below; if deferred, `computeMultiAxisInsets` ships
  left-only and gains a right-side branch later without touching `ViewportTransform` at all
  (insets are still just numbers fed to the same constructor).
- **Non-base-10 log, symlog, or square-root scales** — the `yScaleKind` numeric discriminant
  already has room (`0`/`1` today, `2..n` later) without breaking anything that shipped at `1`.
- **d3-scale or any dependency-bearing scale library** — already ruled out for the core in
  `openspec/changes/00-roadmap-decomposition/exploration.md` §1.10 ("`d3-scale` ... belongs in
  the framework adapters, not the core"); nothing here argues against that recorded decision, and
  reintroducing it would fail CLAUDE.md rule 5 (zero-DOM/dependency isomorphic core) in spirit if
  not in fact, since `d3-scale` alone drags `d3-array`/`d3-format` per that same analysis.

## Risks (ranked)

| Rank | Risk | Why it ranks here |
|---|---|---|
| 1 | Silent numerical error in log inverse projection | **Confirmed and strengthened by research, ranking unchanged at #1 — not softened.** Worst possible failure mode: a marker (13.5) or an export (6.5) reads a plausible-looking wrong value instead of crashing. `research.md` Lane 3 establishes there is no prior art to lean on here: none of d3-scale, Matplotlib, or Plotly documents a guaranteed total, always-finite inverse for arbitrary pixel coordinates, and d3's own `scaleLog` documents `NaN` at a domain-crossing-zero — the opposite of totality (`research.md`, "Total invertibility — explicitly NOT established"). The archived `viewport-transform` contract already requires exactly that totality for the linear case. This means the log-path totality/round-trip property cannot be validated against a reference implementation the way an engineer might instinctively want to ("does this match what d3 does") — it must be engineered and proven here from first principles, with its own exact round-trip test near domain edges and just outside them, not just "looks right on a chart." |
| 2 | Breaking or leaving ambiguous the archived "no `Math.*` in `projectY`" scenario | If `sdd-design`/`sdd-spec` do not resolve this explicitly (§2), `sdd-apply` either silently violates an archived requirement or blocks on a contradiction it cannot arbitrate alone. |
| 3 | Golden-image churn beyond the intended scope | Regenerating unrelated single-axis goldens as a side effect would mask whether the new log/dual-axis goldens are actually correct, and would violate `visual-golden-corpus`'s implicit "zero diff for unrelated figures" expectation. |
| 4 | Allocation regression in the hot path | Mitigated by construction: coefficient precomputation is cold-path (§3), and `Math.log10` itself does not allocate — but this still needs a measured zero-GC test per axis-kind, not an assumption. |
| 5 | Scope creep into a full d3-scale reimplementation | Already recorded as ruled out (§8), but "just one more scale kind" pressure is a realistic risk during `sdd-design`/`sdd-tasks` given how naturally `yScaleKind` generalizes. |
| 6 | Multi-axis gutter-stacking arithmetic bugs | Real but bounded and testable (inset order, plot-area shrink correctness) — lower severity than a numerical bug because a layout bug is visually obvious, not silent. |

## Open product decisions that block `sdd-propose`

This list supersedes the earlier draft's version of decision #1, which offered an incomplete
option space (see §3a and the rewritten §4 edge-case discussion for why). It is written to stand
on its own, without this report as context.

1. **How to handle a Y domain that includes or crosses zero on a logarithmic-feeling axis.**
   A pure log scale is mathematically undefined at and across zero (d3-scale's own `scaleLog`
   documents `NaN` there). This instrument domain's primary case — raw mW power — is
   non-negative, so the *common* case is a domain with a positive floor near zero, not one that
   crosses it; but a signed quantity (a residual, a bipolar trace) is a realistic future case for
   this same axis kind, and clamping it to a positive floor destroys its sign. Three options,
   not two:
   - **(A) Throw `RangeError`** on `yDomainMin <= 0` at construction, matching every other
     degenerate-input case already in the `viewport-transform` spec exactly. Simplest, fully
     consistent with existing policy, zero new machinery. Consequence: any caller with a
     legitimate zero-power reading, or any future signed quantity, cannot use a log-feeling axis
     at all without pre-filtering or choosing linear instead — this option effectively defers
     "log axis for data that touches zero" to a later change.
   - **(B) Clamp to a caller-supplied floor/epsilon** before taking the log. More forgiving of raw
     instrument data with a single knob. Consequence: silently discards information below the
     floor and, for a signed quantity, silently discards sign — a data transformation CLAUDE.md's
     physics-preserving rule (#6) should make visible, not implicit, and it adds a second
     configurable knob to maintain.
   - **(C) `symlog`** — a linear region of half-width `linthresh` (Matplotlib's term) /
     `constant(k)` (d3's term) around zero, logarithmic outside it. This is the answer both
     d3-scale (`scaleSymlog`) and Matplotlib ship specifically for this case. Consequence: real
     additional machinery — a third `yScaleKind` value, its own precomputed coefficients
     (`linthresh` plus separate linear- and log-region scale factors), and its own inverse-
     projection and tick-selection logic, each needing the same totality proof as risk #1 above,
     with no reference implementation's inverse-projection guarantee to lean on either. It is
     compatible with the (a)+(b) monomorphic-dispatch architecture from §3 (still one more
     loop-invariant numeric discriminant), but it is not free, and it expands this change's scope
     measurably beyond a plain log scale.

   **Recommendation: (A) for the 5.6 cut, with (C) explicitly named as the next axis kind rather
   than folded in now** — it slots into the same `yScaleKind` discriminant later without breaking
   anything shipped at value `1` (see §8's minimum-viable-cut reasoning, which already reserves
   room for additional scale kinds). (B) is not recommended in any scope: it is the one option
   that trades away data fidelity silently, which is a worse failure mode than "log axis for
   zero-crossing data isn't available until a later change."

2. **Right-side Y axes in this change vs. deferred.** Options: (A) 5.6 ships only left-stacked Y
   axes (matches today's `insetRight: 0` convention exactly, smaller cut). (B) 5.6 ships both
   left- and right-stacked axes now (matches the common dual-axis overlay pattern — e.g. power on
   the left, phase on the right — directly, but roughly doubles the inset-stacking arithmetic
   surface for this change). Research note: Matplotlib's `twinx()` (right-side second axis) and
   Plotly's `yaxis2`/`yaxis3` via `make_subplots()` both exist as established conventions
   (`research.md` Lane 5), so (B) is not a novel design, but the research surfaces no evidence
   that (A) creates rework later — the inset-stacking generalization in §6 already accounts for
   "which side" as an axis-registration property, not a fixed layout assumption. Recommendation
   unchanged: (A) — see §8 for why this defers cleanly without a later rewrite.
3. **Log base.** Options: (A) base-10 only, hardcoded (matches the dB/decade convention this
   instrument domain universally uses; no known TraceKit use case for natural or base-2 log).
   (B) a generic base parameter. Recommendation unchanged: (A) — a generic base adds API surface
   and a `Math.log(y) / Math.log(base)` extra division per point for a case with no cited demand.

## Skill resolution

`sdd-explore` skill loaded and followed. No production code written; only
`openspec/changes/core-scale-transforms/exploration.md` created.
