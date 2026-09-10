# Proposal: playground-shell

> Change 4 of the 16-change decomposition in
> `openspec/changes/00-roadmap-decomposition/exploration.md` (§2 inventory, §3 graph).
> Hard prerequisites: **change 1 — `workspace-test-harness-bootstrap`** and
> **change 2 — `core-decimation-math`**.
>
> Explicitly **not** dependent on change 3 (`core-transport-contract`). Exploration §3 records
> this: "4 has no dependency on 3 and can run alongside 2/3 once 1 lands." The two may proceed in
> parallel.

## Problem / Motivation

`pnpm-workspace.yaml` already globs `apps/*`, but **there is no `apps/` directory in the
repository**. The only source file in the whole monorepo is `packages/core/src/index.ts`, which
exports a `VERSION` constant. There is nowhere to look at anything.

That matters more here than it would in an ordinary library, for two reasons.

**First, the decimation algorithms from change 2 are only provable numerically, and numeric
proof is not sufficient.** Change 2 ships `fast-check` properties, a determinism test, a
randomised peak-fidelity test and a GC-event gate — all of which are the right gates, and none
of which lets a human look at a Lorentzian resonance peak and confirm it survived decimation
with its lineshape intact. CLAUDE.md rule 6 requires that decimation *mathematically* preserve
critical resonance peaks, optical dips and noise-floor baselines. A visual sandbox is how that
requirement stays honest as the algorithms evolve, and it is how LTTB and Min-Max get compared
against each other on the same signal rather than each against its own fixture.

**Second, this is the change that carries the "sandbox first" intent of the input brief.** Per
confirmed decision 1, the brief's "Sandbox & Docs First" framing is honoured for the sandbox and
deliberately reordered for the portal: `apps/playground` lands here at change 4 and **every
subsequent change adds its own view to it**. Changes 5, 7, 10, 11, 13, 14 and 16 each contribute
a view (`/canvas2d-bench`, `/webgl-bench`, `/vue-showcase`, `/react-showcase`,
`/multi-chart-sync`, `/wafer-map`, `/stress-test-lab`). That only works if the routing and the
instrumentation panel are modular from the first commit, which is what this change is for. If
the shell is built ad hoc around a single view, seven later changes each pay for the mistake.

**Correction to the input brief, stated explicitly rather than transcribed.** The brief puts
VitePress in sprint 1 and demands a green VitePress SSG build as a sprint-1 criterion. Per
confirmed decision 1 and exploration §5, **the VitePress docs portal is NOT in this change — it
is change 15 (`docs-portal`)**. The reasoning is recorded: documenting a public API before the
adapters exist guarantees rework, and the brief's own sprint-1 criterion would require a green
SSG build before a single documentable component exists — pure toolchain risk on the critical
path. Interim documentation is the README plus this live playground. The sandbox-first intent is
preserved in full; only the portal moves.

## Proposed Approach

Create `apps/playground` as a Vite + TypeScript application, structured for accretion, with
exactly one view.

1. **`apps/playground` — Vite + TypeScript.** A workspace package consuming `@trace-kit/core`
   via the workspace protocol so playground changes exercise the real built artifact, not a
   copy. It extends the completed `tsconfig.base.json` from change 1 and inherits its lint and
   typecheck tasks. No `any` (CLAUDE.md rule 1) — the playground is held to the same type
   discipline as the packages, because it is the first real consumer of the core's branded buffer
   types and a place where a type escape hatch would hide a genuine API defect.

2. **Modular routing.** A route registry where a view declares its path, its label and its
   mount/unmount pair, and the shell discovers it. Adding `/canvas2d-bench` in change 5 must be
   an additive registration, not an edit to a switch statement. Views mount and unmount cleanly,
   with teardown as part of the contract from the start — later views own WebGL contexts, and
   exploration §1.11 records that leaked contexts accumulate until the ~16-context browser limit
   is hit. Establishing unmount discipline in an empty shell is far cheaper than retrofitting it.

3. **A tweakpane instrumentation panel.** A shared panel surface that each view populates with
   its own controls and readouts, rather than each view building its own. This is the seam the
   later benchmark views bind their telemetry to.

