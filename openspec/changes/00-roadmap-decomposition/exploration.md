# Exploration: 8-Sprint Roadmap → SDD Change Decomposition (v2, reconciled)

Status: exploration only. No proposal / spec / design / tasks created. No production code written.

This v2 supersedes `exploration-v1-decomposition.md` (kept for audit trail). v1 produced the
first decomposition; an independent adversarial feasibility audit then invalidated several
load-bearing assumptions of the input brief. This document is the reconciled result.

Input brief: user's 8-sprint "Sandbox & Docs First" plan.
The user explicitly instructed: do not take the brief's code snippets literally; evaluate,
reason, expand, and correct incongruences or better solutions.

---

## 0. Repository reality check (verified)

- Only `packages/core/{package.json,tsconfig.json,src/index.ts}` exist. No `apps/`, no
  `packages/renderers`, no `packages/vue`, no `packages/react`.
- No test harness at all — no Vitest config, no test files — while `openspec/config.yaml`
  declares `strict_tdd: true`. Strict TDD is currently impossible by construction.
- No `tsup` config and no lint config. **Correction (verified after v2 was written):** this
  document originally claimed `tsconfig.base.json` and CI were absent. Both exist.
  `tsconfig.base.json` is present with `target: ES2022`, `module: ESNext`,
  `moduleResolution: bundler` and `strict: true`, but **without `noUncheckedIndexedAccess`**,
  which CLAUDE.md's toolchain requirement calls for. `.github/workflows/` holds `ci.yml` and
  `release.yml`.
- **CI is green by vacuity — measured, not inferred.** `ci.yml` runs `turbo run typecheck`,
  `turbo run lint` and `pnpm run test`, but `packages/core` declares only `build` and
  `typecheck` scripts. Observed locally: `turbo run lint` reports *"No tasks were executed as
  part of this run"* with `0 successful, 0 total` and exits 0; `pnpm run test` resolves to
  `turbo run test`, which executes only the `build` dependency and no test task, and exits 0.
  Turbo returns success when no task matches, so both the Lint and Unit tests steps pass
  having executed nothing. Only `typecheck` does real work.
- `packages/core` builds with `tsc`, not `tsup`, so the dual ESM/CJS output with declaration
  maps that the brief requires does not exist yet.

Consequence for change 1: it is a **correction as well as a bootstrap**. A harness that merely
adds test files without fixing the vacuous task graph would leave CI reporting success over
work it never ran — the most dangerous possible starting point for `strict_tdd: true`.
- `pnpm-workspace.yaml` globs `packages/*` + `apps/*`, with a catalog pinning
  `@types/node ^22.10.0`, `typescript ^5.7.0`, `vitest ^3.0.0`.
- `turbo.json` defines `build` / `test` / `test:unit` / `typecheck` / `lint`.
- Root `package.json` is `private: true`, v0.0.0, MIT, Changesets configured.

Consequence: the first change is not optional scaffolding. It is the load-bearing prerequisite
that `strict_tdd: true` depends on.

---

## 1. Findings that changed the decomposition

Five audit findings are architecture-determining. They are not AC tuning; they change what
gets built, in what order.

### 1.1 Zero-copy buffer ownership is undefined — the highest-risk item in the plan

`postMessage(msg, [bufferX.buffer, bufferY.buffer])` **detaches** the sender's `ArrayBuffer`.
After the call the main thread's `Float32Array` has `byteLength === 0` and every read fails.
The brief never describes how ownership returns. Traced over a 60 Hz stream:

- Frame 1: main transfers X and Y. Main can no longer re-decimate, hit-test, read a tooltip,
  export SVG, or rebuild a `Path2D`.
- Worker returns the decimated result; the originals stay in the worker or are lost.
- Frame 2: main has no source buffer left to send. Broken.

This also silently invalidates WebGL context restoration (§1.4): the CPU-side copy required to
re-upload vertex data no longer exists, so the chart stays permanently blank after a restore.

**Resolution — pooled round-trip, explicit single ownership.** Main owns a pool of N X/Y pairs
plus output buffers. Request carries all buffers in the transfer list; the worker transfers
**all of them back**. Invariant: exactly one owner at any instant. Mandatory backpressure — if
no pair is free, drop the incoming chunk and increment a telemetry counter; never allocate,
preserving CLAUDE.md rule 2. Buffers may only be re-minted on the failure path (`onerror`,
`onmessageerror`), where the worker dies holding them.

`SharedArrayBuffer` + SPSC ring buffer is a legitimate optional fast path: no detach, no
round-trip latency, and `crossOriginIsolated` restores full `performance.now()` precision
(which §1.5 needs). But it requires `COOP: same-origin` + `COEP: require-corp`, which
**GitHub Pages cannot serve** and which breaks third-party embeds without CORP — a direct
collision with the brief's own StackBlitz (AC-S8-03) and public-deployment (AC-S8-04)
criteria. It must be a runtime-detected optional capability, never the only path.

