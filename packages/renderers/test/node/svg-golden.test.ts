/** @vitest-environment node */
import { createViewportTransform, projectX, projectY } from "@trace-kit/core";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "../../src/fixtures/scenarios.js";
import { exportToSvg } from "../../src/svg/index.js";
import { formatSvgNumber } from "../../src/svg/svg-number.js";
import { firstDifferingLine, sceneFromFixture } from "./support/svg-scene.js";
import { layoutFor } from "./support/svg-helpers.js";

const GOLDEN_DIR = fileURLToPath(new URL("../svg-goldens/", import.meta.url));
// Regeneration is an explicit act: the flag rewrites the file and the test then fails on purpose,
// so an update can never be mistaken for a pass.
const UPDATE = process.env["TRACEKIT_UPDATE_SVG_GOLDENS"] === "1";
const f = formatSvgNumber;

describe("SVG golden corpus", () => {
  it("covers the nine scenarios, including log, dual, gapped and overlay figures", () => {
    expect(SCENARIO_FIXTURES.length).toBe(9);
    const ids = SCENARIO_FIXTURES.map((x) => x.id);
    for (const required of ["log-axis", "dual-axis", "gapped-trace", "overlay-two-axis"]) {
      expect(ids).toContain(required);
    }
  });

  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    "%s matches its committed golden byte for byte",
    (id, fixture) => {
      const actual = exportToSvg(sceneFromFixture(fixture));
      const path = `${GOLDEN_DIR}${id}.svg`;
      if (UPDATE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, actual, "utf8");
        throw new Error(`${id}: golden updated, re-run without the flag`);
      }
      expect(existsSync(path), `${id}: golden ${path} is missing`).toBe(true);
      const golden = readFileSync(path, "utf8");
      const diff = firstDifferingLine(golden, actual);
      if (diff !== null) {
        throw new Error(`${id}: first difference at line ${diff.line}\n- ${diff.expected}\n+ ${diff.actual}`);
      }
      expect(actual).toBe(golden);
    },
  );

  it("has no orphan golden without a scenario", () => {
    const stems = new Set(SCENARIO_FIXTURES.map((x) => x.id));
    const orphans = existsSync(GOLDEN_DIR)
      ? readdirSync(GOLDEN_DIR).filter((name) => name.endsWith(".svg") && !stems.has(name.slice(0, -4)))
      : [];
    expect(orphans).toEqual([]);
  });

  it("reports the scenario and the first differing line on a one-character drift", () => {
    const diff = firstDifferingLine("a\nb 1.25\nc", "a\nb 1.26\nc");
    expect(diff).toEqual({ line: 2, expected: "b 1.25", actual: "b 1.26" });
    expect(firstDifferingLine("same", "same")).toBeNull();
  });

  it("has no platform or CI skip gating", () => {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    for (const banned of ["skip" + "If", "process.env." + "CI", "process." + "platform"]) {
      // The needle is assembled at runtime so this file does not contain what it forbids.
      expect(source.split(banned).length - 1, banned).toBe(0);
    }
  });
});

describe("goldens pin the projection numbers", () => {
  function firstFiniteIndex(y: Float32Array, count: number): number {
    for (let i = 0; i < count; i += 1) if (!Number.isNaN(y[i] ?? NaN)) return i;
    return -1;
  }

  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    "%s contains a known tick coordinate and trace vertex",
    (id, fixture: ScenarioFixture) => {
      if (UPDATE) return;
      const golden = readFileSync(`${GOLDEN_DIR}${id}.svg`, "utf8");
      const scene = sceneFromFixture(fixture);
      const layout = layoutFor(scene, fixture.kind === "payload" ? fixture.payload.xUnit : "", fixture.kind === "payload" ? fixture.payload.yUnit : "");
      const first = layout.transforms[0];
      if (first === undefined) throw new Error("no transform");

      const x0 = f(projectX(first, layout.xTicks[0] ?? 0));
      expect(golden).toContain(`<line x1="${x0}" y1="${f(first.plotTop)}"`);

      const trace =
        fixture.kind === "payload"
          ? { payload: fixture.payload, axisIndex: 0 }
          : { payload: fixture.collection.entries[0]?.payload, axisIndex: 0 };
      const payload = trace.payload;
      if (payload === undefined) throw new Error("no payload");
      const axis = (fixture.yAxes ?? [{ scaleKind: 0, domainMin: fixture.domain.yMin, domainMax: fixture.domain.yMax }])[trace.axisIndex];
      if (axis === undefined) throw new Error("no axis");
      const transform = createViewportTransform({
        cssWidth: fixture.viewport.width,
        cssHeight: fixture.viewport.height,
        dpr: 1,
        ...layout.insets,
        xDomainMin: fixture.domain.xMin,
        xDomainMax: fixture.domain.xMax,
        xOrigin: payload.xOrigin,
        yDomainMin: axis.domainMin,
        yDomainMax: axis.domainMax,
        yScaleKind: axis.scaleKind,
      });
      const index = firstFiniteIndex(payload.y, payload.sampleCount);
      const vertex = `M${f(projectX(transform, payload.x[index] ?? 0))} ${f(projectY(transform, payload.y[index] ?? 0))}`;
      expect(golden).toContain(`<path d="${vertex}`);
    },
  );
});

describe("export determinism over the corpus", () => {
  it("exports every fixture twice to identical text without a carriage return", () => {
    for (const fixture of SCENARIO_FIXTURES) {
      const a = exportToSvg(sceneFromFixture(fixture));
      const b = exportToSvg(sceneFromFixture(fixture));
      expect(a, fixture.id).toBe(b);
      expect(a, fixture.id).not.toContain("\r");
    }
  });

  it("never calls a locale-aware number formatter while exporting", () => {
    const spy = vi.spyOn(Number.prototype, "toLocaleString");
    try {
      for (const fixture of SCENARIO_FIXTURES) exportToSvg(sceneFromFixture(fixture));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
