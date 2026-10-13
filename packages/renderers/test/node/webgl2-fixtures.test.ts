/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { countIsolatedSegments } from "../../src/path/isolated-markers.js";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "../../src/fixtures/scenarios.js";
import { Y_SCALE_KIND_LINEAR, Y_SCALE_KIND_LOG } from "@trace-kit/core";
import { createHarness, type Harness } from "./support/webgl2-harness.js";

function render(fixture: ScenarioFixture): Harness {
  const h = createHarness(
    fixture.yAxes === undefined ? {} : { rendererOptions: { yAxes: fixture.yAxes } },
  );
  if (fixture.kind === "payload") {
    h.renderer.setData(fixture.payload);
    h.renderer.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
  } else {
    h.renderer.setTraces(fixture.collection);
  }
  h.renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
  h.renderer.render();
  return h;
}

function expectedMarkerPasses(fixture: ScenarioFixture): number {
  const empty = new Int32Array(0);
  if (fixture.kind === "payload") {
    const p = fixture.payload;
    return countIsolatedSegments(p.x, p.y, empty, 0, p.sampleCount) > 0 ? 1 : 0;
  }
  let passes = 0;
  for (const entry of fixture.collection.entries) {
    const p = entry.payload;
    const marks = entry.style.markIsolatedSamples ?? true;
    if (marks && countIsolatedSegments(p.x, p.y, empty, 0, p.sampleCount) > 0) passes += 1;
  }
  return passes;
}

describe("shared parity fixtures", () => {
  it("consumes the nine fixtures unchanged", () => {
    expect(SCENARIO_FIXTURES.map((f) => f.id)).toEqual([
      "simple-trace",
      "axes-grid",
      "resonance-peak",
      "noise-floor",
      "decimation-minmax",
      "log-axis",
      "dual-axis",
      "gapped-trace",
      "overlay-two-axis",
    ]);
  });

  for (const fixture of SCENARIO_FIXTURES) {
    describe(fixture.id, () => {
      it("sizes all three surfaces from the viewport and dpr", () => {
        const h = render(fixture);
        const width = Math.round(fixture.viewport.width * fixture.dpr);
        const height = Math.round(fixture.viewport.height * fixture.dpr);
        for (const surface of [h.underlay, h.plot, h.overlay]) {
          expect([surface.width, surface.height]).toEqual([width, height]);
        }
        expect(h.gl.callsNamed("viewport")[0]?.args).toEqual([0, 0, width, height]);
      });

      it("issues the marker pass iff the stream has isolated samples", () => {
        const h = render(fixture);
        expect(h.gl.uniformValues("u_markerSide")).toHaveLength(expectedMarkerPasses(fixture));
      });

      it("draws the full payload, one line pass per trace", () => {
        const h = render(fixture);
        const traces = fixture.kind === "payload" ? 1 : fixture.collection.entries.length;
        expect(h.gl.uniformValues("u_lineWidth")).toHaveLength(traces);
        const first = fixture.kind === "payload" ? fixture.payload : fixture.collection.entries[0]?.payload;
        expect(h.gl.bufferUploads()[0]?.length).toBe(first?.sampleCount);
      });
    });
  }

  it("draws overlay-two-axis as two line passes with per-axis uniforms", () => {
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === "overlay-two-axis");
    if (fixture === undefined) throw new Error("fixture missing");
    const h = render(fixture);
    expect(h.gl.uniformValues("u_lineWidth")).toHaveLength(2);
    expect(h.gl.uniformValues("u_yScaleKind")).toEqual([[Y_SCALE_KIND_LINEAR], [Y_SCALE_KIND_LOG]]);
    expect(h.gl.uniformValues("u_y")[1]?.[1]).toBe(0);
  });

  it("uploads the log axis uniforms for the log fixtures", () => {
    for (const id of ["log-axis", "dual-axis"]) {
      const fixture = SCENARIO_FIXTURES.find((f) => f.id === id);
      if (fixture === undefined) throw new Error(`fixture ${id} missing`);
      const h = render(fixture);
      expect(h.gl.uniformValues("u_yScaleKind")[0]).toEqual([Y_SCALE_KIND_LOG]);
      expect(h.gl.uniformValues("u_y")[0]?.[1]).toBe(0);
    }
  });
});
