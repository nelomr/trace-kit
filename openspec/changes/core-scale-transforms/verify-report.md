# Verify Report: core-scale-transforms

**Verdict: `compliant-with-gap`**

The gap is exactly the one `sdd-apply` declared: Phase 11 (visual goldens, tasks 11.1–11.7) and
the visual-dependent halves of 12.3/12.8 cannot execute on this machine (macOS) because the visual
suite hard-skips off Linux. Everything independently checkable here — 355 core+renderers tests,
typecheck, lint, `any`/`as never` greps, the two deviations `sdd-apply` flagged, the `Math.*`
allow-list, positive controls, and the unchanged-linear-path proof — is confirmed real and correct.
No other gap was found.

---

## 1. Requirement → scenario → test compliance matrix

### `scale-logarithmic-transform` (all ADDED requirements)

| Requirement | Scenario | Test |
|---|---|---|
| Y-Axis Scale Kind Is a Numeric, Reserved-Range Discriminant | supported/reserved/non-integer | `log-transform.test.ts:56,61,65,69` |
| A Log Y Axis Requires a Strictly Positive Domain Minimum | zero/negative/positive/linear-unaffected | `log-transform.test.ts:76,80,84,88` |
| Log Coefficients Are Precomputed Once at Construction | yLogDomainMin/yLogScale/NaN/linear-exact-zero/zero-decade | `log-transform.test.ts:94,101,107` |
| Log Forward Projection Computes … | domainMin→yBase exactly, domainMax within 1 ULP, mid-domain between | `log-transform.test.ts:128,133,143` |
| Log Inverse Projection Is Total, Finite, Never NaN | inside/above/below/saturate+Inf/saturate+0/never-NaN sweep/zero-decade/±Infinity in | `log-transform.test.ts:212,221,228,236,243,251,257,264` |
| Log Round-Trip Error Is Bounded by a Relative, Not Absolute, Tolerance | wide domain, outside edges, helper rejects absolute impl | `log-transform.test.ts:279,292,300` |
| An Out-of-Domain Sample on a Log Axis Projects to a Non-Finite Coordinate | y<=0 → non-finite | `log-transform.test.ts:151` |
| `selectLogTicks` Writes Into a Caller Buffer … Transcendental-Free | basic contract, thinning, mantissas, sub-decade delegation, non-empty floor (both d3 cases), degenerate/invalid, zero-span, source scan, `selectTicks` untouched | `log-ticks.test.ts:9,19,24,29,38,44,51,64,70,78,99` |

### `multi-axis-viewport` (all ADDED requirements)

| Requirement | Scenario | Test |
|---|---|---|
| `YAxisRegistration` Is Plain, Frozen, DOM-Free Configuration | valid left-axis reg, no-DOM type fixture | `multi-axis.test.ts:37,51` |
| N `ViewportTransform` Instances From One Shared X Domain | positional correspondence, identical X fields | `multi-axis.test.ts:69,85` |
| All N Transforms Share Byte-Identical Plot Geometry | plotLeft identical, per-axis inset rejected structurally, one CSS→device conversion | `multi-axis.test.ts:108,123`, `axes.ts` signature (`SharedViewportOptions` has one `insetLeft`) confirmed by `core/test/**/export-surface.test.ts` type surface + `log-transform`/`multi-axis` structural fixtures |
| The Plot Area Shrinks Consistently When Axis Count Changes | shrink on 1→2 axes, zero-axis matches pre-existing, over-inset throws | `multi-axis.test.ts:132,152,158` |
| This Change Exposes Exactly the 5.7 Seam, No Trace-to-Axis Binding | no yAxisId field, no id→index map, `buildTracePath` unmodified | `multi-axis.test.ts:170,176`; `buildTracePath` signature untouched (git diff shows zero change to that file) |
| Per-Axis Gutter Arithmetic Lives in the Renderer, Never in Core | no font-metric-dependent gutter code in core | `multi-axis.test.ts:184` (structural), corroborated by zero `FigureStyle`/font references in `packages/core/src/viewport/axes.ts` |

