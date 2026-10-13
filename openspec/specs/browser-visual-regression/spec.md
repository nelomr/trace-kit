# Capability: browser-visual-regression

> Governs the browser-mode test project and the visual assertion contract only. Golden storage and
> OS policy belong to `visual-golden-corpus`, scenario identity to `render-scenario-fixtures`, and the
> Vitest upgrade mechanics to `workspace-toolchain`.

## ADDED Requirements

### Requirement: The Browser Project Uses a Playwright Provider Factory and Declares No `environment` Key
The browser-mode Vitest project added to `test.projects` MUST configure its provider through a
provider **factory**, not a provider name string, and MUST NOT set `environment` to `"browser"`
or to any other value. Setting `environment` on a browser-mode project is a Vitest v4+ breaking
change (rejected outright); the factory requirement exists because a bare provider string is the
pre-v4 shape this upgrade leaves behind.

#### Scenario: The browser project is configured with a provider factory, not a provider string
- **GIVEN**: the root `vitest.config.ts`'s `test.projects` array
- **WHEN**: the browser-mode entry's `browser.provider` field is inspected
- **THEN**: it is a factory invocation (e.g. `playwright()`), not a bare string literal such as
  `"playwright"`

#### Scenario: The browser project declares no environment key
- **GIVEN**: the same browser-mode project entry
- **WHEN**: its configuration object is inspected
- **THEN**: it has no `environment` field at all — neither `"browser"` nor any other value

### Requirement: Chromium via Playwright Is the Sole Rasterizer of Record
The browser-mode project MUST run its `browser.instances` (or equivalent) against Chromium only.
No other browser engine (WebKit, Firefox) MUST be configured for the visual suite, and no
configuration option MUST override or disable the two determinism controls Playwright applies to
every Chromium launch by default (`--force-color-profile=srgb`, `--enable-unsafe-swiftshader`).
The project MAY add Chromium launch arguments if, and only if, they are measured to be required for `getContext("webgl2")` to succeed in CI; every added argument MUST be listed with its reason in a comment at the point of declaration, and no added argument MUST remove or contradict a default determinism flag. WebGL2
rendering in this project is by software rasterization (SwiftShader/ANGLE) so goldens do not depend
on runner GPU hardware.

#### Scenario: Only Chromium is configured as a browser instance
- **GIVEN**: the browser-mode project's `browser.instances` (or equivalent) configuration
- **WHEN**: the configured browser names are enumerated
- **THEN**: the set contains exactly one entry, and that entry names Chromium

#### Scenario: No launch option disables Playwright's default determinism flags
- **GIVEN**: the browser-mode project's launch configuration, if any is present
- **WHEN**: it is inspected for `args` or `launchOptions` overrides
- **THEN**: no entry removes or contradicts `--force-color-profile=srgb` or
  `--enable-unsafe-swiftshader`

#### Scenario: WebGL2 is available in the project's Chromium
- **GIVEN**: the `visual` project in CI on `ubuntu-latest`
- **WHEN**: a smoke test calls `getContext("webgl2")` on a detached canvas
- **THEN**: the result is non-null, and the test fails (rather than skips) when it is `null`

