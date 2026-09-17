# Capability: browser-visual-regression

> Change: `browser-visual-regression-harness` (roadmap order 5.5). New capability.
>
> Source: `proposal.md` §"Proposed Approach" 1–3, decisions **P1**/**P2**, research **C2**,
> **C4**, **C14**. Governs the browser-mode test project and the visual assertion contract
> only — golden storage/OS policy is `visual-golden-corpus`, scenario identity is
> `render-scenario-fixtures`, and the Vitest 3→5 upgrade mechanics are `workspace-toolchain`.

## ADDED Requirements

### Requirement: The Browser Project Uses a Playwright Provider Factory and Declares No `environment` Key
The browser-mode Vitest project added to `test.projects` MUST configure its provider through a
provider **factory**, not a provider name string, and MUST NOT set `environment` to `"browser"`
or to any other value. Setting `environment` on a browser-mode project is a Vitest v4+ breaking
change (rejected outright); the factory requirement exists because a bare provider string is the
pre-v4 shape this upgrade leaves behind.

#### Scenario: The browser project is configured with a provider factory, not a provider string
- **GIVEN**: the root `vitest.config.ts`'s `test.projects` array after this change
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

#### Scenario: Only Chromium is configured as a browser instance
- **GIVEN**: the browser-mode project's `browser.instances` (or equivalent) configuration
- **WHEN**: the configured browser names are enumerated
- **THEN**: the set contains exactly one entry, and that entry names Chromium

#### Scenario: No launch option disables Playwright's default determinism flags
- **GIVEN**: the browser-mode project's launch configuration, if any is present
- **WHEN**: it is inspected for `args` or `launchOptions` overrides
- **THEN**: no entry removes or contradicts `--force-color-profile=srgb` or
  `--enable-unsafe-swiftshader`

### Requirement: Visual Comparison Is a Mismatch Ratio Against a Declared Threshold, Never Byte Equality
Every visual assertion MUST compare rendered output to its golden using a mismatch **ratio**
(the comparator's `threshold` and/or `allowedMismatchedPixelRatio` axes) against an explicitly
declared, non-zero threshold. No visual assertion MUST rely on byte-for-byte image equality, and
no visual assertion MUST omit a threshold and thereby fall back to an implicit strict default
that behaves as byte equality in practice.

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

#### Scenario: Fake-context call-sequence tests keep running unchanged
- **GIVEN**: the `renderers` project's existing fake-`TraceDrawingContext` call-sequence tests
  (e.g. the `canvas2d-axes-grid` paint-order scenarios)
- **WHEN**: this change lands and `pnpm run test` runs
- **THEN**: those tests still execute inside the `renderers` project, unmodified in mechanism, and
  still pass

#### Scenario: No visual test asserts call sequence against a fake context
- **GIVEN**: the browser-mode visual project's test files
- **WHEN**: their imports and assertions are inspected
- **THEN**: none constructs or asserts against a fake `TraceDrawingContext`; every assertion in
  that project is a `toMatchScreenshot`-shaped visual comparison
