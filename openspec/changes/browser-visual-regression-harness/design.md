# Technical Design: browser-visual-regression-harness

> Change **order 5.5** of the roadmap. Prerequisite: change 5 (`renderers-canvas2d`, archived at
> `openspec/changes/archive/2026-09-16-renderers-canvas2d/`). Consumer: change 7
> (`renderers-webgl2`).
>
> Settled inputs, **not reopened here**: `preproposal.md` decisions **P1**–**P10**.
> Normative surface: the six delta specs under
> `openspec/changes/browser-visual-regression-harness/specs/` (65 MUST requirements, after the
> four added by **P7**–**P10**).
> Evidence: `research.md` claims **C1**–**C22** (its *Withdrawn claims* section is binding and is
> cited nowhere below) and `toolchain-probe.md` findings **F1**–**F8**.
>
> This document resolves the eleven questions `proposal.md` §"Open Questions for `sdd-design`"
> left open. It does not restate the proposal's motivation.
>
> **Amendment, 2026-09-16.** `preproposal.md` revision 4 added decisions **P7** (dependency
> freshness), **P8** (toolchain modernisation folded into this change), **P9** (zero
> repository-caused deprecation warnings) and **P10** (document the `ES2022` build target).
> **D8** is rewritten to sequence the two additional majors they bring; **D9**–**D12** are new.
> **D1**–**D7** are untouched.
>
> **Vitest target correction.** Everywhere below, the Vitest target is the exact version
> **5.0.0**, not `5.x` and not `5.0.1`. `toolchain-probe.md` measured `5.0.1`, which fails the
> **P7** two-day freshness window at the **P8** cutoff. Same minor line, but findings **F2**,
> **F3** and **F4** are measurements against `5.0.1` and MUST be re-confirmed against `5.0.0` at
> apply time before the config migration below is treated as proven.
>
> **D1–D12 are all `confirmed` as of 2026-09-16.** D1 (Inter as the shipped default font) and
> D5 (per-package `--project` filters) were put to the maintainer individually, since both are
> load-bearing beyond this change; both were approved. D11 was settled by measurement rather
> than by preference: the throwaway install it called for was run, and TypeScript 7 failed with
> a hard error from `typescript-eslint`, so the target is `typescript@6.0.3`. D9 was decided
> against its own recommendation — the maintainer chose manual enforcement over a script.
> await maintainer confirmation.**
> D1 (Inter as the shipped default font) and D5 (per-package `--project` filters) were put to the
> maintainer individually, since both are load-bearing beyond this change; both were approved. Each carries a stable
> id **D1**–**D12** so it can be approved or challenged individually. None of them is a done deal;
> the recommendation is stated concretely (a named font, a numeric threshold, an exact path) so
> that a maintainer is evaluating a specific proposal rather than a menu.

---

## Decision summary

