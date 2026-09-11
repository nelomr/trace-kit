# Capability: branded-buffers

> Change: `core-decimation-math`. New capability.

## ADDED Requirements

### Requirement: Type-Level-Only Branding With No Runtime Cost
Branded typed-buffer types (an X buffer, a Y buffer, an index buffer) MUST be distinguished only
at the type level using generics and unique-symbol brands, and MUST erase completely at runtime:
no wrapper object, no additional property, no runtime representation distinct from the
underlying `Float32Array` / `Float64Array` / `Int32Array`.

#### Scenario: A branded buffer is identical at runtime to its underlying typed array
- **GIVEN**: a value constructed as a branded X-buffer over a `Float32Array`
- **WHEN**: `Object.getPrototypeOf(value) === Float32Array.prototype` and
  `value instanceof Float32Array` are evaluated at runtime
- **THEN**: both are `true`, and `value` carries no additional own property beyond what
  `Float32Array` itself defines

#### Scenario: Mutually incompatible buffer brands are not assignable
- **GIVEN**: a function `acceptsXBuffer(buf: XBuffer): void`
- **WHEN**: a value typed as `YBuffer` is passed to `acceptsXBuffer` in a TypeScript fixture
- **THEN**: `tsc --noEmit` reports a type error for the fixture

### Requirement: Retained / Transit Ownership-Class Brand
The branded-buffer types MUST gain a `Retained` / `Transit` ownership-class brand, orthogonal to
the X/Y/index axis brand, so a function accepting `Transit<T>` rejects a `Retained<T>` value at
compile time and vice versa. The two brands MUST be applied through distinct `unique symbol`
tags, independent of the axis tag, so a value can be described by both axis and ownership
simultaneously (e.g. `Retained<XBuffer>`, `Transit<Float32Array>`).

#### Scenario: A Retained buffer does not satisfy a Transit-typed parameter
- **GIVEN**: a function `submitToPool(buf: Transit<Float32Array>): void`
- **WHEN**: a `Retained<Float32Array>` value is passed to it in a fixture
- **THEN**: `tsc --noEmit` reports a type error for the fixture

#### Scenario: A Transit buffer does not satisfy a Retained-typed parameter
- **GIVEN**: a function `readFromPayload(buf: Retained<Float32Array>): void`
- **WHEN**: a `Transit<Float32Array>` value is passed to it in a fixture
- **THEN**: `tsc --noEmit` reports a type error for the fixture

### Requirement: Construction and Narrowing Contract
For every branded axis (X, Y, index), `@trace-kit/core` MUST export a narrowing constructor
(`asXBuffer`, `asYBuffer`, `asIndexBuffer`) that accepts a plain, unbranded typed array of the
matching element type and returns the branded type, and an allocating constructor
(`allocateXBuffer`, `allocateYBuffer`, `allocateIndexBuffer`) that accepts a capacity and returns
a newly allocated branded buffer of that capacity. Both constructor kinds MUST validate their
input at the boundary (a detached or zero-length-but-nonzero-`length` source is rejected by the
narrowing constructor; a negative or non-integer capacity is rejected by the allocating
constructor) before returning a branded value, and MUST NOT use `as unknown as` or any other
double assertion to produce the brand.

#### Scenario: A narrowing constructor rejects a detached buffer
- **GIVEN**: a `Float32Array` whose backing `ArrayBuffer` has been detached (`byteLength === 0`
  while `length > 0`)
- **WHEN**: `asXBuffer` is called with it
- **THEN**: it throws before returning a branded value

#### Scenario: An allocating constructor produces a buffer of the requested capacity
- **GIVEN**: a capacity of `1024`
- **WHEN**: `allocateXBuffer(1024)` runs
- **THEN**: the returned value's `.length` is `1024` and it satisfies the `XBuffer` branded type

### Requirement: Public Export Surface
`@trace-kit/core`'s package entry point (`src/index.ts`) MUST export, and MUST export only as
`export type` for type-only bindings (because `isolatedModules: true` is on): the axis and
ownership brand types (`BufferAxis`, `OwnershipClass`, `Branded`, `XBuffer`, `YBuffer`,
`IndexBuffer`, `Retained`, `Transit`, `TransitXBuffer`, `TransitYBuffer`, `TransitIndexBuffer`,
`TransferableBacking`) and the narrowing/allocating constructor functions for each axis
(`asXBuffer`, `asYBuffer`, `asIndexBuffer`, `allocateXBuffer`, `allocateYBuffer`,
`allocateIndexBuffer`). It MUST NOT export the internal boundary validators
(`assertUsableBuffer`, `assertCapacity`) or any bucket-boundary helper internal to
`minMaxEnvelope`/`lttb`. Every new file added under `src/` by this change MUST gain a
corresponding row in `packages/core/SIDE_EFFECTS_AUDIT.md`.

#### Scenario: Type-only exports use export type
- **GIVEN**: `packages/core/src/index.ts`
- **WHEN**: `tsc --noEmit` runs with `isolatedModules: true`
- **THEN**: no type-only re-export triggers an `isolatedModules` error, because each uses
  `export type`

#### Scenario: Internal boundary validators are not exported
- **GIVEN**: `packages/core/src/index.ts`
- **WHEN**: its exports are enumerated
- **THEN**: `assertUsableBuffer` and `assertCapacity` do not appear among them

#### Scenario: Every new src file has a SIDE_EFFECTS_AUDIT.md row
- **GIVEN**: the set of files added under `packages/core/src/` by this change
- **WHEN**: `packages/core/test/side-effects-audit.test.ts` runs its both-directions set-equality
  check against `packages/core/SIDE_EFFECTS_AUDIT.md`
- **THEN**: the test passes, meaning every new file has a corresponding audit row

### Requirement: No `any` in Brand Machinery
The branding implementation (generics, unique-symbol brand fields) MUST NOT use `any` in any
form banned by CLAUDE.md rule 1.

#### Scenario: Lint passes over the brand module
- **GIVEN**: `packages/core/src/buffers/brand.ts` implements the brand generics
- **WHEN**: `pnpm exec turbo run lint --filter=@trace-kit/core` runs
- **THEN**: no violation is reported for `brand.ts`
