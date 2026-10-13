import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  DecimationSelection,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
} from "@trace-kit/core";
import { createViewportTransform, Y_SCALE_KIND_LINEAR, Y_SCALE_KIND_LOG } from "@trace-kit/core";
import {
  PARITY_SCENARIO_FIXTURES,
  SCENARIO_FIXTURES,
  SVG_EXTENDED_SCENARIO_FIXTURES,
  type ScenarioFixture,
} from "@trace-kit/renderers/fixtures";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";

/**
 * A minimal, real `FigureRenderer` implementation that is not Canvas2D — WebGL2 does not exist
 * yet, so this stands in for "a second backend" purely to prove `ScenarioFixture` carries no
 * Canvas2D-specific assumption. It records every call it receives instead of drawing anything.
 */
class RecordingStandInRenderer implements FigureRenderer {
  readonly kind: FigureRendererKind = "webgl2";
  disposed = false;
  transform: ViewportTransform = createViewportTransform({
    cssWidth: 1,
    cssHeight: 1,
    dpr: 1,
    insetLeft: 0,
    insetRight: 0,
    insetTop: 0,
    insetBottom: 0,
    xDomainMin: 0,
    xDomainMax: 1,
    yDomainMin: 0,
    yDomainMax: 1,
    xOrigin: 0,
  });
  readonly calls: string[] = [];

  setData(payload: SpectrumDataPayload): void {
    void payload;
    this.calls.push("setData");
  }

  setTraces(collection: TraceCollection): void {
    void collection;
    this.calls.push("setTraces");
  }

  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    void xMin;
    void xMax;
    void yMin;
    void yMax;
    this.calls.push("setDomain");
  }

  resize(width: number, height: number, dpr: number): void {
    void width;
    void height;
    void dpr;
    this.calls.push("resize");
  }

  render(): void {
    this.calls.push("render");
  }

  clear(): void {
    this.calls.push("clear");
  }

  setDecimation(selection: DecimationSelection | undefined): void {
    void selection;
    this.calls.push("setDecimation");
  }

  dispose(): void {
    this.disposed = true;
  }
}

const PARITY_DESCRIPTIONS = [
  "simple trace",
  "axes with grid",
  "resonance peak",
  "noise floor",
  "decimation case",
];

const EXTENDED_IDS = ["log-axis", "dual-axis", "gapped-trace", "overlay-two-axis"];

const EXPECTED_IDS = new Set([
  "simple-trace",
  "axes-grid",
  "resonance-peak",
  "noise-floor",
  "decimation-minmax",
  ...EXTENDED_IDS,
]);

/** Fixtures outside the nine agreed scenarios; the scope check fails naming them. */
function unexpectedFixtures(fixtures: readonly ScenarioFixture[]): string[] {
  return fixtures.filter((f) => !EXPECTED_IDS.has(f.id)).map((f) => f.id);
}

/** FNV-1a over the raw bytes of the first `count` samples. The expected values below were taken
 * from the inline builders in the pixel suite before those were replaced by these fixtures, so a
 * match proves the moved data is bit-identical to what the committed goldens were drawn from. */
