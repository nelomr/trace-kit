import { commitPayloadRevision, createSpectrumDataPayload } from "@trace-kit/core";
import { createElement } from "react";
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
});