4. **The `/core-math` view.** The one view this change ships:
   - **A synthetic Lorentzian generator.** Parameterised, deterministic for a given seed and
     parameter set, writing directly into preallocated branded `Float32Array` buffers from change
     2 — no intermediate arrays.
   - **FWHM and noise-floor controls**, driven from the tweakpane panel. FWHM is the parameter
     that makes peak fidelity visible: a narrow peak is precisely what naive uniform
     sub-sampling destroys, and the control lets that be demonstrated rather than asserted.
   - **An LTTB vs Min-Max toggle**, rendering the same source signal through both algorithms from
     change 2 so their behaviour on the same peak is directly comparable.
   - **A millisecond table** reporting per-run timing for the selected algorithm.

5. **Visualisation without a TraceKit renderer.** Neither `Canvas2DRenderer` nor
   `WebGL2Renderer` exists yet — `packages/renderers` is created by change 5. This view draws
   with a minimal, throwaway plotting routine local to the playground, whose only job is to make
   the decimated series visible. It is explicitly **not** a prototype of the renderer contract
   and must not be promoted into one; change 5 replaces it with the real `Canvas2DRenderer` and
   change 5 owns the `FigureRenderer` / `ViewportTransform` contracts.

## Capabilities (Contract for `sdd-spec`)

### New Capabilities

- `playground-app`: the `apps/playground` Vite + TypeScript application shell — its workspace
  wiring, its build and typecheck tasks, and its consumption of `@trace-kit/core` via the
  workspace protocol.
- `playground-routing`: the modular route registry and the view lifecycle contract (declare,
  mount, unmount), including the additive-registration rule that later changes depend on.
- `playground-instrumentation-panel`: the shared tweakpane panel surface and the contract by
  which a view contributes controls and readouts to it.
- `playground-core-math-view`: the `/core-math` view — the synthetic Lorentzian generator with
  FWHM and noise-floor controls, the LTTB vs Min-Max toggle, and the millisecond table.

### Modified Capabilities

- `workspace-toolchain` (from change 1): extended to cover an `apps/*` member, which has
  different build output expectations than a published `packages/*` member. Notably,
  `apps/playground` is **not published** and therefore carries no `exports` map and no
  `sideEffects` audit.
- `benchmark-harness` (from change 1): the playground's millisecond table reuses the harness's
  warm-up and median-of-N discipline rather than timing a single cold call, so the numbers a
  human reads in the panel mean the same thing the CI benchmarks mean.

No capability from change 3 is referenced, consistent with the dependency graph.

## Impact on TraceKit Packages

- `apps/playground`: created. The whole of this change.
- `packages/core`: **consumed, not modified.** If the `/core-math` view cannot be built without
  changing the core's public API, that is a finding about change 2's API and is reported rather
  than patched around here.
- `packages/renderers`, `packages/vue`, `packages/react`: not created and not touched (changes 5,
  10, 11).
- `apps/docs`: **not created.** Change 15, per confirmed decision 1.
- Root: `turbo.json` and CI gain the playground's build and typecheck tasks so a broken sandbox
  fails the pipeline.

## Acceptance Criteria Model

Per confirmed decision 3, every criterion here is deterministic and hardware-independent.
Millisecond figures shown in the panel are **informational**, never gates.

**Deterministic work-count and structural assertions** — the blocking gates:

- The playground builds and typechecks under `strict` with `noUncheckedIndexedAccess`, and
  contains no `any` in any form (`: any`, `as any`, `<any>`, `Record<string, any>` /
  `, any>`, `as never` used to suppress an error) per CLAUDE.md rule 1.
- The route registry resolves exactly the registered views; registering an additional view
  requires no edit to the shell. Asserted with a test that registers a fixture view.
- Mounting and unmounting a view is balanced: after unmount, the view holds no listener, no
  animation-frame callback and no observer. Asserted by count, not by inspection.
- The Lorentzian generator is **deterministic**: identical seed and parameters produce
  byte-identical buffer contents across runs.
- The generator writes into preallocated buffers and its allocation count does not vary with
  sample count.
- Toggling between LTTB and Min-Max produces output of the contractually correct shape for each —
  an `Int32Array` of `threshold` indices for LTTB (per the change-2 correction to the brief), and
  `bucketCount * 2` values for Min-Max — with no reallocation across toggles.

