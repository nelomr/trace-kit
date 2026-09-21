# Technical Design: core-scale-transforms

> Roadmap `order: 5.6`. Inputs: `proposal.md` (authoritative scope and confirmed product
> decisions), `exploration.md`, `research.md`, and the archived contract
> `openspec/specs/viewport-transform/spec.md`.
>
> This document resolves **D1–D6**. Every decision below is settled input for `sdd-spec` and
> `sdd-tasks`; none of it is to be re-litigated during `sdd-apply`.

---

## Context & Background

`packages/core/src/viewport/transform.ts` projects Y as a single expression,
`t.yBase - yValue * t.yScale`, over a frozen flat object of fifteen `readonly number` fields
(the archived spec text enumerates fifteen names while its `structuredClone` scenario says
"fourteen" — an off-by-one in the archived prose, noted here so `sdd-spec` corrects rather than
propagates it). The projection layer is linear-only and single-Y-axis-only, confirmed by direct
inspection.

This change generalizes that object **in place by composition**: three new `readonly number`
fields, one loop-invariant numeric branch inside the same monomorphic `projectY`, and N instances
of the same single object shape for N Y axes. No new container type at the projection layer, no
class, no dependency.

The archived contract is not merely a document here — it is eight requirements with live
scenarios, one of which (`no Math.* in projectY`) directly contradicts the feature being built.
D1 exists to resolve that contradiction before any code is written.

---

## Goals & Non-Goals

### Goals
1. Base-10 logarithmic Y projection with a **total, finite, monotone** inverse, proven from first
   principles (no reference library guarantees this — `research.md` Lane 3).
