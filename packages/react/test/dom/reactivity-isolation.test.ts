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

  it("supports Path B scalar revision streaming without cloning TypedArray backing buffers", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(2048);
    const origXBuf = payload.x.buffer;
    const origYBuf = payload.y.buffer;

    function PathBHost(props: { revision: number }) {
      return createElement(TraceSpectrumViewer, {
        data: payload,
        revision: props.revision,
        platform: harness.platform,
      });
    }

    const mounted = mountReact(createElement(PathBHost, { revision: 1 }));
    act(() => {
      harness.raf.flushAll();
    });

    const renderer = harness.canvas2dRenderers[0]!;
    const setDataCountBefore = renderer.setDataCalls.length;
    const renderCountBefore = renderer.renderCount;

    payload.y[10] = -12.5;
    commitPayloadRevision(payload, 2048);
    mounted.rerender(createElement(PathBHost, { revision: 2 }));
    act(() => {
      harness.raf.flushAll();
    });

    expect(payload.x.buffer).toBe(origXBuf);
    expect(payload.y.buffer).toBe(origYBuf);
    // Revision bump schedules repaint without re-invoking setData on identical reference
    expect(renderer.setDataCalls.length).toBe(setDataCountBefore);
    expect(renderer.renderCount).toBeGreaterThan(renderCountBefore);

    mounted.unmount();
  });

  it("respects subscribeState: false (0 re-renders even during domain pan/zoom while getSnapshot stays current)", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    let renderCount = 0;
    let engine: ReturnType<typeof useSpectrumEngine> | null = null;

    function UnsubscribedHost() {
      renderCount += 1;
      const ref = useRef<HTMLDivElement | null>(null);
      engine = useSpectrumEngine(ref, {
        data: payload,
        subscribeState: false,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(UnsubscribedHost));
    const countAfterMount = renderCount;
    expect(countAfterMount).toBe(1);

    act(() => {
      engine!.setDomain(15, 75, -60, -5);
      engine!.setDomain(25, 65, -55, -10);
    });

    expect(renderCount).toBe(1);
    expect(engine!.getSnapshot().domain).toEqual({ xMin: 25, xMax: 65, yMin: -55, yMax: -10 });

    mounted.unmount();
  });

  it("keeps TraceSpectrumViewer forwarded callback ref stable across parent re-renders and pan/zoom (zero ref churn)", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    const refCalls: Array<SpectrumEngineHandle | null> = [];
    const refCallback = (h: SpectrumEngineHandle | null): void => {
      refCalls.push(h);
    };

    function Parent(props: { label: string }) {
      return createElement(
        "div",
        { "data-label": props.label },
        createElement(TraceSpectrumViewer, {
          ref: refCallback,
          data: payload,
          platform: harness.platform,
        }),
      );
    }

    const mounted = mountReact(createElement(Parent, { label: "a" }));
    expect(refCalls.length).toBe(1);
    const initialHandle = refCalls[0]!;
    expect(initialHandle).not.toBeNull();

    // Pan/zoom + unrelated parent re-render must NOT re-invoke callback ref
    act(() => {
      initialHandle.setDomain(10, 50, -60, -10);
    });
    mounted.rerender(createElement(Parent, { label: "b" }));
    mounted.rerender(createElement(Parent, { label: "c" }));

    expect(refCalls.length).toBe(1);
    expect(refCalls[0]).toBe(initialHandle);

    mounted.unmount();
    expect(refCalls.length).toBe(2);
    expect(refCalls[1]).toBeNull();
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

    expect(onDomainSpy).toHaveBeenCalledTimes(1);
    expect(renderer.setDomainCalls.length).toBe(setDomainCallsBefore + 1);

    mounted.unmount();
  });

  it("synchronizes two independent TraceSpectrumViewer instances via shared controlled domain without feedback loops", () => {
    const harnessA = createMockPlatform();
    const harnessB = createMockPlatform();
    const payload = createTestPayload(512);
    const refA: { current: SpectrumEngineHandle | null } = { current: null };
    const refB: { current: SpectrumEngineHandle | null } = { current: null };

    function DualSyncedHost() {
      const [domain, setDomain] = useState<ViewportDomain>({
        xMin: 0,
        xMax: 100,
        yMin: -80,
        yMax: 0,
      });
      return createElement(
        "div",
        null,
        createElement(TraceSpectrumViewer, {
          ref: refA,
          data: payload,
          domain,
          onDomainChange: setDomain,
          platform: harnessA.platform,
        }),
        createElement(TraceSpectrumViewer, {
          ref: refB,
          data: payload,
          domain,
          onDomainChange: setDomain,
          platform: harnessB.platform,
        }),
      );
    }

    const mounted = mountReact(createElement(DualSyncedHost));
    act(() => {
      harnessA.raf.flushAll();
      harnessB.raf.flushAll();
    });

    const callsABefore = harnessA.canvas2dRenderers[0]!.setDomainCalls.length;
    const callsBBefore = harnessB.canvas2dRenderers[0]!.setDomainCalls.length;

    act(() => {
      refA.current!.setDomain(25, 75, -60, -10);
    });

    // Pane A invoked setDomain once (echo suppressed), Pane B received synced update once
    expect(harnessA.canvas2dRenderers[0]!.setDomainCalls.length).toBe(callsABefore + 1);
    expect(harnessB.canvas2dRenderers[0]!.setDomainCalls.length).toBe(callsBBefore + 1);
    expect(refB.current!.controller!.domain).toEqual({ xMin: 25, xMax: 75, yMin: -60, yMax: -10 });

    mounted.unmount();
  });
});
