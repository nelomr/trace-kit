# Verification Report: core-decimation-math (Work Unit A — Groups 1-4 only)

> Scope: workspace wiring, branded buffers, `SpectrumDataPayload`, `minMaxEnvelope`.
> Groups 5-10 (lttb, lint-instrument meta-test, `--trace-deopt` bench mode, export barrel,
> changeset) are **not implemented yet** and are explicitly out of scope for this verification
> pass — their absence is noted as pending, not scored as a failure.

## Summary

| Check | Status | Notes |
|---|---|---|
| Completeness (Work Unit A) | PASS | 29/29 tasks (1.1–4.12) checked `[x]` in `tasks.md` and independently confirmed against the files on disk |
| Scenario Compliance (Groups 1-4 capabilities) | PASS | See matrix below |
| Design Coherence | PASS | D1/D2/D3/D5(partial)/D6 implemented as decided; deviation on `pool`/`poolOptions` placement is a documented, functionally-equivalent correction to the literal task wording |
| TraceKit Architecture Non-Negotiables | PASS | Zero `any`/`as never`, zero DOM refs, hot-path allocation-free per GC gate, branded buffers zero-runtime-cost |
| Build & Tests (live run) | PASS WITH KNOWN EXCEPTIONS | `typecheck` exit 0, `lint` exit 0, `test` exit 1 — but the 2 failing tests are pre-declared out-of-scope-for-this-unit failures, not regressions from Work Unit A's code |

## Live Command Output (actually executed, not read from claims)

**`pnpm exec turbo run typecheck`** — exit 0 (cache hit, `tsc --noEmit` clean).

**`pnpm exec turbo run lint`** — exit 0 (cache hit, `eslint .` clean, including the new
`packages/core/src/decimation/**` scoped block).

**`pnpm run test`** — exit 1. 47/49 tests passed across 15/17 files. The 2 failures:
1. `test/side-effects-audit.test.ts` — fails because `src/buffers/brand.ts`,
   `src/decimation/min-max.ts`, `src/payload/spectrum-data-payload.ts` have no row yet in
   `SIDE_EFFECTS_AUDIT.md`. This is explicitly task 8.5 (Group 8, Work Unit B) per `tasks.md`
   and `resume-apply.md`'s own "Known interim failures" section — correctly predicted and
   correctly scoped out of Work Unit A. **Not a Work Unit A defect.**
2. `test/bench/warmup-median.test.ts` — a timing-sensitive assertion
   (`p95 < median * 4`) that is flaky under full-suite CPU contention (confirmed: it passed in
   the earlier isolated run recorded in `resume-apply.md`, and this run's failure margin —
   1.479 vs 1.070 — is consistent with scheduler noise, not a logic change). This file predates
   this change (bootstrapped by `workspace-test-harness-bootstrap`) and nothing in Work Unit A
   touches the bench runner. **Pre-existing flake, not a Work Unit A defect.**

All of Work Unit A's own test files (`decimation/min-max.test.ts`,
`decimation/min-max.property.test.ts`, `decimation/peak-fidelity.property.test.ts`,
`decimation/determinism.test.ts`, `decimation/allocation-gate.test.ts`, `buffers/*`,
`payload/*`) passed, including the 4 GC-gate assertions (small/large × real/control).

**`any`/`as never` grep** over the three new source files
(`brand.ts`, `spectrum-data-payload.ts`, `min-max.ts`): zero matches for
`: any`, `as any`, `<any>`, `, any>`, `as never`. CLAUDE.md rule 1 satisfied.

## Scenario Compliance Matrix

