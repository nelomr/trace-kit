/** @vitest-environment node */
import { commitPayloadRevision, createSpectrumDataPayload } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { createSSRApp, effectScope, h, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import type { TraceSpectrumViewerSlotProps, UseSpectrumEngineReturn } from "../../src/types.js";

describe("vue-ssr-and-lifecycle: Node SSR isomorphism (node)", () => {
  it("imports @trace-kit/vue cleanly in plain Node with zero DOM globals", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof ResizeObserver).toBe("undefined");
    expect(typeof HTMLCanvasElement).toBe("undefined");
    expect(typeof requestAnimationFrame).toBe("undefined");

    const mod = await import("../../src/index.js");
    expect(typeof mod.useSpectrumEngine).toBe("function");
    expect(typeof mod.snapshotDomain).toBe("function");
    expect(mod.TraceSpectrumViewer).toBeDefined();
  });

  it("renders deterministic bare static HTML via renderToString without touching DOM globals", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");

    const { TraceSpectrumViewer } = await import("../../src/index.js");
    const payload = createSpectrumDataPayload({
      capacity: 16,
      xOrigin: 0,
      xUnit: "nm",
      yUnit: "dBm",
    });
    commitPayloadRevision(payload, 16);

    const app = createSSRApp({
      render() {
        return h(TraceSpectrumViewer, {
          class: "ssr-chart",
          style: "height: 300px",
          data: payload,
        });
      },
    });

    const html = await renderToString(app);
    expect(html).toMatch(/<div data-trace-kit-viewer(?:="")?\b/);
    expect(html).toContain('class="ssr-chart"');
    expect(html).toContain("position:relative");
    expect(html).toContain("height:300px");
    expect(html).toMatch(
      /<div data-trace-kit-surface(?:="")? style="position:absolute;inset:0;width:100%;height:100%;"><\/div>/,
    );
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("data-trace-kit-slot-overlay");
  });

  it("renders sibling slot-overlay and trailing default slot deterministically in Node SSR", async () => {
    const { TraceSpectrumViewer } = await import("../../src/index.js");

    const app = createSSRApp({
      render() {
        return h(
          TraceSpectrumViewer,
          {},
          {
            overlay: (slotProps: TraceSpectrumViewerSlotProps) =>
              h("span", { class: "hud" }, `ready:${String(slotProps.isReady)}`),
            default: (slotProps: TraceSpectrumViewerSlotProps) =>
              h("p", { class: "a11y-summary" }, `mode:${slotProps.mode}`),
          },
        );
      },
    });

    const html = await renderToString(app);
    const surfaceIndex = html.indexOf("<div data-trace-kit-surface");
    const overlayIndex = html.indexOf("<div data-trace-kit-slot-overlay");
    const defaultIndex = html.indexOf('<p class="a11y-summary"');

    expect(surfaceIndex).toBeGreaterThan(-1);
    expect(overlayIndex).toBeGreaterThan(surfaceIndex);
    expect(defaultIndex).toBeGreaterThan(overlayIndex);
    expect(html).toMatch(
      /<div data-trace-kit-surface(?:="")? style="position:absolute;inset:0;width:100%;height:100%;"><\/div>/,
    );
    expect(html).toContain("ready:false");
    expect(html).toContain("mode:auto");
    expect(html).not.toContain("<canvas");
  });

  it("keeps standalone effectScope() cleanly inert in Node SSR without throwing", async () => {
    expect(typeof document).toBe("undefined");
    const { useSpectrumEngine } = await import("../../src/index.js");

    const scope = effectScope();
    let captured: UseSpectrumEngineReturn | null = null;
    expect(() => {
      scope.run(() => {
        captured = useSpectrumEngine(shallowRef(null));
      });
    }).not.toThrow();

    expect(captured).not.toBeNull();
    expect(captured!.controller.value).toBeNull();
    expect(captured!.interaction.value).toBeNull();
    expect(captured!.isReady.value).toBe(false);

    expect(() => {
      scope.stop();
    }).not.toThrow();
  });
});