Rejected: `buffer.slice(0)` copy-on-send — 4 MB/frame at 60 Hz is 240 MB/s of garbage, a
frontal violation of CLAUDE.md rule 2.

**Also missing from the brief:** re-decimating all 1e6 points every frame is O(n) per frame.
The correct design for the brief's own 60 Hz streaming requirement is an **incremental** path —
raw-sample ring buffer plus incremental per-bucket min/max update, O(new samples).

This decision fixes the shape of `setData`, `pushStreamData`, and the decimation port
signature, and it determines deployment topology. Choosing wrong is not a local bug; it is a
breaking change across every package and every documented example. It must be de-risked with a
prototype **before any renderer exists**.

### 1.2 `LINE_STRIP` cannot carry line width — the primitive dies, the VBO layout survives

`glLineWidth` is deprecated in modern OpenGL core profiles and is **ignored** there, which
covers core profiles on Linux and macOS and ANGLE-backed paths on Windows and macOS; Firefox
aligned with Chrome on this. `lineWidth > 1` is silently ineffective. At `dpr: 2` a
one-device-pixel trace is anaemic and effectively invisible on HiDPI displays. No width, no
caps, no joins, no dashes.

Corrected against research evidence (see `research.md`, claim C2): an earlier draft of this
document claimed `ALIASED_LINE_WIDTH_RANGE` is reported as `[1, 1]` on ANGLE/D3D11 and Metal.
The evidence does not support that and points the other way — the reported range **can be
misleading**, advertising something like `[1, 10]` while the effective rasterized width stays 1.
That strengthens the conclusion: the range cannot be used to feature-detect thick-line support,
so instanced quad expansion is the unconditional primary path, and the `LINE_STRIP` hairline
fast path is selected by requested style (effective width <= 1 device pixel), never by querying
the range.

The brief's 3 ms budget for 500k points is not the problem — a single `drawArrays` is
microseconds of main-thread cost. The primitive is the problem.

**Resolution — instanced quad expansion, which preserves the "zero CPU interleaving" mandate.**
`drawArraysInstanced(TRIANGLE_STRIP, 0, 4, count - 1)` over a unit quad. The **same two
non-interleaved VBOs** are each bound twice at different offsets: `a_x0`/`a_y0` at offset 0 and
`a_x1`/`a_y1` at offset 4 bytes, `stride = 4`, `vertexAttribDivisor(loc, 1)`. Zero CPU
interleaving, zero data duplication, real width and joins computed in the vertex shader. Only
`LINE_STRIP` dies; the dual-VBO layout is intact. Keep `LINE_STRIP` as an explicit hairline
fast path when effective width is <= 1 device pixel.

Budget adjustment: 4 verts x 500k instances = 2M vertex-shader invocations (still fine);
1e6 points = 4M invocations, which is 2-4 ms on integrated GPUs — hold <3 ms at 500k and
relax explicitly at 1e6.

This must be settled before the WebGL2 change freezes its shader and binding layout, because
the wafer change would otherwise duplicate the wrong pipeline.

### 1.3 A canvas element cannot change context type — flicker-free switching needs two canvases

`getContext('2d')` and `getContext('webgl2')` on the same element are permanently mutually
exclusive. The brief's AC-S4-03 ("switch with no visual flicker and no lost transform state")
is **unreachable** with a single canvas.

**Resolution — stacked dual canvas.** Initialize + `setData` + `render` the incoming renderer
while hidden, wait one `rAF`, flip CSS visibility in a single frame, destroy the outgoing
renderer on the next frame.

Hysteresis, which CLAUDE.md rule 3 mandates and the brief never defines: two thresholds, not
one — enter WebGL at `N_up`, return to Canvas2D at `N_down`, plus a minimum dwell time
(~500 ms / 30 frames). Better still, switch **only** on explicit `setData` size changes, never
mid-gesture; queue a pending switch until the gesture ends.

State that must survive the swap: the full `ViewportTransform` (width/height/dpr/domainX/
domainY), style configuration, accumulated gesture state, and — the hard one — the data
payload itself, which may not be in the main thread's hands (§1.1).

The 80k threshold is also arbitrary. Since Canvas2D with pre-decimation to ~2x viewport width
is fast at *any* input size (§1.6), the threshold must be evaluated on the **decimated** count,
where the real crossover sits nearer 5k-20k device-space segments than 80k. The legitimate
reasons to pick WebGL2 are different: undecimated min/max envelope bands with density shading,
many simultaneous traces, or 60 Hz streaming where per-frame path rebuild dominates.
Treat 80k as a measured, configurable constant with a documented benchmark, not a magic number
in a spec.

### 1.4 WebGL context "automatic reassignment" is not honest

Nothing is reassigned. On `webglcontextlost` **every** GL object dies — programs, shaders,
VAOs, buffers, textures, framebuffers, renderbuffers, queries, sync objects — and every
`WebGLUniformLocation` becomes invalid. Restoration means recompiling and relinking shaders,
re-querying uniform locations, rebuilding VAOs, re-acquiring extensions, and re-uploading all
buffer and texture content **from CPU-side data**. Without `preventDefault()` on the loss
event, `webglcontextrestored` never fires at all.

