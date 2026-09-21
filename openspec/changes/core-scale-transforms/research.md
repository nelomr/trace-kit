# Research: `core-scale-transforms`

> Phase: `sdd-research`. External evidence only. This document records what published sources
> establish, and — equally important — what they do not. Every claim is labelled by evidence
> class. Unsourced assertions were deliberately excluded rather than filled in with plausible
> reasoning, because a later phase would treat them as evidence.

Evidence classes used below:
**(a)** specification text · **(b)** documented implementation behaviour in a named library
· **(c)** benchmark with stated methodology · **(d)** community claim / practitioner blog.

---

## Lane 1 — Float32 precision in WebGL2 vertex pipelines

**(a) GLSL ES 3.00 `highp float`.** Encoding is logically IEEE 754 binary32; magnitude range
(2^-126, 2^127); **relative precision 2^-24** (~1.19e-7, roughly 7 significant decimal digits).
Operations are *not* required to be strictly IEEE-754-conformant even though the encoding is.
Source: Khronos GLSL ES 3.00 specification, "Precision and Precision Qualifiers".
<https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf>

Derived consequence (arithmetic from the cited relative precision, not a separate benchmark):
representing `1550.123456` nm to sub-picometre (1e-3 nm) resolution against an absolute magnitude
of ~1.5e3 requires ~10 significant digits. Float32 supplies ~7. Uploading the raw value is short
by roughly three orders of magnitude.

**(a, inferred from absence) No double-precision GPU type in WebGL2.** GLSL ES 3.00 defines only
`float`/`vec*` up to `highp` (32-bit). Desktop GLSL 4.00+ added `double`/`dvec*`; WebGL does not
expose it. No source was found stating the negative explicitly — the spec's silence is the
evidence. Flagged as inferred, not quoted.

**(b) Mitigation — Relative-to-Center (RTC) / relative-to-eye.** Used by Cesium via the
`CESIUM_RTC` glTF extension for massive-coordinate geospatial rendering. Each vertex is stored as
an offset from a chosen origin so the float32 offset is small and therefore precise; the
origin-to-eye transform is computed in float64 on the CPU and folded into the model-view matrix
before any GPU-side float32 arithmetic. This avoids GPU-side subtraction of two large float32
values, which is where catastrophic cancellation actually occurs. Cost: re-centering (and
possibly re-uploading offsets) whenever the centre must move outside the active origin's safe
range, plus one CPU-side double-precision transform per frame or batch.
<https://github.com/KhronosGroup/glTF/blob/main/extensions/1.0/Vendor/CESIUM_RTC/README.md> ·
<https://cesium.com/blog/2015/05/26/graphics-tech-in-cesium-stack> ·
<https://community.cesium.com/t/does-cesium-render-relative-to-center-or-relative-to-eye/8596>

**(d, unverified) Double-single / DSFUN90 emulated double precision.** Referenced in general
GPU-precision literature, but no primary source (original DSFUN90 material or a Kalman/Ohlarik
writeup) was consulted. Per-operation cost and accuracy ceiling are **not established**. See
Unresolved.

**(a, derived) CPU-side float64 normalization to [0,1] before float32 upload.** Same underlying
principle as RTC: reduce magnitude before the float32 cast, since float32's absolute precision is
a function of magnitude rather than a fixed decimal count. Applying the cited 2^-24 relative
precision to a normalized value near 1.0 yields absolute error on the order of 1e-7 of the domain
span — for a 100 nm span, ~1e-5 nm (10 fm); for a 1500 nm span, ~1.5e-4 nm (150 fm). Both are
comfortably sub-picometre. **This is derived arithmetic from the cited spec property, not an
empirical measurement**; no benchmark source for this specific scenario was found.

---

## Lane 2 — Tick selection on logarithmic axes

**(b) d3-scale `log.ticks()`.** "If the base is an integer, the returned ticks are uniformly
spaced within each integer power of base; otherwise, one tick per power of base is returned. If
the orders of magnitude in the domain is greater than count, then at most one tick per power is
returned."
<https://github.com/d3/d3/blob/main/docs/d3-scale/log.md> · <https://d3js.org/d3-scale/log>

**(b) Documented open defect for sub-decade domains.** Issue "Log scales may generate no ticks for
small domains": a domain of `[42, 43]` returns an **empty array**; a linked case,
`scaleLog().domain([286.9252014, 329.4978332]).ticks()`, returns only `[300]` where the reporter
expected the 1–9 minor set. Acknowledged upstream and unresolved.
<https://github.com/d3/d3-scale/issues/44> · <https://github.com/d3/d3-scale/issues/192> ·
<https://github.com/d3/d3-scale/issues/33>

