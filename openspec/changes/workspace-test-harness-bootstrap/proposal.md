# Proposal: workspace-test-harness-bootstrap

> Change 1 of the 16-change decomposition in
> `openspec/changes/00-roadmap-decomposition/exploration.md` (§2 inventory, §3 graph).
> Hard prerequisites: **none**. This is the root of the dependency graph.

## Problem / Motivation

This repository is a skeleton, and the single most important fact about it is that
**`strict_tdd: true` is declared in `openspec/config.yaml` while no test harness exists at
all**. Strict TDD is currently impossible by construction (exploration §0).

Verified current state of the working tree:

- The only source file in the entire monorepo is `packages/core/src/index.ts`, which exports a
  single `VERSION` constant. There is no `apps/` directory, no `packages/renderers`, no
  `packages/vue`, no `packages/react`.
- There is **no Vitest configuration and no test file anywhere**. No package declares a `test`
  or `test:unit` script.
- There is **no lint configuration** of any kind (no ESLint, Biome, oxlint or Prettier config).
- `.github/workflows/ci.yml` exists and invokes `turbo run typecheck`, `turbo run lint` and
  `pnpm run test`. Because no package declares `lint` or `test` scripts, Turborepo resolves
  those tasks to nothing. **CI is green by vacuity** — it currently proves only that
  `packages/core` typechecks. This is worse than a red pipeline, because it manufactures
  confidence that no downstream change can rely on.
- `packages/core` builds with bare `tsc` (`"build": "tsc"`). There is no `tsup` configuration,
  so there is no dual ESM/CJS output, and `packages/core/package.json` has `main`/`types` but
  **no `exports` map**. It also declares `sideEffects: false` with nothing having audited that
  claim.
- `tsconfig.base.json` **does exist** and already sets `target: ES2022`, `module: ESNext`,
  `moduleResolution: bundler`, `strict: true`, `declaration`, `declarationMap`, `sourceMap` and
  `isolatedModules`. This is a small drift from exploration §0, which recorded no
  `tsconfig.base.json`; the file has since been added. It is **not** complete for this project's
  purposes: `noUncheckedIndexedAccess` is absent, and every downstream change in this plan is
  dominated by typed-array indexing where an unchecked index is exactly the class of bug that
  silently produces `undefined` inside a numeric hot loop.
- `pnpm-workspace.yaml` globs `packages/*` and `apps/*` and pins a catalog
  (`@types/node ^22.10.0`, `typescript ^5.7.0`, `vitest ^3.0.0`) — so `vitest` is already
  *pinned* but never *wired*.
- Root `package.json` is `private: true`, `0.0.0`, MIT, with Changesets configured.

Consequence, stated plainly in exploration §4 as a **High** severity risk: this change is not
optional scaffolding. It is the load-bearing prerequisite that `strict_tdd: true` depends on,
and **if it under-scopes the harness, every downstream TDD cycle inherits false confidence.**
Fifteen changes sit behind it in the graph.

There is a second, quieter motivation. Confirmed decision 3 rewrites every performance
acceptance criterion in the plan as a self-calibrating relative regression budget plus a
deterministic work-count assertion. A regression budget is meaningless without a measurement
harness that warms up and reports a median. Claim **C4b** shows exactly why warm-up is not a
nicety: the cold first invocation of a numeric pass runs in the interpreter before TurboFan
tiering and can be 3–5x slower than the warm steady state, which is enough on its own to blow
any millisecond budget. The benchmark harness therefore has to exist *before* the first change
that has a performance criterion, which is change 2.

## Proposed Approach

Build the harness, and only the harness. No domain code, no algorithms, no renderers.

1. **Workspace wiring.** Keep the existing `pnpm-workspace.yaml` globs and catalog. Extend the
   catalog with the harness dependencies (Vitest already pinned, plus `tsup`, the chosen linter,
   and the benchmark harness dependencies) so every future package inherits pinned versions
   rather than resolving its own.

2. **`tsconfig.base.json` completion.** Retain the existing options and add
   `noUncheckedIndexedAccess` plus the remaining strictness flags this project needs. Every
   package `tsconfig.json` extends the base and adds only paths. `any` is unavailable by policy
   (CLAUDE.md rule 1) and the lint configuration enforces that mechanically rather than by
   review — including the `Record<string, any>` / `, any>` form and `as never` used to suppress
   an error.

