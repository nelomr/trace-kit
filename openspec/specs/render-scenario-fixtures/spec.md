# Capability: render-scenario-fixtures

> Governs the scenario-keyed fixture contract consumed by the visual suites and by the WebGL2 suites
> (`webgl2-golden-parity`). This capability governs the fixture's identity and content; how a fixture's
> image is compared belongs to `browser-visual-regression` and `visual-golden-corpus`.

## ADDED Requirements

### Requirement: A Fixture Is Keyed by Payload Shape, Domain, Viewport, and dpr — Never by Backend
A scenario fixture record MUST be identified by its payload description (data shape), domain
(visible x/y range), viewport (width/height), and device pixel ratio (`dpr`). A fixture's
identity MUST NOT include or depend on which `FigureRenderer` backend renders it. The same
fixture record MUST be usable, unmodified, to drive both a Canvas2D render and a future WebGL2
render of the identical scene.

#### Scenario: A fixture record carries no backend field
- **GIVEN**: the scenario fixture type/schema as defined under `packages/renderers`
- **WHEN**: its fields are enumerated
- **THEN**: no field names or selects a renderer backend (`"canvas2d"`, `"webgl2"`, or
  equivalent); every field describes payload, domain, viewport, or `dpr`

#### Scenario: One fixture drives two backend instances without modification
- **GIVEN**: a single fixture record and two fixture backend instances implementing
  `FigureRenderer` (a real `Canvas2DRenderer` and a fixture stand-in for a second backend)
- **WHEN**: the same fixture record's payload, domain, viewport, and `dpr` are applied to both
  instances via `setData`/`setDomain`/`resize`
- **THEN**: both instances accept the identical fixture record with no field renamed, omitted, or
  backend-conditioned

### Requirement: `dpr` Is an Injected Scalar Fixture Field
A fixture MUST express its device pixel ratio as a plain numeric field, consistent with the
existing `FigureRenderer.resize(width, height, dpr)` surface (`figure-renderer-contract`
capability) — never inferred from a global such as `window.devicePixelRatio`.

#### Scenario: A fixture's dpr field feeds resize directly
- **GIVEN**: a scenario fixture with `dpr: 2`
- **WHEN**: the fixture is applied to a `FigureRenderer` via its `resize` call
- **THEN**: `resize` is invoked with that exact `dpr` value as its third argument, not a value
  read from `window.devicePixelRatio` or any other global

### Requirement: The Initial Corpus Is Parity-Minimal
The committed scenario fixture set MUST be partitioned into two named groups. The **parity set**
MUST contain exactly the five scenarios needed for engine-parity comparison — a simple trace, axes
with grid, a resonance peak, a noise floor, and one decimation case — and is the only group
iterated by the pixel suite's parity loop (`visual-golden-corpus`). The **SVG-extended set** MUST contain
exactly four additional scenarios — a log-axis figure, a dual-axis figure, a gapped figure, and an
overlaid two-trace figure — consumed only by the SVG golden corpus. The parity set MUST NOT gain scenarios, and the total MUST stay at nine. Reason:
every golden is maintenance debt, so the corpus grows only when a real consumer asks.

#### Scenario: The parity set contains exactly the five scenarios
- **GIVEN**: the committed parity set
- **WHEN**: its entries are enumerated
- **THEN**: there are exactly five, corresponding to a simple trace, axes with grid, a resonance
  peak, a noise floor, and one decimation case

#### Scenario: The SVG-extended set contains exactly the four figures
- **GIVEN**: the committed SVG-extended set
- **WHEN**: its entries are enumerated
- **THEN**: there are exactly four, corresponding to a log axis, a dual axis, a gapped trace, and
  an overlaid two-trace figure

#### Scenario: The pixel parity loop iterates only the parity set
- **GIVEN**: the pixel golden test enumeration
- **WHEN**: its scenarios are listed
- **THEN**: the parity loop iterates exactly the parity set; the pre-existing dedicated
  `log-axis`, `dual-axis`, `gapped-trace` and `overlay-two-axis` pixel tests remain, take their data
  from the SVG-extended set, and no new pixel golden is added

#### Scenario: A tenth scenario fails the scope check
- **GIVEN**: a hypothetical extra fixture in either group
- **WHEN**: the count assertion runs
- **THEN**: it fails, naming the unexpected extra fixture

### Requirement: The Fixture Set Is Importable Without Reaching Into Another Package's Test Tree
The scenario fixture module(s) MUST be located and exported such that every consumer, including
the Canvas2D visual suite, the SVG golden corpus, the WebGL2 pixel suite, the cross-engine check,
the WebGL2 fake-GL tests and the playground views, can import them via the stable module path
`@trace-kit/renderers/fixtures`, without importing from inside `packages/renderers`'s `test/`
directory structure by relative path traversal (e.g. no `../../../renderers/test/fixtures/...`
import required). The exports MUST include everything a parity comparison needs: payload or
collection, domain, viewport, `dpr`, the Y-axis registrations, and a human-readable scenario
name/description.

