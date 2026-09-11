# Technical Design: core-decimation-math

> Change 2 of 16. Inputs: `proposal.md` (finalized), the seven delta specs under `specs/`,
> `openspec/specs/{test-harness,benchmark-harness,ci-quality-gate,package-build-pipeline,workspace-toolchain}/spec.md`
> (archived baselines), `openspec/changes/00-roadmap-decomposition/exploration.md` (§1.5, §1.11),
> `research.md` (claims **C4**, **C4b**, **C4c**, **C4d**),
> `openspec/changes/core-transport-contract/design.md` (§D5, §D6, §"Required Changes to
> `SpectrumDataPayload`"), and the measured state of `packages/core` on disk.
>
> Section "Reconciliation With the Delta Specs" reports every place writing this design revealed a
> spec that is wrong, underspecified, contradictory, or missing a requirement. **No spec file is
> edited by this phase.**

---

## Context & Background

`packages/core/src/index.ts` is six lines and exports one constant. Everything else in the
repository is harness: a root `vitest.config.ts` with a single `core` project pinned to `node`,
seven real test files, a type-aware ESLint flat config whose `no-explicit-any` and four-selector
`no-restricted-syntax` are asserted by a Node-API meta-test, a `tsup` dual build, and a
dependency-free benchmark runner at `packages/core/bench/runner.ts` whose only consumer is a
`placeholderWorkload()` that names this change as its replacement.

This is the first change that writes domain code, and it is the first change carrying a
performance criterion. Fourteen later changes consume the four things it defines — the branded
buffer vocabulary, `SpectrumDataPayload`, `minMaxEnvelope`, `lttb` — so every signature decided
here is a signature that changes 3 through 16 either inherit or break.

Three facts from the measured state shape the whole design:

1. **The brand vocabulary is not free to invent.** `core-transport-contract/design.md` §D5 already
   fixes `Retained<T>` / `Transit<T>` over a `unique symbol`, and its §"Required Changes" list
   instructs this change to absorb six items now rather than ship them as a later breaking change.
   The `spectrum-data-payload` delta spec encodes all six. This design implements them; it does not
   re-litigate them.
2. **The zero-allocation gate is measurable and the measurement is on disk.** Claim **C4b** records
   0 GC events for an allocation-free Min-Max variant against 17 for an allocating control over 200
   iterations of a 1e6-sample input on Node v20.20.0, with the probe committed and re-runnable at
   `openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs`. The gate is not a
   theory to be designed; it is a probe to be productionized, and §D6 is mostly about the two
   plumbing problems the probe never had to solve (getting `--expose-gc` into Vitest, and keeping
   the gate from passing vacuously).
3. **The probe's own bucket math is wrong for production.** `minMaxNoAlloc` computes
   `per = (src.length / buckets) | 0` and iterates `buckets * per` samples. With `N = 1_000_000`
   and `B = 1000` that happens to be exact, which is why the probe passed. With
   `N = 1_000_003` it silently drops the final three samples — and per CLAUDE.md rule 6 a dropped
   tail is a discarded measurement, not a rounding detail. §D3 replaces it.

### Applicability of the four TraceKit core architecture constraints

The `sdd-design` skill requires every design to address zero-copy transfers, engine selection,
reactivity isolation, and decimation invariants. Only the fourth is directly owned here, but the
other three are not "non-applicable" the way they were for change 1 — each has a decision in this
change that either enables or forecloses it.

| Constraint | Status in this change | Decision that carries it |
|---|---|---|
| **Zero-copy buffer transfer, worker protocol** | No `Worker`, no `postMessage`, no transfer list. But the *shape* that makes change 3's protocol expressible is decided here: every hot-path function writes into a **caller-preallocated output window** addressed by `(out, outputOffset)` rather than returning an array or taking a `.subarray` view, and the `Retained`/`Transit` ownership brand exists from day one so a payload buffer can never type-check into a transfer list. | §D1, §D2, §D3, §D4 |
| **Canvas2D `<80k` / WebGL2 `>80k` engine strategy, hysteresis** | No renderer, no canvas, no GPU context (changes 5/7/9). This change is nevertheless *why* the threshold is rarely crossed: the renderer draws the decimated output, not the raw sweep. With `bucketCount ≈ 2 × viewportWidthPx` the Canvas2D path sees ≈4,000 values from a 1e6-sample dataset and stays two orders of magnitude below the 80k threshold. Exploration §2 (change 9) records that the hysteresis is evaluated on **decimated** counts; §D3's fixed `bucketCount * 2` output length is what makes that count independent of input size, and therefore stable under pan and zoom. | §D3 |
| **Vue `shallowRef` / `markRaw`, React `useRef` isolation** | No adapter package exists (changes 10/11). The decision made here that determines whether isolation is a one-liner or a fight: **`SpectrumDataPayload` is a flat interface — typed arrays and numbers, no nested object, no class, no getter, no method.** A deep reactive proxy over a flat object with two `Float32Array` fields is isolated by one `markRaw`; a nested object graph would need per-branch isolation and would leak proxies into the render loop (exploration §1.8 requires isolation asserted by *identity*, which only works if there is a single object to identify). | §D2 |
| **LTTB / Min-Max physics preservation** | Directly owned. NaN as the normative gap sentinel with an all-gap bucket emitting `NaN`/`NaN` rather than `±Infinity`; an exact integer bucket partition that drops no tail sample; deterministic first-wins tie-breaking; no interpolation of any kind. | §D3, §D4 |

---

## Goals & Non-Goals

### Goals

1. A branded typed-buffer vocabulary with **zero runtime representation**, two orthogonal brand
   axes (data axis and ownership class), and no `any` in any form.
2. `SpectrumDataPayload` defined in `@trace-kit/core`, absorbing all six required items from
   `core-transport-contract/design.md`, consumable structurally by packages that do not exist yet.
3. `minMaxEnvelope` and `lttb` with signatures that allocate nothing at the **call site** as well
   as inside the loop, and that need no `.subarray` to address a sub-window.
4. The ban list enforced by a scoped, AST-level lint rule that is itself proven live by a fixture
   and a Node-API meta-test — the D1.d precedent already running in this repository.
5. A GC-event gate that runs inside `pnpm run test`, blocks CI, and **cannot pass vacuously**.
6. A `--trace-deopt` harness mode on the existing `bench/` runner that fails loudly when its own
   parser stops matching.
7. `fast-check` pinned in the catalog with a property-test file convention every later numeric
   change follows.
8. A public export surface of `@trace-kit/core` that is explicit about what it does **not** export.

### Non-Goals (owner named)

- `DecimationPort`, leases, the pool, backpressure, transfer lists, `collectTransferList` — change 3.
  This change exports the `Retained`/`Transit` **type vocabulary** only, because the payload spec
  requires it; it exports no function that touches a transfer list.
- Any `Worker`, real or injected, and incremental `O(new samples)` streaming decimation over a ring
  buffer — change 8. `BucketAccumulator` and `RawSampleRing` (transport design §D6) are **not**
  defined here.
- Any rendering, projection, device-space transform, or `d3-scale` — changes 5/7/10/11.
- Browser-side allocation profiling via CDP `HeapProfiler` (claim **C4d**) — change 7.
- Coverage thresholds per glob and a pinned coverage provider — change 16.
- Any stored cross-run benchmark baseline or the regression **comparison** itself — change 16 (see
  finding R11: two specs currently assert this change owns it).
- Curve interpolation of any kind — permanently out of scope (CLAUDE.md rule 6).

---

## Architecture & Data Flow

```text
                     @trace-kit/core  (isomorphic; Node, Worker, browser)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  src/buffers/brand.ts            TYPE-LEVEL ONLY — erases completely          │
  │    unique symbol AxisTag, unique symbol OwnershipTag                          │
  │    Branded<T, Axis, Ownership>   XBuffer YBuffer IndexBuffer                  │
  │    Retained<T> / Transit<T>      TransferableBacking (type, no function)      │
  │    asXBuffer() asYBuffer() …     single narrowing assertion + runtime check    │
  └───────────────┬──────────────────────────────────────────────────────────────┘
                  │ widens freely:  XBuffer  →  Float32Array   (intersection)
                  │ never widens:   Float32Array  ↛  XBuffer   (constructor only)
                  v
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  src/payload/spectrum-data-payload.ts                                         │
  │    interface SpectrumDataPayload {                     ← the read type         │
  │      readonly x: Retained<XBuffer>   capacity-sized                           │
  │      readonly y: Retained<YBuffer>   capacity-sized                           │
  │      readonly capacity, xOrigin, xUnit, yUnit                                 │
  │      readonly sampleCount   ← valid prefix, NOT x.length                      │
  │      readonly revision      ← monotonic, never decreases                      │
  │      readonly xMin xMax yMin yMax   ← valid for [0, sampleCount) @ revision   │
  │    }                                                                          │
  │    createSpectrumDataPayload()  commitPayloadRevision()  ← the ONLY mutators  │
  └───────────────┬──────────────────────────────────────────────────────────────┘
                  │  read-only, structurally
                  v
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  src/decimation/                        HOT PATHS — ban list applies          │
  │                                                                               │
  │   minMaxEnvelope(y, srcOffset, sampleCount, out, outOffset, bucketCount): num │
  │     ├─ boundary validation (throws here, never inside the loop)               │
  │     └─ one forward pass, 1 read/sample                                        │
  │        writes bucketCount*2 f32 INTERLEAVED  [min0,max0,min1,max1,…]          │
  │                                                                               │
  │   lttb(x, y, srcOffset, sampleCount, out, outOffset, threshold): number       │
  │     ├─ boundary validation                                                    │
  │     └─ one forward traversal, 2 reads/sample, no backtracking                 │
  │        writes `threshold` ABSOLUTE indices into an Int32Array                 │
  └───────────────┬──────────────────────────────────────────────────────────────┘
                  │
      ┌───────────┴────────────────────────────────┐
      v                                            v
  change 3  transport: transit→retained copy   change 5/7  renderers
    writes into a sub-window via               index the payload directly
    (out, outputOffset) — never .subarray        through the lttb Int32Array,
                                                 valid ONLY at its producing revision

  ENFORCEMENT GRAPH  (three independent instruments; none can substitute for another)

    source level ──► eslint no-restricted-syntax, scoped to src/decimation/**
                     selectors nested under ForStatement/WhileStatement
                     proven live by test/fixtures/hot-path-violation.ts
                     + test/lint-hot-path.test.ts (ESLint Node API, ignore lifted)

    runtime level ─► test/decimation/allocation-gate.test.ts
                     PerformanceObserver entryTypes:['gc']  under --expose-gc
                     pool: 'forks' + poolOptions.forks.execArgv   ← the only wiring that works
                     allocating control in the same file; control==0 fails the FILE

    codegen level ─► bench/index.ts --trace-deopt   (spawns node --trace-deopt child)
                     parses [deoptimizing … <JSFunction name …>]
                     injected-deopt fixture must be DETECTED or the mode exits 2
```

---

## Technical Decisions

### D1 — The branding mechanism

**Decision.** Two `declare const … : unique symbol` tags, one generic `Branded` helper, named
aliases derived from it, and one narrowing constructor per alias. File:
`packages/core/src/buffers/brand.ts`.

```ts
// Declared, never defined. `declare const` emits nothing, so no symbol is ever created and
// no property is ever written. The brand exists only in the type checker's view.
declare const AxisTag: unique symbol;
declare const OwnershipTag: unique symbol;

export type BufferAxis = 'x' | 'y' | 'index';
export type OwnershipClass = 'retained' | 'transit';

export type Branded<
  TView extends ArrayBufferView,
  TAxis extends BufferAxis,
  TOwnership extends OwnershipClass,
> = TView & {
  readonly [AxisTag]: TAxis;
  readonly [OwnershipTag]: TOwnership;
};

export type Retained<TView extends ArrayBufferView> = TView & {
  readonly [OwnershipTag]: 'retained';
};
export type Transit<TView extends ArrayBufferView> = TView & {
  readonly [OwnershipTag]: 'transit';
};

export type XBuffer = Branded<Float32Array, 'x', 'retained'>;
export type YBuffer = Branded<Float32Array, 'y', 'retained'>;
export type IndexBuffer = Branded<Int32Array, 'index', 'retained'>;

export type TransitXBuffer = Branded<Float32Array, 'x', 'transit'>;
export type TransitYBuffer = Branded<Float32Array, 'y', 'transit'>;
export type TransitIndexBuffer = Branded<Int32Array, 'index', 'transit'>;

/** The only type change 3's transfer-list builder will accept. Declared here, used there. */
export type TransferableBacking = TransitXBuffer | TransitYBuffer | TransitIndexBuffer;
```

**Two orthogonal axes, not one enum.** The alternative — a single tag with values
`'x-retained' | 'x-transit' | …` — collapses six states into one dimension and makes
"any retained buffer, regardless of axis" inexpressible without a union of three. `Retained<T>` as a
separate intersection lets `SpectrumDataPayload` say `Retained<XBuffer>` and lets change 3 say
`Transit<Float32Array>` with neither needing to know about the other's axis. The two tags are
distinct `unique symbol`s, so no structural collision is possible even though both carry string
literal types.

**Construction and narrowing, with zero runtime representation.**

```ts
export function asXBuffer(source: Float32Array): XBuffer {
  assertUsableBuffer(source);
  return source as XBuffer;      // widening-free narrowing; see below
}

export function allocateXBuffer(capacity: number): XBuffer {
  assertCapacity(capacity);
  return new Float32Array(capacity) as XBuffer;
}
```

Three properties make this sound and keep it free of `any`:

- **The assertion is a narrowing, not a reinterpretation.** `XBuffer` is
  `Float32Array & { … }` — an *intersection containing the source type*. `source as XBuffer` is
  therefore a legal single assertion that TypeScript accepts directly. This matters because the
  workspace lint bans `as unknown as T` (the double assertion) via
  `TSAsExpression > TSUnknownKeyword`; a branded type built as an intersection never needs it. A
  brand built as a *separate* nominal type would, and that is the concrete reason the intersection
  form is chosen over a wrapper interface.
- **Widening is free and one-directional.** `XBuffer` is assignable to `Float32Array` (an
  intersection is assignable to each member), so every internal helper takes plain
  `Float32Array` and receives branded buffers with no ceremony. `Float32Array` is *not* assignable
  to `XBuffer`, so the only way into the brand is a constructor above. That asymmetry is the whole
  guarantee; `acceptsXBuffer(yBuffer)` fails to compile because `YBuffer`'s `[AxisTag]` is `'y'`.
- **No `any`, anywhere.** Only generics constrained by `ArrayBufferView`, string-literal unions,
  and `unique symbol` keys. No `Record<string, any>`, no `as any`, no `as never`, no
  `as unknown as`. `assertUsableBuffer` narrows through a real runtime check
  (`source.byteLength === 0 && source.length > 0` ⇒ detached ⇒ throw), so the assertion that
  follows is backed by an observation rather than substituting for one.

**Runtime erasure, and how it is proved.** `declare const X: unique symbol` is a type-only
declaration: `tsc` emits nothing for it, and `isolatedModules: true` (already on in
`tsconfig.base.json`) guarantees the declaration can never accidentally become a value. The
`branded-buffers` spec's first scenario — `Object.getPrototypeOf(value) === Float32Array.prototype`,
`value instanceof Float32Array`, and no extra own property — is directly satisfied and is asserted
in `test/buffers/brand-erasure.test.ts` with `Object.getOwnPropertyNames` and
`Object.getOwnPropertySymbols` both compared against a plain `new Float32Array(n)` of the same
length.

**The payoff that is not obvious: branding costs nothing in monomorphism.** Because a branded value
is the *same object* with the *same V8 hidden class* as an unbranded `Float32Array`, passing an
`XBuffer` and a raw `Float32Array` to the same hot-path parameter is monomorphic. A wrapper-object
brand would make every call site polymorphic and would defeat §D7's gate on its own.

**Alternatives considered.**

- **A wrapper class `class XBuffer { constructor(readonly data: Float32Array) {} }`.** Rejected on
  three counts: it allocates per buffer (cold-path, but it also adds a pointer chase to every hot
  read, `this.data[i]`), it breaks the `branded-buffers` spec's runtime-identity scenario outright,
  and it forces every consumer to unwrap before calling a typed-array method.
- **A `declare const brand: unique symbol` on a single tag with a composite string.** Rejected
  above: it makes ownership-only and axis-only predicates inexpressible.
- **`type XBuffer = Float32Array & { __brand: 'x' }` with a string key.** Rejected: a string key is
  reachable by any code that guesses it, it shows up in `keyof`, and two independently authored
  brands with the same key silently unify. `unique symbol` is collision-proof by construction.
- **`enum`-based nominal typing or TypeScript 5.x `declare` class fields.** Rejected: both emit
  runtime artifacts.
- **No branding; rely on parameter names.** Rejected by the `branded-buffers` spec and by the whole
  point: an X/Y swap in a call to `lttb` produces a plausible-looking wrong chart, not a crash.

**Trade-offs.** Branded types do not survive typed-array methods that return a new view
(`.map`, `.slice`, `.subarray`) — but all three are on the ban list, so the loss is theoretical.
Error messages mentioning `Float32Array & { [AxisTag]: "x" }` are noisier than `XBuffer`; mitigated
by keeping the exported aliases short and documented. Type-level only means a value crossing a
JSON or `postMessage` boundary arrives unbranded and must be re-narrowed through a constructor —
which is correct, because that is exactly the boundary where the check is worth paying for.

---

### D2 — `SpectrumDataPayload`

**Decision.** A flat `interface` with a read type and an internal mutable type, a factory, and a
single mutation entry point. File: `packages/core/src/payload/spectrum-data-payload.ts`.

```ts
export interface SpectrumDataPayload {
  /** Capacity-sized. Holds X **offsets from `xOrigin`**, not absolute X. See below. */
  readonly x: Retained<XBuffer>;
  readonly y: Retained<YBuffer>;
  /** `x.length === y.length === capacity`. Fixed for the payload's lifetime. */
  readonly capacity: number;
  /** f64 origin the f32 X offsets are relative to. Fixed for the payload's lifetime. */
  readonly xOrigin: number;
  readonly xUnit: string;
  readonly yUnit: string;

  /** Length of the valid data prefix. Consumers read only `[0, sampleCount)`. */
  readonly sampleCount: number;
  /** Monotonic. Increments on every authoritative mutation. Never decreases, never resets. */
  readonly revision: number;

  /** Extents over `[0, sampleCount)` at the current `revision`. NaN when `sampleCount === 0`. */
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}
```

**Which fields are branded.** `x` and `y` only — and doubly so: axis-branded (`XBuffer`/`YBuffer`)
and ownership-branded (`Retained`). Every scalar is a plain `number` or `string`; branding a count
buys nothing and costs a constructor call. There is no `IndexBuffer` field: LTTB output is not part
of the payload (see the revision-pairing decision below).

**Readonly-ness, and why it does not prevent mutation.** The public `SpectrumDataPayload` marks
every field `readonly`. The mutable twin is internal:

```ts
interface MutableSpectrumDataPayload extends Omit<SpectrumDataPayload, 'sampleCount' | 'revision'
  | 'xMin' | 'xMax' | 'yMin' | 'yMax'> {
  sampleCount: number;
  revision: number;
  xMin: number; xMax: number; yMin: number; yMax: number;
}
```

`createSpectrumDataPayload()` builds the mutable shape and returns it typed as
`SpectrumDataPayload`; TypeScript allows that assignment because `readonly` modifiers are not
checked in assignability, so **no assertion is needed and none is used**.
`commitPayloadRevision(payload, sampleCount)` takes the mutable type, recomputes the four extents
over the new prefix, and increments `revision`. It is exported, because change 3's transit→retained
copy must call it; the mutable *type* is not exported, so a downstream package cannot obtain a
handle it can write through without deliberately re-declaring the interface.

Note that `readonly x: Retained<XBuffer>` freezes the *reference*, not the contents. That is
intentional and is the only workable shape: the buffers are preallocated once at capacity and
written in place forever. The contract that protects the contents is the mutation entry point, not
the type.

**Why consumers read it structurally.** `SpectrumDataPayload` is an `interface`, not a class: no
constructor identity, no `instanceof`, no methods, no getters, no prototype. A renderer writes
`import type { SpectrumDataPayload } from '@trace-kit/core'` — a **type-only** import, which
`isolatedModules` erases entirely, so `@trace-kit/renderers` gains no runtime edge to
`@trace-kit/core` merely by accepting a payload. That is what lets `setData(payload)` be a pure
read with zero coupling, and it is why CLAUDE.md rule 5's "renderers must not own the domain model"
costs the renderers nothing.

**`xOrigin`, and the precision problem nobody has written down yet.** `Float32Array` carries ~7
significant decimal digits. An optical spectrum analyzer reporting 1550.123456 nm has ten. Storing
absolute X in f32 quantizes the sweep at roughly 1e-4 nm near 1550 and destroys the fine structure
the instrument exists to resolve. The fix is standard in this domain and costs one f64 field:
**the X buffer holds offsets from `xOrigin`**, and absolute X is `xOrigin + x[i]` computed in f64 at
the (cold) point of display. Over a realistic sweep span the offsets are small and f32 resolves
them to well under the instrument's own resolution. The alternative — an f64 X buffer — doubles X
memory and, more importantly, would make `lttb`'s X parameter `Float64Array`, splitting every
signature in two (see §D5 on monomorphism). Recorded as finding R6: no spec covers this.

**Revision pairing for LTTB indices.** The `spectrum-data-payload` spec requires that an
`Int32Array` of selected indices be valid only against its producing `revision`. The design does
**not** put a `revision` field on the index buffer — that would mean allocating a wrapper object per
decimation, in the hot path. Instead:

```ts
/** Cold-path result envelope. Constructed once per consumer, reused across frames. */
export interface DecimationResultCursor {
  indices: IndexBuffer;
  count: number;
  sourceRevision: number;
}
export function isCursorCurrent(cursor: DecimationResultCursor, p: SpectrumDataPayload): boolean;
```

The cursor is a **caller-owned, reused** struct — allocated once at setup, its three fields written
after each decimation. `lttb` itself never sees it; the caller writes
`cursor.count = lttb(...); cursor.sourceRevision = payload.revision;`. That satisfies the spec's
"carries (or is documented and typed to be used alongside) the producing revision" without putting
an allocation anywhere near a frame. `isCursorCurrent` is the one-line guard a renderer calls before
indexing.

**No nested objects, restated as a decision.** Every field is a primitive or a typed array. This is
simultaneously (a) a GC decision, (b) a V8 hidden-class decision — a payload built once by a single
factory with a fixed field order has one map for the life of the process, so `payload.sampleCount`
is a fixed-offset load — and (c) the reactivity decision from the constraints table: `markRaw` or
`shallowRef` over a flat object is total isolation, and exploration §1.8's identity assertion
(`toRaw(ref.value) === payload`) is expressible in one line.

**Alternatives considered.**

- **A class with a private constructor and getters.** Rejected: getters defeat the fixed-offset load,
  `instanceof` across two copies of the package (a realistic monorepo/npm dedup failure) breaks
  silently, and it makes structural consumption impossible.
- **`Object.freeze` on the payload.** Rejected: it freezes the scalars we must increment, and it
  does not freeze typed-array contents, so it buys the appearance of immutability and none of it.
- **Storing the decimated output inside the payload.** Rejected: the payload is the *authoritative*
  data (transport design §D5); mixing derived output into it makes "which revision is this" ambiguous
  and would put the decimation output on the GL-restore path where it does not belong.
- **`sampleCount` as `x.length` with buffers re-sliced on each update.** Rejected by the `.subarray`
  ban and by the whole preallocation premise.

---

### D3 — `minMaxEnvelope`: signature, layout, bucket math, remainder, NaN

**Decision — signature.** Flat positional parameters. No options object.

```ts
/**
 * Bucketed min/max envelope over `y[sourceOffset … sourceOffset + sampleCount)`.
 * Writes `bucketCount * 2` f32 values interleaved into `out` starting at `outputOffset`.
 * @returns the number of values written (`bucketCount * 2`).
 */
export function minMaxEnvelope(
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Float32Array,
  outputOffset: number,
  bucketCount: number,
): number;
```

**Why not an options object.** Both delta-spec scenarios write
`minMaxEnvelope(x, y, out, { bucketCount, sampleCount })`. An object literal at the call site is an
allocation, and the call site of a per-frame decimation *is* a hot path. V8's escape analysis often
elides such a literal — but "often" is not a gate, and escape analysis is among the first things a
deopt disables, which makes the failure mode exactly the one §D7 exists to detect. Six positional
SMI/typed-array arguments are guaranteed to allocate nothing on every tier. Reported as finding R1.

**Why `x` is not a parameter.** Buckets here are **index ranges over the sample prefix**, so the
function never reads X. Taking an unused `x` parameter adds a call-site argument, a second
typed-array slot to keep monomorphic, and an invitation for a future contributor to "fix" the
function into domain bucketing. The renderer already knows the visible index window (it resolved it
by binary search over the sorted sweep) and passes it as `sourceOffset`/`sampleCount`. Domain-keyed
bucketing — where a sample's bucket is `((x - domainMin) * invBucketWidth) | 0` — is a genuinely
different algorithm and it already has an owner: `BucketAccumulator` in
`core-transport-contract/design.md` §D6, implemented in change 8, where samples arrive out of window
and index bucketing is meaningless. The two coexist deliberately; they are not two spellings of one
thing. Reported as finding R1.

**Decision — output layout: interleaved pairs.** `[min₀, max₀, min₁, max₁, …]`, length
`bucketCount * 2`.

- One monotonically advancing write cursor, one output pointer, sequential stores — the
  prefetch-friendliest possible pattern and the cheapest to bounds-check once at the boundary.
- It is the order the renderer consumes: a Canvas2D envelope draws two vertices per pixel column
  (`lineTo(col, min); lineTo(col, max)`), and a WebGL2 non-interleaved VBO upload of a vertical-span
  strip reads the same pair sequence. Split arrays would make the renderer stride two arrays in
  lockstep for no gain.
- **Alternative: separate `min` and `max` arrays** (the shape `BucketAccumulator` uses). Rejected
  here: it doubles the output parameters and forces two independent output offsets, and the
  accumulator only uses split arrays because it needs a *third* parallel `count` array for
  empty-bucket detection — which this full-pass function does not (see the NaN decision).
- **Alternative: min-block then max-block** (`[min₀…minₙ, max₀…maxₙ]`). Rejected: the renderer would
  traverse the output twice with a large stride, and a sub-window write would need two offsets.

**Decision — bucket boundary math: exact integer partition.**

```ts
const start = sourceOffset + (((b * sampleCount) / bucketCount) | 0);
const end   = sourceOffset + ((((b + 1) * sampleCount) / bucketCount) | 0);
```

This is a **partition**: `start(0) === 0`, `end(bucketCount - 1) === sampleCount`, and
`end(b) === start(b + 1)` for every `b`. No sample is dropped and none is counted twice; adjacent
bucket sizes differ by at most one. **Remainder handling is therefore structural, not a special
case** — there is no trailing-remainder branch at all, which is both faster and impossible to get
wrong.

This directly replaces the probe's `per = (n / b) | 0` form, which iterates `bucketCount * per`
samples and silently discards up to `bucketCount - 1` trailing samples whenever `bucketCount` does
not divide `sampleCount`. On a 1e6/1000 input that tail is empty, which is why the probe passed and
why a property test over *random* lengths is the only thing that would have caught it. The
`decimation-min-max` spec's bounding property does catch it, but only because the property test
generates non-divisible lengths — recorded in the task guidance rather than left to luck.

Numeric safety: `b * sampleCount` must stay exactly representable in f64 (< 2^53) and the quotient
must fit `|0` (< 2^31). Both are guaranteed by the boundary precondition `sampleCount <= 2^31 - 1`
and `bucketCount <= sampleCount`; `bucketCount * sampleCount < 2^62` is comfortably inside f64's
exact-integer range for any `sampleCount` under 2^26 and, above that, the product is still exact
because one factor is small. The validation states the bound explicitly rather than relying on this
argument holding forever.

**Decision — `bucketCount <= sampleCount` is a precondition, not a case.** Validated at the boundary
with a `RangeError`. Consequence: **no bucket is ever empty**, so the loop needs no per-bucket
emptiness branch and the spec's bounding property is total rather than vacuous. Asking for more
buckets than samples is a caller error (an upsample request to a downsampler), and handling it would
cost a branch in the innermost structure to serve a case that has no correct answer. Reported as
finding R3 — no spec states this precondition.

**Decision — NaN is the normative "no sample" sentinel, and an all-gap bucket emits `NaN`/`NaN`.**

This is the sharpest correctness decision in the change. The natural loop is:

```ts
let lo = Infinity;
let hi = -Infinity;
for (let i = start; i < end; i += 1) {
  const v = y[i];
  if (v < lo) lo = v;
  if (v > hi) hi = v;
}
```

Both comparisons are `false` for `NaN`, so NaN samples are **skipped for free** — no branch, no
cost. That is exactly the desired behaviour for a telemetry gap: a bucket containing 99 real samples
and one NaN reports the envelope of the 99. But a bucket whose samples are *all* NaN leaves
`lo === Infinity` and `hi === -Infinity`, and a renderer handed `±Infinity` draws a full-height
vertical spike — a **fabricated feature**, which CLAUDE.md rule 6 forbids more strongly than it
forbids losing one. So:

```ts
if (lo === Infinity) { lo = NaN; hi = NaN; }   // one compare per BUCKET, not per sample
out[w] = lo; out[w + 1] = hi; w += 2;
```

Cost: `bucketCount` comparisons total (≈1,000), against `sampleCount` (≈1,000,000) — three orders of
magnitude cheaper than any per-sample alternative, and allocation-free. Every renderer treats a NaN
vertex as a path break, so an all-gap bucket renders as a gap, which is the truth.

Companion rules, all documented in the function's JSDoc and pinned by tests:

- `±Infinity` **in the input** is a real over-range reading and propagates unchanged. Only the
  *seed* `Infinity` means "nothing seen", and the `lo === Infinity` test cannot confuse the two:
  if a real `+Infinity` sample were present, `hi` would be `+Infinity` and `lo` would also have been
  set to `+Infinity` by `v < lo`… and the bucket would be reported as `[+Inf, +Inf]`, which is
  correct. The one genuinely ambiguous input — a bucket whose only samples are `+Infinity` — reports
  `[+Inf, +Inf]`, not `NaN`, because `v < lo` is false for `v === lo === Infinity`. **This is a real
  edge case and it is resolved by seeding the emptiness test on a separate boolean-free signal**:
  the loop tracks emptiness as `end - start > 0 && lo === Infinity && hi === -Infinity` — both
  seeds intact — which a real `+Infinity` sample breaks (it sets `hi`). Stated precisely so the
  implementation does not "simplify" it back into a bug.
- `-0` and `+0` compare equal under `<`/`>`, so which zero is emitted depends on which arrived
  first. This is stable for a given input, so byte-identity across repeated runs (the determinism
  requirement) holds; it simply is not canonicalized, and canonicalizing it would cost a branch per
  sample for no observable benefit. Documented rather than fixed.
- `out` is written **only** over `[outputOffset, outputOffset + bucketCount * 2)`. Values outside
  that window are untouched — the property the `spectrum-data-payload` spec's sub-window scenario
  asserts.

**Return value.** The count written (`bucketCount * 2`), not `void`. A caller filling a larger
output array advances its cursor by the return value instead of recomputing the product, which keeps
the arithmetic in one place. The spec permits either.

**Trade-offs.** Six positional parameters is a wide signature that is easy to mis-order; mitigated
by the axis brands (an `IndexBuffer` cannot be passed as `y`) and by the fact that the two numeric
pairs are adjacent and distinctly named. The `bucketCount <= sampleCount` precondition pushes an
error onto a caller that could have been served a degenerate result; accepted, because the
degenerate result has no correct definition.

---

### D4 — `lttb`: signature, single-pass bucket math, endpoints, determinism

**Decision — signature.**

```ts
/**
 * Largest-Triangle-Three-Buckets over `x`/`y` at `[sourceOffset … sourceOffset + sampleCount)`.
 * Writes `threshold` **absolute** indices into `out` starting at `outputOffset`.
 * @returns the number of indices written (`threshold`).
 */
export function lttb(
  x: Float32Array,
  y: Float32Array,
  sourceOffset: number,
  sampleCount: number,
  out: Int32Array,
  outputOffset: number,
  threshold: number,
): number;
```

**Absolute, not window-relative, indices.** The emitted values index `x`/`y` directly (they include
`sourceOffset`). Window-relative indices would force every consumer to add the offset inside its own
render loop — an addition per drawn vertex, in the hottest code in the project, to save one addition
per *bucket* here. The `decimation-lttb` spec's "every index lies in `[0, sampleCount)`" therefore
reads as `[sourceOffset, sourceOffset + sampleCount)` in the general case; reported as finding R4.

**`Int32Array` output.** Fixed by the spec and by exploration §1.11: it removes an allocation, avoids
duplicating the sample data, and lets the renderer index the original retained buffers so a
context-loss re-upload needs no re-decimation. `Int32Array` rather than `Uint32Array` because the
`-1` sentinel is the established "no die / no sample" convention in this codebase (exploration §1.11's
wafer occupancy grid) and because a 2^31 sample ceiling is far beyond any realistic sweep.

**Bucket math, single pass.** With `threshold >= 2`, index `0` and index `sampleCount - 1` are
reserved endpoints, and the `threshold - 2` interior buckets partition `[1, sampleCount - 1)` with the
same exact integer partition as §D3:

```ts
const interior = sampleCount - 2;
const buckets  = threshold - 2;
// bucket j covers [1 + ((j * interior) / buckets | 0), 1 + (((j+1) * interior) / buckets | 0))
```

Guard first: when `threshold === 2` the bucket loop must not run — `buckets === 0` and the division
would yield `Infinity`, which `|0` silently turns into `0`, producing a plausible-looking wrong
answer rather than a crash. That branch is taken once per call, before the loop.

**"Single pass", stated precisely.** Canonical LTTB needs the *mean* of bucket `j+1` while scanning
bucket `j`. The implementation is **one forward traversal with no backtracking and no scratch
buffer**, in which each sample is read exactly twice: once accumulating its own bucket's mean, once
as a triangle-area candidate in its own bucket. That is `O(n)` with a constant of 2, not `O(n)` with
a constant of 1. §D3's `minMaxEnvelope` is genuinely 1 read per sample. This distinction matters
because the `decimation-min-max` spec asserts an instrumented one-read-per-sample count and the
`decimation-lttb` spec says "single O(n) pass" — verify must not read the second as the first.
Reported as finding R5.

- **Alternative: precompute all bucket means into a caller-supplied scratch `Float32Array`
  (1 read/sample + a scratch pass).** Rejected: it adds a seventh parameter with its own lifetime and
  sizing rule for a memory-bandwidth win that is speculative on a sequential f32 stream already
  resident in L2, and it moves an allocation decision onto the caller.
- **Alternative: two full passes.** Rejected: doubles the cold-cache traversal for no structural gain.

**Endpoint retention is structural.** `out[outputOffset] = sourceOffset` and
`out[outputOffset + threshold - 1] = sourceOffset + sampleCount - 1` are assigned outside the bucket
loop. The first and last points are not "usually selected"; they are written unconditionally, so the
spec's endpoint-retention requirement cannot fail as a consequence of an interior-selection bug.
Strict monotonicity then follows from the partition: each bucket's selected index lies inside that
bucket's half-open range, and the ranges are disjoint and increasing.

**Determinism constraints.**

- **f64 accumulation.** `sumX`/`sumY` are plain `number` locals — f64, the native width, never
  `Math.fround`ed to f32. Reading `y[i]` from a `Float32Array` widens exactly (every f32 is an f64),
  so no rounding is introduced by the read. Accumulation order is fixed by ascending index, so the
  sum is bit-reproducible; summing in any other order (or in parallel) is not, and that is why no
  "optimization" may reorder it.
- **Banned `Math` functions, stated correctly.** ECMA-262 permits implementation-dependent results
  only for the **transcendental** functions: `sin cos tan asin acos atan atan2 exp expm1 log log2
  log10 log1p pow cbrt sinh cosh tanh asinh acosh atanh hypot`. Those are banned from
  `src/decimation/**`. `Math.abs`, `Math.min`, `Math.max`, `Math.floor`, `Math.trunc`, `Math.round`,
  `Math.sign` and `Math.sqrt` are exactly specified and would be safe — but LTTB needs **none of
  them**: the doubled triangle area is `(ax - cx) * (by - ay) - (ax - bx) * (cy - ay)`, built from
  `*` and `-` only, and its magnitude is taken with `area < 0 ? -area : area`, which avoids a
  builtin call entirely. Bucket boundaries use `| 0` rather than `Math.floor` (both exact; `| 0`
  avoids the float→int→float round trip and keeps the value SMI-tagged). The lint rule bans the
  transcendental set by name; the implementation happens to use no `Math` at all.
- **Tie-breaking is first-wins.** The candidate comparison is strict `>` (`if (area > bestArea)`),
  so among equal-area candidates the lowest index is kept. `>=` would keep the highest. Both are
  defensible; the choice must be *pinned*, because it is the only thing standing between "identical
  input yields identical output" and "identical input yields one of several outputs" on a flat or
  perfectly periodic signal — precisely the synthetic signals a property test generates. The golden
  fixture encodes it. Reported as finding R7: no spec states a tie-break rule.
- **No NaN special-casing in LTTB.** A NaN Y value produces a NaN area, and `NaN > bestArea` is
  `false`, so a NaN candidate is never selected unless the entire bucket is NaN — in which case
  `bestIndex` retains its initialization to the bucket's first index, which keeps monotonicity and
  emits a real (if gap-valued) sample. That is the right outcome and it costs zero branches; it is
  documented because it is non-obvious and a future contributor "fixing" it would introduce a branch
  per sample.

**Preconditions, validated at the boundary.** `threshold >= 2`; `threshold <= sampleCount`;
`sampleCount >= 2`; `out.length >= outputOffset + threshold`; every numeric argument an integer in
`[0, 2^31)`. `threshold === sampleCount` is legal and yields the identity selection. Reported as
finding R3 — no spec states these.

---

### D5 — Allocation-free loop discipline: how the ban is actually enforced

**Decision.** Three independent instruments at three different levels, none of which can substitute
for another, plus one architectural rule about argument shapes.

**1. Source level — an AST-scoped ESLint block, added to the existing flat config.**

A new config object in `eslint.config.js`, scoped by `files: ["packages/core/src/decimation/**/*.ts"]`
(and, from change 3 onward, `src/transport/**`), carrying its own `no-restricted-syntax` entries.
The critical mechanical detail: **the ban is on the loop body, not the file**, because boundary
validation must construct and throw a `RangeError` before the loop. That is expressible directly as
a descendant selector:

```text
:matches(ForStatement, WhileStatement, DoWhileStatement) ObjectExpression
:matches(ForStatement, WhileStatement, DoWhileStatement) ArrayExpression
:matches(ForStatement, WhileStatement, DoWhileStatement) TemplateLiteral
:matches(ForStatement, WhileStatement, DoWhileStatement) NewExpression
:matches(ForStatement, WhileStatement, DoWhileStatement) ArrowFunctionExpression
:matches(ForStatement, WhileStatement, DoWhileStatement) FunctionExpression
:matches(ForStatement, WhileStatement, DoWhileStatement) SpreadElement
:matches(ForStatement, WhileStatement, DoWhileStatement) MemberExpression[property.name=/^(map|filter|slice|subarray|reduce|reduceRight|forEach|flatMap|concat|entries|keys|values|toSorted|toReversed|with)$/]
:matches(ForStatement, WhileStatement, DoWhileStatement) MemberExpression[object.name="Math"][property.name=/^(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log2|log10|log1p|pow|cbrt|sinh|cosh|tanh|asinh|acosh|atanh|hypot)$/]
```

plus these, unscoped across the whole glob because they are never acceptable in a hot-path module:

```text
ForOfStatement
RestElement
Identifier[name="arguments"]
YieldExpression
AwaitExpression
FunctionDeclaration[async=true]
FunctionDeclaration[generator=true]
```

Each carries a message naming the remedy. `FunctionDeclaration` at module scope is deliberately
*not* banned (a module-scope helper is fine and may be inlined by V8); only nested function
*expressions* and arrows, which are the per-call-closure shape, are. `MemberExpression` matching by
property name is deliberately over-broad — it also flags `someArray.slice` on a cold local — and the
over-breadth is the same trade already accepted for the `as unknown as` selector in change 1 §D1.b: a
false positive costs one justified `eslint-disable-next-line` with a reason in the diff; a false
negative is a silently allocating render loop.

**2. The instrument must be proven live.** Following the D1.d precedent already running in this
repository: `packages/core/test/fixtures/hot-path-violation.ts` contains `src.subarray(start, end)`
inside a `for` body (and a second fixture with an object literal in a loop). The main `eslint .` run
ignores `**/test/fixtures/**`, so `turbo run lint` stays green; `packages/core/test/lint-hot-path.test.ts`
drives the ESLint Node API against the same flat config with the ignore lifted and asserts the exact
rule ID fires on the exact file and line — mirroring `lint-rules.test.ts`, which already does this
for `no-explicit-any`. The `allocation-free-hot-path` spec's two scenarios (fixture rejected, real
implementation clean) map one-to-one onto this test's two assertions.

