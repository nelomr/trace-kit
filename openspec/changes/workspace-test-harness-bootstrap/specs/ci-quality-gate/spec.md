# Capability: ci-quality-gate

> Change: `workspace-test-harness-bootstrap`. New capability.

## ADDED Requirements

### Requirement: No Vacuous-Green CI Tasks
A CI task named in `ci.yml` (`typecheck`, `lint`, `test`) that resolves, via Turborepo, to zero
executed package tasks MUST be treated as a CI failure, not a pass. This is the correction to
the currently observed behavior: `turbo run lint` today prints "No tasks were executed as part
of this run", reports `0 successful, 0 total`, and exits `0`; `pnpm run test` resolves to
`turbo run test`, executes only the `build` dependency, runs no test task, and exits `0`.

#### Scenario: A CI verification step fails when a required task executes zero tasks
- **GIVEN**: a CI workflow step that runs `pnpm exec turbo run lint --output-logs=full` followed
  by a verification step that inspects Turborepo's run summary
- **WHEN**: the verification step observes `0 successful, 0 total` (or equivalent "no tasks
  executed" output) for a task the workflow declares as required
- **THEN**: the verification step exits non-zero and fails the CI job, even though the
  `turbo run lint` command itself exited `0`

#### Scenario: A populated task set passes the same verification step
- **GIVEN**: every package now declares a real `lint` script (per `test-harness` capability)
- **WHEN**: the same verification step runs after this change lands
- **THEN**: the verification step observes at least one successful task and passes

### Requirement: CI Executes Genuine Work Per Task
`typecheck`, `lint`, and `test` steps in `ci.yml` MUST each execute real, non-trivial work
across the packages that declare the corresponding script.

#### Scenario: typecheck step performs real type checking
- **GIVEN**: `packages/core` declares a `typecheck` script running `tsc --noEmit`
- **WHEN**: the CI `typecheck` step runs
- **THEN**: the step's log shows `tsc` invoked against `packages/core` and completing with no
  errors

### Requirement: Demonstrated Green Workflow With the Isomorphic Test
The GitHub Actions workflow MUST be demonstrated green with the Node-isomorphism test (from
`test-harness`) passing as part of the `test` step.

#### Scenario: CI run is green with the isomorphism test included
- **GIVEN**: a CI run of `ci.yml` on this change's branch
- **WHEN**: the workflow completes
- **THEN**: every job succeeds, and the `test` job's log includes the isomorphism test file name
  reported as passed
