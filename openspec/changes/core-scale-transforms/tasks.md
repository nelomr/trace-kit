# Tasks: core-scale-transforms

> Roadmap `order: 5.6`. Scope: `packages/core/src/viewport/**`, `packages/core/src/index.ts`,
> `packages/renderers/src/canvas2d/axes.ts`, `packages/renderers/src/canvas2d/canvas2d-renderer.ts`,
> `packages/renderers/src/index.ts`, `packages/core/test/node/**`, `packages/renderers/test/**`,
> `packages/renderers/test/visual/**` goldens, `openspec/roadmap.yaml`, `.changeset/`. No file
> under `packages/vue`, `packages/react`, `apps/docs` is created or touched; `apps/playground` is
> touched only if a manual smoke check surfaces a wiring gap (none is currently known).
>
> **Delivery: one PR, no size-driven split (delivery_strategy: exception-ok, confirmed).** See the
> Review Workload Forecast at the end for the honest line estimate; it is informational, not a
> trigger for chaining.
>
> **TDD sequencing.** Every GREEN implementation task is preceded by a RED task that adds a failing
> test first, run for real (not asserted in prose) before the paired GREEN task lands.
>
> **Comment discipline (binding on every task below, carried into `sdd-apply`).** A code comment
> written by any task in this file MUST explain the technical "why" directly — the numeric
> reasoning, the invariant being protected, the failure mode being avoided. It MUST NOT cite
> `design.md`, `proposal.md`, `tasks.md`, or a decision id (`D1`–`D6`) anywhere in production code.
> This file itself may reference decision ids for traceability; production comments may not.
>
> **`any` discipline.** No `: any`, `as any`, `<any>`, `Record<string, any>`, nor `as never` used
> to suppress a type error, anywhere in touched production code. Task 9.4 greps both the
> `: any|as any|<any>` pattern and the `, any>` pattern (the `Record<string, any>` form) separately,
> per CLAUDE.md.
>
> **Ordering constraint that governs every phase below.** The pre-existing linear-axis path and its
> committed visual goldens stay green from Phase 1 onward — no task sequence takes them red as an
> intermediate state. The zero-diff check on existing goldens (7.1) runs immediately after the
> renderer work that could regress it, not deferred to the end.

## 1. Core: discriminant constants, field layout, and the shape-split regression guard

> Files: `packages/core/src/viewport/transform.ts`,
> `packages/core/test/node/viewport-log-transform.test.ts`.
> Traces: `viewport-transform` MODIFIED — "`ViewportTransform` Is a Frozen Flat Object, Not a
> Class" (including the key-order scenario); `scale-logarithmic-transform` ADDED — "Y-Axis Scale
> Kind Is a Numeric, Reserved-Range Discriminant", "Log Coefficients Are Precomputed Once at
> Construction" (structural part).

- [x] 1.1 RED — `packages/core/test/node/viewport-log-transform.test.ts`: write failing tests —
      `Y_SCALE_KIND_LINEAR === 0` and `Y_SCALE_KIND_LOG === 1` are exported numeric constants;
      `createViewportTransform` with `yScaleKind: 2` throws `RangeError`; `yScaleKind: 0.5` throws
      `RangeError`; `yScaleKind: Y_SCALE_KIND_LOG` with `yDomainMin: 1, yDomainMax: 1000` succeeds
      and returns a frozen transform.
- [x] 1.2 GREEN — `packages/core/src/viewport/transform.ts`: export `Y_SCALE_KIND_LINEAR = 0` and
      `Y_SCALE_KIND_LOG = 1`; add the `Number.isInteger(yScaleKind) && yScaleKind >= 0 &&
      yScaleKind <= 1` construction guard throwing `RangeError` otherwise. Satisfies 1.1.
- [x] 1.3 RED — extend `viewport-log-transform.test.ts`: failing tests — `yScaleKind:
      Y_SCALE_KIND_LOG` with `yDomainMin: 0` throws `RangeError`; `yDomainMin: -5` throws
      `RangeError`; `yDomainMin: 0.001` does not throw; `yScaleKind: Y_SCALE_KIND_LINEAR` with
      `yDomainMin: -10` does not throw for that reason (archived linear behavior unaffected).
- [x] 1.4 GREEN — add the `yScaleKind === Y_SCALE_KIND_LOG && yDomainMin <= 0` construction guard
      throwing `RangeError`, evaluated before any field is computed. Satisfies 1.3.
- [x] 1.5 RED — extend `viewport-log-transform.test.ts`: failing tests — a transform constructed
      with `yScaleKind: Y_SCALE_KIND_LOG`, `yDomainMin: 100`, `yDomainMax: 100000` has
      `transform.yLogDomainMin === Math.log10(100)` and `transform.yLogScale === plotHeight /
      (Math.log10(100000) - Math.log10(100))`; `Number.isNaN(transform.yScale)` is `true` on that
      same transform; a linear transform has `transform.yLogDomainMin === 0` and
      `transform.yLogScale === 0` exactly (`Object.is`, not merely falsy); a zero-decade log domain
      (`yDomainMin: 50, yDomainMax: 50`) has `transform.yLogScale === 0`.
- [x] 1.6 GREEN — add `yScaleKind`, `yLogDomainMin`, `yLogScale` to the `ViewportTransform`
      interface in this exact insertion order immediately after `yBase`; compute them at
      construction per the coefficient table (`yScale = NaN` and `yBase = plotTop + plotHeight` on
      a log axis, folding `yDomainMin` out rather than into `yBase`); emit all three fields from
      the single object literal at the single `return Object.freeze({...})` site, unconditionally,
      including on a linear instance. Satisfies 1.5.
- [x] 1.7 RED — extend `viewport-log-transform.test.ts`: a failing test — construct one linear and
      one log `ViewportTransform`, call `Object.keys` on each, and assert the two key-order arrays
      are identical (this is the direct catch for the one mistake — conditionally omitting the log
      fields on a linear instance — that would split the V8 object shape and make the hot call site
      polymorphic).
- [x] 1.8 GREEN — confirm 1.6's single-object-literal implementation already satisfies 1.7 (no
      further change expected; if it fails, the fix is removing any conditional field omission, not
      adding one).