The `allocation-free-hot-path` spec names `packages/core/src/transport/**` in its check scope. That
directory does not exist until change 3. The glob is written now and matches nothing; the meta-test
asserts the *decimation* glob only, so the check cannot pass vacuously today. Reported as finding R8.

**3. Argument monomorphism strategy.** Lint cannot see a deopt, and a deopt materializes locals to
the heap, which defeats everything above. Four rules, all structural:

- **No union-typed parameters in `src/decimation/**`, ever.** `y: Float32Array`, never
  `Float32Array | Float64Array`. If an f64 variant is ever needed it is a **separate named function**
  (`minMaxEnvelopeF64`), not an overload and not a union. This is not stylistic: the
  `benchmark-harness` spec's own deopt fixture proposes exactly the `Float32Array`-then-`Float64Array`
  call pattern as its *injected defect*, so shipping that pattern in production code would be
  shipping the thing the gate exists to catch.
- **Branded parameters are declared at their base type.** Hot-path functions take `Float32Array`,
  not `XBuffer`. Branded values widen to it for free (§D1), and because the brand has no runtime
  representation both arrive with the same hidden class — so accepting both is monomorphic, not
  bimorphic. Branding is enforced at the *payload* boundary, where it belongs, not at every
  numeric call.
- **Every numeric parameter is a non-negative integer inside SMI range**, validated at the boundary.
  A heap-number index would tag every array access as a double-keyed load.