### `viewport-transform` (MODIFIED requirements)

| Requirement | Scenario | Test |
|---|---|---|
| Frozen Flat Object, Not a Class | frozen, structuredClone (18 fields, `Object.is`), free functions, no DOM, shape-split key-order guard | `log-transform.test.ts:112,118`; pre-existing `transform.test.ts` (untouched, 45 tests, still passing) covers frozen/free-function/no-DOM |
| Allocation-Free, Closed `Math.*` Allow-List | linear zero-GC, log zero-GC, allocating control proves gate live, allow-list scan (3-part) | `transform-allocation.test.ts:130,135,172`; `log-transform.test.ts:177,187,192` |
| The Inverse Projection Is Total and Extrapolates | round-trips inside/outside, no clamp, never NaN | `log-transform.test.ts` (log path, above) + pre-existing `transform.test.ts` (linear path, untouched) |
| Degenerate Construction Inputs Throw RangeError | non-finite, dpr<=0, negative inset, insets>=canvas | pre-existing `transform.test.ts` (untouched) |
| GPU Consumer MUST Normalize in Float64 Before Float32 Cast | xOrigin/xDomainMin/xDomainMax stored without fround rounding, naive path >1pm, prescribed path <1pm | `gpu-precision.test.ts:5,23,57,65` |

### `canvas2d-axes-grid` (MODIFIED requirements)

| Requirement | Scenario | Test |
|---|---|---|
| Axis Layout Owns Plot-Area Insets, N Left-Stacked Axes | config-only, linear scaling with axis count, feeds all N transforms identically, recompute on setDomain, zero-axis matches pre-existing | `axes-grid.test.ts` (Phase 8/9 sections; `insetLeft` linear-scaling and zero-axis assertions present) |
| Tick Values from Core's `selectTicks`/`selectLogTicks`, Never Duplicated | renderer calls core functions not reimplementations, log axis uses selectLogTicks, linear uses selectTicks, fixed-capacity buffer | `axes-grid.test.ts` (per-axis dispatch tests, Phase 9.7/9.8) |
| `drawGrid`/`drawAxes` Iterate N Transforms | two axes each paint, single-axis call sequence unchanged | `axes-grid.test.ts:277` (single-axis explicit vs implicit equivalence), `:303` (two-axis paint-order) |
| Decade Gridlines Painted for a Log Axis | gridlines at projected decade tick positions | `axes-grid.test.ts` (9.5/9.6 section) |

### `visual-golden-corpus` (MODIFIED + ADDED)

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| A Golden Update Is Explicit/Reviewable | ordinary run never overwrites, separate update invocation, zero-diff on existing goldens | `canvas2d.visual.test.ts` | **not run here** — hard-skipped off Linux (see §6) |
| The Golden Corpus Includes a Log-Scale Y-Axis Figure | log-axis golden exists and compares | not yet added (task 11.3/11.4 unstarted) | **gap** |
| The Golden Corpus Includes a Dual-Y-Axis Figure | dual-axis golden exists and compares | not yet added (task 11.5/11.6 unstarted) | **gap** |

---

## 2. Independent re-verification of the two flagged deviations

### 2a. GC-gate warm-up raised from 20 to 500

Isolated reproduction: I temporarily reverted `transform-allocation.test.ts`'s warm-up loop from
500 back to 20 iterations (nothing else changed) and ran it directly:

```
pnpm exec vitest run --config vitest.config.ts --project core transform-allocation
```

