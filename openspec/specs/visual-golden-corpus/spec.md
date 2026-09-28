# Capability: visual-golden-corpus

> Change: `browser-visual-regression-harness` (roadmap order 5.5) (ADDED). Modified by: `core-scale-transforms` (roadmap `order: 5.6`).
>
> Source: `proposal.md` §"Proposed Approach" 2 and 4, Constraints 1 and 3, decision **P1**;
> `preproposal.md` decisions **P5** (self-hosted font, single-Linux-corpus platform policy) and
> **P6** (self-hosted font becomes the library default). Research **C7**, **C8**, **C16**,
> **C17**. Governs the golden images as a governed artefact and the font precondition their
> stability depends on. Comparison mechanics live in `browser-visual-regression`; scenario
> identity lives in `render-scenario-fixtures`.

## ADDED Requirements

### Requirement: Goldens Are Generated Only in the CI Environment
Golden PNG images for the visual suite MUST be produced only by a run of the CI workflow on
`ubuntu-latest`. No workflow, script, or documented developer procedure MUST capture a golden on
a developer machine and commit it as a baseline. Reason: rendering varies by host OS, hardware,
and headless mode (research **C7**); comparing a golden against output rasterized in a different
environment than the one that produced it is not a test of the renderer.

#### Scenario: The golden-generation path runs only in the CI job
- **GIVEN**: `.github/workflows/ci.yml` as modified by this change
- **WHEN**: the golden-generation step is inspected
- **THEN**: it is reachable only from a job running on `ubuntu-latest`, and no equivalent step
  exists in any local-only script (e.g. no `pnpm run` script writes into the golden directory)

#### Scenario: No committed script writes a golden from a non-CI invocation
- **GIVEN**: every script under `scripts/` and every `package.json` script in the repository
- **WHEN**: they are inspected for a golden-write path
- **THEN**: none of them writes to the golden image directory when invoked outside the CI
  workflow's declared golden-generation step

### Requirement: Visual Cases Skip With an Explicit Message Outside the Single Supported Platform
A visual test case MUST detect when it is not running on the single supported platform (CI on
`ubuntu-latest`) and MUST skip itself rather than run a comparison, and the skip MUST report an
explicit, human-readable message naming the reason (platform mismatch) rather than skipping
silently or failing.

#### Scenario: A visual case skips on a developer's macOS machine
- **GIVEN**: a visual test case run locally on macOS (not `ubuntu-latest` CI)
- **WHEN**: the test file executes
- **THEN**: the test reports as skipped, not passed and not failed, and the skip reason string
  names the platform restriction (e.g. references that visual goldens are Linux-CI-only)

#### Scenario: The same case runs for real on ubuntu-latest CI
- **GIVEN**: the identical visual test case running inside the CI workflow's `ubuntu-latest` job
- **WHEN**: the test file executes
- **THEN**: it is not skipped — it performs a real comparison against the committed golden and
  reports pass or fail

### Requirement: Exactly One Corpus, With No OS-Suffixed Golden Filenames
The golden corpus MUST consist of exactly one image set, generated and compared on
`ubuntu-latest` only. Golden filenames MUST NOT embed a platform suffix (e.g. no
`-darwin`/`-linux`/`-win32` segment), even though Playwright's own default baseline naming does
embed one. This is a deliberate rejection of Playwright's documented default (research **C8**),
accepted after the multi-platform alternative's maintenance cost was presented and declined.

#### Scenario: Golden filenames carry no platform suffix
- **GIVEN**: every committed file under the golden image directory
- **WHEN**: filenames are inspected
- **THEN**: none contains a platform-name segment (`darwin`, `linux`, `win32`, or equivalent)

#### Scenario: A second platform's run resolves to the same golden path
- **GIVEN**: the golden path resolution logic used by the visual assertion
- **WHEN**: it is invoked hypothetically as if running on a second platform (without actually
  running visual cases there, per the skip requirement above)
- **THEN**: it resolves to the identical filename it would resolve to on `ubuntu-latest` — the
  path is not a function of `process.platform`

### Requirement: Goldens Are Stored as Plain Git Objects, No Git LFS
The golden image corpus MUST be committed as ordinary git-tracked files. No `.gitattributes`
entry, LFS filter, or external artefact store MUST be introduced for the golden directory.
Reason: measured precedent (deck.gl, 214 PNGs / 9.4 MB total — research **C16**, **C17**) shows
a corpus of this shape carried without LFS in a mainstream repository, and plain-git storage
keeps this change inside CLAUDE.md rule 7's filesystem-only posture.