- **No default parameter values and no optional parameters** in hot-path signatures: an omitted
  argument is `undefined`, which is a second type at that slot.

**4. Boundary validation placement.** One validation prologue at the top of each exported function —
in the same function, not behind a separate call, so V8's inlining decisions are unaffected and the
branches predict not-taken. The prologue may construct and throw a `RangeError` with an
interpolated message, because a throw terminates the call and is by definition not the hot path;
the ban is on `new Error(...)` *inside the loop*, which the loop-scoped selector expresses exactly.
No validation of any kind appears inside a loop body: the loop's bounds are already proven correct
by the prologue, and `noUncheckedIndexedAccess` (on in `tsconfig.base.json`) is satisfied by reading
through a local (`const v = y[i]; if (v === undefined) …` would itself be a hot-path branch — instead
the implementation reads `y[i]` into a `number`-typed local via the non-null pattern the prologue
justifies, documented at the call site; if that requires a single `!` it is preferable to a
per-sample branch and is not on the banned-assertion list).

**Alternatives considered.** A `grep`-based CI check only — rejected for the same reason change 1
rejected it for `any`: it cannot tell a `.slice` in a comment from one in a loop, and it cannot scope
to a loop body at all. A custom ESLint rule in a local plugin — deferred: the selector list above is
expressible declaratively today, and a plugin is worth writing only when the rule needs type
information (e.g. "this `.set` target is a transit buffer"), which is change 3's problem. Relying on
the GC gate alone — rejected: the gate tells you *that* something allocated, never *where*, and a
source rule fails in the editor rather than in CI.

