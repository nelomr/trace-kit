# Pre-proposal state: browser-visual-regression-harness (roadmap order 5.5)

Contract: `gentle-ai.sdd-preproposal/v1`
Revision: 6
Artifact store: `openspec` (this repository; CLAUDE.md rule 7 forbids any external memory tool)
Date: 2026-09-16

## Exploration

- Outcome: `done`
- Reference: `openspec/changes/browser-visual-regression-harness/exploration.md`

## Research

- Requested: yes
- Classes: toolchain maturity, determinism controls, comparator tooling, storage weight, prior art
- Outcome: `done` (revision 2; revision 1 was reclassified `partial` and re-run)
- Reference: `openspec/changes/browser-visual-regression-harness/research.md`

## Product decisions

Both confirmed by the maintainer after the research evidence was presented.

- **P1 — Verification strategy: PNG goldens with pixel diffing.**
  Confirmed. Precedent: plotly.js and deck.gl (research C18, C19). The alternatives
  (canvas-operation-stream comparison, as ECharts and uPlot do — C20, C21) were presented
  with their tradeoff stated plainly: they are deterministic by construction but never assert
  a painted pixel, which leaves risk R1 of `renderers-canvas2d` open. Pixel goldens were
  chosen because closing R1, and producing reference images that change 7 (`renderers-webgl2`)
  can reuse to prove engine parity, is this change's reason to exist.

- **P2 — Runner: upgrade Vitest to 5.x and adopt browser mode with the Playwright provider.**
  Confirmed. The repository resolves `vitest` to 3.2.7 (research C1), so the native
  `toMatchScreenshot` assertion (C2) is not available without a major upgrade. The maintainer
  accepted that upgrade into this change's scope rather than adding a second test runner
  (which would bypass the existing `scripts/verify-turbo-ran.mjs` CI guard) or hand-rolling a
  comparator under Vitest 3. The v4 breaking changes concentrated on browser mode (C4) are
  therefore in scope: provider packages split out, provider factory required in place of a
  string, `environment: "browser"` forbidden.

- **P3 — Config migration: remove both obsolete 3.2.7 workarounds.**
  Confirmed. Migrate `poolOptions.forks.execArgv` to `test.execArgv` and scope it down to the
  projects that actually need `--expose-gc`, rather than applying it workspace-wide; keep the
  absolute project `root` construction but rewrite its comment, since the behaviour it guards
  against no longer exists on 5.x. Rationale given and accepted: a long comment that explains a
  Vitest limitation which has been fixed is worse than no comment. Evidence: `toolchain-probe.md`
  F2, F3, F4, F7.

- **P4 — Initial corpus: parity-minimal.**
  Confirmed. Seed the corpus with only the scenarios change 7 will need to compare
  Canvas2D against WebGL2 — a simple trace, axes with grid, a resonance peak, a noise floor, and
  one decimation case — rather than sweeping the current Canvas2D surface. Rationale accepted:
  every golden is maintenance debt, so the corpus grows when WebGL2 asks for it, not before.

