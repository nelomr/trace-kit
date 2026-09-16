# Capability: figure-renderer-contract

> Change: `renderers-canvas2d`. New capability, widened before archive.
>
> Source: `design.md` §D1 (`FigureRenderer`, `packages/renderers/src/figure-renderer.ts`), §D9
> (surface acquisition), and the proposal's Capabilities contract, which requires this interface
> to be lifecycle-shaped and free of any interaction concern (claim **D1**, zrender's
> `PainterBase`). This capability governs the interface only, not the Canvas2D backend body —
> see `canvas2d-trace-rendering` and `canvas2d-axes-grid` for that.
>
> Amended by `design.md` §D11: `FigureRenderer` gains one member, `setDecimation`, so the
> caller-selectable decimation surface (`selectable-decimation`) is part of the shared interface
> every backend inherits, not a Canvas2D-local option. The member list and its scenarios below are
> updated in place to reflect ten members rather than nine; this is a widening of the frozen
> surface, recorded here rather than as a separate delta, per proposal.md's Modified Capabilities
> section.

## ADDED Requirements

### Requirement: `FigureRenderer` Is Lifecycle-Shaped and Excludes Interaction
`@trace-kit/renderers` MUST export a `FigureRenderer` interface whose members are exactly:
`kind` (readonly `FigureRendererKind`), `disposed` (readonly `boolean`), `transform` (readonly
`ViewportTransform`), `setData(payload)`, `setDomain(xMin, xMax, yMin, yMax)`,
`resize(width, height, dpr)`, `render()`, `clear()`, `dispose()`, and `setDecimation(selection)`.
`FigureRenderer` MUST NOT declare a member for pointer events, hit-testing, or value
formatting/readout. No member of the interface MUST accept or return a Canvas2D-specific type
(`CanvasRenderingContext2D`, `Path2D`, `HTMLCanvasElement`, or `OffscreenCanvas`); the drawing
surface enters only through a concrete class's constructor, which is not part of the interface.
`setDecimation`'s parameter MUST be typed only as `DecimationSelection | undefined`, a plain core
type carrying no Canvas2D-specific type.

#### Scenario: The interface member list matches exactly
- **GIVEN**: the compiled `FigureRenderer` type declaration
- **WHEN**: its member names are enumerated
- **THEN**: the set is exactly `{kind, disposed, transform, setData, setDomain, resize, render,
  clear, dispose, setDecimation}`, with no additional member

#### Scenario: No interaction member exists on the interface
- **GIVEN**: the compiled `FigureRenderer` type declaration
- **WHEN**: its members are inspected for a pointer, hit-test, or value-formatting concern (for
  example a member named or shaped like `onPointerMove`, `hitTest`, or `formatValue`)
- **THEN**: no such member exists

#### Scenario: No member signature references a Canvas2D-specific type
- **GIVEN**: the compiled `FigureRenderer` type declaration
- **WHEN**: every parameter and return type across all ten members is inspected
- **THEN**: none references `CanvasRenderingContext2D`, `Path2D`, `HTMLCanvasElement`, or
  `OffscreenCanvas`

#### Scenario: A second backend satisfies the interface with an unchanged member set
- **GIVEN**: a fixture class implementing `FigureRenderer` whose constructor accepts a WebGL2
  context instead of a Canvas2D surface
- **WHEN**: `tsc --noEmit` checks the fixture against `FigureRenderer`
- **THEN**: it type-checks with no member added, removed, or re-typed on the interface itself, and
  the fixture's `setDecimation` implementation accepts the same `DecimationSelection | undefined`
  parameter type as the Canvas2D backend

### Requirement: `setDecimation` Widens the Shared Surface Every Backend Inherits
`FigureRenderer.setDecimation(selection: DecimationSelection | undefined): void` MUST be declared
on the interface itself, not only on `Canvas2DRendererOptions` or any other backend-local
configuration surface. A fixture backend that implements every other `FigureRenderer` member but
omits `setDecimation` MUST NOT type-check as a `FigureRenderer`.

#### Scenario: Omitting setDecimation fails the interface check
- **GIVEN**: a fixture class implementing every `FigureRenderer` member except `setDecimation`
- **WHEN**: `tsc --noEmit` checks the fixture against `FigureRenderer`
- **THEN**: it fails to compile, naming `setDecimation` as missing

#### Scenario: setDecimation's parameter type is the shared core selection type
- **GIVEN**: the compiled `FigureRenderer` type declaration
- **WHEN**: `setDecimation`'s parameter type is inspected
- **THEN**: it is exactly `DecimationSelection | undefined` from `@trace-kit/core`, with no
  Canvas2D-specific, WebGL2-specific, or backend-local type substituted or unioned in

### Requirement: `setData` Retains a Structural Reference and Never Draws
`setData(payload: SpectrumDataPayload): void` MUST retain a reference to `payload` for later use
by `render()`. It MUST NOT construct, mutate, copy, or place any of the payload's buffers in a
transfer list, and it MUST NOT issue any drawing-surface call.

#### Scenario: setData issues no drawing call
- **GIVEN**: a `Canvas2DRenderer` constructed with a fake `TraceDrawingContext` that records every
  call made on it
- **WHEN**: `setData(payload)` is called
- **THEN**: the fake context records zero calls

