# Capability: render-scenario-fixtures

> Change: `browser-visual-regression-harness` (roadmap order 5.5). New capability.
>
> Source: `proposal.md` §"Proposed Approach" 5, Scope, Constraint 4, decision **P4**
> (`preproposal.md`). Governs the scenario-keyed fixture contract that both this change's visual
> suite and change 7 (`renderers-webgl2`) consume. This capability governs the fixture's
> identity and content; how a fixture's image is compared belongs to `browser-visual-regression`
> and `visual-golden-corpus`.

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
The committed scenario fixture set MUST contain exactly the scenarios needed for change 7's
engine-parity comparison and no more at this change's landing: a simple trace, axes with grid, a
resonance peak, a noise floor, and one decimation case. This change MUST NOT seed additional
scenarios sweeping the current Canvas2D surface beyond these five. Reason (**P4**): every golden
is maintenance debt, so the corpus grows when a real consumer (change 7) asks for a new scenario,
not preemptively.

#### Scenario: The fixture set contains exactly the five parity-minimal scenarios
- **GIVEN**: the committed scenario fixture set at this change's landing
- **WHEN**: its entries are enumerated
- **THEN**: there are exactly five, and their descriptions correspond to: a simple trace, axes
  with grid, a resonance peak, a noise floor, and one decimation case

#### Scenario: Adding a sixth scenario in this change fails a scope check
- **GIVEN**: a hypothetical sixth fixture added that does not correspond to any of the five named
  scenarios
- **WHEN**: this requirement's scenario-count assertion runs
- **THEN**: it fails, naming the unexpected extra fixture

### Requirement: The Fixture Set Is Importable Without Reaching Into Another Package's Test Tree
The scenario fixture module(s) MUST be located and exported such that a future consumer (change
7's WebGL2 test suite) can import them via a stable module path, without importing from inside
`packages/renderers`'s `test/` directory structure by relative path traversal (e.g. no
`../../../renderers/test/fixtures/...` import required).

#### Scenario: Fixtures are reachable via a stable import path
- **GIVEN**: the scenario fixture module's declared location
- **WHEN**: a fixture consuming test file (simulating change 7's future usage) imports it
- **THEN**: the import resolves via a package-relative or otherwise stable path (not a deep
  relative traversal into another package's `test/` internals), and no export is missing that a
  parity comparison would need (payload, domain, viewport, `dpr`, and a human-readable scenario
  name/description)