- [x] 1.9 RED — extend an existing `structuredClone` test (or add one) in
      `packages/core/test/node/viewport-log-transform.test.ts`: a failing test that a log-kind
      `ViewportTransform` survives `structuredClone` with all eighteen numeric fields, each compared
      via `Object.is` rather than `===`, so `Object.is(clone.yScale, original.yScale)` correctly
      passes for the `NaN` sentinel.
- [x] 1.10 GREEN — confirm 1.6 already satisfies 1.9 (no further change expected; `structuredClone`
      preserves `NaN` losslessly on a plain number field).

## 2. Core: log forward projection and the `Math.*` allow-list

> Files: `packages/core/src/viewport/transform.ts`,
> `packages/core/test/node/viewport-log-transform.test.ts`,
> `packages/core/test/node/*allocation*` (existing zero-GC gate file).
> Traces: `scale-logarithmic-transform` ADDED — "Log Forward Projection Computes …",
> "An Out-of-Domain Sample on a Log Axis Projects to a Non-Finite Coordinate, Not a Defect";
> `viewport-transform` MODIFIED — "Forward Projection Is Allocation-Free Per Point, With a Closed,
> Source-Scannable `Math.*` Allow-List" (both the source-scan and the per-`yScaleKind` GC parts).

- [x] 2.1 RED — extend `viewport-log-transform.test.ts`: failing tests against a `ViewportTransform`
      built with `yScaleKind: Y_SCALE_KIND_LOG`, `yDomainMin: 0.5`, `yDomainMax: 500` —
      `projectY(t, 0.5)` is exactly `t.yBase` (`Object.is`); `projectY(t, 500)` is within 1 ULP of
      `t.plotTop`; `projectY(t, 5)` lies strictly between `t.plotTop` and `t.yBase`, closer to
      `t.yBase` (one decade of a three-decade domain); `projectY(t, 0)` and `projectY(t, -3)` are
      both non-finite (`Number.isFinite` is `false`).
- [x] 2.2 GREEN — `packages/core/src/viewport/transform.ts`: implement `projectY`'s log branch as
      `t.yBase - (Math.log10(yValue) - t.yLogDomainMin) * t.yLogScale`, dispatched by a ternary on
      `t.yScaleKind === Y_SCALE_KIND_LINEAR`, keeping the linear branch's existing expression
      byte-identical. Satisfies 2.1.
- [x] 2.3 RED — extend `viewport-log-transform.test.ts`: a failing source-scan test — read the
      source of `projectY` from `packages/core/src/viewport/transform.ts`, scan every `Math.`
      member access, and assert the set is exactly `{log10}` with exactly one occurrence, whose
      syntactic position (string-index or AST check) lies within the branch of the conditional
      expression taken when `yScaleKind !== 0`. A second assertion in the same test scans `projectX`
      and asserts zero `Math.` member accesses anywhere. A third scans only the linear-branch
      substring of `projectY`'s conditional and asserts zero `Math.` member accesses within it.
- [x] 2.4 GREEN — confirm 2.2's implementation already satisfies the three-part scan in 2.3 (no
      further change expected; if it fails, the fix is relocating the `Math.log10` call, never
      adding a second `Math.*` call).
- [x] 2.5 RED — extend the existing zero-GC gate file (`packages/core/test/node/*allocation*`,
      matching the file that already gates `projectX`/`projectY` for the linear path): a failing
      `PerformanceObserver({ entryTypes: ["gc"] })` assertion, under `--expose-gc`, running the
      identical warmed-up 100,000-point loop shape as the existing linear-path gate, but against a
      `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LOG` — asserting zero GC events. This is a
      new parameterization of the existing gate (per `yScaleKind`), not a new gate; the existing
      linear-`yScaleKind` gate must still pass unmodified alongside it.
- [x] 2.6 GREEN — confirm `projectY`'s log branch (2.2) already reports zero GC events under 2.5 (no
      further change expected; `Math.log10` and the surrounding arithmetic allocate nothing). If
      the gate fails, remove the allocation before proceeding — do not weaken the assertion.

## 3. Core: log inverse projection — totality, saturation, and the relative round-trip bound

> Files: `packages/core/src/viewport/transform.ts`,
> `packages/core/test/node/viewport-log-transform.test.ts`.
> Traces: `scale-logarithmic-transform` ADDED — "Log Inverse Projection Is Total, Finite, and Never
> `NaN` for a Finite Input", "Log Round-Trip Error Is Bounded by a Relative, Not Absolute,
> Tolerance".

- [x] 3.1 RED — extend `viewport-log-transform.test.ts`: failing tests against a `ViewportTransform`
      with `yScaleKind: Y_SCALE_KIND_LOG`, `yDomainMin: 1`, `yDomainMax: 1000` (600px `plotHeight`)
      — a device pixel strictly inside `[plotTop, plotTop + plotHeight]` inverts to a finite value
      in `[1, 1000]`; a pixel one unit above `plotTop` inverts to a finite value strictly `> 1000`;
      a pixel one unit below `plotTop + plotHeight` inverts to a finite value strictly `> 0` and
      strictly `< 1`; a pixel far enough above `plotTop` that the true value exceeds
      `Number.MAX_VALUE` (~61,000px above `plotTop` for this domain) inverts to exactly `+Infinity`
      with `Number.isNaN(result) === false`; a pixel far enough below `plotTop + plotHeight` that the
      true value underflows below `Number.MIN_VALUE` inverts to exactly `+0` (`Object.is(result, 0)`
      is `true`, `Object.is(result, -0)` is `false`) with `Number.isNaN(result) === false`;
      `unprojectY(t, Number.POSITIVE_INFINITY)` returns exactly `+0` and
      `unprojectY(t, Number.NEGATIVE_INFINITY)` returns exactly `+Infinity`, neither `NaN`.
- [x] 3.2 GREEN — `packages/core/src/viewport/transform.ts`: implement `unprojectY`'s log branch —
      guard `t.yLogScale === 0` before any division, returning `t.yDomainMin`; otherwise compute
      `10 ** ((t.yBase - devicePixelY) / t.yLogScale + t.yLogDomainMin)` exactly per the design's
      enumerated arithmetic, dispatched by a check on `t.yScaleKind` before touching `t.yScale` at
      all (so the linear-path `yScale = NaN` sentinel can never leak into the log inverse).
      Satisfies 3.1.