---

### D6 — The GC-event gate: mechanics

**Decision.** `packages/core/test/decimation/allocation-gate.test.ts`, running inside the existing
`core` Vitest project, under a forked pool carrying `--expose-gc`, with the allocating control in
the same file and a hard failure when the instrument is absent.

**`--expose-gc` plumbing — there is exactly one wiring that works.** This is the load-bearing
mechanical finding of the section, and two of the three obvious approaches are not merely worse,
they are impossible:

| Approach | Verdict |
|---|---|
| `NODE_OPTIONS=--expose-gc vitest run` | **Impossible.** `--expose-gc` is a V8 option, and Node rejects V8 options in `NODE_OPTIONS` with `is not allowed in NODE_OPTIONS`. The command fails to start. |
| `poolOptions.threads.execArgv` | **Impossible.** `worker_threads` rejects V8 options in a worker's `execArgv` (`ERR_WORKER_INVALID_EXEC_ARGV`). The default Vitest pool is threads, so the naive attempt fails here. |
| `poolOptions.forks.execArgv` with `pool: 'forks'` | **Works.** A forked child process is spawned with its own argv, and V8 flags are legal there. |

So the `core` project in the root `vitest.config.ts` gains `pool: 'forks'` and
`poolOptions: { forks: { execArgv: ['--expose-gc'] } }`. This is not a preference; it is the only
option that runs. Cost: the fork pool has a higher per-file startup than threads. Confined to the
`core` project, which today holds ten small files; the future `jsdom` project (changes 5/10/11) is a
separate array entry and keeps the default pool.