| id | Question | Recommendation (one line) | Reversibility |
|---|---|---|---|
| **D1** | Default font | Subset **Inter Regular** WOFF2, family `"TraceKit Inter"`, base64-embedded in a side entry `@trace-kit/renderers/font`; `DEFAULT_FIGURE_STYLE.font` becomes `10px "TraceKit Inter"`; one `patch` changeset for `@trace-kit/renderers`. | **Load-bearing** (public default output) |
| **D2** | Comparator + threshold | Default `pixelmatch`, one global config: `{ threshold: 0.1, includeAA: true, allowedMismatchedPixelRatio: 0.001 }`; no per-scenario override at landing. | Cheap (two numbers in one object) |
| **D3** | Golden naming + location | `packages/renderers/test/visual/__screenshots__/<scenarioId>.png`, flat, **no** platform or browser token, enforced by a custom `resolveScreenshotPath`. | Cheap (one callback + `git mv`) |
| **D4** | Browser project placement | Fifth entry, last in `test.projects`, `name: "visual"`, root `packages/renderers`, `include: ["test/visual/**/*.test.ts"]`, `browser.provider: playwright()`, no `environment`, no `execArgv`. | Cheap |
| **D5** | Turborepo wiring | New `test:visual` task in `turbo.json`; root `test` gains `dependsOn: ["test:visual"]`; per-package `test` scripts gain `--project` filters; new CI guard step `verify-turbo-ran.mjs test:visual`. | Moderate |
| **D6** | Golden update | Dedicated `workflow_dispatch` job `update-visual-goldens` on `ubuntu-latest` that runs the suite with `--update` inline. Dispatched against a feature branch, it pushes the resulting PNGs directly onto that branch (part of that PR's own diff); dispatched against `main`, it opens a separate, reviewable PR whose only changed paths are under `__screenshots__/`. Corrected at apply time: the first pass always opened a PR into `main`, contradicting this decision's own stated intent. | Cheap |
| **D7** | Per-scenario assertion scope | Whole-canvas at one tolerance for all five scenarios; **no** `mask` at landing; masking documented as the escape hatch if R2 materialises. | Cheap |
| **D8** | Upgrade sequencing | **Ten** ordered commits in one PR, each major alone with a binary exit criterion: DEP0152 fix → `ES2022` comment → root `typescript` pin → `catalog:` (**P12**) → `@types/node` 26 → ESLint 10 (measured edit-free, **F9**) → TypeScript 6.0.3 **+ its three measured fixes** (**F11**/**F12**/**F13**) → Vitest 5.0.0 + config migration → minor/patch refresh → font default → harness. | N/A (process) |
| **D9** | Enforcing P7 freshness | A `scripts/check-dependency-freshness.mjs` node script driven by a `cutoff` date, reading published stable releases from the registry (never the `latest` dist-tag), run as an explicit CI step and as `pnpm run check:freshness`. | Cheap (delete one script + one step) |
| **D10** | `@types/node` 26 × `lib: ["ES2022"]` | Leave both packages' `lib` arrays exactly as they are; no `ESNext`, no `"types"` narrowing. `typescript@6.0.3` ships `lib.es2022.d.ts` and `lib.dom.d.ts` inside the `typescript` package itself, so the arrays keep resolving. | Cheap (one array per package) |
| **D11** | Type-aware linting under TypeScript 7 | **Confirmed by measurement.** `typescript@7.0.2`, the first pass's catalogue target, is rejected: `typescript-eslint@8.70.0` (its newest release) declares `peerDependencies.typescript` as `>=4.8.4 <6.1.0`, and forcing past the conflict makes `eslint` exit with a hard error from `typescript-eslint/dist/index.js` (`typescript-eslint does not support TS 7.0.`, tracked by upstream issue 10940 for TS >=7.1). The P8 target is corrected to `typescript@6.0.3`, verified in an isolated install to resolve cleanly against `eslint@10.10.0` and `typescript-eslint@8.70.0` with `eslint` exiting `0` on a type-checked file. TypeScript 7 is out of scope until `typescript-eslint` ships support for it — and now also until `tsup` stops hardcoding `baseUrl` (**R12**), a second, independent gate. `6.0.3` is not free: it costs three measured fixes (`ignoreDeprecations` **F11**, `allowImportingTsExtensions` **F12**, the `eslint.config.js` rework **F13**/**D13**). `typescript@5.9.3` was offered as the zero-cost alternative and declined (**P11**). | **Resolved** (target corrected, not dropped; its three costs recorded) |
| **D12** | Enforcing P9 | A CI step that runs the four verification commands with warnings visible and fails on any `DEP####` line not on a short, named third-party allowlist (`DEP0169`/pnpm). No global suppression flags. | Cheap |
| **D13** | `test/**` + `bench/**` project association under TypeScript 6 | Replace `projectService` with classic `parserOptions.project` for those globs, pointed at the existing `packages/core/tsconfig.test.json` (and `packages/renderers/tsconfig.test.json`); `src/**` stays on `projectService`. Full type-aware coverage retained. | **`confirmed`** — settled by measurement (F17): the two alternatives were run and both fail, so this is the only shape that works. Cheap to reverse (one `parserOptions` block). |

---

## Context & Background

`renderers-canvas2d` shipped `Canvas2DRenderer` with no test that asserts a painted pixel and
recorded that as its Risk R1. Neither of the two `packages/renderers` Vitest projects can close it
by construction: `renderers` runs `environment: "node"` (no canvas), and `renderers-dom` runs
`happy-dom`, whose `getContext("2d")` returns `null` (`packages/renderers/test/dom/null-context.test.ts`).
This change adds the first project in the workspace that can produce a pixel, and the fixture set
change 7 needs in order for "WebGL2 paints what Canvas2D paints" to be an assertion rather than a
sentence.

Three repository facts shape the decisions below, and two of them are not in the proposal.

1. **The renderer never reads a font off the DOM.** `packages/renderers/src/style.ts:39` holds
   `font: "10px sans-serif"` as a frozen string, `packages/renderers/src/canvas2d/axes.ts:109`
   assigns it to `context.font`, and `axes.ts:29` parses only the leading `<n>px` out of it to
   compute gutters. The font is therefore pure configuration data — swapping the family changes
   one string literal and nothing else in the paint path. What it does **not** do is make the
   family *available*: `context.font` is a request, and an unregistered family silently falls back.
   D1 has to ship a registration path, not just a new default string.

2. **Every package's `test` script currently runs the whole workspace suite.**
   `packages/renderers/.turbo/turbo-test.log` shows `@trace-kit/renderers@ test` executing
   `|core|`, `|playground|` and `|renderers|` files, because `vitest run` walks up to the root
   `vitest.config.ts` and runs all four projects. `apps/playground/package.json:11` is the one
   package that already filters (`--project playground`). Adding a browser project to the root
   config would therefore launch Chromium **three** times per CI run, not once. D5 fixes this as a
   precondition rather than absorbing the cost.

3. **The vacuity guard matches on the task *name*.** `scripts/verify-turbo-ran.mjs` passes only
   when some planned task with a runnable command has `task === <requested name>`. A `test:visual`
   task that `test` depends on is *not* covered by `verify-turbo-ran.mjs test` — the guard would
   see `test` runnable and exit 0 while `test:visual` was vacuous. D5 adds a second guard
   invocation rather than assuming transitive coverage.

---

## Goals & Non-Goals

**Goals**

- Close R1: at least one assertion whose failure mode is "the renderer painted the wrong pixels".
- Produce a reference corpus and a backend-agnostic fixture set that change 7 imports unchanged.
- Cross the Vitest 3→5 boundary with the existing suite demonstrably green before any new test
  mechanism is introduced.
- Remove font substitution as a divergence source at the library level (**P5**, **P6**).

**Non-Goals**

- Any WebGL2 golden, or any parity assertion (change 7).
- Cross-browser or cross-OS corpora (**P5**).
- A non-default comparator (deferred with its own measurement).
- Any change to `packages/core/src/**` or to the rendering logic in `packages/renderers/src/**`
  other than the single default-font string and the new font asset module.

---

## Architecture & Data Flow

```text
packages/renderers/src/fixtures/scenarios.ts      <- SHIPPED (not under test/), backend-agnostic
        |  ScenarioFixture { id, description, payload, domain, viewport, dpr }
        |
        +-----------------------------+------------------------------------+
        |                             |                                    |
        v                             v                                    v
  test/visual/*.test.ts        (change 7) webgl2 suite              future SVG parity
        |
        | 1. document.createElement("canvas")   <- real Chromium, Playwright provider
        | 2. await ensureDefaultFont()          <- FontFace registration, see D1
        | 3. new Canvas2DRenderer({ surface, style: DEFAULT_FIGURE_STYLE })
        | 4. renderer.resize(viewport.w, viewport.h, fixture.dpr)
        | 5. renderer.setData(payload) / setDomain(domain) / draw()
        | 6. await expect(canvas).toMatchScreenshot(fixture.id)
        v
  pixelmatch  (threshold 0.1, includeAA, allowedMismatchedPixelRatio 0.001)
        |
        +-- pass -> nothing written
        +-- fail -> diff PNG at test/visual/__screenshots__/__diffs__/<id>.png, path reported
```

Buffer discipline: a fixture's `payload` is a `Float64Array`/`Float32Array` constructed **once**
at module scope and handed to `setData` by reference. Fixture modules allocate at import time
only; nothing in a visual test allocates inside a draw. There is no worker and no
`postMessage` in this change, so no `Transferable` handoff is introduced — the zero-copy rule is
satisfied by not copying rather than by transferring. The `--expose-gc` allocation gates that
enforce CLAUDE.md rule 2 stay exactly where they are, on the `core` and `renderers` Node projects
(D4).

Engine strategy is untouched: this change adds no renderer. All five scenarios are Canvas2D
(`< 80,000` points by construction — the largest is the decimation case at 200,000 input points
decimated to a plot-width-derived index set, which is the *input* to the Canvas2D path, not a
reason to select WebGL2). The threshold that selects WebGL2 is change 7's and change 9's concern;
the fixture schema deliberately carries no engine field (D7, and `render-scenario-fixtures`'
"no backend field" requirement) precisely so that selecting an engine is never a property of a
scenario.

Reactivity isolation is not exercised here: `packages/vue` and `packages/react` do not exist yet
(changes 10 and 11). The relevant forward constraint is that `ScenarioFixture` is a frozen plain
object holding typed arrays by reference, so when a framework wrapper eventually consumes one it
must be held behind `shallowRef`/`markRaw` (Vue) or `useRef` (React) — a deep proxy over a
`Float64Array` would be a per-element trap installation. This is recorded in the fixture module's
doc comment so change 10/11 inherit the constraint rather than rediscovering it.

---

## Technical Decisions

### D1 — The default font

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.**

1. **Font**: **Inter**, Regular (weight 400), static instance (not the variable font), licensed
   SIL Open Font License 1.1.
2. **Format**: a single **WOFF2**, subset to `U+0020–U+007E` plus `U+00B5` (µ), `U+00D7` (×),
   `U+2212` (−) and `U+03A9` (Ω).
3. **Family name**: declared as **`TraceKit Inter`**, not `Inter`. A consumer who already loads
   their own `Inter` at a different version or subset must not silently repaint TraceKit's labels.
4. **Embedding**: the WOFF2 is base64-encoded into a TypeScript module as a `data:font/woff2`
   URL string, and exposed through a **second tsup entry** so it is not pulled into the main
   bundle for consumers who override `font`:

   | file | contents |
   |---|---|
   | `packages/renderers/src/font/tracekit-inter.woff2.ts` | `export const TRACEKIT_INTER_WOFF2_DATA_URL = "data:font/woff2;base64,…";` (generated, committed) |
   | `packages/renderers/src/font/index.ts` | `TRACEKIT_INTER_FAMILY`, `ensureDefaultFont()` |

   `tsup.config.ts` gains `entry: ["src/index.ts", "src/font/index.ts"]`, and `package.json`
   `exports` gains a `"./font"` subpath. The main `src/index.ts` re-exports **only**
   `TRACEKIT_INTER_FAMILY` (a string constant) — never the data URL — so `import "@trace-kit/renderers"`
   does not drag the font bytes in.
5. **Registration**: `ensureDefaultFont()` lives in `src/font/index.ts` and is the *only* module
   in the package that touches a browser global:

   ```ts
   export async function ensureDefaultFont(): Promise<boolean> {
     const target: FontFaceSet | undefined =
       typeof globalThis.document !== "undefined" ? globalThis.document.fonts : undefined;
     if (target === undefined) return false;          // Node / SSR: no-op, no throw
     if (target.check(`10px "${TRACEKIT_INTER_FAMILY}"`)) return true;
     const face = new FontFace(TRACEKIT_INTER_FAMILY, `url(${TRACEKIT_INTER_WOFF2_DATA_URL})`);
     await face.load();
     target.add(face);
     return true;
   }
   ```

   It is `async`, idempotent, returns `false` instead of throwing off-DOM, and is **never called
   by `Canvas2DRenderer`**. The renderer stays synchronous and stays callable from a worker.
6. **Default string**: `packages/renderers/src/style.ts:39` becomes
   `font: '10px "TraceKit Inter"'` — no generic fallback appended, per the
   `visual-golden-corpus` requirement that the resolved family must not be a generic keyword.
7. **Override**: unchanged and already sufficient — `FigureStyle.font` is a plain `readonly string`
   on a frozen object; a consumer passes `style: { ...DEFAULT_FIGURE_STYLE, font: "12px monospace" }`.
   No new API. The `A Consumer May Override the Default Font` requirement needs no code, only a
   test.
8. **Byte cost**: the subset above is ~95 glyphs. Expected WOFF2 payload **10–16 KB**, base64
   inflating it to **14–22 KB** of JavaScript in the `./font` entry only. A **hard budget of
   24 KB for the emitted `dist/font/index.js`** is asserted by a size test, so the real figure is
   measured at apply rather than asserted here. `dist/index.js` must not grow by more than the
   one added string constant.
9. **Changeset**: **yes — one `patch` changeset for `@trace-kit/renderers`**, per CLAUDE.md rule 8
   (`0.0.x`, patch-only pacing). Its body must state plainly that the **default rendered output
   changes for every consumer who does not override `font`**. In a post-1.0 world this is a major;
   under rule 8 the version pacing is fixed and the honesty has to live in the changelog text.
   No changeset for the test harness itself — it ships no consumer-visible change.

**Why.**

- CLAUDE.md rule 5 binds `@trace-kit/core` only; `packages/renderers` is already a DOM package
  (archived `renderers-canvas2d` design §D9). The constraint that does apply is that
  `Canvas2DRenderer` must stay worker-safe — it is constructed from `OffscreenCanvas`
  (`packages/renderers/src/surface.ts:7`) — which is why registration is a separate, opt-in,
  `document`-guarded module and not a renderer lifecycle step.
- Base64 embedding over a shipped `.woff2` asset file: a binary asset in `dist/` requires every
  downstream bundler to be configured for font emission and requires a runtime URL that resolves
  correctly under a CDN, a Vite dev server and a Node SSR build. A data URL has none of those
  failure modes and `FontFace` accepts it directly. The cost is the ~33% base64 inflation and the
  fact that the font cannot be HTTP-cached separately — acceptable at a 24 KB ceiling behind a
  subpath export.
- Inter over the alternatives: OFL-licensed, designed for UI at small sizes, and its static
  Regular instance has no variable-axis interpolation for a Chromium version bump to shift. It is
  also what the label use-site needs — `axes.ts:29` parses `10px`, so a face that is legible at
  10 CSS px is the whole requirement.
- The family rename is not cosmetic: `document.fonts.check()` would report a consumer's own
  `Inter` as present and `ensureDefaultFont()` would no-op, painting goldens with a font TraceKit
  never shipped.

**Alternatives rejected.**

| Alternative | Concrete cost that ruled it out |
|---|---|
| Keep `10px sans-serif`, mask label regions in the diff instead | Directly contradicts **P5**/**P6**, which were confirmed after this exact tradeoff was put to the maintainer. Also concedes that axis labels are never visually asserted — the one region where a wrong `fillStyle` or `textBaseline` is most likely. |
| Ship the `.woff2` as a `dist/` asset + `exports["./font.woff2"]` | Pushes bundler/asset-pipeline configuration onto every consumer; breaks under SSR and under any consumer not using a bundler that rewrites asset URLs. |
| Variable Inter (`InterVariable.woff2`) | Larger (~300 KB unsubset), and a variable instance is one more thing whose rasterization can shift across Chromium builds. No benefit at a single fixed 10px/400 use-site. |
| A monospace face (Roboto Mono, IBM Plex Mono) for tabular tick digits | Real benefit — constant advance width for numeric labels — but the gutter computation (`axes.ts:42–46`) derives insets from font *size*, never from measured text width, so label-width jitter has no layout consequence today. Not worth a wider, heavier face. |
| DejaVu Sans (the Linux default the goldens would otherwise get) | Choosing the library default to match one CI image's substitution result is backwards: it makes the corpus stable for the wrong reason and ships a dated face to every consumer. |
| Register the font inside `Canvas2DRenderer`'s constructor | Makes construction async or makes the first frame race the font load, and breaks the `OffscreenCanvas`/worker path where `document` does not exist. |

**Reversibility: load-bearing.** Everything except the font *choice* is cheap — the embedding
mechanism, the family name and the override path are all one module. The choice itself is the
public default visual output, and changing it later invalidates the entire golden corpus in one
commit and changes every consumer's charts a second time. This is the decision on this page most
worth challenging before it lands.

---

### D2 — Comparator and threshold

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.** Keep Vitest's default comparator, `pixelmatch` (**C2**). Declare it once,
globally, on the browser project:

```ts
expect: {
  toMatchScreenshot: {
    comparatorName: "pixelmatch",
    comparatorOptions: {
      threshold: 0.1,
      includeAA: true,
      allowedMismatchedPixelRatio: 0.001,
    },
  },
},
```

No per-scenario override, no per-scenario threshold table, at landing. `allowedMismatchedPixels`
is deliberately **not** set: the spec requires a ratio, and pixelmatch applies whichever of the
two limits is stricter, so setting both would make the effective rule viewport-dependent.

**Why.**

- `threshold` and `allowedMismatchedPixelRatio` are exactly the two axes the `browser-visual-regression`
  spec's "mismatch ratio against a declared threshold, never byte equality" requirement demands,
  and both are documented config keys on the v5 assertion (**C2**).
- `threshold: 0.1` with `includeAA: true` is deck.gl's production configuration to within rounding
  (`{threshold: 0.105, includeAA: true}`, **C14**) and is also pixelmatch's own documented default
  per-pixel tolerance. Adopting the number the only measured precedent uses is a better starting
  point than a number invented here, and **C15** is the reason not to port it to a *different*
  comparator — it is not a reason to deviate from it on the same one.
- `allowedMismatchedPixelRatio: 0.001` is the number this design actually invents, so its basis
  is stated explicitly: at the largest fixture viewport (D7: 800×400 CSS px at `dpr: 2` =
  1,280,000 device pixels) it permits **1,280 differing pixels**. The five scenarios' text is a
  handful of short tick labels; 1,280 pixels is roughly the antialiasing perimeter of the whole
  label set, and far below the area of any real regression this suite exists to catch — a wrong
  `strokeStyle` repaints the entire trace, a wrong paint order repaints the background, a missing
  `stroke()` removes it. There is no regression class in scope whose pixel footprint is *smaller*
  than its own antialiasing perimeter.
- Non-zero by construction, satisfying the spec scenario that a byte-identical render must still
  pass *through* the ratio comparison rather than short-circuit.
- plotly.js's per-case flaky table, with thresholds up to `0.5` against a default of `0` for
  font-heavy cases, is the concrete picture of what a *tight* default costs: a hand-maintained
  exception list that grows and is never audited. **P5**'s self-hosted font removes the cause
  plotly.js is compensating for, so this design should not import the compensation as well.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| `odiff` or `looks-same` as a pluggable comparator | **C15**: reported mismatch counts diverge by an order of magnitude between tools, so every number above would have to be re-derived empirically, and the proposal already scopes a comparator swap out as a later change with its own measurement. odiff's speed advantage is irrelevant at five images. |
| `threshold: 0`, `allowedMismatchedPixelRatio: 0` (byte equality) | Forbidden by spec and by **C13** — no primary source establishes bit-reproducible rasterization across Chromium builds, so this converts every Playwright bump into a full-corpus red. |
| Per-scenario thresholds from the outset | Builds plotly.js's maintenance artefact before any flake has been observed. If the uniform threshold proves wrong, the evidence will say which scenario and by how much, which is a better input than a guess. |
| `allowedMismatchedPixels` (absolute) instead of a ratio | Spec requires a ratio; an absolute count also means the effective strictness silently changes the first time a fixture's viewport changes. |

**Reversibility: cheap.** Two numbers in one config object, plus a golden-regeneration run if
loosening ever masked a change that had already landed. No file layout or API depends on them.

---

### D3 — Golden naming and location

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.** A flat directory, one PNG per scenario id, no platform token, no browser
token:

```text
packages/renderers/test/visual/
  canvas2d.visual.test.ts
  __screenshots__/
    simple-trace.png
    axes-grid.png
    resonance-peak.png
    noise-floor.png
    decimation-minmax.png
    __diffs__/            <- gitignored, written only on failure
```

Achieved by overriding both path callbacks on the browser project so that neither `platform` nor
`browser` reaches the filename:

```ts
expect: {
  toMatchScreenshot: {
    resolveScreenshotPath: ({ testFileUrl, testName, fileExtension }) =>
      path.join(path.dirname(fileURLToPath(testFileUrl)), "__screenshots__", `${testName}${fileExtension}`),
    resolveDiffPath: ({ testFileUrl, testName, fileExtension }) =>
      path.join(path.dirname(fileURLToPath(testFileUrl)), "__screenshots__", "__diffs__", `${testName}${fileExtension}`),
  },
},
```

The screenshot **name** passed to `toMatchScreenshot(fixture.id)` is the fixture's `id`, so the
golden filename is derived from the fixture record and cannot drift from it. The callback argument
field names above follow the published v5 documentation; the installed `.d.ts` is authoritative at
apply time and the implementation must be typed against it — no `any`, no cast.

`__diffs__/` is added to `.gitignore`. Diff images are a failure artefact, not a tracked one.

**Why.**

- Vitest's default reference filename is `{testName}-{browser}-{platform}.png` (e.g.
  `button-chromium-darwin.png`), mirroring Playwright's own platform-suffixed default (**C8**).
  Under **P5** exactly one platform ever generates or compares a golden, so the default would
  produce filenames ending `-chromium-linux` on every file — a token with a constant value.
- A constant token is worse than no token: it reads as though a second value exists somewhere, and
  it invites a future contributor to "add the darwin set" without reopening **P5**. The spec's
  "no OS-suffixed golden filenames" requirement makes the override mandatory, not optional.
- Keying the filename off `fixture.id` rather than the test's title means renaming a test does not
  orphan a golden, and the `render-scenario-fixtures` "exactly five scenarios" assertion and the
  golden directory listing check the same set of names.
- The `__screenshots__` directory name is Vitest's own convention, kept so the layout is
  recognisable and the default `screenshotDirectory` semantics are not fought.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Accept Vitest's default `-chromium-linux` suffix | Violates the `Exactly One Corpus, With No OS-Suffixed Golden Filenames` requirement, whose scenario asserts that path resolution is *not* a function of `process.platform`. |
| Keep the suffix but only the browser token (`-chromium`) | Same dead-ceremony objection at half size, and the spec names browser-independence nowhere — it names one corpus. Chromium-only is already a spec requirement, so encoding it per-file is redundant. |
| Goldens under `packages/renderers/goldens/` (outside `test/`) | Separates the golden from the test that owns it, and the `__screenshots__`-adjacent-to-test-file convention is what the path callbacks default to; moving it buys nothing. |
| Goldens in a top-level `visual-goldens/` at the repo root | Makes the corpus look shared when it is `packages/renderers`' own artefact, and change 7's goldens (its own decision) would then have to negotiate the same root directory. |

**Cost of adding a platform token later:** one line in `resolveScreenshotPath` (append
`-${platform}`) plus `git mv` on five files, in the same commit that adds the second platform's
CI job. It is a ~10-line change and no consumer depends on the path. This is the cheapest of the
eight decisions to revise.

**Reversibility: cheap.**

---

### D4 — Browser project placement in `vitest.config.ts`

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.** The browser entry is appended **last** in `test.projects`, and the top-level
`pool`/`poolOptions` block is deleted outright (**P3**, **F2**, **F3**), with `execArgv` pushed
down to the two projects whose allocation gates need it (**F4**).

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // No top-level `pool`/`poolOptions` block. Vitest 5 removed `poolOptions` from the config
    // type and reads `execArgv` directly off the test config object; a project-scoped `execArgv`
    // now propagates to the forked worker, so `--expose-gc` is declared only where a zero-GC
    // allocation gate reads `globalThis.gc`.
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          root: path.join(rootDir, "packages/core"),
          environment: "node",
          include: ["test/**/*.test.ts"],
          setupFiles: ["test/setup/fast-check.ts"],
          pool: "forks",
          execArgv: ["--expose-gc"],
        },
      },
      { /* playground — unchanged */ },
      {
        extends: true,
        test: {
          name: "renderers",
          root: path.join(rootDir, "packages/renderers"),
          environment: "node",
          include: ["test/node/**/*.test.ts"],
          pool: "forks",
          execArgv: ["--expose-gc"],
        },
      },
      { /* renderers-dom — unchanged */ },
      {
        extends: true,
        test: {
          name: "visual",
          root: path.join(rootDir, "packages/renderers"),
          include: ["test/visual/**/*.test.ts"],
          // No `environment` key: setting it is a v4 breaking change (C4).
          // No `execArgv`: nothing here reads `globalThis.gc`.
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            expect: { toMatchScreenshot: { /* D2 + D3 */ } },
          },
        },
      },
    ],
  },
});
```

The absolute `root` construction is retained on every entry; only its comment is rewritten to say
the 3.2.7 hazard it guarded no longer reproduces on the Vitest 5 line (**F7**, measured on
`5.0.1`; re-confirm against the `5.0.0` target) and that the construction is kept
as a defensive default. The `playground` entry keeps its `resolve.alias` block verbatim.

**Why.**

- **F4** is the whole reason the proposal's open question dissolves: on Vitest 5 a project-scoped
  `execArgv` propagates, so the browser project no longer has to "coexist with a workspace-wide
  `pool: "forks"` block" — that block ceases to exist. `pool: "forks"` moves down alongside
  `execArgv` because a V8 flag is only accepted by the forked pool (the original comment's reason,
  still true).
- **F2** makes deleting it mandatory rather than tidy: the top-level hoist stops being read on
  Vitest 5
  and is not renamed with a warning.
- **C4** forbids `environment` on a browser project and requires a provider *factory*; `playwright()`
  imported from `@vitest/browser-playwright` is that factory. `browser.instances: [{ browser: "chromium" }]`
  satisfies the `Chromium via Playwright Is the Sole Rasterizer of Record` requirement, and
  no `--disable-gpu`-style launch flag is added — Playwright already applies
  `--force-color-profile=srgb` (**C10**) and `--enable-unsafe-swiftshader` (**C11**), and the
  flags the exploration assumed are withdrawn evidence.
- `include: ["test/visual/**/*.test.ts"]` is disjoint from the existing `test/node/**` and
  `test/dom/**` globs, so no existing file is picked up twice and the
  `Existing Call-Sequence and DOM-Shape Assertions Are Not Replaced` requirement holds by
  construction of the glob, not by convention.
- Appended last, not inserted: it keeps the four pre-existing entries' diff to the added
  `pool`/`execArgv` lines only, which is what the `test-harness` delta's "unchanged `environment`,
  `root`, and isolation configuration" requirement is about.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Keep `execArgv` at the top level (just renamed from `poolOptions`) | Contradicts **P3**, and applies `--expose-gc` to the browser project where it is meaningless. **F4** removed the only reason it was ever hoisted. |
| A separate `vitest.visual.config.ts` | A second config is a second place for the project list to drift, and the `test-harness` spec requires exactly five entries in *this* array. |
| Put the browser project in a `packages/renderers/vitest.config.ts` | Vitest would then have two competing configs on the upward walk from `packages/renderers`, and the root `test.projects` array would no longer be the single inventory the spec inspects. |
| `instances: [{ browser: "chromium" }, { browser: "firefox" }]` | Explicitly out of scope; a second engine is a second corpus and a second flake surface for no R1 benefit. |

**Reversibility: cheap.** The entry is additive and self-contained.

---

### D5 — Turborepo task wiring

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.** Four coordinated changes.

1. **`packages/renderers/package.json`** gains
   `"test:visual": "vitest run --config ../../vitest.config.ts --project visual"`
   and its existing `"test"` becomes
   `"vitest run --config ../../vitest.config.ts --project renderers --project renderers-dom"`.
   `packages/core/package.json`'s `"test"` becomes
   `"vitest run --config ../../vitest.config.ts --project core"`.
   (`apps/playground` already has this exact shape at `apps/playground/package.json:11` — this
   generalises the existing precedent rather than inventing one.)

2. **`turbo.json`** gains:

   ```jsonc
   "test:visual": {
     "dependsOn": ["build"],
     "inputs": [
       "src/**",
       "test/visual/**",
       "../../vitest.config.ts",
       "../../pnpm-workspace.yaml"
     ],
     "outputs": []
   },
   "test": {
     "dependsOn": ["build", "test:visual"]
   }
   ```

   `outputs: []` is deliberate: the only file a visual run writes is a failure diff, and a failing
   task is never cached. `test/visual/**` in `inputs` covers both the test files and the
   `__screenshots__` goldens, so touching a golden correctly busts the cache; `src/**` covers the
   renderer and the font module.

3. **`.github/workflows/ci.yml`** gains, before the existing test steps:
   - `- name: Verify test:visual task is non-vacuous` → `node scripts/verify-turbo-ran.mjs test:visual`
   - a Playwright binary cache step (`actions/cache@v6`, `path: ~/.cache/ms-playwright`,
     key derived from the lockfile hash) alongside the existing Turborepo cache step
   - `- name: Install Playwright Chromium` → `pnpm --filter @trace-kit/renderers exec playwright
     install --with-deps chromium`, with **no** `continue-on-error`.

     **Corrected at apply time, by measurement.** This decision originally specified the bare
     `pnpm exec playwright install --with-deps chromium`, run implicitly at the repository root.
     That form does not work: `playwright` is a devDependency of `packages/renderers` only, never
     of the root package, so the root has no `node_modules/.bin/playwright` and the bare command
     fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "playwright" not found` (reproduced
     directly before the workflow was written, not inferred). The `--filter` form runs it in the
     package that actually declares the dependency and was verified to resolve and report
     `Version 1.63.0`.
   - after `pnpm run test`, a step asserting the visual suite executed at least one non-skipped
     case, reading the Vitest JSON reporter output for the `visual` project.

4. **`scripts/verify-turbo-ran.mjs` is not modified.** It already does the right thing when
   invoked with a second task name.

**Why.**

- The `ci-quality-gate` delta allows either "directly under `test` or as a task `test` depends
  on". `dependsOn` is chosen because it keeps `pnpm run test` → `turbo run test` as the single
  entry point (the requirement's own scenario) while giving the visual suite its own cache key
  and its own inputs — a renderer change and a golden change should each bust it, and a
  `packages/core` decimation change should not.
- The second guard invocation is not belt-and-braces, it is required by how the guard is written:
  `verify-turbo-ran.mjs` matches `task === <name>` among *runnable* planned tasks
  (`scripts/verify-turbo-ran.mjs`, `requestedIsRunnable`). With only `verify-turbo-ran.mjs test`,
  a `test:visual` that resolved to `<NONEXISTENT>` would exit 0. The `A Visual Suite That Resolves
  to Zero Executed Tests Fails CI` requirement names exactly this case.
- The `--project` filters are a precondition, not a nicety:
  `packages/renderers/.turbo/turbo-test.log` shows the current per-package `test` script running
  the whole workspace suite. Without the filters, adding the `visual` project launches Chromium
  under `core#test`, `renderers#test` **and** `renderers#test:visual` — three browser starts and
  three corpus comparisons per CI run, which is R4 made three times worse for nothing. It also
  breaks the "at least one non-skipped visual case" check by making the count ambiguous.
- Skipping still counts as executing zero *real* cases, which is why the JSON-reporter check
  exists separately from the vacuity guard: on `ubuntu-latest` the platform skip must not fire,
  and a bug that made it fire everywhere would otherwise be a silent green.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Run visual cases inside the existing `test` task with no separate task | One cache key for the whole suite: any `packages/core` change re-runs Chromium. And no way to invoke the visual suite alone during golden regeneration (D6). |
| A standalone Playwright Test runner and CI step | The proposal already rejected this: it routes tests around `scripts/verify-turbo-ran.mjs`, which `.github/workflows/ci.yml` runs three times precisely to make a vacuous task a failure. |
| `"outputs": ["test/visual/__diffs__/**"]` | Caching a failure artefact. Turborepo does not cache failed tasks, so the entry would only ever be dead configuration. |
| Leave the per-package `test` scripts alone and accept the triple run | ~3× the browser cost of the most expensive new thing in this change, permanently, to avoid two one-line script edits. |

**Reversibility: moderate.** The `turbo.json` entry and CI steps are cheap. The `--project` filter
edits change what `pnpm --filter <pkg> test` means for three packages — a real behavioural change
to the developer loop, worth calling out to the maintainer explicitly even though it is a strict
improvement.

---

### D6 — Golden update mechanism

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.** A dedicated, manually-triggered CI job. No local path, no `package.json`
script containing `--update`.

`.github/workflows/update-visual-goldens.yml`:

```yaml
name: Update visual goldens
on:
  workflow_dispatch:
    inputs:
      reason:
        description: "Why these goldens are being regenerated (appears in the PR body)"
        required: true
jobs:
  regenerate:
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps:
      # checkout / pnpm / node / install / playwright install — identical to ci.yml
      - run: pnpm --filter @trace-kit/renderers test:visual --update
      - run: git diff --exit-code -- . ':!packages/renderers/test/visual/__screenshots__/**'
        # fails the job if the update run touched anything outside the golden directory
      - run: |
          # Two shapes, chosen by the ref this workflow was dispatched against — corrected at
          # apply time from this decision's first pass, which unconditionally opened a PR into
          # `main` regardless of what branch dispatched it. That contradicted this section's own
          # stated intent below (step 2: "against their PR branch") and, concretely, left an
          # already-open, unmerged PR with no way to receive its own goldens without a manual
          # detour through a second, disconnected PR into main.
          if [ "${{ github.ref_name }}" = "main" ]; then
            # Steady state: goldens already exist on main; a later refresh is worth its own
            # separate, reviewable PR.
            open a PR: branch "update-visual-goldens-${{ github.run_id }}", base "main"
          else
            # Bootstrap / ordinary case: an open PR's own branch needs this corpus to exist
            # before its own CI can pass. Push the commit directly onto that branch — the
            # goldens become part of that PR's own diff and its own review, not a second
            # approval step for a corpus nothing has reviewed in context yet.
            git commit -m "chore(visual): regenerate goldens"
            git push origin "HEAD:${{ github.ref_name }}"
          fi
```

**Operator workflow**, end to end:

1. A developer changes something that alters the render and opens a PR. CI fails the visual suite
   and reports the diff-image paths (the `A Failing Visual Comparison Emits a Diff Artifact`
   requirement); the workflow uploads `__diffs__/**` as a job artefact so the reviewer can
   actually look at it.
2. The developer runs `Update visual goldens` from the Actions tab, dispatched **against their PR
   branch** (not `main`), typing a reason.
3. The job pushes one commit directly onto that same branch — the fixed message
   `chore(visual): regenerate goldens` — whose entire diff is under `__screenshots__/`. No second,
   separate PR: the goldens land inside the developer's own already-open PR, as part of its own
   diff and its own review.
4. CI on that PR re-runs on the new commit and now passes.

A dispatch against `main` itself (no open PR involved — a later, standalone golden refresh) takes
the other path: a small, separate, reviewable PR into `main`, exactly as originally specified.

**How a reviewer tells intentional from accidental, with no PR gate.** This repository commits
directly to `main` until 1.0.0 — there is no review-before-merge step for anything else in the
project right now, so this decision does not invent one solely for goldens. Two signals survive
in `git log` regardless, with no PR and no `CODEOWNERS` required to carry them:

- **Provenance.** A golden byte can only change via a commit authored by the update job with the
  fixed message `chore(visual): regenerate goldens`. Any other commit touching
  `__screenshots__/**` is by definition not the sanctioned path — the `git diff --exit-code`
  guard above proves the update run itself changed nothing outside that directory.
- **Intent.** `workflow_dispatch` requires a typed `reason`, recorded in that same commit's body.
  An accidental regeneration has no reason to type.

The failing run's uploaded diff images (before regeneration) remain useful as a record of what a
render change actually looked like, but there is no reviewer moment to hand them to — they are an
artifact for later inspection, not part of an approval step.

**Why.**

- **P5** forbids generating goldens on a developer machine, and the `visual-golden-corpus`
  requirement forbids any committed script that writes a golden outside the CI golden-generation
  step. Keeping `--update` as an inline argument in one workflow file, never in `package.json`,
  satisfies that literally: there is no `pnpm run` incantation that can write a golden.
- Vitest's own behaviour already supplies half the guarantee — an ordinary run without `--update`
  fails a mismatch and leaves the committed file alone, and a missing reference is created *and
  failed*, so a new golden can never arrive green. The design only has to make the update path
  explicit and attributable.
- `workflow_dispatch` over a label-gated path on the main CI workflow: a label is a mutable piece
  of PR metadata that can be applied and removed, leaving no record in the diff. A dispatch run is
  an immutable Actions record with a typed reason attached.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Download the CI-produced PNGs as an artefact and commit them by hand | The commit is then indistinguishable from a hand-edited one, and there is nothing stopping a developer from committing a locally-rendered macOS PNG instead — exactly what **P5** exists to prevent. |
| A `visual:update` label that makes the main CI job push goldens | The main workflow gains write permissions on every PR run, and the trigger leaves no durable record. |
| Auto-regenerate and push whenever the visual suite fails on `main` | Turns R5 into certainty: the corpus silently tracks whatever the renderer currently does, and the suite can never fail. |
| `pnpm run test:visual:update` locally, gated on `process.env.CI` | A committed script with a golden-write path, which the `No committed script writes a golden from a non-CI invocation` scenario checks for directly. |

**Reversibility: cheap.** One workflow file.

---

### D7 — Per-scenario assertion scope

**Status: `confirmed` — approved by the maintainer on 2026-09-16**

**Recommendation.** **Whole-canvas, one tolerance (D2), no `mask`, for all five scenarios.**
Every fixture renders at `viewport: { width: 800, height: 400 }` with `dpr: 2` except the
explicitly-noted `dpr` case, and each asserts the full canvas element.

The five fixtures, and what each is actually *for*:

| `id` | Payload | Domain / viewport | What the golden catches that no existing test can |
|---|---|---|---|
| `simple-trace` | 512-point smooth curve, `Float64Array` | full data range, 800×400 @ `dpr: 2` | `traceColor` and `lineWidthCss` actually reaching pixels; the trace being stroked at all; background composited under it. |
| `axes-grid` | same 512-point curve | same, `showLeftAxis`/`showBottomAxis` both true | grid/axis/label colours as pixels; paint order (grid under trace, axes over background); `textAlign`/`textBaseline` placement; **the only scenario whose golden is font-dependent**, and hence the D1 acceptance test. |
| `resonance-peak` | Lorentzian, 4,096 points, narrow high-Q peak | domain clipped to ±5 linewidths around the peak | the peak surviving as pixels — line joins at near-vertical segments, and no clipping of the apex against `plotTop`. This is the physics-preserving assertion. |
| `noise-floor` | 8,192 points, seeded PRNG, low-amplitude noise about a constant baseline | full range | the baseline not collapsing to a solid band; antialiasing behaviour on dense near-horizontal segments — the case most sensitive to a `lineWidth`/CTM error (**B-E1** anisotropy from change 5). |
| `decimation-minmax` | 200,000 points containing one single-sample spike | full range, 800×400 @ `dpr: 1` | that the Min-Max envelope's preserved extrema are *painted*, i.e. the spike is visible after decimation. Also the one `dpr: 1` fixture, so the dpr path is covered by a golden rather than only by `resize` call assertions. |

Fixture keying and location, satisfying `render-scenario-fixtures`:

```ts
// packages/renderers/src/fixtures/scenarios.ts  — SHIPPED SOURCE, not under test/
export interface ScenarioViewport { readonly width: number; readonly height: number; }
export interface ScenarioDomain {
  readonly xMin: number; readonly xMax: number;
  readonly yMin: number; readonly yMax: number;
}
export interface ScenarioFixture {
  readonly id: string;
  readonly description: string;
  readonly payload: Float64Array;      // built once at module scope, handed on by reference
  readonly domain: ScenarioDomain;
  readonly viewport: ScenarioViewport;
  readonly dpr: number;
}
export const RENDER_SCENARIOS: readonly ScenarioFixture[] = Object.freeze([...]);
```

Exported through a subpath: `package.json` `exports` gains `"./fixtures"`, `tsup.config.ts` gains
the entry. Change 7 writes `import { RENDER_SCENARIOS } from "@trace-kit/renderers/fixtures";` —
no relative traversal into another package's `test/` tree, which is exactly what the
`The Fixture Set Is Importable Without Reaching Into Another Package's Test Tree` requirement
demands. There is no backend field, and `dpr` is a plain number fed straight into
`resize(width, height, dpr)`; nothing reads `window.devicePixelRatio`.

**Why.**

- `mask` exists (**C6**) and is the documented lever, but **P5**/**P6** removed the reason to
  reach for it. The whole argument for making the font a shipped library asset was that glyph
  substitution, not antialiasing, is what makes text-heavy goldens unstable — and a single-platform
  corpus removes the second source too. Masking the labels after paying for the font would mean
  the font change bought nothing and `axes-grid`'s labels are never asserted.
