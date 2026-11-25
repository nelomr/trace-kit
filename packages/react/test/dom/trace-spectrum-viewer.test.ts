import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import type { SpectrumEngineHandle } from "../../src/types.js";
import { createMockPlatform, createTestPayload, mountReact } from "./test-helpers.js";

describe("TraceSpectrumViewer component (react-dom)", () => {
  it("renders two-layer unmanaged DOM shell with sibling overlay, trailing children, and non-colliding figureStyle/style", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };
    const onReady = vi.fn();

    const mounted = mountReact(
      createElement(
        TraceSpectrumViewer,
        {
          ref: viewerRef,
          id: "osa-viewer",
          className: "osa-stage",
          style: { width: "100%", height: "420px" },
          figureStyle: { backgroundColor: "#090c10", gridColor: "#1e2835" },
          data: payload,
          platform: harness.platform,
          onReady,
          renderOverlay: (snap) =>
            createElement("div", { "data-testid": "hud" }, snap.activeKind.toUpperCase()),
        },
        createElement("footer", { "data-testid": "legend" }, "C-Band Legend"),
      ),
    );

    const viewerEl = mounted.host.querySelector("[data-trace-kit-viewer]") as HTMLDivElement;
    const surfaceEl = viewerEl.querySelector("[data-trace-kit-surface]") as HTMLDivElement;
    const overlayEl = viewerEl.querySelector("[data-trace-kit-slot-overlay]") as HTMLDivElement;
    const legendEl = viewerEl.querySelector('[data-testid="legend"]') as HTMLElement;

    expect(viewerEl).not.toBeNull();
    expect(viewerEl.id).toBe("osa-viewer");
    expect(viewerEl.className).toBe("osa-stage");
    expect(viewerEl.style.position).toBe("relative");
    expect(viewerEl.style.height).toBe("420px");

    // Surface, overlay, and trailing child are direct siblings under [data-trace-kit-viewer]
    expect(surfaceEl.parentElement).toBe(viewerEl);
    expect(overlayEl.parentElement).toBe(viewerEl);
    expect(legendEl.parentElement).toBe(viewerEl);
    expect(overlayEl.style.pointerEvents).toBe("none");
    expect(overlayEl.textContent).toBe("CANVAS2D");

    // figureStyle passed to renderer, not DOM style
    expect(harness.canvas2dOptions[0]?.style).toEqual({
      backgroundColor: "#090c10",
      gridColor: "#1e2835",
    });

    // Forwarded handle works
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(viewerRef.current).not.toBeNull();
    expect(viewerRef.current!.controller).not.toBeNull();
    expect(viewerRef.current!.interaction).not.toBeNull();

    mounted.unmount();
  });

  it("omits [data-trace-kit-slot-overlay] when renderOverlay is not provided and preserves siblings across 1 <-> 3 canvas swaps", () => {
    const harness = createMockPlatform();
    const smallPayload = createTestPayload(1024);
    const largePayload = createTestPayload(100_000);

    const mounted = mountReact(
      createElement(
        TraceSpectrumViewer,
        {
          data: smallPayload,
          mode: "auto",
          platform: harness.platform,
        },
        createElement("span", { "data-testid": "child" }, "sibling"),
      ),
    );

    act(() => {
      harness.raf.flushAll();
    });

    const viewerEl = mounted.host.querySelector("[data-trace-kit-viewer]") as HTMLDivElement;
    const surfaceEl = viewerEl.querySelector("[data-trace-kit-surface]") as HTMLDivElement;
    expect(viewerEl.querySelector("[data-trace-kit-slot-overlay]")).toBeNull();
    expect(surfaceEl.querySelectorAll("canvas").length).toBe(1);

    // Swap Canvas2D (1 canvas) -> WebGL2 (3 canvases) via hysteresis
    mounted.rerender(
      createElement(
        TraceSpectrumViewer,
        {
          data: largePayload,
          mode: "auto",
          platform: harness.platform,
        },
        createElement("span", { "data-testid": "child" }, "sibling"),
      ),
    );
    act(() => {
      harness.raf.flushAll();
    });

    expect(surfaceEl.querySelectorAll("canvas").length).toBe(3);
    expect(viewerEl.querySelector('[data-testid="child"]')?.textContent).toBe("sibling");

    mounted.unmount();
  });
});