- **P5 — Platform policy: self-hosted font, single Linux corpus.**
  Confirmed after the maintainer challenged the original framing. Two parts:

  1. **Self-host the label font.** `packages/renderers/src/style.ts:39` currently defaults to
     `font: "10px sans-serif"`. `sans-serif` is a generic family resolved by the host OS, so the
     same code draws Helvetica on macOS, DejaVu Sans on Ubuntu and Arial on Windows — different
     glyph outlines, not different antialiasing. The harness self-hosts a WOFF2 and requests it
     by name, which removes font substitution as a source of divergence entirely. This is a
     precondition for a stable corpus, not an optimisation.
  2. **One corpus, generated and compared on `ubuntu-latest` only.** Visual cases skip on
     developer machines with an explicit message. Rationale accepted: the corpus does not and
     cannot certify what an end user sees — every user has their own browser, GPU and fonts. It
     certifies that the renderer paints what it should, and that WebGL2 paints what Canvas2D
     paints. Both are single-platform questions. A macOS corpus would additionally exercise
     Chromium's macOS font stack, which is not TraceKit's code.

  Rejected alternatives and why: OS-suffixed corpora (Playwright's own default, research C8) were
  rejected on maintenance cost — N image sets, N CI jobs, regeneration of every set on any render
  change, and silent divergence when one set is regenerated alone. The measured precedent is
  plotly.js, which carries a hand-maintained flaky list raising pixelmatch thresholds to 0.5 for
  font-heavy cases against a default of 0, with the source comment "Sometimes fonts don't render
  quite right, so up the threshold for them" — that is the cost on a *single* platform. Masking
  label regions out of the diff (`toHaveScreenshot`'s `mask`, research C6) was presented and not
  selected; it remains available to design if text proves unstable even with a self-hosted font.

- **P6 — The self-hosted font becomes the library default.**
  Confirmed. `packages/renderers/src/style.ts:39` currently defaults to `font: "10px sans-serif"`.
  `sans-serif` is a generic family the host OS resolves, so the same code draws different glyph
  outlines on macOS, Linux and Windows. The font ships with the library and becomes the default,
  rather than being set only in test fixtures.

  This is a deliberate public-API decision, not a test-harness detail, and it was put to the
  maintainer as such. Consequences accepted: charts render identically across operating systems
  for every consumer, the default visual output changes for anyone already using the library, and
  the package gains the font's weight. Design must resolve which font, how it is embedded and
  loaded, how a consumer overrides it, and whether the change needs a changeset entry under the
  repository's low-velocity versioning policy.

- **P7 — Dependency freshness policy.**
  Confirmed. Every catalogued dependency tracks the newest stable release that is at least
  **two days old** at the time of the change. Two days, not two weeks: the maintainer set the
  window explicitly after seeing that a two-week window would have excluded the Vitest 5 line
  this change depends on. Prereleases, release candidates and beta dist-tags never qualify.

- **P8 — Toolchain modernisation is in scope for this change.**
  Confirmed. The maintainer was offered a separate toolchain change and chose to fold the work
  into this one, having been told that TypeScript 7 and ESLint 10 are majors that can move a
  lot of code and that combining them with the harness makes it harder to attribute a
  regression. Recorded as an informed decision, not an oversight.

  Audit performed 2026-09-16. Node itself is already correct and consistent — `engines`
  (`>=24`), `.nvmrc` (`24`), and `node-version: 24` in both `.github/workflows/ci.yml` and
  `release.yml`. No change needed there.

  Catalogue targets under P7 (cutoff 2026-09-14):

  | Package | Current | Target | Published |
  |---|---|---|---|
  | `@types/node` | `^22.10.0` | `26.5.1` | 2026-09-09 |
  | `typescript` | `^5.7.0` | `6.0.3` | 2026-04-16 |
  | `eslint` | `^9.17.0` | `10.10.0` | 2026-09-04 |
  | `vitest` | `^3.0.0` | `5.0.0` | 2026-09-03 |
  | `@vitest/coverage-v8` | `^3.0.0` | `5.0.0` | 2026-09-03 |
  | `typescript-eslint` | `^8.19.0` | `8.70.0` | 2026-09-07 |
  | `vite` | `^8` | `8.3.0` | 2026-09-10 |
  | `happy-dom` | `^20.14.0` | `20.14.5` | 2026-09-12 |
  | `fast-check` | `^4.0.0` | `4.10.0` | 2026-09-11 |
  | `turbo` | (root dep) | `2.10.13` | 2026-09-14 |
  | `playwright` | new | `1.63.0` | 2026-09-04 |
  | `@vitest/browser-playwright` | new | `5.0.0` | 2026-09-03 |
  | `pixelmatch` | new | `7.2.0` | 2026-04-29 |

  `@types/node` is the most consequential: the catalogue describes Node 22 while every runtime
  declaration pins Node 24.

  **TypeScript target corrected from 7.0.2 to 6.0.3, on measurement.** The first pass selected
  `typescript@7.0.2` as the newest stable release satisfying P7. It is unusable here, and this
  was established by running it rather than by reading a peer range:

  - `typescript-eslint@8.70.0` declares `peerDependencies.typescript` as `>=4.8.4 <6.1.0`.
    8.70.0 is its newest release, and every published `8.70.1-alpha.*` declares the same range.
    No released `typescript-eslint` accepts TypeScript 7.
  - Forcing the install past the peer conflict does not degrade gracefully. `eslint` exits with
    a hard error from `typescript-eslint/dist/index.js`: `typescript-eslint does not support
    TS 7.0.`, pointing at upstream issue 10940, which tracks support for TS **>=7.1**.
  - This repository's `eslint.config.js` is entirely `tseslint.configs.recommendedTypeChecked`
    with `parserOptions.projectService`. Type-aware linting is what enforces CLAUDE.md rule 1
    (no `any` anywhere in production code). Losing it to gain a compiler major is not a trade
    this change may make.
  - `typescript@6.0.3` (2026-04-16) is the newest release inside the supported range and
    satisfies P7. Verified in an isolated install: `typescript@6.0.3` + `eslint@10.10.0` +
    `typescript-eslint@8.70.0` resolves without peer conflict and `eslint` exits 0 on a
    type-checked source file.

  TypeScript 7 is therefore out of scope for this change and stays out until
  `typescript-eslint` ships support for it.

  Note for apply: `toolchain-probe.md` measured Vitest **5.0.1**. The target is **5.0.0**
  (5.0.1 is one day old and fails P7). Same minor, but findings F2/F3/F4 must be re-confirmed
  against 5.0.0 before the config migration is treated as proven.

- **P9 — Zero deprecation warnings.**
  Confirmed. No repository command may emit a Node deprecation warning attributable to
  repository code. One real instance was found and is in scope: `DEP0152`
  ("Custom PerformanceEntry accessors are deprecated. Please use the detail property"), emitted
  on every `pnpm run test`, caused by reading `kind`/`flags` directly off a `PerformanceEntry`
  at `packages/core/test/decimation/allocation-gate.test.ts:83` and
  `packages/core/test/viewport/transform-allocation.test.ts:51`. The fix is to read them from
  `entry.detail`. `DEP0169` (`url.parse()`) also appears during `pnpm install`, but it
  originates in pnpm 9.15.4 itself, not in repository code, and is therefore out of scope.

- **P10 — Document the `ES2022` build target.**
  Confirmed as a documentation task, not a version change. `tsconfig.base.json:3` sets
  `target: "ES2022"` and neither `tsup.config.ts` overrides it, so that is the JavaScript
  emitted for consumers. This is correct and must not be raised to match the Node 24 toolchain:
  the target governs what downstream **browsers** must support, which is a different question
  from what version of Node builds and tests the code. The repository documents every other
  non-obvious choice in a comment and this one carries none, which is what made it look like an
  oversight. A comment stating the distinction is in scope.

- **P11 — TypeScript 6.0.3 lands, with its three known fixes.**
  Confirmed after measurement. `toolchain-probe.md` part 2 ran the upgrade against a detached
  worktree of `HEAD` and attributed every failure. The maintainer was offered `5.9.3` (the head
  of the 5 line, which satisfies P7 and costs nothing) and chose `6.0.3`, accepting these three
  in-scope fixes:

  1. **`ignoreDeprecations: "6.0"` in `tsconfig.base.json`** (F11). `tsup` hardcodes
     `baseUrl` in its declaration build (`tsup/dist/rollup.js:6837`), which TypeScript 6 reports
     as `TS5101`. No `tsconfig` in this repository sets `baseUrl`, and `tsup@8.5.1` is the newest
     published release, so there is no upstream fix. This suppression has a known expiry: the
     option stops functioning entirely in TypeScript 7. It MUST carry a comment saying so, naming
     `tsup` as the cause, so a later reader does not mistake it for a repository-owned choice.
  2. **`allowImportingTsExtensions: true` in `apps/playground/tsconfig.json`** (F12). Three
     imports carry an explicit `.ts` extension and pass under 5.9.3. Legal there because that
     config already sets `noEmit: true`.
  3. **Rework how `eslint.config.js` associates `test/**` and `bench/**` with a TypeScript
     project** (F13). TypeScript 6.0.3 breaks `typescript-eslint`'s `projectService`
     `defaultProject` fallback, producing 29 false "type that could not be resolved" errors on
     ordinary Node globals in `packages/core/bench/`. These are not real defects: `tsc --noEmit -p
     packages/core/tsconfig.test.json` exits 0 under the same compiler. The classic
     `parserOptions.project` mode pointed at that same tsconfig was verified to exit 0. Design
     owns the exact reshaping; the requirement is that type-aware linting keeps full coverage of
     `test/**` and `bench/**`, because that is what enforces CLAUDE.md rule 1.

  The ESLint 10 and `@types/node` 26 halves of P8 need no fixes at all (F9, F10), and the suite
  passes with all of it applied (F14).

- **P12 — Fix the root `typescript` pin.**
  Confirmed as in scope. `package.json` at the repository root declares `"typescript": "^5.7.0"`
  literally while every workspace package declares `"typescript": "catalog:"`. The root therefore
  does not follow the catalogue and drifts from it silently — observed during the probe, where the
  first install left the root on 5.9.3 while the catalogue already said 6.0.3 (F15). Change it to
  `"catalog:"`. This is a pre-existing defect found while performing the upgrade, not caused by
  it, and it would otherwise make P8's catalogue targets partly fictional.

Status: `confirmed`

## Delivery

- Execution mode: `interactive`
- Delivery strategy: `exception-ok` — single PR; the maintainer accepted `size:exception`
  up front rather than chaining slices.

## Local empirical evidence

- Reference: `openspec/changes/browser-visual-regression-harness/toolchain-probe.md`
- Measures the two Vitest 3.2.7 config behaviours the root config encodes, against 5.0.1.
  Both changed; both fail loudly rather than silently. Consumed by P3 and by proposal risk R3.

## Constraints carried into the proposal

- Goldens are generated on CI (`ubuntu-latest`) only. Development machines are macOS, and
  Playwright documents that rendering varies by host OS and headless mode (research C7), with
  OS-suffixed golden filenames as its own default behavior (C8).
- Playwright already applies `--force-color-profile=srgb` and `--enable-unsafe-swiftshader`
  on every Chromium launch (C10, C11). The four flags the exploration assumed
  (`--disable-gpu`, `--force-device-scale-factor`, `--disable-lcd-text`,
  `--font-render-hinting=none`) are unsourced and must not be cited (research: Withdrawn
  claims).
- Comparison is threshold-based on a mismatch ratio, never byte equality. deck.gl's
  production configuration is `pixelmatch` with `{threshold: 0.105, includeAA: true}` (C14).
- Golden storage in plain git, not Git LFS, is supported by measurement: deck.gl carries 214
  PNGs totalling 9.4 MB, 44 KB mean (C16, C17).
- Fixtures must be keyed by scenario (payload, domain, viewport, device pixel ratio) so change
  7 can reuse the identical fixture set for its engine-parity claim.

`proposal_ready`: true