- [x] 3.3 RED — extend `viewport-log-transform.test.ts`: a failing sweep test — call `unprojectY`
      across a range of finite device pixel values spanning from far above to far below the plot
      area (including values inside it) against a log-kind transform, and assert no call returns
      `NaN`; plus a failing test that a zero-decade log domain (`yDomainMin: 50, yDomainMax: 50`)
      inverts any arbitrary finite device pixel to exactly `50`, never `NaN`.
- [x] 3.4 GREEN — confirm 3.2's guarded implementation already satisfies 3.3 (no further change
      expected; the `yLogScale === 0` early return covers the zero-decade case and the arithmetic
      enumerated in 3.2 has no other `NaN`-producing shape).
- [x] 3.5 RED — extend `viewport-log-transform.test.ts`: a failing relative-tolerance round-trip
      test, written so an absolute-tolerance implementation cannot pass it. Write a shared
      assertion helper `assertRelativeRoundTrip(t, v)` that computes `unprojectY(t, projectY(t, v))`
      and asserts `Math.abs(result - v) / v <= 1e-9` — dividing by `v`, never comparing a bare
      difference against a fixed epsilon. Exercise it: (a) over a 12-decade domain
      (`yDomainMin: 1e-6, yDomainMax: 1e6`) at values sampled across every decade; (b) at `v` one
      decade below `yDomainMin` and one decade above `yDomainMax` on that same transform. Add one
      more failing test that is explicitly a test of the test: feed the assertion helper a
      hypothetical absolute-error implementation (a small local function modeling `1e-3` absolute
      error at `v = 1e6`) and assert the helper's relative check rejects it — proving the helper
      measures relative error, not absolute error, before it is trusted for the real implementation.
- [x] 3.6 GREEN — confirm 3.2's implementation satisfies the relative round-trip bound in 3.5 (no
      further change expected; the design's arithmetic derivation predicts ~1e-13 to ~1e-12
      observed relative error, well inside the asserted 1e-9 ceiling). If it fails, the fix is in
      the arithmetic ordering of 3.2 (e.g. an intermediate cast or reassociation), not in loosening
      the 1e-9 bound.

## 4. Core: `selectLogTicks`

> Files: `packages/core/src/viewport/ticks.ts`,
> `packages/core/test/node/viewport-log-ticks.test.ts`.
> Traces: `scale-logarithmic-transform` ADDED — "`selectLogTicks` Writes Into a Caller Buffer,
> Returns a Count, and Is Fully Transcendental-Free"; `viewport-transform` MODIFIED —
> "`selectTicks` itself is unmodified by this change" (regression guard, carried by this phase).

- [x] 4.1 RED — `packages/core/test/node/viewport-log-ticks.test.ts`: write failing tests —
      `selectLogTicks(1, 1000, 5, out, 0)` against a preallocated `Float64Array(32)` returns a
      count `n <= 32` with `out[0..n)` finite and ascending, covering `[1, 1000]`; a call with
      `domainMin: 0` (invalid log domain) returns `0`; `domainMin: 100, domainMax: 10` (inverted)
      returns `0`; `domainMin: 50, domainMax: 50` returns `1` with `out[outputOffset] === 50`.
- [x] 4.2 GREEN — `packages/core/src/viewport/ticks.ts`: implement `selectLogTicks(domainMin,
      domainMax, targetCount, out, outputOffset)` per the design's algorithm — capacity/invalid/
      degenerate/inverted guards (steps 1–4), the integer multiply/divide decade floor walk (step
      5, the same technique `niceStep` already uses), decade counting (step 6), thinning for many
      decades (step 7a), full-decade-plus-mantissa emission for few decades (step 7b), and
      delegation to `selectTicks` for a sub-decade span (step 7c). No array allocated to return
      values; writes only into `out`, never beyond `out.length`. Satisfies 4.1.
- [x] 4.3 RED — extend `viewport-log-ticks.test.ts`: failing tests for each decade-arithmetic case
      — `domainMin: 1e-3, domainMax: 1e6, targetCount: 5` returns exactly the decades `[1e-3, 1e-1,
      1e1, 1e3, 1e5]` (stride-2 thinning across 9 decades toward a target of 5); `domainMin: 1,
      domainMax: 100, targetCount: 12` with `out` capacity `>= 20` returns the ascending sequence
      `1, 2, 3, ..., 9, 10, 20, ..., 90, 100`, clamped to buffer capacity if smaller; `domainMin:
      286.9252014, domainMax: 329.4978332, targetCount: 5` returns the same values as
      `selectTicks(286.9252014, 329.4978332, 5, out, outputOffset)` called directly with identical
      arguments (the sub-decade delegation case).
- [x] 4.4 GREEN — confirm 4.2's step 7a/7b/7c logic already satisfies 4.3 (no further change
      expected beyond what step-faithful implementation in 4.2 already provides).
