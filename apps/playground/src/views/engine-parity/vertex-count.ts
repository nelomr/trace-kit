import { resolveDecimationParameter, type DecimationSelection } from "@trace-kit/core";
import type { ScenarioFixture } from "@trace-kit/renderers/fixtures";

export type EngineKind = "canvas2d" | "webgl2";

/** Samples of every trace a fixture draws. */
function sampleCounts(fixture: ScenarioFixture): number[] {
  return fixture.kind === "payload"
    ? [fixture.payload.sampleCount]
    : fixture.collection.entries.map((entry) => entry.payload.sampleCount);
}

/** The default selection Canvas2D falls back to: LTTB at the viewport-derived budget. */
const CANVAS2D_DEFAULT: DecimationSelection = { algorithm: "lttb" };

/**
 * Vertices an engine draws for a fixture, summed over its traces, derived only from public
 * behaviour: the plot width, the selection and each trace's sample count. WebGL2 draws every sample
 * by default and Canvas2D decimates to `min(n, max(2, ceil(2 * plotWidth)))`. An explicit selection
 * emits `threshold` vertices for LTTB and twice the bucket count for min-max, and a payload no
 * longer than that is drawn whole.
 */
export function vertexCount(
  engine: EngineKind,
  fixture: ScenarioFixture,
  selection: DecimationSelection | undefined,
  plotWidth: number,
): number {
  const effective = selection ?? (engine === "canvas2d" ? CANVAS2D_DEFAULT : undefined);
  let total = 0;
  for (const n of sampleCounts(fixture)) {
    if (effective === undefined) {
      total += n;
      continue;
    }
    const parameter = resolveDecimationParameter(effective, plotWidth, n);
    const emitted = effective.algorithm === "lttb" ? parameter : parameter * 2;
    total += n <= emitted ? n : emitted;
  }
  return total;
}
