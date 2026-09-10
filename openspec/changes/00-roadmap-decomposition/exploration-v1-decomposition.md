# Exploration: 8-Sprint Roadmap → SDD Change Decomposition

Status: exploration only. No proposal/spec/design/tasks created. No production code written.

## 0. Repository reality check (verified)

- Only `packages/core/{package.json,tsconfig.json,src/index.ts}` exist (plus a stray `dist/` and `node_modules/.bin` from a prior manual run). No `apps/`, no `packages/renderers`, no `packages/vue`, no `packages/react`.
- No test harness anywhere (no vitest config, no test files) despite `openspec/config.yaml` declaring `strict_tdd: true`.
- No bundler config (no tsup), no lint config, no CI workflow found under `.github/` at exploration time.
- `pnpm-workspace.yaml` globs `packages/*` + `apps/*` with a catalog for `@types/node`, `typescript`, `vitest`.
- Root `package.json` is `private: true`, v0.0.0 — consistent with a workspace root that must never be the publish unit.

This means **change 1 is not optional scaffolding** — it is the load-bearing foundation the brief's own `strict_tdd: true` depends on. Nothing downstream can TDD against a core that doesn't build or test.

## 1. Change inventory

Twelve changes, not eight. Sprints get split where they bundle unrelated capabilities (S1, S5, S8) and one new change is inserted that the brief never named (the framework-agnostic engine controller — see §2 and §3.2).

| # | Change name | Capabilities | Hard prerequisites | Deliberately deferred |
|---|---|---|---|---|
| 1 | `workspace-toolchain-bootstrap` | pnpm+turbo wiring, tsup per-package build, tsconfig.base, vitest harness + first passing isomorphic test, changesets config | none | docs app, playground app, any domain code |
| 2 | `core-domain-model` | `@trace-kit/core` branded buffers (`WavelengthBuffer`, `PowerDbmBuffer`), `SpectrumDataPayload` type, LTTB, Min-Max Envelope, deterministic allocation-counting test harness | 1 | worker transport, renderers, docs content |
| 3 | `core-worker-bridge` | `WorkerBridge` zero-copy transfer wrapper, sync fallback for Node/SSR | 2 | UI-facing sandbox |
| 4 | `docs-playground-shell` | `apps/docs` (VitePress) skeleton + `apps/playground` (Vite) skeleton, framework switch UI shell (no live renderer yet), Getting Started + Mathematical Foundations pages | 1, 2 | live canvas/webgl demos (those land per-renderer-change as docs pages are added incrementally) |
| 5 | `renderer-canvas2d` | `@trace-kit/renderers` package created; `FigureRenderer` contract (owns interface, but see §3.7 for type placement); `Canvas2DRenderer`; `/canvas2d-bench` sandbox; Canvas2D docs page | 2, 4 | WebGL2, engine switching |
| 6 | `renderer-webgl2` | `WebGL2Renderer`, dual-VBO, GLSL3 shaders, context-loss recovery, `/webgl-bench` sandbox, WebGL2 docs page | 5 | automatic engine switching (needs both engines to exist first, done in 7) |
| 7 | `engine-controller` (NEW — not in brief) | Framework-agnostic `SpectrumEngineController`: hysteresis-stabilized auto Canvas2D/WebGL2 switching, lifecycle (init/resize/destroy) state machine, shared by Vue and React wrappers | 5, 6 | Vue/React bindings themselves |
| 8 | `vue-adapter` | `@trace-kit/vue`: `useSpectrumEngine` composable, `<TraceSpectrumViewer/>`, shallowRef/markRaw isolation, ResizeObserver+rAF lifecycle, d3-scale axis/overlay layer, `/vue-showcase` sandbox, Vue docs tab | 7 | React parity (parallel-eligible, see §2) |
| 9 | `react-adapter-and-exports` | `@trace-kit/react`: `useSpectrumEngine` hook, `<SpectrumViewer/>`, per-package subpath exports/publishing model (§3.3), tree-shaking test, Next.js SSR smoke test, `/react-showcase` sandbox, React docs tab | 7 | Vue parity (parallel-eligible) |
| 10 | `crosshair-sync-and-svg-export` | `CrosshairSyncBus` (EventTarget/BroadcastChannel), SVG vector exporter in core (`exportToSvg`), `/multi-chart-sync` sandbox, docs page | 8, 9 | WaferDieMap |
| 11 | `wafer-die-map` | `WaferMapBuffer`, instanced WebGL2 rendering, LUT-based color scale (d3-interpolate), O(1) analytic hit-testing, Vue+React `<WaferDieMap/>` parity, `/wafer-map` sandbox, docs page | 6, 8, 9 | benchmarking/CI |
| 12 | `benchmark-ci-and-deployment` | `/stress-test-lab`, deterministic performance-regression CI (not `performance.memory` wall-clock), Playwright visual regression, StackBlitz templates, Vercel/Pages deployment | 10, 11 | — (terminal change) |