- [x] 4.5 RED — extend `viewport-log-ticks.test.ts`: a failing non-empty-floor test asserting
      `selectLogTicks` returns a count `>= 1` for the documented d3-scale defect domain `[42, 43]`
      (<https://github.com/d3/d3-scale/issues/44>) and for the narrow domain `[286.9252014,
      329.4978332]`, each with `targetCount: 5` and an output buffer of capacity `>= 1` — the exact
      two domains d3-scale's issue #44 documents as producing an empty or degenerate result.
- [x] 4.6 GREEN — implement step 8 (the unconditional non-empty floor): if the count accumulated by
      steps 5–7 is `0` and `capacity >= 1`, write `domainMin` at `out[outputOffset]` and return `1`.
      Satisfies 4.5. This is the load-bearing anti-defect guarantee named in the design; it MUST run
      after every other step, unconditionally.
- [x] 4.7 RED — extend `viewport-log-ticks.test.ts`: a failing source-scan test — read the source of
      `selectLogTicks` in `packages/core/src/viewport/ticks.ts` and assert neither `Math.log10` nor
      `Math.pow` appears anywhere in the function body, including in the sub-decade delegation
      branch (step 7c calls `selectTicks`, which is itself transcendental-free — the scan targets
      `selectLogTicks`'s own body, not its callee's).
- [x] 4.8 GREEN — confirm 4.2's integer-multiply/divide implementation already satisfies 4.7 (no
      further change expected; if it fails, the fix is replacing any `Math.log10`/`Math.pow` call
      with the equivalent integer stepping walk, never suppressing the scan).
- [x] 4.9 RED — extend `viewport-log-ticks.test.ts` (regression guard on the untouched function): a
      failing-then-passing check that `selectTicks`, called with the same inputs used by its
      archived test suite, produces output identical to its pre-change behavior — a direct
      assertion that this phase did not alter `selectTicks` or `niceStep`.
- [x] 4.10 GREEN — confirm `selectTicks`/`niceStep` in `packages/core/src/viewport/ticks.ts` are
      untouched by 4.2 (no further change expected; `selectLogTicks` is an additive export in the
      same file).

## 5. Core: `YAxisRegistration` and `createAxisTransforms`

> Files: `packages/core/src/viewport/axes.ts` (new),
> `packages/core/test/node/viewport-multi-axis.test.ts`.
> Traces: `multi-axis-viewport` ADDED — all six requirements.

- [x] 5.1 RED — `packages/core/test/node/viewport-multi-axis.test.ts`: write failing tests —
      `AXIS_SIDE_LEFT === 0` is an exported numeric constant; a `YAxisRegistration` with `id:
      "power-mw"`, `scaleKind: Y_SCALE_KIND_LOG`, `domainMin: 1e-3`, `domainMax: 1e3`, `side:
      AXIS_SIDE_LEFT` passed to `createAxisTransforms` is accepted and produces a corresponding
      `ViewportTransform`; a type-level fixture confirms `YAxisRegistration`'s fields are all
      `string` or `number` (no DOM type, font metric, or style object compiles into any field).
- [x] 5.2 GREEN — `packages/core/src/viewport/axes.ts` (new file): export `AXIS_SIDE_LEFT = 0` and
      the `YAxisRegistration` interface (`id: string`, `scaleKind: number`, `domainMin: number`,
      `domainMax: number`, `side: number`) exactly per the design. Satisfies 5.1.
- [x] 5.3 RED — extend `viewport-multi-axis.test.ts`: failing tests — `createAxisTransforms(shared,
      axes, out)` called with two registrations (index 0 a log axis, index 1 a linear axis) and a
      pre-sized `out` returns `2`; `out[0]` is a `ViewportTransform` with `yScaleKind ===
      Y_SCALE_KIND_LOG` matching `axes[0]`'s domain; `out[1]` has `yScaleKind ===
      Y_SCALE_KIND_LINEAR` matching `axes[1]`'s domain; `out[0]` and `out[1]`'s `xDomainMin`,
      `xDomainMax`, `xOrigin`, `xScale`, `deviceWidth`, `deviceHeight`, `dpr` are equal by
      `Object.is`.
- [x] 5.4 GREEN — implement `createAxisTransforms(shared, axes, out): number`: for each
      `axes[i]`, call `createViewportTransform` with the shared X fields/insets and that
      registration's `scaleKind`/`domainMin`/`domainMax` as the Y domain, write the result into
      `out[i]`, and return the count written. Cold-path only (no per-frame invocation implied by
      this signature). Satisfies 5.3.
- [x] 5.5 RED — extend `viewport-multi-axis.test.ts`: failing tests — with three registrations and
      a shared `insetLeft` that already sums all three gutters, `out[0].plotLeft ===
      out[1].plotLeft === out[2].plotLeft`, and correspondingly for `plotTop`, `plotWidth`,
      `plotHeight`; a shared CSS-pixel `insetLeft` (the sum of two gutters) with `dpr: 2` produces
      `plotLeft` equal to the summed CSS `insetLeft * 2` exactly once per transform — not each
      gutter multiplied by `dpr` and then summed as device pixels.
- [x] 5.6 GREEN — confirm 5.4's implementation (passing the same `shared.insetLeft` unchanged to
      every one of the N `createViewportTransform` calls) already satisfies 5.5 — the shared-plot-
      geometry invariant follows directly from calling `createViewportTransform` with one shared
      inset value; no further change expected. If it fails, the fix is removing any per-axis inset
      computation from `createAxisTransforms`, never adding one.
- [x] 5.7 RED — extend `viewport-multi-axis.test.ts`: a failing API-surface test — inspect the
      `createAxisTransforms` type signature (a type-level fixture) and assert there is no parameter
      or code path accepting a distinct `insetLeft` per axis — `shared` carries exactly one
      `insetLeft`, structurally, not merely by convention.
- [x] 5.8 GREEN — confirm 5.2/5.4's `SharedViewportOptions` shape (one `insetLeft` field) already
      satisfies 5.7 (no further change expected).
- [x] 5.9 RED — extend `viewport-multi-axis.test.ts`: failing tests — reconfiguring from one left
      axis to two and recomputing `insetLeft`/rerunning `createAxisTransforms` produces a smaller
      `plotWidth` than the one-axis case, identical across both resulting transforms;
      `yAxisCount: 0` with `showLeftAxis: false` yields `insetLeft === 0`; a registered-axis count
      large enough to drive `insetLeft + insetRight >= cssWidth` throws `RangeError` via the
      existing `createViewportTransform` construction guard (no new validation).
- [x] 5.10 GREEN — confirm 5.4 (which delegates every per-axis construction to unmodified
      `createViewportTransform`) already satisfies 5.9's guard-reuse and shrink behavior (no
      further change expected; this task exists to run the assertion, not to write new
      production code).
- [x] 5.11 RED — extend `viewport-multi-axis.test.ts`: failing tests — inspect every trace-related
      type shipped by `@trace-kit/core` after this change and assert none contains a `yAxisId`
      field or equivalent axis-binding property; inspect `packages/core/src/viewport/axes.ts`'s
      exports and assert no exported function or data structure maps a `YAxisRegistration.id` to an
      index (the only correspondence is the positional `out[i] <-> axes[i]` one); compare
      `buildTracePath`'s signature before and after this change (a snapshot or type-level fixture)
      and assert it is unchanged — still a single `ViewportTransform` plus `projectX`/`projectY` by
      reference, no added axis-selection parameter.
- [x] 5.12 GREEN — confirm 5.2/5.4 introduced no `yAxisId` field, no id-to-index lookup map, and no
      change to `buildTracePath`'s signature (no further change expected; this phase is additive
      and touches no existing trace type or `buildTracePath`). If 5.11 fails, remove whatever
      addition caused it — this task never adds new surface to pass the test.
- [x] 5.13 RED — extend `viewport-multi-axis.test.ts`: a failing source-scan test — scan
      `packages/core/src/viewport/**` for font-metric or style-dependent gutter-width computation
      and assert none exists; assert `createAxisTransforms` accepts only an already-summed numeric
      `insetLeft` in `shared` and computes no individual per-axis gutter width itself.
- [x] 5.14 GREEN — confirm 5.2/5.4 already satisfy 5.13 (no further change expected; per-axis gutter
      arithmetic is built in Phase 6, in `packages/renderers`, never in core).
- [x] 5.15 MODIFY — `packages/core/src/viewport/index.ts`: add `axes.ts` to the barrel.
- [x] 5.16 MODIFY — `packages/core/src/index.ts`: re-export `Y_SCALE_KIND_LINEAR`,
      `Y_SCALE_KIND_LOG`, `AXIS_SIDE_LEFT`, `YAxisRegistration`, `createAxisTransforms`,
      `selectLogTicks` from `./viewport/index.js`, following the existing grouped type-then-value
      export style. The three new `ViewportTransform` fields need no separate export statement
      (the interface itself is already re-exported).
- [x] 5.17 RED — `packages/core/test/**` (extend the existing export-surface test): a failing
      assertion that `@trace-kit/core`'s public surface exports `Y_SCALE_KIND_LINEAR`,
      `Y_SCALE_KIND_LOG`, `AXIS_SIDE_LEFT`, `createAxisTransforms`, and `selectLogTicks` by name.
- [x] 5.18 GREEN — confirm 5.16 satisfies 5.17.

## 6. Core: GPU precision anti-regression and error-comparison tests

> Files: `packages/core/test/node/viewport-gpu-precision.test.ts` (new).
> Traces: `viewport-transform` MODIFIED — "A GPU Consumer of X-Domain Values MUST Normalize in
> Float64 Before Any Float32 Cast" (only the two scenarios testable from `@trace-kit/core`; the
> third obligation on change 7's GLSL is explicitly out of scope here — see the note at the end of
> this file).

- [x] 6.1 RED — `packages/core/test/node/viewport-gpu-precision.test.ts` (new): failing tests — a
      `ViewportTransform` constructed with `xOrigin: 1550.123456` has `Math.fround(t.xOrigin) !==
      t.xOrigin`; the same transform constructed with `xDomainMin: 1550.123456, xDomainMax:
      1550.987654` has `Math.fround(t.xDomainMin) !== t.xDomainMin` and
      `Math.fround(t.xDomainMax) !== t.xDomainMax`.
- [x] 6.2 GREEN — confirm `createViewportTransform` (unchanged by this task — `xOrigin`,
      `xDomainMin`, `xDomainMax` are already stored as plain f64 numbers today) already satisfies
      6.1. This is a pure anti-regression assertion; no production code is expected to change. If
      it fails, the regression is in whatever code path introduced an f32 round-trip into
      construction, and that is the bug to fix — never loosen the assertion.
- [x] 6.3 RED — extend `viewport-gpu-precision.test.ts`: a failing test modeling the naive
      individual-float32-cast normalization — given `xOrigin: 1550.0`, an `xOffset` of a few
      nanometres, and `xDomainMin`/`xDomainMax` describing a visible span, compute
      `Math.fround(xOrigin + xOffset) - Math.fround(xDomainMin)` and assert its absolute error
      against the exact f64 computation of `xOrigin + xOffset - xDomainMin` exceeds 1 picometre.
- [x] 6.4 GREEN — this is a test of arithmetic properties, not of production code; no
      `packages/core/src` change is expected. Confirm the computed error does in fact exceed 1
      picometre as asserted (proves the obligation D6 documents is not theoretical). If the
      computed error does not exceed 1pm, the test's numeric fixture (span/offset magnitude) needs
      adjustment to actually exercise the failure mode — not the assertion.
- [x] 6.5 RED — extend `viewport-gpu-precision.test.ts`: a failing test modeling the prescribed
      float64-normalize-then-cast path — using the same `xOrigin`/`xOffset`/`xDomainMin`/
      `xDomainMax` values, evaluated over both a 100 nm span and a 1500 nm span, compute
      `Math.fround((xOrigin + xOffset - xDomainMin) / (xDomainMax - xDomainMin))` and assert its
      absolute error against the exact f64 computation, mapped back to nanometres, stays below 1
      picometre for both spans.
- [x] 6.6 GREEN — confirm the prescribed arithmetic in 6.5 does in fact stay under 1pm for both
      spans (no production code change expected; this proves the prescribed arithmetic is
      sufficient, complementing 6.4's proof that it is necessary). Record explicitly in this task's
      completion note: whether change 7's actual WebGL2 GLSL/buffer-upload code obeys this contract
      is NOT verified by this test and is out of scope for this change (see the note at the end of
      this file).

## 7. Core verification checkpoint

> Runs before renderer work begins, so a defect in the projection/tick layer is caught before it
> propagates into the renderer's per-axis wiring.

- [x] 7.1 Run `pnpm exec turbo run typecheck --filter=@trace-kit/core` and confirm it passes with no
      `any`-shaped escape hatch introduced.
- [x] 7.2 Run `pnpm exec turbo run lint --filter=@trace-kit/core` and confirm it passes.
- [x] 7.3 Run `pnpm run test --filter=@trace-kit/core` (or the equivalent `vitest` project filter)
      and confirm every viewport test passes, including both zero-GC gates (linear and log), the
      relative round-trip tests, the non-empty-floor tests, and the multi-axis tests.
- [x] 7.4 Grep `packages/core/src/**` for `document`, `window`, `HTMLCanvasElement`,
      `OffscreenCanvas`, `getContext` and confirm zero matches (CLAUDE.md rule 5, re-asserted since
      this phase adds a new file, `axes.ts`).
- [x] 7.5 Grep `packages/core/src/**` for `: any|as any|<any>` and separately for `, any>` (the
      `Record<string, any>` form) and for `as never`; confirm zero matches, including in the new
      `axes.ts` and the modified `transform.ts`/`ticks.ts`.
- [x] 7.6 Confirm every requirement in `scale-logarithmic-transform` and `multi-axis-viewport`, and
      the MODIFIED requirements in `viewport-transform` this phase touches, is exercised by at
      least one passing test from Phases 1–6, cross-checking against each spec's `#### Scenario`
      blocks. Record any gap found before proceeding to Phase 8.

## 8. Renderers: per-axis gutter arithmetic and N-axis inset stacking

> Files: `packages/renderers/src/canvas2d/axes.ts`, `packages/renderers/test/node/axes-grid.test.ts`.
> Traces: `canvas2d-axes-grid` MODIFIED — "The Axis Layout Owns the Plot-Area Insets, Generalized to
> N Left-Stacked Axes"; `multi-axis-viewport` ADDED — "Per-Axis Gutter Arithmetic Lives in the
> Renderer, Never in Core" (the renderer-side half).

- [x] 8.1 RED — `packages/renderers/test/node/axes-grid.test.ts` (extend the existing file): failing
      tests — `computeAxisInsets(style, axes, yAxisCount)` called with `yAxisCount: 1` and again
      with `yAxisCount: 2` (same style/layout, `showLeftAxis: true`) produces an `insetLeft` for
      `yAxisCount: 2` that is exactly twice the `yAxisCount: 1` result; `yAxisCount: 0` yields
      `insetLeft === 0`, identical to the pre-change single-axis-absent behavior; two payloads with
      different data but the same style/layout/`yAxisCount` produce identical computed insets
      (pure-function-of-configuration check).
- [x] 8.2 GREEN — `packages/renderers/src/canvas2d/axes.ts`: widen `computeAxisInsets`'s signature
      to `computeAxisInsets(style: FigureStyle, axes: AxisLayout, yAxisCount: number): AxisInsets`,
      computing `insetLeft` as `axes.showLeftAxis ? yAxisCount * (tickLength + labelGutter +
      fontSizeCss) : 0`; `insetRight`/`insetTop` remain `0`; `insetBottom` unchanged from the
      archived single-axis formula. Update every call site (`Canvas2DRenderer.#computeTransform`)
      to pass the current registered left-axis count. Satisfies 8.1.
- [x] 8.3 RED — extend `axes-grid.test.ts`: failing tests — a renderer configured with a known
      style/layout and two registered left axes, after `resize`, has `transform[0].plotLeft ===
      transform[1].plotLeft === computedInsetLeft * dpr`; a renderer with per-axis visibility that
      could change formatted label width, after `setDomain`, re-runs inset computation and every
      transform reflects the recomputed insets (not stale from construction).
- [x] 8.4 GREEN — confirm 8.2's `computeAxisInsets` widening, invoked from both `resize` and
      `setDomain` (Phase 9's renderer wiring), satisfies 8.3 once Phase 9 lands; this task may stay
      a checkpoint until Phase 9's renderer changes are in place — re-run this test after Phase 9
      and mark this task complete only then.

## 9. Renderers: N-transform storage and per-axis rendering in `Canvas2DRenderer`

> Files: `packages/renderers/src/canvas2d/canvas2d-renderer.ts`,
> `packages/renderers/test/node/axes-grid.test.ts`, `packages/renderers/test/node/work-counts.test.ts`.
> Traces: `canvas2d-axes-grid` MODIFIED — "The Axis Layout Owns the Plot-Area Insets…" (the
> renderer-wiring half), "`drawGrid`/`drawAxes` Iterate N Transforms, One Per Registered Y Axis"
> (byte-identical-single-axis scenario, load-bearing for the zero-diff-golden guarantee).

- [x] 9.1 RED — `packages/renderers/test/node/axes-grid.test.ts` (extend): a failing test that a
      renderer configured with exactly one left Y axis (`yScaleKind: Y_SCALE_KIND_LINEAR`,
      `yAxisCount: 1`) produces a recorded call sequence — method names and arguments — on a fake
      `TraceDrawingContext`, for a fixed payload and transform, that is byte-identical to the
      pre-change (pre-multi-axis) single-axis call sequence captured as a snapshot fixture. This is
      the direct regression guard for the zero-diff-golden requirement, run at the unit level
      before any golden is touched.
- [x] 9.2 GREEN — `packages/renderers/src/canvas2d/canvas2d-renderer.ts`: introduce the single-axis-
      through-N-axis data model — `Canvas2DRenderer` holds an array of registered Y axes (defaulting
      to today's implicit one left linear axis when no explicit registration is supplied, so the
      existing single-axis constructor usage is unchanged) and an array of `ViewportTransform`
      instances produced via `createAxisTransforms`, replacing the single `#transform` field's
      construction path with the N-instance one while `transform` (the public getter) continues to
      return `out[0]` for the default single-axis case. `#computeTransform` becomes
      `#computeTransforms`, calling `computeAxisInsets(style, axes, yAxisCount)` (Phase 8) and
      `createAxisTransforms` (Phase 5) instead of a single `createViewportTransform` call. Satisfies
      9.1 for the default single-axis path — the recorded call sequence must not change shape for
      `yAxisCount === 1`.
- [x] 9.3 RED — extend `axes-grid.test.ts`: a failing test — a renderer configured with two
      registered Y axes, one log and one linear, produces a `render()` call sequence including
      gridline and axis-label calls attributable to each of the two transforms, both occurring
      within the single fixed background/gridlines/trace/axes paint order for the whole call (not
      interleaved per axis with the trace).
- [x] 9.4 GREEN — `packages/renderers/src/canvas2d/axes.ts`: widen `drawGrid`/`drawAxes` to accept
      (or be called once per) each registered axis's `ViewportTransform`, called from `render()` in
      a loop over the N axes, still within the fixed background → gridlines(all axes) → trace →
      axes(all axes) order fixed by the archived paint-order requirement for the whole render pass.
      Satisfies 9.3.
- [x] 9.5 RED — extend `axes-grid.test.ts`: a failing test — for a log-axis `ViewportTransform` and
      its `selectLogTicks` output, gridline painting issues one gridline call per returned tick
      value, at the device-pixel Y position `projectY(transform, tickValue)`.
- [x] 9.6 GREEN — implement decade-gridline painting for a log axis using the same gridline call
      shape as the linear path (no separate gridline-drawing function for log axes) — the loop
      already built in 9.4 iterates `selectLogTicks`'s output for a log-kind axis instead of
      `selectTicks`'s. Satisfies 9.5.
- [x] 9.7 RED — extend `axes-grid.test.ts`: failing tests — `packages/renderers/src/canvas2d/axes.ts`
      imports both `selectTicks` and `selectLogTicks` from `@trace-kit/core` and contains no
      independently implemented nice-number or logarithmic tick-selection loop; a per-axis
      `ViewportTransform` with `yScaleKind: Y_SCALE_KIND_LOG` causes the renderer to call
      `selectLogTicks`, not `selectTicks`, for that axis; a per-axis transform with `yScaleKind:
      Y_SCALE_KIND_LINEAR` causes the renderer to call `selectTicks`, matching archived pre-change
      behavior exactly; the tick-value `Float64Array` storage is allocated once (construction or
      `resize`) at fixed `MAX_TICKS` capacity per axis, not reallocated per `render()` call per
      axis.
- [x] 9.8 GREEN — implement per-axis tick-kind dispatch in `Canvas2DRenderer`'s tick-recompute path
      (`#recomputeTicksIfStale`, widened to iterate N axes): select `selectTicks` or
      `selectLogTicks` per axis based on that axis's `ViewportTransform.yScaleKind`, writing into a
      per-axis preallocated `Float64Array(MAX_TICKS)` held on the renderer instance (not
      reallocated per render). Satisfies 9.7.
- [x] 9.9 GREEN (re-run) — re-run 8.3/8.4 now that Phase 9's renderer wiring exists; confirm
      `computeAxisInsets` runs from both `resize` and `setDomain` against the new N-axis storage and
      that a per-axis visibility change re-triggers inset recomputation correctly.
- [x] 9.10 MODIFY — `packages/renderers/src/index.ts`: export `YAxisRegistration`-consuming public
      types introduced by this renderer wiring, if any new type is added to the renderer's own
      public surface (e.g. a renderer-level axis-registration option type); confirm
      `Canvas2DRendererOptions` (already exported) reflects any widened shape with no missing
      export.

## 10. Renderers verification checkpoint (unit level, before golden work)

> This checkpoint exists specifically to catch a linear-path regression before it reaches the
> golden comparison in Phase 11 — cheaper to bisect here than after a pixel diff.

- [x] 10.1 Run `pnpm exec turbo run typecheck --filter=@trace-kit/renderers` and confirm it passes.
- [x] 10.2 Run `pnpm exec turbo run lint --filter=@trace-kit/renderers` and confirm it passes.
- [x] 10.3 Run `pnpm run test --filter=@trace-kit/renderers` (both the `renderers` node project and
      the `renderers-dom` happy-dom project) and confirm all tests pass, including the
      byte-identical single-axis call-sequence test (9.1) and the two-axis paint-order test (9.3).
- [x] 10.4 Confirm test 9.1 specifically passed in this run — it is the unit-level proxy for the
      zero-diff-golden guarantee Phase 11 checks at the pixel level; a failure here must be fixed
      before any golden is touched, never worked around by regenerating a golden.

## 11. Visual goldens: zero-diff regression, then new log/dual-axis fixtures

> Files: `packages/renderers/test/visual/canvas2d.visual.test.ts`, golden image directory under
> `packages/renderers/test/visual/**`.
> Traces: `visual-golden-corpus` MODIFIED — "A Golden Update Is an Explicit, Reviewable Act,
> Including for Existing Single-Linear-Axis Goldens" (the zero-diff scenario, run first); ADDED —
> "The Golden Corpus Includes a Log-Scale Y-Axis Figure", "The Golden Corpus Includes a Dual-Y-Axis
> Figure".

- [x] 11.1 Run the existing visual test suite (`pnpm run test:visual` or the repository's designated
      CI-only visual invocation, on `ubuntu-latest` or an equivalent pinned environment) against
      every pre-existing single-linear-axis golden and confirm each reports a pixel diff of exactly
      zero. This is the explicit, early regression gate the `visual-golden-corpus` delta requires —
      run it now, before any new fixture is added, so a linear-path regression is caught here, not
      discovered later mixed in with new-golden noise.
- [ ] 11.2 If 11.1 reports any non-zero diff on a pre-existing golden: this is a regression to
      investigate and fix in Phases 8–9's renderer changes, never a golden to regenerate. Do not
      proceed to 11.3 until 11.1 is clean.
- [x] 11.3 RED — `packages/renderers/test/visual/canvas2d.visual.test.ts` (extend): add a new,
      initially-failing (no golden yet committed) test case rendering a single Y axis with
      `yScaleKind: Y_SCALE_KIND_LOG`, including its decade gridlines and axis labels, under the
      same CI-only, single-Linux-corpus, no-LFS rules as every other case in this file; the test
      skips with an explicit message on any non-`ubuntu-latest` platform, matching the archived
      platform-skip requirement.
- [ ] 11.4 GREEN — via the golden corpus's own designated, separate golden-update invocation (never
      the standard comparison run), generate and commit the log-axis golden image. Confirm the
      standard comparison run then passes 11.3 against the newly committed golden. Satisfies 11.3.
- [x] 11.5 RED — extend `canvas2d.visual.test.ts`: add a new, initially-failing test case rendering
      two independent, left-stacked Y axes sharing one X domain (one linear and one log, or two
      differing scale kinds) with correctly stacked left gutters, under the same CI-only rules.
- [ ] 11.6 GREEN — via the same designated golden-update invocation, generate and commit the
      dual-axis golden image. Confirm the standard comparison run then passes 11.5. Satisfies 11.5.
- [ ] 11.7 Re-run 11.1 (the full zero-diff sweep over every pre-existing single-linear-axis golden)
      one final time now that the two new fixtures exist, confirming the new fixtures did not
      disturb any existing golden's rendering path (e.g. through a shared insets or tick-cache
      change).

## 12. Full-workspace verification, roadmap correction, and release bookkeeping

- [x] 12.1 Run `pnpm exec turbo run typecheck` (full workspace) and confirm it passes.
- [x] 12.2 Run `pnpm exec turbo run lint` (full workspace) and confirm it passes.
- [~] 12.3 Run `pnpm run test` (full workspace) and confirm all projects pass, including the visual
      suite's goldens (zero-diff on existing, real comparison on the two new fixtures on
      `ubuntu-latest`).
- [x] 12.4 Run `pnpm exec turbo run build` (full workspace) and confirm `@trace-kit/core` and
      `@trace-kit/renderers` both build without error.
- [x] 12.5 Run the CLAUDE.md-mandated `any`-grep check across `packages/core/src/**` and
      `packages/renderers/src/**`: `grep -rnE ': any|as any|<any>'` and separately `grep -rnE ',
      any>'` (the `Record<string, any>` form), plus a check for `as never`. Confirm zero matches in
      both packages, including every file touched by this change.
- [x] 12.6 MODIFY — `openspec/roadmap.yaml`: drop `scale-linear-transform` from `order: 5.6`'s
      intended surface, per the proposal's stated correction (the linear scale already ships; this
      change's actual surface is the log scale, multi-axis, and the generalized projection layer).
- [x] 12.7 NEW — `.changeset/*.md`: one changeset with a `patch` bump for `@trace-kit/core` (viewport
      generalization: log scale, multi-axis) and a `patch` bump for `@trace-kit/renderers` (N-axis
      rendering, decade gridlines), per CLAUDE.md rule 8's low-velocity versioning policy.
- [~] 12.8 Confirm every requirement across all five delta specs (`scale-logarithmic-transform`,
      `multi-axis-viewport`, `viewport-transform`, `canvas2d-axes-grid`, `visual-golden-corpus`) is
      exercised by at least one passing test from Phases 1–11, cross-checking against each spec's
      `#### Scenario` blocks. Record any gap found and file a follow-up task before considering the
      change verifiable — do not archive with a known gap.

---

## Verification

```
pnpm exec turbo run typecheck
pnpm exec turbo run lint
pnpm run test
pnpm exec turbo run build
```

## Explicitly not built here

Per `multi-axis-viewport`'s stated exclusion and `viewport-transform`'s D6 GPU-precision
requirement: this change builds no `yAxisId` field, no id-to-index lookup map, and no trace-to-axis
binding (roadmap order 5.7, a later change). It states the GPU normalization obligation on X-domain
values and proves it CPU-side (Phase 6), but does not and cannot verify that a WebGL2 consumer's
actual GLSL and buffer-upload code obeys it — that conformance is an acceptance criterion of the
WebGL2 renderer change (roadmap order 7) that consumes this contract, not of this change. No task
in this file claims to verify change 7's shader compliance.

---

## Review Workload Forecast

| Phase | Files touched (new + modified) | Est. changed lines (incl. tests) |
|---|---|---|
| 1–3 (core: log transform) | 1 modified src (`transform.ts`), 1 new test file | ~320 |
| 4 (core: `selectLogTicks`) | 1 modified src (`ticks.ts`), 1 new test file | ~180 |
| 5 (core: multi-axis) | 1 new src (`axes.ts`), 1 new test file, 2 modified barrels | ~230 |
| 6 (core: GPU precision) | 0 modified src, 1 new test file | ~90 |
| 7 (core verify) | 0 new, verification only | 0 |
| 8–9 (renderers: axes/grid/renderer wiring) | 2 modified src (`axes.ts`, `canvas2d-renderer.ts`), 2 extended test files | ~260 |
| 10 (renderers verify) | 0 new, verification only | 0 |
| 11 (goldens) | 1 extended visual test file, 2 new golden images (binary, not line-counted) | ~60 (test code only) |
| 12 (final verify + release) | 1 modified `roadmap.yaml`, 1 new changeset | ~15 |
| **Total** | **~10 files touched (text), plus 2 binary golden images** | **~1,155 lines** |

**Delivered as one PR (delivery_strategy: exception-ok, confirmed up front).** ~1,155 lines is well
past the repository's usual 400-line review-focus guidance, driven mainly by the log-inverse
totality/saturation enumeration (Phase 3) and the tick-selection decade arithmetic (Phase 4), both
of which carry proportionally large test suites because they are the two highest-severity,
no-prior-art pieces of this change (design.md Risk #1 and #6) — thinner test coverage there is the
wrong place to economize. No split is recommended per the confirmed delivery strategy; the phase
boundaries above (core → renderers → goldens → release) remain available as natural resume points
for `sdd-apply` even though they are not being used to chain separate PRs.

## Requirement traceability gaps

None. Every task above is traceable to a named requirement and `#### Scenario` in one of the five
delta specs, cross-checked during drafting against `specs/scale-logarithmic-transform/spec.md`,
`specs/multi-axis-viewport/spec.md`, `specs/viewport-transform/spec.md`,
`specs/canvas2d-axes-grid/spec.md`, and `specs/visual-golden-corpus/spec.md`. The one requirement
sentence that is *not* independently testable from this change — whether a future WebGL2 consumer's
GLSL and buffer-upload code obeys the D6 normalization contract — is called out explicitly in
"Explicitly not built here" above and in tasks 6.6/12.8 rather than covered by a task that would
falsely claim to verify it; `viewport-transform`'s own MODIFIED delta states this limitation as
part of the requirement text itself, so this is not a silent gap but a documented one.

## Key Learnings

1. `packages/core/src/viewport/transform.ts` today defines `ViewportTransform` with exactly fifteen
   `readonly number` fields and a single-expression `projectY` (`t.yBase - yValue * t.yScale`), with
   no `yScaleKind`, `yLogDomainMin`, or `yLogScale` field present — confirming design.md's premise by
   direct inspection of the pre-change file.
2. `packages/core/src/viewport/ticks.ts`'s `selectTicks` and `niceStep` already avoid all
   transcendental calls via an integer multiply/divide magnitude-stepping loop, which is the exact
   technique `selectLogTicks`'s decade-floor walk (design.md D4, step 5) reuses rather than
   introducing `Math.log10`/`Math.pow`.
3. `packages/renderers/src/canvas2d/axes.ts`'s current `computeAxisInsets(style, axes)` takes no
   axis-count parameter and computes a single fixed `insetLeft`/`insetBottom` pair, confirming the
   signature widening to `computeAxisInsets(style, axes, yAxisCount)` (Phase 8) is additive to the
   parameter list, not a restructuring of the existing formula.
4. `packages/renderers/src/canvas2d/canvas2d-renderer.ts` already threads a `DecimationSelection`
   pattern (a caller-owned selection object, resolved and memoized lazily, never drawn on the
   selection call itself) from a prior change (`renderers-canvas2d`'s `selectable-decimation`
   widening) — the N-axis storage this change adds (Phase 9) follows the same
   store-now/resolve-at-render idiom already established in that file.
5. The archived `renderers-canvas2d` change's `tasks.md` demonstrates the house style this file
   follows: numbered `## N. <Group>` phases traced to specific requirement names, strict RED-before-
   GREEN task pairs (including "confirm already satisfies, no further change expected" GREEN tasks
   when an earlier implementation already covers a later scenario), and a closing Review Workload
   Forecast table with an explicit split/no-split verdict.
</content>
