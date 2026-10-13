/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  Y_SCALE_KIND_LINEAR,
  type SpectrumDataPayload,
  type TraceStyle,
} from "@trace-kit/core";
import { beforeEach, describe, expect, it } from "vitest";
import { TRACE_PALETTE } from "../../src/style.js";
import { createHarness, type Harness } from "./support/webgl2-harness.js";

function payloadOf(n: number, y: (i: number) => number = (i) => Math.sin(i / 9)): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({ capacity: Math.max(1, n), xOrigin: 0, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < n; i += 1) {
    payload.x[i] = i;
    payload.y[i] = y(i);
  }
  commitPayloadRevision(payload, n);
  return payload;
}

const Y_AXIS = [
  { id: "y", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -1, domainMax: 1, side: AXIS_SIDE_LEFT },
] as const;

function collectionOf(...payloads: SpectrumDataPayload[]) {
  return createTraceCollection(
    payloads.map((payload, i) => ({ id: `t${i}`, payload, yAxisId: "y", style: {} })),
    Y_AXIS,
    0,
    300,
  );
}

function styled(id: string, payload: SpectrumDataPayload, style: TraceStyle = {}) {
  return { id, payload, yAxisId: "y", style };
}

const MEMBERS = [
  "kind",
  "disposed",
  "transform",
  "setData",
  "setTraces",
  "setDomain",
  "resize",
  "render",
  "clear",
  "dispose",
  "setDecimation",
];

let h: Harness;
beforeEach(() => {
  h = createHarness();
  h.renderer.resize(400, 300, 1);
});

describe("member set", () => {
  it("exposes the eleven FigureRenderer members and kind webgl2", () => {
    for (const name of MEMBERS) expect(name in h.renderer, name).toBe(true);
    expect(h.renderer.kind).toBe("webgl2");
    expect(h.renderer.disposed).toBe(false);
    expect(h.renderer.transform.deviceWidth).toBe(400);
  });
});

describe("cold setters issue no GL call", () => {
  it("setData, setTraces, setDomain, resize and setDecimation call nothing and create nothing", () => {
    h.renderer.setData(payloadOf(100));
    h.renderer.render();
    const created = { ...h.gl.created };
    h.log.length = 0;

    h.renderer.setData(payloadOf(100));
    h.renderer.setTraces(collectionOf(payloadOf(50), payloadOf(60)));
    h.renderer.setDomain(0, 10, -2, 2);
    h.renderer.resize(300, 200, 2);
    h.renderer.setDecimation({ algorithm: "lttb", threshold: 20 });
    h.renderer.setDecimation(undefined);

    expect(h.log.filter((call) => call.name.startsWith("gl."))).toHaveLength(0);
    expect(h.gl.created).toEqual(created);
  });

  it("deletes the previous slots at the start of the next render, before creating new objects", () => {
    h.renderer.setData(payloadOf(100));
    h.renderer.render();
    const previous = h.gl.liveCount("buffer");
    expect(previous).toBe(2);

    h.renderer.setData(payloadOf(100));
    expect(h.gl.liveCount("buffer")).toBe(previous);
    h.log.length = 0;
    h.renderer.render();

    const names = h.log.map((call) => call.name);
    const firstDelete = names.indexOf("gl.deleteBuffer");
    const firstCreate = names.indexOf("gl.createBuffer");
    expect(firstDelete).toBeGreaterThan(-1);
    expect(firstCreate).toBeGreaterThan(firstDelete);
    expect(h.gl.liveCount("buffer")).toBe(2);
  });

  it("render, resize, setDomain and clear create nothing after the first frame", () => {
    h.renderer.setData(payloadOf(100));
    h.renderer.render();
    const created = { ...h.gl.created };
    h.renderer.render();
    h.renderer.resize(500, 250, 1);
    h.renderer.setDomain(0, 50, -1, 1);
    h.renderer.render();
    h.renderer.clear();
    expect(h.gl.created).toEqual(created);
  });
});

