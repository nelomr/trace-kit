# Proposal: core-scale-transforms

> Roadmap `order: 5.6`. Prerequisite: `browser-visual-regression-harness` (archived).
> Inputs: `exploration.md`, `research.md`, `openspec/specs/viewport-transform/spec.md`.

## Intent

`packages/core/src/viewport/transform.ts` projects Y as `t.yBase - yValue * t.yScale` — one
multiply-subtract, one `yScale`/`yBase` pair, no branch. Verified by direct inspection: the
projection layer is **linear-only and single-Y-axis-only**.

Every photonic sweep co-plots at least two quantities on incompatible scales against one shared
X axis in nm (raw power in mW spanning decades; phase in radians; a linear-scaled dB trace). Today
only one of them is expressible per figure, and none of them logarithmically.

**Ordering argument.** `svg-vector-export` (6) and `renderers-webgl2` (7) both *consume* the
projection: the exporter emits tick geometry and paths from it, the WebGL2 renderer bakes it into
a domain-to-clipspace uniform. Adding a second Y axis and a log scale after either ships means
rewriting shipped code in both. This change lands first for that reason alone.

## Scope

### In Scope
- Base-10 logarithmic Y projection and total inverse projection on `ViewportTransform`.
- N independent Y domains sharing one X domain, as **one `ViewportTransform` instance per Y axis**
  (shared X fields, per-axis Y fields) — no new container type at the projection layer.
- `selectLogTicks(domainMin, domainMax, targetCount, out, outputOffset)`: decade + `2..9` mantissa
  ticks, same caller-buffer/return-count contract as `selectTicks`.
- Left-stacked per-axis gutter arithmetic (`computeAxisInsets` → N axes, in registration order).
- A documented f64 normalization obligation for future GPU consumers (see below).
- Log/dual-axis goldens; **zero visual diff on existing single-linear-axis goldens**.

### Out of Scope (exclusions, so they cannot drift in during apply)
- `symlog` — named as the next axis kind, not built here. The `yScaleKind` discriminant is numeric
  and MUST leave room (`2..n`) so adding it later breaks nothing shipped at linear/log.
- Right-side Y axes.
- Non-base-10 or generic-base log, square-root, or any further scale kind.
- Trace-to-axis binding — belongs to 5.7 `core-gap-and-multi-trace-model`
  (`trace-collection-payload`). 5.6 proves N *axes* coexist; 5.7 decides how a *trace* picks one.