- Masking is also not free in the direction that matters: a masked region cannot fail, so a
  `labelColor` regression or a `textBaseline` flip in `axes.ts` would ship green — and label
  rendering as pixels is explicitly one of the things `renderers-canvas2d`'s R1 named as
  unverifiable.
- Five scenarios at one tolerance is also what keeps D2 honest: a single number governs the whole
  corpus, so when it is wrong the suite says so loudly instead of being tuned per-case into
  plotly.js's flaky table.
- Putting fixtures in `src/fixtures/` rather than `test/fixtures/` is what makes the subpath
  export possible at all. The cost is that the fixture data ships to consumers; it is confined to
  its own entry point and `sideEffects: false` plus a subpath export means no consumer who does not
  import it pays for it.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Geometry asserted tightly, label regions masked or asserted at a looser tolerance | Two tolerances to maintain and a per-scenario region list to keep in sync with `axes.ts`'s gutter arithmetic — and it concedes the label pixels, which D1 just paid ~20 KB to stabilise. |
| `clip` to the plot area only, excluding gutters | Same objection, plus it stops asserting the background fill outside the plot area, where a wrong `backgroundColor` or a missing `fillRect` lives. |
| Fixtures under `packages/renderers/test/fixtures/` (alongside the existing `hot-path-violation.ts`) | Change 7 would import via `../../../renderers/test/fixtures/...`, which the spec scenario names as the thing that must not be required. |
| A separate `@trace-kit/fixtures` package | A published package for five records, and a new workspace member with its own build, lint and typecheck tasks, to avoid one subpath export. |
| More than five scenarios | Forbidden by **P4** and by the `The Initial Corpus Is Parity-Minimal` requirement, whose assertion fails on a sixth. |

