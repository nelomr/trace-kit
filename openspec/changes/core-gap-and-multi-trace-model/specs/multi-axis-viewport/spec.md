# Capability: multi-axis-viewport

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). MODIFIED delta against the
> archived baseline at `openspec/specs/multi-axis-viewport/spec.md` (from `core-scale-transforms`,
> roadmap `order: 5.6`).
>
> Source: `proposal.md` Modified Capabilities ("its 'no trace-to-axis binding' requirement is
> fulfilled and must be amended so `yAxisId` on a trace type is permitted"), Confirmed Product
> Decision 3. This delta amends exactly the one archived requirement that forbade a
> `yAxisId` field on any trace type; every other archived requirement of this capability
> (`YAxisRegistration` shape, N-transform production, shared plot geometry, plot-area shrink
> behavior, gutter arithmetic living in the renderer) holds unchanged and is not restated.

## MODIFIED Requirements

### Requirement: This Change's Seam Is Now Consumed by `trace-collection-payload`; a `yAxisId` Field on a Trace Type Is Now Permitted
The archived requirement's ban on a trace type carrying a `yAxisId` field is lifted: this ban
existed only because roadmap order 5.7 (this change) had not yet been built, per the archived
requirement's own "roadmap order 5.7" cross-reference. `trace-collection-payload`'s trace entry
type MUST carry a `yAxisId: string` field, resolved against `YAxisRegistration.id` exactly via
the positional `out[i] <-> axes[i]` correspondence `createAxisTransforms` already returns — no
id-to-index lookup MUST live inside `@trace-kit/core`'s axis module itself
(`packages/core/src/viewport/axes.ts` continues to expose no such map, per the archived
requirement's second scenario, which still holds). The id-to-index resolution required to honor a
trace's `yAxisId` binding MUST live in `trace-collection-payload`'s own resolution step (a
caller-owned `Int32Array`, computed once per collection revision), not inside `axes.ts`, and MUST
NOT be performed per point or per frame, preserving the archived requirement's core intent (no
per-point axis lookup) while permitting the field the archived text had forbidden.

`buildTracePath` remains unmodified and axis-agnostic exactly as the archived requirement states:
it still accepts a single `ViewportTransform` plus `projectX`/`projectY` by reference, with no
added axis-selection parameter; axis selection happens once, before `buildTracePath` is called,
by resolving the trace's bound transform ahead of time.

#### Scenario: A trace type now carries a yAxisId field
- **GIVEN**: `trace-collection-payload`'s trace entry type after this change
- **WHEN**: its fields are inspected
- **THEN**: it contains a `yAxisId: string` field, superseding the archived "no trace type gains
  an axis-binding field" scenario for this specific type

#### Scenario: axes.ts still contains no id-to-index lookup map
- **GIVEN**: `packages/core/src/viewport/axes.ts` and its exports, after this change
- **WHEN**: the module's exports are inspected
- **THEN**: no exported function or data structure in this module maps a `YAxisRegistration.id`
  to an index; the only correspondence this module provides is still the positional
  `out[i] <-> axes[i]` one returned by `createAxisTransforms` — the id-to-index resolution now
  required to honor a trace's `yAxisId` lives in `trace-collection-payload`, not here

#### Scenario: buildTracePath's signature is still unchanged
- **GIVEN**: `buildTracePath`'s signature before `core-scale-transforms`, after
  `core-scale-transforms`, and after this change
- **WHEN**: all three are compared
- **THEN**: the signature is identical across all three — it still accepts a single
  `ViewportTransform` plus `projectX`/`projectY` by reference, with no axis-selection parameter
  added by this change

#### Scenario: Axis resolution for a trace happens once per collection revision, not per point
- **GIVEN**: a `TraceCollection` with a trace bound to a `yAxisId`, rendered across 60 frames at
  an unchanged collection revision
- **WHEN**: the render loop runs
- **THEN**: the `yAxisId`-to-transform resolution is computed at most once (at construction or the
  last revision bump), and no string-keyed lookup recurs inside the per-frame or per-point loop
  across the 60 renders

### Requirement: Every Other Archived Requirement of This Capability Holds Unchanged
The archived requirements not amended above — `YAxisRegistration`'s plain/frozen/DOM-free shape,
`createAxisTransforms`'s N-transforms-from-one-shared-X-domain contract and positional
correspondence, byte-identical shared plot geometry across all N transforms, the plot area's
consistent shrink/grow behavior as axis count changes, and per-axis gutter arithmetic living only
in the renderer — continue to hold verbatim after this change.

#### Scenario: Positional correspondence between axes and out still holds
- **GIVEN**: `axes` containing two registrations and `out` a pre-sized array, after this change
- **WHEN**: `createAxisTransforms(shared, axes, out)` runs
- **THEN**: it returns `2`, and `out[0]`/`out[1]` correspond to `axes[0]`/`axes[1]` exactly as the
  archived requirement states — unaffected by `trace-collection-payload` now consuming the `id`s
  this function's inputs already carried

#### Scenario: Shared plot geometry across N transforms is still identical
- **GIVEN**: three `YAxisRegistration` entries and a shared `insetLeft`, after this change
- **WHEN**: `createAxisTransforms` produces three transforms
- **THEN**: `plotLeft`, `plotTop`, `plotWidth`, and `plotHeight` are identical across all three,
  exactly as the archived requirement states
