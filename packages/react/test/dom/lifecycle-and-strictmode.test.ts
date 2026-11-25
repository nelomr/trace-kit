import { StrictMode, act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import type { SpectrumEngineHandle } from "../../src/types.js";
import {
  createMockPlatform,
  createMountedHost,
  createTestPayload,
  enableReactActEnvironment,
  mountReact,
} from "./test-helpers.js";

describe("react-ssr-and-lifecycle: StrictMode, teardown ordering & hydration (react-dom)", () => {
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

    // Under StrictMode dev mount -> cleanup -> remount, exactly 1 live renderer remains
    expect(surfaceEl.querySelectorAll("canvas").length).toBe(1);
    expect(harness.resizeObservers.activeCount()).toBe(1);
    expect(viewerRef.current?.controller?.disposed).toBe(false);
    expect(viewerRef.current?.interaction?.disposed).toBe(false);

    // Track strict teardown ordering: interaction.dispose() MUST run before controller.dispose()
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

  it("hydrates SSR markup cleanly via hydrateRoot without mismatch warnings", () => {
    enableReactActEnvironment();
    const harness = createMockPlatform();
    const payload = createTestPayload(256);

    const ssrHtml = renderToString(
      createElement(TraceSpectrumViewer, {
        data: payload,
        className: "hydrated-viewer",
        renderOverlay: (snap) => createElement("span", null, snap.activeKind),
      }),
    );

    expect(ssrHtml).toContain("data-trace-kit-viewer");
    expect(ssrHtml).toContain("data-trace-kit-surface");
    expect(ssrHtml).toContain("data-trace-kit-slot-overlay");

    const host = createMountedHost();
    host.innerHTML = ssrHtml;

    const consoleErrorSpy = vi.spyOn(console, "error");
    let root: ReturnType<typeof hydrateRoot> | null = null;
    act(() => {
      root = hydrateRoot(
        host,
        createElement(TraceSpectrumViewer, {
          data: payload,
          className: "hydrated-viewer",
          platform: harness.platform,
          renderOverlay: (snap) => createElement("span", null, snap.activeKind),
        }),
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