Genuinely unrecoverable: vertex data that was transferred away (§1.1), and any state that only
ever lived on the GPU. Also, the restore event **may never arrive** (driver blacklist, TDR
loop, backgrounded tab, or the ~16-context limit). So the recovery path needs bounded retries
and then **permanent degradation to Canvas2D with user-visible state** — which is exactly the
brief's own AC-S3-03 and must be wired to the same code. `WEBGL_lose_context.loseContext()` is
a good test but is not equivalent to a real driver reset, which can arrive between any two GL
calls; every GL entry point must tolerate `gl.isContextLost()`.

### 1.5 Every memory and timing acceptance criterion in the brief is unverifiable as written

- **`performance.memory` cannot prove 0 KB/frame.** It is Chromium-only, non-standard,
  deliberately **quantized** (~100 KB granularity, a Spectre-class mitigation), lazily updated,
  and reflects post-GC state. Any young-generation allocation scavenged before the next sample
  leaves no trace, and the quantization is larger than nearly every per-frame allocation.
  **Replacement:** in Node/Vitest, `PerformanceObserver` with `entryTypes: ['gc']` asserting
  *zero GC events over N iterations*, plus `v8.getHeapStatistics()` under `--expose-gc`. For
  browser render loops, a Playwright CDP session with `HeapProfiler.startSampling` attributing
  allocated bytes per call site. Restrict `performance.memory` to the dev-only telemetry HUD.
- **Zero allocation is achievable but needs an explicit ban list.** Numbers stay unboxed in
  locals and typed arrays, so a pure numeric loop genuinely can avoid allocating — but object
  and array literals, tuple returns, `for...of` over typed arrays (iterator object), spread,
  rest params, `arguments`, `.map`/`.filter`/`.slice` **and `.subarray`** (allocates a view
  object), per-call closures, template strings, hot-path `Error` objects, generators and `async`
  must all be banned. Additional uncovered risk: a loop **deopt** materializes numbers to the
  heap — mitigate with strict argument monomorphism and a `--trace-deopt` check in the bench.
- **The <15 ms decimation budget holds, but only warm and on declared hardware.** LTTB is a
  single O(n) pass: 1e6 samples land in 3-8 ms warm. Min-Max is 1-3 ms. But the **first**
  invocation runs in the interpreter before TurboFan tiering and can be 3-5x slower, blowing
  15 ms, and shared CI runners are 3-5x slower again. Declare reference hardware, require
  explicit warm-up, report median-of-N plus p95, split the budgets (Min-Max <4 ms, LTTB
  <12 ms), and do not run this gate on shared CI runners.
- **Sub-millisecond ACs need batched measurement.** Without cross-origin isolation,
  `performance.now()` is coarsely quantized (100 us or more), so the brief's <1 ms crosshair
  and <0.5 ms hit-test criteria must be written as N-iteration batches divided by N.
- **Wall-clock ms/FPS gates must not block CI.** GitHub Actions runners have unpredictable CPU
  steal and no GPU (WebGL falls back to SwiftShader, an order of magnitude slower and
  unrepresentative). Split every performance AC into a self-calibrating **relative regression
  budget** plus a deterministic, hardware-independent **work-count assertion** (exactly one
  `drawArrays` and zero `bufferData` calls per `render()` during pan/zoom; upload count
  constant regardless of point count). Demote the literal numbers to informational benchmarks.
- **Coverage >= 95% proves nothing numerical.** A zero-allocation loop reaches 95% line
  coverage from a single call. The real gate is property-based testing (`fast-check`): output
  length == threshold, first and last points always retained, strictly increasing indices,
  output is a subset of input, per-bucket min/max bound every sample in the bucket, and the
  brief's own peak-fidelity criterion over randomized peak positions and widths. Pin one
  coverage provider (`v8` and `istanbul` disagree on numeric-loop branches) and set thresholds
  per glob, or "95% on math modules" is silently measured across the whole workspace. Never run
  performance assertions in the coverage job — instrumentation distorts timing.
- **TTFP must be defined rigorously.** `render()` returning is not paint; GL calls are
  asynchronous. Define it as: mark at engine construction, measure at the start of the second
  `rAF` after the first `render()` returns; document that it excludes presentation latency and
  never claim GPU time from it. `gl.finish()` distorts by stalling, and
  `EXT_disjoint_timer_query_webgl2` is unavailable in most browsers for privacy reasons.

### 1.6 Canvas2D at 80k raw points cannot hit 8 ms — and `Path2D` cannot be reused

Path construction (80k `lineTo`, ~10-25 ns each) costs 0.5-2 ms and is not the problem.
**Rasterization** is: Skia converts the stroked polyline into fill geometry with joins, and 80k
segments across 1920 CSS px is ~40 points per pixel column — near-vertical segments with heavy
overdraw and analytic AA per segment. Real range: 5-25 ms on desktop. `dpr: 2` (a 3840x2160
backing store) **doubles the fill area**, pushing systematically past 8 ms. `alpha: false` and
`desynchronized: true` help at the margins, not by an order of magnitude.