#### Scenario: setData does not copy or mutate the payload's buffers
- **GIVEN**: a payload whose `x` and `y` buffers are tagged with a reference identity probe
- **WHEN**: `setData(payload)` is called and then `payload` is inspected
- **THEN**: `payload.x` and `payload.y` are the identical object references passed in, unchanged

### Requirement: The Renderer Owns Payload Staleness by Comparing `revision`
`render()` MUST determine whether decimation and tick generation need to re-run by comparing the
current `payload.revision` (read fresh on every `render()` call, not cached from `setData`)
against the revision that produced the currently held decimated index set. A payload mutated in
place via `commitPayloadRevision` between two `render()` calls, with no intervening `setData`
call, MUST be picked up by the next `render()`.

#### Scenario: A payload mutated without a new setData call is picked up on the next render
- **GIVEN**: a renderer that has called `setData(payload)` once and `render()` once at
  `payload.revision === 1`
- **WHEN**: `commitPayloadRevision` bumps the same payload to `revision === 2` and `render()` is
  called again, with no further `setData` call
- **THEN**: the decimation function is invoked again for the second `render()` call

#### Scenario: An unchanged revision does not re-trigger decimation
- **GIVEN**: a renderer that has rendered once at a fixed `payload.revision` and a fixed
  `transform`
- **WHEN**: `render()` is called 59 more times with no change to `payload.revision` and no
  intervening `resize`/`setDomain` call
- **THEN**: the decimation function is invoked exactly once across all 60 calls

### Requirement: `resize` and `setDomain` Recompute the Transform and Paint Nothing
`resize(width, height, dpr)` MUST resize the backing store to
`round(width * dpr) x round(height * dpr)` device pixels and recompute `transform`. It MUST NOT
issue any drawing-surface call. `setDomain(xMin, xMax, yMin, yMax)` MUST recompute `transform`
for the new visible window and MUST NOT issue any drawing-surface call. Both methods MUST
invalidate the currently held decimated index set and the currently held tick values, so the
next `render()` recomputes them.

#### Scenario: resize paints nothing
- **GIVEN**: a `Canvas2DRenderer` wired to a fake `TraceDrawingContext` that records calls
- **WHEN**: `resize(800, 600, 2)` is called
- **THEN**: the fake context records zero calls, and `surface.width === 1600` and
  `surface.height === 1200`

#### Scenario: setDomain paints nothing
- **GIVEN**: a `Canvas2DRenderer` wired to a fake `TraceDrawingContext` that records calls
- **WHEN**: `setDomain(0, 10, -1, 1)` is called
- **THEN**: the fake context records zero calls

#### Scenario: resize invalidates the decimated index set
- **GIVEN**: a renderer that has rendered once, producing a decimated index set at the previous
  backing-store size
- **WHEN**: `resize` changes the backing-store width and `render()` is called again
- **THEN**: the decimation function is invoked again on that `render()` call

### Requirement: Post-`dispose()` Calls Are No-Ops, Never Throws
`dispose()` MUST be idempotent: a second and subsequent call MUST change nothing and MUST NOT
throw. After `dispose()` has run once, every other `FigureRenderer` method MUST be a no-op — it
MUST NOT throw and MUST NOT issue any drawing-surface call — and `disposed` MUST read `true` and
MUST NOT revert to `false`.

#### Scenario: A queued render after dispose performs no drawing call and does not throw
- **GIVEN**: a renderer wired to a fake `TraceDrawingContext`, with `dispose()` already called
- **WHEN**: `render()` is called afterward
- **THEN**: no exception is thrown, and the fake context records zero calls

#### Scenario: disposed is true and stays true
- **GIVEN**: a renderer with `dispose()` called once
- **WHEN**: `disposed` is read, `dispose()` is called a second time, and `disposed` is read again
- **THEN**: both reads return `true`, and the second `dispose()` call throws nothing

#### Scenario: Every method is a no-op after dispose
- **GIVEN**: a disposed renderer
- **WHEN**: `setData`, `setDomain`, `resize`, `render`, and `clear` are each called once
- **THEN**: none throws, and the fake drawing context records zero calls across all five calls

### Requirement: Construction Accepts `HTMLCanvasElement | OffscreenCanvas` Without an Unsafe Cast
`Canvas2DRenderer`'s constructor MUST accept a `Canvas2DSurface` (`HTMLCanvasElement |
OffscreenCanvas`) and MUST acquire a 2D drawing context from it without using `any`, `as any`,
`as unknown as`, or a suppressing type assertion of any kind. Construction MUST throw
synchronously when `getContext("2d")` returns `null`.

#### Scenario: Both surface arms type-check as valid constructor arguments
- **GIVEN**: two fixture values, one typed `HTMLCanvasElement` and one typed `OffscreenCanvas`
- **WHEN**: each is passed to the `Canvas2DRenderer` constructor under `tsc --noEmit`
- **THEN**: both type-check with no assertion in the fixture or in the constructor's
  implementation

#### Scenario: A null 2D context throws synchronously at construction
- **GIVEN**: a surface whose `getContext("2d")` returns `null` (the happy-dom default)
- **WHEN**: `new Canvas2DRenderer({ surface })` is called
- **THEN**: it throws synchronously, before any other constructor side effect completes

#### Scenario: No unsafe cast appears in the acquisition code
- **GIVEN**: `packages/renderers/src/surface.ts`
- **WHEN**: the file is scanned for `: any`, `as any`, `<any>`, `Record<string, any>`, `as never`,
  and `as unknown as`
- **THEN**: none of these patterns appears