**Reversibility: cheap** for the masking decision (it is per-assertion options, addable to one
scenario without touching the others). **Moderate** for the fixture location, since the subpath
export becomes part of the package's public surface the moment change 7 imports it.

---

### D8 — Upgrade sequencing

**Status: `confirmed` — approved by the maintainer on 2026-09-16; rewritten 2026-09-16 to absorb
P8–P10, and again on 2026-09-16 to absorb P11–P12 after `toolchain-probe.md` part 2. The
sequencing principle is unchanged; the commit list is longer and its contents are now measured
rather than anticipated.**

**Recommendation.** One PR (`size:exception` already accepted), **ten ordered commits**, each
independently green. No commit lands more than one major. The PR is merged with its history
preserved, never squashed — squashing destroys the only property this sequence exists to create.

| # | Commit | Exit criterion |
|---|---|---|
| 1 | `DEP0152` fix (**P9**) | `pnpm run test` green **and** emits no `DEP0152` line |
| 2 | `ES2022` comment (**P10**) | `typecheck`, `lint`, `test`, `build` all green; diff touches one file |
| 3 | Root `typescript` pin `^5.7.0` → `catalog:` (**P12**, **F15**) | all four verification commands green; root and all three packages resolve `typescript` to one identical version |
| 4 | `@types/node` 22 → 26.5.1 | `pnpm exec turbo run typecheck` green |
| 5 | `eslint` 9 → 10.10.0 + `typescript-eslint` 8.19 → 8.70.0 | `pnpm exec turbo run lint` green — **known to be met with no source or config edits** (**F9**) |
| 6 | `typescript` 5.7 → 6.0.3, **with its three fixes**: `ignoreDeprecations` in `tsconfig.base.json` (**F11**), `allowImportingTsExtensions` in `apps/playground/tsconfig.json` (**F12**), and the `eslint.config.js` project-association rework (**F13**, **D13**) | `typecheck`, `lint`, `build` all green; no `TS5101`, no `TS5097`, no "could not be resolved" diagnostic |
| 7 | `vitest`/`@vitest/coverage-v8` 3.2.7 → 5.0.0 + config migration | existing suite green; the three `globalThis.gc` assertions pass |
| 8 | Remaining minor/patch refresh (`vite`, `happy-dom`, `fast-check`, `turbo`) | all four verification commands green |
| 9 | Font default (**D1**) | existing tests green; size budget met |
| 10 | The harness (browser project, fixtures, goldens, CI, task wiring) | visual suite executes and passes against the D6-generated goldens |

**Commit 1 — the `DEP0152` fix.**
`packages/core/test/decimation/allocation-gate.test.ts:83` and
`packages/core/test/viewport/transform-allocation.test.ts:51` each do
`details.push({ kind: detail.kind, flags: detail.flags })` against a value typed as
`GcPerformanceEntry extends NodePerformanceEntry`. Both move to reading `kind` and `flags` off
`entry.detail`, and the local `GcPerformanceEntry` interfaces are restated to describe the
`detail` shape rather than the entry itself. **Exit criterion**: `pnpm run test` is green *and*
`pnpm run test 2>&1 | grep -c DEP0152` prints `0`. This is first because it is the only commit in
the sequence that depends on nothing else, and because it establishes the clean warning baseline
that the later upgrades are then measured against — if commit 7 reintroduces a deprecation
warning, that is visible only against a baseline of zero.

**Commit 2 — the `ES2022` comment.**
A comment at `tsconfig.base.json:3` stating that the target is the syntax level downstream
browsers must support, and is deliberately *not* raised to match the Node 24 toolchain. One file,
no behaviour. It goes here, before any dependency moves, so that the rationale is in the tree
before the commits that would most tempt a reader to "fix" the target upward.

**Commit 3 — the root `typescript` pin (P12).**
The root `package.json` declares `"typescript": "^5.7.0"` literally while `packages/core`,
`packages/renderers` and `apps/playground` all declare `"typescript": "catalog:"`. The root
therefore does not follow the catalogue and drifts from it silently — during the probe, the first
install left the root on `5.9.3` while the catalogue already said `6.0.3` (**F15**). One word
changes: `"^5.7.0"` becomes `"catalog:"`. **Exit criterion**: all four verification commands green
*and* the `typescript` version resolved for the workspace root equals the version resolved for all
three packages. This is a pre-existing defect, not one the upgrade introduced, and it goes **third
— before any catalogue bump** deliberately: every later commit in this sequence expresses its
version move as a catalogue edit, and until this line is fixed, those edits do not take effect at
the root. Landing it after commit 6 would mean commit 6's `typecheck` ran against a compiler the
catalogue did not name, which is precisely the failure mode **F15** describes. It goes after
commits 1 and 2 only because those two touch nothing the resolver reads.

**Commit 4 — `@types/node` 22.10 → 26.5.1.**
Catalogue entry only; every consumer already resolves through `catalog:`. Four majors of ambient
declarations under `strict` and `noUncheckedIndexedAccess`. **Exit criterion**:
`pnpm exec turbo run typecheck` green. It precedes the TypeScript bump so that a new type error
is attributable to the declarations or to the compiler, never ambiguously to both. It also
follows commit 1 deliberately: the two files commit 1 rewrites are `node:perf_hooks` consumers,
so if the new `@types/node` changes the `PerformanceEntry`/`detail` typings, the failure lands on
an already-green, already-reviewed rewrite.

**Commit 5 — ESLint 9.17 → 10.10.0, with `typescript-eslint` 8.19 → 8.70.0.**