#### Scenario: Fixtures are reachable via a stable import path from the WebGL2 suites
- **GIVEN**: the WebGL2 pixel suite, the cross-engine check and the fake-GL parity tests
- **WHEN**: their imports are inspected
- **THEN**: each imports fixtures from `@trace-kit/renderers/fixtures`, none through a deep
  relative traversal into another package's `test/` internals, and no export a WebGL2 comparison
  needs is missing

#### Scenario: The playground imports the same path
- **GIVEN**: `apps/playground/src/views/engine-parity/`
- **WHEN**: its fixture imports are inspected
- **THEN**: they use `@trace-kit/renderers/fixtures`

## ADDED Requirements

### Requirement: Fixtures Are the Shared, Backend-Free Input of the SVG Golden Corpus
Every fixture in both groups MUST be consumable by `exportToSvg` without modification: it MUST
carry a payload description or `TraceCollection` description, the visible domain, the Y-axis
registrations (including `yScaleKind` and per-trace `yAxisId` binding for the SVG-extended
scenarios), the CSS-px viewport, and `dpr`. No fixture field MUST name or select a backend,
and the SVG export MUST use the fixture's CSS-px width/height and ignore `dpr`. Fixture data MUST
be deterministic (no `Math.random`, no clock).

#### Scenario: One fixture drives Canvas2D and the exporter
- **GIVEN**: a single fixture record
- **WHEN**: it is applied to a `Canvas2DRenderer` and passed to `exportToSvg`
- **THEN**: both accept it with no field renamed, omitted, or backend-conditioned

#### Scenario: Multi-trace fixtures carry axis bindings
- **GIVEN**: the dual-axis and two-trace overlay fixtures
- **WHEN**: their fields are inspected
- **THEN**: each trace declares its `yAxisId` and each axis its `yScaleKind`

#### Scenario: Fixture data is deterministic
- **GIVEN**: a fixture materialized twice in one process and across processes
- **WHEN**: the payload buffers are compared
- **THEN**: they are bit-identical

### Requirement: The WebGL2 Suites Add No Fixture and Do Not Change the Corpus
The WebGL2 suites MUST NOT add, remove or edit a fixture, and MUST NOT change the membership of the
parity set (5) or the SVG-extended set (4), nor the nine-scenario total. The WebGL2 suites use
the fixtures exactly as defined: a fixture drives a `WebGL2FigureRenderer` through the same
`setData`/`setTraces`, `setDomain` and `resize(width, height, dpr)` calls and fields as it drives
`Canvas2DRenderer`, with no field renamed, omitted or backend-conditioned.

#### Scenario: The counts are unchanged
- **GIVEN**: `PARITY_SCENARIO_FIXTURES` and `SVG_EXTENDED_SCENARIO_FIXTURES`
- **WHEN**: their lengths are read
- **THEN**: they are 5 and 4, and `SCENARIO_FIXTURES.length` is 9

#### Scenario: One fixture drives both shipped backends unmodified
- **GIVEN**: any single fixture record
- **WHEN**: it is applied to a real `Canvas2DRenderer` and a real `WebGL2FigureRenderer` (over the
  recording fake GL) via `setData`/`setTraces`, `setDomain` and `resize`
- **THEN**: both accept it with no field renamed, omitted or backend-conditioned, and the
  `resize` call receives the fixture's own `dpr`

#### Scenario: A fixture record still carries no backend field
- **GIVEN**: the fixture type definitions
- **WHEN**: their fields are enumerated
- **THEN**: no field names or selects `"canvas2d"`, `"webgl2"` or an equivalent

### Requirement: The Parity Set Is the Iteration Set of the WebGL2 Pixel Parity Loop
The parity loop of the WebGL2 pixel suite MUST iterate exactly `PARITY_SCENARIO_FIXTURES`, in the
same way the Canvas2D parity loop does (`visual-golden-corpus`), and the four extended fixtures
MUST be exercised by dedicated WebGL2 cases selected by id. The cross-engine structural check
MUST iterate `SCENARIO_FIXTURES`.

#### Scenario: The WebGL2 parity loop lists the five parity ids
- **GIVEN**: the WebGL2 pixel test enumeration
- **WHEN**: the parity loop's cases are listed
- **THEN**: their ids are exactly those of `PARITY_SCENARIO_FIXTURES`

#### Scenario: The cross-engine check lists all nine
- **GIVEN**: the cross-engine test enumeration
- **WHEN**: its cases are listed
- **THEN**: their ids are exactly those of `SCENARIO_FIXTURES`
