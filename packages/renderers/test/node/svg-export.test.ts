/** @vitest-environment node */
import {
  projectX,
  projectY,
  selectLogTicks,
  Y_SCALE_KIND_LOG,
  type YAxisRegistration,
} from "@trace-kit/core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { TRACEKIT_INTER_FAMILY } from "../../src/font/family.js";
import { TRACEKIT_INTER_EMBEDDED_FONT } from "../../src/font/index.js";
import { axisGutterCss } from "../../src/layout/figure-layout.js";
import { TRACE_PALETTE, DEFAULT_AXIS_LAYOUT, DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { exportToSvg } from "../../src/svg/index.js";
import { formatSvgNumber } from "../../src/svg/svg-number.js";
import {
  installRecordingPath2D,
  RecordingContext,
  recordingSurface,
} from "./support/recording-context.js";
import {
  attr,
  collectionScene,
  elements,
  groupBody,
  layoutFor,
  linearAxis,
  payloadOf,
  payloadScene,
  paths,
  pointCount,
} from "./support/svg-helpers.js";
import { assertWellFormedXml } from "./support/xml.js";

const f = formatSvgNumber;

describe("document structure", () => {
  it("is a standalone SVG document with namespace, size and viewBox", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3, 4, 5]));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">\n')).toBe(true);
    expect(svg.endsWith("</svg>\n")).toBe(true);
    assertWellFormedXml(svg);
    expect(svg).not.toMatch(/href|url\(\s*["']?https?:|<image|<use/);
  });

  it("uses LF line endings and no carriage return", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3]));
    expect(svg).not.toContain("\r");
    expect(svg.split("\n").length).toBeGreaterThan(5);
  });

  it("emits defs, background, gridlines, clipped traces, axes and labels in a fixed order", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3, 4, 5]));
    const marks = [
      "<defs>",
      `<rect x="0" y="0" width="800" height="400" fill="${DEFAULT_FIGURE_STYLE.backgroundColor}"/>`,
      `<g stroke="${DEFAULT_FIGURE_STYLE.gridColor}"`,
      '<g clip-path="url(#tracekit-plot-clip)">',
      `<g stroke="${DEFAULT_FIGURE_STYLE.axisColor}"`,
      `<g fill="${DEFAULT_FIGURE_STYLE.labelColor}"`,
    ].map((m) => svg.indexOf(m));
    expect(marks.every((i) => i >= 0)).toBe(true);
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
  });

  it("clips traces with one deterministic clipPath equal to the plot area", () => {
    const scene = payloadScene([1, 2, 3, 4, 5]);
    const svg = exportToSvg(scene);
    const t = layoutFor(scene).transforms[0];
    if (t === undefined) throw new Error("no transform");
    expect(svg.match(/<clipPath /g)?.length).toBe(1);
    expect(svg).toContain(
      `<clipPath id="tracekit-plot-clip"><rect x="${f(t.plotLeft)}" y="${f(t.plotTop)}" width="${f(t.plotWidth)}" height="${f(t.plotHeight)}"/></clipPath>`,
    );
    expect(svg.match(/\sid="/g)?.length).toBe(1);
    expect(groupBody(svg, 'stroke="' + DEFAULT_FIGURE_STYLE.gridColor)).not.toContain("clip-path");
  });

  it("namespaces the clip id with a valid idPrefix and falls back for an invalid one", () => {
    const scene = payloadScene([1, 2, 3]);
    expect(exportToSvg(scene, { idPrefix: "a" })).toContain('id="a-plot-clip"');
    expect(exportToSvg(scene, { idPrefix: "b" })).toContain("url(#b-plot-clip)");
    for (const bad of ["1 bad id", "", "9x", "a b", 'a"b']) {
      expect(exportToSvg(scene, { idPrefix: bad })).toContain('id="tracekit-plot-clip"');
    }
  });

  it("emits no style, font-face or base64 payload by default", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3]));
    expect(svg).not.toMatch(/<style|@font-face|base64,/);
  });

  it("labels are real text with the TraceKit family and a generic fallback", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3, 4, 5]));
    expect(svg).toContain(`font-family="${TRACEKIT_INTER_FAMILY}, sans-serif"`);
    const labels = elements(groupBody(svg, `fill="${DEFAULT_FIGURE_STYLE.labelColor}"`), "text");
    expect(labels.length).toBeGreaterThan(0);
    expect(svg).not.toMatch(/glyph/i);
  });

  it("escapes label text and stays well-formed", () => {
    const scene = payloadScene([1, 2, 3, 4, 5], { traces: payloadOf([1, 2, 3, 4, 5], { xUnit: 'a<b&"c"' }) });
    const svg = exportToSvg(scene);
    expect(svg).toContain("a&lt;b&amp;&quot;c&quot;");
    expect(svg).not.toContain('a<b&"c"');
    assertWellFormedXml(svg);
  });

  it("escapes caller-supplied colours", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3], { style: { traceColor: 'red" onload="x' } }));
    expect(svg).not.toContain('onload="x"');
    assertWellFormedXml(svg);
  });

  it("hidden axes omit their lines and labels but keep the gridlines", () => {
    const svg = exportToSvg(
      payloadScene([1, 2, 3, 4, 5], { axes: { showLeftAxis: false, showBottomAxis: false } }),
    );
    expect(elements(groupBody(svg, `stroke="${DEFAULT_FIGURE_STYLE.gridColor}"`), "line").length).toBeGreaterThan(0);
    expect(elements(groupBody(svg, `stroke="${DEFAULT_FIGURE_STYLE.axisColor}"`), "line").length).toBe(0);
    expect(elements(groupBody(svg, `fill="${DEFAULT_FIGURE_STYLE.labelColor}"`), "text").length).toBe(0);
  });

  it("never mutates, detaches or retains the scene buffers", () => {
    const payload = payloadOf(Array.from({ length: 5000 }, (_, i) => Math.sin(i / 10)));
    const xBefore = Array.from(payload.x);
    const yBefore = Array.from(payload.y);
    const bytes = [payload.x.byteLength, payload.y.byteLength];
    const revision = payload.revision;
    exportToSvg(payloadScene([], { traces: payload, domain: { xMin: 0, xMax: 5000, yMin: -1, yMax: 1 } }));
    expect(Array.from(payload.x)).toEqual(xBefore);
    expect(Array.from(payload.y)).toEqual(yBefore);
    expect([payload.x.byteLength, payload.y.byteLength]).toEqual(bytes);
    expect(payload.revision).toBe(revision);
  });

  it("treats a bare payload as a one-trace collection coloured by traceColor", () => {
    const y = [1, 3, 2, 5, 4];
    const payload = payloadOf(y);
    const single = exportToSvg(payloadScene([], { traces: payload, domain: { xMin: 0, xMax: 4, yMin: 0, yMax: 10 } }));
    const axes = [linearAxis("y", 0, 10)];
    const viaCollection = exportToSvg({
      ...collectionScene([{ id: "t", y, yAxisId: "y", style: { color: DEFAULT_FIGURE_STYLE.traceColor } }], axes),
      traces: collectionScene([{ id: "t", y, yAxisId: "y", style: { color: DEFAULT_FIGURE_STYLE.traceColor } }], axes).traces,
      domain: { xMin: 0, xMax: 4, yMin: 0, yMax: 10 },
    });
    // Units differ (payload carries its own), so compare the trace path only.
    expect(paths(single)).toEqual(paths(viaCollection));
  });
});