**Measured: this commit's exit criterion is now known to be met with no source and no config
edits (F9).** With `typescript` held at `5.9.3`, `eslint@10.10.0` plus `typescript-eslint@8.70.0`
runs `pnpm exec turbo run lint` to completion with zero problems against a detached worktree of
`HEAD`. None of the three new `eslint:recommended` rules fires, and `eslint.config.js` needs no
migration. The analysis below was written before that run and is retained as the record of what
was anticipated; the one thing it anticipated correctly is that the two packages must move
together.

These two move together because `typescript-eslint@8.70.0` is the version whose published
`peerDependencies` accept `eslint: ^10.0.0`; 8.19 does not, so splitting them produces a commit
that cannot install cleanly. Verified breaking changes that plausibly reach this repository:

- `eslint:recommended` gains `no-unassigned-vars`, `no-useless-assignment` and
  `preserve-caught-error`. `eslint.config.js` extends `tseslint.configs.recommendedTypeChecked`,
  which layers on `eslint:recommended`, so these three apply to every `**/*.ts` file in the
  workspace. New errors are expected, not hypothetical.
- Config lookup now starts from each linted file's directory and walks up, rather than from the
  cwd. Each package runs `eslint .` from its own directory and there is exactly one
  `eslint.config.js`, at the repository root; upward resolution should still reach it. This has
  not been executed and is not asserted.
- Node < 20.19 is dropped. The repository is on Node 24 throughout; no action.
- The `.eslintrc` format and the `FlatESLint`/`LegacyESLint` APIs are removed. This repository has
  no `.eslintrc*` file and uses the flat format already; `packages/core/test/lint-rules.test.ts`
  drives ESLint through its Node API and must be confirmed to use `ESLint`, not the removed
  classes.

**What was deliberately not written here** — the concrete list of source edits those three new
rules would require — has since been measured and is **empty** (**F9**). **Exit criterion**:
`pnpm exec turbo run lint` green *and*
`pnpm exec vitest run packages/core/test/lint-rules.test.ts` green, since that meta-test is the
repository's own proof that the `any`/`as never` bans still fire. If this commit's diff contains
anything beyond the two version lines, that is a signal to stop and re-measure, not to proceed.

**Commit 6 — TypeScript 5.7 → 6.0.3, with its three fixes.**
The catalogue's first-pass target, `typescript@7.0.2`, was rejected by measurement (**D11**):
`typescript-eslint@8.70.0` — its newest release — declares `peerDependencies.typescript` as
`>=4.8.4 <6.1.0`, and forcing the install past that conflict makes `eslint` exit with a hard
error from `typescript-eslint/dist/index.js` (`typescript-eslint does not support TS 7.0.`),
which is unacceptable given that type-aware linting is this repository's entire lint
configuration and the enforcement mechanism for CLAUDE.md rule 1. `typescript@6.0.3` is the
corrected target: verified in an isolated install to resolve without peer conflict against
`eslint@10.10.0` and `typescript-eslint@8.70.0`, with `eslint` exiting `0` on a type-checked
source file. This commit lands unconditionally — there is no longer a gate to clear.

**It does not land alone.** `toolchain-probe.md` part 2 measured three failures caused by the
compiler bump, and all three fixes belong in **this** commit, not elsewhere, because each is
caused by TypeScript 6 and each is meaningless without it:

1. `"ignoreDeprecations": "6.0"` in **`tsconfig.base.json`**, with the mandatory comment naming
   `tsup` as the cause and the TypeScript 7 expiry (**F11**, **P11**, risk **R12**). Without it
   `pnpm exec turbo run build` fails with `TS5101`.
2. `"allowImportingTsExtensions": true` in **`apps/playground/tsconfig.json`** (**F12**). Without
   it `pnpm exec turbo run typecheck` fails with three `TS5097` diagnostics.
3. The **`eslint.config.js`** project-association rework for `test/**` and `bench/**`
   (**F13**, **D13**). Without it `pnpm exec turbo run lint` reports 29 false "could not be
   resolved" errors under `packages/core/bench/`.

The third of these is the one most likely to be filed under the wrong commit. It is an
`eslint.config.js` edit, so the obvious home is commit 5 — but **F9** proved commit 5 needs no
config edit at all, and **F13** proved this one reproduces only when `typescript` moves, with
ESLint and `typescript-eslint` held constant. It is caused by TypeScript 6 and it belongs here.
Putting it in commit 5 would give commit 5 a diff it does not need and leave commit 6 unable to
pass its own `lint` criterion — destroying the attribution both commits exist to provide.

**Exit criterion**: `typecheck`, `lint` and `build` all green, with no `TS5101`, no `TS5097` and
no "could not be resolved" diagnostic anywhere in the output; plus
`pnpm --filter @trace-kit/core typecheck:test` exiting `0`, which is the control
that distinguishes a linter-configuration defect from a real type error (**F13**).

**Commit 7 — Vitest 3.2.7 → 5.0.0, no new tests.**
`pnpm-workspace.yaml` catalog (`vitest`, `@vitest/coverage-v8` → `5.0.0`; add
`@vitest/browser-playwright` `5.0.0`, `playwright` `1.63.0` and `pixelmatch` `7.2.0` entries
*now*, unused until commit 9, so the lockfile churns once); root `package.json`; delete the
top-level `pool`/`poolOptions` block and push `pool: "forks"` + `execArgv: ["--expose-gc"]` down
to `core` and `renderers` (**F2**, **F3**, **F4**); rewrite the relative-root comment (**F7**).
**F2**/**F3**/**F4** were measured against `5.0.1` and are re-confirmed against `5.0.0` as the
first act of this commit; if `5.0.0` behaves differently, this commit stops and the finding is
recorded before the config is touched. **Exit criterion: the existing suite passes unchanged**,
specifically `packages/core/test/viewport/transform-allocation.test.ts:17`,
`packages/core/test/decimation/allocation-gate.test.ts:20` and
`packages/renderers/test/node/allocation-gate.test.ts:66`, which assert `globalThis.gc` is a
function and are therefore the direct proof that the `execArgv` migration worked (**F5**). Plus
`pnpm exec turbo run typecheck lint` green. No golden, no browser, no font in this commit.

**Commit 8 — the remaining minor and patch refresh.**
`vite` → `8.3.0`, `happy-dom` → `20.14.5`, `fast-check` → `4.10.0`, `turbo` → `2.10.13`. No
majors, so they travel together; separating them would be ceremony without attribution value.
It follows commit 7 because `vitest@5.0.0` declares `vite: ^6.4.0 || ^7.0.0 || ^8.0.0` and
`happy-dom` as a peer, so both are best moved once the runner they serve is already at its target.
**Exit criterion**: all four verification commands green.

**Commit 9 — the font default (D1).**
New `src/font/**`, the `style.ts:39` change, the tsup entry, the `exports` subpath, the size
budget test, the changeset. **Exit criterion**: existing tests green (only
`packages/renderers/test/node/axes-grid.test.ts` should need touching, and only where it asserts
the literal font string). Landing this *before* the goldens exist means the corpus is generated
against the final font the first time and is never regenerated for this reason.

**Commit 10 — the harness.**
`src/fixtures/scenarios.ts`, the `visual` project entry, `test/visual/canvas2d.visual.test.ts`,
`turbo.json`, the `--project` filters, both CI workflows, the freshness and deprecation CI steps
(**D9**, **D12**), and the goldens themselves — which arrive via the D6 dispatch job run against
this branch, since this commit's first CI run *must* fail with "no existing reference screenshot
found".

**Why.**

- The whole sequence exists to answer one question at each red run: *which change did that?*
  Proposal risk **R9** is that four majors plus a new test mechanism plus a public-API change make
  that question unanswerable. One major per commit, each with a named command as its exit
  criterion, is the only mitigation that does not require reducing scope — and scope was settled
  by **P8**.
- **F5** and **F8** establish that both migrated Vitest behaviours fail **loudly** — a missing
  `globalThis.gc` fails an assertion, a misresolved root exits non-zero — which means commit 7 has
  a real, binary exit criterion rather than a vibe.
- The reverse order is not merely inelegant, it is unworkable: `toMatchScreenshot` does not exist
  at 3.2.7 (**C1**, **C2**), so there is nothing to write commit 10 against until commit 7 lands.
  The font goes before the goldens because a corpus generated against `sans-serif` would be
  thrown away by commit 9.
- The two zero-risk commits (1 and 2) go first, not last. They are the only two that can be
  reviewed on their merits rather than on "did CI stay green", and putting them ahead of the
  upgrades means the reviewer reads them before fatigue sets in on a `size:exception` PR.
- TypeScript goes last among the three type-and-lint majors and immediately before Vitest. The
  original reason — that it was the one major which might not land at all — is spent: **D11**
  resolved the version question and commit 6 lands unconditionally. The reason it keeps that slot
  is now attribution: `@types/node` and ESLint must each be proven green under the *old* compiler
  first, so that the three fixes commit 6 carries (**F11**, **F12**, **F13**) are unambiguously
  attributable to the compiler and to nothing else. That is exactly how the probe measured them.
- The root pin (commit 3) precedes every catalogue bump because until it lands, a catalogue edit
  does not move the root's own `typescript` (**F15**) — so commits 4 through 8 would each be
  verifying a resolution the catalogue did not describe.
- Adding the Playwright/pixelmatch catalog entries in commit 7 keeps `pnpm-lock.yaml` to one large
  diff hunk instead of two, which matters when the PR is already carrying a `size:exception`.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Upgrade Vitest in a separate, earlier PR | Contradicts the accepted `exception-ok` delivery strategy, and lands a major bump on `main` with no consumer — if the browser work then stalls, the workspace carries the upgrade's risk with none of its benefit. |
| Single squashed commit | **R9** becomes unanswerable: a red CI run cannot distinguish a TypeScript 6 type error from an ESLint 10 rule addition from a broken allocation gate, which is the exact confusion the probe was run to prevent. |
| One "toolchain" commit carrying all four majors | Same failure as squashing, at smaller scale. Four majors in one diff is one bisect step that tells you nothing. |
| A separate toolchain PR landing before this one | This was offered to the maintainer and declined (**P8**). Recorded, not reopened. |
| Vitest before the other majors | `vitest@5.0.0`'s `@types/node` peer is `^22.0.0 \|\| >=24.0.0`, so it is satisfied either way — but putting the runner upgrade first means every subsequent major's exit criterion runs through a test runner that itself just changed. The suite is the instrument; the instrument moves last among the things it measures. |
| Font last, after the goldens | Every golden regenerated a second time, and the first corpus committed is one generated against an OS-substituted family — recording in git exactly the state **P5** exists to eliminate. |
| Browser project before the font, goldens after both | The intermediate commit has a `visual` project that cannot pass (no goldens) or must be skipped, which conflicts with the CI vacuity requirement at the commit boundary. |

**Reversibility: N/A** — process, not artefact. Every commit is independently revertable, which is
the point; commits 4, 5, 6 and 7 are each a single-package revert.

---

### D9 — How the P7 freshness policy is enforced

**Status: `confirmed`** — the maintainer chose manual enforcement over the recommended script on
2026-09-16, after being shown the trade-off below. Recorded as an informed decision.

**Decision.** **P7** is enforced manually. No script, no CI step, no third-party service. The
policy is documented and applied by whoever performs a dependency update.

The manual procedure, so it is performed the same way each time:

1. For each entry in `pnpm-workspace.yaml`'s `catalog:` block, fetch the published version list
   and publish times — `npm view <pkg> time --json`.
2. Filter to **stable** versions by parsing the version string for a prerelease identifier. Do not
   infer stability from a dist-tag name: `vitest` carries `beta`, `rc`, `V3` and `V4`
   simultaneously.
3. Drop every version published within the freshness window (2 days), then take the newest that
   remains. That is the target.

**The one trap this procedure exists to avoid.** Never read the `latest` dist-tag.
`@types/node`'s published `latest` is `22.20.3` while stable `26.x` releases exist, so a
`npm view <pkg> version` check reports this repository as current on the single most out-of-date
dependency it has. This was measured during the 2026-09-16 audit, and it is precisely the error a
hand check makes once and then keeps making.

**Why manual was chosen.** The maintainer's call. The recommendation was a first-party
`scripts/check-dependency-freshness.mjs` wired into CI, on the reasoning that a two-day window
goes stale between one change and the next and that nothing breaks when a dependency falls behind,
so nothing surfaces it. That reasoning was presented and not accepted; the cost accepted in
exchange is that **P7** is a documented practice rather than an enforced gate, and that a lapse
produces no signal.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| `scripts/check-dependency-freshness.mjs` + CI step (the recommendation) | Not chosen. It would have made the policy self-enforcing and encoded the `latest`-tag trap once rather than relying on it being remembered. |
| Dependabot / Renovate | Opens PRs continuously against a repository whose delivery policy is a single reviewed change per unit of work (CLAUDE.md rule 8, no external PRs before 1.0.0), and cannot express "at least two days old" without bot-specific configuration becoming the source of truth instead of **P7**. |
| `pnpm outdated` in CI | Reports against the declared range, not the newest stable published release, and has no notion of a freshness window. It would pass on `^22.10.0` while `26.5.1` exists. |

**Reversibility: cheap.** Nothing is built, so nothing has to be removed. Adding the script later
is additive and changes no existing file.

---

### D10 — `@types/node` 26 against the `lib: ["ES2022"]` settings

