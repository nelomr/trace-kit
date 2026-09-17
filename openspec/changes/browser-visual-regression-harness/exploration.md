# Exploration: browser-visual-regression-harness (roadmap order 5.5)

Status: exploration only. No proposal / spec / design / tasks created. No production code written.

Input: `openspec/roadmap.yaml` order 5.5 (comment block above the entry), archived change
`2026-09-16-renderers-canvas2d` (`design.md` §D7, §D8, Risk R1), current repo toolchain.

---

## 1. Problem statement

`renderers-canvas2d` shipped a `Canvas2DRenderer` whose paint body is untested at the pixel
level, by explicit, recorded design decision — not by oversight.

**Evidence.**

- `openspec/changes/archive/2026-09-16-renderers-canvas2d/design.md:1349` — Risk R1: *"No
  automated test asserts a painted pixel... A regression in the paint body — wrong colour, wrong
  order, a missing `stroke` — ships green."*
- `design.md:837-842` (§D8, "The honest gap"): happy-dom's `getContext("2d")` returns `null`
  (`packages/renderers/vitest.config` project `renderers-dom` runs on `happy-dom`), so no test
  environment in the repo can rasterize anything. The mitigation adopted was structural — reduce
  the untested surface to "style assignment plus a fixed sequence of sink and context calls" —
  and a real-browser runner was explicitly deferred: *"Introducing a real browser runner
  (`@vitest/browser` + Playwright) is a workspace-toolchain change with CI, cache and runtime
  cost, and smuggling it in under a rendering change is exactly the kind of scope creep this
  decomposition exists to prevent."*
- Source confirms the shape of the gap. `packages/renderers/src/canvas2d/canvas2d-renderer.ts`
  drives a `TraceDrawingContext` (a structural interface over `CanvasRenderingContext2D` /
  `OffscreenCanvasRenderingContext2D`, §D9) through `setTransform` → `fillRect` → grid strokes →
  `stroke(path)` → axis calls. Every existing test (`packages/renderers/test/node/**`,
  `test/dom/**`) either drives this against a fake context object (asserting call order/args) or
  against `happy-dom`, which never calls into Skia/Chromium's rasterizer. There is no path in the
  current toolchain that produces actual pixels and compares them to anything.
- `packages/renderers/vitest.config` (inherited from root `vitest.config.ts`) has exactly two
  projects for this package: `renderers` (`environment: "node"`) and `renderers-dom`
  (`environment: "happy-dom"`). Neither can rasterize by construction — `happy-dom` is a DOM
  shim, not a browser engine.

**What is unverifiable today, concretely:** stroke color, stroke width (including the
non-uniform-CTM anisotropy `design.md` §D5/R6 documents as measured on Blink only and never
re-verified visually), anti-aliasing/line joins, paint *order* as it actually composites (call
order is asserted, but not that the calls produce the intended visual result), axis label
rendering/positioning as pixels, and — most importantly for the roadmap's own stated reason —
whether a second renderer (WebGL2, change 7) produces the *same picture* as this one. `design.md`
Blocking Questions (line ~1366) names this gap as a "named deferral with an owner": this change.

**Why it matters now, not later.** `roadmap.yaml`'s comment above order 5.5 states the ordering
rationale directly: change 7 (`renderers-webgl2`)'s entire premise is "a second engine producing
the same picture as the first", which is unverifiable without a reference image of the first.
`svg-vector-export` (order 6) has the same problem in a different medium (numeric equivalence,
not raster) but is out of scope here. The roadmap places this change as a prerequisite of change
7 specifically so that claim is checkable before it is made.

---

## 2. Approach comparison

### 2.1 Where this sits in the existing test topology

```text
                    packages/core (node, no DOM)          <- unaffected
                    packages/renderers "renderers" (node)  <- unaffected, keeps fake-context tests
                    packages/renderers "renderers-dom" (happy-dom)  <- unaffected, keeps DOM-shape tests
                    apps/playground "playground" (happy-dom)        <- unaffected
                                        |
                                        |  NEW: a project/tool that actually rasterizes
                                        v
                    +-----------------------------------------------+
                    |  browser visual regression harness             |
                    |  real Canvas2D rasterizer (Chromium/WebKit/    |
                    |  Firefox via Playwright), golden PNGs, diff    |
                    +-----------------------------------------------+
```

This is additive: it does not replace the fake-context / happy-dom tests (§D8's rationale for
those — deterministic, fast, no browser — still holds for call-sequence and lifecycle
assertions). It closes the one gap those tests structurally cannot close.

### 2.2 Runner choice