3. **Per-package build via `tsup`.** Dual ESM + CJS output, `dts: true` with declaration maps,
   sourcemaps, and an **audited** `sideEffects` declaration. Audited means: a documented check
   that the package's modules are genuinely effect-free, because per exploration §1.10
   `sideEffects: false` is a *correctness assertion*, and declaring it falsely produces silently
   broken consumer builds. `packages/core`'s current unaudited `sideEffects: false` is
   grandfathered into that audit.

4. **Per-package `exports` maps; no root `exports` map.** Correcting the brief explicitly: the
   brief places `exports["./vue"]`, `exports["./react"]` etc. in the root `package.json` pointing
   into `packages/*/dist`. Per exploration §3.11 (§1.11 in the numbered findings) that is **dead
   configuration** — the root is `private: true` and is never published, so npm never reads it.
   The correct model is independently published packages, each owning its own `exports` map and
   its own Changesets version. No umbrella package. This change establishes the pattern on
   `@trace-kit/core`; the full gate (`publint`, `are-the-types-wrong`, tree-shaking fixture) is
   deferred to change 12.

5. **Vitest harness with one green isomorphic Node test.** A root Vitest configuration plus a
   per-package `test` script so `turbo run test` stops being a no-op. The one test is
   deliberately trivial in content and load-bearing in shape: it imports `@trace-kit/core` in a
   plain **Node** environment (no jsdom, no DOM globals) and asserts it loads and evaluates.
   That single test is the Node-isomorphism tripwire for CLAUDE.md rule 5 — the first time
   anyone reaches for `document` or `window` inside the core, this test fails.

6. **`tsc --noEmit` and lint as real tasks.** Wire genuine `typecheck` and `lint` scripts into
   every package so the existing CI steps stop resolving to nothing.

7. **Benchmark harness.** A small, dependency-light runner providing explicit **warm-up**
   iterations, **median-of-N** reporting, and p95 alongside the median. It records results to a
   machine-readable file so later changes can compute a relative regression budget against a
   baseline measured on the same runner. It is invoked by its own script, never inside the
   coverage job (instrumentation distorts timing, exploration §1.5), and it is not gated on
   shared CI runners.

8. **Green GitHub Actions.** The existing `ci.yml` shape is kept. The change makes its steps
   *mean* something: typecheck, lint and unit tests all execute real work, and the workflow is
   demonstrated green with the one isomorphic test passing.

9. **Changesets.** Already configured; this change adds its own patch changeset, honouring the
   low-velocity `0.0.x` pacing of CLAUDE.md rule 8.

## Capabilities (Contract for `sdd-spec`)

### New Capabilities

- `workspace-toolchain`: pnpm workspace wiring, catalog-pinned dependency versions, the
  completed `tsconfig.base.json` contract (ES2022 / ESNext / Bundler resolution / `strict` /
  `noUncheckedIndexedAccess`), and the per-package `tsconfig.json` extension pattern.
- `package-build-pipeline`: per-package `tsup` dual ESM/CJS build producing declarations with
  declaration maps, per-package `exports` maps, and audited `sideEffects` declarations. The
  no-root-`exports` rule is part of this capability's contract.
- `test-harness`: the Vitest harness, the Node-environment isomorphism test contract, and the
  `typecheck` / `lint` / `test` task wiring that makes `strict_tdd: true` satisfiable.
- `benchmark-harness`: the warm-up + median-of-N measurement runner and its machine-readable
  result format, which every later performance criterion in the plan consumes as its baseline
  mechanism.
- `ci-quality-gate`: the GitHub Actions workflow contract — which tasks run, which do not run on
  shared runners, and the rule that performance assertions never run in the coverage job.

### Modified Capabilities

None. There are no existing specifications in `openspec/specs/` to modify.

## Impact on TraceKit Packages

- `packages/core`: build switched from bare `tsc` to `tsup` dual-format; gains an `exports` map,
  a `test` script, a `lint` script, a real `typecheck` script, and an audited `sideEffects`
  declaration. **`src/index.ts` gains no new domain code** — it stays a `VERSION` export.
