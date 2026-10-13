# Capability: svg-golden-corpus

> Change: `svg-vector-export` (roadmap `order: 6`). New capability.
>
> Source: `proposal.md` Problem 2, Approach 7. A platform-independent textual gate on the
> projection. Contrast with `visual-golden-corpus` (pixel goldens, one pinned rasterizer): this
> corpus runs everywhere.

## ADDED Requirements

### Requirement: Committed `.svg` Goldens Exist for Every SVG Scenario
For each scenario in the SVG corpus (the five parity scenarios of `render-scenario-fixtures` plus
the four SVG-extended scenarios it declares: log axis, dual axis, gapped, two-trace overlay) a
committed `.svg` golden MUST exist, produced by `exportToSvg` for that fixture with default
options. Goldens MUST live in a directory dedicated to SVG goldens, separate from pixel goldens.

#### Scenario: One golden per scenario
- **GIVEN**: the SVG corpus scenario list
- **WHEN**: the golden directory is enumerated
- **THEN**: there is exactly one `.svg` per scenario and no orphan `.svg` without a scenario

#### Scenario: The corpus covers the required figure kinds
- **GIVEN**: the scenario list
- **WHEN**: it is inspected
- **THEN**: it includes a log-axis figure, a dual-axis figure, a gapped figure, and an overlaid
  two-trace figure

### Requirement: Goldens Are Compared Byte-Exact in the Node Unit Suite on Every Platform
Each golden MUST be compared against freshly exported output by strict string equality in the
ordinary Node unit test run (`pnpm run test`), with no browser, no DOM, no rasterizer, no CI-only
gate and no platform skip. A mismatch MUST fail the test and report the scenario name and the first
differing line.

#### Scenario: Goldens run under plain Node
- **GIVEN**: the SVG golden tests
- **WHEN**: they run on macOS, Linux and Windows without a browser
- **THEN**: they execute (none skipped) and pass on committed goldens

#### Scenario: A one-character drift fails
- **GIVEN**: a golden with one coordinate digit altered
- **WHEN**: the comparison runs
- **THEN**: the test fails and names the scenario and first differing line

#### Scenario: No skip gating exists
- **GIVEN**: the SVG golden test source
- **WHEN**: it is searched for `skipIf`, `process.env.CI` and platform checks
- **THEN**: there is no such gating

### Requirement: Goldens Pin the Projection Numbers
Because goldens are exact text, they MUST be sufficient to detect regressions in: tick positions
and labels, decade gridline positions, per-axis gutters, gap breaks, per-trace axis binding, marker
placement and the coordinate formatter (`SVG_COORDINATE_DECIMALS = 2`).

#### Scenario: Changing a tick position changes a golden
- **GIVEN**: a mutation shifting one tick's projected position by `0.01` CSS px
- **WHEN**: the corpus runs
- **THEN**: at least one golden test fails

#### Scenario: Changing the precision constant fails the corpus
- **GIVEN**: `SVG_COORDINATE_DECIMALS` altered to `3`
- **WHEN**: the corpus runs
- **THEN**: at least one golden test fails

### Requirement: Golden Update Is an Explicit, Reviewable Act
Goldens MUST be regenerated only by a dedicated update command (a script or an environment flag
named in the test README) and never automatically on a mismatch. The ordinary test run MUST NOT
write files. A regenerated golden MUST appear as a diff in version control for review.

#### Scenario: A normal run never writes
- **GIVEN**: a clean working tree and a failing golden
- **WHEN**: `pnpm run test` runs
- **THEN**: it fails and the working tree remains clean

#### Scenario: The update command rewrites goldens
- **GIVEN**: the documented update command
- **WHEN**: it runs after an intended output change
- **THEN**: the changed goldens appear in `git status` as modified files

### Requirement: Goldens Are Deterministic Across Runs
Regenerating goldens twice in a row without code changes MUST produce byte-identical files, with
`\n` line endings, and the repository MUST mark `.svg` goldens as text with LF normalization so
checkout cannot alter bytes.

#### Scenario: Idempotent regeneration
- **GIVEN**: freshly regenerated goldens
- **WHEN**: regeneration runs again
- **THEN**: `git diff` is empty

#### Scenario: LF is enforced
- **GIVEN**: the repository attributes
- **WHEN**: the SVG golden path is checked with `git check-attr eol`
- **THEN**: it reports `lf`