```text
  (a) Vitest browser mode (@vitest/browser + Playwright provider)
      +-- lives inside the existing `vitest.config.ts` `projects` array as one more entry
      +-- same `describe/it`, same reporter, same `pnpm run test` / `turbo run test` entry point
      +-- screenshot assertion via `@vitest/browser`'s own `toMatchScreenshot` (stable since
          Vitest ~3.2) or a manual pixelmatch step against a captured canvas
      +-- con: heavier project config (browser instances, headless flags); another moving part
          in an already nontrivial root `vitest.config.ts` (see its own comments on per-project
          `poolOptions` not propagating)

  (b) Playwright Test, standalone (separate `playwright.config.ts`, own runner/reporter)
      +-- `page.goto()` a tiny static harness page (or `page.evaluate` driving the renderer
          directly against an in-page `<canvas>`), `expect(canvas).toHaveScreenshot()`
      +-- built-in golden-image management: `--update-snapshots`, automatic OS/browser-scoped
          snapshot naming, configurable `maxDiffPixelRatio`/`threshold`, retries
      +-- con: a second test runner and reporter alongside Vitest; a second `pnpm` script and a
          second CI step; the renderer under test must be reachable from a browser page, which
          means either bundling a tiny harness app or importing `@trace-kit/renderers`'s built
          output into a page context (the source is ESM/TS, not directly `page.evaluate`-able)

  (c) @vitest/browser + manual pixelmatch/odiff, no toHaveScreenshot
      +-- same integration as (a) but keeps the diff algorithm and golden-file layout explicit
          and swappable, rather than adopting Playwright's own snapshot format inside Vitest
      +-- more code to own (diff harness, golden storage convention) in exchange for control

  (d) node-canvas / headless-gl offscreen rasterization (no real browser at all)
      +-- rasterize in `node` via `node-canvas`'s Cairo backend, compare pixels there — no
          Playwright, no browser binary, fastest and cheapest in CI
      +-- disqualifying con: Cairo is a *different rasterizer* than what actually ships to users
          (Skia in Chromium, or the platform's engine). A stroke-anisotropy or AA bug that is
          real in Chromium (the exact class of bug `design.md` B-E1/B-E2 measured, R6 notes as
          "measured on Blink only") can be invisible under Cairo, or Cairo can disagree with
          Chromium's antialiasing in ways that make the golden images meaningless as a browser
          contract. This defeats the stated purpose (roadmap comment: prove change 7's WebGL2
          output matches change 5's Canvas2D output *as users will see it*). Rejected as the
          primary mechanism; may still be useful later as a fast pre-check, out of scope here.
```

Diagram: what each option actually rasterizes with, since that is the deciding property, not the
test-runner ergonomics:

```text
  (a)/(b)/(c)  Playwright-driven  -->  real browser engine (Chromium/WebKit/Firefox)  -->  Skia / etc.
  (d)          node-canvas        -->  Cairo (never ships to a TraceKit user)
```

**(a) vs (b): both route through a real engine, so the choice is process integration, not
fidelity.** (a) keeps one test runner and one CI step; (b) is more turnkey for snapshot
management but forks the toolchain. Given `.github/workflows/ci.yml`'s existing
`verify-turbo-ran.mjs` vacuity guard and `pnpm run test` as the single test entry point, adding a
second runner is a real cost this repo has specifically built tooling to avoid silently
bypassing. (a) is favored on that basis, with the fallback that if `@vitest/browser`'s Playwright
provider proves awkward for canvas pixel readback, (b) is the documented alternative — not a dead
end.

### 2.3 Pixel-diff library: pixelmatch vs odiff vs Playwright's `toHaveScreenshot`

```text
  pixelmatch     pure-JS, tiny, widely used (Playwright itself uses a fork of it internally),
                 synchronous, easy to wire into a Vitest assertion by hand; slower on huge
                 images but renderer output here is a fixed-size canvas (viewport-bounded, not
                 megapixel), so speed is not a constraint
  odiff          native (Rust) binary, faster, perceptual-diff option (less flaky on subpixel
                 AA differences); adds a native dependency / binary-per-platform to the toolchain
  toHaveScreenshot  Playwright's own, only available if runner choice is (b)/standalone
                 Playwright, or indirectly via @vitest/browser's screenshot matcher which itself
                 wraps pixelmatch-family diffing
```

Recommendation direction: pixelmatch, because it is a pure-JS dependency (no native binary to
vendor per-CI-platform, consistent with the monorepo's existing all-JS toolchain — no other
package here ships a native binary), and its output size here is small and bounded. odiff's
perceptual mode is a legitimate answer to the AA-nondeterminism problem below, but is a
tunable-later decision (`sdd-design` question), not one this exploration needs to force.

