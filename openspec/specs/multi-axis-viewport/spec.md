# Capability: multi-axis-viewport

> Change: `core-scale-transforms` (roadmap `order: 5.6`). New capability.
>
> Source: `design.md` D5. Axis registration (id, scale kind, domain, side), N-axis inset
> stacking, and driving N `createViewportTransform` calls from one shared X domain. Lives partly
> in `@trace-kit/core` (`YAxisRegistration`, `createAxisTransforms`) and partly in
> `packages/renderers` (gutter arithmetic, which needs font metrics and therefore MUST NOT live
> in core per CLAUDE.md rule 5). This change builds no trace-to-axis binding; that is roadmap
> order 5.7.

## ADDED Requirements

### Requirement: `YAxisRegistration` Is Plain, Frozen, DOM-Free Configuration
`@trace-kit/core` MUST export `AXIS_SIDE_LEFT = 0` as a numeric constant, with value `1` reserved
for a future right-side axis and not implemented by this change. `@trace-kit/core` MUST export a
`YAxisRegistration` interface with fields `id: string`, `scaleKind: number`, `domainMin: number`,
`domainMax: number`, and `side: number`. A registration MUST carry no DOM reference, no font
metric, and no style information.

#### Scenario: A left-side axis registration is valid
- **GIVEN**: a `YAxisRegistration` with `id: "power-mw"`, `scaleKind: Y_SCALE_KIND_LOG`,
  `domainMin: 1e-3`, `domainMax: 1e3`, `side: AXIS_SIDE_LEFT`
- **WHEN**: it is passed to `createAxisTransforms`
- **THEN**: it is accepted and produces a corresponding `ViewportTransform`

#### Scenario: The registration type carries no DOM or style reference
- **GIVEN**: the `YAxisRegistration` interface declaration
- **WHEN**: its fields are inspected
- **THEN**: none of them is a DOM type, a font metric, or a style object; all are `string` or
  `number`

### Requirement: N `ViewportTransform` Instances Are Produced From One Shared X Domain
`@trace-kit/core` MUST export
`createAxisTransforms(shared, axes, out): number` where `shared` carries the CSS
width/height/dpr/insets and the shared X domain/origin, `axes` is a `readonly YAxisRegistration[]`,
and `out` is a caller-owned `ViewportTransform[]`. The function MUST write one
`ViewportTransform` per registration into `out` at the same index as its source registration
(`out[i]` corresponds to `axes[i]`) and MUST return the count written. This is a cold-path
operation (resize or domain change), never invoked per rendered frame.

#### Scenario: Positional correspondence holds between axes and out
- **GIVEN**: `axes` containing two registrations, index `0` a log axis and index `1` a linear
  axis, and `out` a pre-sized array
- **WHEN**: `createAxisTransforms(shared, axes, out)` runs
- **THEN**: it returns `2`, `out[0]` is a `ViewportTransform` with `yScaleKind ===
  Y_SCALE_KIND_LOG` matching `axes[0]`'s domain, and `out[1]` is a `ViewportTransform` with
  `yScaleKind === Y_SCALE_KIND_LINEAR` matching `axes[1]`'s domain

#### Scenario: All N transforms share identical X fields
- **GIVEN**: the same two-axis call
- **WHEN**: `out[0]` and `out[1]` are compared
- **THEN**: `xDomainMin`, `xDomainMax`, `xOrigin`, `xScale`, `deviceWidth`, `deviceHeight`, `dpr`
  are equal (by `Object.is`) across both instances

### Requirement: All N Transforms Share Byte-Identical Plot Geometry
`insetLeft` passed to `createAxisTransforms` MUST be a single summed number, identical across
every one of the N underlying `createViewportTransform` calls it issues. Consequently every
produced `ViewportTransform` MUST have identical `plotLeft`, `plotTop`, `plotWidth`, and
`plotHeight`. Per-axis gutter width MUST affect only where a renderer paints that axis's labels,
and MUST NOT alter any transform's plot rectangle.

#### Scenario: plotLeft is identical across all N transforms regardless of axis count
- **GIVEN**: three `YAxisRegistration` entries and a shared `insetLeft` that already accounts for
  all three gutters summed
- **WHEN**: `createAxisTransforms` produces three transforms
- **THEN**: `out[0].plotLeft === out[1].plotLeft === out[2].plotLeft`, and correspondingly for
  `plotTop`, `plotWidth`, `plotHeight`

