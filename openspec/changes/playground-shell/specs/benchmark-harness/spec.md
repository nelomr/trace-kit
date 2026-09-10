# Capability: benchmark-harness

> Change: `playground-shell`. Modified capability — base introduced by
> `workspace-test-harness-bootstrap` (not yet archived into `openspec/specs/`; delta applies
> against that change's `specs/benchmark-harness/spec.md`).

## MODIFIED Requirements

### Requirement: Warm-Up and Median-of-N Reporting
The benchmark harness MUST perform an explicit warm-up phase before any timed iteration and MUST
report a median across N measured iterations, **and it now gains an interactive consumer**: the
playground's `/core-math` millisecond table calls into the same warm-up/median-of-N logic used
by the CI benchmark checks, so a number a human reads in the panel means the same thing the CI
benchmarks mean.

#### Scenario: The playground's millisecond table uses the harness, not an ad hoc timer
- **GIVEN**: the `/core-math` view's millisecond table implementation
- **WHEN**: a source-level check inspects how it computes its displayed timing value
- **THEN**: it calls the shared benchmark harness's warm-up + median-of-N function rather than
  wrapping a single `performance.now()` call around one invocation
