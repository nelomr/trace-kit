# Capability: ci-quality-gate

> Change: `browser-visual-regression-harness` (roadmap order 5.5). Modified capability — base
> merged at `openspec/specs/ci-quality-gate/spec.md` by `workspace-test-harness-bootstrap` and
> `playground-shell`.
>
> Source: `proposal.md` §"Modified Capabilities" (`ci-quality-gate`) and §"Scope" ("CI
> Integration"). Extends the existing `No Vacuous-Green CI Tasks` anti-vacuity discipline
> (`scripts/verify-turbo-ran.mjs`) to the visual suite, and adds the Playwright browser-binary
> cache/install step as part of the gate rather than as an optional convenience. Also carries
> decision **P9**: repository commands emit no Node deprecation warning attributable to
> repository code.

## ADDED Requirements

### Requirement: A Visual Suite That Resolves to Zero Executed Tests Fails CI
The visual test suite MUST be reachable from the Turborepo task graph that
`scripts/verify-turbo-ran.mjs` inspects. If the visual suite resolves to zero executed test
cases — whether because the task plans no runnable command, because every visual test is
unconditionally skipped, or because the browser project matches no test file — CI MUST fail,
mirroring the existing anti-vacuity guard's treatment of `typecheck`/`lint`/`test` rather than
reporting a silent green.

#### Scenario: A visual task with zero runnable commands fails the vacuity guard
- **GIVEN**: `scripts/verify-turbo-ran.mjs` invoked against the task name that runs the visual
  suite
- **WHEN**: `turbo run <task> --dry=json` plans no runnable command for that task (every planned
  task's `command` is `"<NONEXISTENT>"`, or no planned task's `task` field matches the requested
  name)
- **THEN**: the guard exits non-zero (code `1`), exactly as it does today for `lint` resolving to
  `0 successful, 0 total`

#### Scenario: Every visual case being skipped is distinguished from zero tests executed
- **GIVEN**: the CI job's `ubuntu-latest` run, where the visual suite is expected to execute for
  real (per `visual-golden-corpus`'s platform-skip requirement, skipping applies only off-CI)
- **WHEN**: the visual suite's test-run summary reports zero executed (non-skipped) test cases on
  that CI run
- **THEN**: a CI verification step fails the job, naming that the visual suite executed zero real
  cases on the one platform where it is expected to run for real

#### Scenario: A populated, executing visual suite passes the same check
- **GIVEN**: the visual suite with its parity-minimal fixture set (`render-scenario-fixtures`)
  wired into the Turborepo task graph
- **WHEN**: the CI job runs on `ubuntu-latest`
- **THEN**: the verification step observes at least one visual test case executed (not skipped)
  and passes

### Requirement: CI Caches and Installs the Playwright Browser Binary as Part of the Gate
`.github/workflows/ci.yml` MUST include a Playwright browser binary cache step
(`~/.cache/ms-playwright`), alongside the existing `actions/cache@v6` Turborepo cache step, and a
browser install step, both as required parts of the quality gate — not as an optional or
best-effort step that is allowed to fail without failing the job.

#### Scenario: The workflow declares a Playwright binary cache step
- **GIVEN**: `.github/workflows/ci.yml` after this change
- **WHEN**: its steps are enumerated
- **THEN**: at least one step caches `~/.cache/ms-playwright` (or the equivalent Playwright
  binary cache path), alongside the pre-existing Turborepo cache step, which remains present and
  unmodified

#### Scenario: A failed browser install fails the job
- **GIVEN**: the browser install step
- **WHEN**: it exits non-zero (e.g. a broken download)
- **THEN**: the CI job fails — the step is not marked `continue-on-error` or otherwise allowed to
  fail silently

#### Scenario: A warm cache is reused on a subsequent run
- **GIVEN**: a prior CI run that populated the Playwright binary cache
- **WHEN**: a subsequent CI run starts with an unchanged Playwright version
- **THEN**: the browser install step reports a cache hit and does not re-download the browser
  binary from scratch

### Requirement: The Visual Suite Is Reachable From `pnpm run test` → `turbo run test`
Whether the visual suite runs under the existing `test` Turborepo task or a dedicated task in
`turbo.json` is a design-level choice, but either way it MUST remain reachable from
`pnpm run test` → `turbo run test` at the root, so that `scripts/verify-turbo-ran.mjs`'s existing
coverage of the `test` task continues to cover the visual suite and no new, uncovered task name
is introduced silently.

#### Scenario: pnpm run test triggers the visual suite's task, directly or transitively
- **GIVEN**: the repository root
- **WHEN**: `pnpm run test` runs
- **THEN**: the Turborepo task graph it resolves to includes the visual suite's task (either
  directly under `test` or as a task `test` depends on), and `scripts/verify-turbo-ran.mjs`'s
  existing invocation continues to observe it as part of its planned/executed task set

### Requirement: No Repository Command Emits a Deprecation Warning Caused by Repository Code
Running any of the repository's declared verification commands — `pnpm exec turbo run typecheck`,
`pnpm exec turbo run lint`, `pnpm run test` and `pnpm exec turbo run build` — MUST NOT emit a
Node runtime deprecation warning (`[DEP####]  DeprecationWarning`) that is attributable to code
in this repository. Warnings originating in a third-party tool rather than in repository code are
outside this requirement and MUST NOT be worked around by suppressing warnings globally: in
particular `DEP0169` (`url.parse()`), emitted by pnpm 9.15.4 during `pnpm install`, is explicitly
excluded. Suppressing warnings — via `NODE_OPTIONS=--no-deprecation`, `--no-warnings`, a
`process.removeAllListeners("warning")` call, or stream filtering — MUST NOT be used to satisfy
this requirement.

#### Scenario: `pnpm run test` emits no DEP0152 warning
- **GIVEN**: the repository after this change, on Node 24
- **WHEN**: `pnpm run test 2>&1 | grep -c "DEP0152"` is run
- **THEN**: the count is `0` — the `Custom PerformanceEntry accessors are deprecated` warning no
  longer appears

#### Scenario: The GC observers read their fields from `entry.detail`
- **GIVEN**: `packages/core/test/decimation/allocation-gate.test.ts` and
  `packages/core/test/viewport/transform-allocation.test.ts`
- **WHEN**: each `PerformanceObserver` callback's field access is inspected
- **THEN**: `kind` and `flags` are read from the entry's `detail` property, not from the
  `PerformanceEntry` itself

#### Scenario: The allocation gates still assert the same GC facts after the fix
- **GIVEN**: the two rewritten observer callbacks
- **WHEN**: `pnpm run test` is run
- **THEN**: both files pass with the same assertions they made before the fix — the observed GC
  event count and the decoded `kind` values are unchanged, so the fix is a field-access change
  and not a weakening of the zero-GC gate

#### Scenario: The rule is not satisfied by suppressing warnings
- **GIVEN**: the repository's `package.json` scripts, `turbo.json`, `vitest.config.ts` and
  `.github/workflows/ci.yml`
- **WHEN**: they are searched for `--no-deprecation`, `--no-warnings` and
  `removeAllListeners("warning")`
- **THEN**: none is present

#### Scenario: A third-party deprecation warning does not fail the gate
- **GIVEN**: `pnpm install --frozen-lockfile`, which emits `DEP0169` from pnpm 9.15.4 itself
- **WHEN**: the CI job runs
- **THEN**: the job is not failed by that warning — the requirement is scoped to warnings
  attributable to repository code, and `DEP0169` is not one
