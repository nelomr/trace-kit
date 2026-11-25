import type { ViewportDomain } from "@trace-kit/renderers/controller";
import { act, createElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import type { SpectrumEngineHandle } from "../../src/types.js";
import { createMockPlatform, createTestPayload, mountReact } from "./test-helpers.js";

describe("TraceSpectrumViewer component (react-dom)", () => {
  it("defaults interactive and autoResize to true and mounts clean two-layer DOM without overlay", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };

    const mounted = mountReact(
      createElement(TraceSpectrumViewer, {
        ref: viewerRef,
        data: payload,
        platform: harness.platform,
      }),
    );

    const viewerEl = mounted.host.querySelector("[data-trace-kit-viewer]") as HTMLDivElement;
    const surfaceEl = viewerEl.querySelector("[data-trace-kit-surface]") as HTMLDivElement;

    expect(viewerEl).not.toBeNull();
    expect(surfaceEl).not.toBeNull();
    expect(viewerEl.querySelector("[data-trace-kit-slot-overlay]")).toBeNull();
    expect(viewerRef.current?.interaction).not.toBeNull();
    expect(harness.resizeObservers.activeCount()).toBe(1);

    mounted.unmount();
  });

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

    expect(viewerEl.id).toBe("osa-viewer");
    expect(viewerEl.className).toBe("osa-stage");
    expect(viewerEl.style.position).toBe("relative");
    expect(viewerEl.style.height).toBe("420px");

    expect(surfaceEl.parentElement).toBe(viewerEl);
    expect(overlayEl.parentElement).toBe(viewerEl);
    expect(legendEl.parentElement).toBe(viewerEl);
    expect(overlayEl.style.pointerEvents).toBe("none");
    expect(overlayEl.textContent).toBe("CANVAS2D");

    expect(harness.canvas2dOptions[0]?.style).toEqual({
      backgroundColor: "#090c10",
      gridColor: "#1e2835",
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(viewerRef.current?.controller).not.toBeNull();
    expect(viewerRef.current?.interaction).not.toBeNull();

    mounted.unmount();
  });

  it("preserves sibling children and exact DOM structure across 1 <-> 3 canvas hysteresis swaps", () => {
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
    expect(surfaceEl.querySelectorAll("canvas").length).toBe(1);

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

  it("preserves exact <canvas> references across unrelated parent re-renders", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    let setTick: ((n: number) => void) | null = null;

    function Parent() {
      const [tick, updateTick] = useState(0);
      setTick = updateTick;
      return createElement(
        TraceSpectrumViewer,
        {
          data: payload,
          platform: harness.platform,
        },
        createElement("span", { "data-testid": "tick" }, String(tick)),
      );
    }

    const mounted = mountReact(createElement(Parent));
    const surface = mounted.host.querySelector("[data-trace-kit-surface]") as HTMLDivElement;
    const initialCanvas = surface.querySelector("canvas");

    act(() => {
      setTick!(1);
    });
    act(() => {
      setTick!(2);
    });

    expect(surface.querySelector("canvas")).toBe(initialCanvas);
    expect(mounted.host.querySelector('[data-testid="tick"]')?.textContent).toBe("2");

    mounted.unmount();
  });

  it("repaints via forwarded handle.requestRender() with ZERO parent React re-renders", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };
    let parentRenders = 0;

    function Parent() {
      parentRenders += 1;
      return createElement(TraceSpectrumViewer, {
        ref: viewerRef,
        data: payload,
        platform: harness.platform,
      });
    }

    const mounted = mountReact(createElement(Parent));
    act(() => {
      harness.raf.flushAll();
    });
    const settledRenders = parentRenders;
    const rendererRendersBefore = harness.canvas2dRenderers[0]!.renderCount;

    act(() => {
      viewerRef.current!.requestRender();
      harness.raf.flushAll();
    });

    expect(parentRenders).toBe(settledRenders);
    expect(harness.canvas2dRenderers[0]!.renderCount).toBe(rendererRendersBefore + 1);

    mounted.unmount();
  });

  it("applies external parent domain prop updates without echoing back to onDomainChange", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    const onDomainChange = vi.fn();
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };

    const mounted = mountReact(
      createElement(TraceSpectrumViewer, {
        ref: viewerRef,
        data: payload,
        domain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 },
        onDomainChange,
        platform: harness.platform,
      }),
    );

    const nextDomain: ViewportDomain = { xMin: 40, xMax: 60, yMin: -50, yMax: -10 };
    mounted.rerender(
      createElement(TraceSpectrumViewer, {
        ref: viewerRef,
        data: payload,
        domain: nextDomain,
        onDomainChange,
        platform: harness.platform,
      }),
    );

    expect(viewerRef.current!.controller!.domain).toEqual(nextDomain);
    expect(onDomainChange).not.toHaveBeenCalled();

    mounted.unmount();
  });
});