#### Scenario: No LFS configuration is introduced for the golden directory
- **GIVEN**: the repository after this change
- **WHEN**: `.gitattributes` (if present) and any LFS configuration are inspected
- **THEN**: no entry routes the golden image directory (or any `*.png` glob covering it) through
  Git LFS

#### Scenario: A committed golden is a real git blob, not a pointer file
- **GIVEN**: any committed file under the golden image directory
- **WHEN**: `git cat-file -p` is run against its blob
- **THEN**: the output is genuine PNG binary content, not an LFS pointer text stub

### Requirement: A Golden Update Is an Explicit, Reviewable Act, Including for Existing Single-Linear-Axis Goldens
Regenerating and landing a golden MUST be an intentional, visible step in the change that alters
it — never an incidental side effect of an unrelated test run. A test run that would produce a
different pixel output than the committed golden MUST fail that comparison rather than silently
overwrite the committed file. Specifically for this change: every existing single-linear-axis
golden MUST show zero pixel diff after this change lands, because the linear projection
coefficients and the linear branch of `projectY` are byte-identical to their pre-change values;
any diff on a pre-existing single-linear-axis golden is a regression to be fixed, not a golden to
be regenerated.

#### Scenario: An ordinary test run never overwrites a committed golden
- **GIVEN**: a committed golden and a renderer change that would produce different pixel output
- **WHEN**: the standard visual test run (not a designated golden-update invocation) executes
- **THEN**: the comparison fails, and the committed golden file on disk is unchanged after the
  run

#### Scenario: The golden-update path is a separate, named invocation
- **GIVEN**: the documented or scripted mechanism for regenerating a golden
- **WHEN**: it is inspected
- **THEN**: it requires an explicit, separate invocation (a distinct script, flag, or workflow
  path) from the standard comparison run — a developer or CI reviewer can see that a golden was
  regenerated by the diff, rather than it happening implicitly

#### Scenario: Every pre-existing single-linear-axis golden shows zero diff after this change
- **GIVEN**: the full set of golden images committed before this change, each depicting a
  single, left, linear Y axis
- **WHEN**: the visual test suite runs against the renderer as modified by this change
- **THEN**: every one of those pre-existing goldens reports a pixel diff of zero against its
  freshly rendered comparison

### Requirement: The Golden Corpus Includes a Log-Scale Y-Axis Figure
The golden corpus MUST include at least one scenario fixture rendering a single Y axis with
`yScaleKind === Y_SCALE_KIND_LOG`, including its decade gridlines and axis labels, captured and
compared under the same CI-only, single-Linux-corpus, no-LFS, explicit-update rules as every
other golden in this capability.

#### Scenario: A log-axis golden exists and is compared under the standard visual test run
- **GIVEN**: the golden image directory after this change
- **WHEN**: it is inspected
- **THEN**: it contains a golden depicting a log-scale Y axis, and the corresponding visual test
  case runs a real comparison on `ubuntu-latest` CI (not skipped, per the archived platform-skip
  requirement) and skips with an explicit message on any other platform

### Requirement: The Golden Corpus Includes a Dual-Y-Axis Figure
The golden corpus MUST include at least one scenario fixture rendering two independent,
left-stacked Y axes sharing one X domain — one linear and one log, or two of differing scale
kinds — with correctly stacked left gutters, captured and compared under the same CI-only,
single-Linux-corpus, no-LFS, explicit-update rules as every other golden in this capability.

#### Scenario: A dual-axis golden exists and is compared under the standard visual test run
- **GIVEN**: the golden image directory after this change
- **WHEN**: it is inspected
- **THEN**: it contains a golden depicting two left-stacked Y axes against one shared X domain,
  and the corresponding visual test case runs a real comparison on `ubuntu-latest` CI and skips
  with an explicit message on any other platform

### Requirement: The Library Ships a Self-Hosted Font as the Default Label Font
`@trace-kit/renderers`' default `FigureStyle.font` MUST resolve to a font shipped with the
library (embedded or bundled as a library asset), not to a generic CSS font-family keyword such
as `sans-serif` that the host operating system substitutes. This MUST hold both for the visual
suite's rendering and for the library's default behavior for any consumer who does not override
`font`. Reason: a generic family resolves to different glyph outlines per host OS (Helvetica on
macOS, DejaVu Sans on Linux, Arial on Windows), which is a source of golden divergence unrelated
to the renderer; replacing it removes that divergence at its source rather than tolerating it
with a looser threshold (**P5**, **P6**).

#### Scenario: The default style's font is not a generic CSS family keyword
- **GIVEN**: `DEFAULT_FIGURE_STYLE.font` (or its equivalent successor) as exported by
  `@trace-kit/renderers`