Result at 20 iterations: **the pre-existing linear-path gate fails** —
`AssertionError: GC_MINOR: expected 1 to be +0` — while the log-path gate (also at the reduced
warm-up in this run, since it shares the helper) still passed. This is decisive: the *linear*
branch's code and arithmetic are byte-identical to before this change (confirmed by diff — see
§5), yet insufficient warm-up alone makes it flake. That rules out "the branched `projectY` needs
more warm-up" being a cover story for a genuine new allocation specifically on the log path — a
real per-call allocation in the log branch would not explain a linear-path failure. It is
consistent with exactly what the comment claims: the two-way ternary dispatch needs more calls to
deoptimize/reoptimize past inline-cache polymorphism before V8 settles, independent of which
branch executes.

I reverted the file to its committed state and confirmed `git diff` against the working tree shows
the original apply diff only (no residual edit from my probe), then reran the test twice
unmodified at 500 iterations — both passed cleanly (5/5, ~11s each), confirming stability, not a
one-off pass.

**Verdict: legitimate JIT warm-up artifact, not a masked allocation. The raise to 500 is correct.**

### 2b. GPU-precision fixture magnitude (50,000.123456 vs ~1550)

Verified by hand: float32 relative precision is `2^-24 ≈ 5.96e-8`. At the telecom-band magnitude
(~1550), the worst-case single-`fround` absolute error is `1550 × 5.96e-8 ≈ 9.24e-5 nm ≈ 0.092 pm`
— even doubled across two frounds (`xOrigin+xOffset` and `xDomainMin`), it cannot reach 1 pm. At
magnitude ~50,000 the same computation gives `50000 × 5.96e-8 ≈ 2.98e-3 nm ≈ 2.98 pm`, comfortably
past the 1 pm threshold the test needs to demonstrate. This matches the arithmetic the test file's
own comment states, and I confirmed it by running the naive-path assertion (`gpu-precision.test.ts`
lines 57–63) — it passes, i.e. the naive path's error genuinely exceeds 1 pm at this magnitude.
I also confirmed no fixture near 1550 could pass that same assertion (the arithmetic above proves
it structurally, not just for the one value chosen).

**Verdict: the magnitude change is a necessary correction to actually exercise the failure mode,
not a convenient escape from a hard assertion.** The prescribed-path assertion (independent of
origin magnitude, since it's governed by span, not absolute origin) also passes for both 100nm and
1500nm spans, matching D6's derivation.

---

## 3. `Math.*` allow-list — read directly, not re-quoted

Read `packages/core/src/viewport/transform.ts` lines 184–210 directly:

```ts
export function projectX(t, xOffset) {
  return t.plotLeft + (xOffset - t.xDomainMin) * t.xScale;   // zero Math.* — matches design
}
export function projectY(t, yValue) {
  return t.yScaleKind === Y_SCALE_KIND_LINEAR
    ? t.yBase - yValue * t.yScale                             // zero Math.* on linear branch — matches design
    : t.yBase - (Math.log10(yValue) - t.yLogDomainMin) * t.yLogScale;  // exactly one Math.log10 — matches design
}
export function unprojectX(t, devicePixelX) { /* zero Math.* */ }
export function unprojectY(t, devicePixelY) {
  if (linear) { /* zero Math.* */ }
  if (t.yLogScale === 0) return t.yDomainMin;
  return 10 ** ((t.yBase - devicePixelY) / t.yLogScale + t.yLogDomainMin);  // exactly one `10 **` — matches design
}
```

Cross-checked against design.md's exact table (`projectX`: none; `projectY` linear: none;
`projectY` log: exactly one `Math.log10`; `unprojectY` log: exactly one `10 ** x`). **Exact match,
nothing wider.** `selectLogTicks` in `ticks.ts` was separately confirmed to use only integer
multiply/divide decade-stepping (no `Math.log10`/`Math.pow` anywhere in its body, verified by the
`log-ticks.test.ts:78` source scan, which passes).

---

## 4. Positive controls found and confirmed live