**Resolution:** never hand 80k raw points to Canvas2D. Pre-decimate to <= 2x viewport width
(~3840 points), which makes the render trivially <2 ms — precisely what the core's decimation
module exists for. The AC becomes: *"`render()` <8 ms for an 80k-point dataset, after
decimation to <= 2x viewport width, at 1920x1080 dpr 2, on declared reference hardware."*

On `Path2D` reuse: a `Path2D` stores path-space coordinates. Reusing it with a per-frame
`ctx.setTransform()` is technically possible, but spectral X and Y scales differ by orders of
magnitude, so stroke width scales **anisotropically** and the trace deforms. Canvas2D has no
equivalent of `vector-effect: non-scaling-stroke`. Honest consequence: the `Path2D` must be
**rebuilt every frame** (one allocation per frame, not per point), and the zero-allocation
requirement must be stated **per point**, not per frame. Only valid reuse case: pure panning via
uniform `ctx.translate`; any zoom invalidates the path.

### 1.7 Cross-renderer pixel equivalence is not a meaningful gate

Three independent reasons, each sufficient. (a) There is no GPU in CI — headless Chrome on
Linux falls back to SwiftShader via ANGLE, whose rasterization, float precision and MSAA
sample pattern match no real GPU; snapshots taken on a Mac (Metal) will never match, and a
driver update changes rasterization on the same machine. (b) Canvas2D uses Skia's analytic AA
over a stroke's **area** with caps and joins, while GL lines use the diamond-exit rule over a
1 px span with **no joins at all** — they do not differ by tolerance, they compute different
geometry. (c) On a dense trace covering maybe 3-8% of pixels, a 2% budget lets the trace be
almost entirely different and still pass — simultaneously too lax to catch regressions and too
strict to be stable.

**What to assert instead:** pin the rasterizer (`--use-gl=angle --use-angle=swiftshader`) and
use snapshots as a per-renderer regression baseline **against itself**, never one against the
other. Test cross-renderer equivalence **numerically**: both renderers expose the projection
they applied, and the projected device coordinates of the decimated series are compared with
sub-pixel tolerance — a pure unit test, no GPU, deterministic. Add rasterizer-insensitive
structural assertions (non-background bounding box, inked column count, per-column min/max
inked-row envelope within +/- 1-2 px, mean luminance). And add **golden tests on the SVG
exporter**: fully deterministic text that catches projection regressions for free. That is the
cheapest, highest-value gate in the entire plan — which is why the SVG exporter moves early
(§2, change 6).

### 1.8 Reactivity isolation must be asserted by identity, not by memory percentage

"Vue-retained memory within 5% of the raw `Float32Array`" would need a heap snapshot with
dominator-tree computation, and a 5% tolerance on 4 MB is 200 KB — the same order as
`performance.memory` quantization, so noise swallows the signal.

**Deterministic replacement, a plain Vitest test:** `isReactive(payload.x) === false`,
`isProxy(payload.x) === false`, identity preservation (`toRaw(buf) === buf` and
`buf === theExactFloat32ArrayPassedIn`), `isShallow(bufferRef) === true`, and no observable
cloning (mutate `original[0]`, assert the renderer sees it). Keep one coarse check as a **leak
canary** only, not a precision gate: mount/unmount 50 times with 1e6 points and assert
`usedJSHeapSize` growth stays under a generous absolute ceiling.

### 1.9 A `WorkerBridge` that constructs the `Worker` inside the core cannot be isomorphic

`Worker` and `self` are browser globals exactly like `window`. Worse,
`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` is the **only** form
Vite, Rollup, webpack 5 and Next.js recognize statically — but `import.meta.url` **breaks the
CJS output** the brief demands from tsup, and the worker chunk must not be inlined into the
library's ESM bundle (the consumer's bundler has to process it, which only works if the library
publishes the worker as a separate asset).

**Resolution — dependency injection; the core never constructs a `Worker`.** The core exports
the pure algorithms plus a `DecimationPort` interface with a synchronous in-thread default
implementation (zero browser globals, trivially Node/SSR-safe, trivially tree-shakeable). It
also exports the worker handler as a pure factory so the worker entry file is three lines owned
by the adapter or the app. A separately published entry provides that, and adapters or the host
app inject `workerFactory: () => Worker` — each host writes the single line its bundler
understands. Capability detection (`typeof Worker !== 'undefined'`) must be **lazy, inside a
function body**, never at module scope: a top-level reference alone breaks SSR bundling and
defeats tree-shaking. Node parity: `worker_threads.Worker` has a different API (no
`addEventListener`, different `MessagePort` semantics), so the Node-isomorphism criterion is
satisfied by the **synchronous path**, with an optional Node adapter behind a `"node"` export
condition.

### 1.10 d3 does not belong in the isomorphic core, and `sideEffects: false` is not sufficient

