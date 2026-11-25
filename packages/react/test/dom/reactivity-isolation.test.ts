import { commitPayloadRevision } from "@trace-kit/core";
import type { ViewportDomain, ViewportMutationReason } from "@trace-kit/renderers/controller";
import { act, createElement, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import type { SpectrumEngineHandle, SpectrumEngineSnapshot } from "../../src/types.js";
import {
  createMockPlatform,
  createTestPayload,
  createWheelEvent,
  mockElementBoundingRect,
  mountReact,
} from "./test-helpers.js";

describe("react-reactivity-isolation (react-dom)", () => {
  it("causes ZERO React re-renders across 60 consecutive frames of Path A in-place streaming", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(4096);
    const originalBuffer = payload.y.buffer;

    let renderCount = 0;
    let handleRef: ReturnType<typeof useSpectrumEngine> | null = null;

    function StreamingHost() {
      renderCount += 1;
      const containerRef = useRef<HTMLDivElement | null>(null);
      handleRef = useSpectrumEngine(containerRef, {
        data: payload,
        platform: harness.platform,
      });
      return createElement("div", { ref: containerRef });
    }

    const mounted = mountReact(createElement(StreamingHost));
    act(() => {
      harness.raf.flushAll();
    });

    const settledRenderCount = renderCount;

    // 60 Hz Path A streaming: in-place mutation + commitPayloadRevision + requestRender()
    for (let frame = 0; frame < 60; frame += 1) {
      payload.y[0] = -50 + frame * 0.1;
      commitPayloadRevision(payload, 4096);
      act(() => {
        handleRef!.requestRender();
        harness.raf.flushAll();
      });
    }

    expect(renderCount).toBe(settledRenderCount);
    expect(payload.y.buffer).toBe(originalBuffer);
    expect(harness.canvas2dRenderers[0]!.renderCount).toBeGreaterThanOrEqual(60);

    mounted.unmount();
  });

  it("isolates overlay updates so pan/zoom never re-renders the outer viewer or recreates canvases", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    const viewerRef: { current: SpectrumEngineHandle | null } = { current: null };

    let parentRenderCount = 0;
    let overlayRenderCount = 0;
    let lastOverlayDomain: ViewportDomain | null = null;

    function Parent() {
      parentRenderCount += 1;
      return createElement(TraceSpectrumViewer, {
        ref: viewerRef,
        data: payload,
        domain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 },
        platform: harness.platform,
        renderOverlay: (snap: SpectrumEngineSnapshot) => {
          overlayRenderCount += 1;
          lastOverlayDomain = snap.domain;
          return createElement(
            "span",
            { "data-testid": "overlay-x" },
            `${snap.domain.xMin.toFixed(1)}-${snap.domain.xMax.toFixed(1)}`,
          );
        },
      });
    }

    const mounted = mountReact(createElement(Parent));
    act(() => {
      harness.raf.flushAll();
    });

    const surface = mounted.host.querySelector("[data-trace-kit-surface]") as HTMLDivElement;
    const canvasBefore = surface.querySelector("canvas");
    const parentCountBefore = parentRenderCount;
    const overlayCountBefore = overlayRenderCount;

    act(() => {
      viewerRef.current!.setDomain(20, 60, -70, -10);
    });

    expect(parentRenderCount).toBe(parentCountBefore);
    expect(overlayRenderCount).toBeGreaterThan(overlayCountBefore);
    expect(lastOverlayDomain).toEqual({ xMin: 20, xMax: 60, yMin: -70, yMax: -10 });
    expect(surface.querySelector("canvas")).toBe(canvasBefore);

    mounted.unmount();
  });

  it("suppresses controlled domain feedback loops via Dual Echo Guard (WeakSet + 4-scalar equality)", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(1024);
    const onDomainSpy = vi.fn<(d: ViewportDomain, r: ViewportMutationReason) => void>();

    function ControlledHost() {
      const [domain, setDomain] = useState<ViewportDomain>({
        xMin: 0,
        xMax: 100,
        yMin: -80,
        yMax: 0,
      });

      return createElement(TraceSpectrumViewer, {
        data: payload,
        domain,
        platform: harness.platform,
        onDomainChange: (nextDomain, reason) => {
          onDomainSpy(nextDomain, reason);
          // Even when consumer clones into a fresh object, 4-scalar equality still suppresses echo
          setDomain({ ...nextDomain });
        },
      });
    }

    const mounted = mountReact(createElement(ControlledHost));
    act(() => {
      harness.raf.flushAll();
    });

    const surface = mounted.host.querySelector("[data-trace-kit-surface]") as HTMLDivElement;
    mockElementBoundingRect(surface, { left: 0, top: 0, width: 800, height: 400 });

    const renderer = harness.canvas2dRenderers[0]!;
    const setDomainCallsBefore = renderer.setDomainCalls.length;

    act(() => {
      surface.dispatchEvent(createWheelEvent({ clientX: 400, clientY: 200, deltaY: -120 }));
      harness.raf.flushAll();
    });

    // Interaction controller calls controller.setDomain once; React re-render with echoed state
    // MUST NOT call controller.setDomain a second time!
    expect(onDomainSpy).toHaveBeenCalledTimes(1);
    expect(renderer.setDomainCalls.length).toBe(setDomainCallsBefore + 1);

    mounted.unmount();
  });
});