**The gate must not be able to skip itself.** The first assertion in the file is
`expect(typeof globalThis.gc).toBe('function')`, failing — not skipping — when `--expose-gc` is
absent. A gate that silently converts to a skip when its flag is dropped is the vacuity failure
change 1 built an entire guard script to prevent; the same discipline applies here and `it.skipIf`
is banned in this file.

**The measured window, per the C4b probe's shape.**

```text
1. build inputs once, OUTSIDE the window (Float32Array source, Float32Array out)
2. warm up >= 20 iterations          ← TurboFan must have tiered; the interpreter's own
                                        bookkeeping otherwise appears as allocation
3. globalThis.gc(); await sleep(30)  ← drain. GC entries are delivered asynchronously, so a
                                        window opened without a drain attributes the warm-up's
                                        scavenge to the measurement
4. events.length = 0
5. run N measured iterations
6. await sleep(30); assert events.length === 0
```

Step 3's drain is not defensive padding — it is the step that makes the assertion an assertion
about the measured window rather than about the preceding one, and it is in the committed probe for
that reason.

**Observer configuration and failure diagnostics.** `new PerformanceObserver(list => …)` with
`observe({ entryTypes: ['gc'] })`, `buffered: false`. Each captured entry records `detail.kind` and
`detail.flags` resolved against `perf_hooks.constants.NODE_PERFORMANCE_GC_*`
(`GC_MINOR`, `GC_MAJOR`, `GC_INCREMENTAL`, `GC_WEAKCB`). The assertion is **zero entries of any
kind**, but the failure message names the kind — because a `GC_MAJOR` fired by unrelated process
activity is a different diagnosis from a `GC_MINOR` scavenge caused by the loop, and a gate that
reports only a number generates a bug report nobody can act on.

**Iteration counts — the spec's number is unrunnable as literally paired with the benchmark size.**
The `decimation-min-max` and `decimation-lttb` specs say "invoked 10,000 times" and name no input
size; the informational benchmark names 1e6 samples. 10,000 × 1e6 is ~1e10 element reads — hours.
The gate therefore runs **two configurations**, both asserted at zero:

| Configuration | sampleCount | buckets / threshold | iterations | ~wall clock | Purpose |
|---|---|---|---|---|---|
| `small` | 4,096 | 512 | 10,000 | ~1 s | satisfies the spec's 10,000-iteration count; many calls, so a per-call allocation cannot hide |
| `large` | 1,000,000 | 1,000 | 200 | ~2 s (probe: 1.72 ms/iter) | reproduces the C4b measurement exactly; a per-sample allocation cannot hide |

The two are complementary: a per-*call* allocation (an options object, a closure) shows up in
`small`; a per-*sample* or per-*bucket* allocation shows up in `large`. Neither alone is sufficient.
Reported as finding R9.

**The allocating control, and what its failure means.** `packages/core/test/decimation/allocating-control.ts`
(test-only, never under `src/`, so `tsup` never sees it and the hot-path lint glob never matches it)
holds `minMaxEnvelopeAllocating` — the probe's `minMaxAlloc`, constructing `{ lo, hi }` per bucket
into a growing array — and an equivalent `lttbAllocating` using `.slice()` per bucket. Each is
measured in the same file, through the same observer, over the same iteration counts, and asserted
`> 0`.

**The control's failure invalidates the real variant's pass, not just its own test.** This is the
C4b 0-versus-17 discrimination made mechanical: if the control reports `0`, the instrument is not
measuring anything, and the allocation-free result is therefore meaningless rather than good. The
file expresses that by running the control **first**, in a `beforeAll`, and throwing from there —
which aborts the whole file rather than producing a green "allocation-free" test beside a red
control. A green pass beside a red control is the single most misleading artifact this gate could
produce.

**`v8.getHeapStatistics()` is diagnostic, never asserted.** The probe measured a 32,104-byte
`used_heap_size` delta in the *allocation-free* case — observer bookkeeping, not the loop. Any
absolute-delta assertion would therefore fail on the passing variant. The value is captured and
printed on failure to help distinguish "the loop allocated" from "something else in the process
did"; it gates nothing. This is the concrete reason claim **C4**'s rejection of magnitude-based
memory assertions applies to `getHeapStatistics` too, not only to `performance.memory`.

**Isolation.** The gate is a full-file concern: an allocation in a *sibling* test file sharing the
process would poison it. Vitest's default `isolate: true` under `pool: 'forks'` gives each test file
its own child process, which is the isolation required; the file additionally declares
`describe.sequential` so its own cases cannot interleave. `singleFork` must stay `false` (the
default) — setting it would put every file in one process and break the gate.

**CI versus local.** The gate **runs in CI and blocks**, because a GC-event *count* is deterministic
and hardware-independent — it is not a timing number, and CPU steal on a shared runner does not
change whether a scavenge happened. This is precisely the distinction confirmed decision 3 draws:
event counts and work counts gate; wall-clock milliseconds do not. The 4 ms / 12 ms figures remain
informational and appear in no CI step. The residual CI risk is a `GC_MAJOR` triggered by unrelated
runner pressure producing a flake; mitigated by per-file process isolation, by the pre-window
`gc()` + drain, and by the failure message naming the kind so a flake is recognizable as one rather
than being silenced with a retry.