`sideEffects: false` is a **correctness assertion**: declaring it on a module that does have
side effects produces silently broken consumer builds. Specific threats here: **CJS output is
not tree-shakeable at all**, so the tree-shaking criterion must be scoped explicitly to the ESM
condition (Next.js pages falling to the CJS path will bundle everything); a barrel `index.mjs`
is only shakeable if every re-exported module is effect-free *and* the consumer's bundler does
cross-module DCE; `d3-scale` drags in `d3-array`, `d3-interpolate`, `d3-color`, `d3-format`,
`d3-time` and `d3-time-format`.

**Resolution — drop `d3-shape` and `d3-interpolate` entirely.** Emitting `<path d="M... L...">`
for a polyline is ~15 lines of string building, and d3-shape's value is in curves and areas,
which a physics-preserving trace **must not use** — curve interpolation fabricates data between
samples, in direct conflict with CLAUDE.md rule 6. Likewise a 256-entry Viridis/Plasma LUT is
~20 lines of linear interpolation over control points. `d3-scale` (axis/tick projection) is
overlay-specific and belongs in the framework adapters, not the core. If a dependency-bearing
exporter is kept anyway, it goes in its own package or its own core subpath with granular
`exports` and `d3-*` marked `external` in tsup.

**Real CI gate, not visual inspection:** a fixture app importing only `{ lttb }`, then grep the
output bundle for `react`, `vue`, `d3`, `getContext`, `WebGL2RenderingContext`, plus a byte-size
ceiling. Add `publint` and `are-the-types-wrong`.

Note: v1 of this exploration was internally inconsistent here — it opened by stating no `d3-*`
belongs in the core and then concluded by keeping `d3-shape` in the core under a subpath. The
resolution above settles it: no d3 in the core at all.

### 1.11 Corrections with a single right answer (no product decision needed)

- **Package scope:** the brief's `@optic-vis/*` is a stale template leftover. Normalize to
  `@trace-kit/*` per repo identity and CLAUDE.md.
- **Root `exports` map is dead configuration.** The brief puts `exports["./vue"]`,
  `exports["./react"]` etc. in the root `package.json` pointing into `packages/*/dist`. The root
  is `private: true` and is never published, so npm never reads it. Correct model: four
  independently published packages (`@trace-kit/core`, `@trace-kit/renderers`,
  `@trace-kit/vue`, `@trace-kit/react`), each with its own `exports` map and its own Changesets
  version. No umbrella package. `Canvas2DRenderer` and `WebGL2Renderer` are named exports of a
  single `@trace-kit/renderers`, per CLAUDE.md, not two packages.
- **`SpectrumDataPayload` is referenced by the brief's `FigureRenderer` but never defined.** It
  lives in `@trace-kit/core` beside the branded buffers it wraps; `packages/renderers` imports
  the type and only consumes it structurally in `setData()`, never constructing or mutating
  payloads. CLAUDE.md is explicit that renderers must not own the domain model.
- **LTTB output shape:** emit an `Int32Array` of selected indices rather than a
  `Float32Array(threshold)` per axis. This avoids duplicating data, lets the renderer index the
  original buffers, removes an allocation, and makes property tests trivial (subset, strict
  monotonicity). For the declared determinism, accumulate bucket averages in `number` (f64, the
  native width) and avoid implementation-dependent `Math` functions; basic IEEE-754 operations
  are deterministic across platforms.
- **Component naming:** CLAUDE.md names `TraceSpectrumViewer`. Use `<TraceSpectrumViewer/>` in
  both Vue and React rather than the brief's asymmetric `<SpectrumViewer/>` for React, since the
  brief itself demands prop/event parity for `<WaferDieMap/>` and the same principle applies to
  the main viewer.
- **Wafer hit-testing stays O(1) for a uniform reticle, and degrades predictably.** Circularity
  and partial edge dies do **not** break it — an unpopulated grid cell is an O(1) lookup against
  a flat `Int32Array` occupancy grid of size `rows*cols` mapping to die id or `-1`. The notch is
  orientation metadata only; rotation is an affine transform already contained in the inverted
  matrix. It **does** break on non-uniform streets or non-constant pitch (fix: cumulative
  per-axis offset tables plus binary search, O(log n), ~17 comparisons), on multiple reticle
  fields with differing steps or row-dependent column offsets (O(1) after a row lookup), and on
  non-rectangular dies or per-die overrides from a real map file (needs a point-in-die check
  after the cell lookup). State the AC as *O(1) uniform, O(log n) via cumulative pitch tables
  for non-uniform streets*. Separately: 60k dies over ~1000 px is ~4 px per die, so per-die
  outlines and the hover highlight produce moire and sub-pixel widths; the 256 px 1D LUT needs a
  non-mipmap `TEXTURE_MIN_FILTER` and `CLAMP_TO_EDGE` or it samples black.
