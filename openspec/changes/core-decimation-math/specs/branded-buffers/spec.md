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

### Requirement: No `any` in Brand Machinery
The branding implementation (generics, unique-symbol brand fields) MUST NOT use `any` in any
form banned by CLAUDE.md rule 1.

#### Scenario: Lint passes over the brand module
- **GIVEN**: `packages/core/src/buffers/brand.ts` implements the brand generics
- **WHEN**: `pnpm exec turbo run lint --filter=@trace-kit/core` runs
- **THEN**: no violation is reported for `brand.ts`