**(b) Matplotlib `LogLocator`.** The `subs` parameter (default `(1.0,)`) selects which mantissa
multiples of each power receive a tick; `subs='auto'` places ticks between powers adaptively,
`subs='all'` forces integer submultiples 1–9. Separately, `LogFormatter` suppresses minor tick
*labels* past roughly a 10-decade span by default.
<https://www.geeksforgeeks.org/python/matplotlib-ticker-loglocator-class-in-python/> ·
<https://github.com/matplotlib/matplotlib/issues/9107>
Behaviour for domains spanning **less than one decade** — the mirror of the d3 defect — was not
found. See Unresolved.

**(a) Extended Wilkinson algorithm.** Talbot, Lin & Hanrahan, "An Extension of Wilkinson's
Algorithm for Positioning Tick Labels on Axes", InfoVis 2010.
<http://vis.stanford.edu/files/2010-TickLabels-InfoVis.pdf> ·
<http://vis.stanford.edu/papers/tick-labels>
Scope appears to be **linear axis labelling** — extending Wilkinson's loss-function optimization
over nice numbers, coverage, density and simplicity — with no claim to unify log-axis placement.
The primary PDF body was not read directly; this rests on secondary summaries. Treat as
likely-but-unconfirmed.

**(d) No authoritative source found** on tick-label handling when a log domain includes or
approaches zero, beyond Lane 3's finding that log scales forbid zero in-domain outright, which
sidesteps the question.

---

## Lane 3 — Log scale domain-validity semantics

**(b) d3-scale `scaleLog`.** "A log scale domain must be strictly-positive or strictly-negative;
the domain must not include or cross zero." A domain crossing zero produces `NaN`. Negative
domains are supported by implicitly negating input and output, so a scale is not restricted to
positive domains — but each instance must be single-signed. Passing a value of the wrong sign
relative to the domain's sign is explicitly **undefined behaviour**.
<https://github.com/d3/d3/blob/main/docs/d3-scale/log.md> · <https://github.com/d3/d3/issues/1420>

**(b) d3-scale `scaleSymlog`.** Unlike log, its domain **may include zero**. Configured with
`.constant(k)` (default 1), playing the role Matplotlib calls `linthresh`.
<https://github.com/d3/d3/blob/main/docs/d3-scale/symlog.md>

**(b) Matplotlib `symlog`.** `linthresh` sets the half-width of the linear region
`(-linthresh, linthresh)` around zero, outside of which the axis is logarithmic; `linscale`
controls how much screen space that linear region occupies, in decade-equivalents (default 1.0).
<https://matplotlib.org/stable/gallery/scales/symlog_demo.html> ·
<https://matplotlib.org/stable/api/scale_api.html>
When symlog is correct: whenever the physical signal legitimately crosses or approaches zero — a
signed residual, a bipolar trace — and a pure log scale would be undefined there. This reasoning
follows structurally from the parameter semantics in both libraries; no single canonical
"log vs symlog" statement was located.

**Total invertibility — explicitly NOT established.** None of d3-scale, Matplotlib or Plotly
documents a guaranteed total, always-finite inverse for every possible pixel coordinate,
including coordinates outside the plot area. d3's own documented `NaN` at domain-crossing-zero is
the opposite of totality. **A total inverse must be engineered and tested here; it cannot be
assumed from any of these libraries.** This is a genuine gap in the literature, not an omission.

**(d) Plotly's zero/negative log-domain behaviour was not independently confirmed** from Plotly's
own documentation. See Unresolved.

---

## Lane 4 — Monomorphic vs polymorphic call sites in V8

**(b/d) Shapes and inline caches.** Mathias Bynens, "JavaScript engine fundamentals: Shapes and
Inline Caches" (2018): shapes/hidden classes are a **shared architectural pattern across
engines** under different names — V8 "Maps", SpiderMonkey "Shapes", JavaScriptCore "Structures",
Chakra "Types". An inline cache records the shape plus property offset seen on first access and
skips dictionary lookup when a later object has the same shape. **Object property insertion order
matters**: `{x:4,y:5}` and `{y:5,x:4}` are different shapes. Practical guidance: initialize
objects with consistent property order and shape.
<https://mathiasbynens.be/notes/shapes-ics>