- **VitePress hosting React demos is feasible, client-only.** VitePress is Vite + Vue 3 SSG;
  React demos mount as **client-only islands** — a Vue wrapper that, in `onMounted`, dynamically
  imports the demo and calls `createRoot(el).render(...)`, guarded by `import.meta.env.SSR`
  and/or `<ClientOnly>`, with React never imported at module scope of anything SSR touches. This
  is not React SSR, and the brief's Next.js SSR criterion must therefore be validated in its own
  Next.js smoke-test app, not inside VitePress. Known failure modes to design against:
  hydration mismatch if the framework switcher's initial value comes from `localStorage` (SSR
  must render a stable default and read storage in `onMounted`); any `window`/`document` touched
  at import time crashes the SSG pass; WebGL contexts leak across SPA navigation until the ~16
  context limit is hit, so `onBeforeUnmount` must `destroy()` and call
  `WEBGL_lose_context.loseContext()` while the React island calls `root.unmount()`; React
  `StrictMode` double-invokes effects in dev, so either drop it in docs or make `destroy()`
  idempotent.

---

## 2. Reconciled change inventory (16 changes)

Sprints are split where they bundle unrelated capabilities, and two units are inserted that the
brief never named: the ownership/transport contract (§1.1) and the framework-agnostic engine
controller (§1.3). The docs portal moves late (see the blocking decision in §5).

| # | Change name | Scope | Hard prerequisites |
|---|---|---|---|
| 1 | `workspace-test-harness-bootstrap` | pnpm workspace wiring, `tsconfig.base.json`, `tsup` dual-format per package, Vitest harness with one green isomorphic test, `tsc --noEmit`, lint, green GitHub Actions, benchmark harness (median-of-N + warm-up) for later perf ACs, Changesets. Harness only, no domain code. | none |
| 2 | `core-decimation-math` | Branded buffers, `SpectrumDataPayload`, `minMaxEnvelope`, `lttb` emitting `Int32Array` indices, property-based tests, determinism test, peak-fidelity test, GC-event zero-allocation gate, `--trace-deopt` check. Pure Node, no DOM, no worker. | 1 |
| 3 | `core-transport-contract` | `DecimationPort` interface + synchronous in-thread implementation, pooled single-ownership buffer protocol with backpressure, and the 60-second 60 Hz round-trip prototype under `--trace-gc` asserting zero scavenges and zero detached-buffer exceptions. **De-risks §1.1 before any renderer exists.** No real `Worker` yet. | 2 |
| 4 | `playground-shell` | `apps/playground` (Vite + TS, modular routing, tweakpane), `/core-math` view with synthetic Lorentzian generator, FWHM and noise-floor controls, LTTB vs Min-Max toggle and ms table. | 1, 2 |
| 5 | `renderers-canvas2d` | `@trace-kit/renderers` created; `FigureRenderer` + `ViewportTransform` contracts; `Canvas2DRenderer` with mandatory pre-decimation to <= 2x viewport width, injected `dpr`, `OffscreenCanvas` support, per-frame `Path2D` rebuild with per-point zero allocation; `/canvas2d-bench` view. | 3, 4 |
| 6 | `svg-vector-export` | `exportToSvg` with zero d3 dependency, hand-built path strings, no curve interpolation; **golden-file projection tests** that become the cheapest deterministic regression gate for every later renderer (§1.7). Placed early deliberately. | 5 |
| 7 | `renderers-webgl2` | `WebGL2Renderer`, dual non-interleaved VBOs double-bound at offsets, instanced quad expansion as the primary path with a `LINE_STRIP` hairline fast path, GLSL3 domain-uniform projection, full context-loss teardown/rebuild with bounded retries and permanent Canvas2D degradation, `gl.isContextLost()` tolerance at every entry point, `/webgl-bench` view with forced context loss. | 5, 6 |
| 8 | `worker-streaming-transport` | Real `Worker` behind injected `workerFactory` (core never constructs one), pooled round-trip transfer, incremental O(new samples) streaming decimation over a raw-sample ring buffer, backpressure counters, optional runtime-detected `SharedArrayBuffer` SPSC path, optional Node `worker_threads` adapter behind a `"node"` export condition. | 3, 7 |
| 9 | `engine-controller` | Framework-agnostic `SpectrumEngineController`: stacked dual-canvas swap protocol, two-threshold hysteresis with minimum dwell evaluated on decimated counts, switch deferred to gesture end, lifecycle state machine, authoritative main-thread CPU payload reference for GL restore. Shared by both adapters. | 7, 8 |
| 10 | `vue-adapter` | `@trace-kit/vue`: `useSpectrumEngine`, `<TraceSpectrumViewer/>`, `shallowRef`/`markRaw` isolation asserted by identity tests, single `ResizeObserver` + `rAF`, strict `onBeforeUnmount` teardown, `d3-scale` axis overlay, `/vue-showcase` view with simulated 60 Hz streaming. Parallel with 11. | 9 |
| 11 | `react-adapter` | `@trace-kit/react`: `useSpectrumEngine` over mutable `useRef`, `<TraceSpectrumViewer/>` with prop/event parity, idempotent `destroy()` for StrictMode, `/react-showcase` island view. Parallel with 10. | 9 |
| 12 | `package-exports-and-treeshaking-gates` | Per-package `exports` maps (no root `exports`), audited `sideEffects` declarations, ESM-scoped tree-shaking fixture with bundle grep + byte ceiling, `publint`, `are-the-types-wrong`, standalone Next.js SSR smoke-test app. | 10, 11 |
| 13 | `crosshair-sync-bus` | `CrosshairSyncBus` over `EventTarget`/`BroadcastChannel`, `translate3d` overlay guides with no canvas repaint, batched sub-ms timing assertions, `/multi-chart-sync` 4-chart view. | 10, 11 |
| 14 | `wafer-die-map` | `WaferMapBuffer`, instanced WebGL2 die rendering, hand-built 256-entry LUT texture with correct filtering, `Int32Array` occupancy grid, O(1) uniform / O(log n) non-uniform hit-testing, Vue + React `<WaferDieMap/>` parity, `/wafer-map` view. | 9, 12 |
| 15 | `docs-portal` | `apps/docs` VitePress, framework switcher with hydration-safe initial state, client-only React islands, WebGL context cleanup across SPA navigation, and the full page set for everything already built (Getting Started, Mathematical Foundations, both renderers, both adapters, sync + export, wafer). | 12, 13, 14 |
| 16 | `benchmark-ci-and-deployment` | `/stress-test-lab` with Lorentzian / Fano / Fabry-Perot / Gaussian generators, p50-p95-p99 frame telemetry, rigorously defined TTFP, JSON export, per-renderer visual regression against a pinned SwiftShader rasterizer, numeric cross-renderer projection equivalence, coverage thresholds per glob, StackBlitz templates with a resolution check, public deployment. | 15 |