describe("module boundaries", () => {
  const svgDir = fileURLToPath(new URL("../../src/svg/", import.meta.url));
  const sources = readdirSync(svgDir).map((file) => [file, readFileSync(`${svgDir}${file}`, "utf8")] as const);

  it.each(sources)("%s imports only core and renderer-internal neutral modules", (_file, raw) => {
    // Comments may legitimately say "document" (the SVG document); only code is audited.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      expect(specifier).not.toMatch(/canvas2d|\/font\/|\.\.\/index|fixtures/);
      if (!specifier.startsWith(".")) expect(specifier).toBe("@trace-kit/core");
    }
    expect(source).not.toMatch(/\b(document|window|XMLSerializer|Path2D|HTMLCanvasElement)\b/);
  });

  it("adds no runtime dependency to the package", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(["@trace-kit/core"]);
  });

  it("core contains no exporter", () => {
    const coreSrc = fileURLToPath(new URL("../../../core/src/", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = `${dir}${name}`;
        return statSync(path).isDirectory() ? walk(`${path}/`) : [path];
      });
    for (const file of walk(coreSrc)) {
      expect(readFileSync(file, "utf8"), file).not.toContain("exportToSvg");
    }
  });

  it("renderers root entry does not re-export the exporter", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    expect(index).not.toMatch(/svg|exportToSvg/);
  });
});