### Requirement: Visual Comparison Is a Mismatch Ratio Against a Declared Threshold, Never Byte Equality
Every visual assertion MUST compare rendered output to its golden using a mismatch **ratio** (the
comparator's `threshold` and/or `allowedMismatchedPixelRatio` axes) against an explicitly
declared, non-zero threshold. Canvas2D assertions use the project-level options; WebGL2 assertions
MUST pass their own declared options (`webgl2-golden-parity`) because GL and Skia anti-aliasing
differ and a tolerance meant for one engine's goldens is not a statement about the other's. No
visual assertion MUST rely on byte-for-byte image equality, and no visual assertion MUST omit a
threshold and thereby fall back to an implicit strict default that behaves as byte equality in
practice. A cross-engine comparison (Canvas2D against WebGL2 of the same fixture) MUST NOT use a
pixel comparator at all; it uses the structural metric of `webgl2-golden-parity`.

#### Scenario: A pixel-identical render still passes through the ratio comparison
- **GIVEN**: a rendered PNG identical byte-for-byte to its golden
- **WHEN**: the visual assertion runs
- **THEN**: it passes, and the assertion's configuration shows a declared, non-zero threshold was
  evaluated (not skipped because the images happened to match exactly)

#### Scenario: A render within threshold passes despite non-identical bytes
- **GIVEN**: a rendered PNG whose mismatch ratio against its golden is below the declared
  threshold, but whose bytes differ from the golden's bytes
- **WHEN**: the visual assertion runs
- **THEN**: it passes

#### Scenario: A render exceeding threshold fails
- **GIVEN**: a rendered PNG whose mismatch ratio against its golden exceeds the declared
  threshold
- **WHEN**: the visual assertion runs
- **THEN**: it fails, and the failure reports the computed mismatch ratio and the configured
  threshold

#### Scenario: WebGL2 assertions carry their own options
- **GIVEN**: the WebGL2 visual test sources
- **WHEN**: each `toMatchScreenshot` call is inspected
- **THEN**: it passes the WebGL2 tolerance constant explicitly, and no cross-engine assertion
  calls `toMatchScreenshot`

### Requirement: A Failing Visual Comparison Emits a Diff Artifact
When a visual assertion fails, the test run MUST produce a diff artifact (an image or
comparator-produced output) locating the mismatch, in addition to the pass/fail result. The
artifact MUST be discoverable from the test run's output (e.g. a reported file path) without
requiring a developer to re-run the comparator manually.

#### Scenario: A failing visual assertion writes a locatable diff artifact
- **GIVEN**: a rendered PNG deliberately altered to exceed its golden's threshold
- **WHEN**: the visual assertion runs and fails
- **THEN**: the test run's output names a file path to a diff artifact, and that file exists on
  disk after the run completes

### Requirement: Existing Call-Sequence and DOM-Shape Assertions Are Not Replaced
The `renderers` (Node, fake-`TraceDrawingContext`) and `renderers-dom` (`happy-dom`) Vitest
projects, and the call-sequence and DOM-shape assertions they carry, remain the projects
responsible for those concerns. The browser-mode visual project MUST NOT duplicate or replace
call-sequence assertions against a fake context, and MUST NOT be treated as a superset that makes
the `renderers`/`renderers-dom` projects redundant.

#### Scenario: Existing fake-context and DOM-shape tests keep running in pnpm run test
- **GIVEN**: the existing Canvas2D fake-`TraceDrawingContext` call-sequence tests (e.g. the
  `canvas2d-axes-grid` paint-order scenarios) in the `renderers` project, and the DOM-shape tests in
  `renderers-dom`
- **WHEN**: `pnpm run test` runs
- **THEN**: those tests still execute inside their own projects, unmodified in mechanism, and
  still pass

#### Scenario: No visual test asserts call sequence against a fake context
- **GIVEN**: the browser-mode visual project's test files
- **WHEN**: their imports and assertions are inspected
- **THEN**: none constructs or asserts against a fake `TraceDrawingContext`; every assertion in
  that project is a `toMatchScreenshot`-shaped visual comparison

### Requirement: The `visual` Project Hosts Both Engines' Pixel Suites With Disjoint Goldens
The `visual` project MUST run the existing Canvas2D suite and the WebGL2 suite in the same browser
instance, with golden names that cannot collide: Canvas2D goldens keep their fixture-id names;
WebGL2 goldens are `webgl2-<fixture id>` (`webgl2-golden-parity`). The `resolveScreenshotPath` and
`resolveDiffPath` functions MUST keep the flat layout (no platform or engine directory). A failing
WebGL2 comparison MUST emit a diff artifact like any other.

#### Scenario: Names are disjoint
- **GIVEN**: the golden directory
- **WHEN**: file stems are partitioned by the `webgl2-` prefix
- **THEN**: the two partitions share no stem, and the resolver functions are unchanged in shape

#### Scenario: A failing WebGL2 comparison writes a diff
- **GIVEN**: a WebGL2 render altered to exceed its tolerance
- **WHEN**: the assertion fails
- **THEN**: a diff file exists under `__screenshots__/__diffs__/` named `webgl2-<fixture id>`

### Requirement: WebGL2 Call-Sequence Tests Live in the Node Project, Not the Visual Project
Assertions over the sequence of GL calls (uniform values, draw-call counts, create/delete balance,
paint order) MUST run in the `renderers` (Node) project against `RecordingGl2Context`
(`webgl2-golden-parity`). The `visual` project MUST NOT construct or assert against a fake GL or a
fake 2D context; its WebGL2 assertions are `toMatchScreenshot` comparisons, structural cross-engine
checks, the availability smoke test, and behaviour probes (`webgl2-behaviour.visual.test.ts`: pixel
reads of a real render for diagonal anti-aliasing, blank gaps, Infinity reaching the plot edge,
non-positive log samples, blank gutters, grid under the stacked GL layer, and a canvas with a prior
`2d` context), which use neither goldens nor fakes. The "failing WebGL2 comparison writes a diff"
scenario is verified once during implementation by a deliberately failing run, not by a permanent
test.

#### Scenario: No fake GL appears in the visual project
- **GIVEN**: the files under `packages/renderers/test/visual/`
- **WHEN**: they are searched for imports of `RecordingGl2Context` and `RecordingContext`
- **THEN**: there is none

#### Scenario: The fake-GL tests run in the renderers project
- **GIVEN**: `pnpm run test`
- **WHEN**: the WebGL2 call-sequence tests execute
- **THEN**: they are reported under the `renderers` project