Renumbering note: change 4 (`docs-playground-shell`) is scaffolding-only and has no capability overlap with 2/3, so it can run in parallel with 2–3 once 1 lands; I sequenced it right after 1 in the table only for readability, not as a strict blocking dependency — see graph.

## 2. Dependency graph

```
                              ┌─────────────────────────────┐
                              │ 1. workspace-toolchain-      │
                              │    bootstrap                 │
                              └───────────┬──────────────────┘
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    │
        ┌─────────────────────┐  ┌─────────────────────┐       │
        │ 2. core-domain-model │  │ 4. docs-playground- │◄──────┘ (shell only,
        └──────────┬───────────┘  │    shell             │          no domain dep)
                    ▼              └──────────┬───────────┘
        ┌─────────────────────┐               │
        │ 3. core-worker-bridge│               │
        └──────────┬───────────┘               │
                    └───────────────┬───────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ 5. renderer-canvas2d      │
                        └────────────┬─────────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │ 6. renderer-webgl2        │
                        └────────────┬─────────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │ 7. engine-controller (NEW)│
                        └────────────┬─────────────┘
                     ┌───────────────┴───────────────┐
                     ▼                                ▼
        ┌─────────────────────┐          ┌─────────────────────────┐
        │ 8. vue-adapter        │          │ 9. react-adapter-and-    │
        │   (parallelizable)    │          │    exports                │
        │                       │          │   (parallelizable)        │
        └───────────┬───────────┘          └─────────────┬─────────────┘
                     └───────────────┬────────────────────┘
                                     ▼
                     ┌─────────────────────────────────┐
                     │ 10. crosshair-sync-and-svg-export │
                     └────────────────┬───────────────────┘
                                     │        ┌──────────────────────┐
                                     │        │ 11. wafer-die-map      │
                                     │        │  (needs 6, 8, 9 too)   │
                                     │        └───────────┬────────────┘
                                     └──────────────┬───────┘
                                                    ▼
                                  ┌───────────────────────────────┐
                                  │ 12. benchmark-ci-and-deployment │
                                  └───────────────────────────────┘
```

**Cycle proof**: every edge points strictly forward through the numbering 1→12 with no back-edge; the graph is a DAG by construction (topological order = change number order). The only place a naive reading of the brief could introduce a cycle is if `engine-controller` were folded into both the Vue change and the React change independently — that would create two divergent copies of the same hysteresis/threshold logic, which is not a graph cycle but a **duplication hazard** that the "parallel" framing invites. Extracting it as change 7 removes the hazard and keeps 8/9 genuinely independent of each other.