### 2.4 The nondeterminism problem: golden images across OS/font/AA

This is the sharpest open problem, and it is a repo-verified fact, not speculation: CI runs
`ubuntu-latest` (`.github/workflows/ci.yml:19`), while local dev is macOS/Darwin (see session
environment). Font rendering, subpixel hinting, and Skia's AA differ measurably between the two.
A golden PNG captured on a developer's Mac and compared byte-for-byte (or even loosely
pixel-diffed) against a Linux CI run will flake or fail permanently on text-heavy regions (axis
labels) even with a correct renderer.

```text
  developer laptop (macOS, Metal/CoreGraphics font stack)
        |
        |  captures golden.png  ----X---->  compared against  ---->  CI (ubuntu, FreeType/fontconfig)
        |                                                              renders differently: AA, hinting,
        v                                                              subpixel positions
     mismatch that is NOT a renderer regression
```

Mitigations, all standard in the Playwright/visual-regression ecosystem and all consistent with
this repo's toolchain:

1. **Goldens are generated and updated only in CI** (a single canonical OS/browser/font
   environment), never captured locally and committed. Developers regenerate via a CI artifact
   or a Docker-pinned local run matching the CI image, not via ad hoc local screenshots.
2. **Threshold-based diffing, not byte-exact.** `maxDiffPixelRatio` / a numeric pixelmatch
   threshold absorbs sub-pixel AA jitter while still catching "missing stroke" or "wrong colour"
   class regressions — which is exactly the class of defect Risk R1 names.
3. **Minimize text-in-canvas surface where practical**, or accept axis-label regions as the
   noisiest part of the image and scope pixel assertions primarily to the trace stroke and grid
   (deterministic geometry, no font shaping) — a scoping decision `sdd-design` should make
   explicitly rather than let it default to "diff the whole canvas and fight flakes forever."
4. **Pin the Playwright browser binary version** (Playwright already pins Chromium builds per
   package version), so "Chromium updated its AA" is not a silent source of drift between two CI
   runs on the same commit.

### 2.5 Golden-image storage & repo weight

PNGs are binary and do not diff meaningfully in `git`. Options: commit them directly under
`packages/renderers/test/visual/__screenshots__/` (Playwright's own convention) — simplest,
consistent with "pure filesystem-based OpenSpec storage" and CLAUDE.md's Zero-Engram/no-external-
service stance, but grows repo size monotonically and makes `git blame`/diffs on PNG changes
opaque (a reviewer cannot read a binary diff, only view the new image). This repo has no git-lfs
configured currently (`.gitattributes` not found in the tree walked above) — introducing LFS is
itself a workspace-toolchain decision `sdd-design` would need to weigh against "just commit small
PNGs" (this is a small, fixed-size canvas per test case, not a photo library — likely tens of KB
each, tens of cases — probably tolerable without LFS, but this is exactly the kind of empirical
question `sdd-design`/`research` should settle with an actual size measurement rather than
guessed here).

### 2.6 CI cost

New CI cost: a Playwright browser binary download/cache step, and headless browser execution
time. `.github/workflows/ci.yml` already restores a Turborepo cache (`actions/cache@v6`); a
Playwright browser cache (`~/.cache/ms-playwright`) is the standard additional cache key. This is
additive cost, not proportional to repo size, and should be scoped to `packages/renderers`
(turbo task filtering) rather than run for every package on every push.

### 2.7 Serving change 7 (`renderers-webgl2`)

The roadmap explicitly lists this change as a prerequisite of change 7 because change 7's premise
is engine parity: WebGL2 output must match the Canvas2D reference for the same
payload/domain/viewport. The harness built here should therefore capture goldens keyed by
scenario (payload shape, domain, viewport, dpr), not by renderer — so change 7 can point a
second renderer implementation at the *same* golden set and assert near-equality (likely with a
looser threshold than same-renderer regression checks, since WebGL2 rasterization will not be
byte-identical to Canvas2D even when "correct"). This is a scope-boundary decision, not an
implementation detail: it determines whether change 7 reuses this harness's fixtures or
duplicates them.

---

## 3. Scope boundaries

**In scope for this change:**
- A working browser-based rasterization + pixel-diff mechanism wired into the existing toolchain
  (`turbo.json` task, `pnpm run test` or a dedicated `test:visual` task, CI step).
- Golden images (or the CI-generation process producing them) for the existing
  `Canvas2DRenderer` surface: background, grid, trace stroke, axes — the exact call sequence
  §D8 already asserts structurally, now asserted visually too.