describe("trace paths", () => {
  it("emits one M followed by L commands for a gap-free trace, and no other command", () => {
    const [path] = paths(exportToSvg(payloadScene([1, 2, 3, 4, 5])));
    expect(path?.d.match(/M/g)?.length).toBe(1);
    expect(path?.d.match(/L/g)?.length).toBe(4);
    expect(path?.d.replace(/[0-9.\s-]/g, "")).toBe("MLLLL");
    expect(path?.d).toMatch(/^M-?[\d.]+ -?[\d.]+( L-?[\d.]+ -?[\d.]+)*$/);
  });

  it("starts a new subpath at a NaN and never connects across it", () => {
    const [path] = paths(exportToSvg(payloadScene([1, 2, NaN, 4, 5])));
    expect(path?.d.match(/M/g)?.length).toBe(2);
    expect(path?.d.match(/L/g)?.length).toBe(2);
    expect(path?.d.split("M").filter((s) => s.length > 0).map((s) => (s.match(/L/g) ?? []).length)).toEqual([1, 1]);
  });

  it("emits no empty subpath for leading, trailing and consecutive NaNs", () => {
    const [path] = paths(exportToSvg(payloadScene([NaN, NaN, 1, 2, NaN, NaN, NaN, 3, 4, NaN])));
    expect(path?.d.match(/M/g)?.length).toBe(2);
    expect(path?.d).not.toMatch(/M[^L]*M/);
  });

  it("emits no path for an all-NaN trace", () => {
    const svg = exportToSvg(payloadScene([NaN, NaN, NaN]));
    expect(paths(svg).length).toBe(0);
    assertWellFormedXml(svg);
  });

  it("resolves style attributes from the trace style", () => {
    const axes = [linearAxis("y", 0, 10)];
    const svg = exportToSvg(
      collectionScene(
        [{ id: "t", y: [1, 2, 3], yAxisId: "y", style: { lineWidthCss: 3, dash: [4, 2], color: "#123456" } }],
        axes,
      ),
    );
    const [path] = paths(svg);
    expect(path?.attrs).toBe(' stroke="#123456" stroke-width="3" stroke-dasharray="4 2" fill="none"');
  });

  it("omits stroke-dasharray when the style declares no dash", () => {
    const [path] = paths(exportToSvg(payloadScene([1, 2, 3])));
    expect(path?.attrs).not.toContain("dasharray");
    expect(path?.attrs).toContain('fill="none"');
  });

  it("gives unstyled traces the first palette colours, and a single payload its traceColor", () => {
    const axes = [linearAxis("y", 0, 10)];
    const two = paths(
      exportToSvg(
        collectionScene(
          [
            { id: "a", y: [1, 2, 3], yAxisId: "y" },
            { id: "b", y: [3, 2, 1], yAxisId: "y" },
          ],
          axes,
        ),
      ),
    );
    expect(attr(two[0]?.attrs ?? "", "stroke")).toBe(TRACE_PALETTE[0]);
    expect(attr(two[1]?.attrs ?? "", "stroke")).toBe(TRACE_PALETTE[1]);
    const [single] = paths(exportToSvg(payloadScene([1, 2, 3], { style: { traceColor: "#ff0000" } })));
    expect(attr(single?.attrs ?? "", "stroke")).toBe("#ff0000");
  });

  it("projects each trace through its own bound axis transform", () => {
    const axes = [linearAxis("a", 0, 10), linearAxis("b", 0, 100)];
    const scene = collectionScene(
      [
        { id: "ta", y: [5, 5, 5], yAxisId: "a" },
        { id: "tb", y: [5, 5, 5], yAxisId: "b" },
      ],
      axes,
    );
    const [pa, pb] = paths(exportToSvg(scene));
    const layout = layoutFor(scene);
    const [ta, tb] = layout.transforms;
    if (ta === undefined || tb === undefined) throw new Error("no transforms");
    expect(pa?.d).toContain(` ${f(projectY(ta, 5))}`);
    expect(pb?.d).toContain(` ${f(projectY(tb, 5))}`);
    expect(f(projectY(ta, 5))).not.toBe(f(projectY(tb, 5)));
  });

  it("skips a trace bound to an unregistered axis and leaves the rest intact", () => {
    const registered = [linearAxis("a", 0, 10), linearAxis("b", 0, 10)];
    const full = collectionScene(
      [
        { id: "ta", y: [1, 2, 3], yAxisId: "a" },
        { id: "tb", y: [3, 2, 1], yAxisId: "b" },
      ],
      registered,
    );
    const svg = exportToSvg({ ...full, yAxes: [linearAxis("a", 0, 10)] });
    expect(paths(svg).length).toBe(1);
    assertWellFormedXml(svg);
  });
});