**Real parallelism vs apparent parallelism**:
- 8 (`vue-adapter`) and 9 (`react-adapter-and-exports`) are genuinely parallelizable **once 7 exists**. They touch disjoint packages (`packages/vue` vs `packages/react`) and disjoint docs tabs.
- 4 (`docs-playground-shell`) can run in parallel with 2/3 (no shared files), but its *content* pages for each renderer/adapter are added incrementally in changes 5, 6, 8, 9, 11 — so treat 4 as "shell + generic content" only, not "all docs."
- The brief's claim that S4 (Vue) and S5 (React) are parallel is **only true after the shared contract surface is extracted**. As literally written, the brief has both sprints independently implementing `useSpectrumEngine`-shaped lifecycle logic and the 80k-point auto-switch threshold, which is the classic "looks parallel, shares a contract" trap: two teams would independently invent hysteresis bands, and whichever lands second either duplicates or silently redefines the threshold behavior. Change 7 is the fix.

## 3. Incongruences to resolve

### 3.1 Package scope: `@optic-vis/*` → `@trace-kit/*`
Brief scope is a leftover from a template. Repo identity, CLAUDE.md, and Turborepo/pnpm naming are already `@trace-kit/*`. **Resolution: normalize everything to `@trace-kit/*`.** No tradeoff here — this is not a design decision, it's a correction of a stale brief. Every subpath in later sections uses `@trace-kit/core`, `@trace-kit/renderers`, `@trace-kit/vue`, `@trace-kit/react`.

### 3.2 Component naming: `<OpticSpectrumViewer/>` vs `TraceSpectrumViewer`
CLAUDE.md is the authoritative, checked-in architecture doc for this repo and already names `TraceSpectrumViewer` explicitly for the Vue package. **Resolution: `<TraceSpectrumViewer/>` for Vue.** For React, the brief's own S5 text says `<SpectrumViewer/>` — I recommend keeping the React name as `<TraceSpectrumViewer/>` too (not `<SpectrumViewer/>`), for cross-framework naming parity, since S7 explicitly requires prop/event parity between the Vue and React `<WaferDieMap/>` — the same parity principle should apply to the main viewer component. This is a call for `sdd-propose`/`sdd-design` to confirm, not a blocking question (low ambiguity, easy to rename later, no architectural cost either way).

### 3.3 Root package.json `exports` for subpath publishing — WRONG as specified
The brief's S5 snippet puts `exports["./vue"]`, `exports["./react"]`, etc. in the **root** `package.json`, pointing into `packages/*/dist`. This is incorrect for two independent reasons:
1. The root `package.json` is `private: true` — it is never published, so `exports` there is dead configuration; npm/pnpm only reads `exports` from a package that is actually installed by consumers.
2. A pnpm workspace with independently versioned packages (`@trace-kit/core`, `@trace-kit/renderers`, `@trace-kit/vue`, `@trace-kit/react`) is the correct model **only if each package is independently installable** — which the brief's own tree-shaking requirement (AC-S5-02: importing `{ lttb }` must not pull in React/Vue/Canvas2D/WebGL) demands. A single umbrella package with subpath exports covering framework-specific code would force `@trace-kit/react`'s peer deps into every consumer's dependency graph unless meticulously marked side-effect-free per subpath — fragile and works against CLAUDE.md rule 5 (isomorphic pure core).

**Resolution: keep four independently published packages** (`@trace-kit/core`, `@trace-kit/renderers`, `@trace-kit/vue`, `@trace-kit/react`), each with its own `package.json`, own `exports` map (`.` and any internal subpaths it needs), own version via Changesets. No umbrella package, no root `exports`. This is not a new decision — it's what CLAUDE.md's package layout and rule 8 (Changesets, independent packages) already implies; the brief's snippet just modeled it wrong. `renderer-canvas2d`/`renderer-webgl2` becomes a single `@trace-kit/renderers` package (per CLAUDE.md's explicit statement that the renderers package holds both engines) with named exports `Canvas2DRenderer` / `WebGL2Renderer`, not two packages.