**(d, community-sourced) IC state transitions and the cliff.** Secondary sources consistently
describe: monomorphic (1 shape) → direct-offset load, eligible for TurboFan inlining; polymorphic
(2–4 shapes) → a linear chain of shape checks, still optimizable but slower; megamorphic
(>4 shapes) → V8 abandons per-site caching and falls back to a global dictionary-style lookup,
with TurboFan typically declining to optimize the containing function. One secondary source
states a "10–50x" degradation figure, but **it could not be traced to a primary V8-team benchmark
with a stated methodology** — it appears only in derivative content. Treat the magnitude as
unverified.
<https://braineanear.medium.com/the-v8-engine-series-iii-inline-caching-unlocking-javascript-performance-51cf09a64cc3>

**Cross-engine generalization.** The shapes architecture is documented to exist in V8,
SpiderMonkey and JavaScriptCore alike, so the *qualitative* monomorphic-is-faster principle
plausibly generalizes to Firefox and Safari. The *quantitative* claims — the >4-shape threshold,
the 10–50x figure — are V8-specific and community-sourced only. **No equivalent quantified
benchmark was found for SpiderMonkey or JavaScriptCore.**

**Implication for this change.** The documented mitigation is keeping the per-point call site
monomorphic: every scale object reaching one hot call site must share a single shape — same
properties, same insertion order — rather than mixing linear-scale and log-scale objects with
divergent internal fields at the same site. No source benchmarks a
"scale.project() per point in a render loop" scenario directly.

---

## Lane 5 — Multi-axis layout conventions

**(b)** Plotly Express does not support multiple Y axes on one figure; multi-axis figures require
the lower-level `graph_objects` API with `make_subplots()` and explicit `yaxis2`, `yaxis3`, …
<https://plotly.com/python/multiple-axes/>

**(b)** Matplotlib's `twinx()` creates a second Y axis sharing one X axis, independently scaled
and conventionally drawn on the opposite (right) side.
<https://www.pythonpool.com/twinxy/>

**(d) Gap:** no vendor-published oscilloscope / OSA documentation on multi-axis display
conventions was retrieved. See Unresolved.

**(d) Dual-axis criticism.** A widely repeated practitioner concern that arbitrary independent
scaling of two Y axes can visually imply correlation between unrelated series, and that adjusting
the right-axis limits can make a weak trend look strong. **No peer-reviewed visualization-research
citation was located**; this is practitioner consensus, not a verified academic finding.

---

## Findings that constrain the design

1. Raw wavelength values must **not** reach the GPU as float32 if sub-picometre fidelity is
   required. The domain must be normalized or offset in float64 on the CPU before the float32
   cast. (Lane 1: GLSL ES 3.00 spec plus the Cesium RTC precedent.)
2. WebGL2 / GLSL ES 3.00 has no native double-precision vertex type. All float64 handling is
   CPU-side, before upload. (Lane 1.)
3. A log tick generator cannot naively mirror d3-scale's `log.ticks()` for narrow sub-decade
   domains without inheriting a documented empty-result failure. An explicit fallback is
   required. (Lane 2.)
4. No reference library guarantees a total, always-finite inverse projection for arbitrary pixel
   coordinates. Since the archived `viewport-transform` contract already requires exactly that,
   it must be built and tested here, not borrowed. (Lane 3.)
5. A pure log scale cannot have a domain crossing zero. If a signal can cross zero, `symlog` with
   an explicit linear threshold is the documented alternative — a product decision, not a
   detail. (Lane 3.)
6. Per-point projection call sites should be kept monomorphic — a single object shape — to avoid
   V8's megamorphic fallback. The qualitative conclusion is well supported; the exact magnitude
   is not independently verified. (Lane 4.)

## Unresolved

- Double-single (DSFUN90-style) GPU precision emulation: exact per-operation cost and accuracy
  ceiling. No primary source consulted.
- Whether Extended Wilkinson explicitly covers or excludes logarithmic axes. Primary PDF body not
  read.
- Matplotlib `LogLocator`/`LogFormatter` behaviour for domains spanning less than one decade.
- Plotly's exact behaviour (throw / clamp / NaN) for a log axis whose domain contains zero or
  negative values.
- Any primary, methodology-stated V8 benchmark behind the "10–50x megamorphic penalty" figure,
  and any equivalent for SpiderMonkey or JavaScriptCore.
- Vendor (oscilloscope / OSA) documentation on multi-axis display conventions.
- Any peer-reviewed source for the dual-axis misleading-correlation criticism.