---

### D7 — `--trace-deopt` harness mode

**Decision.** A parent/child mode on the existing `packages/core/bench/` runner, invoked as
`tsx bench/index.ts --trace-deopt` behind a new `bench:deopt` package script, with a mandatory
self-check.

`--trace-deopt` is a V8 flag that must be set at process start and writes to the process's own
stdout, so it cannot be applied from inside `runner.ts`. The mode is therefore a supervisor:

```text
bench/index.ts                    argv dispatch
  ├─ (no flag)      → runBenchmarkSuite([minMaxEnvelope, lttb, …])  → bench-results.json
  └─ --trace-deopt  → bench/trace-deopt.ts
        spawnSync(process.execPath, ['--trace-deopt', tsxLoader, 'bench/deopt-workload.ts'])
        capture stdout + stderr
        parse   /\[(?:deoptimizing|bailout)[^\n]*<JSFunction (\w+)/g
        ├─ TARGETS  = ['minMaxEnvelope', 'lttb']        → any hit  ⇒ exit 1  (real deopt)
        └─ SENTINEL = ['injectedDeoptFixture']          → no hit   ⇒ exit 2  (instrument broken)

bench/deopt-workload.ts           runs in the traced child
  ├─ imports minMaxEnvelope / lttb from ../src/…  (SOURCE, so trace names match source names)
  ├─ warms each to tier-up, then N monomorphic calls
  └─ runs injectedDeoptFixture() — deliberately deopts, see below
```

**The fail-loudly clause, and why it is not optional.** A parser that finds no deopt lines is
indistinguishable from a parser whose pattern stopped matching after a V8 upgrade. So the traced
child *also* runs a fixture engineered to deopt, and the mode **fails with exit 2 when it does not
see that deopt**. Exit 1 (a real deopt in a target) and exit 2 (the instrument is broken) are
distinct codes — the exact discipline `scripts/verify-turbo-ran.mjs` already uses in this
repository for schema drift versus a genuine vacuous task.

**The fixture shape.** The `benchmark-harness` spec proposes "called once with a `Float32Array` and
once with a `Float64Array`". In modern V8 that produces a *polymorphic inline cache*, and frequently
no `[deoptimizing …]` line at all — an element-kind or map mismatch at a load site can be handled
by the polymorphic IC without a bailout, especially for a function that is still in the feedback
vector's warm-up phase. A fixture that may or may not emit the line it is being asserted on is a
flaky sentinel. The reliable shape is a **map transition after tier-up**:

```ts
function injectedDeoptFixture(shape: { a: number }): number { return shape.a + 1; }
// warm 100k times with { a: 1 }  → optimized against that exact map
// then call once with { a: 1, b: 2 } → wrong map ⇒ eager deopt, reliably traced
```

Reported as finding R10.

**Why source, not `dist`.** `deopt-workload.ts` imports from `../src/decimation/*.ts` so the
`<JSFunction name>` in the trace is the authored name. A `tsup`-bundled build can rename or inline
the function, making the target unmatchable — which would trip the exit-2 sentinel only if the
sentinel were also bundled, and silently pass otherwise.

**Not a CI gate.** Consistent with change 1 §D6's `bench` separation: no `turbo.json` task, no
`ci.yml` step. `--trace-deopt` output is high-volume and V8-version-sensitive, which makes it a poor
merge gate and a good pre-merge and pre-release local check. The `benchmark-harness` spec requires
the harness to *support* the mode and surface a failure — not that CI run it — and that is the
reading applied. The run's output is captured into
`openspec/changes/core-decimation-math/evidence/trace-deopt.txt` as the change's evidence, the same
way change 1 committed its baseline capture.

---

### D8 — `fast-check` integration

**Decision.**

- **Catalog pin.** `pnpm-workspace.yaml` gains `'fast-check': '^4.0.0'` under `catalog:`;
  `packages/core/package.json` declares `"fast-check": "catalog:"` in `devDependencies`. The exact
  4.x resolved is fixed by `pnpm-lock.yaml`. The `^4` floor is chosen because the v4 line is the one
  where `fc.assert`/`fc.property`, the `fc.float`/`fc.double` split and `fc.configureGlobal` are
  stable and the deprecated v2-era surface is gone; the repository's `engines.node: ">=24"` is well
  above v4's floor. The catalog pin is also what satisfies the `test-harness` delta and what makes
  `scripts/verify-catalog-discipline.mjs` govern `fast-check` automatically — that script derives its
  governed set from the catalog keys (change 1 §D7), so adding the key is the entire enforcement step.