**Status: `confirmed`** — approved by the maintainer on 2026-09-16

**Recommendation.** Change neither `lib` array. `packages/core/tsconfig.json` keeps
`lib: ["ES2022"]` and `packages/renderers/tsconfig.json` keeps `lib: ["ES2022", "DOM"]`. No
`ESNext` entry is added, no `types` array is introduced to narrow what `@types/node` contributes,
and `tsconfig.base.json`'s `target: "ES2022"` is unchanged (**P10**). The only addition is the
**P10** comment.

What was verified rather than assumed:

- `typescript@6.0.3` ships `lib.es2022.d.ts`, the `lib.es2022.*.d.ts` family and `lib.dom.d.ts`
  directly inside the `typescript` package, exactly as `typescript@5.7` does — this is a
  conventional TypeScript release, not the native port the catalogue's first-pass target
  (`typescript@7.0.2`) turned out to be, so there is no platform-native optional-dependency
  question to resolve here. Both `lib` arrays keep resolving under TypeScript 6.
- `@types/node@26.5.1`'s `typesVersions` map only downlevels for `<=5.6` and `<=5.7`; from
  TypeScript 5.8 upward the root declarations are used directly, which covers `6.0.3`. The
  highest DefinitelyTyped dist-tag published for this package is `ts6.0`, which is the target's
  own major line — a positive signal, not an absence of one.
- `vitest@5.0.0` declares `@types/node: ^22.0.0 || >=24.0.0` as a peer, so `26.5.1` satisfies it.

The interaction that actually matters is the opposite of the intuitive one: `@types/node` 26
describes a Node 24+ runtime, which uses APIs that may be typed against lib features newer than
`ES2022`. If a `@types/node` declaration references a global that `lib: ["ES2022"]` does not
provide, the failure is a `typecheck` error in whichever package consumes it — and the correct
response is **not** to widen `lib`. `lib` is a statement about what the *shipped library* may
assume of a consumer's browser; widening it to satisfy a Node-only type declaration would silently
raise the browser floor of a published package to fix a build-tooling problem. If that failure
occurs, the response is a `types`-scoped narrowing or a test-only tsconfig, and it is recorded as
a finding before any `lib` array is touched.

**Why.**

- `lib` and `target` answer the same question — what downstream browsers must support — and
  **P10** settles that question as `ES2022`. Consistency between them is the point;
  `target: "ES2022"` with `lib: ["ESNext"]` would let a hot-path module type-check against an API
  the emitted code targets a runtime that lacks.
- The two `lib` arrays are already deliberate and asymmetric: `core` has no `DOM` because
  CLAUDE.md rule 5 makes it isomorphic, and `renderers` has `DOM` because it touches canvas. That
  asymmetry is load-bearing and a `@types/node` bump is not a reason to disturb it.
- `@types/node` is a devDependency in every consumer. It does not reach the published `.d.ts`
  surface unless a `src/**` file imports `node:*`, which none does today. The blast radius of this
  bump is the build, not the package contract.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Raise both packages to `lib: ["ESNext"]` | Decouples `lib` from `target`, so code can type-check against APIs the emit targets a runtime without. It also silently changes the library's browser floor, which **P10** exists to keep an explicit decision. |
| Add `ES2023`/`ES2024` alongside `ES2022` | Same defect, smaller. Half a decision, and it invites the next bump to add the next one. |
| Add `"types": ["node"]` narrowing pre-emptively | Solves a failure that has not been observed. If it is needed, the diagnostic will say so precisely; adding it blind hides which declaration needed it. |
| Pin `@types/node` to the `ts6.0`-tagged `26.6.1` | Fails **P7**: `26.6.1` was published 2026-09-15, inside the two-day window at the **P8** cutoff. **P8** names `26.5.1` and that table is authoritative. |

**Reversibility: cheap.** Two `lib` arrays and one comment.

---

### D11 — Type-aware linting under TypeScript 7

**Status: `confirmed`. Resolved by measurement, not by opinion.**

**Verdict.** `typescript@7.0.2`, the catalogue's first-pass **P8** target, is rejected. The
throwaway install this decision called for has been run: `typescript@7.0.2` alongside
`eslint@10.10.0` and `typescript-eslint@8.70.0`, followed by `pnpm exec turbo run lint`, fails.
The **P8** catalogue target is corrected to `typescript@6.0.3` (published 2026-04-16, inside the
**P7** freshness window). Commit 6 of **D8** lands `typescript@6.0.3` unconditionally — there is
no longer a gate to clear, and no commit is dropped from this change.

The bump is **not** forced through TypeScript 7 by disabling type-aware linting, by pinning
`typescript-eslint` to a canary, or by adding an override that silences the peer mismatch.
Instead, the compiler target itself moves to the newest release the ecosystem actually supports.

**Why.**

- **`typescript@7.0.2` fails concretely, not just by an unmet peer range.**
  `typescript-eslint@8.70.0` declares `peerDependencies.typescript` as `>=4.8.4 <6.1.0` — it is
  the newest released `typescript-eslint`, and every published `8.70.1-alpha.*` declares the
  identical range, so no released `typescript-eslint` accepts TypeScript 7. Forcing the install
  past the peer conflict does not degrade gracefully: `eslint` exits with a hard error thrown
  from `typescript-eslint/dist/index.js` — `typescript-eslint does not support TS 7.0.` —
  pointing at upstream issue 10940, which tracks support for TS **>=7.1**. This is a measured
  runtime failure, not an inferred one.
- This repository cannot treat type-aware linting as optional. `eslint.config.js` is entirely
  `tseslint.configs.recommendedTypeChecked` with `parserOptions.projectService`, and
  `@typescript-eslint/no-explicit-any` configured with every relaxation off is the mechanism that
  enforces **CLAUDE.md rule 1**. A TypeScript bump that costs the `any` ban is a net loss no
  matter how current it leaves the compiler.
- **`typescript@6.0.3` is the corrected target and it is clean.** Verified in an isolated
  install: `typescript@6.0.3` + `eslint@10.10.0` + `typescript-eslint@8.70.0` resolves with no
  peer conflict, and `eslint` exits `0` on a type-checked source file. It is the newest release
  inside `typescript-eslint`'s supported range and still satisfies **P7**.
- **P7** is a policy about freshness, not a mandate to install a version whose ecosystem has not
  caught up. Correcting the catalogue target to the newest release the ecosystem actually
  supports is **P7** applied with judgement, not a departure from it.
- TypeScript 7 stays out of scope for this and any future change until `typescript-eslint`
  ships support for it (tracked by upstream issue 10940). A future reader should not re-propose
  it without checking that issue first. **Since this decision was first written, a second,
  independent gate has appeared** — see the `ignoreDeprecations` cost below and risk **R12**:
  `tsup` must also stop hardcoding `baseUrl` before TypeScript 7 is reachable. Clearing only the
  `typescript-eslint` gate is not sufficient.

**What `6.0.3` actually costs, measured.** The isolated install above proved only that the three
packages resolve together and that `eslint` exits `0` on one file. `toolchain-probe.md` part 2
then ran the full upgrade against a detached `git worktree` of `HEAD` (`4cb0872`), one variable at
a time. `6.0.3` is not free; it costs exactly three edits, and the decision is only complete with
them written down:

| Finding | Command that fails | Diagnostic | Fix |
|---|---|---|---|
| **F11** | `pnpm exec turbo run build` | `error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0` | `"ignoreDeprecations": "6.0"` in `tsconfig.base.json` |
| **F12** | `pnpm exec turbo run typecheck` | three × `error TS5097` (`.ts` import extension) at `apps/playground/src/shell/bootstrap.ts:8` and `apps/playground/src/views/index.ts:3-4` | `"allowImportingTsExtensions": true` in `apps/playground/tsconfig.json` |
| **F13** | `pnpm exec turbo run lint` | 29 × "Unsafe call / member access of a type that could not be resolved" across `packages/core/bench/index.ts`, `runner.ts`, `trace-deopt.ts` | reshape how `eslint.config.js` associates `test/**` and `bench/**` with a TypeScript project — **D13** |

Each is attributed rather than guessed:

- **F11 is external.** No `tsconfig` in this repository sets `baseUrl`. The source is `tsup`'s
  bundled declaration build — `node_modules/.../tsup/dist/rollup.js:6837`,
  `baseUrl: compilerOptions.baseUrl || "."`. `tsup@8.5.1` (2025-11-12) is its newest published
  release, so there is no upstream fix to wait for and no version to bump to. The suppression is
  the only available response, and it is a suppression with a shelf life: `ignoreDeprecations`
  stops functioning entirely in TypeScript 7. **P11** therefore requires it to carry a comment
  naming `tsup` and stating the expiry, so a later reader does not read it as a repository
  preference and does not discover the second TypeScript 7 gate the hard way.
- **F12 is local and narrow.** Those three imports are unchanged by this work and pass under
  `5.9.3`. The option is legal in `apps/playground/tsconfig.json` specifically because it already
  sets `"noEmit": true`; it must not spread to an emitting config.
- **F13 is a linter-configuration defect, not a code defect.** `tsc --noEmit -p
  packages/core/tsconfig.test.json` exits `0` under the same `6.0.3`, and the same lint run under
  `5.9.3` is clean with ESLint and `typescript-eslint` held constant — TypeScript is the only
  variable. `typescript-eslint@8.70.0` declares `typescript: >=4.8.4 <6.1.0`, so `6.0.3` is
  *nominally* supported; the breakage is silent rather than refused, which is what makes it worse
  than `7.0.2`'s hard error rather than better. A fix was verified: classic `parserOptions.project`
  pointed at that same tsconfig exits `0` under `6.0.3`. **D13** owns the choice of shape.

The rest of **P8** is free: `eslint@10.10.0` + `typescript-eslint@8.70.0` needs no edits at all
(**F9**), `@types/node` `26.5.1`/`26.6.1` caused no failure (**F10**), and `pnpm run test` reports
293 tests passing with the whole upgrade applied (**F14**).

**`5.9.3` was offered and declined.** The head of the TypeScript 5 line satisfies **P7** and costs
nothing — none of **F11**, **F12** or **F13** reproduces on it; the probe used it as the clean
control for exactly that reason. It was put to the maintainer alongside the three costs above, as
the zero-cost alternative that would let the ESLint and `@types/node` halves land untouched. The
maintainer chose `6.0.3` and accepted the three fixes (**P11**). That choice is recorded here as
informed, not as the only option that existed.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Bump TypeScript and drop to `tseslint.configs.recommended` (untyped) | Loses every type-aware rule, including the ones `packages/core/test/lint-rules.test.ts` asserts. CLAUDE.md rule 1 stops being mechanically enforced — the exact guarantee this repository is built around. |
| Bump TypeScript and add a `pnpm.peerDependencyRules` override | Silences the warning without addressing the underlying failure — measured to be a hard `eslint` exit, not a soft warning, so the override would not even mask it. |
| Pin `typescript-eslint` to the `8.70.1-alpha` canary | Violates **P7** outright: prereleases never qualify, and every published `8.70.1-alpha.*` declares the identical `<6.1.0` range regardless. |
| Land the whole change without any TypeScript bump | Gives up a **P8** target unnecessarily: `typescript@6.0.3` is available, fresh under **P7**, and its three costs are measured and bounded. |
| Stop at `typescript@5.9.3`, the head of the 5 line | Zero cost — none of **F11**, **F12** or **F13** reproduces, and it satisfies **P7**. Offered to the maintainer on exactly those terms and **declined** in favour of `6.0.3` (**P11**). Recorded, not reopened. |
| Keep `typescript@7.0.2` as the recorded target and wait for `typescript-eslint` | Leaves the workspace on `^5.7.0` for no benefit — `6.0.3` is a real, verified improvement available today, and TypeScript 7 support is tracked upstream regardless of what this change does. |

**Reversibility: resolved.** The correction from `7.0.2` to `6.0.3` is a one-line catalogue
change plus this record; nothing else in **D8**'s sequencing moved. If `6.0.3` later proves
wrong, reverting commit 6 alone restores the previous compiler — and, with it, the three fixes
(**F11**, **F12**, **F13**) that exist only to serve it, since none of them is required at
`5.9.3`.

---

### D12 — How the P9 zero-deprecation rule is enforced

**Status: `confirmed`** — approved by the maintainer on 2026-09-16

**Recommendation.** A CI step that runs the repository's four verification commands with warnings
visible, captures `stderr`, and fails the job on any `DeprecationWarning` line whose `DEP####`
code is not on a short, explicitly named third-party allowlist. The allowlist starts with exactly
one entry: `DEP0169`, attributed to pnpm 9.15.4, with that attribution written next to it.

Two prohibitions are part of the decision, not decoration:

1. **No global suppression.** `--no-deprecation`, `--no-warnings`,
   `process.removeAllListeners("warning")` and stream filtering are all forbidden as ways to
   satisfy this rule. They satisfy the check while defeating its purpose, and a future
   repository-caused warning would then never be seen.
2. **The allowlist is by code with an attribution, not by pattern.** An allowlist entry says
   *which third-party tool emits it*, so that when pnpm is upgraded the entry can be re-evaluated
   rather than inherited forever.

**Why.**

