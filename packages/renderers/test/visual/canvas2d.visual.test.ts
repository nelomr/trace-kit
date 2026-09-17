import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { SCENARIO_FIXTURES } from "@trace-kit/renderers/fixtures";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";

// Goldens are generated and compared exclusively in CI on `ubuntu-latest` (P5) — Chromium's
// font/AA rasterisation is not guaranteed byte-identical across host operating systems, and a
// developer machine running this locally would either produce a spurious mismatch against a
// Linux-generated reference or (on first run) silently create a macOS/Windows reference nobody
// else's CI run would ever match. `__TRACEKIT_VISUAL_IS_LINUX_CI__` is a Vite `define`
// replacement baked in at config-evaluation time (see `vitest.config.ts` and
// `test/visual/globals.d.ts`), since `process.platform` does not exist inside the browser this
// test file actually executes in.
//
// `it.skipIf` rather than an imperative `ctx.skip()` inside the test body: the latter is not
// guaranteed to abort execution before the following statements run in every Vitest browser
// mode version, and was observed here to let `toMatchScreenshot` execute anyway once a
// reference file already existed on disk from a prior run. `skipIf` decides at collection
// time, before the test body ever starts, which has no such race.
const runsWhereGoldensAreValid = __TRACEKIT_VISUAL_IS_LINUX_CI__;

describe("Canvas2D visual regression", () => {
  for (const fixture of SCENARIO_FIXTURES) {
    it.skipIf(!runsWhereGoldensAreValid)(
      `renders ${fixture.id} (${fixture.description}) matching the committed golden — visual goldens are Linux-CI-only`,
      async () => {
        const canvas = document.createElement("canvas");
        canvas.style.width = `${fixture.viewport.width}px`;
        canvas.style.height = `${fixture.viewport.height}px`;
        document.body.appendChild(canvas);

        try {
          const fontReady = await ensureDefaultFont();
          expect(fontReady).toBe(true);
          expect(document.fonts.check('10px "TraceKit Inter"')).toBe(true);

          const renderer = new Canvas2DRenderer({ surface: canvas });
          try {
            renderer.setData(fixture.payload);
            renderer.setDomain(
              fixture.domain.xMin,
              fixture.domain.xMax,
              fixture.domain.yMin,
              fixture.domain.yMax,
            );
            renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
            renderer.render();

            await expect(page.elementLocator(canvas)).toMatchScreenshot(fixture.id);
          } finally {
            renderer.dispose();
          }
        } finally {
          canvas.remove();
        }
      },
    );
  }
});