- **WHEN**: its value is inspected
- **THEN**: it does not equal or contain a bare generic CSS font-family keyword
  (`sans-serif`, `serif`, `monospace`, `system-ui`, or equivalent) as the resolved family; it
  names the library's shipped font

#### Scenario: The shipped font renders identically across host operating systems
- **GIVEN**: the same scenario fixture rendered with the default style on two different host
  operating systems that both have the shipped font available to the renderer
- **WHEN**: the rendered label glyphs are compared
- **THEN**: they use the identical font's glyph outlines — the outcome does not depend on which
  OS-provided font a generic family keyword would have resolved to

### Requirement: A Consumer May Override the Default Font
`FigureStyle.font` MUST remain a plain, overridable configuration field: a consumer MUST be able
to supply their own `font` value (including a generic CSS family or a different shipped font) at
construction, and doing so MUST NOT require any change to the library's own default or its
shipped font asset.

#### Scenario: Passing a custom font value overrides the shipped default
- **GIVEN**: a renderer constructed with `style: { ...DEFAULT_FIGURE_STYLE, font: "12px monospace" }`
- **WHEN**: the renderer paints axis labels
- **THEN**: the label text is drawn using the consumer-supplied `font` value, not the library's
  shipped default font

#### Scenario: Omitting a font override keeps the shipped default
- **GIVEN**: a renderer constructed without a `font` override
- **WHEN**: `DEFAULT_FIGURE_STYLE.font` is read
- **THEN**: it is the library's shipped self-hosted font value, unchanged by the existence of the
  override mechanism
### Requirement: A Golden Update Is an Explicit, Reviewable Act, Including for Existing Goldens After This Change
The archived requirement (regenerating a golden is always an intentional, visible, separately
invoked step; an ordinary test run never overwrites a committed golden) continues to hold
unchanged. Specifically for this change: every golden committed before this change MUST show zero
pixel diff after this change lands, because gap detection and per-trace rendering are no-ops on
gap-free, single-trace input (gap-free input has no isolated segment, so no marker is drawn) — the archived single-linear-axis, log-axis, and dual-axis goldens
are all gap-free, single-trace figures, and their rendered output MUST be byte-for-byte identical
to before this change.

#### Scenario: Every pre-existing golden shows zero diff after this change
- **GIVEN**: the full set of golden images committed before this change, none of which depicts a
  gapped trace or more than one trace
- **WHEN**: the visual test suite runs against the renderer as modified by this change
- **THEN**: every one of those pre-existing goldens reports a pixel diff of zero against its
  freshly rendered comparison

## ADDED Requirements

### Requirement: The Golden Corpus Includes a Gapped-Trace Figure
The golden corpus MUST include at least one scenario fixture rendering a single trace containing
a leading gap, an interior gap, and a trailing gap (either as three distinct gaps in one figure,
or as three distinct sub-cases within the fixture set covering this capability), showing a
visible break at each gap location rather than a connecting line, and at least one isolated
sample (a single finite sample bounded by gaps on both sides) rendered as its filled square
marker with the default style, captured and compared under the
same CI-only, single-Linux-corpus, no-LFS, explicit-update rules as every other golden in this
capability.

#### Scenario: A gapped-trace golden exists and shows visible breaks, not bridging lines
- **GIVEN**: the golden image directory after this change
- **WHEN**: it is inspected
- **THEN**: it contains a golden depicting a trace with a leading gap, an interior gap, and a
  trailing gap, each rendered as a visible break rather than a connecting line, plus one isolated
  sample visible as a filled square marker, and the
  corresponding visual test case runs a real comparison on `ubuntu-latest` CI and skips with an
  explicit message on any other platform

### Requirement: The Golden Corpus Includes an Overlaid Two-Trace, Two-Axis Figure
The golden corpus MUST include at least one scenario fixture rendering two traces from a
`TraceCollection`, sharing one X domain, bound to two distinct Y axes with distinct scale kinds
or domains, drawn with visually distinguishable per-trace styles, captured and compared under the
same CI-only, single-Linux-corpus, no-LFS, explicit-update rules as every other golden in this
capability.

#### Scenario: An overlay golden exists depicting two distinctly-styled traces on two axes
- **GIVEN**: the golden image directory after this change
- **WHEN**: it is inspected
- **THEN**: it contains a golden depicting two traces sharing one X domain, each bound to a
  distinct Y axis, rendered with visually distinguishable styles, and the corresponding visual
  test case runs a real comparison on `ubuntu-latest` CI and skips with an explicit message on
  any other platform