**Zero allocation** — the generator and the decimation invocation path are asserted by
**GC-event count** in Node (claim **C4b**: zero `gc` entries from a `PerformanceObserver` over N
iterations, with an allocating control in the same test proving the gate is live; **C4b**
measured 0 events against 17 for the allocating control). The interactive draw loop is **not**
gated in this change — it uses a throwaway plotting routine that change 5 deletes, so gating it
would freeze code that is designed to be discarded. The render-loop zero-allocation gate belongs
to changes 5 and 7, where the browser-side form applies: **zero bytes attributed to the named
hot-path function** in a CDP `HeapProfiler` sampling profile (claim **C4d**). Never
`performance.memory` (claim **C4** — non-standard, Chromium-only, quantized at ~100 KB), never
`measureUserAgentSpecificMemory` (claim **C4c**), never a total-heap delta, and never an
absolute-magnitude assertion — **C4d** records that sampled magnitudes under-report by three
orders of magnitude and do not scale predictably with the sampling interval, so only the binary
named-function form is sound.

**Relative regression budget** — the playground's build and typecheck must stay within a
self-calibrating budget measured on the executing runner. The `/core-math` millisecond table
reuses the change-1 harness's warm-up and median-of-N discipline, so what it displays is a warm
median rather than a cold sample (claim **C4b**: a cold first invocation runs interpreted before
TurboFan tiering and can be 3–5x slower).

**Informational benchmarks (do not block CI)** — the per-algorithm millisecond readouts in the
panel, on declared reference hardware, warm, median-of-N, and explicitly not gated on shared CI
runners. The split budgets from change 2 (Min-Max under 4 ms, LTTB under 12 ms over 1e6 samples)
are what the table is read against, and they replace the brief's single undifferentiated 15 ms
figure.

## Scope & Non-Goals

Deliberately deferred, with the owning change named:

- **The VitePress docs portal (`apps/docs`)** — the framework switcher, the client-only React
  islands, the full page set: **change 15 (`docs-portal`)**, per confirmed decision 1. This is
  the one place this decomposition deliberately reorders the brief's stated "Docs First"
  framing, and it is called out here because the brief would have put it in this change.
- **`@trace-kit/renderers`, the `FigureRenderer` and `ViewportTransform` contracts, and
  `Canvas2DRenderer`**: change 5 (`renderers-canvas2d`), which also contributes the
  `/canvas2d-bench` view and replaces this change's throwaway plotting routine.
- **`WebGL2Renderer` and `/webgl-bench`**: change 7.
- **Anything from `core-transport-contract`** — `DecimationPort`, the pooled ownership protocol,
  backpressure: change 3, which this change does not depend on and does not consume.
- **Workers and streaming**: change 8. The `/core-math` view runs the algorithms synchronously on
  the main thread.
- **The Vue and React showcase views**: changes 10 and 11.
- **`/multi-chart-sync`**: change 13. **`/wafer-map`**: change 14.
- **`/stress-test-lab`** with the Fano, Fabry–Perot and Gaussian generators, p50/p95/p99 frame
  telemetry, the rigorous TTFP definition, JSON export, visual regression against a pinned
  SwiftShader rasterizer, and public deployment: **change 16
  (`benchmark-ci-and-deployment`)**. This change ships one generator (Lorentzian) and a
  millisecond table, not the stress lab.
- **StackBlitz templates and the dependency-resolution check**: change 16.
- **Any change to `openspec/config.yaml`**: out of scope; its stale values are flagged separately
  in exploration §6.

Package scope is `@trace-kit/*`. The brief's `@optic-vis/*` is a stale template leftover
(exploration §3.11).

## Delivery

Delivery strategy is **`exception-ok`**, explicitly accepted by the user: one PR for this
change, and the 400-line review budget is **not** a blocker. The shell, the routing, the panel
and the first view are one reviewable unit — a routing registry with no view to prove it, or a
view with no shell to host it, is not independently meaningful.

Versioning follows CLAUDE.md rule 8: a Changesets `patch` bump within the `0.0.x` series.
`apps/playground` is not a published package, so its changeset records the workspace change
without publishing an artifact.