- `d3-scale` or any dependency-bearing scale library — ruled out by the recorded decision in
  `openspec/changes/00-roadmap-decomposition/exploration.md` §1.10 ("`d3-scale` ... belongs in the
  framework adapters, not the core"); it drags `d3-array`/`d3-format` and fails CLAUDE.md rule 5.

## Confirmed Product Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Zero/negative Y domain on a log axis → throw `RangeError` on `yDomainMin <= 0` at construction.** | Matches every other degenerate-input case already in the archived `viewport-transform` contract; zero new machinery. `symlog` is the reserved successor for genuinely zero-crossing data. A caller-supplied clamp/epsilon was **rejected in every scope**: it silently discards data below the floor and discards sign, an implicit transformation CLAUDE.md rule 6 forbids. |
| 2 | **Left-stacked Y axes only.** | "Which side" stays an axis-registration property, not a fixed layout assumption, so right-side axes add later without rework to `ViewportTransform` (insets remain numbers fed to the same constructor). |
| 3 | **Base-10 only, hardcoded.** | Matches the decade convention this instrument domain uses universally. A generic base adds API surface plus a `Math.log(y)/Math.log(base)` division per point for no cited demand. |

## Capabilities

> Contract with `sdd-spec`. This list **corrects** the roadmap `order: 5.6` comment block, which
> was an orchestrator hypothesis; where it differs, the exploration's blast-radius analysis wins.

### New Capabilities
- `scale-logarithmic-transform`: base-10 decade projection, its total/finite inverse, the
  `yDomainMin <= 0` construction error, and `selectLogTicks`.
- `multi-axis-viewport`: axis registration (id, scale kind, domain, side), N-axis inset stacking,
  and driving N `createViewportTransform` calls from one shared X domain.

### Modified Capabilities
- `viewport-transform`: add `yScaleKind`, `yLogDomainMin`, `yLogScale` as `readonly number` fields
  (additive; existing consumers reading only the original fourteen are unaffected); narrow the
  "no `Math.*`" clause to the linear path; state the f64 GPU-consumer obligation.
- `canvas2d-axes-grid`: `computeAxisInsets` generalizes to N axes; `drawGrid`/`drawAxes` iterate N
  transforms; decade gridline painting; `selectLogTicks` substituted per axis scale kind.
- `visual-golden-corpus`: new log-scale and dual-Y-axis figures; unchanged goldens elsewhere.

### Explicitly Not Changed
- **`scale-linear-transform` is NOT created.** The roadmap hypothesized extracting the linear path
  into its own capability. The exploration's migration shape generalizes `ViewportTransform` **in
  place by composition**: it stays one frozen flat object of `readonly number` fields, instantiated
  once per Y axis. An extraction would add a capability and a seam that buys nothing.
- `canvas2d-trace-rendering`: `buildTracePath` already takes a `ViewportTransform` plus
  `projectX`/`projectY` by reference and does not care which axis or scale kind produced them.
- `spectrum-data-payload`: buffers stay raw domain values (mW, radians). Scale kind is a
  projection-layer concept and is never baked into stored data.
- `allocation-free-hot-path`: its banned-construct list does not include `Math.*`, so the tension
  below is confined to `viewport-transform`'s own wording.

## Approach

Generalize in place, do not wrap or replace.

1. **Precompute at construction (cold path).** For a log axis, `createViewportTransform` computes
   `yLogDomainMin` and `yLogScale` once. Per point, every operation except one `Math.log10(yValue)`
   is arithmetic over precomputed constants — identical in shape to the linear case.
2. **Dispatch with a loop-invariant numeric branch inside one monomorphic `projectY`.**
   `yScaleKind` is numeric (a string union would break "readonly number fields only") and is fixed
   per instance, so it does not vary within a `render()` call. `ViewportTransform` stays one shape;
   `projectY` stays one function. This is categorically different from a polymorphic
   `.project()` call site, which is the megamorphic risk the research documents
   (<https://mathiasbynens.be/notes/shapes-ics>; the widely-quoted "10–50x" penalty figure is
   community-sourced and traced to no primary V8 benchmark, so the fallback below is treated as a
   real safety net, not a formality).
3. **Fallback if that is wrong** — split the body into two per-kind functions resolved once per
   frame. Callers only ever invoke `projectY(t, y)`, so this is mechanical and non-breaking. Not a
   one-way door.
4. **Multi-axis = N instances, not an axis index threaded through every call.** All instances share
   the X fields; a consumer holds a reference to its axis's transform.
5. **Tick selection.** `selectTicks` is untouched and keeps its transcendental ban verbatim.
   `selectLogTicks` is new and walks decades with the same integer multiply/divide magnitude walk
   `niceStep` already uses, so no logarithm is needed to classify a decade. For a sub-decade span
   it falls back to `niceStep` in log space, exponentiating only the handful of selected tick
   values (cold, once per `tickRevision` bump).

## GPU Precision Contract (documented, not implemented here)

GLSL ES 3.00 `highp float` guarantees only 2^-24 relative precision (~7 significant digits), and
WebGL2 exposes no double-precision vertex or uniform type
(<https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf>; the negative is
inferred from the spec's silence, per `research.md`). `1550.123456` nm at sub-picometre resolution
needs ~10 digits.

`@trace-kit/core` MUST NOT gain a WebGL2 dependency (CLAUDE.md rule 5). This change therefore owns
an **obligation, not an implementation**: keep `xOrigin`, `xDomainMin`, `xDomainMax` as f64 — the
existing `spectrum-data-payload` f64-origin/f32-offset guarantee **MUST NOT regress** — and state
in the spec that a GPU consumer MUST normalize in float64 on the CPU before any float32 cast and
MUST NOT upload `xDomainMin + xOffset` as a single float32 sum. Change 7 owns the GLSL work and the
choice between relative-to-center (<https://github.com/KhronosGroup/glTF/blob/main/extensions/1.0/Vendor/CESIUM_RTC/README.md>)
and normalize-to-`[0,1]`. No new field is required to satisfy this.

## Open Technical Decision Handed to `sdd-design`

**Not settled here.** The archived requirement "Forward Projection Is Allocation-Free Per Point"
bans any `Math.*` call in the `projectX`/`projectY` body. Log projection needs exactly one
`Math.log10` per point, whose argument is the per-point data value and therefore cannot be
precomputed. The exploration's position is that the invariant that actually matters is **zero GC
events** — which `Math.log10`, being non-allocating, satisfies — rather than literal
transcendental-freedom, and that the "no `Math.*`" wording was a stand-in that happened to hold
only because nothing needed a logarithm before now. `sdd-design` MUST decide and record how the
MODIFIED delta is worded; `sdd-apply` cannot arbitrate a contradiction between an archived
requirement and the implementation it is asked to write.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/core/src/viewport/transform.ts` | Modified | `yScaleKind`/`yLogDomainMin`/`yLogScale`; log branch in `projectY`/`unprojectY`; log-degenerate `RangeError` |
| `packages/core/src/viewport/ticks.ts` | Modified | New `selectLogTicks`; `selectTicks` unchanged |
| `packages/core/src/viewport/` (axis layout) | Modified | `computeAxisInsets` → N left-stacked axes |
| `packages/renderers/` (Canvas2D axes/grid) | Modified | Iterate N transforms; decade gridlines |
| `openspec/specs/{viewport-transform,canvas2d-axes-grid,visual-golden-corpus}` | Modified | Delta specs |
| `openspec/roadmap.yaml` `order: 5.6` | Correction | Drop `scale-linear-transform` from the intended surface |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Silent numerical error in the log inverse projection** | Med | Highest-weight risk. `10 ** x` compounds any float error in the log-space division, and change 13.5's `delta-cursor-math` (log-aware: dB is a ratio, not a difference) depends on this arithmetic being exact. **No reference library documents a guaranteed total, always-finite inverse** — d3-scale, Matplotlib and Plotly all fall short, and d3's `scaleLog` documents `NaN` at a zero-crossing domain, the opposite of totality (`research.md` Lane 3). There is no prior art to validate against; it must be engineered and proven from first principles with exact round-trip tests at, near and just outside the domain edges. A wrong reading is worse than a crash because nothing signals it. |
| 2 | Archived "no `Math.*` in `projectY`" left ambiguous | High | Named above as an explicit `sdd-design` decision; blocks `sdd-apply` if unresolved. |
| 3 | Golden-image churn beyond intended scope | Med | Zero-diff assertion on existing single-linear-axis goldens is itself a regression check. |
| 4 | Allocation regression in the hot path | Low | Coefficients are cold-path; `Math.log10` does not allocate. Still requires a measured zero-GC test **per axis kind**, not an assumption. |
| 5 | Scope creep into a d3-scale reimplementation | Med | Exclusions above are stated as hard boundaries; `yScaleKind` generalizes temptingly. |
| 6 | Multi-axis gutter-stacking bugs | Med | Bounded and visually obvious, unlike #1; covered by inset-order and plot-area-shrink tests. |

## Acceptance Criteria Seeds

Both are defects a golden-image test cannot catch, so both need direct assertions.

1. **`selectLogTicks` never returns zero ticks.** For any domain with `domainMin < domainMax` and
   `domainMin > 0`, it MUST write at least one tick. This guards explicitly against the documented,
   acknowledged-and-unresolved d3-scale defect where `[42, 43]` yields an empty array
   (<https://github.com/d3/d3-scale/issues/44>). An axis that silently renders with no ticks after
   a zoom looks like a legitimately sparse axis in a golden image, not a failure.
2. **The log inverse is total and finite for every input pixel coordinate**, including coordinates
   outside the plot area, matching the archived totality contract for the linear path, with exact
   round-trip verification near and just outside the domain edges.

## Rollback Plan

The new fields are additive and the log path is reachable only when `yScaleKind !== 0`. Revert is
the change's commit range on `packages/core/src/viewport/**` and the renderer axis module, plus
deleting the new goldens; existing single-linear-axis behaviour and goldens are unchanged
throughout, so a partial revert leaves a consistent linear-only system. No data migration, no
published API removal (the package is pre-`1.0.0` at `0.0.x`).

## Dependencies

- `browser-visual-regression-harness` (archived) — required for the new goldens.
- No new runtime dependency. `d3-scale` is explicitly excluded.

## Success Criteria

- [ ] A log-scale Y axis projects and inverse-projects with exact round-trip at, near and outside
      the domain edges.
- [ ] `createViewportTransform` throws `RangeError` for a log axis with `yDomainMin <= 0`.
- [ ] `selectLogTicks` returns `>= 1` tick for every valid non-degenerate domain, including
      sub-decade spans.
- [ ] Two independent Y axes render against one shared X domain with correctly stacked left gutters.
- [ ] All eight archived `viewport-transform` requirements still hold for `yScaleKind === 0`.
- [ ] Zero-GC gate passes per axis kind; existing goldens show zero visual diff.
- [ ] `pnpm exec turbo run typecheck lint build` and `pnpm run test` pass; no `any` introduced.
