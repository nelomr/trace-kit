# Research: browser-visual-regression-harness (roadmap order 5.5)

Contract: `gentle-ai.sdd-research/v1`
Revision: 2
Outcome: **done**
Accessed: 2026-09-16

Research produces evidence only. It records no product decision and no recommendation;
those belong to the proposal and design phases.

Revision 2 supersedes revision 1. Revision 1 self-reported `done` while its own uncertainty
section left R1, R3 and R6 unanswered; it was reclassified `partial` and re-run. Every claim
below is backed by a fetched primary source. Claims that revision 1 carried on secondary
sourcing and that no primary source confirms are recorded under **Withdrawn claims**, not
under validated claims.

---

## Questions

- **R1** — Maturity, stability and API surface of Vitest browser mode with the Playwright
  provider; native screenshot assertion support.
- **R2** — Determinism controls documented for Playwright's screenshot assertions, and what
  Playwright itself documents about cross-platform golden mismatch.
- **R3** — Documented evidence on canvas rendering nondeterminism across OS/GPU/browser
  builds, and the launch flags that actually control it.
- **R4** — Pixel-diff tooling comparison: pixelmatch, odiff, looks-same.
- **R5** — Golden PNG storage in a git repository: repo weight, Git LFS tradeoffs.
- **R6** — Prior art: what canvas/WebGL charting libraries actually do for visual regression.

---

## Sources

| id | class | title | publisher | URL | accessed_at |
|---|---|---|---|---|---|
| S1 | primary | Visual Regression Testing (docs, v5.0.1) | vitest.dev | https://vitest.dev/guide/browser/visual-regression-testing | 2026-09-16 |
| S2 | primary | Browser Mode guide (docs, v5.0.1) | vitest.dev | https://vitest.dev/guide/browser/ | 2026-09-16 |
| S3 | primary | `vitest` npm dist-tags (`npm view vitest dist-tags`) | npm registry | https://registry.npmjs.org/vitest | 2026-09-16 |
| S4 | primary | vitest v4.0.0 release notes (`gh api repos/vitest-dev/vitest/releases/tags/v4.0.0`) | github.com | https://github.com/vitest-dev/vitest/releases/tag/v4.0.0 | 2026-09-16 |
| S5 | primary | `PageAssertions.toHaveScreenshot` API reference | playwright.dev | https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1 | 2026-09-16 |
| S6 | primary | Visual comparisons | playwright.dev | https://playwright.dev/docs/test-snapshots | 2026-09-16 |
| S7 | primary | Docker | playwright.dev | https://playwright.dev/docs/docker | 2026-09-16 |
| S8 | primary | `chromiumSwitches.ts` (source) | microsoft/playwright | https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts | 2026-09-16 |
| S9 | primary | `chromium.ts` `_innerDefaultArgs` (source) | microsoft/playwright | https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/chromium.ts | 2026-09-16 |
| S10 | primary | Using Chromium with SwiftShader (`docs/gpu/swiftshader.md`) | chromium.googlesource.com | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md | 2026-09-16 |
| S11 | primary | `test/compare-image.js` (source) | visgl/deck.gl | https://github.com/visgl/deck.gl/blob/master/test/compare-image.js | 2026-09-16 |
| S12 | primary | `test/render/golden-images/` directory listing + file sizes (`gh api`) | visgl/deck.gl | https://github.com/visgl/deck.gl/tree/master/test/render/golden-images | 2026-09-16 |
| S13 | primary | `test/image/` directory (baselines, `compare_pixels_test.mjs`, `make_baseline.mjs`) | plotly/plotly.js | https://github.com/plotly/plotly.js/tree/master/test/image | 2026-09-16 |
| S14 | primary | `test/` directory and its README | apache/echarts | https://github.com/apache/echarts/tree/master/test | 2026-09-16 |
| S15 | primary | `test/` directory | leeoniya/uPlot | https://github.com/leeoniya/uPlot/tree/master/test | 2026-09-16 |
| S16 | primary | `test/` and `test/fixtures/` directories | chartjs/Chart.js | https://github.com/chartjs/Chart.js/tree/master/test | 2026-09-16 |
| S17 | secondary | odiff README and pixel-diff benchmarks | github.com, vizzly.dev | https://github.com/dmtrKovalenko/odiff | 2026-09-16 |
| S18 | local | Repo state: `vitest.config.ts` projects, `node_modules/vitest/package.json` | this repository | `/vitest.config.ts` | 2026-09-16 |

---

## Validated claims

### R1 — Vitest browser mode

- **C1.** Vitest's published versions carry the dist-tags `V3: 3.2.7`, `V4: 4.1.11`,
  `latest: 5.0.1`. This repository resolves `vitest` to **3.2.7** — the head of the V3 line,
  two major versions behind `latest`. [S3, S18]