| Gate | Positive control | Confirmed |
|---|---|---|
| Zero-GC gate (linear + log) | `runAllocatingControl` (pushes one object per point) asserted to report `> 0` GC events — `transform-allocation.test.ts:130` | passes; proves the instrument measures something before trusting its `0` result on the real code |
| Relative round-trip tolerance | `log-transform.test.ts:279` — a hypothetical absolute-error-modeling function is fed to the shared assertion helper and the helper is asserted to reject it | passes |
| `selectTicks`/`niceStep` regression guard | `log-ticks.test.ts:99` — archived inputs re-asserted to produce archived output | passes |
| Shape-split guard | `log-transform.test.ts:112` — `Object.keys` on a linear and a log transform asserted equal | passes |

Every gate in this change that could pass vacuously has a paired control proving it can fail.

---

## 5. Pre-existing linear-axis contract — no regression

`packages/core/test/viewport/transform.test.ts` (the pre-existing, archived test file — 45 tests
covering frozen construction, `structuredClone`, free-function exports, no-DOM, RangeError guards,
and inverse totality on the linear path) is **untouched by this change** — `git status --short`
against it returns empty. It still runs and passes:

```
pnpm exec vitest run --config vitest.config.ts --project core transform.test.ts
→ 2 files, 45 passed
```

Because the linear branch's source expression is byte-identical (`t.yBase - yValue * t.yScale`,
confirmed by direct read above) and the file asserting on it was never edited, this file passing
unmodified **is** the regression proof — a broken linear path would fail these exact archived
assertions, not merely a new equivalence check written for this change.

---

## 6. Phase 11 gap — re-confirmed independently

`uname -a` on this machine: `Darwin ... x86_64` (macOS), not Linux. `vitest.config.ts:102` defines
`__TRACEKIT_VISUAL_IS_LINUX_CI__: process.platform === "linux"` as a Vite `define`. In
`packages/renderers/test/visual/canvas2d.visual.test.ts:21`,
`runsWhereGoldensAreValid = __TRACEKIT_VISUAL_IS_LINUX_CI__` gates every visual test via
`it.skipIf(!runsWhereGoldensAreValid)`. On this machine that constant is `false`, so every visual
test — including the pre-existing zero-diff sweep (task 11.1) — is skipped, not run, not failed.
This is a pre-existing guard from the archived `visual-golden-corpus` capability; nothing in this
change altered it. Confirmed by direct read, not by trusting the prior report.

**What remains, in task order, for a Linux runner (`ubuntu-latest`):**
1. `11.1` — run the full visual suite and confirm every pre-existing single-linear-axis golden
   shows a zero pixel diff. This must be clean before touching anything else.
2. `11.2` — if 11.1 is not clean, it is a Phase 8–9 renderer regression to fix, never a golden to
   regenerate.
3. `11.3`/`11.4` — add the failing log-axis visual test case, then generate and commit its golden
   via the designated golden-update invocation (not the standard comparison run); confirm the
   standard run then passes.
4. `11.5`/`11.6` — same for the dual-axis (one log, one linear) fixture.
5. `11.7` — re-run the full zero-diff sweep one final time to confirm the two new fixtures did not
   disturb any existing golden's rendering path.
6. Then re-run `12.3` (full-workspace `pnpm run test`, this time including the visual suite for
   real) and close out `12.8`'s two remaining gaps (the two `visual-golden-corpus` ADDED
   requirements) in the compliance matrix above.

No other production code change is implied by this list — Phases 1–10 already implement
everything Phase 11 exercises visually.

---

## 7. Scope-exclusion grep

```
grep -rniE "symlog|yAxisId|AXIS_SIDE_RIGHT|logBase|base10Param|nonBase10" packages/core/src packages/renderers/src
```
One hit: `transform.ts:16` — `// Values >= 2 are reserved for future scale kinds (e.g. symlog) and
must not be assigned here.` This is documentation of the *reservation* (matching design.md's
explicit non-goal statement that `yScaleKind === 2` is reserved), not an implementation — no
`symlog` branch, constant, or behavior exists. No `yAxisId` field, no right-side-axis constant, no
non-base-10 log parameter found anywhere. **Confirmed: none of the excluded surface exists.**

