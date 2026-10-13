import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import {
  PARITY_SCENARIO_FIXTURES,
  SVG_EXTENDED_SCENARIO_FIXTURES,
  type ScenarioFixture,
} from "@trace-kit/renderers/fixtures";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { mountWebGl2 } from "./support/figure-stack.js";
import { WEBGL2_SCREENSHOT_TOLERANCE } from "./support/webgl2-tolerances.js";

// Goldens are generated and compared exclusively in CI on `ubuntu-latest`: a WebGL2 rasterizer's
// output is not byte-comparable across hosts, so a developer machine would either mismatch a
// Linux-generated reference or silently create one nobody else's CI could match. The flag is a
// Vite `define` baked in at config-evaluation time (see `test/visual/globals.d.ts`), since
// `process.platform` does not exist inside the browser. `it.skipIf` decides at collection time,
// before the body can start, which an imperative skip inside the body does not guarantee.
const runsWhereGoldensAreValid = __TRACEKIT_VISUAL_IS_LINUX_CI__;

/** The four fixtures beyond the parity set that also have a WebGL2 golden, selected by id. */
const EXTENDED_IDS = ["log-axis", "dual-axis", "gapped-trace", "overlay-two-axis"] as const;

function extendedFixture(id: string): ScenarioFixture {
  const found = SVG_EXTENDED_SCENARIO_FIXTURES.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no extended fixture "${id}"`);
  return found;
}

/** Screenshots the container holding the three stacked canvases, so the golden is the figure the
 * browser composites, not any single layer. */
async function expectFixtureMatchesGolden(fixture: ScenarioFixture): Promise<void> {
  const fontReady = await ensureDefaultFont();
  expect(fontReady).toBe(true);
  const figure = mountWebGl2(fixture);
  try {
    figure.renderer.render();
    await expect(page.elementLocator(figure.stack.container)).toMatchScreenshot(`webgl2-${fixture.id}`, {
      comparatorName: "pixelmatch",
      // `includeAA` mirrors the project-wide comparator setting, which a per-call options object
      // would otherwise replace.
      comparatorOptions: { ...WEBGL2_SCREENSHOT_TOLERANCE, includeAA: true },
    });
  } finally {
    figure.dispose();
  }
}

describe("WebGL2 visual regression", () => {
  for (const fixture of PARITY_SCENARIO_FIXTURES) {
    it.skipIf(!runsWhereGoldensAreValid)(
      `renders ${fixture.id} (${fixture.description}) matching the committed golden — visual goldens are Linux-CI-only`,
      async () => {
        await expectFixtureMatchesGolden(fixture);
      },
    );
  }
  for (const id of EXTENDED_IDS) {
    it.skipIf(!runsWhereGoldensAreValid)(
      `renders ${id} matching the committed golden — visual goldens are Linux-CI-only`,
      async () => {
        await expectFixtureMatchesGolden(extendedFixture(id));
      },
    );
  }
});
