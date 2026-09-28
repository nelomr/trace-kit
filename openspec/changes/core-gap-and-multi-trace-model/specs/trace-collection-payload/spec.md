# Capability: trace-collection-payload

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). New capability.
>
> Source: `proposal.md` Intent ("Multi-trace"), Scope, Confirmed Product Decisions 2 and 3,
> Approach step 4. `TraceCollection` composes existing `SpectrumDataPayload`s; it does not widen
> `spectrum-data-payload`, which stays single-trace per `proposal.md`'s "Explicitly Not Changed"
> list.

## ADDED Requirements

### Requirement: `TraceCollection` Is an Ordered, Frozen List of Trace Entries Sharing One X Domain
`@trace-kit/core` MUST export a factory producing a `TraceCollection`: an ordered, frozen list of
trace entries, each entry carrying a stable `id: string`, a `SpectrumDataPayload` reference, a
`yAxisId: string` binding, and a per-trace style. A `TraceCollection` MUST carry exactly one
shared X **domain** (`xDomainMin`, `xDomainMax`), not one shared X **buffer**: each entry's
payload retains its own `x` buffer, `xOrigin`, and `sampleCount`, per Confirmed Product Decision
2. The collection and its entry array MUST be frozen (`Object.isFrozen` true) after construction;
no entry, and no field of an entry other than the payload's own mutable-through-
`commitPayloadRevision` fields, MUST be reassignable after construction.

#### Scenario: A two-trace collection holds independent payloads under one shared X domain
- **GIVEN**: two `SpectrumDataPayload`s with different `sampleCount` and different `xOrigin`
  values, each registered against a distinct `yAxisId`
- **WHEN**: `createTraceCollection` builds a collection from both, with an explicit shared
  `xDomainMin`/`xDomainMax`
- **THEN**: the collection exposes two entries, each entry's payload retains its own original `x`
  buffer and `sampleCount` unchanged, and both entries report the same collection-level
  `xDomainMin`/`xDomainMax`

#### Scenario: The collection and its entries are frozen
- **GIVEN**: a constructed `TraceCollection`
- **WHEN**: `Object.isFrozen` is checked on the collection and on its entry array
- **THEN**: both report `true`

