# Capability: test-harness

> Change: `browser-visual-regression-harness` (roadmap order 5.5). Modified capability — base
> merged at `openspec/specs/test-harness/spec.md` by `workspace-test-harness-bootstrap` and
> `playground-shell`.
>
> Source: `proposal.md` §"Modified Capabilities" (`test-harness`). The root `test.projects`
> array gains a fifth entry — the first project in this workspace able to produce a pixel. The
> provider-factory and no-`environment` shape of that entry is governed by
> `browser-visual-regression`; this delta governs only the project-count and isolation
> guarantees at the `test-harness` level.

## ADDED Requirements

### Requirement: A Fifth Vitest Project Rasterizes in a Real Browser
`vitest.config.ts`'s `test.projects` array MUST gain a fifth entry — a browser-mode project
using the Playwright provider — rooted at `packages/renderers`, alongside the existing `core`,
`playground`, `renderers`, and `renderers-dom` entries. This is the first project in the
workspace capable of producing an actual rasterized pixel; the other four remain call-sequence,
DOM-shape, or pure-computation projects and produce no pixel.

#### Scenario: test.projects contains exactly five entries after this change
- **GIVEN**: `vitest.config.ts` as modified by this change
- **WHEN**: `test.projects` is inspected
- **THEN**: it contains exactly five entries — the four pre-existing ones (`core`, `playground`,
  `renderers`, `renderers-dom`) plus one new browser-mode entry

#### Scenario: The new entry is the only one that can produce a rasterized pixel
- **GIVEN**: the five `test.projects` entries
- **WHEN**: each is inspected for whether it can call `getContext("2d")` and obtain a non-null,
  rasterizing context
- **THEN**: only the new browser-mode entry can; `core` runs `environment: "node"` with no
  canvas at all, and `renderers-dom`'s `happy-dom` returns `null` from `getContext("2d")`

### Requirement: The Four Pre-Existing Projects' Configuration Is Unchanged
The `core`, `playground`, `renderers`, and `renderers-dom` project entries' `environment`,
`root`, and isolation configuration MUST be byte-identical to their pre-change values. The new
browser-mode entry MUST be the sole project among the five that declares no `environment` key
(per `browser-visual-regression`); every other entry keeps whatever `environment` value it had
before this change.

#### Scenario: The four pre-existing entries' environment fields are untouched
- **GIVEN**: the four pre-existing `test.projects` entries
- **WHEN**: their `environment` and `root` fields are diffed against their pre-change values
- **THEN**: no difference is found

#### Scenario: Only the new entry omits environment
- **GIVEN**: all five `test.projects` entries after this change
- **WHEN**: each is checked for the presence of an `environment` field
- **THEN**: exactly one (the new browser-mode entry) has none; the other four each declare one