- A documented convention for scenario naming/fixtures reusable by change 7.
- CI integration with appropriate caching, scoped to avoid inflating every unrelated CI run.

**Deferred / explicitly out of scope (owner named):**
- Actually running WebGL2 goldens or parity assertions — change 7 (`renderers-webgl2`), which
  lists this change as a prerequisite for exactly that reason.
- SVG numeric-equivalence checks — change 6 (`svg-vector-export`), a different verification
  problem (vector math, not raster).
- Cross-browser (WebKit/Firefox) goldens beyond Chromium, unless `sdd-design` decides the parity
  claim needs more than one engine — Chromium-only was this repo's own empirical precedent
  (B-E1/B-E2/B-E3 in the canvas2d change were "measured in headless Chrome").
- Visual regression for `apps/playground` interactive stress-test UI — out of scope; this change
  targets `packages/renderers`'s own contract, not the playground shell.
- Perceptual/odiff-based diffing — named as a later tunable, not required to close R1.

---

## 4. Open questions for `sdd-design`

1. Runner: `@vitest/browser` (Playwright provider) inside the existing root `vitest.config.ts`
   projects array, vs. standalone Playwright Test. §2.2 leans (a); needs confirming against an
   actual spike of canvas pixel readback through `@vitest/browser`.
2. Golden storage: commit PNGs directly vs. git-lfs vs. CI-artifact-only (never committed,
   regenerated and diffed against the previous CI run) — needs an actual measured PNG size per
   scenario before deciding.
3. Diff threshold and library: pixelmatch (default lean, §2.3) with what numeric threshold, or
   odiff's perceptual mode if AA flakiness proves worse than expected in practice.
4. Scenario/fixture schema that change 7 will reuse — naming, and whether it lives in
   `packages/renderers/test/visual/fixtures/` or a shared location importable by a future WebGL2
   test suite.
5. Whether golden generation/update is a manual `--update-snapshots`-style local workflow gated
   by review, or fully CI-only with no local update path (affects developer workflow, not just
   CI).
6. Text/axis-label handling: assert the whole canvas with a generous threshold, or exclude/crop
   label regions and assert geometry (grid/stroke) tightly plus labels loosely — §2.4 point 3.
7. Which OS the canonical goldens are generated on — almost certainly CI's `ubuntu-latest` given
   `.github/workflows/ci.yml`, but this should be an explicit decision, not an implicit default.

---

## 5. Recommendation

Favor **Vitest browser mode with a Playwright provider** (§2.2 option a) over standalone
Playwright Test, to keep one test runner and one `pnpm run test` entry point consistent with this
repo's existing vacuity-guarded CI (`scripts/verify-turbo-ran.mjs`) — introducing a second runner
duplicates that guard's job and adds a second place regressions in "did the task actually run"
can hide. Rule out node-canvas/headless-gl (§2.1 option d) outright: it rasterizes with Cairo, a
different engine than what ships to users, which defeats the roadmap's stated purpose (proving
Canvas2D and future WebGL2 produce the same picture *as a browser renders it*). Generate goldens
in CI only (ubuntu-latest, pinned Playwright Chromium build), never commit locally-captured
screenshots, and use threshold-based pixelmatch diffing rather than byte-exact comparison to
absorb AA/font jitter without masking real regressions (wrong colour, missing stroke, wrong
paint order — the exact R1 failure modes). Defer the storage-format decision (plain PNGs vs.
git-lfs) to `sdd-design`/`sdd-research` pending an actual measured golden size, and defer the
scenario/fixture schema decision to the same phase since it is the one piece change 7 will
directly depend on and is worth getting right once rather than reworking.

---

## Return Envelope

**Status**: success
**Summary**: Investigated why `renderers-canvas2d`'s Risk R1 (no automated test asserts a
painted pixel) is real and unclosed, confirmed the current toolchain has no rasterizing test
environment, and compared five approaches to close the gap with a real-browser harness reusable
by change 7's engine-parity claim.
**Artifacts**: `openspec/changes/browser-visual-regression-harness/exploration.md`
**Next Recommended**: `sdd-propose`
**Risks**: Golden-image cross-OS/font nondeterminism (macOS dev vs. Linux CI) is the main
technical risk and is only mitigated, not eliminated, by CI-only golden generation plus
threshold diffing; repo weight growth from committed PNGs is unmeasured; a second test runner
would weaken this repo's existing "task actually ran" CI guard, which is why standalone
Playwright Test is the fallback rather than the primary recommendation.