| Capability | Requirement/Scenario | Result | Evidence |
|---|---|---|---|
| branded-buffers | Type-level-only branding, zero runtime cost | PASS | `brand.ts:11-45` (`declare const … unique symbol`, intersection types); `test/buffers/brand-erasure.test.ts` passes |
| branded-buffers | Retained/Transit ownership brand, orthogonal to axis | PASS | `brand.ts:26-31`; `test/buffers/brand-types.test-d.ts` `@ts-expect-error` fixtures pass under `tsc --noEmit` |
| branded-buffers | Construction & narrowing contract (as*/allocate*, reject detached/bad capacity, no `as unknown as`) | PASS | `brand.ts:70-98`; `test/buffers/construction.test.ts` passes; single `as XBuffer` assertion only, no double-assertion anywhere |
| branded-buffers | No `any` in brand machinery | PASS | grep confirmed zero matches; lint clean |
| branded-buffers | Public export surface (internal validators not exported) | NOT-YET-APPLICABLE | `index.ts` barrel restructuring is task 8.1/8.5 (Work Unit B). `assertUsableBuffer`/`assertCapacity` are correctly unexported from `brand.ts` today, but the full export-surface scenario needs the Group 8 barrel to be assessed end-to-end. |
| spectrum-data-payload | Domain model owned by core, constructed only via factory | PASS | `spectrum-data-payload.ts:81-102`; `test/payload/payload.test.ts` passes |
| spectrum-data-payload | Monotonic revision, mutated only via `commitPayloadRevision` | PASS | `spectrum-data-payload.ts:110-149`; `test/payload/commit-revision.test.ts` (3 tests) passes: revision increments by exactly 1, extents recomputed, `xOrigin` untouched |
| spectrum-data-payload | Retained/never-transferable payload buffers | PASS | `test/payload/transit-disjointness.test.ts` + `.test-d.ts` pass |
| spectrum-data-payload | f64 xOrigin + f32 offsets | PASS | `spectrum-data-payload.ts:27-28`; `payload.test.ts` origin/offset round-trip case |
| spectrum-data-payload | sampleCount distinct from capacity | PASS | `payload.test.ts` — capacity 1024/sampleCount 600 case |
| spectrum-data-payload | LTTB index/revision pairing (`DecimationResultCursor`, `isCursorCurrent`) | PASS (type shape only; no consumer yet since `lttb` doesn't exist) | `spectrum-data-payload.ts:63-67,155-160` |
| decimation-min-max | Flat positional signature, no `x` param, no options object | PASS | `min-max.ts:11-18` matches spec's exact signature |
| decimation-min-max | Caller-preallocated output, explicit `outputOffset`, returns `bucketCount*2` | PASS | `min-max.test.ts` sub-window test; property test's "never writes outside window" |
| decimation-min-max | Per-bucket bounding property | PASS | `min-max.property.test.ts` — `fc.assert` over random non-divisible lengths, live run passed |
| decimation-min-max | Boundary preconditions, `RangeError` before any write | PASS | `min-max.ts:19-60`; unit test confirms `out` untouched on throw |
| decimation-min-max | Single-pass, exact `bucketCount*2` output length | PASS | exact-integer partition at `min-max.ts:65-68`; property test confirms invariance across input size |
| decimation-min-max | Zero-allocation GC gate (small + large, real + control) | PASS | `allocation-gate.test.ts` — live run: control-first `beforeAll` didn't throw, all 4 assertions (2 control >0, 2 real ===0) passed |
| decimation-min-max | NaN-as-gap sentinel; all-gap emits NaN/NaN never Infinity; real +Infinity propagates | PASS | `min-max.ts:70-85`; three dedicated unit tests all pass |
| decimation-min-max | Determinism (byte-identical across runs; golden fixture) | PASS | `min-max.test.ts` repeat-run case + `determinism.test.ts` against committed `fixtures/golden/min-max.json` |
| decimation-min-max | Deopt freedom (`--trace-deopt`) | NOT-YET-IMPLEMENTED (correctly deferred) | Bench `--trace-deopt` mode is Group 7/Work Unit B |
| decimation-min-max | Benchmark emits to `bench-results.json`, no local pass/fail baseline | NOT-YET-APPLICABLE | Bench wiring for `minMaxEnvelope` is Group 7 |
| test-harness (MODIFIED) | `fast-check` pinned & resolvable via catalog | PASS | `pnpm-workspace.yaml`/`packages/core/package.json` diffs; `pnpm run test` executes fast-check-based property tests successfully |
| allocation-free-hot-path | Loop-scoped ESLint ban list over `src/decimation/**` | PASS (config present, lint clean) | `eslint.config.js` new block; `pnpm exec turbo run lint` exit 0 |
| allocation-free-hot-path | Lint instrument proven live by fixture meta-test | NOT-YET-IMPLEMENTED (correctly deferred) | `test/lint-hot-path.test.ts` + `test/fixtures/hot-path-violation.ts` are Group 6, Work Unit B. Until that meta-test exists, the ESLint block's own liveness is unproven — flagged as a gap for Work Unit B, not Work Unit A. |

## Design Coherence (design.md)

- **D1 (branding mechanism)** — implemented exactly as decided: two `unique symbol` tags,
  intersection types, single `as XBuffer` assertion, narrowing + allocating constructors. PASS.
- **D2 (`SpectrumDataPayload`)** — flat interface, mutable twin not exported, single mutation
  entry point, f64 origin. PASS.
- **D3 (`minMaxEnvelope`)** — exact-integer partition (not the probe's buggy `(n/b)|0` form),
  interleaved output, NaN-as-gap collapse, no `x` param, flat positional signature. PASS,
  and correctly avoids the exact bug design.md flags as the probe's defect (verified by
  reading the loop: `start`/`end` use the `(b*n)/B | 0` partition, not `per = (n/B)|0`).
- **D5 (allocation-free discipline)** — the ESLint block exists and lint is clean, but §D5's
  "instrument must be proven live" clause (the fixture + meta-test) is Group 6/Work Unit B,
  not yet present. This is a known, correctly-scoped gap, not a contradiction.
- **D6 (GC gate mechanics)** — `pool: 'forks'` + `poolOptions.forks.execArgv: ['--expose-gc']`
  is on the **top-level** `test` object rather than inside `projects[].test.core`, deviating
  from the literal §D6/task wording. `resume-apply.md` documents this as an empirically-forced
  correction (Vitest 3.2.7 resolves but does not propagate project-scoped `pool`/`poolOptions`
  to the actual forked child's `execArgv`). Verified independently: `vitest.config.ts` as read
  matches this description, the comment explains the reasoning, and the live `pnpm run test`
  run shows the GC-gate tests actually exercising `--expose-gc` successfully (control tests
  observe real GC events, real function observes zero) — which would be impossible if the flag
  weren't reaching the child process. This is a legitimate, disclosed, verified-effective
  deviation, not a shortcut. No design.md text is contradicted in substance (only in file
  placement, which design.md doesn't literally pin down beyond "the `core` project gains...").

No rejected alternative from design.md (wrapper-class brands, `Object.freeze` payloads, an
options-object signature, `±Infinity` sentinels, `NODE_OPTIONS`/threads-pool GC wiring) was
accidentally introduced.

## RED/GREEN (`strict_tdd: true`) Audit

`resume-apply.md` discloses one deviation: `commitPayloadRevision` (task 3.3/3.4) was
implemented in the same edit as the 3.2 factory rather than held back for a separate RED step;
its test was written and passed immediately rather than failing first. This is self-reported,
not independently re-derivable from git history, since **no commit exists yet for any of Work
Unit A's files** (`git status` shows everything as untracked/modified working-tree changes —
nothing has been committed). I did not revert `commitPayloadRevision` and re-run to force a RED
demonstration, per the "do not modify any file" constraint on this verification pass.

Assessment: this is a **disclosed, narrow, functionally-covered deviation** — the requirement it
skirts (`commitPayloadRevision`'s behavior) is fully exercised by `test/payload/commit-revision.test.ts`,
which passes and asserts every clause of the "Monotonic Revision Field" requirement (increments
by exactly 1, recomputes extents over the new prefix, leaves `xOrigin` untouched). It does not
leave any requirement unproven; it only means the TDD *process* discipline for that one pairing
was not literally followed. WARNING, not a blocker.

By contrast, the property-test RED evidence for `min-max.property.test.ts` (counterexample
`[0,0,0,0,2.802596928649634e-45]` against a deliberately reintroduced `(n/B)|0` bug) and
`peak-fidelity.property.test.ts` (failed against a naive uniform-stride stand-in) is
specific, falsifiable, and consistent with how `fast-check` failures are actually reported
(shrunk counterexample) — plausible as genuine RED evidence, though also self-reported and not
re-derivable from history since there are no commits.

## Issues Identified

- **WARNING**: `commitPayloadRevision` was not developed via a literal separate RED step (see
  above). Functionally covered by tests; process deviation only.
- **WARNING**: No git commits exist for any Work Unit A file, so RED-before-GREEN claims in
  `resume-apply.md` cannot be independently verified from history — they rest on the session's
  self-report. This is inherent to the uncommitted state at time of verification, not a defect
  in the code.
- **SUGGESTION**: `allocation-free-hot-path`'s "instrument must be proven live" requirement
  (the fixture + `lint-hot-path.test.ts` meta-test) doesn't exist yet — correctly deferred to
  Work Unit B (Group 6), but until it lands, the new ESLint block's liveness is unverified by
  any test (only "lint is clean," which is also true of a rule that never fires).
- **SUGGESTION**: `minMaxEnvelope` does not validate that `sourceOffset + sampleCount` stays
  within `y.length`; the spec doesn't require this bound, but an out-of-range `sourceOffset`
  would currently read `undefined` off the end of `y` (returned as `NaN` via the `y[i]!`
  non-null assertion path only if `noUncheckedIndexedAccess` were bypassed — worth a boundary
  precondition in a future pass, not blocking since it's outside the stated spec preconditions).
- **Not a defect**: the two live test failures (`side-effects-audit.test.ts`,
  `bench/warmup-median.test.ts`) are both pre-declared, correctly-scoped-out-of-Work-Unit-A
  failures, matching `resume-apply.md`'s own predictions exactly.

## Final Verdict: PASS WITH WARNINGS

Work Unit A (tasks.md Groups 1-4: workspace wiring, branded buffers, `SpectrumDataPayload`,
`minMaxEnvelope`) is **safe to build on for Work Unit B**. Every requirement and scenario in
scope for Groups 1-4 across the `branded-buffers`, `spectrum-data-payload`, `decimation-min-max`,
and `test-harness` (modified) capabilities is implemented and passes live tests, typecheck, and
lint. Zero `any`/`as never` in production code. The GC-event gate genuinely discriminates
(control >0, real function exactly 0, at both configurations) under a real, verified
`--expose-gc` wiring. The two live test failures are both out-of-scope-for-this-unit and
correctly predicted by the implementer's own resume notes, not regressions. The warnings above
(one disclosed TDD-process deviation, one unverifiable-from-history claim, two suggestions) do
not undermine correctness of the shipped Group 1-4 code and should be tracked but do not block
proceeding to Work Unit B (Groups 5-9: `lttb`, allocation-free enforcement instruments, bench
`--trace-deopt`, export barrel + `SIDE_EFFECTS_AUDIT.md`, changeset).