describe("isolated-sample markers", () => {
  const y = [NaN, 2, 3, NaN, 5, NaN, 2, 3];

  it("emits one filled square, centred on the sample, after the line path", () => {
    const scene = payloadScene(y, { style: { lineWidthCss: 1 } });
    const svg = exportToSvg(scene);
    const body = groupBody(svg, 'clip-path="url(#tracekit-plot-clip)"');
    const rects = elements(body, "rect");
    expect(rects.length).toBe(1);
    const rect = rects[0] ?? "";
    const t = layoutFor(scene).transforms[0];
    if (t === undefined) throw new Error("no transform");
    expect(attr(rect, "width")).toBe("2");
    expect(attr(rect, "height")).toBe("2");
    expect(attr(rect, "x")).toBe(f(projectX(t, 4) - 1));
    expect(attr(rect, "y")).toBe(f(projectY(t, 5) - 1));
    expect(attr(rect, "fill")).toBe(DEFAULT_FIGURE_STYLE.traceColor);
    expect(rect).not.toContain("stroke");
    expect(body.indexOf("<path")).toBeLessThan(body.indexOf("<rect"));
  });

  it("sizes the square from the trace line width", () => {
    const rect = elements(groupBody(exportToSvg(payloadScene(y)), 'clip-path="url(#tracekit-plot-clip)"'), "rect")[0] ?? "";
    expect(attr(rect, "width")).toBe(f(2 * DEFAULT_FIGURE_STYLE.lineWidthCss));
  });

  it("is disabled by the per-trace flag without changing the line", () => {
    const axes = [linearAxis("y", 0, 10)];
    const build = (flag: boolean | undefined) =>
      exportToSvg(
        collectionScene(
          [{ id: "t", y, yAxisId: "y", style: flag === undefined ? {} : { markIsolatedSamples: flag } }],
          axes,
        ),
      );
    const on = build(undefined);
    const off = build(false);
    expect(elements(groupBody(on, 'clip-path="url(#tracekit-plot-clip)"'), "rect").length).toBe(1);
    expect(elements(groupBody(off, 'clip-path="url(#tracekit-plot-clip)"'), "rect").length).toBe(0);
    expect(paths(off)[0]?.d).toBe(paths(on)[0]?.d);
  });

  it("marks nothing for a segment of two distinct samples", () => {
    const svg = exportToSvg(payloadScene([NaN, 1, 2, NaN, NaN, 3, 4, NaN]));
    expect(elements(groupBody(svg, 'clip-path="url(#tracekit-plot-clip)"'), "rect").length).toBe(0);
  });

  it("marks a single-sample trace and draws no line segment", () => {
    const svg = exportToSvg(payloadScene([4]));
    expect(paths(svg).every((p) => !p.d.includes("L"))).toBe(true);
    expect(elements(groupBody(svg, 'clip-path="url(#tracekit-plot-clip)"'), "rect").length).toBe(1);
  });
});