- `DEP0152` survived in two files until an audit found it, which is the argument: a deprecation
  warning is printed, scrolls past, and changes nothing until the API is removed. Only a check
  that fails turns it into information.
- The allowlist exists because the repository does not control every warning in its own output.
  **P9** draws the line at attributability, and a mechanism without an allowlist would force
  exactly the global suppression that prohibition 1 forbids.
- It is one step, not a per-command wrapper, because the set of verification commands is already
  enumerated in `CLAUDE.md` §Verification and should have one source of truth.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| `NODE_OPTIONS=--throw-deprecation` in CI | Turns every deprecation into a thrown error inside whichever command triggers it, including third-party ones. `DEP0169` would fail `pnpm install` on every run, and **P9** explicitly puts it out of scope. |
| Suppress warnings with `--no-deprecation` | Satisfies nothing. It hides the class of problem the rule exists to surface, and the next `DEP0152` is invisible. |
| A one-off manual audit, no ongoing check | Exactly what produced the current state — a warning on every `pnpm run test` that nobody was failing on. |
| Assert in a test rather than in CI | A test that shells out to the whole verification suite from inside that suite is a cycle. The check belongs outside the runner. |

**Reversibility: cheap.** One CI step and one allowlist entry.

---

### D13 — How `test/**` and `bench/**` get a TypeScript project under TypeScript 6

**Status: `confirmed`** — settled by measurement on 2026-09-16, after the maintainer asked which
shape would leave the least debt for a later TypeScript 7 upgrade. That question was answered by
running the two unmeasured alternatives rather than by reasoning about them, and the answer
collapsed the decision: see `toolchain-probe.md` part 3, **F17** and **F18**.

This section was originally written as a three-way choice on the premise that all three shapes
turn the lint green today and differ only in later cost. **That premise was wrong.** A real
`tsconfig.json` placed inside `packages/core/bench/` is discovered by the project service — the
service says so, reporting it as a conflict with the stale `allowDefaultProject` entry — and once
that entry is removed so the files reach the service only through the discovered config, the
result is the identical 29 errors on the identical lines. The failing variable is not how the
project is supplied. It is `projectService` itself under `typescript@6.0.3`, which constructs a
program that cannot resolve `@types/node` however the project reaches it (**F17**). The second
alternative is therefore refuted, and the third uses the same discovery mechanism that test
exercised, so it falls to the same cause without needing its own run.

One cost recorded against the recommendation also did not survive checking: `ParserOptions.project`
carries no `@deprecated` tag in the installed `@typescript-eslint/types` declarations, while a
neighbouring option in the same interface does. "The mode upstream is moving away from" is a
stated direction, not a deprecation (**F18**).

**On the maintainer's actual question** — least debt toward TypeScript 7. TypeScript 7 is blocked
by two things this decision does not touch: `tsup` hardcoding `baseUrl` (**F11**) and
`typescript-eslint` refusing TypeScript 7 outright. Whatever shape is adopted must be revisited
when the second is fixed, because a repaired `projectService` is the natural destination. The
classic-mode change is confined to one `languageOptions.parserOptions` block in
`eslint.config.js`, which makes that return trip a single block swap — the smallest carry-forward
available, and the only shape that works today.

**The problem, precisely.** `eslint.config.js` lints every `**/*.ts` file with
`tseslint.configs.recommendedTypeChecked` through `parserOptions.projectService`. Files under
`test/**` and `bench/**` are deliberately outside each package's `tsconfig.json` `include`, which
stays `src/**` for the publishable build project — so they are reached not by ordinary upward
`tsconfig.json` discovery but by `projectService`'s `allowDefaultProject` list plus
`defaultProject: "packages/core/tsconfig.test.json"`, with the file-match cap raised to 64.
Under `typescript@6.0.3` that fallback stops supplying types: `pnpm exec turbo run lint` reports
29 errors of the form "Unsafe call of a type that could not be resolved" and "Unsafe member access
`.argv` on a type that cannot be resolved" across `packages/core/bench/index.ts`, `runner.ts` and
`trace-deopt.ts`, on ordinary Node globals (**F13**). They are not real defects: `tsc --noEmit -p
packages/core/tsconfig.test.json` exits `0` under the same compiler, and the same lint run at
`typescript@5.9.3` is clean with ESLint and `typescript-eslint` held constant.

The constraint on any answer is fixed and is not a preference: **type-aware coverage of both trees
must survive at full strength**, because `@typescript-eslint/no-explicit-any` with every
relaxation off is what enforces CLAUDE.md rule 1, and `packages/core/test/lint-rules.test.ts` is
the repository's own proof that it fires. An answer that silences the 29 errors by removing those
trees from type-aware linting is not an answer to this decision; it is a reversal of D1's
enforcement model.

**Recommendation.** Replace `projectService` with classic `parserOptions.project` for the
`test/**` and `bench/**` globs, pointed at the existing `packages/core/tsconfig.test.json` (and
`packages/renderers/tsconfig.test.json`, which already exists alongside it), while leaving `src/**` on `projectService`. This is the
option the probe actually verified: linting those same files through classic
`parserOptions.project` against that tsconfig exits `0` under `typescript@6.0.3`.

**Why.**

- **It is the only option with a measurement behind it.** The other two are plausible and
  untested. For a fix that unblocks a commit in a ten-commit sequence, "verified to exit 0" is
  worth more than "should also work".
- **It reuses a file that already exists and is already correct.** `packages/core/tsconfig.test.json`
  extends `packages/core/tsconfig.json`, sets `noEmit`, and includes `src/**`, `test/**` and
  `bench/**`. It was written for exactly this purpose and is already what the current
  `defaultProject` points at. Nothing new is introduced; only the mechanism that consumes it
  changes.
- **It deletes the fragile part.** The current config carries a hand-maintained
  `allowDefaultProject` array of thirteen globs — including two entries for files that are not on
  disk (`__hot-path-fixture-proof__.ts`, used as a virtual `filePath` by the lint meta-test) — and
  raises `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` to 64 to fit it. That
  list drifts every time a test directory is added. A project-based association is derived from
  the tsconfig's own `include`, so adding a directory to `tsconfig.test.json` is the single edit.
- **Its known cost is honest and bounded.** Classic `parserOptions.project` is the older mode;
  `typescript-eslint` documents `projectService` as the recommended default and is likely to
  invest there. So this recommendation trades a currently-broken recommended path for a
  currently-working legacy one, and it should be revisited when `typescript-eslint` ships a
  release that fixes the fallback under TypeScript 6 — at which point reverting is a small,
  self-contained diff. It is also slower on large workspaces; this workspace is three packages
  and the difference is not expected to be observable, but that is an expectation, not a
  measurement.
- **The virtual-`filePath` case needs explicit care.** `packages/core/test/lint-rules.test.ts`
  drives ESLint's Node API with a `filePath` that does not exist on disk, under
  `packages/core/src/decimation/`. Whatever shape is chosen, that meta-test staying green is part
  of this decision's exit criterion, not an afterthought — it is the only automated proof the
  bans still fire.

**Alternatives rejected.**

| Alternative | Concrete cost |
|---|---|
| Add a real `tsconfig.json` inside each `test/` and `bench/` directory | **Refuted by measurement (F17)**, not merely unmeasured. The config is discovered — the project service reports it — and the lint still fails with the identical 29 errors on the identical lines, because the defect is in `projectService`'s program construction under `typescript@6.0.3` and not in how the project is located. Its other costs (four or more new tsconfig files alongside the two that already cover those trees, a second place declaring `test/**` compiler options) are now moot. |
| Extend each package's `tsconfig.json` `include` to cover `test/**` and `bench/**` | **Falls to the same cause as the row above (F17)**: it reaches the files through the same `projectService` discovery path that was measured failing, so it does not turn the lint green either. Independently, `tsconfig.json` is the **publishable build project**: it emits declarations via `tsup` and is what `turbo run build` runs. Pulling test and bench sources into it means the build project type-checks files it must never emit, and any error in a bench file becomes a build failure rather than a lint failure. `tsconfig.test.json` exists precisely to keep those two concerns apart, and this option collapses that separation to save one file. Rejected on those grounds, not on cost. |
| Keep `projectService` and add the failing bench files to `allowDefaultProject` | They are already in it (`packages/core/bench/*.ts` is an existing entry). The fallback itself is what broke, so extending its input list cannot fix it. |
| Keep `projectService` and pin `typescript` to `5.9.3` | A real option, and it is the zero-cost path — but it is the choice **P11** already made in the other direction. Reopening it here would re-litigate a confirmed product decision through a technical one. |
| Disable type-aware linting for `test/**` and `bench/**` | Silences all 29 errors in one line and forfeits CLAUDE.md rule 1 enforcement across every test and bench file. Explicitly out of bounds. |

**Reversibility: cheap, and deliberately so.** The whole decision is confined to
`eslint.config.js`'s `languageOptions.parserOptions` block. Reverting is one block swap with no
effect on any other file, which is what makes it safe to adopt the legacy mode now and revisit
when upstream fixes the fallback. The exit criterion is unchanged in either direction:
`pnpm exec turbo run lint` exits `0`, `packages/core/test/lint-rules.test.ts` passes, and a file
under `test/` or `bench/` containing an explicit `any` still reports
`@typescript-eslint/no-explicit-any`.

**What the maintainer is being asked.** Whether to adopt the verified classic-`project` mode now
(recommended), or to spend the extra effort on per-tree tsconfig files for a shape that survives
the eventual return to `projectService` without a second migration.

---

## File Changes

| Action | File Path | Description |
|---|---|---|
| MODIFY | `pnpm-workspace.yaml` | `vitest`/`@vitest/coverage-v8` → `5.0.0`; `@types/node` → `26.5.1`; `typescript` → `6.0.3` (corrected from the rejected `7.0.2`, D11); `eslint` → `10.10.0`; `typescript-eslint` → `8.70.0`; `vite` → `8.3.0`; `happy-dom` → `20.14.5`; `fast-check` → `4.10.0`; add `@vitest/browser-playwright` `5.0.0`, `playwright` `1.63.0`, `pixelmatch` `7.2.0`. |
| MODIFY | `package.json` (root) | `vitest` devDependency follows the catalog; `typescript` follows the catalog rather than its own `^5.7.0` range (**P12**, **F15**, D8 commit 3); `turbo` → `2.10.13`; add `check:freshness` script (D9). |
| MODIFY | `tsconfig.base.json` | Comment at `target: "ES2022"` stating it is a downstream-browser contract, not a build-host one (**P10**). Value unchanged. Adds `"ignoreDeprecations": "6.0"` with a comment naming `tsup`'s hardcoded `baseUrl` as the cause and TypeScript 7 as its expiry (**P11**, **F11**, R12). |
| MODIFY | `apps/playground/tsconfig.json` | Add `"allowImportingTsExtensions": true`; legal because the config already sets `"noEmit": true` (**P11**, **F12**). |
| MODIFY | `packages/core/test/decimation/allocation-gate.test.ts` | Read `kind`/`flags` from `entry.detail` instead of off the `PerformanceEntry` (line 83, **P9**/`DEP0152`). |
| MODIFY | `packages/core/test/viewport/transform-allocation.test.ts` | Same `DEP0152` fix (line 51). |
| MODIFY | `eslint.config.js` | **F13**: rework how `test/**` and `bench/**` are associated with a TypeScript project, replacing the `projectService` `defaultProject` fallback that `typescript@6.0.3` breaks (D13, D8 commit 6). ESLint 10 itself requires no edit here (**F9**). |
| NEW | `scripts/check-dependency-freshness.mjs` | **P7** enforcement: newest stable release at least two days old, never read off the `latest` dist-tag (D9). |
| UNCHANGED | `packages/core/tsconfig.json`, `packages/renderers/tsconfig.json` | `lib` arrays deliberately unchanged (D10). |
| UNCHANGED | `.nvmrc`, `engines.node`, `node-version` in both workflows | Already consistent at Node 24; **P8** audit found nothing to do. |
| MODIFY | `vitest.config.ts` | Delete top-level `pool`/`poolOptions`; add `pool`/`execArgv` to `core` and `renderers`; add fifth `visual` project; rewrite the relative-root comment. |
| MODIFY | `turbo.json` | Add `test:visual`; `test` gains `dependsOn: ["test:visual"]`. |
| MODIFY | `packages/core/package.json` | `test` script gains `--config ../../vitest.config.ts --project core`. |
| MODIFY | `packages/renderers/package.json` | `test` script filtered to `renderers`+`renderers-dom`; add `test:visual`; add `./font` and `./fixtures` exports; add `@vitest/browser-playwright`, `playwright` devDependencies (`catalog:`). |
| MODIFY | `packages/renderers/tsup.config.ts` | Entries become `src/index.ts`, `src/font/index.ts`, `src/fixtures/scenarios.ts`. |
| MODIFY | `packages/renderers/src/style.ts` | `font: "10px sans-serif"` → `font: '10px "TraceKit Inter"'` (line 39). |
| NEW | `packages/renderers/src/font/tracekit-inter.woff2.ts` | Generated base64 data-URL constant (committed). |
| NEW | `packages/renderers/src/font/index.ts` | `TRACEKIT_INTER_FAMILY`, `ensureDefaultFont()`. |
| NEW | `packages/renderers/src/font/LICENSE-Inter.txt` | SIL OFL 1.1 text, shipped in the package. |
| NEW | `packages/renderers/src/fixtures/scenarios.ts` | `ScenarioFixture` type + the five frozen records. |
| NEW | `packages/renderers/test/visual/canvas2d.visual.test.ts` | One `toMatchScreenshot` case per fixture, platform-skip guard. |
| NEW | `packages/renderers/test/visual/__screenshots__/*.png` | Five goldens, generated by the D6 job. |
| NEW | `packages/renderers/test/node/font-default.test.ts` | Default is not a generic family; override works; `dist/font/index.js` ≤ 24 KB. |
| MODIFY | `packages/renderers/test/node/axes-grid.test.ts` | Only where it asserts the literal default font string. |
| MODIFY | `.github/workflows/ci.yml` | Playwright binary cache + install steps; `verify-turbo-ran.mjs test:visual`; non-skipped-visual-case assertion; `__diffs__` artefact upload; dependency-freshness step (D9); deprecation-warning step with the `DEP0169` allowlist entry (D12). |
| NEW | `.github/workflows/update-visual-goldens.yml` | `workflow_dispatch` golden regeneration, pushed directly onto the dispatched ref — no PR (this repository has none until 1.0.0). |
| MODIFY | `.gitignore` | `packages/renderers/test/visual/__screenshots__/__diffs__/`. |
| REMOVED (never landed) | `.github/CODEOWNERS` | Written, then removed: a required-review gate has nothing to attach to with no PR workflow. |
| NEW | `.changeset/*.md` | One `patch` for `@trace-kit/renderers`: default label font changed. |
| UNCHANGED | `scripts/verify-turbo-ran.mjs` | Invoked with a second task name; no edit. |
| UNCHANGED | `packages/core/src/**`, `packages/renderers/src/canvas2d/**`, `packages/renderers/src/path/**` | No rendering behaviour changes. |