function checksum(values: Float32Array, count: number): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, count * 4);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function fixtureById(id: string): ScenarioFixture {
  const found = SCENARIO_FIXTURES.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no fixture ${id}`);
  return found;
}

describe("scenario fixtures", () => {
  it("partitions into a parity set of five and an SVG-extended set of four", () => {
    expect(PARITY_SCENARIO_FIXTURES.length).toBe(5);
    expect(PARITY_SCENARIO_FIXTURES.map((f) => f.description)).toEqual(PARITY_DESCRIPTIONS);
    expect(SVG_EXTENDED_SCENARIO_FIXTURES.map((f) => f.id)).toEqual(EXTENDED_IDS);
  });

  it("SCENARIO_FIXTURES is the nine scenarios, parity first", () => {
    expect(SCENARIO_FIXTURES.length).toBe(9);
    expect(SCENARIO_FIXTURES.map((f) => f.id)).toEqual([
      ...PARITY_SCENARIO_FIXTURES.map((f) => f.id),
      ...SVG_EXTENDED_SCENARIO_FIXTURES.map((f) => f.id),
    ]);
  });

  it("parity fixtures carry a payload; extended fixtures are a payload or a collection", () => {
    for (const fixture of PARITY_SCENARIO_FIXTURES) expect(fixture.kind).toBe("payload");
    expect(fixtureById("log-axis").kind).toBe("payload");
    expect(fixtureById("dual-axis").kind).toBe("payload");
    expect(fixtureById("gapped-trace").kind).toBe("payload");
    expect(fixtureById("overlay-two-axis").kind).toBe("collection");
  });

  it("a tenth fixture fails the scope check, naming the extra", () => {
    expect(unexpectedFixtures(SCENARIO_FIXTURES)).toEqual([]);
    const first = SCENARIO_FIXTURES[0];
    if (first === undefined) throw new Error("no fixtures");
    const extra: ScenarioFixture = { ...first, id: "surprise" };
    expect(unexpectedFixtures([...SCENARIO_FIXTURES, extra])).toEqual(["surprise"]);
  });

  it("no field on the fixture type names a renderer backend", () => {
    const forbidden = ["canvas2d", "webgl2", "backend"];
    for (const fixture of SCENARIO_FIXTURES) {
      const keys = Object.keys(fixture);
      for (const key of keys) {
        for (const word of forbidden) {
          expect(key.toLowerCase()).not.toContain(word);
        }
      }
    }
  });

  it("dpr is a plain numeric field on every fixture", () => {
    for (const fixture of SCENARIO_FIXTURES) {
      expect(typeof fixture.dpr).toBe("number");
      expect(fixture.dpr).toBeGreaterThan(0);
    }
  });

  it("is importable via the stable package-relative fixtures subpath", () => {
    // The import at the top of this file already exercises `@trace-kit/renderers/fixtures`
    // rather than a `../../../renderers/...` relative path — this assertion just confirms the
    // module actually resolved to something usable, not an empty/undefined shim.
    expect(Array.isArray(SCENARIO_FIXTURES)).toBe(true);
  });

  it("every fixture id is unique", () => {
    const ids = SCENARIO_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("multi-axis fixtures declare each axis scale kind and each trace its axis binding", () => {
    const dual = fixtureById("dual-axis");
    expect(dual.yAxes?.map((a) => [a.id, a.scaleKind])).toEqual([
      ["log", Y_SCALE_KIND_LOG],
      ["linear", Y_SCALE_KIND_LINEAR],
    ]);
    const overlay = fixtureById("overlay-two-axis");
    if (overlay.kind !== "collection") throw new Error("overlay must be a collection");
    expect(overlay.yAxes?.map((a) => [a.id, a.scaleKind])).toEqual([
      ["linear", Y_SCALE_KIND_LINEAR],
      ["log", Y_SCALE_KIND_LOG],
    ]);
    expect(overlay.collection.entries.map((e) => e.yAxisId)).toEqual(["linear", "log"]);
    expect(fixtureById("log-axis").yAxes?.map((a) => a.scaleKind)).toEqual([Y_SCALE_KIND_LOG]);
  });

  it("the moved builders reproduce the original sample data bit for bit", () => {
    const log = fixtureById("log-axis");
    const dual = fixtureById("dual-axis");
    const overlay = fixtureById("overlay-two-axis");
    if (log.kind !== "payload" || dual.kind !== "payload" || overlay.kind !== "collection") {
      throw new Error("unexpected fixture kinds");
    }
    expect(checksum(log.payload.y, log.payload.sampleCount)).toBe("a75eda59");
    expect(checksum(dual.payload.y, dual.payload.sampleCount)).toBe("ed54c5f0");
    const [linear, logTrace] = overlay.collection.entries;
    expect(checksum(linear?.payload.y ?? new Float32Array(0), 300)).toBe("5ada5d3");
    expect(checksum(logTrace?.payload.y ?? new Float32Array(0), 300)).toBe("591ff560");
    expect(linear?.payload.xOrigin).toBe(0);
    expect(logTrace?.payload.xOrigin).toBe(1000);
  });

  it("keeps the original domains and the overlay collection window", () => {
    expect(fixtureById("log-axis").domain).toEqual({ xMin: 0, xMax: 511, yMin: 1, yMax: 1000 });
    expect(fixtureById("dual-axis").domain).toEqual({ xMin: 0, xMax: 511, yMin: 1, yMax: 1000 });
    const overlay = fixtureById("overlay-two-axis");
    if (overlay.kind !== "collection") throw new Error("overlay must be a collection");
    expect(overlay.collection.xDomainMin).toBe(0);
    expect(overlay.collection.xDomainMax).toBe(299);
  });
});

interface FakeContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(path?: unknown): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  fill(path?: unknown): void;
}

/** Matches `test/node/axes-grid.test.ts`'s own fake-canvas pattern: this project runs under
 * `environment: "node"`, which has no `OffscreenCanvas`/`HTMLCanvasElement`. */
function makeFakeSurface(): HTMLCanvasElement {
  const context: FakeContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform(): void {},
    fillRect(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    fillText(): void {},
    setLineDash(): void {},
    fill(): void {},
  };
  const canvas = { getContext: () => context };
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  return canvas as unknown as HTMLCanvasElement;
}

describe("scenario fixture drives a real renderer", () => {
  // `canvas2d-renderer.ts` constructs a real `Path2D` when a payload is present; Node has no
  // such global. Matches `test/node/axes-grid.test.ts`'s own polyfill exactly.
  let originalPath2D: unknown;
  beforeEach(() => {
    originalPath2D = (globalThis as Record<string, unknown>)["Path2D"];
    (globalThis as Record<string, unknown>)["Path2D"] = class {
      moveTo(): void {}
      lineTo(): void {}
      rect(): void {}
    };
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>)["Path2D"] = originalPath2D;
  });

  it.each(SCENARIO_FIXTURES)(
    "$description drives Canvas2DRenderer with no field renamed or omitted",
    (fixture: ScenarioFixture) => {
      const surface = makeFakeSurface();
      const renderer = new Canvas2DRenderer(
        fixture.yAxes === undefined ? { surface } : { surface, yAxes: fixture.yAxes },
      );
      if (fixture.kind === "payload") {
        renderer.setData(fixture.payload);
        renderer.setDomain(
          fixture.domain.xMin,
          fixture.domain.xMax,
          fixture.domain.yMin,
          fixture.domain.yMax,
        );
      } else {
        renderer.setTraces(fixture.collection);
      }
      renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
      expect(() => renderer.render()).not.toThrow();
      renderer.dispose();
    },
  );

  it("the same fixture record drives a real Canvas2D renderer and a stand-in second-backend renderer, with no field renamed or omitted", () => {
    const fixture = PARITY_SCENARIO_FIXTURES[0];
    if (fixture === undefined) throw new Error("no fixtures");

    const canvas2d = new Canvas2DRenderer({ surface: makeFakeSurface() });
    canvas2d.setData(fixture.payload);
    canvas2d.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
    canvas2d.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
    canvas2d.render();
    canvas2d.dispose();

    const standIn = new RecordingStandInRenderer();
    standIn.setData(fixture.payload);
    standIn.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
    standIn.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
    standIn.render();
    standIn.dispose();

    expect(standIn.calls).toEqual(["setData", "setDomain", "resize", "render"]);
    expect(standIn.disposed).toBe(true);
  });
});