### 3.4 `performance.memory` cannot prove zero-allocation
Confirmed: `performance.memory` is Chromium-only, non-standard (removed from the spec, exposed only via a flag/heuristic), reports **quantized** heap snapshots (browsers deliberately reduce precision to prevent side-channel fingerprinting), and is not correlated frame-to-frame with intermediate object churn — GC can coalesce or defer collection, making a "0 KB/frame" read meaningless as proof of zero allocation. Using it for AC-S3-02/AC-S4-01/AC-S8 telemetry as *informational* dashboards is fine; using it as a **pass/fail gate for zero-GC** is not defensible.

**Resolution — verification strategy per change**:
- `core-domain-model` (change 2) and `renderer-webgl2` (change 6): introduce a **deterministic allocation-counting harness** — in Node/Vitest, monkey-patch/wrap the hot-path functions (`lttb`, `minMaxEnvelope`, `render()`) to run under `node --expose-gc`, force a GC before and after N iterations, and assert `process.memoryUsage().heapUsed` delta is within a small fixed epsilon (not raw `performance.memory`). This is deterministic, CI-safe, cross-platform, and directly falsifiable.
- For browser-only render loops (`WebGL2Renderer.render()`, Vue/React mount-loop heap): use a headless Chrome + CDP `HeapProfiler.startSampling`/`Runtime.getHeapUsage` (e.g. via Playwright's CDP session) instead of `performance.memory` — CDP gives per-call heap deltas at test time, not a quantized live-page read, and can run in CI.
- Reserve `performance.memory` strictly for the dev-only sandbox telemetry HUD (already how S8's "stress-test-lab" wants it) — never as a CI assertion.

This becomes an explicit AC-rewrite obligation for changes 2, 6, 8, 9, 12 during `sdd-spec`.

### 3.5 Wall-clock FPS/ms ACs will make CI flaky
`<8 ms`, `<3 ms`, `>=60 FPS` are hardware-dependent; GitHub Actions runners have unpredictable CPU steal and no GPU (WebGL tests there typically run under SwiftShader/software rendering, which is an order of magnitude slower and non-representative).

**Resolution**:
- Split each performance AC into two: (a) a **relative regression budget** — record a baseline measurement on the runner itself at CI setup time (self-calibrating, not a fixed ms number) and fail only if a run regresses >X% against that baseline; (b) a **work-counting assertion** that is deterministic and hardware-independent (e.g. assert exactly 1 `drawArrays` call and 0 `bufferData` calls per `render()` invocation during pan/zoom, assert `setData()` is called exactly once per frame budget, assert buffer upload count stays constant regardless of point count for VBO-based paths).
- Treat the literal ms/FPS numbers (`<8ms`, `<3ms`, `60 FPS`, `<0.5ms` hit-test) as **local/dev informational benchmarks** surfaced in the playground's stress-test-lab and recorded to the JSON export in change 12, not as CI-blocking gates.
- This reframing must land in `sdd-spec` for changes 5, 6, 7, 11, 12 — every AC referencing raw ms/FPS gets rewritten as (regression-budget OR work-count) + informational-benchmark.

### 3.6 VitePress SSR + embedded live Vue/React demos — feasibility
VitePress SSR is Vue 3-based (its theme and page components render through Vue's SSR pipeline at build time, then hydrate client-side). Mounting a **live React island** inside a VitePress page is non-trivial but has a well-known working pattern: it is not "VitePress renders React," it is "VitePress renders a client-only Vue wrapper component that, on `mounted()`/client hydration, dynamically imports React + ReactDOM and calls `createRoot(...).render(<SpectrumViewer/>)` into a DOM node VitePress leaves untouched." This is the same mechanism VitePress's own docs recommend for any non-Vue embed (`<ClientOnly>` + manual mount), and it sidesteps SSR entirely for the React demo (React never runs server-side inside VitePress; it mounts client-side only, after hydration).

**Resolution: keep VitePress**, but scope the React demo integration as: (1) a generic `<ClientOnly>`-wrapped "framework sandbox" custom container component that lazy-mounts either the Vue component tree (natively) or a React root (via dynamic import + `createRoot`), selected by the existing framework-switch state; (2) explicitly document that this is *not* React SSR — it's client-only React mounted inside a Vue-SSR shell, which is consistent with AC-S5-03 (Next.js SSR compatibility is validated separately, in its own Next.js smoke-test app, not inside VitePress). This must be pinned down in `docs-playground-shell` (change 4)'s design, and is exercised for real starting with `renderer-canvas2d` (5)'s first live embed.

### 3.7 `SpectrumDataPayload` — undefined type, placement decision
The brief's `FigureRenderer` interface (S2) references `SpectrumDataPayload` but never defines it, and CLAUDE.md is explicit that `packages/renderers` must not own the domain model (only rendering). **Resolution: `SpectrumDataPayload` is defined in `@trace-kit/core`**, alongside the branded buffers it wraps (`{ x: WavelengthBuffer; y: PowerDbmBuffer; length: number }` shape, exact fields to be pinned in `sdd-spec`). `packages/renderers` imports the type from core and only consumes it structurally inside `FigureRenderer.setData()`; it never constructs or mutates payloads, matching AC-S2-02's own requirement that `render()`/`setTransform()` never touch raw arrays outside what `setData()` indexed. This lands in change 2 (`core-domain-model`), consumed starting in change 5.

### 3.8 D3 dependencies in isomorphic core
The brief puts `d3-shape`, `d3-scale`, `d3-interpolate` into `@trace-kit/core` for SVG export (AC-S6-02) and the wafer color LUT (S7). This conflicts with two things: CLAUDE.md rule 5 (pure isomorphic core, and by extension AC-S5-02's tree-shaking guarantee that importing `{ lttb }` alone must not drag in unrelated dependencies), and general tree-shaking hygiene — d3 submodules are individually small, but bundling *any* extra runtime dependency into the same package as the hot-path math functions increases the risk of accidental cross-imports and complicates the "core has zero non-dev dependencies" invariant that keeps `@trace-kit/core` trivially embeddable in Workers/Node/SSR.

**Resolution: none of the three d3-* packages belong in `@trace-kit/core`.**
- `d3-shape` (SVG path generation) belongs with the SVG exporter. Since `exportToSvg` is explicitly framework-agnostic and used from the crosshair-sync change, keep it in `@trace-kit/core` **only if** we're strict that "isomorphic" does not mean "zero dependencies," just "zero DOM globals" — d3-shape has no DOM dependency, it is pure math/string generation, so it does not violate CLAUDE.md rule 5 literally. However, to protect tree-shaking (AC-S5-02 explicitly tests that `{ lttb }` alone doesn't pull unrelated code), the exporter should live in its own **subpath entry point** within core (e.g. `@trace-kit/core/export`, a separate `exports` map entry backed by a separate bundle output), not the package's main index — so a consumer importing only `{ lttb, minMaxEnvelope }` from `@trace-kit/core`'s root never bundles d3-shape even though it lives in the same package. This is a build-config decision (tsup multi-entry + `exports` map), not a new package.
- `d3-scale` (axis/tick projection) is Vue/React-overlay-specific (HTML/SVG axis layer inside the viewer components) — it belongs in `packages/vue` and `packages/react` respectively (or a small shared non-framework "axis" module if duplication becomes real), not in core at all.
- `d3-interpolate` (color LUT for the wafer heat map) is renderer-specific (feeds a WebGL texture) — it belongs in `packages/renderers`, scoped to the wafer module, not core.

This resolution must be pinned exactly in `sdd-design` for change 2 (core subpath/export map) and change 11 (wafer LUT dependency placement).

### 3.9 Hysteresis for the 80k-point auto-switch — undefined, must be pinned
CLAUDE.md rule 3 mandates the engine switch be "automatic and hysteresis-stabilized to avoid rapid oscillation at thresholds," but the brief only names a bare threshold (80k points) with no band. Without hysteresis, a dataset hovering near 80k during a live stream (S4's 60 Hz WebSocket scenario, or S7's zoom/pan on a wafer near the boundary) would thrash between Canvas2D and WebGL2 every time point count crosses the line in either direction, causing exactly the "flicker" AC-S4-03 explicitly forbids.

**Resolution: this is owned by change 7 (`engine-controller`)**, not by Vue or React individually — reinforcing why that change must exist as its own unit. The concrete hysteresis band (e.g. switch to WebGL2 above 80k, switch back to Canvas2D only below 60k, i.e. a 20k dead zone) is a `sdd-design` decision for change 7, not something to leave implicit in `sdd-tasks`.

## 4. Risks (ranked)

| Severity | Risk | Owning change |
|---|---|---|
| High | No test harness exists yet while `strict_tdd: true` is enforced; if change 1 under-scopes the harness (e.g. only unit tests, no Node-isomorphism check wired into CI), every downstream TDD cycle inherits a false sense of coverage | 1 |
| High | Duplicated engine-switch/threshold logic if change 7 is skipped or merged into 8/9 instead of extracted — silent divergence between Vue and React behavior, directly violating AC-S7-03-style parity expectations generalized to the main viewer | 7 |
| High | `performance.memory`-based ACs shipped as literal CI gates produce flaky/unfalsifiable CI from day one of any renderer change | 5, 6, 8, 9, 12 |
| Medium | WebGL context-loss recovery (S3) is easy to under-test — losing a context is only reliably reproducible via the `WEBGL_lose_context` extension in a real browser, not jsdom; if change 6's test strategy relies on jsdom mocks only, the recovery path ships unverified | 6 |
| Medium | Cross-framework docs embedding (VitePress + client-only React island) is a nonstandard pattern; if under-designed, `apps/docs` build breaks or hydration mismatches appear only in production builds, not dev | 4 |
| Medium | d3-* dependency placement (§3.8) is easy to get wrong under time pressure by "just importing d3-scale in core because it's convenient" — silently reintroducing the tree-shaking violation AC-S5-02 exists to catch | 2, 8, 9, 11 |
| Low | WaferDieMap hit-testing (S7) analytic inverse-transform math is easy to get subtly wrong at oblique zoom/pan states; needs property-based or golden-coordinate tests, not just visual inspection | 11 |
| Low | StackBlitz/WebContainer templates (S8) can silently rot if dependency versions drift after publishing; needs a CI check that the templates actually resolve, not just that they exist | 12 |

## 5. Open product decisions (blocking, for the orchestrator to confirm before first `sdd-propose`)

1. **Component naming parity** (§3.2): confirm `<TraceSpectrumViewer/>` for both Vue and React (recommended), vs. keeping the brief's asymmetric `<TraceSpectrumViewer/>` (Vue) / `<SpectrumViewer/>` (React) naming. Low risk either way — recommend confirming now so change 8/9 tasks don't need renaming later.
2. **Change granularity acceptance**: confirm the 12-change decomposition (vs. the brief's 8-sprint framing), specifically the insertion of change 7 (`engine-controller`) as a new, previously-unplanned unit. This is the one structural decision that changes the brief's stated dependency order (S4/S5 are no longer purely parallel-from-S3; they both gain a new prerequisite).
3. **CI performance gate model** (§3.5): confirm the regression-budget + work-counting approach replaces literal ms/FPS thresholds as CI-blocking criteria, with raw benchmarks demoted to informational artifacts. This changes what "AC-S2-01 passes" means operationally, so it should be confirmed before `sdd-spec` writes the rewritten acceptance criteria.

No other decisions are blocking — package-scope normalization (3.1), publishing model (3.3), `SpectrumDataPayload` placement (3.7), d3 placement (3.8), and hysteresis ownership (3.9) are technical corrections with a clear single correct answer under CLAUDE.md's existing rules, not product tradeoffs, and can proceed directly into `sdd-design` for the relevant change without a pre-proposal question.