---

## Risks & Mitigations

| id | Risk | Mitigation | Residual |
|---|---|---|---|
| **R1'** | A Chromium bump inside a Playwright upgrade shifts antialiasing and reds the whole corpus at once. | `playwright` pinned through `catalog:` so the bump is a deliberate lockfile change; D6 makes regeneration a one-dispatch operation. | Real. The corpus is only ever as stable as the pinned browser; a bump is expected to cost one regeneration commit. |
| **R2'** | The single D2 threshold is wrong in one direction or the other. | Five scenarios only, one number, uniform — so the first flake identifies itself. D1 removed the dominant instability source rather than absorbing it. | The first real CI runs are the measurement. If `noise-floor` flakes, that is the evidence D2 said it was waiting for. |
| **R3'** | `ensureDefaultFont()` not awaited before `draw()` → goldens painted with a fallback family. | The visual test's setup awaits it and asserts its `true` return; `axes-grid`'s golden would visibly differ. Add an assertion that `document.fonts.check('10px "TraceKit Inter"')` is true before the first `draw()`. | Low, and loud. |
| **R4'** | CI wall-clock: browser download + Chromium start. | Binary cache keyed on the lockfile; `--project` filters (D5) reduce three browser launches to one; `test:visual` is separately Turborepo-cached on `src/**` + `test/visual/**`. | Cold-cache runs still pay the download. Bounded and known. |
| **R5'** | PNG churn is unreviewable — and there is no PR to review it in anyway. | D6's two durable signals (bot provenance + fixed commit message, typed dispatch reason), both permanent in `git log` with no PR or `CODEOWNERS` required to carry them. | No reviewer moment exists at all before 1.0.0; anyone can later confirm a golden came from the sanctioned path for a stated reason, but nobody is asked to look at the pixels first. |
| **R6'** | The inherited-flags evidence (**C10**, **C11**) was read from Playwright `main`, not the pinned release. | Re-verify `chromiumSwitches.ts` against the exact `playwright` version the lockfile resolves, at apply time. No launch flag is configured here either way, so the finding is informational. | Low. |
| **R7** (new) | The `--project` filter edits change what `pnpm --filter <pkg> test` runs for three packages. | Explicitly surfaced in D5's reversibility note; follows the shape `apps/playground/package.json:11` already uses. | Behavioural change to the dev loop; maintainer should confirm. |
| **R9'** | Four simultaneous majors (`typescript` 7, `eslint` 10, `@types/node` 26, `vitest` 5) plus a new test mechanism plus a public-API font change make a red run unattributable. | **D8**'s ten-commit sequence: one major per commit, each with a named command as its binary exit criterion, and the PR merged unsquashed. | Real but bounded. Attribution costs one `git bisect` step per commit instead of a guess. Scope was settled by **P8** and is not reopened. |
| **R10'** | ESLint 10 and TypeScript 6 were expected to require source or config changes across every package, extent unknown. | **Measured** in `toolchain-probe.md` part 2 against a detached worktree of `HEAD`, one variable at a time. ESLint half: **closed** — `eslint@10.10.0` + `typescript-eslint@8.70.0` lints green with no edits (**F9**). `@types/node` half: **closed** (**F10**). TypeScript half: **known**, not open — exactly three fixes (**F11**, **F12**, **F13**), each with a verified remedy, all landing in **D8** commit 6. Suite green with the whole upgrade applied (**F14**). | **Mostly closed.** What remains is the *shape* of the **F13** fix, which is **D13** and needs the maintainer, plus the ordinary possibility that the ten-commit sequence surfaces an interaction the single-variable probe could not. The version question stays **closed** (**D11**). |
| **R11'** | `@types/node` jumps four majors (22 → 26) under `strict` + `noUncheckedIndexedAccess`. | Lands alone as **D8** commit 4, after the `DEP0152` fix that rewrites the two `node:perf_hooks` consumers and before the compiler bump, so a new diagnostic is attributable to the declarations. **D10** fixes the response: do not widen `lib` to make a Node-only declaration compile. | Moderate. `@types/node` is a devDependency nowhere reached by `src/**`, so the blast radius is the build, not the package contract. |
| **R12'** | **F2**/**F3**/**F4** were measured against `vitest@5.0.1`; the target is `5.0.0`. | **D8** commit 7 re-confirms all three against `5.0.0` as its first act, before the config is touched. | Low — same minor line — but unproven until re-run. The probe is evidence about `5.0.1`, and is labelled as such everywhere it is cited. |
| **R12** | The `ignoreDeprecations: "6.0"` suppression **F11** requires unblocks TypeScript 6 and blocks TypeScript 7: the option stops functioning entirely in 7.x, so the same line that makes `turbo run build` pass at `6.0.3` makes it fail at `7.x`. The cause is external and unfixed — `tsup@8.5.1`, its newest release, hardcodes `baseUrl` at `tsup/dist/rollup.js:6837`. The repository therefore cannot reach TypeScript 7 until `tsup` changes or is replaced, **independently of** the `typescript-eslint` gate in **R10'**. | Documentary, because no technical mitigation exists: **P11** requires the suppression to carry a comment naming `tsup` and stating the expiry, so the next reader attempting TypeScript 7 finds the second gate before spending time on the first. **D11** records both gates together. | Real and long-lived. Two independent upstream projects now gate the same future upgrade; clearing either one alone is not enough. Mirrors `proposal.md` **R12** — the unprimed id is deliberate, and the primed **R12'** above is an unrelated design-owned risk. |
| **R8** (new) | `src/fixtures/scenarios.ts` ships to consumers as part of the public package. | Confined to its own tsup entry and `./fixtures` subpath; `sideEffects: false` keeps it out of any bundle that does not import it. | Accepted deliberately: the spec requires a stable import path for change 7. |

---

## CLAUDE.md Compliance

- **Rule 1 (no `any`)**: the path-resolution callbacks, the fixture schema and `ensureDefaultFont()`
  are all explicitly typed against installed declarations; the `FontFaceSet | undefined` narrowing
  in D1 is a real narrowing, not a cast.
- **Rule 2 (zero-copy / zero-GC)**: fixture payloads are `Float64Array`s built once at module scope
  and passed by reference; nothing allocates inside a draw. The `--expose-gc` gates that enforce
  this move to project scope (D4) and their assertions are commit 1's exit criterion (D8).
- **Rule 3 (dual engine)**: untouched. The fixture schema carries no engine field so that engine
  selection stays a runtime/controller concern, which is what makes change 7's parity comparison
  expressible at all.
- **Rule 4 (reactivity isolation)**: no framework package exists yet; the constraint is recorded in
  the fixture module's doc comment for changes 10/11.
- **Rule 5 (isomorphic core)**: `packages/core/src/**` is not touched. Within
  `packages/renderers`, `document`/`FontFace` access is confined to `src/font/index.ts`, which
  `Canvas2DRenderer` does not import — the `OffscreenCanvas` worker path stays intact.
- **Rule 6 (physics-preserving decimation)**: `resonance-peak` and `decimation-minmax` are the two
  fixtures whose goldens make peak survival and Min-Max extrema preservation visually assertable
  for the first time.
- **Rule 7 (zero Engram)**: no `mem_*` tool is used; all state lives under
  `openspec/changes/browser-visual-regression-harness/`.
- **Rule 8 (low-velocity versioning)**: one `patch` changeset for `@trace-kit/renderers` (D1). The
  **P8** toolchain bumps are devDependency-only and change no published artefact, so they add no
  further changeset — with one caveat: the `typescript@6.0.3` bump (**D11**) means the emitted
  `.d.ts` files are produced by a different compiler, and the changeset text should say so even
  though the emit target (`ES2022`, **P10**) is unchanged.

---

## Verification Surface

| Decision | How it is proven |
|---|---|
| D1 | `packages/renderers/test/node/font-default.test.ts`: default contains no generic family; override returns the supplied string; `dist/font/index.js` ≤ 24 KB. Browser-side: `document.fonts.check` before first draw. |
| D2 | A byte-identical render passes; a deliberately perturbed render exceeding the ratio fails and reports both computed ratio and configured threshold. |
| D3 | Directory listing contains exactly five PNGs, none matching `/(darwin\|linux\|win32\|chromium)/`; path resolution is not a function of `process.platform`. |
| D4 | `test.projects.length === 5`; exactly one entry has no `environment`; `globalThis.gc` is a function inside the three allocation gates. |
| D5 | `node scripts/verify-turbo-ran.mjs test` and `… test:visual` both exit 0; `turbo run test --dry=json` lists `test:visual` in the plan; CI asserts ≥ 1 non-skipped visual case. |
| D6 | No `package.json` script and no file under `scripts/` contains `--update` or writes to `__screenshots__/`; the dispatch workflow's `git diff --exit-code` guard fails on any non-golden change. |
| D7 | Exactly five fixture records; no field names a backend; `resize` receives the fixture's literal `dpr`; a consuming test imports via `@trace-kit/renderers/fixtures`. |
| D8 | Each of the ten commits passes its own exit criterion from the table in **D8**; commit 1 additionally passes `pnpm run test 2>&1 \| grep -c DEP0152` → `0`; commit 10's first run fails with "no existing reference screenshot found". |
| D9 | `pnpm run check:freshness` exits `0` against the 2026-09-14 cutoff with a 2-day window, and exits non-zero when any catalogued entry is reverted to its pre-change version. A unit test asserts the script reports a `26.x` target for `@types/node` despite its `latest` dist-tag being `22.20.3`. |
| D10 | `pnpm exec turbo run typecheck` and `pnpm exec turbo run build` green with both `lib` arrays byte-identical to their pre-change values; `git diff` over `packages/*/tsconfig.json` is empty. |
| D11 | All four verification commands exit `0` at `typescript@6.0.3` **with the three fixes applied** — `build` with no `TS5101` (**F11**), `typecheck` with no `TS5097` (**F12**), `lint` with no "could not be resolved" diagnostic (**F13**), and `pnpm run test` reporting the full suite (**F14**). Each fix is proven load-bearing by deleting it and observing the named diagnostic return. `typescript@7.0.2` was measured to exit non-zero and is recorded, not retested. `packages/core/test/lint-rules.test.ts` stays green — it is the proof that the `any`/`as never` bans still fire. |
| D12 | The CI deprecation step exits `0` on the four verification commands; a deliberately reintroduced direct `entry.kind` read makes it exit non-zero. No `--no-deprecation`, `--no-warnings` or `removeAllListeners("warning")` appears in `package.json`, `turbo.json`, `vitest.config.ts` or `.github/workflows/**`. |
| D13 | `pnpm exec turbo run lint` exits `0` at `typescript@6.0.3`; `pnpm --filter @trace-kit/core typecheck:test` (the repository's existing `tsc -p tsconfig.test.json --noEmit` script) exits `0` (the control that proves any "could not be resolved" diagnostic is a linter-config defect, not a type error); a file placed under a package's `test/` or `bench/` tree with an explicit `any` still reports `@typescript-eslint/no-explicit-any`, proving type information is present rather than the tree being skipped; and `packages/core/test/lint-rules.test.ts` passes, including its virtual-`filePath` case. |

Commands, per CLAUDE.md §Verification: `pnpm exec turbo run typecheck`,
`pnpm exec turbo run lint`, `pnpm run test`, `pnpm exec turbo run build`.