describe("decimation", () => {
  function dense(n: number): number[] {
    const out = new Array<number>(n);
    let state = 12345;
    for (let i = 0; i < n; i += 1) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      out[i] = (state / 0xffffffff) * 2 - 1;
    }
    return out;
  }

  it("bounds a dense trace by twice the plot width", () => {
    const scene = payloadScene(dense(200_000), { domain: { xMin: 0, xMax: 200_000, yMin: -1, yMax: 1 } });
    const t = layoutFor(scene).transforms[0];
    if (t === undefined) throw new Error("no transform");
    const [path] = paths(exportToSvg(scene));
    expect(pointCount(path?.d ?? "")).toBeLessThanOrEqual(Math.ceil(t.plotWidth * 2));
    expect(pointCount(path?.d ?? "")).toBeGreaterThan(100);
  });

  it("bypasses decimation at or below the target", () => {
    const [path] = paths(exportToSvg(payloadScene(dense(300), { domain: { xMin: 0, xMax: 299, yMin: -1, yMax: 1 } })));
    expect(pointCount(path?.d ?? "")).toBe(300);
  });

  it("keeps a single-sample peak and dip", () => {
    const n = 100_000;
    const y = new Array<number>(n).fill(0);
    y[50_000] = 1;
    y[70_000] = -1;
    const scene = payloadScene(y, { domain: { xMin: 0, xMax: n, yMin: -1, yMax: 1 } });
    const t = layoutFor(scene).transforms[0];
    if (t === undefined) throw new Error("no transform");
    const [path] = paths(exportToSvg(scene));
    expect(path?.d).toContain(` ${f(projectY(t, 1))}`);
    expect(path?.d).toContain(` ${f(projectY(t, -1))}`);
  });

  it("honours decimationTarget, floored, and caps it at the sample count", () => {
    const scene = payloadScene(dense(100_000), { domain: { xMin: 0, xMax: 100_000, yMin: -1, yMax: 1 } });
    const [path] = paths(exportToSvg(scene, { decimationTarget: 5000.9 }));
    expect(pointCount(path?.d ?? "")).toBeLessThanOrEqual(5000);
    expect(pointCount(path?.d ?? "")).toBeGreaterThan(4000);

    const small = payloadScene(dense(300), { domain: { xMin: 0, xMax: 299, yMin: -1, yMax: 1 } });
    const [capped] = paths(exportToSvg(small, { decimationTarget: 10_000 }));
    expect(pointCount(capped?.d ?? "")).toBe(300);
  });

  it("falls back to the default for an invalid decimationTarget", () => {
    const scene = payloadScene(dense(20_000), { domain: { xMin: 0, xMax: 20_000, yMin: -1, yMax: 1 } });
    const baseline = exportToSvg(scene);
    for (const bad of [NaN, Infinity, 1, 0, -10]) {
      expect(exportToSvg(scene, { decimationTarget: bad })).toBe(baseline);
    }
  });

});

