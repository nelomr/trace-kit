# Proposal: browser-visual-regression-harness

> Change **order 5.5** in `openspec/roadmap.yaml` — inserted after the 16-change decomposition
> was written, which is why its key is fractional. Hard prerequisite: **change 5 —
> `renderers-canvas2d`** (archived as
> `openspec/changes/archive/2026-09-16-renderers-canvas2d/`, spec deltas already merged into
> `openspec/specs/`). It is itself a listed prerequisite of **change 7 — `renderers-webgl2`**
> (`openspec/roadmap.yaml` order 7).
>
> Exploration: `openspec/changes/browser-visual-regression-harness/exploration.md`.
> Research lane: **selected and complete**, outcome `done` (revision 2) —
> `openspec/changes/browser-visual-regression-harness/research.md`. Claim ids of the form
> **C1**…**C22** below refer to that artifact's validated claims. Its **Withdrawn claims**
> section is binding: the four Chromium launch flags the exploration assumed, the "browser mode
> became stable in 4.0" statement and the "official Docker image gives consistent baselines"
> statement are not cited anywhere in this proposal, and must not be cited in spec or design.
>
> Two points of the exploration are superseded by the research and are **not** carried forward:
> its assumption that a screenshot matcher is already available at the installed Vitest version
> (corrected by **C1**/**C2**), and its framing of pixel diffing as the obvious default
> (corrected by research Contradiction 1 — two of four confirmed charting projects deliberately
> do not diff pixels).
>
> Product decisions **P1**–**P12** are **confirmed** by the maintainer in
> `openspec/changes/browser-visual-regression-harness/preproposal.md` (revision 6) and are
> settled inputs here, not open questions. **P7**–**P10** were confirmed after the first draft of
> this proposal and are absorbed below: the dependency freshness policy (P7), the toolchain
> modernisation folded into this change (P8), the zero-deprecation-warning rule (P9) and the
> `ES2022` build-target documentation task (P10). **P11** and **P12** were confirmed after the
> second draft, on the measurements in `toolchain-probe.md` **part 2**, and are likewise absorbed
> below: the three fixes TypeScript 6.0.3 costs (P11) and the correction of the root
> `package.json`'s literal `typescript` pin to `catalog:` (P12). Finding ids of the form
> **F1**–**F16** refer to `toolchain-probe.md`; **F9**–**F16** are part 2, measured against a
> detached `git worktree` of `HEAD` (`4cb0872`).

## Problem / Motivation

### R1 is a real, recorded, open hole

`renderers-canvas2d` shipped `Canvas2DRenderer` with no automated test that asserts a painted
pixel, and said so. Its `design.md` records this as **Risk R1**: a wrong colour, a wrong paint
order or a missing `stroke` ships green. The same design's §D8 explains why it could not be
otherwise inside that change — `happy-dom` returns `null` from `getContext("2d")`, so the
`renderers-dom` project cannot rasterize; and `renderers` runs on `environment: "node"`, which
has no canvas at all. Both projects are visible in the current root `vitest.config.ts`
`test.projects` array, and neither can produce a pixel by construction.

What the existing tests do assert is the *shape* of the paint: the sequence and arguments of
calls made against a fake `TraceDrawingContext`. That is a genuine guard against a restructured
paint body, and it stays. It is structurally incapable of catching the failure class R1 names,
because every one of those failures is downstream of the call — the call is made, with the
arguments asserted, and the rasterizer paints the wrong thing or nothing.

Concretely unverifiable today: stroke colour, effective stroke width under a non-uniform CTM
(the anisotropy that change 5's own evidence measured on Blink only), anti-aliasing and line
joins, composited paint order, and axis-label rendering as pixels.

### Change 7 cannot make its central claim without this

`openspec/roadmap.yaml` states the ordering rationale in the comment block above `order: 5.5`:
change 7's "entire premise is a second engine producing the same picture as the first; that
claim is unverifiable without a reference image of the first." Change 7 lists
`browser-visual-regression-harness` among its prerequisites for exactly that reason.

This is not a stylistic preference about test coverage. `renderers-webgl2` will add a second
backend behind the same `FigureRenderer` seam. "Same picture" is either an assertion backed by a
reference image of the Canvas2D output under a known scenario, or it is a sentence in a design
document. Without a reference corpus, the only thing change 7 can check is that its WebGL2
renderer makes the same *sequence of calls* — against a different API, where the comparison is
meaningless. Arriving at 1.0.0 with two rendering engines and no evidence that either paints
correctly, let alone that they agree, is the outcome this ordering exists to prevent.

### Why pixel goldens, given that the ecosystem is split

The research found the ecosystem genuinely divided. plotly.js (**C18**) and deck.gl (**C19**)
diff PNG baselines; apache/echarts (**C20**) and uPlot (**C21**) deliberately do not, comparing
the canvas *operation stream* instead — which sidesteps rasterization nondeterminism by
construction. That fork was presented to the maintainer with that tradeoff stated, and **P1**
resolved it: operation-stream comparison never asserts a painted pixel, so it leaves R1 open and
gives change 7 nothing to compare a second engine against. Closing R1 and producing reusable
reference images is this change's entire reason to exist, so the approach that cannot do either
is not admissible here regardless of how much cheaper it is to keep green.

## Proposed Approach

### 1. Vitest browser mode with the Playwright provider, after a 3 → 5 workspace upgrade

Decision **P2**, confirmed. The workspace resolves `vitest` to **3.2.7** (**C1**), pinned
through `pnpm-workspace.yaml`'s `catalog:` block as `'vitest': '^3.0.0'` and consumed as
`vitest: catalog:` by the root `package.json` and by every package that has a `test` script.
Vitest's native visual assertion `expect(element).toMatchScreenshot()`, with global defaults
under `test.browser.expect.toMatchScreenshot` (`comparatorName`, `comparatorOptions` including
`threshold` and `allowedMismatchedPixelRatio`, default comparator `pixelmatch`), is documented
on v5 (**C2**). It does not exist at 3.2.7. The upgrade is therefore not incidental to this
change; it is the precondition for the mechanism this change is built on.

The two alternatives were rejected on repo-specific grounds, not preference:

- **A second, standalone test runner** (Playwright Test with its own config, reporter and CI
  step) would put a class of tests outside `pnpm run test` → `turbo run test`, and therefore
  outside `scripts/verify-turbo-ran.mjs`, which `.github/workflows/ci.yml` runs before each of
  `typecheck`, `lint` and `test` precisely to make "the task resolved to zero tasks" a failure
  instead of a green run. This repository built that guard on purpose; routing new tests around
  it is a regression in the CI contract even when the tests themselves pass.
- **Hand-rolling a comparator under Vitest 3** defers the upgrade but keeps it: it means owning
  screenshot capture, golden resolution, OS-suffix policy and diff-image emission as first-party
  code, and then discarding that code when the upgrade eventually happens for another reason.

Browser mode supports the Playwright and WebdriverIO providers; a third `preview` provider
exists and is documented as not recommended for CI (**C3**). Playwright is selected.

The v4 breaking changes are concentrated on browser mode itself (**C4**) and are crossed by this
upgrade with full knowledge of what they are: browser providers moved into separate packages, a
provider **factory** is required in place of a provider string, and setting `environment` to
`browser` is now forbidden. That last one interacts directly with this repository's config: the
four existing `test.projects` entries each set `environment` explicitly (`node`, `happy-dom`,
`node`, `happy-dom`), so the new browser project must be expressed by provider factory and must
not set `environment` at all.

The research also records honestly that no primary source names the version at which browser
mode's experimental flag was removed (**C5**); the decision does not rest on that, it rests on
**C1** and **C2**.

### 2. Rasterize with the engine that ships to users

Node-side rasterization (`node-canvas` over Cairo) was rejected in exploration and stays
rejected: Cairo is not the rasterizer any TraceKit user sees, so a Cairo golden is not evidence
about Chromium's output, and change 7's parity claim is about browsers. Playwright-driven
Chromium is the rasterizer of record.

Two determinism controls are already applied by Playwright on every Chromium launch without any
configuration from us: `--force-color-profile=srgb` (**C10**) and `--enable-unsafe-swiftshader`
(**C11**), the latter meaning WebGL falls back to the SwiftShader software rasterizer when no
usable GPU is present. Both are inherited, not configured. No additional launch flag is proposed
here, because no primary source supports the ones the exploration assumed.

### 3. Threshold comparison over a mismatch ratio, never byte equality

deck.gl's production comparator is the concrete precedent: `pixelmatch` with
`{threshold: 0.105, includeAA: true}`, comparing a *ratio* of mismatched pixels against a
per-test threshold — not an absolute count, not byte equality (**C14**). Vitest's
`toMatchScreenshot` exposes the same two axes (`threshold`, `allowedMismatchedPixelRatio`) with
`pixelmatch` as its default comparator (**C2**), so the precedent transfers without a
first-party comparator.

Comparator choice is not cosmetic and is not being made here: pixelmatch, odiff and looks-same
all do YIQ/perceptual comparison with antialiasing awareness, but their reported mismatch counts
diverge by an order of magnitude on comparable inputs, so the comparator changes pass/fail
outcomes at real thresholds (**C15**). This proposal fixes the *shape* of the rule
(ratio-against-threshold) and leaves the comparator and its numbers to `sdd-design`.

### 4. Goldens are generated on CI, stored in plain git

CI runs `ubuntu-latest` (`.github/workflows/ci.yml`); development is macOS. Playwright documents
that rendering varies by host OS, version, settings, hardware, power source and headless mode,
and that baselines should be compared in the environment that generated them (**C7**). Its own
default baseline filenames embed the platform, e.g. `example-test-1-chromium-darwin.png`
(**C8**) — OS-scoped goldens are documented default behaviour, not a workaround. A golden
captured on a developer's Mac and compared on Linux CI is therefore expected to diverge for
reasons unrelated to the renderer, which is why local capture is excluded by constraint rather
than discouraged by convention.

Storage is plain git, not Git LFS, on measured grounds: deck.gl carries **214 PNGs, 9.4 MB
total, 44 KB mean, 515 KB largest** as ordinary git objects with no LFS indirection
(**C16**, **C17**). The repository has no `.gitattributes` and no LFS configuration today, and
this change does not add either.

### 5. Fixtures are keyed by scenario, not by renderer

The reusable artefact this change owes change 7 is not the harness; it is the fixture set. A
fixture is keyed by payload shape, domain, viewport and device pixel ratio — never by which
backend drew it — so `renderers-webgl2` can point a second `FigureRenderer` implementation at
the identical scenario set and compare against the same reference corpus, rather than authoring
a parallel one that would make "the two engines agree" a comparison between two independently
authored fixtures. `dpr` is already an injected scalar on the renderer's `resize` surface, so a
fixture can state it as data.

Whether change 7 compares against the Canvas2D goldens directly or against its own
WebGL2-suffixed goldens, and at what threshold, is change 7's decision. What this change owes it
is that the *scenario* is expressible once.

## Scope

Package scope is `@trace-kit/*`.

### Built here

- **A browser test project** in the root `vitest.config.ts` `test.projects` array, rooted at
  `packages/renderers`, using the Playwright provider through a provider factory (**C4**) and
  setting no `environment` key. It sits alongside the existing `core`, `playground`, `renderers`
  and `renderers-dom` entries, which are unchanged.
- **The Vitest 3.2.7 → 5.0.0 upgrade across the workspace**, in scope by decision **P2**
  (exact target version set by **P8**):
  `pnpm-workspace.yaml`'s catalog entries for `vitest` and `@vitest/coverage-v8` (both currently
  `^3.0.0`), the root `package.json` devDependency, and every package consuming
  `vitest: catalog:` — currently `packages/core`, `packages/renderers` and `apps/playground`.
  The v4 breaking changes crossed are exactly those in **C4**.
- **Visual test cases** over the shipped `Canvas2DRenderer` surface — background, grid, trace
  stroke, axes — asserting painted output with `toMatchScreenshot` against committed goldens.
- **A scenario fixture set** under `packages/renderers`, keyed as described in §5 and
  documented as the contract change 7 reuses.
- **The golden corpus** itself, committed as plain git objects, generated on CI.
- **The toolchain modernisation of the catalogued dependencies**, in scope by decision **P8**.
  The maintainer was offered a separate toolchain change and chose to fold the work into this
  one, having been told that TypeScript 7 and ESLint 10 are majors that can move code across
  every package and that combining them with the harness makes a regression harder to attribute.
  That is recorded as an informed decision, not an oversight, and is the source of risks **R9**,
  **R10** and **R11** below. The exact targets are the table in `preproposal.md` **P8** — this
  proposal does not recompute them. They are, in summary: `typescript` `^5.7.0` → `6.0.3`,
  `eslint` `^9.17.0` → `10.10.0`, `@types/node` `^22.10.0` → `26.5.1`, `vitest` and
  `@vitest/coverage-v8` `^3.0.0` → `5.0.0`, `typescript-eslint` `^8.19.0` → `8.70.0`, `vite`
  `^8` → `8.3.0`, `happy-dom` `^20.14.0` → `20.14.5`, `fast-check` `^4.0.0` → `4.10.0`, `turbo`
  → `2.10.13`, plus the three new entries this change needs (`playwright` `1.63.0`,
  `@vitest/browser-playwright` `5.0.0`, `pixelmatch` `7.2.0`). Node itself is already correct and
  consistent across `engines`, `.nvmrc` and both workflows, and is not touched.
- **The three TypeScript 6.0.3 fixes**, in scope by decision **P11**, each measured against a
  detached worktree of `HEAD` in `toolchain-probe.md` part 2 rather than predicted:
  - `"ignoreDeprecations": "6.0"` in **`tsconfig.base.json`** (**F11**). `tsup` hardcodes
    `baseUrl` in its bundled declaration build (`tsup/dist/rollup.js:6837`), which TypeScript 6
    reports as `TS5101` and which fails `pnpm exec turbo run build`. No `tsconfig` in this
    repository sets `baseUrl`, and `tsup@8.5.1` is the newest published release, so there is no
    upstream fix to wait for. The suppression MUST carry a comment naming `tsup` as the cause and
    stating that the option stops functioning entirely in TypeScript 7.
  - `"allowImportingTsExtensions": true` in **`apps/playground/tsconfig.json`** (**F12**). Three
    imports carrying an explicit `.ts` extension — `apps/playground/src/shell/bootstrap.ts:8` and
    `apps/playground/src/views/index.ts:3-4` — fail `pnpm exec turbo run typecheck` with `TS5097`
    under 6.0.3 and pass under 5.9.3. Legal in that config because it already sets
    `"noEmit": true`.
  - A rework of how **`eslint.config.js`** associates `test/**` and `bench/**` with a TypeScript
    project (**F13**). TypeScript 6.0.3 breaks `typescript-eslint`'s `projectService`
    `defaultProject` fallback, producing 29 false "type that could not be resolved" errors on
    ordinary Node globals under `packages/core/bench/`. Type-aware coverage of both trees MUST
    survive the rework, because that coverage is what enforces CLAUDE.md rule 1. The exact shape
    is a design decision.
- **The root `typescript` pin correction**, in scope by decision **P12**. The root
  `package.json` declares `"typescript": "^5.7.0"` literally while every workspace package
  declares `"typescript": "catalog:"`, so the root does not follow the catalogue and drifts from
  it silently (**F15**). It becomes `"catalog:"`. This is a pre-existing defect found while
  performing the upgrade, not caused by it, and it would otherwise make the **P8** catalogue
  targets partly fictional at the root.
- **The `DEP0152` deprecation-warning fix**, in scope by decision **P9**.
  `packages/core/test/decimation/allocation-gate.test.ts:83` and
  `packages/core/test/viewport/transform-allocation.test.ts:51` read `kind` and `flags` directly
  off a `PerformanceEntry`, which Node deprecates in favour of `entry.detail`. Every
  `pnpm run test` emits the warning today. The fix is to read both fields from `entry.detail`.
- **An explanatory comment on the `ES2022` build target**, in scope by decision **P10**.
  `tsconfig.base.json:3` sets `target: "ES2022"` and neither `packages/core/tsup.config.ts` nor
  `packages/renderers/tsup.config.ts` overrides it, so that is the JavaScript emitted for
  consumers. It is correct and is **not** raised to match the Node 24 toolchain: the target
  governs what downstream **browsers** must support, which is a different question from what
  version of Node builds and tests the code. This is a documentation task only — no version,
  `lib` entry or emit setting changes.
- **CI integration** in `.github/workflows/ci.yml`: a Playwright browser binary cache
  (`~/.cache/ms-playwright`, alongside the existing `actions/cache@v6` Turborepo step), a
  browser install step, and the golden-generation path. Whether the visual suite runs under the
  existing `test` task or a dedicated Turborepo task in `turbo.json` is a design decision; either
  way it must remain reachable from `pnpm run test` → `turbo run test` so
  `scripts/verify-turbo-ran.mjs` keeps covering it.

### Files and packages touched

`vitest.config.ts`, `pnpm-workspace.yaml`, root `package.json`, `turbo.json`,
`.github/workflows/ci.yml`, `packages/renderers/**` (new test/fixture/golden trees and its
`package.json` devDependencies), and the `vitest`-consuming `package.json` files of
`packages/core` and `apps/playground`. Added by **P8**–**P10**: `tsconfig.base.json` (the
`ES2022` comment **and** the **P11** `ignoreDeprecations` suppression),
`packages/core/test/decimation/allocation-gate.test.ts` and
`packages/core/test/viewport/transform-allocation.test.ts` (the `DEP0152` fix),
`apps/playground/tsconfig.json` (the **P11** `allowImportingTsExtensions` option), and
`eslint.config.js` (the **P11**/**F13** project-association rework). The root `package.json` is
already listed above and additionally carries the **P12** pin correction. Beyond these measured
edits, the residual "any source file the upgrades turn red" set is now small and bounded rather
than open: **F9**, **F10** and **F14** establish that ESLint 10, `@types/node` 26 and the suite
itself need none — see **R10**. `packages/vue` and `packages/react` do not exist yet
(changes 10 and 11) and are not created here. No file under `packages/core/src/**` or
`packages/renderers/src/**` changes: this change adds verification, not rendering behaviour.

