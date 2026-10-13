import type { ScenarioFixture } from "../../../src/fixtures/scenarios.js";
import type { SvgScene } from "../../../src/svg/scene.js";

/**
 * Maps a backend-free fixture to an exporter scene: the CSS-pixel viewport becomes the document
 * size, `dpr` is deliberately ignored (SVG coordinates are CSS pixels), and everything else passes
 * through unchanged. The playground copies this same mapping.
 */
export function sceneFromFixture(fixture: ScenarioFixture): SvgScene {
  return {
    traces: fixture.kind === "payload" ? fixture.payload : fixture.collection,
    domain: fixture.domain,
    width: fixture.viewport.width,
    height: fixture.viewport.height,
    ...(fixture.yAxes === undefined ? {} : { yAxes: fixture.yAxes }),
  };
}

/** Reports the first differing line of two texts as `{ line, expected, actual }` (1-based), or
 * `null` when they are equal. */
export function firstDifferingLine(
  expected: string,
  actual: string,
): { line: number; expected: string; actual: string } | null {
  if (expected === actual) return null;
  const e = expected.split("\n");
  const a = actual.split("\n");
  const length = Math.max(e.length, a.length);
  for (let i = 0; i < length; i += 1) {
    if (e[i] !== a[i]) return { line: i + 1, expected: e[i] ?? "<missing>", actual: a[i] ?? "<missing>" };
  }
  return null;
}