describe("axes, ticks and gridlines", () => {
  const LOG: YAxisRegistration = {
    id: "log",
    scaleKind: Y_SCALE_KIND_LOG,
    domainMin: 1,
    domainMax: 1000,
    side: 0,
  };

  function lines(svg: string, color: string) {
    return elements(groupBody(svg, `stroke="${color}"`), "line").map((el) => ({
      x1: Number(attr(el, "x1")),
      y1: Number(attr(el, "y1")),
      x2: Number(attr(el, "x2")),
      y2: Number(attr(el, "y2")),
    }));
  }

  it("emits one horizontal gridline per decade tick at its projected position", () => {
    const scene = payloadScene([1, 10, 100, 1000], {
      yAxes: [LOG],
      domain: { xMin: 0, xMax: 3, yMin: 1, yMax: 1000 },
    });
    const svg = exportToSvg(scene);
    const layout = layoutFor(scene, "nm", "dBm");
    const t = layout.transforms[0];
    if (t === undefined) throw new Error("no transform");
    const ticks = new Float64Array(32);
    const k = selectLogTicks(1, 1000, DEFAULT_AXIS_LAYOUT.targetTickCount, ticks, 0);
    const horizontal = lines(svg, DEFAULT_FIGURE_STYLE.gridColor).filter((l) => l.y1 === l.y2);
    expect(horizontal.length).toBe(k);
    expect(horizontal.map((l) => l.y1)).toEqual(
      Array.from({ length: k }, (_, i) => Number(f(projectY(t, ticks[i] ?? 0)))),
    );
  });

  it("places X gridlines at the projection of each tick", () => {
    const scene = payloadScene([1, 2, 3, 4, 5], { domain: { xMin: 0, xMax: 4, yMin: 0, yMax: 10 } });
    const layout = layoutFor(scene, "nm", "dBm");
    const t = layout.transforms[0];
    if (t === undefined) throw new Error("no transform");
    const vertical = lines(exportToSvg(scene), DEFAULT_FIGURE_STYLE.gridColor).filter((l) => l.x1 === l.x2);
    expect(vertical.map((l) => l.x1)).toEqual(
      Array.from({ length: layout.xTickCount }, (_, i) => Number(f(projectX(t, layout.xTicks[i] ?? 0)))),
    );
  });

  it("stacks N Y axes in registration order, each with its ticks and labels in its own column", () => {
    const axes = [linearAxis("a", 0, 10), linearAxis("b", 0, 100), linearAxis("c", -5, 5)];
    const scene = collectionScene([{ id: "t", y: [1, 2, 3], yAxisId: "a" }], axes);
    const svg = exportToSvg(scene);
    const layout = layoutFor(scene);
    const t = layout.transforms[0];
    if (t === undefined) throw new Error("no transform");
    const gutter = axisGutterCss(DEFAULT_FIGURE_STYLE, DEFAULT_AXIS_LAYOUT);
    const axisLines = lines(svg, DEFAULT_FIGURE_STYLE.axisColor);
    const verticals = axisLines.filter(
      (l) => l.x1 === l.x2 && l.y1 === t.plotTop && l.y2 === t.plotTop + t.plotHeight,
    );
    expect(verticals.map((l) => l.x1)).toEqual([0, 1, 2].map((i) => Number(f(t.plotLeft - i * gutter))));

    const tick = DEFAULT_AXIS_LAYOUT.tickLength;
    for (let i = 0; i < 3; i += 1) {
      const axisX = t.plotLeft - i * gutter;
      const ticks = axisLines.filter((l) => l.y1 === l.y2 && l.x2 === Number(f(axisX)));
      expect(ticks.length).toBe(layout.yTickCounts[i]);
      expect(ticks.every((l) => l.x1 === Number(f(axisX - tick)))).toBe(true);
    }
    const labels = elements(groupBody(svg, `fill="${DEFAULT_FIGURE_STYLE.labelColor}"`), "text").filter((el) =>
      el.includes('text-anchor="end"'),
    );
    const labelXs = new Set(labels.map((el) => attr(el, "x")));
    expect(labelXs).toEqual(new Set([0, 1, 2].map((i) => f(t.plotLeft - i * gutter - tick))));
  });

  it("strokes axes at axisLineWidthCss and gridlines at one CSS pixel", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3]));
    expect(svg).toContain(`<g stroke="${DEFAULT_FIGURE_STYLE.axisColor}" stroke-width="1.5" fill="none">`);
    expect(svg).toContain(`<g stroke="${DEFAULT_FIGURE_STYLE.gridColor}" stroke-width="1" fill="none">`);
    expect(exportToSvg(payloadScene([1, 2, 3], { axes: { axisLineWidthCss: 2 } }))).toContain(
      `<g stroke="${DEFAULT_FIGURE_STYLE.axisColor}" stroke-width="2" fill="none">`,
    );
  });
});