---

## 3. Dependency graph

```
1. workspace-test-harness-bootstrap
   |
   +---> 2. core-decimation-math
   |        |
   |        +---> 3. core-transport-contract  (ownership prototype: de-risks §1.1)
   |        |
   +--------+---> 4. playground-shell
                     |
        3 ------+----+
                v
         5. renderers-canvas2d
                |
                v
         6. svg-vector-export  (deterministic golden projection gate)
                |
                v
         7. renderers-webgl2
                |
        3 ------+
                v
         8. worker-streaming-transport
                |
                v
         9. engine-controller
                |
      +---------+---------+
      v                   v
10. vue-adapter    11. react-adapter      (genuinely parallel)
      |                   |
      +---------+---------+
                |
                +---> 12. package-exports-and-treeshaking-gates
                |            |
                +---> 13. crosshair-sync-bus
                             |
                    12 ------+---> 14. wafer-die-map
                                        |
                    12, 13 ------+------+
                                 v
                          15. docs-portal
                                 |
                                 v
                     16. benchmark-ci-and-deployment
```

**Cycle proof:** every edge points strictly forward through the numbering 1 -> 16 with no
back-edge, so the numbering is itself a topological order and the graph is a DAG by
construction.

**Real vs apparent parallelism.**
- 10 and 11 are genuinely parallel: disjoint packages, disjoint playground views, and both
  consume the already-frozen controller contract from 9.
- The brief's claim that its Vue and React sprints are parallel straight out of the WebGL2
  sprint is **false as written**. Both would independently implement `useSpectrumEngine`-shaped
  lifecycle logic, the 80k threshold, the hysteresis band, and the dual-canvas swap. That is not
  a graph cycle, it is a duplication hazard with silent divergence: whichever lands second
  either duplicates the logic or quietly redefines the switch behavior, breaking the brief's own
  no-flicker criterion. Change 9 removes the hazard and makes 10/11 actually independent.
- 4 has no dependency on 3 and can run alongside 2/3 once 1 lands.
- 2 and 3 are separated deliberately: 2 is pure math with no transport concerns, and 3's
  ownership protocol needs streaming and rendering requirements that only exist once the math is
  fixed.

---

## 4. Risks (ranked)

| Severity | Risk | Owning change |
|---|---|---|
| Critical | Buffer-ownership protocol chosen wrong. Fixes the public API shape of `setData`/`pushStreamData`, gates GL context restore, and the `SharedArrayBuffer` variant forces COOP/COEP, which excludes GitHub Pages and breaks StackBlitz embeds. Wrong choice is a breaking change across every package and documented example. | 3 |
| Critical | `LINE_STRIP` line-width limitation discovered after the WebGL2 shader and VBO binding layout are frozen — the wafer change would duplicate the wrong pipeline. | 7 |
| High | No test harness exists while `strict_tdd: true` is enforced. If change 1 under-scopes the harness (unit tests only, no Node-isomorphism check in CI), every downstream TDD cycle inherits false confidence. | 1 |
| High | Duplicated engine-switch and hysteresis logic if change 9 is folded into 10/11 instead of extracted. | 9 |
| High | Unverifiable ACs (`performance.memory`, literal ms/FPS, 5% retained memory) shipped as literal CI gates produce flaky or unfalsifiable CI from the first renderer change onward. | 2, 5, 7, 10, 11, 16 |
| Medium | Context-loss recovery under-tested: only reliably reproducible via `WEBGL_lose_context` in a real browser, not jsdom, and a real driver reset can arrive between any two GL calls. | 7 |
| Medium | Streaming re-decimates the full dataset per frame instead of incrementally, turning 60 Hz streaming into O(n) per frame. | 8 |
| Medium | VitePress SSG breaks or leaks WebGL contexts across SPA navigation; failures appear only in production builds, not dev. | 15 |
| Medium | d3 reintroduced into the core "because it is convenient", silently defeating the tree-shaking gate. | 2, 6, 10, 11, 14 |
| Low | Wafer inverse-transform hit-testing subtly wrong at oblique zoom/pan; needs golden-coordinate or property tests, not visual inspection. | 14 |
| Low | StackBlitz templates rot as dependency versions drift; needs a CI resolution check. | 16 |