2. N independent Y domains sharing one X domain, as N `ViewportTransform` instances of one shape.
3. `selectLogTicks` that **never** returns zero ticks for a valid domain, including sub-decade
   spans (the documented, unresolved d3-scale defect — <https://github.com/d3/d3-scale/issues/44>).
4. Left-stacked per-axis gutter arithmetic with a shared, identical plot area across all N
   transforms.
5. Zero allocation and zero GC events per point, per axis kind.
6. Byte-identical behaviour for `yScaleKind === 0`: zero visual diff on every existing golden.

### Non-Goals
- `symlog` (reserved as `yScaleKind === 2`), right-side axes, non-base-10 log, any further scale
  kind, trace-to-axis binding (5.7), any WebGL2 code or dependency in `@trace-kit/core`,
  `d3-scale`.

---

## Architecture & Data Flow

```
 axis registrations (id, scaleKind, domain, side, order)   shared X domain (nm, f64 xOrigin)
        │                                                          │
        ▼                                                          │
 computeAxisInsets(style, axes, yAxisCount)  ── CSS px ────────────┤
        │  insetLeft = N × perAxisGutter  (ONE value, shared)      │
        │  computeYAxisGutterOffsets(...) → Float64Array (labels)  │
        ▼                                                          ▼
 ┌──────────────────── createViewportTransform() × N ────────────────────┐
 │  identical X fields + identical plot geometry on every instance       │
 │  per-instance Y fields: yDomainMin/Max, yScale, yBase,                │
 │                         yScaleKind, yLogDomainMin, yLogScale          │
 │  ONE object literal ⇒ ONE V8 shape for all N instances                │
 └───────────────────────────────────────────────────────────────────────┘
        │                                    │
   ViewportTransform#0 (log, mW)      ViewportTransform#1 (linear, rad)
        │                                    │
   projectY(t0, mW) ──► px              projectY(t1, rad) ──► px
        │  one loop-invariant numeric branch, one function, one shape
        ▼
 Canvas2D: per-point call (<80k pts)   │   WebGL2 (change 7): coefficients
 buildTracePath(t, projectX, projectY) │   uploaded as uniforms, per axis
```

No buffer crosses a worker boundary in this change. `ViewportTransform` remains a flat number
object that survives `structuredClone`, so a future worker hand-off stays a structured clone of
~18 numbers, never a `Transferable`. Sample buffers themselves (`Float32Array`/`Float64Array`,
`spectrum-data-payload`) are untouched: scale kind is a projection-layer concept and is **never**
baked into stored data.

---

## Technical Decisions

### D1 — The `Math.log10`-in-`projectY` contradiction

**Decision: narrow the ban to a closed, source-scannable allow-list; do not delete it, and do not
relax it on the linear path.**

The exploration's position — that the invariant which matters is zero GC, and "no `Math.*`" was a
proxy — is **correct but incomplete**. Deleting the clause outright throws away a real regression
check for no gain. The precise resolution:

| Path | Permitted `Math.*` in the function body | Rationale |
|---|---|---|
| `projectX` | **none** (unchanged, verbatim) | X projection is linear-only in every scope of this project; nothing needs a transcendental there, now or under symlog. |
| `projectY`, linear branch (`yScaleKind === 0`) | **none** | Preserves the exact regression catch the original clause bought: if someone ever "simplifies" the linear path with a `Math.*` call, the scan fails. |
| `projectY`, log branch | **exactly one call, exactly `Math.log10`, exactly once** | Irreducible: the argument is the per-point data value. |
| `unprojectY`, log branch | **exactly one exponentiation, `10 ** x`** | Irreducible inverse of the above. |

Verified supporting fact: the archived requirement's two scenarios are **both GC-based**. There is
no existing source-scan scenario on `projectX`/`projectY` — the source-scan assertion in the
archived spec exists only on `selectTicks`. Narrowing the clause therefore breaks no shipped test;
it only changes prose that was never mechanically enforced.

**Why an allow-list and not "zero GC only".** The prompt asks how the property is actually tested,
given that "no `Math.*` in the source" was a *scannable* assertion and "zero GC events" is a
*runtime* one. They are not interchangeable and neither subsumes the other:

- The **zero-GC gate** proves non-allocation but cannot prove the linear path did not silently
  acquire a transcendental (a `Math.*` call allocates nothing, so the gate is blind to it).
- The **source scan** proves construct discipline but says nothing about allocation.

So both survive, and the scan becomes an *allow-list* scan rather than a ban: assert that the set
of `Math.` member accesses inside the `projectY` body is exactly `{log10}` with exactly one
occurrence, and that it appears only within the log branch of the conditional expression. That is
the same *kind* of mechanical check as before, with the same failure mode on regression.

**Exact wording `sdd-spec` MUST transcribe into the MODIFIED delta.** Replace the first sentence
of "Forward Projection Is Allocation-Free Per Point" with:

> `projectX` and `projectY` MUST compute their result using only arithmetic over their parameters
> and the `ViewportTransform` object's own numeric fields, with no object literal, array literal,
> or closure in either function body. `projectX` MUST contain no `Math.*` call. `projectY` MUST
> contain no `Math.*` call other than exactly one `Math.log10`, which MUST appear only in the
> branch taken when `yScaleKind !== 0`; the branch taken when `yScaleKind === 0` MUST remain free
> of any `Math.*` call. A loop invoking either function once per sample point MUST report zero
> garbage-collector events under the repository's established
> `PerformanceObserver({ entryTypes: ["gc"] })` gate, **for each `yScaleKind` value
> independently**.

Plus two new scenarios: a source-scan scenario asserting the allow-list, and a zero-GC scenario
over a log-kind transform (the existing GC scenario stays and is implicitly the linear one).

**Alternatives considered.**
- *Hold the ban; structure log projection some other way.* Rejected, and it was genuinely
  considered because the prompt invites it. The only structures that avoid a per-point
  `Math.log10` are (i) precomputing `log10` into a parallel buffer at ingest — which allocates a
  second full-size `Float64Array` per trace, doubles resident memory for every log trace, and
  invalidates on every data update, i.e. it trades a non-allocating ALU call for a real
  allocation, defeating the very invariant the ban protects; or (ii) a lookup table plus
  interpolation, which sacrifices the exactness D3 depends on. Both are strictly worse. The ban's
  literal text is wrong; its intent is right.
- *Delete the clause entirely, keep only the GC gate.* Rejected: loses the linear-path regression
  catch for nothing.
- *`Math.log(y) * Math.LOG10E` instead of `Math.log10`.* Rejected: two operations instead of one,
  and it loses `Math.log10`'s better-conditioned results at exact powers of ten, which D3's
  round-trip bound benefits from.

**Trade-off.** `Math.log10` is *implementation-approximated* per ECMA-262 — engines may differ in
the last ULP. This is accepted: it affects the log path only, the divergence is far below one
device pixel, and goldens are rendered on a single pinned browser build by the archived
`browser-visual-regression-harness`. `selectTicks`/`selectLogTicks` remain fully
transcendental-free (D4), so tick *values* — the thing that would visibly differ across engines —
carry no such exposure.

---

### D2 — Dispatch strategy, committed

**Decision: precomputed coefficients at construction + one loop-invariant numeric branch inside
one monomorphic `projectY`. Committed, with a named falsification test and a mechanical fallback.**

#### Discriminant constants

```ts
/** Linear Y projection. The value `0` is the historical, and remains the default, behaviour. */
export const Y_SCALE_KIND_LINEAR = 0;
/** Base-10 logarithmic Y projection. */
export const Y_SCALE_KIND_LOG = 1;
// Values >= 2 are reserved for future scale kinds and must not be assigned here.
```

Numeric, because `ViewportTransform` is constrained to `readonly number` fields; a string union
would break that requirement literally and would make the transform's shape depend on a string
pointer comparison at the hot call site.

#### Field layout

Three fields appended after `yBase`, **in this exact insertion order**, present on **every**
instance including linear ones. A single object literal at the single `return` site of
`createViewportTransform` is what guarantees one V8 shape for all N instances
(<https://mathiasbynens.be/notes/shapes-ics> — property insertion order is part of the shape).
Conditionally omitting the log fields on linear transforms would create two shapes and is the one
mistake that would actually make the per-point call site polymorphic.

```ts
export interface ViewportTransform {
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly yDomainMin: number;
  readonly yDomainMax: number;
  readonly xOrigin: number;
  readonly deviceWidth: number;
  readonly deviceHeight: number;
  readonly dpr: number;
  readonly plotLeft: number;
  readonly plotTop: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
  readonly xScale: number;
  /**
   * Device pixels per domain unit on a linear Y axis. Deliberately `NaN` on a logarithmic axis:
   * there is no single pixels-per-unit ratio there, and a consumer that multiplies by it without
   * checking the scale kind produces a non-finite result that fails visibly on first render
   * instead of a plausible-looking wrong plot.
   */
  readonly yScale: number;
  readonly yBase: number;
  readonly yScaleKind: number;
  /** Base-10 logarithm of `yDomainMin`. `0` on a linear axis. */
  readonly yLogDomainMin: number;
  /** Device pixels per decade. `0` on a linear axis, and on a log axis of zero span. */
  readonly yLogScale: number;
}
```

#### Coefficients precomputed at construction (cold path)

| Field | `yScaleKind === 0` (linear) | `yScaleKind === 1` (log) |
|---|---|---|
| `yScale` | `ySpan === 0 ? 0 : plotHeight / ySpan` (unchanged) | `Number.NaN` |
| `yBase` | `plotTop + plotHeight + yDomainMin * yScale` (unchanged) | `plotTop + plotHeight` |
| `yLogDomainMin` | `0` | `Math.log10(yDomainMin)` |
| `yLogScale` | `0` | `logSpan === 0 ? 0 : plotHeight / logSpan`, where `logSpan = Math.log10(yDomainMax) - yLogDomainMin` |

The log axis folds `yDomainMin` out explicitly rather than into `yBase` (as the linear path does),
because it makes `projectY(t, yDomainMin) === yBase` **exactly** — `Math.log10(yDomainMin)` and
`yLogDomainMin` are the same call on the same input, so their difference is exactly `+0` and the
multiply is exactly `+0`. That exactness at the lower domain edge is load-bearing for D3.

#### Hot-path bodies

```ts
export function projectY(t: ViewportTransform, yValue: number): number {
  // The scale kind is fixed for the lifetime of a transform, so this branch is loop-invariant
  // within any render pass and the predictor resolves it after the first sample.
  return t.yScaleKind === Y_SCALE_KIND_LINEAR
    ? t.yBase - yValue * t.yScale
    : t.yBase - (Math.log10(yValue) - t.yLogDomainMin) * t.yLogScale;
}

export function unprojectY(t: ViewportTransform, devicePixelY: number): number {
  if (t.yScaleKind === Y_SCALE_KIND_LINEAR) {
    return t.yScale === 0 ? t.yDomainMin : (t.yBase - devicePixelY) / t.yScale;
  }
  // A zero-decade domain has no invertible mapping; every pixel reads back as the single
  // domain value, matching the linear zero-span behaviour rather than dividing by zero.
  if (t.yLogScale === 0) return t.yDomainMin;
  return 10 ** ((t.yBase - devicePixelY) / t.yLogScale + t.yLogDomainMin);
}
```

`projectX`/`unprojectX` are untouched.

#### Construction-time validation (additive)

```ts
if (yScaleKind === Y_SCALE_KIND_LOG && yDomainMin <= 0) {
  throw new RangeError(
    `a logarithmic Y axis requires yDomainMin > 0; received ${yDomainMin}.`,
  );
}
```
Also `RangeError` when `yScaleKind` is not an integer in `[0, 1]` — this is what keeps the
reserved `2..n` range honest: shipping code refuses an unimplemented kind loudly rather than
silently taking the log branch.

#### Measurable falsification, and the fallback

**The test that would prove this dispatch wrong:** a Node microbenchmark over 1,000,000 points
comparing the linear-path throughput of the branched `projectY` against the pre-change
single-expression baseline (both warmed, same buffer, same transform instance), and separately
comparing an interleaved workload — alternating a linear and a log transform at one call site —
against each run in isolation.

- **Falsified if** the branched linear path regresses more than **10%** against the baseline, or
  if the interleaved workload is more than **25%** slower than the mean of the isolated runs.
- **Cheap fallback if falsified:** split the body into `projectYLinear`/`projectYLog` and resolve
  the reference **once per frame** in the renderer's per-frame setup, outside the per-point loop.
  Every call site today invokes `projectY(t, y)` and `buildTracePath` already takes the projector
  by reference, so this is a mechanical, non-breaking refactor behind the same exported name. Not
  a one-way door.

The 10%/25% thresholds are engineering budgets chosen here, not measurements. The research
explicitly flags the widely-quoted megamorphic penalty magnitude as community-sourced and
untraceable to a primary V8 benchmark (`research.md` Lane 4), so the fallback is treated as a live
safety net, not a formality, and the magnitude being guarded against is **not** asserted as fact
anywhere in this design.

**Alternatives considered.**
- *Per-frame specialized function references (option (c)).* Rejected as the default: it moves a
  branch out of the loop at the cost of an indirect call the engine may not inline, and it adds a
  seam to every call site for a cost that is not demonstrated. Retained as the named fallback.
- *A `project` method on a polymorphic scale object.* Rejected: this is precisely the multi-shape
  call site the research documents as V8's megamorphic path, and it breaks the archived "free
  functions, not methods" requirement.
- *Branchless arithmetic blend* (`kind * logTerm + (1 - kind) * linTerm`). Rejected: it evaluates
  `Math.log10` unconditionally on every linear point — strictly slower on the common path — and
  `0 * NaN` is `NaN`, so it cannot even be made correct with the `yScale = NaN` sentinel.

---

### D3 — Log inverse totality

**Decision: the log inverse is total and non-`NaN` for every finite input, monotone
non-increasing in pixel, and is permitted to *saturate* to `+0` or `+Infinity` only where the
true mathematical value falls outside f64 range. Saturation is specified, not hidden, and is never
replaced by a clamp to a finite domain value.**

This is the highest-severity decision and there is no prior art: `research.md` Lane 3 establishes
that no reference library documents a total, always-finite inverse, and d3's `scaleLog` documents
`NaN` at a zero-crossing domain — the opposite of totality
(<https://github.com/d3/d3/blob/main/docs/d3-scale/log.md>).

#### Exact arithmetic

```
logValue = (yBase - devicePixelY) / yLogScale + yLogDomainMin
result   = 10 ** logValue
```
with `yBase = plotTop + plotHeight`, `yLogScale > 0` (guarded), `yLogDomainMin` finite.

#### Enumeration of every input that could produce `NaN`, `±Infinity`, or `-0`

| Input | Intermediate | Result | Verdict |
|---|---|---|---|
| `devicePixelY` inside the plot area | finite | finite, in `[yDomainMin, yDomainMax]` | exact case |
| `devicePixelY` just below `plotTop` (above the plot) | `logValue > log10(yDomainMax)` | finite, `> yDomainMax` | correct extrapolation, no clamp |
| `devicePixelY` just above `plotTop + plotHeight` | `logValue < yLogDomainMin` | finite, `< yDomainMin`, still `> 0` | correct extrapolation; a log axis never extrapolates to zero or negative, which is why the `yDomainMin > 0` construction guard is sufficient |
| `devicePixelY` very large negative (far above the plot) | `logValue > ~308.25` | `+Infinity` | **saturation, specified.** The true value exceeds `Number.MAX_VALUE`; returning `+Infinity` is the correct f64 limit. Reachable only beyond roughly `(308 − log10(yDomainMax)) × yLogScale` device pixels above the plot top — for a 600 px, 3-decade axis, ~61,000 px — i.e. not reachable by a pointer, only by a programmatic call. |
| `devicePixelY` very large positive (far below the plot) | `logValue < ~−323.3` | `+0` (never `-0`: the base is positive) | **saturation, specified.** Underflow through denormals to `+0`. |
| `devicePixelY = ±Infinity` | out of contract | the archived requirement is scoped to *finite* inputs; `+Infinity` in yields `+0`, `-Infinity` in yields `+Infinity` | total anyway, no `NaN` |
| `yLogScale === 0` (zero-decade domain, `yDomainMin === yDomainMax`) | guarded **before** the division | exactly `yDomainMin` | no `0/0`, matching the archived zero-span scenario verbatim |
| `yScale === 0` on a log axis | never read: `unprojectY` branches on `yScaleKind` **before** touching `yScale` | — | the `yScale = NaN` sentinel from D2 cannot leak into the log path |
| `yScale === NaN` reached on a log axis | only if a consumer bypasses `unprojectY` | `NaN` | intentional: loud, immediate, visible |

**`NaN` is unreachable on the log inverse for any finite input.** The only `NaN`-producing shapes
in this arithmetic are `0/0` (guarded by the `yLogScale === 0` early return), `Infinity − Infinity`
(impossible: `yBase` and `yLogDomainMin` are finite by construction), and `0 × Infinity`
(impossible: there is no multiplication on the inverse path).

#### Zero-span domain under log, stated explicitly

The archived requirement "A Zero-Span Domain Projects to a Single Line and Inverts Without NaN"
**still holds** under log, with one documented caveat that `sdd-spec` must write down rather than
leave implicit:

- `yLogScale === 0`, so `projectY` computes `yBase − (Math.log10(y) − yLogDomainMin) × 0`. For any
  `y > 0` this is exactly `yBase`. ✅ flat signal draws as a horizontal line, verbatim.
- For `y <= 0` — which is **outside a validated log domain**, a caller-supplied data value, not a
  construction input — `Math.log10(y)` is `-Infinity` or `NaN` and the product is `NaN`. This is
  specified as correct: an out-of-domain sample on a log axis yields a non-finite device
  coordinate, which `Path2D`/`lineTo` skips, and it is loud rather than silent. It MUST be a named
  scenario so it cannot be mistaken for a defect later.
- `unprojectY` returns exactly `yDomainMin`, verbatim.

#### Round-trip error bound

`unprojectY(t, projectY(t, v))` for a log axis composes `Math.log10` (implementation-approximated,
~1 ULP), three exact-ish arithmetic ops, and `10 ** x` (implementation-approximated, ~1 ULP, and
amplifying: a relative error `ε` in `logValue` becomes a relative error of about
`ln(10) × logValue × ε` in the result).

- **Asserted contract:** **relative** error `|round-trip(v) − v| / v <= 1e-9`, for every `v` in
  `[yDomainMin, yDomainMax]` and for `v` up to one decade outside each edge, over domains spanning
  up to 12 decades.
- **Expected observed:** on the order of `1e-13` to `1e-12` relative. The gap between asserted and
  expected is deliberate headroom for the implementation-approximated transcendentals; the test
  MUST NOT assert the tighter figure.
- **The tolerance MUST be relative, never absolute.** An absolute tolerance is meaningless across
  a domain spanning decades: `1e-9` absolute is vacuous at `1e3` mW and unsatisfiable at `1e-9` mW.
  This is the single easiest way to write a test that passes while proving nothing, and it is
  called out here because change 13.5's marker mathematics consumes this arithmetic and a wrong
  reading there is worse than a crash.
- **Edge exactness:** `projectY(t, yDomainMin) === yBase` **exactly** (see D2). At the upper edge,
  `projectY(t, yDomainMax)` equals `plotTop` within 1 ULP, not exactly — the spec MUST state the
  1-ULP allowance rather than assert bit-equality that the implementation cannot deliver.

**Alternatives considered.**
- *Clamp the result to `[Number.MIN_VALUE, Number.MAX_VALUE]`.* Rejected: it fabricates a finite,
  plausible-looking reading in exactly the regime where the answer is meaningless — the proposal's
  named worst failure mode.
- *Throw on out-of-range pixel coordinates.* Rejected: it breaks the archived totality contract,
  which the linear path already satisfies and which pan/zoom hit-testing relies on.
- *Store `yLogSpan` and divide per call instead of storing `yLogScale`.* Rejected: a division per
  point where a multiply suffices, and it moves a `=== 0` guard into the hot path.

---

### D4 — Log tick selection

**Decision: `selectLogTicks` is fully transcendental-free, including the sub-decade fallback.
`ticks.ts` gains no `Math.log10` and no `Math.pow`, so the archived source-scan determinism
assertion extends to the new function unchanged.**

This **improves on the exploration's proposal**, which accepted `Math.pow` in the sub-decade
fallback (exponentiating a handful of cold-path tick values). Improving on it costs nothing:
across a span of less than one decade the log mapping is smooth and monotone, so linear "nice"
tick values in *value* space are already well-placed, correctly ordered and correctly labelled on
screen. Reusing the existing `selectTicks` for that case is simpler, faster, and — decisively —
preserves the one property the archived spec asserts by source scan. The exploration's own stated
rationale for the ban (avoiding float drift when classifying an exact power of ten) applies with
full force to decade classification here.

#### Signature

```ts
export function selectLogTicks(
  domainMin: number,
  domainMax: number,
  targetCount: number,
  out: Float64Array,
  outputOffset: number,
): number
```
Identical caller-buffer contract to `selectTicks`: writes into the caller's preallocated
`Float64Array` at `outputOffset`, never beyond `out.length`, returns the count. No array is
allocated to return values.

#### Algorithm

```
capacity = out.length - outputOffset
1. if capacity <= 0                      -> return 0
2. if domainMin <= 0 or !finite          -> return 0   (not a valid log domain; the transform
                                                        constructor already threw for it, so this
                                                        is defensive, not a reachable path)
3. if domainMin === domainMax            -> out[offset] = domainMin; return 1
4. if domainMin > domainMax              -> return 0

5. DECADE FLOOR, by the same integer multiply/divide magnitude walk `niceStep` already uses:
     decade = 1
     if domainMin >= 1: while (decade * 10 <= domainMin) decade *= 10
     else:              while (decade > domainMin)       decade /= 10
   -> `decade` is the largest power of ten <= domainMin. No logarithm.

6. DECADE COUNT: walk d = decade upward by *10 while d <= domainMax, counting decades whose
   value lies within [domainMin, domainMax]. Call it decadeCount.

7a. decadeCount >= 2 and many decades (decadeCount > targetCount):
      THINNING. stride = ceil(decadeCount / targetCount), computed by integer addition, not
      division-and-rounding of a float. Emit d, then d *= 10 `stride` times, for each emitted
      value in [domainMin, domainMax] and while count < capacity.
      -> at most one tick per power of ten, as required.

7b. decadeCount >= 2 and few decades (decadeCount <= targetCount):
      Emit every decade in range. Additionally, when decadeCount <= 2 AND
      decadeCount * 9 <= min(targetCount * 2, capacity), emit the 2..9 mantissa minor ticks
      within each decade: for m = 2..9, value = d * m, emitted only if in range.
      Values are produced in ascending order by construction (walk the decade, then its
      mantissas, then the next decade). No transcendental.

7c. decadeCount <= 1 — THE SUB-DECADE CASE:
      delegate verbatim to selectTicks(domainMin, domainMax, targetCount, out, outputOffset).
      Linear nice 1/2/5×10^k values across a sub-decade span are correctly ordered, correctly
      covering, and visually well-spaced under the log map.

8. NON-EMPTY FLOOR (the anti-defect guarantee):
      if count === 0 and capacity >= 1:
        out[outputOffset] = domainMin
        count = 1
      return count
```

#### What this returns for the documented d3 defect cases

| Domain | d3-scale (<https://github.com/d3/d3-scale/issues/44>) | `selectLogTicks` |
|---|---|---|
| `[42, 43]` | **empty array** | step 7c → `selectTicks(42, 43, …)` → `42, 42.2, 42.4, …, 43` (≥ 5 ticks at `targetCount: 5`) |
| `[286.9252014, 329.4978332]` | single tick `[300]` | step 7c → `290, 300, 310, 320` at `targetCount: 5` |
| `[1e-3, 1e6]` (9 decades, target 5) | one per power | step 7a, `stride = 2` → `1e-3, 1e-1, 1e1, 1e3, 1e5` |
| `[1, 100]`, target 12 | uniformly spaced within each power | step 7b → `1,2,…,9,10,20,…,90,100` clamped to capacity |

**Step 8 is the load-bearing guarantee**, and it is unconditional: for any domain with
`domainMin > 0` and `domainMin < domainMax` and `capacity >= 1`, `selectLogTicks` returns `>= 1`.
An axis that silently renders with no ticks after a zoom looks like a legitimately sparse axis in
a golden image, not a failure — which is why this needs a direct assertion, not golden coverage.
`selectTicks` in step 7c can itself return `0` in a narrow case (`niceStep` may return up to
`10 ×` the raw step, so the first nice multiple can overshoot `domainMax` at very low
`targetCount`); step 8 catches exactly that, which is the same class of defect d3 ships.

**`selectTicks` itself is not modified.** Its requirement, its transcendental ban and its
scenarios survive verbatim.

**Alternatives considered.**
- *`niceStep` in log space, then `Math.pow` the selected values* (the exploration's proposal).
  Rejected: introduces `Math.pow` into `ticks.ts`, weakening a source-scannable guarantee, to
  produce labels no better than 7c's for a span where the log map is near-linear anyway.
- *Port d3's `log.ticks()`.* Rejected: it ships the documented, acknowledged, unresolved
  empty-result defect this change exists in part to avoid.
- *Generalize `selectTicks` with a scale-kind parameter.* Rejected: it puts a branch inside a
  function whose determinism guarantee is asserted by source scan, and would force re-verifying
  every archived `selectTicks` scenario.

---

### D5 — Multi-axis data model and inset arithmetic

**Decision: N independent Y domains are N `ViewportTransform` instances of one shape, all sharing
identical X fields *and identical plot geometry*. Per-axis gutters affect where labels are painted,
never each transform's plot area.**

#### Axis registration

A registration is plain, frozen, isomorphic configuration — no DOM, no font metrics, no style:

```ts
export const AXIS_SIDE_LEFT = 0;
// Value 1 is reserved for right-side axes; not implemented in this change.

export interface YAxisRegistration {
  /** Stable identity. The seam change 5.7 binds a trace to; unused by projection itself. */
  readonly id: string;
  readonly scaleKind: number;
  readonly domainMin: number;
  readonly domainMax: number;
  readonly side: number;
}
```

`side` exists now, with only `AXIS_SIDE_LEFT` accepted, because the confirmed product decision is
"left-stacked only" while keeping *which side* an axis-registration property rather than a fixed
layout assumption. A right-side axis later adds a branch to the gutter arithmetic and touches
`ViewportTransform` not at all.

#### N transforms from one shared X domain

```ts
export function createAxisTransforms(
  shared: SharedViewportOptions,          // cssWidth/cssHeight/dpr/insets/xDomain*/xOrigin
  axes: readonly YAxisRegistration[],
  out: ViewportTransform[],               // caller-owned, same idiom as the tick buffers
): number
```

Returns the count written; `out[i]` corresponds to `axes[i]`. Cold path (resize / `setDomain`),
never per frame, so the array write is not a hot-path allocation. Registration order is the
binding: index `i` ↔ `axes[i].id`.

#### Who owns the gutter arithmetic

The renderer, because gutter width is a function of **font metrics and style**, which
`@trace-kit/core` must never see (CLAUDE.md rule 5). `computeAxisInsets` in
`packages/renderers/src/canvas2d/axes.ts` generalizes:

```ts
export function computeAxisInsets(
  style: FigureStyle,
  axes: AxisLayout,
  yAxisCount: number,
): AxisInsets
// insetLeft = axes.showLeftAxis ? yAxisCount * (tickLength + labelGutter + fontSizeCss) : 0
// insetRight / insetTop unchanged at 0; insetBottom unchanged.

export function computeYAxisGutterOffsets(
  style: FigureStyle,
  axes: AxisLayout,
  yAxisCount: number,
  out: Float64Array,
): number
// out[i] = the CSS-pixel left edge of axis i's label column.
// Index 0 is the INNERMOST column (nearest the plot area); each subsequent axis stacks further
// left. Caller-buffer contract, matching selectTicks.
```

#### The invariant that prevents a whole class of bugs

`insetLeft` is **one number**, the sum of all left gutters, and it is passed identically to all N
`createViewportTransform` calls. Therefore every one of the N transforms has **byte-identical**
`plotLeft`, `plotTop`, `plotWidth`, `plotHeight`, `xScale`, `deviceWidth`, `deviceHeight`, `dpr`.
The CSS→device conversion (`× dpr`) still happens exactly once per transform construction, on an
already-summed CSS-pixel value — the archived "insets are converted to device pixels once"
requirement holds verbatim, with no second conversion anywhere. Gutter *offsets* stay in CSS px in
the renderer and are converted where labels are drawn, which is a paint concern, not a projection
one.

Rejected alternative: giving each axis its own `insetLeft` so that axis *i*'s transform has a
different `plotLeft`. That would make N transforms disagree about the plot rectangle, so gridlines,
the trace clip and hit-testing would each depend on which transform happened to be in hand — a
silent, hard-to-see defect. One shared plot area is non-negotiable.

#### Plot area when the axis count changes

`insetLeft` grows linearly with `yAxisCount`; the plot area shrinks accordingly; all N transforms
are rebuilt from the new inset in the same cold pass. `yAxisCount === 0` with `showLeftAxis`
false yields `insetLeft === 0`, identical to today. Adding an axis that would drive
`insetLeft + insetRight >= cssWidth` throws `RangeError` from the existing construction guard —
already covered, no new validation.

#### The seam left for 5.7 (trace-to-axis binding), explicitly not built

5.6 exposes exactly three things 5.7 will consume, and nothing more:
1. `YAxisRegistration.id` — a stable identity to bind to.
2. Positional correspondence `out[i] ↔ axes[i]`, so a lookup is an index, not a map.
3. `buildTracePath`, unchanged, which already takes a `ViewportTransform` plus `projectX`/`projectY`
   by reference and does not care which axis produced them.

5.6 builds **no** `yAxisId` field on any trace, **no** id→index lookup map, and **no** per-trace
state. The single-trace renderer continues to use `out[0]`.

---

### D6 — GPU precision contract wording

**Decision: this change states an obligation and ships a CPU-side proof that the obligation is
necessary and that the prescribed arithmetic is sufficient. It cannot, and does not, verify that
change 7's shader obeys it. That is stated plainly rather than papered over.**

No WebGL2 dependency enters `@trace-kit/core` (CLAUDE.md rule 5). No new field is added:
`xOrigin`, `xDomainMin` and `xDomainMax` are already f64 on the frozen transform and MUST NOT
regress — the `spectrum-data-payload` f64-origin/f32-offset guarantee is unchanged by this change.

#### The exact contract sentence for the MODIFIED `viewport-transform` delta

> A consumer that uploads X-domain values to a WebGL2 vertex attribute, uniform, or buffer MUST
> compute the normalized quantity `(xOrigin + xOffset - xDomainMin) / (xDomainMax - xDomainMin)`
> entirely in IEEE-754 binary64 on the CPU, and MUST cast only that normalized result — whose
> magnitude is bounded by the visible domain rather than by the absolute wavelength — to float32.
> It MUST NOT cast `xOrigin`, `xDomainMin`, `xDomainMax`, or the sum `xOrigin + xOffset` to
> float32 individually, and MUST NOT perform the subtraction `x - xDomainMin` on float32 operands
> in shader code. `createViewportTransform` MUST store `xOrigin`, `xDomainMin` and `xDomainMax`
> without any float32 rounding, so that `Math.fround(t.xOrigin) !== t.xOrigin` holds for an origin
> such as `1550.123456`.

This is precise enough that change 7 cannot satisfy it accidentally: it names the exact expression,
names the three casts that are forbidden, and names the one shader operation that is forbidden.
GLSL ES 3.00 `highp float` guarantees only 2^-24 relative precision (~7 significant digits) and
WebGL2 exposes no double-precision vertex or uniform type
(<https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf>; per
`research.md` Lane 1 the absence of a double type is **inferred from the spec's silence**, not a
quoted negative — stated here as inference, not fact). `1550.123456` nm at sub-picometre
resolution needs ~10 digits; float32 supplies ~7.

#### How much of it is testable from inside `@trace-kit/core`

**Testable, and required by this change:**
1. **The f64 storage guarantee.** Assert `Math.fround(t.xOrigin) !== t.xOrigin` and the same for
   `xDomainMin`/`xDomainMax` on a transform built with `xOrigin: 1550.123456`. A pure-number,
   DOM-free unit test that fails the instant anyone introduces an f32 round-trip into construction.
   This is the actual anti-regression gate.
2. **The obligation's necessity and the prescribed arithmetic's sufficiency**, as CPU-side
   arithmetic with `Math.fround` standing in for the float32 cast:
   - naive path — `Math.fround(xOrigin + xOffset) - Math.fround(xDomainMin)` — assert its error
     **exceeds** 1 pm for a 1550 nm origin. (Proves the obligation is not theoretical.)
   - prescribed path — normalize in f64, then one `Math.fround` — assert its error is **below**
     1 pm over both a 100 nm and a 1500 nm span. `research.md` Lane 1 derives ~10 fm and ~150 fm
     respectively; this is **derived arithmetic from the cited spec property, not an empirical GPU
     measurement**, so the test asserts the 1 pm ceiling, not the derived figures.

**Not testable from `@trace-kit/core`, stated plainly:** whether change 7's actual GLSL and
`bufferData` calls obey the contract. Core has no GPU, no WebGL2 context, and must not acquire
one. `Math.fround` models the float32 *cast*; it does not model shader arithmetic, driver
behaviour, or the fact that GLSL ES 3.00 operations are not required to be strictly IEEE-754
conformant even where the encoding is.

**What that means, concretely:** the contract is enforceable at the seam it owns (transform
storage) and only *documented* at the seam it does not (shader upload). `sdd-spec` MUST therefore
write the GPU sentence as a requirement on the **consumer**, and the roadmap entry for change 7
MUST carry a conformance test — a WebGL2 readback asserting sub-picometre round-trip through the
real pipeline — as an acceptance criterion of change 7, not of this one. Without that, the
obligation is a comment that a future implementer can satisfy by believing they have.

---

## TraceKit Core Architecture Constraints

**Zero-copy and allocation.** No new allocation anywhere on a render path. Coefficients are
computed once at construction (cold). `Math.log10` and `**` allocate nothing. `selectLogTicks`
writes into a caller-owned `Float64Array`; `computeYAxisGutterOffsets` and `createAxisTransforms`
follow the same caller-buffer idiom. No buffer crosses a worker boundary in this change, so no
`Transferable` is introduced; `ViewportTransform` remains `structuredClone`-safe by staying a flat
number object. The zero-GC gate runs **per `yScaleKind` value** — `Math.log10`'s non-allocating
nature is asserted by measurement, not assumed (a stated risk in the proposal).

**Engine selection.** This change is engine-agnostic and does not move the Canvas2D/WebGL2
threshold or its hysteresis: point count is independent of scale kind, so the switch logic is
untouched. Canvas2D (<80k points) consumes `projectY` per point through `buildTracePath`, which
already takes the projector by reference. WebGL2 (>80k points, change 7) consumes the *precomputed
coefficients* as uniforms rather than calling `projectY` per point — this is exactly why the
coefficients are fields on the transform rather than locals in the projector, and why 5.6 must land
before 7. One note handed to change 7: GLSL ES 3.00 has no `log10`; a shader-side log axis computes
`log2(y) * 0.30102999566398120` (`1/log2(10)`), which is a different approximation than
`Math.log10` and will not be bit-identical to the Canvas2D path. Change 7 owns reconciling that; it
is recorded here so it is not discovered late.

**Reactivity isolation.** In Vue 3, the array of N transforms MUST be held in a `shallowRef` and
replaced wholesale on resize/domain change — never `reactive([])` and never `ref([])` with deep
tracking. A deep reactive proxy over a `ViewportTransform` turns every `t.yScale`, `t.yBase`,
`t.yScaleKind` read inside `projectY` into a proxy getter trap, which both destroys the monomorphic
property load D2 depends on and makes the hot loop allocate through the reactivity effect
machinery. It would also silently defeat `Object.isFrozen` identity checks. In React, the transform
array lives in a `useRef`, never in `useState`. Telemetry buffers themselves are unchanged by this
change and keep their existing `markRaw`/`useRef` treatment.

**Decimation invariants.** Untouched. LTTB and Min-Max Envelope operate on raw domain values before
projection, and scale kind is never baked into stored data. One consequence worth recording for a
later change, explicitly **out of scope here**: decimating in linear value space and then projecting
logarithmically is not the same as decimating in log space, and can under-represent structure in
the low decades of a log axis. That is a decimation-capability question, not a projection one, and
this change neither introduces nor fixes it.

---

## File Changes

| Action | File Path | Description |
|---|---|---|
| MODIFY | `packages/core/src/viewport/transform.ts` | `yScaleKind`/`yLogDomainMin`/`yLogScale` fields in fixed insertion order; `Y_SCALE_KIND_LINEAR`/`Y_SCALE_KIND_LOG` constants; log coefficient precomputation; log branch in `projectY`/`unprojectY`; `RangeError` for `yDomainMin <= 0` on log and for an unsupported `yScaleKind` |
| NEW | `packages/core/src/viewport/axes.ts` | `YAxisRegistration`, `AXIS_SIDE_LEFT`, `createAxisTransforms` (caller-buffer, cold path) |
| MODIFY | `packages/core/src/viewport/ticks.ts` | `selectLogTicks`; `selectTicks` and `niceStep` untouched; module stays transcendental-free |
| MODIFY | `packages/core/src/viewport/index.ts` | Export the new symbols |
| MODIFY | `packages/core/src/index.ts` | Public export surface |
| MODIFY | `packages/renderers/src/canvas2d/axes.ts` | `computeAxisInsets(style, axes, yAxisCount)`; `computeYAxisGutterOffsets`; `drawGrid`/`drawAxes` iterate N transforms; decade gridlines; `selectLogTicks` substituted per axis scale kind |
| MODIFY | `packages/renderers/src/canvas2d/canvas2d-renderer.ts` | Hold N transforms; pass `yAxisCount` to inset computation |
| NEW | `packages/core/test/node/viewport-log-transform.test.ts` | Log projection, totality/saturation enumeration, relative round-trip bound, zero-log-span, construction `RangeError` |
| NEW | `packages/core/test/node/viewport-log-ticks.test.ts` | Decade/mantissa/thinning/sub-decade; the non-empty floor; the `[42, 43]` and `[286.9252014, 329.4978332]` cases |
| NEW | `packages/core/test/node/viewport-gpu-precision.test.ts` | f64 storage assertion; naive-vs-prescribed `Math.fround` error comparison |
| NEW | `packages/core/test/node/viewport-multi-axis.test.ts` | Shared plot geometry across N transforms; inset stacking order; plot shrink |
| MODIFY | `packages/core/test/node/*allocation*` (existing zero-GC gate) | Parameterize by `yScaleKind`; add the `projectY` allow-list source scan |
| MODIFY | `packages/renderers/test/node/axes-grid.test.ts` | N-axis inset signature |
| NEW | `packages/renderers/test/visual/**` goldens | Log-axis figure; dual-Y-axis figure. Existing single-linear-axis goldens MUST show zero diff |
| MODIFY | `openspec/specs/{viewport-transform,canvas2d-axes-grid,visual-golden-corpus}` | Delta specs (written by `sdd-spec`, not here) |
| MODIFY | `openspec/roadmap.yaml` | Drop `scale-linear-transform` from `order: 5.6`'s intended surface |
| NEW | `.changeset/*.md` | Patch bump, per the repository's low-velocity versioning policy |

---

## Risks & Mitigations

| # | Risk | Mitigation in this design |
|---|---|---|
| 1 | **Silent numerical error in the log inverse** (highest severity; no prior art) | D3 enumerates every `NaN`/`±Infinity`/`-0` path exhaustively; saturation is specified rather than clamped; the round-trip tolerance is mandated **relative**, which is the specific test-design mistake that would let a broken implementation pass |
| 2 | Archived "no `Math.*`" left ambiguous | **Resolved** in D1 with the exact replacement sentence for `sdd-spec` to transcribe, plus a source-scan allow-list so the check stays mechanical |
| 3 | A shape split makes the hot call site polymorphic | D2 mandates the three new fields on **every** instance, emitted from the single object literal at the single return site; an explicit test asserts both a linear and a log transform expose the same key order |
| 4 | Allocation regression on the log path | Zero-GC gate runs per `yScaleKind`; measured, not assumed |
| 5 | Dispatch choice wrong | D2 names a falsifying microbenchmark with explicit thresholds and a mechanical fallback that needs no call-site changes |
| 6 | `selectLogTicks` returns zero ticks after a zoom (the d3 defect) | Step 8's unconditional non-empty floor, asserted directly rather than via goldens |
| 7 | Golden churn beyond scope | Zero-diff assertion on existing single-linear-axis goldens is itself the regression check; linear coefficients and the linear `projectY` expression are byte-identical to today |
| 8 | Multi-axis gutter bugs | One shared `insetLeft` across all N transforms makes disagreeing plot rectangles structurally impossible; gutter offsets are label-paint-only |
| 9 | `yScale = NaN` on log axes surprises a consumer | Deliberate and documented: a bypassing consumer fails loudly on first render rather than plotting a plausible wrong curve. The archived `structuredClone` scenario must compare with `Object.is` if it is ever extended to a log transform — flagged for `sdd-spec` |
| 10 | GPU obligation satisfied only in belief | D6 states plainly that shader conformance is untestable from core and pushes a WebGL2 readback conformance test into change 7's acceptance criteria |
| 11 | Scope creep into a scale library | `symlog` is reserved at `yScaleKind === 2` and construction **throws** for any kind outside `[0, 1]`, so the reserved range cannot be quietly occupied |

---

## Decision Status

| Decision | Status |
|---|---|
| D1 — `Math.log10` in `projectY` | **Resolved** — narrowed to a source-scannable allow-list; exact spec wording given |
| D2 — Dispatch strategy | **Resolved** — field layout, constants, coefficients, exact bodies, falsification test, fallback |
| D3 — Log inverse totality | **Resolved** — exact arithmetic, exhaustive non-finite enumeration, relative round-trip bound |
| D4 — Log tick selection | **Resolved** — full algorithm, transcendental-free including the sub-decade fallback, non-empty floor |
| D5 — Multi-axis model and insets | **Resolved** — registration shape, N instances, shared plot geometry, gutter ownership, 5.7 seam |
| D6 — GPU precision contract | **Resolved** — exact contract sentence, what is testable in core, what plainly is not |

**Nothing remains open. `sdd-apply` is not blocked by an unresolved decision from this phase.**