#### Scenario: A field assignment on a frozen entry has no effect or throws in strict mode
- **GIVEN**: a constructed `TraceCollection` and one of its entries
- **WHEN**: an assignment to `entry.yAxisId` is attempted
- **THEN**: under strict mode (the package's committed module mode) the assignment throws a
  `TypeError`; the entry's `yAxisId` is unchanged either way

### Requirement: Trace-to-Axis Binding Resolves `YAxisRegistration.id`, Never a Per-Point Lookup
Each trace entry's `yAxisId` MUST reference a `YAxisRegistration.id` from the seam exposed by
`multi-axis-viewport`. Resolution from `yAxisId` to a `ViewportTransform` index MUST happen at
most once per collection revision (construction or a revision bump), written into a caller-owned
`Int32Array`, never as a `Map` read or string comparison inside a per-point or per-frame loop,
per Confirmed Product Decision 3.

#### Scenario: yAxisId resolves to a transform index once per collection revision
- **GIVEN**: a `TraceCollection` with two entries bound to axis ids `"power-mw"` and
  `"power-dbm"`, and an `axes` array produced by `createAxisTransforms` containing matching
  registrations
- **WHEN**: the collection's axis-resolution step runs once
- **THEN**: it writes one transform index per entry into a caller-owned `Int32Array`, and no
  string-keyed lookup occurs again for those entries until the collection's revision changes

#### Scenario: No per-point or per-frame Map read resolves yAxisId
- **GIVEN**: the renderer's per-trace render loop (`canvas2d-trace-rendering`)
- **WHEN**: its source is inspected for axis resolution inside the per-point loop
- **THEN**: no `Map.get`, object-property string lookup, or equivalent keyed by `yAxisId` occurs
  inside that loop; the loop reads only the precomputed `Int32Array` index

### Requirement: Construction Validates Unknown `yAxisId` and Duplicate Trace `id`
Constructing a `TraceCollection` MUST validate, before any entry is frozen or accepted, that
every entry's `yAxisId` matches a `YAxisRegistration.id` present in the supplied axis list, and
that every entry's `id` is unique within the collection. A violation of either MUST raise a
`RangeError` naming the offending `yAxisId` or duplicate `id`, and MUST NOT produce a
partially-constructed collection.

#### Scenario: An unknown yAxisId is rejected at construction
- **GIVEN**: a trace entry with `yAxisId: "power-dbm"` and an axis list containing only
  `"power-mw"`
- **WHEN**: `createTraceCollection` is invoked with this entry and axis list
- **THEN**: it throws a `RangeError` naming `"power-dbm"`, and no collection is returned

#### Scenario: A duplicate trace id is rejected at construction
- **GIVEN**: two trace entries both declaring `id: "reference"`
- **WHEN**: `createTraceCollection` is invoked with both entries
- **THEN**: it throws a `RangeError` naming the duplicated `id` `"reference"`, and no collection
  is returned

#### Scenario: A valid collection with distinct ids and known axis ids constructs successfully
- **GIVEN**: two trace entries with distinct `id`s, each `yAxisId` matching a supplied axis
  registration
- **WHEN**: `createTraceCollection` runs
- **THEN**: it returns a valid frozen `TraceCollection` with both entries present, in the order
  supplied

### Requirement: A Collection-Level Revision Is Distinct From Per-Payload Revisions
`TraceCollection` MUST carry its own `revision: number`, separate from each entry payload's own
`revision` field (owned by `spectrum-data-payload`). The collection-level revision MUST increment
when the collection's own structural shape changes — entries added or removed, a `yAxisId`
rebinding, or a style change — and MUST NOT increment merely because a member payload's own
`revision` advances through `commitPayloadRevision`. A consumer that needs "any member payload
changed" MUST check member revisions individually; the collection-level revision answers "did the
collection's own composition change," not "did any payload's data change."

#### Scenario: A member payload's data update does not bump the collection revision
- **GIVEN**: a `TraceCollection` with one entry, at collection `revision === 0`
- **WHEN**: `commitPayloadRevision` is called on that entry's payload, advancing the payload's own
  `revision`
- **THEN**: the collection's `revision` is still `0`

#### Scenario: Rebinding a trace's yAxisId bumps the collection revision
- **GIVEN**: a `TraceCollection` at `revision === 0`
- **WHEN**: an entry's `yAxisId` is changed via the collection's own update path (not by direct
  field mutation, which is rejected per the frozen-entry requirement above)
- **THEN**: the collection's `revision` becomes `1`

### Requirement: Per-Trace Style Is a Frozen Plain Object, Core-Owned Defaults Excluded
Per-trace style (color, line width, dash pattern, and the optional boolean `markIsolatedSamples`)
MUST be represented as a frozen plain data
object attached to each entry, resolved once at construction or update, never recomputed per
point or per frame. `@trace-kit/core` MUST NOT supply a default color palette; supplying and
resolving default style values from a fixed palette is a renderer concern
(`canvas2d-trace-rendering`), per `proposal.md` Approach step 5 and CLAUDE.md rule 5 (core stays
DOM- and rendering-concern-free).

#### Scenario: Per-trace style is a frozen object, resolved once
- **GIVEN**: a trace entry constructed with an explicit style object
- **WHEN**: the entry is inspected after construction
- **THEN**: `entry.style` is frozen (`Object.isFrozen` true), and it is the same object reference
  across repeated reads within the same collection revision — never rebuilt per read

#### Scenario: markIsolatedSamples is an optional boolean carried as data
- **GIVEN**: one entry constructed with `style: {}` and one with `style: { markIsolatedSamples: false }`
- **WHEN**: the entries are inspected
- **THEN**: the first entry's `style.markIsolatedSamples` is `undefined` (the renderer treats it as
  `true`) and the second is `false`; core applies no default and performs no rendering based on it

#### Scenario: Core exposes no default color palette
- **GIVEN**: `@trace-kit/core`'s full export surface
- **WHEN**: it is inspected for a default trace color palette or default style constant
- **THEN**: no such export exists

### Requirement: `TraceCollection` Is Core-Owned and DOM-Free
`TraceCollection` and its factory MUST live in `@trace-kit/core`, MUST NOT import or reference
any DOM type (`HTMLCanvasElement`, `OffscreenCanvas`, `CanvasRenderingContext2D`, or equivalent),
and MUST be constructible and fully exercisable in a plain Node.js environment with no browser or
`happy-dom` globals, consistent with CLAUDE.md rule 5.

#### Scenario: The collection module has no DOM import
- **GIVEN**: the module implementing `TraceCollection` and its factory
- **WHEN**: its imports are inspected
- **THEN**: none references a DOM type or a browser global

#### Scenario: The collection factory runs under a plain Node.js test environment
- **GIVEN**: a test file constructing a `TraceCollection` under the `node` (not `happy-dom` or
  `jsdom`) Vitest environment
- **WHEN**: the test runs
- **THEN**: it constructs successfully with no DOM shim required