- **File convention.** Property tests live at `packages/core/test/decimation/*.property.test.ts`
  and `packages/core/test/buffers/*.property.test.ts`. The `.property.` infix (still matching the
  `core` project's `test/**/*.test.ts` include) lets a later change filter them — run 200 runs on
  every push and 5,000 nightly — without moving files or changing globs.
- **Shared arbitraries** in `packages/core/test/arbitraries.ts`: `arbFloat32Series(min, max)`,
  `arbFloat32SeriesWithGaps(...)` (injects NaN runs, exercising §D3's gap contract),
  `arbBucketCount(sampleCount)` (respecting §D3's `bucketCount <= sampleCount` precondition),
  `arbThreshold(sampleCount)`, and `arbLorentzianPeak()` for the peak-fidelity property.
  `fc.float()` — not `fc.double()` — generates f32-representable values, so a generated series
  survives a `Float32Array` round trip unchanged and a property failure is never an artifact of
  narrowing. Series lengths are drawn to deliberately include values **not divisible by**
  `bucketCount`, since that is the only input class that catches the probe's dropped-tail bug.
- **Reproducibility convention.** Seeds are **not** fixed globally — a fixed seed converts a property
  test into an expensive unit test. Instead `packages/core/test/setup/fast-check.ts` (registered via
  the `core` project's `setupFiles`) calls
  `fc.configureGlobal({ numRuns: 200, verbose: fc.VerbosityLevel.VeryVerbose })` so every failure
  prints the shrunk counterexample together with the `seed` and `path` needed to replay it, and a CI
  failure is reproduced locally by pasting them into `fc.assert(prop, { seed, path })`.
  `numRuns` is lowered per-property to 25–50 for the 1e6-sample cases.
- **Hard separation from the allocation gate.** `fast-check` allocates heavily by construction (a new
  generated case per run). Property tests therefore never run under the GC observer and never assert
  timing. `*.property.test.ts` and `allocation-gate.test.ts` are disjoint files with disjoint
  purposes, stated in a comment in each, because a future contributor merging them would produce a
  gate that fails for the right reason and the wrong cause.

**Alternatives considered.** `@fast-check/vitest` (the integration wrapper providing `test.prop`) —
deferred: it is a second catalog entry with its own version coupling to both Vitest and fast-check,
for syntactic sugar over `it('…', () => fc.assert(fc.property(…)))`. Revisit at change 16 if the
property surface grows large. Hand-rolled randomized loops — rejected: no shrinking, so a failure
reports a 1e6-element counterexample instead of the three-element one that explains it.

---

### D9 — Public export surface of `@trace-kit/core`

**Decision.** `packages/core/src/index.ts` becomes a pure re-export barrel; `VERSION` moves to
`src/version.ts`.

```ts
export { VERSION } from './version.js';

export type {
  BufferAxis, OwnershipClass, Branded,
  XBuffer, YBuffer, IndexBuffer,
  Retained, Transit,
  TransitXBuffer, TransitYBuffer, TransitIndexBuffer, TransferableBacking,
} from './buffers/brand.js';
export {
  asXBuffer, asYBuffer, asIndexBuffer,
  allocateXBuffer, allocateYBuffer, allocateIndexBuffer,
} from './buffers/brand.js';

export type { SpectrumDataPayload, DecimationResultCursor } from './payload/spectrum-data-payload.js';
export {
  createSpectrumDataPayload, commitPayloadRevision, isCursorCurrent,
} from './payload/spectrum-data-payload.js';

export { minMaxEnvelope } from './decimation/min-max.js';
export { lttb } from './decimation/lttb.js';
```

Deliberately **not** exported, each for a reason:

| Not exported | Why |
|---|---|
| `MutableSpectrumDataPayload` | The mutation capability is the entry point `commitPayloadRevision`, not a type a consumer can obtain and write through. |
| `assertUsableBuffer`, `assertCapacity`, the boundary validators | Internal contracts. Exporting them invites a consumer to pre-validate and then call a hot path that validates again. |
| Bucket-boundary helpers | Implementation detail of §D3/§D4; exporting them would freeze the partition formula as public API. |
| `collectTransferList`, `Lease`, pool types | Change 3. Only the `Transit`/`TransferableBacking` *types* ship now, because the payload spec requires the distinction to exist. |
| `BucketAccumulator`, `RawSampleRing` | Change 8. |

Mechanical consequences, all mandatory rather than optional:

- `export type` is required for every type-only re-export because `isolatedModules: true` is on in
  `tsconfig.base.json`. A plain `export { XBuffer }` fails the build.
- Every re-export uses an explicit `.js` extension on a `.ts` source path — the repository is
  `"type": "module"` with `moduleResolution: "bundler"`, and the extension keeps the same sources
  resolvable under `node16` when change 12 tightens resolution.
- **`packages/core/SIDE_EFFECTS_AUDIT.md` must gain a row for every new file under `src/`.**
  `packages/core/test/side-effects-audit.test.ts` already asserts **set equality in both
  directions** between the audit table and the files on disk, so adding `src/version.ts`,
  `src/buffers/brand.ts`, `src/payload/spectrum-data-payload.ts`, `src/decimation/min-max.ts`,
  `src/decimation/lttb.ts` and `src/decimation/index.ts` without updating the audit fails the
  existing test. Each new file is a pure declaration-and-export module with no import-time side
  effect, so `"sideEffects": false` remains a true claim.
- The bench entry moves off `placeholderWorkload()` onto `minMaxEnvelope` and `lttb`, satisfying the
  `benchmark-harness` delta's "real first consumer" requirement, and `bench/README.md` gains the
  declared reference-hardware record (the machine, its `runner` block from a real run, and the
  statement that the 4 ms / 12 ms figures are informational).

---

## File Changes

| Action | File Path | Description |
|--------|-----------|-------------|
| MODIFY | `pnpm-workspace.yaml` | Catalog gains `fast-check: '^4.0.0'` (§D8). Globs unchanged. |
| MODIFY | `packages/core/package.json` | `devDependencies` gains `"fast-check": "catalog:"`; `scripts` gains `"bench:deopt": "tsx bench/index.ts --trace-deopt"`. |
| MODIFY | `vitest.config.ts` | `core` project gains `pool: 'forks'`, `poolOptions.forks.execArgv: ['--expose-gc']`, and `setupFiles: ['test/setup/fast-check.ts']` (§D6, §D8). |
| MODIFY | `eslint.config.js` | New config block scoped to `packages/core/src/decimation/**` carrying the loop-scoped ban-list selectors (§D5). |
| NEW | `packages/core/src/version.ts` | `VERSION` relocated so `index.ts` is a pure barrel. |
| NEW | `packages/core/src/buffers/brand.ts` | `AxisTag`/`OwnershipTag` unique symbols, `Branded`, `Retained`/`Transit`, the six aliases, `TransferableBacking`, the narrowing constructors (§D1). |
| NEW | `packages/core/src/payload/spectrum-data-payload.ts` | `SpectrumDataPayload`, internal mutable twin, `createSpectrumDataPayload`, `commitPayloadRevision`, `DecimationResultCursor`, `isCursorCurrent` (§D2). |
| NEW | `packages/core/src/decimation/min-max.ts` | `minMaxEnvelope` (§D3). |
| NEW | `packages/core/src/decimation/lttb.ts` | `lttb` (§D4). |
| NEW | `packages/core/src/decimation/index.ts` | Internal barrel for the two algorithms. |
| MODIFY | `packages/core/src/index.ts` | Becomes the public barrel of §D9. |
| MODIFY | `packages/core/SIDE_EFFECTS_AUDIT.md` | One row per new `src/` file — required by the existing both-directions set-equality test. |
| NEW | `packages/core/test/buffers/brand-erasure.test.ts` | Prototype identity, `instanceof`, own-property/own-symbol equality against a plain typed array (§D1). |
| NEW | `packages/core/test/buffers/brand-types.test-d.ts` | `tsc --noEmit` fixture: `YBuffer` rejected where `XBuffer` expected; `Retained` rejected where `Transit` expected. |
| NEW | `packages/core/test/payload/payload.test.ts` | Factory output shape, `sampleCount` vs `capacity`, `revision` monotonicity, extents recomputation, retained/transit backing-store disjointness. |
| NEW | `packages/core/test/decimation/min-max.test.ts` | Unit + golden fixture + NaN/all-gap/`±Infinity`/`-0` edge cases + exact-partition tail coverage. |
| NEW | `packages/core/test/decimation/min-max.property.test.ts` | Per-bucket bounding property; output-length property; sub-window non-clobber property (§D8). |
| NEW | `packages/core/test/decimation/lttb.test.ts` | Unit + golden fixture + `threshold === 2` and `threshold === sampleCount` edges + tie-break pinning. |
| NEW | `packages/core/test/decimation/lttb.property.test.ts` | Subset, strict monotonicity, endpoint retention, output length. |
| NEW | `packages/core/test/decimation/peak-fidelity.property.test.ts` | Randomised Lorentzian position/width; peak survives both algorithms (CLAUDE.md rule 6). |
| NEW | `packages/core/test/decimation/determinism.test.ts` | Byte-identical output across repeated runs; golden fixtures stable. |
| NEW | `packages/core/test/decimation/allocation-gate.test.ts` | The GC gate: `small` and `large` configurations, control-first `beforeAll`, kind-naming diagnostics (§D6). |
| NEW | `packages/core/test/decimation/allocating-control.ts` | Test-only allocating variants of both algorithms (the C4b control). |
| NEW | `packages/core/test/lint-hot-path.test.ts` | ESLint Node API meta-test asserting the ban-list rules fire on the hot-path fixtures (§D5). |
| NEW | `packages/core/test/fixtures/hot-path-violation.ts` | Permanent regression assets: `.subarray` in a loop; object literal in a loop. Ignored by the main lint run. |
| NEW | `packages/core/test/arbitraries.ts` | Shared `fast-check` arbitraries (§D8). |
| NEW | `packages/core/test/setup/fast-check.ts` | `fc.configureGlobal` — `numRuns`, verbose shrink output with seed/path (§D8). |
| NEW | `packages/core/test/fixtures/golden/{min-max,lttb}.json` | Committed golden input/output fixtures for the determinism requirement. |
| MODIFY | `packages/core/bench/index.ts` | `placeholderWorkload()` replaced by real `minMaxEnvelope`/`lttb` benchmarks; argv dispatch for `--trace-deopt` (§D7). |
| NEW | `packages/core/bench/trace-deopt.ts` | Supervisor: spawn traced child, parse, exit 1 (real deopt) vs exit 2 (sentinel missed) (§D7). |
| NEW | `packages/core/bench/deopt-workload.ts` | Traced child: monomorphic target calls plus `injectedDeoptFixture` (§D7). |
| MODIFY | `packages/core/bench/README.md` | Declared reference-hardware record; the 4 ms / 12 ms figures marked informational and non-gating; the `--trace-deopt` mode documented with its two exit codes. |
| NEW | `openspec/changes/core-decimation-math/evidence/trace-deopt.txt` | Captured `--trace-deopt` run output. |
| NEW | `openspec/changes/core-decimation-math/evidence/gc-gate.txt` | Captured gate run: zero for both variants, non-zero for both controls. |
| NEW | `.changeset/*.md` | One `patch` bump for `@trace-kit/core` (CLAUDE.md rule 8). |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **The gate passes vacuously** — `--expose-gc` silently absent, the observer never fires, and "0 GC events" means "no measurement". | **High** — it would ship the project's headline guarantee as a decoration. | §D6: hard failure (not skip) when `globalThis.gc` is undefined; the allocating control runs **first** in `beforeAll` and its zero aborts the whole file; captured evidence committed. |
| `--expose-gc` cannot be delivered: `NODE_OPTIONS` rejects V8 flags and `worker_threads` rejects them in `execArgv`. | High — blocks the gate entirely, and the two obvious fixes both fail. | §D6: `pool: 'forks'` + `poolOptions.forks.execArgv`. Identified before implementation rather than after two failed attempts. |
| **The probe's bucket math is copied verbatim** and silently drops up to `bucketCount - 1` trailing samples. | High — a discarded measurement is a rule-6 violation that no divisible-length test detects. | §D3's exact integer partition; property arbitraries deliberately generate non-divisible lengths. |
| **An all-gap bucket emits `±Infinity`** and the renderer draws a fabricated full-height spike. | High — fabricated data is worse than lost data under rule 6. | §D3: one per-bucket emptiness compare emitting `NaN`/`NaN`; the real-`+Infinity` ambiguity resolved by testing both seeds, not one. |
| A per-call options-object literal allocates at the call site, inside the frame loop, and escapes the loop-scoped lint rule entirely. | Medium-High | §D3/§D4: flat positional parameters, no options object anywhere in the hot-path signatures. The spec scenarios' object form is reported, not transcribed. |
| The `--trace-deopt` parser stops matching after a V8 upgrade and the mode reports clean forever. | Medium | §D7: the injected-deopt sentinel must be **detected**; exit 2 when it is not, distinct from exit 1. |
| The deopt fixture (`Float32Array` then `Float64Array`) produces a polymorphic IC but no traced deopt, so the sentinel itself is flaky. | Medium | §D7: map-transition fixture instead; reported as spec finding R10. |
| A union-typed or optional hot-path parameter reintroduces polymorphism, V8 deopts, and locals materialize to the heap — defeating both the lint and the gate. | Medium | §D5: no unions, no defaults, no optionals in `src/decimation/**`; an f64 variant would be a separately named function. Branded types widen to the base, so branding adds no map. |
| f32 X buffers quantize an absolute wavelength like 1550.123456 nm below instrument resolution. | Medium — silent loss of exactly the fine structure the product exists to resolve. | §D2: X holds offsets from an f64 `xOrigin`. Reported as finding R6 (no spec covers it). |
| LTTB tie-breaking left unpinned, so a flat or periodic signal yields one of several valid outputs and the determinism requirement fails intermittently. | Medium | §D4: strict `>` (first-wins), documented, pinned by the golden fixture. Reported as finding R7. |
| The hot-path lint glob names `src/transport/**`, which does not exist, and the check passes over nothing. | Low here, Medium at change 3 | §D5: the meta-test asserts against the *decimation* fixtures, which do exist; the transport glob is inert until change 3 populates it. Reported as finding R8. |
| A sibling test file allocating in the same process poisons the gate. | Low | §D6: default `isolate: true` under `pool: 'forks'` gives each file its own process; `singleFork` must stay `false`; the gate file is `describe.sequential`. |
| `SIDE_EFFECTS_AUDIT.md` not updated for the six new `src/` files. | Low — caught immediately | The existing both-directions set-equality test fails the build. Listed as a mandatory file change, not an afterthought. |
| The fork pool slows the `core` test project. | Low | Ten small files today; confined to this project, and the future DOM project keeps the default pool. |

---

## Reconciliation With the Delta Specs

Writing this design surfaced eleven places where a delta spec under
`openspec/changes/core-decimation-math/specs/` is wrong, underspecified, contradictory, or missing a
requirement. **No spec file is edited by this phase.** Each is reported with its file and the
concrete change required.

### Contradictions and errors

**R1 — `specs/decimation-min-max/spec.md`, Requirement "Bucketed Min-Max Envelope Into a
Caller-Preallocated Buffer" (and `specs/decimation-lttb/spec.md`, "Single-Pass Index Selection").**
Both scenarios write the call as an **options object**: `minMaxEnvelope(x, y, out, { bucketCount,
sampleCount })` and `lttb(x, y, out, { threshold, sampleCount })`. An object literal at the call site
is an allocation, and the call site of a per-frame decimation is a hot path — so these two scenarios
literally mandate the thing `specs/allocation-free-hot-path/spec.md` bans. Separately,
`minMaxEnvelope`'s scenario passes `x`, which §D3 never reads (buckets are index ranges; domain-keyed
bucketing is change 8's `BucketAccumulator`). **Required:** rewrite both scenarios against flat
positional signatures, and drop `x` from `minMaxEnvelope`.

**R2 — `specs/decimation-min-max/spec.md` and `specs/spectrum-data-payload/spec.md` disagree on the
signature.** The min-max spec's scenario has no `outputOffset`; the payload spec's "Explicit Output
Offset and Count on Decimation Functions" requires `{ outputOffset, outputCount, … }`. The two cannot
both be the signature. It is also undefined how `outputCount` relates to `bucketCount` — for
`minMaxEnvelope` the written length is always `bucketCount * 2`, so `outputCount` is either redundant
or a capacity assertion, and the spec does not say which. **Required:** unify on one signature across
both files and state whether the output count is an input or a derived return value (§D3 returns it).

**R3 — `specs/decimation-min-max/spec.md` and `specs/decimation-lttb/spec.md`: no preconditions are
stated.** Nothing says `bucketCount <= sampleCount` (without it, empty buckets exist and the bounding
property is vacuous for them, and the spec never says what an empty bucket emits); nothing says
`threshold >= 2` (below which endpoint retention is unsatisfiable); nothing says
`threshold <= sampleCount` (above which "strictly increasing indices" is unsatisfiable); nothing
covers `threshold === 2` (where the bucket divisor is zero). **Required:** a "Boundary Preconditions"
requirement in each file naming the valid ranges and the error behaviour.

**R4 — `specs/decimation-lttb/spec.md`, "Subset, Monotonicity, and Endpoint-Retention Properties."**
It requires indices in `[0, sampleCount)` and the presence of `0` and `sampleCount - 1`. With a
`sourceOffset` window (required by R2/the payload spec), §D4 emits **absolute** indices, so the range
is `[sourceOffset, sourceOffset + sampleCount)` and the endpoints are `sourceOffset` and
`sourceOffset + sampleCount - 1`. As written, the requirement is only correct when
`sourceOffset === 0`. **Required:** restate in terms of the window.

**R5 — `specs/decimation-lttb/spec.md` "single O(n) pass" versus `specs/decimation-min-max/spec.md`
"Single-Pass Deterministic Work Count."** The min-max spec makes its claim testable: "an instrumented
input iterator records exactly `sampleCount` reads (one pass)". LTTB reads each sample **twice** (once
for its bucket's mean, once as a triangle candidate) — it is one forward traversal with no
backtracking, but not one read per sample. If verify applies the min-max scenario's instrument to
LTTB, a correct implementation fails. **Required:** state LTTB's work count as "one forward traversal,
at most two reads per sample, no backtracking, no scratch allocation".

### Underspecification

**R6 — `specs/spectrum-data-payload/spec.md` has no requirement about X-axis numeric precision.**
`Float32Array` carries ~7 significant decimal digits; an absolute optical wavelength (1550.123456 nm)
has ten, so storing absolute X in f32 quantizes the sweep below the instrument's own resolution.
§D2 resolves it with an f64 `xOrigin` and f32 offsets. Nothing in any spec requires or permits this.
**Required:** a requirement fixing the X representation (origin + offset, or an f64 X buffer) — this
is a correctness property of a hardware-characterization product, not an optimization.

**R7 — `specs/decimation-lttb/spec.md`, "Determinism Across Runs and Node Versions."** It pins f64
accumulation and bans implementation-dependent `Math` functions but says nothing about
**tie-breaking**. On a flat or perfectly periodic signal — exactly what a property test generates —
several candidates share the maximum triangle area, and first-wins (`>`) versus last-wins (`>=`)
produce different, equally valid outputs. Without a pinned rule the determinism requirement is
satisfiable by two different implementations and the golden fixture is arbitrary. Separately, the
ban is stated as "implementation-dependent `Math` functions" without naming them; ECMA-262 permits
implementation-dependent results only for the transcendental set, and `Math.abs`/`floor`/`sqrt` are
exactly specified — a literal reading currently bans safe functions and leaves the dangerous set
unnamed. **Required:** add a first-wins tie-break rule and enumerate the banned transcendental set.

**R8 — `specs/decimation-min-max/spec.md` says nothing about NaN, gaps, or `±Infinity`.** The
bounding property (`min <= y <= max`) is undefined when a bucket's samples are all NaN, and a naive
implementation emits `+Infinity`/`-Infinity`, which renders as a fabricated full-height spike — a
direct CLAUDE.md rule 6 violation that no current scenario detects. **Required:** a requirement
declaring NaN the "no sample" sentinel, mandating `NaN`/`NaN` for an all-gap bucket, and stating
that finite `±Infinity` samples propagate.

**R9 — `specs/decimation-min-max/spec.md` and `specs/decimation-lttb/spec.md`, the GC-gate
scenarios: "invoked 10,000 times" names no input size.** Paired with the informational benchmark's
1e6 samples, the literal reading is 1e10 element reads — hours per gate, per algorithm. §D6 runs two
configurations (10,000 × 4,096 and 200 × 1,000,000) because a per-call allocation and a per-sample
allocation hide from different ones. **Required:** name the input size in the scenario, or state both
configurations.

**R10 — `specs/benchmark-harness/spec.md`, "`--trace-deopt` Invocation Mode" scenario.** The fixture
is "deliberately polymorphic (called once with a `Float32Array` argument and once with a
`Float64Array` argument) to force a deoptimization". In modern V8 that commonly yields a polymorphic
inline cache and **no** `[deoptimizing …]` trace line, so the scenario asserts an outcome the fixture
does not reliably produce — a flaky sentinel in the one place that must not be flaky. A map-transition
fixture (warm on `{a}`, then call with `{a, b}`) deopts reliably. **Required:** replace the fixture
shape. The spec also does not say whether the mode runs in CI; §D7 reads "the harness MUST support an
invocation mode" as not requiring a CI step, and that reading should be made explicit.

### Missing requirements

**R11 — the regression budget has two owners.** `specs/decimation-min-max/spec.md` and
`specs/decimation-lttb/spec.md` both require that a median be measured "against a baseline recorded
on the same runner" and that a regression beyond tolerance **fail the benchmark check**. But
`packages/core/bench/README.md` (committed by change 1, and change 1's design §D6) states that "any
baseline-comparison or regression-budget *computation* belongs to change 16", and `proposal.md`'s
own Scope section defers benchmark CI to change 16. As written, change 2 must build a stored-baseline
comparator that change 16 also owns. Neither spec declares the **tolerance value**, where the
baseline is stored, or how a first run with no baseline behaves. **Required:** either move the
comparator to change 16 and restate these two requirements as "the harness emits the median in the
`bench-results.json` format change 16 consumes", or claim it here and specify the tolerance, the
storage location, and the no-baseline case.

**R12 — no spec covers the public export surface.** `proposal.md` says every one of the fourteen
following changes consumes these types, but no requirement in any delta spec states what
`@trace-kit/core` must export after this change, that type-only exports must use `export type`
(`isolatedModules` is on), or that `SIDE_EFFECTS_AUDIT.md` must gain a row per new `src/` file — the
last of which is enforced by an existing both-directions test and will fail the build if omitted.
`specs/branded-buffers/spec.md` also promises a "construction and narrowing contract" in the proposal
but contains no requirement for the constructor functions themselves (`asXBuffer`, `allocateXBuffer`)
— only that branding erases and that no `any` is used. **Required:** an export-surface requirement,
and a construction/narrowing requirement in `branded-buffers`.

**R13 — the `Retained`/`Transit` requirement is filed in the wrong capability.**
`specs/spectrum-data-payload/spec.md` carries "Retained / Transit Brand Distinction", whose text
begins "The branded-buffer types MUST gain a `Retained` / `Transit` ownership-class brand" — a
requirement about `branded-buffers`, living in `spectrum-data-payload`. `specs/branded-buffers/spec.md`
never mentions ownership at all, so reading that capability alone gives an incomplete brand
vocabulary, and change 3 (which needs `Transit` and not the payload) would inherit it from the wrong
place. **Required:** move the requirement to `branded-buffers`, leaving the payload spec's
"Payload Buffers Are Retained, Never Transferable" where it is.

**R14 — the payload mutation entry point is asserted but never specified.**
`specs/spectrum-data-payload/spec.md`'s revision scenario says the payload is "updated through the
core's mutation entry point (e.g. after a decimation result is copied in)" without any requirement
defining that entry point, its name, its signature, or which fields it is permitted to write. The
same spec requires `sampleCount` and `revision` to be readable and mutable while the payload is
"consumed structurally and never mutated" by downstream packages — a constraint that only holds if
there is a named, core-owned mutator. §D2 supplies `commitPayloadRevision`. **Required:** a
requirement naming the mutation entry point and enumerating the fields it owns.

---

## Return Envelope

**Status**: success
**Summary**: Wrote `design.md` resolving all nine open technical decisions — the two-axis
unique-symbol brand with zero runtime representation and no `any`; the flat `SpectrumDataPayload`
with an f64 `xOrigin`, a monotonic `revision` and a single named mutation entry point; flat
positional signatures for both algorithms with an exact integer bucket partition, interleaved
min/max output, NaN-as-gap with `NaN`/`NaN` for an all-gap bucket, and first-wins LTTB tie-breaking;
loop-scoped AST lint selectors proven live by a fixture meta-test; the GC gate's plumbing; the
`--trace-deopt` supervisor with a mandatory sentinel; the `fast-check` pin and conventions; and the
public export surface. Three findings during design are load-bearing: the committed C4b probe's
bucket math silently drops the tail on non-divisible lengths; `--expose-gc` cannot be delivered via
`NODE_OPTIONS` or a threads pool, so `pool: 'forks'` is the only working wiring; and the specs'
options-object call shape allocates at the call site inside the frame loop.
**Artifacts**: `openspec/changes/core-decimation-math/design.md`
**Next Recommended**: `/sdd:tasks` — then reconcile findings R1–R14 with `sdd-spec` before
`/sdd:apply`, since R1, R2 and R4 change the function signatures the task checklist will be written
against.
**Risks**: Fourteen spec findings are reported and unresolved; R1/R2/R4 (signature shape) and R11
(the regression budget having two owners) should be settled before tasks are written. The GC gate's
CI stability depends on per-file process isolation holding; a `GC_MAJOR` from unrelated runner
pressure is the one plausible flake and is mitigated by naming the GC kind on failure rather than by
a retry.