---

## 5. Blocking decisions for the orchestrator (before the first `sdd-propose`)

1. **Docs-portal position — the one place this decomposition contradicts the brief's stated
   intent.** The brief is titled "Sandbox & Docs First" and puts VitePress in sprint 1. The
   sandbox genuinely stays first (change 4, with a per-feature view landing inside every
   subsequent change). The **docs portal** is recommended at position 15 instead, because
   documenting a public API before the adapters exist guarantees rework, and because the brief's
   own sprint-1 criterion demands a green VitePress SSG build before a single documentable
   component exists — pure toolchain risk on the critical path. Interim docs: README plus the
   live playground. Options: (a) portal late at 15, per-change views in the playground
   throughout [recommended]; (b) portal shell early per the brief, accepting rework; (c) portal
   early but content-frozen until the adapters land.
2. **Change granularity — 16 changes.** Confirm the split, and specifically the two inserted
   units the brief never named: `core-transport-contract` (3) and `engine-controller` (9). These
   are the two that alter the brief's stated dependency order.
3. **Performance-AC model.** Confirm that every literal ms/FPS/byte threshold is rewritten as
   (self-calibrating relative regression budget) + (deterministic work-count assertion), with
   the raw numbers demoted to informational benchmarks recorded by change 16, and that
   zero-allocation is asserted via GC-event counts rather than `performance.memory`. This
   changes what "AC passes" means operationally, so it must be settled before `sdd-spec`.
4. **`SharedArrayBuffer` support scope.** Confirm it is an optional runtime-detected fast path
   only, never required — because requiring it means COOP/COEP, which rules out GitHub Pages
   deployment and breaks StackBlitz embeds, both of which the brief demands.

Everything else in §1.11 is a technical correction with a single correct answer under
CLAUDE.md's existing rules and proceeds directly into `sdd-design` for the owning change.

---

## 6. Repository config incongruences (outside the change scope, flagged for the user)

- `openspec/config.yaml` declares `session.artifact_store: both`, which contradicts CLAUDE.md
  rule 7 (Zero-Engram guarantee, no `mem_*` tooling). The native dispatcher resolves `openspec`
  regardless, so the file is the stale party.
- `openspec/config.yaml` declares `session.delivery_strategy: ask-always`, which is not a
  member of the valid domain (`ask-on-risk`, `auto-chain`, `single-pr`, `exception-ok`). It is an
  invalid value, not a synonym.

---

## 7. Confirmed pre-proposal decisions (user-confirmed, binding on `sdd-propose`)

Status: `confirmed`. These four were presented as blocking choices and resolved by the user.

1. **Docs-portal position: late portal, sandbox throughout.** `apps/playground` lands at change 4
   and every subsequent change adds its own view. The VitePress portal is change 15 and carries
   the complete page set. Interim documentation is the README plus the live playground. This
   deliberately reorders the brief's "Docs First" framing for the portal only; the sandbox-first
   intent is preserved in full.
2. **Granularity: 16 changes, both insertions accepted.** `core-transport-contract` (3) and
   `engine-controller` (9) are confirmed as first-class changes. The brief's claim that the Vue
   and React units are parallel directly out of the WebGL2 unit is superseded: both now depend
   on change 9.
3. **Performance-AC model: relative regression budget + deterministic work count.** Every
   literal ms / FPS / byte / pixel-percentage threshold in the brief is rewritten as a
   self-calibrating regression budget measured on the runner itself, plus a hardware-independent
   work-count assertion. Zero-allocation is asserted via GC-event counts, never
   `performance.memory`. The literal numbers survive as informational benchmarks recorded by
   change 16. `sdd-spec` must apply this rewrite to every affected AC rather than transcribing
   the brief's numbers.
4. **`SharedArrayBuffer`: optional runtime-detected fast path, never required.** The default
   transport is the pooled ownership round-trip, which works under any deployment. COOP/COEP is
   never a requirement, preserving GitHub Pages deployment and StackBlitz embeds.

Consequently the exploration phase is complete and the pre-proposal gate is satisfied:
product decisions are `confirmed`, and no unresolved choice blocks `sdd-propose`.