describe("cross-backend label equality", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installRecordingPath2D();
  });
  afterEach(() => {
    restore();
  });

  function canvasLabels(draw: (renderer: Canvas2DRenderer) => void, axes: readonly YAxisRegistration[]) {
    const context = new RecordingContext();
    const renderer = new Canvas2DRenderer({ surface: recordingSurface(context), yAxes: axes });
    draw(renderer);
    renderer.resize(800, 400, 1);
    renderer.render();
    return context.calls
      .filter((c) => c.name === "fillText")
      .map((c) => ({ text: String(c.args[0]), x: f(Number(c.args[1])), y: f(Number(c.args[2])) }));
  }

  function svgLabels(svg: string) {
    return elements(groupBody(svg, `fill="${DEFAULT_FIGURE_STYLE.labelColor}"`), "text").map((el) => ({
      text: />([^<]*)</.exec(el)?.[1] ?? "",
      x: attr(el, "x"),
      y: attr(el, "y"),
    }));
  }

  it("matches in value and order for a collection scene (no units)", () => {
    const axes = [linearAxis("a", 0, 10), { ...linearAxis("b", 1, 1000), scaleKind: Y_SCALE_KIND_LOG }];
    const scene = collectionScene([{ id: "t", y: [1, 2, 3], yAxisId: "a" }], axes);
    if (!("entries" in scene.traces)) throw new Error("expected a collection");
    const collection = scene.traces;
    const expected = canvasLabels((r) => r.setTraces(collection), axes);
    const actual = svgLabels(exportToSvg(scene));
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(4);
    expect(actual.some((l) => l.text.includes("nm"))).toBe(false);
  });

  it("matches for a single-payload scene, units included", () => {
    const payload = payloadOf([1, 2, 3, 4, 5]);
    const axes = [linearAxis("y", 0, 10)];
    const scene = payloadScene([], { traces: payload, yAxes: axes, domain: { xMin: 0, xMax: 4, yMin: 0, yMax: 10 } });
    const expected = canvasLabels((r) => {
      r.setData(payload);
      r.setDomain(0, 4, 0, 10);
    }, axes);
    const actual = svgLabels(exportToSvg(scene));
    expect(actual).toEqual(expected);
    expect(actual.some((l) => l.text.endsWith("nm"))).toBe(true);
  });
});

describe("empty and degenerate input", () => {
  const cases: [string, () => ReturnType<typeof payloadScene>][] = [
    ["empty collection", () => collectionScene([], [linearAxis("y", 0, 10)])],
    ["zero-length payload", () => payloadScene([])],
    ["one-sample payload", () => payloadScene([3])],
    ["all-NaN payload", () => payloadScene([NaN, NaN, NaN])],
    ["zero-span x domain", () => payloadScene([1, 2, 3], { domain: { xMin: 2, xMax: 2, yMin: 0, yMax: 10 } })],
    ["zero-span y domain", () => payloadScene([1, 2, 3], { domain: { xMin: 0, xMax: 2, yMin: 5, yMax: 5 } })],
    ["non-finite size", () => payloadScene([1, 2, 3], { width: NaN, height: Infinity })],
    ["zero size", () => payloadScene([1, 2, 3], { width: 0, height: 0 })],
    ["negative size", () => payloadScene([1, 2, 3], { width: -5, height: -5 })],
    ["canvas narrower than the insets", () => payloadScene([1, 2, 3], { width: 10 })],
    ["canvas shorter than the insets", () => payloadScene([1, 2, 3], { height: 20 })],
    ["non-finite domain", () => payloadScene([1, 2, 3], { domain: { xMin: NaN, xMax: Infinity, yMin: -Infinity, yMax: NaN } })],
    ["inverted domain", () => payloadScene([1, 2, 3], { domain: { xMin: 5, xMax: 0, yMin: 9, yMax: 1 } })],
    [
      "log axis with a non-positive domain",
      () => payloadScene([1, 2, 3], { yAxes: [{ id: "l", scaleKind: Y_SCALE_KIND_LOG, domainMin: 0, domainMax: 10, side: 0 }] }),
    ],
    ["non-finite axis domain", () => payloadScene([1, 2, 3], { yAxes: [linearAxis("y", NaN, 3)] })],
    ["garbage style numbers", () => payloadScene([1, 2, 3], { axes: { tickLength: NaN, targetTickCount: NaN }, style: { lineWidthCss: NaN } })],
  ];

  it.each(cases)("%s returns a valid document and never throws", (_name, make) => {
    const svg = exportToSvg(make());
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toMatch(/\d[eE][+-]?\d/);
    assertWellFormedXml(svg);
  });

  it("an empty collection still draws axes and grid, with no path", () => {
    const svg = exportToSvg(collectionScene([], [linearAxis("y", 0, 10)]));
    expect(paths(svg).length).toBe(0);
    expect(elements(groupBody(svg, `stroke="${DEFAULT_FIGURE_STYLE.axisColor}"`), "line").length).toBeGreaterThan(0);
  });

  it("a canvas too small for the insets yields only the root, a zero-size clip and the background", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3], { width: 10 }));
    expect(svg).toContain('<clipPath id="tracekit-plot-clip"><rect x="0" y="0" width="0" height="0"/></clipPath>');
    expect(svg).toContain(`<rect x="0" y="0" width="10" height="400" fill="${DEFAULT_FIGURE_STYLE.backgroundColor}"/>`);
    expect(svg).not.toMatch(/<path|<line|<text/);
  });

  it("non-finite dimensions are treated as zero", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3], { width: NaN, height: Infinity }));
    expect(svg).toContain('width="0" height="0" viewBox="0 0 0 0"');
  });

  it("skips a trace on an unusable axis while keeping the document valid", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3], { yAxes: [linearAxis("y", NaN, 3)] }));
    expect(paths(svg).length).toBe(0);
  });

  it("emits a transform-safe document for a plot area narrower than the insets by a fraction", () => {
    expect(() => exportToSvg(payloadScene([1, 2, 3], { width: 28.5 }))).not.toThrow();
  });
});