describe("resource balance and dispose", () => {
  it("balances creation and deletion after dispose, calls loseContext once, keeps the surfaces", () => {
    h.renderer.setTraces(collectionOf(payloadOf(80, (i) => (i === 40 ? 1 : NaN)), payloadOf(60)));
    h.renderer.render();
    h.renderer.setData(payloadOf(10));
    h.renderer.dispose();

    for (const kind of ["buffer", "vertexArray", "program", "shader"] as const) {
      expect(h.gl.created[kind], kind).toBe(h.gl.deleted[kind]);
      expect(h.gl.liveCount(kind)).toBe(0);
    }
    expect(h.gl.callsNamed("loseContext")).toHaveLength(1);
    expect(h.renderer.disposed).toBe(true);
    for (const surface of [h.underlay, h.plot, h.overlay]) {
      expect([surface.width, surface.height]).toEqual([400, 300]);
    }
  });

  it("is idempotent and turns every other member into a no-op with no GL or 2D call", () => {
    h.renderer.setData(payloadOf(10));
    h.renderer.render();
    h.renderer.dispose();
    h.log.length = 0;

    h.renderer.dispose();
    h.renderer.setData(payloadOf(10));
    h.renderer.setTraces(collectionOf(payloadOf(10)));
    h.renderer.setDomain(0, 1, 0, 1);
    h.renderer.resize(10, 10, 1);
    h.renderer.render();
    h.renderer.clear();
    h.renderer.setDecimation(undefined);

    expect(h.log).toHaveLength(0);
    expect([h.underlay.width, h.underlay.height]).toEqual([400, 300]);
  });

  it("never registers listeners", () => {
    h.renderer.render();
    h.renderer.dispose();
    for (const surface of [h.underlay, h.plot, h.overlay]) expect(surface.listeners).toEqual([]);
  });
});

describe("decimation selection", () => {
  it("draws the full payload by default, an explicit selection on the next render, and restores the default", () => {
    h.renderer.setData(payloadOf(5000));
    h.renderer.render();
    expect(h.gl.bufferUploads()[0]?.length).toBe(5000);

    h.renderer.setDecimation({ algorithm: "lttb", threshold: 100 });
    h.renderer.render();
    const decimated = h.gl.bufferUploads().at(-1);
    expect(decimated?.length).toBe(100);

    h.renderer.setDecimation(undefined);
    h.renderer.render();
    expect(h.gl.bufferUploads().at(-1)?.length).toBe(5000);
  });

  it("applies an initial decimation option", () => {
    const local = createHarness({ rendererOptions: { decimation: { algorithm: "min-max", bucketCount: 10 } } });
    local.renderer.resize(400, 300, 1);
    local.renderer.setData(payloadOf(5000));
    local.renderer.render();
    expect(local.gl.bufferUploads()[0]?.length).toBeLessThanOrEqual(20);
  });
});

describe("multi-trace styling", () => {
  it("cycles the palette, resolves per-trace width and ignores dash", () => {
    const collection = createTraceCollection(
      [
        styled("a", payloadOf(50), { lineWidthCss: 3, dash: [4, 2] }),
        styled("b", payloadOf(50)),
        styled("c", payloadOf(50), { color: "#102030" }),
      ],
      Y_AXIS,
      0,
      50,
    );
    h.renderer.resize(400, 300, 2);
    h.renderer.setTraces(collection);
    h.renderer.render();

    const colors = h.gl.uniformValues("u_color");
    expect(colors).toHaveLength(3);
    const hex = (c: string): number[] => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255);
    expect(colors[0]?.slice(0, 3).map((v) => Number(v.toFixed(5)))).toEqual(hex(TRACE_PALETTE[0] ?? "").map((v) => Number(Math.fround(v).toFixed(5))));
    expect(colors[1]?.slice(0, 3).map((v) => Number(v.toFixed(5)))).toEqual(hex(TRACE_PALETTE[1] ?? "").map((v) => Number(Math.fround(v).toFixed(5))));
    expect(colors[2]?.slice(0, 3).map((v) => Number(v.toFixed(4)))).toEqual([16 / 255, 32 / 255, 48 / 255].map((v) => Number(v.toFixed(4))));
    expect(h.gl.uniformValues("u_lineWidth")).toEqual([[6], [3], [3]]);
    expect(h.log.some((call) => /dash/i.test(call.name))).toBe(false);
  });

  it("rejects a CSS color neither the parser nor the underlay context can canonicalise", () => {
    const collection = createTraceCollection(
      [styled("a", payloadOf(20), { color: "rebeccapurple" })],
      Y_AXIS,
      0,
      20,
    );
    expect(() => {
      h.renderer.setTraces(collection);
    }).toThrow(/rebeccapurple/);
  });
});

describe("source scans", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/webgl2");
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => [file, readFileSync(path.join(dir, file), "utf8")] as const);

  it("has no listener, context-loss handling, any pattern, Canvas2D import or drawImage", () => {
    for (const [file, source] of sources) {
      expect(source, `${file} addEventListener`).not.toContain("addEventListener");
      expect(source, `${file} webglcontextlost`).not.toContain("webglcontextlost");
      expect(source, `${file} drawImage`).not.toContain("drawImage");
      expect(source, `${file} fillText`).not.toContain("fillText");
      expect(source, `${file} texImage2D`).not.toContain("texImage2D");
      expect(source, `${file} Canvas2DRenderer`).not.toMatch(/import[^;]*Canvas2DRenderer/);
      expect(source, `${file} any`).not.toMatch(/: any\b|as any\b|<any>|, any>|as never\b|as unknown as\b/);
    }
  });
});