- `packages/renderers`, `packages/vue`, `packages/react`: not created here. They are created by
  changes 5, 10 and 11 respectively, each inheriting this change's build and test patterns.
- `apps/playground`, `apps/docs`: not created here (changes 4 and 15).
- Root: `tsconfig.base.json`, `pnpm-workspace.yaml` catalog, Vitest configuration, lint
  configuration, benchmark harness, `turbo.json` task wiring, `ci.yml`.

## Acceptance Criteria Model

Per confirmed decision 3, this change owns no wall-clock performance criterion — it owns the
*machinery* that later criteria are written against. Concretely:

- Every later performance criterion is expressed as **(self-calibrating relative regression
  budget measured on the executing runner) + (deterministic, hardware-independent work-count
  assertion)**. Literal ms / FPS / byte numbers are demoted to **informational benchmarks**,
  recorded by change 16. This change's obligation is to make both halves expressible: the
  benchmark harness supplies the relative budget, and the test harness supplies the environment
  in which a work-count assertion can be written.
- The benchmark harness MUST perform explicit warm-up before any timed iteration and MUST report
  a median-of-N, because per claim **C4b** a cold first invocation can be 3–5x slower than the
  warm steady state. A harness that reports a single cold sample is a defect, not a measurement.
- Zero-allocation criteria in later changes are asserted either by **GC-event count** in Node
  (claim **C4b**: 0 events for the allocation-free variant versus 17 for the allocating control
  over identical iteration counts — total, reproducible discrimination) or by **zero bytes
  attributed to the named hot-path function** in a CDP `HeapProfiler` sampling profile in the
  browser (claim **C4d**). Never by `performance.memory` (claim **C4** — non-standard,
  Chromium-only, quantized at ~100 KB), and never by `measureUserAgentSpecificMemory` (claim
  **C4c** — requires the cross-origin isolation that confirmed decision 4 declines). Never as a
  total-heap or absolute-magnitude assertion: **C4d** records that sampled magnitudes
  under-report by three orders of magnitude and do not scale predictably with the sampling
  interval, so only the binary named-function form is sound.
- This change's own criteria are all deterministic and hardware-independent: the tasks execute
  real work, the isomorphic test passes in a Node environment, both build formats are emitted
  with declarations and declaration maps, and the workflow is green.

## Scope & Non-Goals

Deliberately deferred, with the owning change named:

- **Any domain code** — branded buffers, `SpectrumDataPayload`, `minMaxEnvelope`, `lttb`:
  change 2 (`core-decimation-math`). This change is harness only.
- **Property-based testing with `fast-check`, the determinism test, the peak-fidelity test, the
  GC-event zero-allocation gate, and the `--trace-deopt` check**: change 2. The harness makes
  them possible; it does not contain them.
- **The full packaging gate** — `publint`, `are-the-types-wrong`, the ESM-scoped tree-shaking
  fixture with bundle grep and byte ceiling, and the Next.js SSR smoke-test app: change 12
  (`package-exports-and-treeshaking-gates`). This change establishes the `exports` and
  `sideEffects` *pattern* only.
- **Playwright, browser-side testing, and the CDP `HeapProfiler` gate**: first needed by change 5
  and change 7. Not wired here.
- **Coverage thresholds per glob and a pinned coverage provider**: change 16
  (`benchmark-ci-and-deployment`). Noted now because exploration §1.5 records that `v8` and
  `istanbul` disagree on numeric-loop branches, so the provider must eventually be pinned.
- **`apps/playground`**: change 4. **`apps/docs` (VitePress)**: change 15, per confirmed
  decision 1.
- **Any change to `openspec/config.yaml`**: out of scope. Its two stale values
  (`artifact_store: both`, `delivery_strategy: ask-always`) are flagged to the user separately
  in exploration §6.

Package scope is `@trace-kit/*` throughout. The brief's `@optic-vis/*` is a stale template
leftover (exploration §3.11) and appears nowhere in this change.

## Delivery

Delivery strategy is **`exception-ok`**, explicitly accepted by the user: one PR for this
change, and the 400-line review budget is **not** a blocker. This change is expected to exceed
it — it touches root configuration, every package manifest, CI, and the two harnesses — and that
is accepted rather than split.

Versioning follows CLAUDE.md rule 8: a Changesets `patch` bump within the `0.0.x` series.