describe("font embedding", () => {
  it("embeds exactly one @font-face from a data URI, with the label family", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3]), { embedFont: TRACEKIT_INTER_EMBEDDED_FONT });
    expect(svg.match(/@font-face/g)?.length).toBe(1);
    expect(svg.match(/<style>/g)?.length).toBe(1);
    expect(svg).toContain(`@font-face{font-family:"${TRACEKIT_INTER_FAMILY}";src:url(data:font/woff2;base64,`);
    expect(svg).toContain('format("woff2")');
    expect(svg).toContain(`font-family="${TRACEKIT_INTER_FAMILY}, sans-serif"`);
    assertWellFormedXml(svg);
  });

  it("ignores a non-data URL and a data URL that could break out of the style block", () => {
    const scene = payloadScene([1, 2, 3]);
    const plain = exportToSvg(scene);
    expect(exportToSvg(scene, { embedFont: { dataUrl: "https://example.com/f.woff2", format: "woff2" } })).toBe(plain);
    expect(exportToSvg(scene, { embedFont: { dataUrl: "data:font/woff2;base64,AA);}</style><script>", format: "woff2" } })).toBe(plain);
  });

  it("exposes a frozen, structurally typed font constant", () => {
    expect(Object.isFrozen(TRACEKIT_INTER_EMBEDDED_FONT)).toBe(true);
    expect(TRACEKIT_INTER_EMBEDDED_FONT.format).toBe("woff2");
    expect(TRACEKIT_INTER_EMBEDDED_FONT.dataUrl.startsWith("data:font/woff2;base64,")).toBe(true);
  });
});

describe("determinism", () => {
  it("returns identical strings for repeated calls and equal-by-value scenes", () => {
    const y = Array.from({ length: 2000 }, (_, i) => Math.sin(i / 20));
    const a = exportToSvg(payloadScene(y));
    expect(exportToSvg(payloadScene(y))).toBe(a);
    expect(exportToSvg(payloadScene(y))).toBe(a);
  });

  it("contains no environment-derived content", () => {
    const svg = exportToSvg(payloadScene([1, 2, 3, NaN, 5]));
    expect(svg).not.toMatch(/\r|\d{4}-\d{2}-\d{2}|Date|random/i);
  });

  it("never touches a locale-aware API", () => {
    const spy = vi.spyOn(Number.prototype, "toLocaleString");
    try {
      exportToSvg(payloadScene([1.5, 2.25, 3.125]));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