- **C2.** The native visual assertion `expect(element).toMatchScreenshot()`, with global
  defaults under `test.browser.expect.toMatchScreenshot` (`comparatorName`,
  `comparatorOptions` such as `threshold` and `allowedMismatchedPixelRatio`), is documented
  on the v5.0.1 docs. Its default comparator is `pixelmatch`, with pluggable third-party
  comparators. [S1]
- **C3.** Browser mode supports the Playwright and WebdriverIO providers. A third `preview`
  provider exists and is documented as not recommended for CI. [S2]
- **C4.** Vitest v4.0.0 contains breaking changes to browser mode specifically: browser
  providers moved into separate packages, a provider **factory** is required in place of a
  provider string, and setting `environment` to `browser` is now forbidden. [S4]
- **C5.** No primary source states a specific version at which browser mode's experimental
  flag was removed. The v4.0.0 release notes do not say it, and the releases list does not
  say it. The stabilization *version* is unconfirmed; the stabilization *fact* as of the
  v5.0.1 docs is not in question, since those docs carry no experimental banner on the
  browser-mode guide. [S2, S4]

### R2 — Playwright determinism controls

- **C6.** `toHaveScreenshot` documents 14 options: `animations` (`"disabled"` stops CSS
  animations, CSS transitions and Web Animations), `caret` (`"hide"` hides the text caret),
  `clip`, `fullPage`, `mask`, `maskColor`, `maxDiffPixelRatio` ("An acceptable ratio of
  pixels that are different to the total amount of pixels, between `0` and `1`"),
  `maxDiffPixels`, `omitBackground`, `scale` (`"css"` gives a single pixel per CSS pixel),
  `stylePath`, `threshold` ("An acceptable perceived color difference in the YIQ color space
  between the same pixel in compared images, between zero (strict) and one (lax)"),
  `timeout`, `signal`. [S5]
- **C7.** Playwright documents rendering variance directly: "Browser rendering can vary based
  on the host OS, version, settings, hardware, power source (battery vs. power adapter),
  headless mode, and other factors. For consistent screenshots, run tests in the same
  environment where the baseline screenshots were generated." [S6]
- **C8.** Playwright's own baseline filenames embed the platform — e.g.
  `example-test-1-chromium-darwin.png`. OS-suffixed goldens are Playwright's documented
  default behavior, not a community workaround. [S6]
- **C9.** Playwright's Docker page contains **no** guidance on generating cross-platform
  consistent baselines; it defers the topic to the separate visual-comparisons page. The
  widely repeated "use the official Docker image to match baselines" advice is not stated by
  Playwright's own Docker documentation. [S7]

### R3 — Rendering nondeterminism and the flags that actually apply

- **C10.** Playwright's Chromium launcher already pushes `--force-color-profile=srgb` in its
  default switch list — a color-management determinism control applied to every launch
  without configuration. [S8]
- **C11.** Playwright's Chromium launcher already pushes `--enable-unsafe-swiftshader` on
  every launch, citing Chromium issue 40277080. Playwright-driven Chromium therefore runs
  WebGL on the SwiftShader software rasterizer when no usable GPU is present, by default.
  [S9]
- **C12.** The current Chromium SwiftShader flags are `--use-gl=angle --use-angle=swiftshader`
  (GL ES), `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` (WebGL)
  and `--use-vulkan=swiftshader`. The bare legacy form `--use-gl=swiftshader` does not appear
  in current Chromium documentation. The same document flags SwiftShader as a security risk
  because it runs JIT-ed code in the GPU process, which is why automatic WebGL fallback was
  deprecated. [S10]
- **C13.** Chromium's SwiftShader documentation does **not** address determinism or
  reproducibility of rendered output. No primary source consulted asserts that SwiftShader
  output is bit-reproducible across builds. [S10]

### R4 — Pixel-diff tooling

- **C14.** deck.gl's production comparator uses `pixelmatch` with
  `{threshold: 0.105, includeAA: true}` and compares a *ratio* of mismatched pixels against a
  per-test threshold, not an absolute count and not byte equality. [S11]
- **C15.** pixelmatch, odiff and looks-same all implement YIQ/perceptual-distance comparison
  with antialiasing awareness. They differ materially: odiff is SIMD-vectorized and
  benchmarked several times faster on large images; looks-same exposes a configurable
  `antialiasingTolerance` and CIEDE2000 tolerance; pixelmatch's antialiasing detection is not
  configurable. Reported mismatch counts diverge by an order of magnitude between tools on
  comparable inputs, so comparator choice changes pass/fail outcomes at real thresholds. [S17]

### R5 — Golden storage weight (measured)

- **C16.** deck.gl's committed golden set is a directly measurable real-world reference:
  **214 PNG files, 9.4 MB total, 44 KB mean, 515 KB largest, 7.6 KB smallest**. This is a
  measured figure from the repository itself, not an estimate. [S12]
- **C17.** deck.gl commits these PNGs as ordinary git objects — there is no Git LFS pointer
  indirection in that directory. A golden corpus of this size and shape is carried in a
  mainstream repository without LFS. [S12]

### R6 — Prior art (four projects confirmed, one probable-negative)

- **C18.** **plotly.js** uses pixel-image baseline diffing: `test/image/` holds `baselines/`,
  `compare_pixels_test.mjs`, `make_baseline.mjs` / `make_baseline.py`, and
  `compare_pixels_collections.json`. [S13]
- **C19.** **deck.gl** uses pixel-image baseline diffing for render tests:
  `test/render/golden-images/` plus `test/compare-image.js` built on `pngjs` + `pixelmatch`.
  The comparator writes a diff image, computes a mismatch ratio, and passes when the ratio is
  at or below the caller's threshold. [S11, S12]
- **C20.** **apache/echarts** does **not** use PNG goldens. Its `test/` README states the
  strategy is to compare the rendered canvas of the current version against the last release
  version, "either [on] the content of rendered canvas, or the stack of canvas operations",
  with a `./configure` script downloading a prior release build as the baseline. [S14]
- **C21.** **uPlot** does **not** use PNG goldens. It records and snapshots Canvas/Path2D
  **drawing commands** with seeded randomness, and replays them: "Snapshot comparisons still
  use the recorded commands, not pixels." [S15]
- **C22.** **Chart.js** shows no image-based visual regression testing: `test/` contains
  `fixtures/`, `integration/`, `specs/`, `types/`, with fixtures organized by chart component
  rather than by image, and no screenshot-comparison README. Moderate confidence — a rendered
  directory listing does not guarantee exhaustive recursive enumeration. [S16]

---

## Contradictions

1. **Pixel diffing is not the ecosystem default.** Of four confirmed charting projects, two
   (plotly.js, deck.gl) use PNG-golden pixel diffing and two (echarts, uPlot) deliberately
   avoid it in favor of comparing the canvas **operation stream**. The draw-command approach
   sidesteps rasterization nondeterminism by construction rather than tolerating it with a
   threshold. This contradicts the framing of the exploration, which treated pixel diffing as
   the obvious target and draw-call assertion as the weaker status quo. Design must treat
   these as two live options, not one option and one fallback. [S13, S11, S14, S15]
2. **SwiftShader determinism is asserted but unsourced.** Secondary fingerprinting literature
   claims software rendering is fully deterministic; Chromium's own SwiftShader document is
   silent on the subject. Do not build a determinism argument on it. [S10]
3. **Docker-for-baselines is folklore.** Playwright's Docker documentation does not make the
   cross-platform baseline recommendation that is widely attributed to it. Playwright's actual
   documented mechanism is OS-suffixed golden filenames. [S6, S7]
4. **Legacy vs current SwiftShader flag syntax.** `--use-gl=swiftshader` is superseded by the
   ANGLE-prefixed form. [S10]

---

## Withdrawn claims

Carried by revision 1 on secondary sourcing; no primary source confirms them. They must not
be cited as prior art in the proposal, spec or design.

- "Vitest browser mode became stable in 4.0" — no primary source names a version. [S4]
- "The official Playwright Docker image is the documented way to get consistent
  baselines" — not stated by that documentation. [S7]
- `--disable-gpu`, `--force-device-scale-factor`, `--disable-lcd-text`,
  `--font-render-hinting=none` as documented determinism controls — none appear in
  Playwright's default switch list or in the Chromium documents consulted. Playwright's
  actual applied determinism controls are `--force-color-profile=srgb` and
  `--enable-unsafe-swiftshader`. [S8, S9]

---

## Uncertainty and freshness

- All sources accessed 2026-09-16. Source files fetched from `main`/`master` reflect the
  current head of those repositories, not a tagged release; a design that depends on an exact
  flag list should re-verify against the version actually installed.
- R1's stabilization version remains unconfirmed and is recorded as such. It does not block
  design: the decision-relevant fact is C1 (this repo is on 3.2.7) together with C4 (v4
  breaking changes are concentrated in browser mode), both primary-sourced.
- C22 (Chart.js negative) is moderate confidence.
- S17 is the only substantive secondary source retained, and only for the comparative
  characterization in C15; the concrete comparator configuration in C14 is primary.

---

## Gaps carried into design

1. Adopting `toMatchScreenshot` requires a Vitest 3 → 5 major upgrade across every workspace
   project, through a v4 whose breaking changes land on browser mode itself. The cost and
   blast radius of that upgrade are unestimated. [C1, C2, C4]
2. Pixel goldens versus canvas draw-command snapshots is an unresolved fork with confirmed
   production precedent on both sides. [Contradiction 1]
3. No primary source establishes that any approach yields byte-reproducible output across
   macOS and Linux. Every confirmed project tolerates divergence — by threshold (plotly.js,
   deck.gl) or by not comparing pixels at all (echarts, uPlot). [C7, C13]
