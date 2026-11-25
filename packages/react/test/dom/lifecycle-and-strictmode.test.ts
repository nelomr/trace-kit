import { StrictMode, act, createElement, useRef } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import type { SpectrumEngineHandle, UseSpectrumEngineReturn } from "../../src/types.js";
import {
  createMockPlatform,
  createMountedHost,
  createTestPayload,
  enableReactActEnvironment,
  mountReact,
} from "./test-helpers.js";

describe("react-ssr-and-lifecycle: StrictMode, teardown ordering, cycles & hydration (react-dom)", () => {
  it("handles React.StrictMode double-invoke cleanly with zero leaked canvases and strict teardown order", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };
    const onReady = vi.fn();

    const mounted = mountReact(
      createElement(
        StrictMode,
        null,
        createElement(TraceSpectrumViewer, {
          ref: viewerRef,
          data: payload,
          platform: harness.platform,
          onReady,
        }),
      ),
    );

    act(() => {
      harness.raf.flushAll();
    });

    const surfaceEl = mounted.host.querySelector("[data-trace-kit-surface]") as HTMLDivElement;

    expect(onReady).toHaveBeenCalledTimes(2);
    expect(harness.canvas2dRenderers.length).toBe(2);
    expect(harness.canvas2dRenderers[0]!.disposed).toBe(true);
    expect(harness.canvas2dRenderers[1]!.disposed).toBe(false);
    expect(surfaceEl.querySelectorAll("canvas").length).toBe(1);
    expect(harness.resizeObservers.activeCount()).toBe(1);
    expect(viewerRef.current?.controller?.disposed).toBe(false);
    expect(viewerRef.current?.interaction?.disposed).toBe(false);

    const order: string[] = [];
    const ctrl = viewerRef.current!.controller!;
    const inter = viewerRef.current!.interaction!;
    const origInterDispose = inter.dispose.bind(inter);
    const origCtrlDispose = ctrl.dispose.bind(ctrl);
    vi.spyOn(inter, "dispose").mockImplementation(() => {
      order.push("interaction");
      origInterDispose();
    });
    vi.spyOn(ctrl, "dispose").mockImplementation(() => {
      order.push("controller");
      origCtrlDispose();
    });

    mounted.unmount();

    expect(order).toEqual(["interaction", "controller"]);
    expect(surfaceEl.querySelectorAll("canvas").length).toBe(0);
    expect(harness.resizeObservers.activeCount()).toBe(0);
    expect(surfaceEl.style.touchAction).toBe("");
  });

  it("leaks zero ResizeObservers, rAF handles, controllers, or DOM canvases across 20 mount/unmount cycles", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);

    for (let i = 0; i < 20; i += 1) {
      const mounted = mountReact(
        createElement(TraceSpectrumViewer, {
          data: payload,
          platform: harness.platform,
        }),
      );
      act(() => {
        harness.raf.flushAll();
      });
      mounted.unmount();
    }

    expect(harness.resizeObservers.activeCount()).toBe(0);
    expect(harness.raf.pendingCount()).toBe(0);
    expect(harness.canvas2dRenderers.every((r) => r.disposed)).toBe(true);
    expect(document.querySelectorAll("[data-trace-kit-viewer]").length).toBe(0);
  });

  it("does not resurrect a disposed controller across conditional false -> true -> false -> true toggles", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };

    function Conditional(props: { show: boolean }) {
      return props.show
        ? createElement(TraceSpectrumViewer, {
            ref: viewerRef,
            data: payload,
            platform: harness.platform,
          })
        : createElement("div", { "data-testid": "placeholder" });
    }

    const mounted = mountReact(createElement(Conditional, { show: false }));
    expect(viewerRef.current).toBeNull();

    mounted.rerender(createElement(Conditional, { show: true }));
    const firstCtrl = viewerRef.current!.controller!;
    expect(firstCtrl.disposed).toBe(false);

    mounted.rerender(createElement(Conditional, { show: false }));
    expect(firstCtrl.disposed).toBe(true);

    mounted.rerender(createElement(Conditional, { show: true }));
    const secondCtrl = viewerRef.current!.controller!;
    expect(secondCtrl).not.toBe(firstCtrl);
    expect(secondCtrl.disposed).toBe(false);

    mounted.unmount();
    expect(secondCtrl.disposed).toBe(true);
  });

  it("manual dispose() before unmount is idempotent and unmount does not throw", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(128);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };

    const mounted = mountReact(
      createElement(TraceSpectrumViewer, {
        ref: viewerRef,
        data: payload,
        platform: harness.platform,
      }),
    );

    act(() => {
      viewerRef.current!.dispose();
      viewerRef.current!.dispose();
    });
    expect(viewerRef.current!.controller).toBeNull();
    expect(() => mounted.unmount()).not.toThrow();
  });

  it("reconciles dynamic containerRef.current transitions (null -> el1 -> null -> el2) and swaps cleanly without leaks", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function DynamicContainerHost(props: { stage: "hidden" | "first" | "second" }) {
      const containerRef = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(containerRef, {
        data: payload,
        platform: harness.platform,
      });
      if (props.stage === "hidden") {
        return createElement("span", { "data-testid": "loading" }, "Loading...");
      }
      return createElement("div", {
        key: props.stage,
        ref: containerRef,
        "data-stage": props.stage,
      });
    }

    // 1. Initial null container -> stays cleanly unmounted
    const mounted = mountReact(createElement(DynamicContainerHost, { stage: "hidden" }));
    expect(latestHandle!.isReady).toBe(false);
    expect(latestHandle!.controller).toBeNull();
    expect(harness.resizeObservers.activeCount()).toBe(0);

    // 2. null -> el1: dynamically mounts controller on first div
    mounted.rerender(createElement(DynamicContainerHost, { stage: "first" }));
    act(() => {
      harness.raf.flushAll();
    });
    const firstController = latestHandle!.controller;
    expect(firstController).not.toBeNull();
    expect(firstController!.disposed).toBe(false);
    expect(latestHandle!.isReady).toBe(true);
    expect(harness.resizeObservers.activeCount()).toBe(1);

    // 3. el1 -> null: disposes controller immediately without waiting for component unmount
    mounted.rerender(createElement(DynamicContainerHost, { stage: "hidden" }));
    expect(firstController!.disposed).toBe(true);
    expect(latestHandle!.controller).toBeNull();
    expect(latestHandle!.isReady).toBe(false);
    expect(harness.resizeObservers.activeCount()).toBe(0);

    // 4. null -> el2: attaches fresh controller on second div
    mounted.rerender(createElement(DynamicContainerHost, { stage: "second" }));
    act(() => {
      harness.raf.flushAll();
    });
    const secondController = latestHandle!.controller;
    expect(secondController).not.toBeNull();
    expect(secondController).not.toBe(firstController);
    expect(secondController!.disposed).toBe(false);
    expect(harness.resizeObservers.activeCount()).toBe(1);

    // 5. Direct DOM node swap el2 -> el1 in one commit: disposes el2 controller, mounts el1
    mounted.rerender(createElement(DynamicContainerHost, { stage: "first" }));
    expect(secondController!.disposed).toBe(true);
    expect(latestHandle!.controller).not.toBeNull();
    expect(latestHandle!.controller!.disposed).toBe(false);
    expect(harness.resizeObservers.activeCount()).toBe(1);

    mounted.unmount();
    expect(harness.resizeObservers.activeCount()).toBe(0);
    expect(harness.canvas2dRenderers.every((r) => r.disposed)).toBe(true);
  });

  it("does not resurrect a manually disposed controller on subsequent parent re-renders on the same container", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(128);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { tick: number }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        platform: harness.platform,
      });
      return createElement("div", { ref, "data-tick": props.tick });
    }

    const mounted = mountReact(createElement(Host, { tick: 0 }));
    const ctrl = latestHandle!.controller!;
    expect(ctrl.disposed).toBe(false);

    act(() => {
      latestHandle!.dispose();
    });
    expect(ctrl.disposed).toBe(true);
    expect(latestHandle!.controller).toBeNull();

    // Parent re-render with the SAME DOM node must NOT resurrect controller
    mounted.rerender(createElement(Host, { tick: 1 }));
    expect(latestHandle!.controller).toBeNull();
    expect(harness.canvas2dRenderers.length).toBe(1);
    expect(harness.resizeObservers.activeCount()).toBe(0);

    mounted.unmount();
  });

  it("hydrates bare SSR markup (without overlay or children) with zero React errors", () => {
    enableReactActEnvironment();
    const harness = createMockPlatform();
    const payload = createTestPayload(128);

    const ssrHtml = renderToString(createElement(TraceSpectrumViewer, { data: payload }));
    const host = createMountedHost();
    host.innerHTML = ssrHtml;

    const consoleErrorSpy = vi.spyOn(console, "error");
    let root: ReturnType<typeof hydrateRoot> | null = null;
    act(() => {
      root = hydrateRoot(
        host,
        createElement(TraceSpectrumViewer, {
          data: payload,
          platform: harness.platform,
        }),
      );
    });
    act(() => {
      harness.raf.flushAll();
    });

    expect(host.querySelectorAll("canvas").length).toBe(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    host.remove();
    consoleErrorSpy.mockRestore();
  });

  it("hydrates SSR markup with renderOverlay and children cleanly via hydrateRoot without mismatch warnings", () => {
    enableReactActEnvironment();
    const harness = createMockPlatform();
    const payload = createTestPayload(256);

    const ssrHtml = renderToString(
      createElement(
        TraceSpectrumViewer,
        {
          data: payload,
          className: "hydrated-viewer",
          renderOverlay: (snap) => createElement("span", null, snap.activeKind),
        },
        createElement("div", { className: "legend" }, "Legend"),
      ),
    );

    expect(ssrHtml).toContain("data-trace-kit-viewer");
    expect(ssrHtml).toContain("data-trace-kit-surface");
    expect(ssrHtml).toContain("data-trace-kit-slot-overlay");
    expect(ssrHtml).toContain("Legend");

    const host = createMountedHost();
    host.innerHTML = ssrHtml;

    const consoleErrorSpy = vi.spyOn(console, "error");
    let root: ReturnType<typeof hydrateRoot> | null = null;
    act(() => {
      root = hydrateRoot(
        host,
        createElement(
          TraceSpectrumViewer,
          {
            data: payload,
            className: "hydrated-viewer",
            platform: harness.platform,
            renderOverlay: (snap) => createElement("span", null, snap.activeKind),
          },
          createElement("div", { className: "legend" }, "Legend"),
        ),
      );
    });

    act(() => {
      harness.raf.flushAll();
    });

    const surface = host.querySelector("[data-trace-kit-surface]") as HTMLDivElement;
    expect(surface.querySelectorAll("canvas").length).toBe(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    host.remove();
    consoleErrorSpy.mockRestore();
  });
});