#### Scenario: A per-axis inset would break the shared-geometry invariant, and is rejected by construction
- **GIVEN**: the `createAxisTransforms` signature, which accepts one `insetLeft` in `shared`, not
  one per axis
- **WHEN**: the API surface is inspected
- **THEN**: there is no parameter or code path allowing a distinct `insetLeft` per axis; the
  invariant is structurally enforced, not merely tested

#### Scenario: The CSS-to-device inset conversion happens exactly once per transform, not once per axis gutter
- **GIVEN**: a shared CSS-pixel `insetLeft` that is the sum of two axis gutters, and `dpr: 2`
- **WHEN**: `createAxisTransforms` produces the transforms
- **THEN**: each transform's `plotLeft` equals the summed CSS `insetLeft` multiplied by `dpr`
  exactly once — not each gutter multiplied by `dpr` and then summed as device pixels

### Requirement: The Plot Area Shrinks Consistently When Axis Count Changes
When the number of registered left-side axes changes, the plot area MUST shrink or grow
according to the correspondingly recomputed shared `insetLeft`, and all N (post-change) transforms
MUST be rebuilt from that new inset in the same cold pass. Zero registered axes with no left axis
shown MUST yield `insetLeft === 0`, identical to the pre-multi-axis single-axis behavior.

#### Scenario: Adding a second axis shrinks plotWidth for both
- **GIVEN**: a renderer first configured with one left axis, then reconfigured with two
- **WHEN**: `insetLeft` is recomputed for two axes and `createAxisTransforms` reruns
- **THEN**: `plotWidth` on the resulting transforms is smaller than `plotWidth` was with one axis,
  and both resulting transforms report the same smaller `plotWidth`

#### Scenario: Zero left axes matches pre-existing single-axis behavior
- **GIVEN**: `yAxisCount: 0` and `showLeftAxis: false`
- **WHEN**: the shared inset is computed
- **THEN**: `insetLeft === 0`

#### Scenario: An inset that would eliminate the plot area still throws via the existing construction guard
- **GIVEN**: enough registered axes that the computed `insetLeft` plus `insetRight` would meet or
  exceed `cssWidth`
- **WHEN**: `createAxisTransforms` runs
- **THEN**: it throws `RangeError`, via the same archived `viewport-transform` construction guard
  for non-positive plot area — no new validation is introduced for this case

### Requirement: This Change Exposes Exactly the Seam Roadmap Order 5.7 Needs, and No Trace-to-Axis Binding
This change MUST expose exactly three things for a future trace-to-axis binding: a stable
`YAxisRegistration.id`; the positional correspondence `out[i] <-> axes[i]`; and an unmodified
`buildTracePath` that continues to accept a `ViewportTransform` plus `projectX`/`projectY` by
reference. This change MUST NOT introduce a `yAxisId` field on any trace type, MUST NOT introduce
an id-to-index lookup map, and MUST NOT introduce any per-trace state keyed by axis.

#### Scenario: No trace type gains an axis-binding field
- **GIVEN**: every trace-related type shipped by `@trace-kit/core` after this change
- **WHEN**: their fields are inspected
- **THEN**: none of them contains a `yAxisId` field or equivalent axis-binding property

#### Scenario: No id-to-index lookup map is introduced
- **GIVEN**: `packages/core/src/viewport/axes.ts` and its exports
- **WHEN**: the module's exports are inspected
- **THEN**: no exported function or data structure maps a `YAxisRegistration.id` to an index; the
  only correspondence is the positional one returned by `createAxisTransforms`

#### Scenario: buildTracePath is unmodified and axis-agnostic
- **GIVEN**: `buildTracePath`'s signature before and after this change
- **WHEN**: they are compared
- **THEN**: the signature is unchanged — it still accepts a single `ViewportTransform` plus
  `projectX`/`projectY` by reference, with no added axis-selection parameter

### Requirement: Per-Axis Gutter Arithmetic Lives in the Renderer, Never in Core
Computing the CSS-pixel width of an individual axis's label gutter (a function of font metrics
and style) MUST live in `packages/renderers`, never in `@trace-kit/core`. `@trace-kit/core`'s
`createAxisTransforms` MUST accept only the already-summed `insetLeft` and MUST NOT compute or
know about individual per-axis gutter widths.

#### Scenario: core has no font-metric-dependent gutter computation
- **GIVEN**: `packages/core/src/viewport/**`
- **WHEN**: the source is scanned for font-metric or style-dependent gutter-width computation
- **THEN**: no such computation exists in `@trace-kit/core`; `createAxisTransforms` receives only
  a pre-summed numeric `insetLeft`