## Out of Scope / Deferred

- **WebGL2 goldens and any engine-parity assertion** — change 7 (`renderers-webgl2`). This
  change supplies the fixture keying and the reference corpus; it makes no parity claim.
- **SVG numeric-equivalence checks** — change 6 (`svg-vector-export`). A vector-math problem,
  not a raster one.
- **Cross-browser goldens (WebKit, Firefox)** — Chromium only. Change 5's own empirical
  evidence was measured on Blink; a second engine's goldens are a second corpus and a second
  flake surface for no R1 benefit.
- **Visual regression over `apps/playground`** — this change targets the `packages/renderers`
  contract, not the playground shell.
- **Canvas operation-stream snapshots** as an additional mechanism — the approach **P1**
  considered and rejected (**C20**, **C21**). Not reopened here.
- **A non-default comparator (odiff, looks-same)** — the default comparator path is what this
  change adopts; swapping comparators is a tunable with a real pass/fail impact (**C15**) and
  belongs to a later change with its own measurement.
- **Git LFS** — rejected on **C16**/**C17**; not configured, not deferred to design.
- **Any local golden-update workflow** — excluded by the CI-only constraint below, not deferred.
- **Node-side rasterization as a fast pre-check** — rejected in exploration on fidelity grounds;
  not revisited.
- **`DEP0169` (`url.parse()`)** — emitted during `pnpm install`, but it originates in
  pnpm 9.15.4 itself, not in repository code. **P9** scopes the zero-deprecation rule to warnings
  attributable to repository code, and this one is not. Out of scope, explicitly, not deferred.
- **Any Node runtime version change** — the **P8** audit found `engines` (`>=24`), `.nvmrc`
  (`24`) and `node-version: 24` in both `.github/workflows/ci.yml` and
  `.github/workflows/release.yml` already correct and consistent. Nothing to do.
- **Raising the `ES2022` emit target** — explicitly rejected by **P10**. The target is a
  downstream-browser contract, not a build-host one; only a comment is added.

## Capabilities (Contract for `sdd-spec`)

### New Capabilities

- `browser-visual-regression`: the browser-mode test project and the visual assertion contract.
  Normatively covers: the project is expressed with the Playwright provider through a provider
  factory and declares no `environment` key (**C4**); the rasterizer of record is Playwright's
  Chromium; comparison is a mismatch **ratio** against a declared threshold and **never** byte
  equality (**C14**); a failing comparison emits a diff artefact; and the existing fake-context
  and `happy-dom` projects remain the owners of call-sequence and DOM-shape assertions and are
  not replaced by this one.
- `visual-golden-corpus`: the golden images as a governed artefact. Normatively covers:
  goldens are generated only in the CI environment (`ubuntu-latest`), never captured on a
  developer machine and committed, with **C7** as the stated reason; golden identity is
  OS-scoped, following Playwright's own documented platform-suffixed naming (**C8**); goldens
  are stored as plain git objects with no Git LFS indirection (**C16**, **C17**); and a golden
  update is reviewable as an explicit, intentional act rather than an incidental side effect of
  a test run.
- `render-scenario-fixtures`: the scenario-keyed fixture contract. Normatively covers: a fixture
  is keyed by payload shape, domain, viewport and device pixel ratio and is **never** keyed by
  renderer backend; `dpr` appears as an injected scalar, consistent with the existing
  `resize(width, height, dpr)` surface; and the fixture set is the reuse point for change 7's
  engine-parity claim, so its location and naming are part of the public contract of this change
  rather than a test-internal detail.

### Modified Capabilities

- `test-harness` (base merged from `workspace-test-harness-bootstrap` and `playground-shell`):
  the root `test.projects` array gains a fifth entry that rasterizes in a real browser — the
  first project in this workspace able to produce a pixel. States that the `core`,
  `playground`, `renderers` and `renderers-dom` entries and their environment isolation are
  UNCHANGED, and that the new entry is the sole project that must not declare `environment`.
- `workspace-toolchain` (base merged from `workspace-test-harness-bootstrap`,
  `workspace-guard-scripts-cleanup` and `playground-shell`): the catalog-pinned `vitest` and
  `@vitest/coverage-v8` entries move from the `^3.0.0` line to `5.0.0`, and the new browser-provider
  and Playwright dependencies are added under the same `catalog:` discipline every existing
  member already follows. Records that this crosses a major boundary whose breaking changes land
  on browser mode (**C4**). Also normatively covers the three decisions folded in after the first
  draft: the **P7** freshness policy as a verifiable rule over the whole `catalog:` block, the
  **P8** catalogue targets as exact versions, and the **P10** requirement that `tsconfig.base.json`'s
  `ES2022` target carries a comment stating why it is a downstream-browser contract rather than a
  build-host one. Extended again for **P11** and **P12**: the `ignoreDeprecations` suppression and
  its mandatory cause-and-expiry comment, the playground's `allowImportingTsExtensions` option,
  the rule that the root `package.json` declares `catalog:` for every catalogued dependency rather
  than duplicating a version, and the requirement that type-aware lint coverage of `test/**` and
  `bench/**` survives the TypeScript 6 upgrade.
- `ci-quality-gate` (base merged from `workspace-test-harness-bootstrap` and `playground-shell`):
  the visual suite is covered by the existing no-vacuous-green rule — it must be reachable from
  the Turborepo task graph that `scripts/verify-turbo-ran.mjs` inspects, so a visual suite that
  resolves to zero executed tasks fails CI rather than passing silently. Adds the browser-binary
  cache and install steps as part of the gate rather than as an optional convenience. Also
  normatively covers **P9**: no repository command may emit a Node deprecation warning
  attributable to repository code, with `DEP0169` from pnpm excluded by name.

`openspec/roadmap.yaml` currently records `capabilities: not_yet_specified` for order 5.5. The
three new and three modified names above are what that entry resolves to.

## Constraints

Binding on `sdd-spec` and `sdd-design`. Each is carried from
`preproposal.md` with its evidence.

1. **CI-only golden generation.** Goldens are produced in the CI environment
   (`ubuntu-latest`) and never captured on a developer machine and committed. Reason: **C7** —
   Playwright documents that rendering varies with host OS, hardware and headless mode, and that
   baselines must be compared in the environment that generated them. Development here is macOS.
2. **Threshold-based comparison, never byte-exact.** A test passes when the mismatch **ratio**
   is at or below a declared threshold. Reason: **C14** (deck.gl's production configuration) and
   **C13** (no primary source establishes that rasterized output is bit-reproducible across
   builds, including under SwiftShader).
3. **Plain-git golden storage.** No Git LFS, no external artefact store. Reason: **C16**,
   **C17** — a 214-file, 9.4 MB corpus is carried in a mainstream repository as ordinary git
   objects. This also keeps the change inside CLAUDE.md rule 7's filesystem-only posture.
4. **Scenario-keyed fixtures reusable by change 7.** Keyed by payload, domain, viewport and
   `dpr`; never by backend. Reason: change 7's parity claim is only meaningful if both engines
   are driven by one fixture set.
5. **No withdrawn evidence.** `--disable-gpu`, `--force-device-scale-factor`,
   `--disable-lcd-text` and `--font-render-hinting=none` must not appear as justified
   determinism controls; the Docker-image-for-baselines claim must not be made; and no claim
   should be made about which Vitest version stabilized browser mode. All three are in the
   research's **Withdrawn claims** section.
6. **CLAUDE.md rules are unweakened.** Nothing in `packages/core/src/**` gains a browser global;
   the hot-path allocation ban and its `--expose-gc` zero-GC gate over
   `packages/renderers/src/path/**` continue to run on the existing Node project, which the
   browser project does not replace. No `any` enters the new test or fixture code.
7. **Dependency freshness (P7).** Every catalogued dependency tracks the newest **stable**
   release that is at least **two days old** at the time of the change. Prereleases, release
   candidates and beta dist-tags never qualify. The window is two days, not two weeks: the
   maintainer set it explicitly after seeing that a two-week window would have excluded the
   Vitest 5 line this change depends on. It is also why the `vitest` target is **5.0.0** and not
   `5.0.1`, which was published 2026-09-15 and is younger than the window at the **P8** cutoff
   of 2026-09-14.
8. **Zero repository-caused deprecation warnings (P9).** No repository command may emit a Node
   deprecation warning attributable to repository code. Warnings emitted by a third-party tool
   (`DEP0169` from pnpm) are out of scope.

## Risks

- **R1 — Cross-OS and cross-build rasterization divergence.** No source consulted establishes
  byte reproducibility of rendered output across platforms or builds: Playwright documents
  variance directly (**C7**), and Chromium's SwiftShader documentation is silent on determinism
  (**C13**). Every confirmed project tolerates divergence — by threshold (plotly.js, deck.gl) or
  by not comparing pixels at all (echarts, uPlot). Constraints 1 and 2 mitigate this; they do
  not eliminate it. Residual exposure: a Chromium version bump inside a Playwright upgrade can
  shift antialiasing and invalidate the whole corpus at once.
- **R2 — Flake budget.** A threshold loose enough to absorb antialiasing jitter is a threshold
  that can mask a small real regression; a threshold tight enough to catch one produces
  intermittent red on unchanged code. Text-heavy regions (axis labels) are the worst of it,
  since font rasterization is where platform divergence concentrates. Whether label regions are
  asserted at a different tolerance from the trace geometry is an open design question, not a
  detail to be defaulted into.
- **R3 — Blast radius of the Vitest major upgrade.** Two majors, with v4's breaking changes
  landing on browser mode itself (**C4**), applied across a workspace whose root config encodes
  two non-obvious 3.2.7 behaviours. Both have now been re-measured against 5.0.1 in an isolated
  bench; see `toolchain-probe.md`. Result:

  - Vitest 5 removed `poolOptions` from the config type and promoted `execArgv` to a direct
    member of the test config object. The current top-level `poolOptions.forks.execArgv` hoist
    therefore **stops being read** on 5.x — it is not renamed with a warning (**F2**). Rewriting
    that block is a required upgrade task, not an optional cleanup (**F3**).
  - The 3.2.7 limitation that forced the hoist is fixed: a project-scoped `execArgv` propagates
    correctly on 5.x (**F4**). The same holds for relative project `root` resolution under
    Turborepo's cwd (**F7**). Both workarounds are obsolete, and their explanatory comments would
    otherwise describe behaviour that no longer exists.
  - This risk was originally worded as a *silent* regression. That is incorrect and the
    correction matters: repository tests assert the flag's effect rather than skipping without it
    (`packages/core/test/viewport/transform-allocation.test.ts:17`,
    `packages/core/test/decimation/allocation-gate.test.ts:20`,
    `packages/renderers/test/node/allocation-gate.test.ts:66`), and a misresolved project root
    exits non-zero rather than passing vacuously. The failure mode is loud, with a known fix
    (**F5**, **F8**). R3 is downgraded accordingly.
- **R4 — CI wall-clock and cache cost.** A browser binary download and headless execution are
  added to a job that currently installs, restores a Turborepo cache and runs three Turborepo
  tasks. The binary cache mitigates the download on warm runs but not the cold run, nor the
  browser start-up and rasterization time per scenario. Cost scales with the number of
  scenarios, and the fixture set is the thing change 7 will want to grow.
- **R5 — Corpus churn as review noise.** PNGs do not diff readably. A reviewer can see that a
  golden changed but not why, which puts real weight on the golden-update path being an explicit
  and reviewable act (a `visual-golden-corpus` requirement above) rather than a byproduct of a
  test run.
- **R6 — Evidence freshness.** The research's source files were fetched from `main`/`master`
  rather than a tagged release, and it states that any design depending on an exact flag list
  should re-verify against the version actually installed. The inherited-flags argument
  (**C10**, **C11**) should be confirmed against the Playwright version this change pins.
- **R9 — Four simultaneous majors make a regression hard to attribute.** **P8** folds
  `typescript` 5.7 → 6.0.3, `eslint` 9.17 → 10.10.0 and `@types/node` 22 → 26.5.1 into a change
  that was already crossing `vitest` 3 → 5, and does so in the same PR as a new test mechanism
  and a public-API font default. A red CI run after all of them land cannot, by itself, say which
  one caused it. The maintainer was told this and chose to fold the work in anyway
  (**P8**), so the mitigation is sequencing, not scope: `design.md` **D8** must order the
  upgrades so that each major lands alone with a binary exit criterion, and the PR must not be
  squashed. Note that the risk ids **R7** and **R8** are already taken by `design.md`'s own new
  risks; this proposal continues at **R9** to keep the two id spaces disjoint.
- **R10 — measured: the ESLint 10 half is a non-event; the TypeScript 6 half costs exactly three
  known edits.** This risk was written speculatively and has since been executed.
  `toolchain-probe.md` part 2 ran the whole **P8** upgrade against a detached `git worktree` of
  `HEAD` (`4cb0872`), changing one variable at a time and attributing every failure. What it
  established supersedes the speculative framing below:

  - **ESLint half: CLOSED (F9).** With `typescript` held at `5.9.3`, `eslint@10.10.0` plus
    `typescript-eslint@8.70.0` runs `pnpm exec turbo run lint` to completion with **zero
    problems** and **no source or config edits**. None of the three new `eslint:recommended`
    rules (`no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`) fires on this
    codebase, and the flat config at `eslint.config.js` needs no migration. The upward
    config-lookup change is likewise a non-event: the single root `eslint.config.js` resolves for
    every package running `eslint .`.
  - **`@types/node` half: CLOSED (F10).** Both `26.5.1` and `26.6.1` were installed; neither
    changed any outcome. See **R11**, which is correspondingly narrowed.
  - **TypeScript half: KNOWN, not open.** `typescript@6.0.3` costs exactly three edits, each
    measured, each with a verified fix, and all three are now named in §Scope under **P11**:
    `TS5101` from `tsup`'s hardcoded `baseUrl` on `turbo run build`, fixed by
    `"ignoreDeprecations": "6.0"` in `tsconfig.base.json` (**F11**); three `TS5097` diagnostics on
    `turbo run typecheck`, fixed by `"allowImportingTsExtensions": true` in
    `apps/playground/tsconfig.json` (**F12**); and 29 false type-resolution errors on
    `turbo run lint`, caused by TypeScript 6 breaking `typescript-eslint`'s `projectService`
    `defaultProject` fallback, fixed by reshaping how `eslint.config.js` gives `test/**` and
    `bench/**` a TypeScript project (**F13**). `pnpm run test` reports 293 tests passing with the
    whole upgrade applied (**F14**).
  - **Residual.** The edit list is no longer an unknown; it is a list of three. What remains open
    is only the *shape* of the **F13** fix — classic `parserOptions.project` was verified to exit
    `0`, but the association strategy is a design decision — and the ordinary possibility that
    combining the three with the other commits surfaces something the single-variable probe could
    not. The TypeScript 7 rejection recorded below stands unchanged.

  The original speculative text is retained below because the TypeScript 7 rejection it records
  is still binding:

  Both an ESLint major and a TypeScript major sit under
  `pnpm exec turbo run typecheck` / `lint`, which run across `packages/core`,
  `packages/renderers` and `apps/playground`. What was verified against the published packages,
  rather than assumed:

  - **`typescript@7.0.2`, the first pass's target, was rejected by measurement, not by reading
    a peer range.** `typescript-eslint@8.70.0` declares `peerDependencies.typescript` as
    `>=4.8.4 <6.1.0` — 8.70.0 is its newest release, and every published `8.70.1-alpha.*`
    declares the identical range, so no released `typescript-eslint` accepts TypeScript 7.
    Forcing the install past the peer conflict does not degrade gracefully: `eslint` exits with
    a hard error thrown from `typescript-eslint/dist/index.js` — `typescript-eslint does not
    support TS 7.0.` — pointing at upstream issue 10940, which tracks support for TS **>=7.1**.
    This repository's `eslint.config.js` is entirely `tseslint.configs.recommendedTypeChecked`
    with `parserOptions.projectService`; type-aware linting is what enforces CLAUDE.md rule 1
    (no `any` in production code), and it cannot be traded away for a compiler major.
  - **`typescript@6.0.3` is the adopted target.** Verified in an isolated install:
    `typescript@6.0.3` + `eslint@10.10.0` + `typescript-eslint@8.70.0` resolves with no peer
    conflict, and `eslint` exits 0 on a type-checked source file. `design.md` **D11** records
    this as confirmed by measurement. TypeScript 7 stays out of scope for this change and stays
    out until `typescript-eslint` ships support for it.
  - **ESLint 10 adds three rules to `eslint:recommended`** — `no-unassigned-vars`,
    `no-useless-assignment` and `preserve-caught-error` — which `recommendedTypeChecked`
    inherits, and it also makes config lookup start from each linted file's directory rather than
    the cwd. Both were expected to produce work. **F9 measured neither: no rule fires and the
    single root config resolves.** This bullet is retained as the record of what was anticipated
    and did not happen.

  What was written here as unverifiable — "the concrete set of source or config edits ESLint 10 or
  the TypeScript 6 bump will actually require" — has now been measured rather than deferred to
  apply time. It is zero for ESLint 10 (**F9**) and exactly three for TypeScript 6
  (**F11**, **F12**, **F13**). No migration step is invented here; all four statements are
  observations from `toolchain-probe.md` part 2.
- **R11 — `@types/node` jumps four majors, 22 → 26.** The catalogue currently describes Node 22
  while every runtime declaration pins Node 24, so the bump corrects a real mismatch rather than
  chasing a version. Four majors of ambient Node declarations is still the largest single-package
  type-surface move in this change, and it lands under `noUncheckedIndexedAccess` and `strict`.
  Two specifics were verified: `@types/node@26.5.1` exists and was published 2026-09-09
  (inside the **P7** window against the **P8** cutoff of 2026-09-14, unlike 26.6.0/26.6.1 which
  were published 2026-09-15); and the package's `latest` dist-tag is **22.20.3**, not a 26.x
  version, so "newest stable" cannot be read off `latest` for this package — which is a direct
  input to how **P7** is enforced mechanically (`design.md` **D9**). The two files this change
  already touches for **P9** are themselves `@types/node` consumers
  (`node:perf_hooks`'s `PerformanceEntry`), so the `DEP0152` fix and this bump interact.
  **Measured down (F10):** both `26.5.1` and `26.6.1` were installed against a detached worktree
  of `HEAD` and neither produced a single diagnostic. The residual is the interaction with the
  other commits in the sequence, not the type surface itself.
- **R12 — the `ignoreDeprecations: "6.0"` suppression unblocks TypeScript 6 and blocks
  TypeScript 7.** The fix **F11** requires is a deprecation suppression with a known expiry: the
  `ignoreDeprecations` option stops functioning entirely in TypeScript 7, so the same line that
  makes `pnpm exec turbo run build` pass at `6.0.3` will make it fail at `7.x`. The cause is
  external and unfixed upstream — `tsup` hardcodes `baseUrl` at `tsup/dist/rollup.js:6837`, and
  `tsup@8.5.1` (2025-11-12) is its newest published release. The consequence is that this
  repository cannot reach TypeScript 7 until `tsup` stops hardcoding `baseUrl` (or is replaced as
  the declaration builder), **independently of** the `typescript-eslint` support question tracked
  in **R10**. Two separate upstream projects now gate the same future upgrade, and clearing only
  one of them is not enough. Mitigation is documentary, not technical: **P11** requires the
  suppression to carry a comment naming `tsup` as the cause and stating the expiry, so the next
  reader attempting TypeScript 7 finds the second gate before spending an afternoon on the first.
  (Numbering note: this proposal's id space continues at **R12**. `design.md`'s primed `R12'` is
  an unrelated design-owned risk about the `5.0.1`/`5.0.0` measurement gap; the two spaces are
  deliberately disjoint and coincide numerically by accident.)

## Open Questions for `sdd-design`

1. **Fixture schema.** Exact shape and location of a scenario record — its payload description,
   domain, viewport, `dpr` — and whether it lives under `packages/renderers/test/` or somewhere
   a future WebGL2 suite imports without reaching into another package's test tree.
2. **Comparator and thresholds.** Which comparator (the default `pixelmatch` path per **C2**,
   or a pluggable one), and what `threshold` / `allowedMismatchedPixelRatio` values —
   deck.gl's `{threshold: 0.105, includeAA: true}` (**C14**) is a starting reference, not a
   transplant, and **C15** is the warning that these numbers do not port across comparators.
3. **Golden naming and OS-suffix policy.** Whether to adopt Playwright's platform-suffixed
   convention verbatim (**C8**) or a narrower one, given that constraint 1 means only one
   platform ever generates goldens — an OS suffix on a single-platform corpus is either useful
   forward compatibility or dead ceremony, and design should say which.
4. **Where the browser project sits in `vitest.config.ts`.** Placement in the `projects` array,
   its `include` glob relative to the existing `test/node/**` and `test/dom/**` split, and how
   the provider factory coexists with the top-level `pool: "forks"` / `execArgv` block that the
   config's own comments say must stay at top level.
5. **Task wiring.** Whether the visual suite runs under the existing `test` task or a dedicated
   `turbo.json` task, and how `scripts/verify-turbo-ran.mjs` covers it either way.
6. **Golden update mechanism.** How a golden is regenerated and landed given constraint 1 — a
   CI artefact a developer commits, a workflow-dispatch job that opens a commit, or a
   label-gated CI path — and how that act stays reviewable (R5).
7. **Assertion scope per scenario.** Whole-canvas at one tolerance, or geometry (grid, stroke)
   tightly and text regions loosely, using the masking/clipping options the assertion surface
   exposes (**C6**). R2 is the reason this cannot be defaulted.
8. **Upgrade sequencing.** The order in which the four majors, the `DEP0152` fix and the
   `ES2022` comment land relative to each other and to the browser project, such that a red run
   is attributable to exactly one of them (**R9**). Each major must land alone with its own
   binary exit criterion.
9. **Enforcing the P7 freshness policy mechanically.** Whether "newest stable, at least two days
   old" is a script, a CI check or a documented manual procedure — given that `@types/node`'s
   `latest` dist-tag does not point at its newest stable release, a naive `npm view <pkg> version`
   implementation would be wrong for at least one catalogued dependency.
10. **`@types/node` 26 against the `lib` settings.** How the bump interacts with
    `lib: ["ES2022"]` in `packages/core/tsconfig.json` and `lib: ["ES2022", "DOM"]` in
    `packages/renderers/tsconfig.json`, both of which deliberately omit `ESNext`.
    **Resolved** by `design.md` **D10**: `typescript@6.0.3` ships `lib.*.d.ts` inside the
    `typescript` package itself, so both arrays resolve unchanged.
11. **Type-aware linting under TypeScript 7.** What happens to
    `tseslint.configs.recommendedTypeChecked` when no released `typescript-eslint` declares
    TypeScript 7 support (**R10**) — and which of the two versions gives way if they prove
    incompatible. **Resolved** by `design.md` **D11**, confirmed by measurement: TypeScript 7
    is dropped in favour of `typescript@6.0.3`, which resolves cleanly against
    `typescript-eslint@8.70.0` and keeps type-aware linting intact. **Further resolved** by
    **F9** and **F13**: `eslint@10.10.0` + `typescript-eslint@8.70.0` is clean at `typescript`
    `5.9.3` and needs no config migration, but at `6.0.3` the `projectService` `defaultProject`
    fallback breaks and must be replaced — type-aware linting survives the compiler bump, but not
    in its current configuration shape. `design.md` **D13** owns the replacement.
12. **How `test/**` and `bench/**` get a TypeScript project under TypeScript 6.** Raised by
    **F13** after the probe. `eslint.config.js` currently relies on `projectService`'s
    `defaultProject` fallback for every file in those trees; TypeScript 6.0.3 breaks it, and
    classic `parserOptions.project` pointed at `packages/core/tsconfig.test.json` was verified to
    exit `0`. The constraint on any answer is that full type-aware coverage of both trees is
    retained. **Open** — `design.md` **D13** records the recommendation and is marked
    `proposed — awaiting maintainer confirmation`.
13. **Nothing further on the ESLint 10 migration.** **Resolved** by **F9**: there is no migration.
    `pnpm exec turbo run lint` is green at `eslint@10.10.0` with no edits, so no question about
    rule fallout or config-lookup behaviour remains for design to answer.

## Delivery

One PR. Delivery strategy is `exception-ok`: the maintainer accepted a `size:exception` up front
rather than chaining slices, because the pieces are not independently meaningful — the browser
project cannot exist before the Vitest upgrade, the goldens cannot exist before the project, and
the upgrade landing alone would leave the workspace on a major bump with nothing using what it
was bumped for.

Versioning follows CLAUDE.md rule 8: a Changesets `patch` bump within the `0.0.x` series.
