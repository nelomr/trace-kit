import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
} from "@trace-kit/core";
import { createElement, useRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TraceSpectrumViewer, snapshotDomain, useSpectrumEngine } from "../../src/index.js";

describe("react-ssr-and-lifecycle: Node SSR isomorphism (node)", () => {
  it("imports @trace-kit/react cleanly in plain Node with zero DOM globals", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof TraceSpectrumViewer).toBe("object");
    expect(typeof useSpectrumEngine).toBe("function");
    expect(typeof snapshotDomain).toBe("function");
  });

  it("renders TraceSpectrumViewer via renderToString with zero DOM globals and emits two-layer markup", () => {
    const payload = createSpectrumDataPayload({
      capacity: 64,
      xOrigin: 1550,
      xUnit: "nm",
      yUnit: "dBm",
    });
    for (let i = 0; i < 64; i += 1) {
      payload.x[i] = i * 0.1;
      payload.y[i] = -40;
    }
    commitPayloadRevision(payload, 64);

    const html = renderToString(
      createElement(
        TraceSpectrumViewer,
        {
          id: "ssr-viewer",
          className: "ssr-chart",
          data: payload,
          domain: { xMin: 1550, xMax: 1556, yMin: -70, yMax: 0 },
          figureStyle: { backgroundColor: "#090c10" },
          renderOverlay: (snap) =>
            createElement("span", null, `${snap.activeKind}:${snap.domain.xMin}`),
        },
        createElement("div", { className: "legend" }, "SSR Legend"),
      ),
    );

    expect(html).toContain('data-trace-kit-viewer=""');
    expect(html).toContain('data-trace-kit-surface=""');
    expect(html).toContain('data-trace-kit-slot-overlay=""');
    expect(html).toContain('id="ssr-viewer"');
    expect(html).toContain('class="ssr-chart"');
    expect(html).toContain("canvas2d:1550");
    expect(html).toContain("SSR Legend");
  });

  it("omits slot overlay wrapper during SSR when renderOverlay is absent", () => {
    const html = renderToString(createElement(TraceSpectrumViewer, {}));
    expect(html).toContain('data-trace-kit-viewer=""');
    expect(html).toContain('data-trace-kit-surface=""');
    expect(html).not.toContain("data-trace-kit-slot-overlay");
  });

  it("renders TraceCollection and standalone useSpectrumEngine cleanly in Node SSR", () => {
    const payload = createSpectrumDataPayload({
      capacity: 32,
      xOrigin: 1530,
      xUnit: "nm",
      yUnit: "dBm",
    });
    for (let i = 0; i < 32; i += 1) {
      payload.x[i] = i;
      payload.y[i] = -30;
    }
    commitPayloadRevision(payload, 32);

    const traces = createTraceCollection(
      [{ id: "t1", payload, yAxisId: "y0", style: { color: "#38bdf8", lineWidthCss: 1.5 } }],
      [{ id: "y0", scaleKind: Y_SCALE_KIND_LINEAR, side: AXIS_SIDE_LEFT, domainMin: -80, domainMax: 0 }],
      1530,
      1562,
    );

    function CustomHookComponent() {
      const ref = useRef<HTMLDivElement | null>(null);
      const engine = useSpectrumEngine(ref, { traces, mode: "webgl2" });
      return createElement("section", { ref }, `${engine.isReady}:${engine.mode}:${engine.activeKind}`);
    }

    const html = renderToString(createElement(CustomHookComponent));
    expect(html).toContain("false:webgl2:canvas2d");
  });
});