---

## 8. House rules

- **No `any`/`as never`:** `grep -rnE ': any|as any|<any>|, any>|as never' packages/core/src
  packages/renderers/src` → zero matches, re-run independently (not re-citing the orchestrator's
  earlier grep).
- **No SDD artifact refs in code comments:** `grep -rniE 'design\.md|proposal\.md|tasks\.md|\bD[1-6]\b|C4b'`
  across `packages/core/src/viewport/*.ts`, `packages/renderers/src/canvas2d/*.ts`, and the new/
  modified test files → zero matches in production or test code. The only hits found were
  legitimate external references (`d3-scale/issues/44` URLs and the plain English phrase "d3-scale
  defect" in test names/comments), which are not SDD artifact citations.
- **`@trace-kit/core` isomorphic/DOM-free:** the new `axes.ts` and modified `transform.ts`/
  `ticks.ts` were read directly — no `document`, `window`, `HTMLCanvasElement`, or DOM reference in
  any of them; `computeAxisInsets`'s font-metric-dependent arithmetic correctly lives only in
  `packages/renderers/src/canvas2d/axes.ts`.

---

## 9. Commands run and real output

```
$ uname -a
Darwin MacBook-Pro-de-Nelo.local 25.5.0 ... x86_64

$ pnpm exec turbo run typecheck --filter=@trace-kit/core --filter=@trace-kit/renderers
✔ both pass, cache hit on renderers, fresh on core

$ pnpm exec vitest run --config vitest.config.ts --project core transform-allocation.test.ts
✔ 5 passed (5)   [re-run twice for stability, both green, ~11s each]

$ pnpm exec vitest run --config vitest.config.ts --project core transform.test.ts
✔ 2 files, 45 passed   [pre-existing archived linear-path suite, untouched by this change]

$ pnpm exec vitest run --config vitest.config.ts --project renderers --project renderers-dom
✔ 14 files, 67 passed

$ grep -rnE ': any|as any|<any>|, any>|as never' packages/core/src packages/renderers/src
(zero matches)

$ grep -rniE "symlog|yAxisId|AXIS_SIDE_RIGHT|logBase|base10Param|nonBase10" packages/core/src packages/renderers/src
packages/core/src/viewport/transform.ts:16: // Values >= 2 are reserved for future scale kinds (e.g. symlog) ...

$ grep -rniE 'design\.md|proposal\.md|tasks\.md|\bD[1-6]\b|C4b' <production+test files>
(zero matches beyond legitimate d3-scale URL/name references)
```

Isolated probe (reverted before finishing, confirmed clean via `git diff --stat`):
```
$ sed -i '' 's/for (let i = 0; i < 500/for (let i = 0; i < 20/' transform-allocation.test.ts
$ pnpm exec vitest run ... transform-allocation.test.ts
✘ 1 failed: linear-path gate — GC_MINOR: expected 1 to be +0
$ cp <backup> transform-allocation.test.ts   # restored
```

---

## 10. What remains before archive

Exactly what `sdd-apply` declared, independently re-confirmed here: **Phase 11 (tasks 11.1–11.7)**
on an `ubuntu-latest` (or equivalent pinned Linux) runner, followed by re-closing **12.3** (full
`pnpm run test` including the real visual comparison) and **12.8** (the two `visual-golden-corpus`
ADDED requirements in the compliance matrix). Everything else — all five delta specs' non-visual
requirements, both flagged deviations, the `Math.*` allow-list, the positive controls, the
unchanged linear-axis contract, the scope exclusions, and the house rules — is independently
confirmed compliant. Do not archive until Phase 11 closes; this is a documented, tracked gap, not a
silent one.
