# Capability: visual-golden-corpus

> Change: `core-gap-and-multi-trace-model` (roadmap `order: 5.7`). MODIFIED delta against the
> archived baseline at `openspec/specs/visual-golden-corpus/spec.md` (as previously modified by
> `core-scale-transforms`).
>
> Source: `proposal.md` Scope ("Goldens for a gapped trace and for overlaid traces on two axes"),
> Modified Capabilities, Success Criteria ("Existing goldens show zero diff; new gapped and
> overlay goldens added"). This delta adds two new golden scenarios and restates the zero-diff
> regression guarantee for this change's own gap and multi-trace additions; every other archived
> requirement of this capability (CI-only generation, single Linux corpus, no LFS, explicit golden
> updates, self-hosted font, log-axis and dual-axis goldens) holds verbatim and is not restated.

## MODIFIED Requirements

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
