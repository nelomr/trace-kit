import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  commitPayloadRevision,
  createSyncDecimationPort,
  createTraceCollection,
  type DecimationSelection,
  type SettlementSink,
  type SpectrumDataPayload,
  type TraceCollection,
} from "@trace-kit/core";
import type {
  EngineChangeEvent,
  EngineSelectionMode,
  InteractionDragMode,
  ViewportDomain,
  ViewportMutationReason,
} from "@trace-kit/renderers/controller";
import { act, createElement, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import type { UseSpectrumEngineOptions, UseSpectrumEngineReturn } from "../../src/types.js";
import {
  createMockPlatform,
  createTestPayload,
  createTestTraceCollection,
  createWheelEvent,
  mockElementBoundingRect,
  mountReact,
} from "./test-helpers.js";

describe("useSpectrumEngine hook (react-dom)", () => {
  it("attaches controller, syncs data strictly before domain, and exposes all 11 imperative methods", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(1024);
    const domain: ViewportDomain = { xMin: 10, xMax: 90, yMin: -70, yMax: 0 };
    const onReady = vi.fn();

    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { options: UseSpectrumEngineOptions }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, props.options);
      return createElement("div", { ref, style: { width: "800px", height: "400px" } });
    }

    const mounted = mountReact(
      createElement(Host, {
        options: {
          data: payload,
          domain,
          platform: harness.platform,
          onReady,
        },
      }),
    );

    expect(latestHandle).not.toBeNull();
    const handle = latestHandle!;
    expect(handle.isReady).toBe(true);
    expect(handle.controller).not.toBeNull();
    expect(handle.interaction).not.toBeNull();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(handle.sampleCount).toBe(1024);
    expect(handle.domain).toEqual(domain);

    const renderer = harness.canvas2dRenderers[0]!;
    const setDataIdx = renderer.callLog.indexOf("setData");
    const userSetDomainIdx = renderer.callLog.lastIndexOf("setDomain");
    expect(setDataIdx).toBeGreaterThanOrEqual(0);
    expect(userSetDomainIdx).toBeGreaterThan(setDataIdx);

    act(() => {
      harness.raf.flushAll();
    });
    expect(renderer.renderCount).toBeGreaterThanOrEqual(1);

    let zoomResult = false;
    let panResult = false;
    let retryResult = false;
    act(() => {
      handle.resize(640, 320, 2);
      handle.setDomain(20, 80, -60, -10);
      handle.render();
      handle.clear();
      handle.requestRender();
      handle.resetDomain();
      handle.cancelGesture();
      zoomResult = handle.zoomByFactor(0.5, 0.5);
      panResult = handle.panByFraction(0.1, 0);
      retryResult = handle.retryWebGL2();
    });
    expect(renderer.resizeCalls.some((c) => c.width === 640 && c.height === 320 && c.dpr === 2)).toBe(true);
    expect(renderer.clearCount).toBe(1);
    expect(typeof zoomResult).toBe("boolean");
    expect(typeof panResult).toBe("boolean");
    expect(typeof retryResult).toBe("boolean");

    // Post-dispose imperative calls are safe no-ops
    act(() => {
      handle.dispose();
    });
    expect(handle.controller).toBeNull();
    expect(handle.interaction).toBeNull();
    expect(() => {
      handle.render();
      handle.requestRender();
      handle.clear();
      handle.setDomain(0, 1, 0, 1);
      handle.resize(100, 100);
      handle.resetDomain();
      handle.cancelGesture();
      handle.dispose();
    }).not.toThrow();
    expect(handle.retryWebGL2()).toBe(false);
    expect(handle.zoomByFactor(0.5, 0.5)).toBe(false);
    expect(handle.panByFraction(0.1, 0.1)).toBe(false);

    mounted.unmount();
  });

  it("coalesces simultaneous prop updates into one requestRender and preserves controller across inline callback churn", () => {
    const harness = createMockPlatform();
    const payloadA = createTestPayload(512);
    const payloadB = createTestPayload(1024);

    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: {
      data: SpectrumDataPayload;
      domain: ViewportDomain;
      mode: EngineSelectionMode;
      decimation: DecimationSelection | undefined;
      onDomainChange: (d: ViewportDomain, r: ViewportMutationReason) => void;
    }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: props.data,
        domain: props.domain,
        mode: props.mode,
        decimation: props.decimation,
        platform: harness.platform,
        onDomainChange: props.onDomainChange,
      });
      return createElement("div", { ref });
    }

    const cb1 = vi.fn();
    const mounted = mountReact(
      createElement(Host, {
        data: payloadA,
        domain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 },
        mode: "auto",
        decimation: undefined,
        onDomainChange: cb1,
      }),
    );

    act(() => {
      harness.raf.flushAll();
    });

    const initialController = latestHandle!.controller;
    harness.raf.resetScheduleCount();

    const cb2 = vi.fn();
    mounted.rerender(
      createElement(Host, {
        data: payloadB,
        domain: { xMin: 15, xMax: 85, yMin: -70, yMax: -5 },
        mode: "canvas2d",
        decimation: { algorithm: "lttb", threshold: 256 },
        onDomainChange: cb2,
      }),
    );

    expect(latestHandle!.controller).toBe(initialController);
    expect(harness.raf.scheduleCount()).toBe(1);

    act(() => {
      latestHandle!.setDomain(25, 75, -60, -10);
    });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);

    mounted.unmount();
  });

  it("throws synchronous TypeError when both data and traces are supplied simultaneously", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(64);
    const traces = createTestTraceCollection();

    function BadHost() {
      const ref = useRef<HTMLDivElement | null>(null);
      useSpectrumEngine(ref, {
        data: payload,
        traces,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => mountReact(createElement(BadHost))).toThrow(TypeError);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("calls controller.clear() and sets sampleCount to 0 when data/traces transition to nullish", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { data: SpectrumDataPayload | null }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: props.data,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host, { data: payload }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(512);

    mounted.rerender(createElement(Host, { data: null }));
    expect(harness.canvas2dRenderers[0]!.clearCount).toBe(1);
    expect(latestHandle!.sampleCount).toBe(0);

    mounted.unmount();
  });

  it("enforces setTraces-before-setDomain at mount and on combined updates coalesced to 1 rAF", () => {
    const harness = createMockPlatform();
    const tracesA = createTestTraceCollection(1520, 1560, 128);
    const tracesB = createTestTraceCollection(1530, 1570, 256);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { traces: TraceCollection; domain: ViewportDomain }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        traces: props.traces,
        domain: props.domain,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, {
        traces: tracesA,
        domain: { xMin: 1525, xMax: 1555, yMin: -90, yMax: 10 },
      }),
    );

    const renderer = harness.canvas2dRenderers[0]!;
    const setTracesIdx = renderer.callLog.indexOf("setTraces");
    const lastSetDomainIdx = renderer.callLog.lastIndexOf("setDomain");
    expect(setTracesIdx).toBeGreaterThanOrEqual(0);
    expect(lastSetDomainIdx).toBeGreaterThan(setTracesIdx);

    act(() => {
      harness.raf.flushAll();
    });

    harness.raf.resetScheduleCount();
    mounted.rerender(
      createElement(Host, {
        traces: tracesB,
        domain: { xMin: 1535, xMax: 1565, yMin: -80, yMax: 5 },
      }),
    );
    expect(harness.raf.scheduleCount()).toBe(1);
    expect(latestHandle!.domain).toEqual({ xMin: 1535, xMax: 1565, yMin: -80, yMax: 5 });

    mounted.unmount();
  });

  it("skips redundant setDecimation for structurally equivalent literals", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);

    function Host(props: { decimation: DecimationSelection }) {
      const ref = useRef<HTMLDivElement | null>(null);
      useSpectrumEngine(ref, {
        data: payload,
        decimation: props.decimation,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, { decimation: { algorithm: "lttb", threshold: 256 } }),
    );
    act(() => {
      harness.raf.flushAll();
    });

    const renderer = harness.canvas2dRenderers[0]!;
    const decimationCallsBefore = renderer.setDecimationCalls.length;
    harness.raf.resetScheduleCount();

    // Fresh object literal with identical fields -> MUST skip setDecimation & requestRender
    mounted.rerender(createElement(Host, { decimation: { algorithm: "lttb", threshold: 256 } }));
    expect(renderer.setDecimationCalls.length).toBe(decimationCallsBefore);
    expect(harness.raf.scheduleCount()).toBe(0);

    // Distinct algorithm -> applies cleanly
    mounted.rerender(createElement(Host, { decimation: { algorithm: "min-max", bucketCount: 128 } }));
    expect(renderer.setDecimationCalls.length).toBe(decimationCallsBefore + 1);
    expect(harness.raf.scheduleCount()).toBe(1);

    mounted.unmount();
  });

  it("skips ViewportInteractionController when interactive=false at mount and preserves touchAction", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        interactive: false,
        platform: harness.platform,
      });
      return createElement("div", { ref, style: { touchAction: "pan-y" } });
    }

    const mounted = mountReact(createElement(Host));
    const el = mounted.host.firstElementChild as HTMLDivElement;
    expect(latestHandle!.interaction).toBeNull();
    expect(el.style.touchAction).toBe("pan-y");

    mounted.unmount();
  });

  it("lazily attaches one interaction instance on false->true and reuses setEnabled on subsequent toggles", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { interactive: boolean; dragMode: InteractionDragMode }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        interactive: props.interactive,
        dragMode: props.dragMode,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host, { interactive: false, dragMode: "pan" }));
    expect(latestHandle!.interaction).toBeNull();

    mounted.rerender(createElement(Host, { interactive: true, dragMode: "pan" }));
    const firstInteraction = latestHandle!.interaction;
    expect(firstInteraction).not.toBeNull();
    expect(firstInteraction!.enabled).toBe(true);

    mounted.rerender(createElement(Host, { interactive: false, dragMode: "box-zoom" }));
    expect(latestHandle!.interaction).toBe(firstInteraction);
    expect(firstInteraction!.enabled).toBe(false);
    expect(firstInteraction!.dragMode).toBe("box-zoom");

    mounted.rerender(createElement(Host, { interactive: true, dragMode: "box-zoom" }));
    expect(latestHandle!.interaction).toBe(firstInteraction);
    expect(firstInteraction!.enabled).toBe(true);

    mounted.unmount();
  });

  it("synchronizes hysteresis switch (canvas2d -> webgl2), WebGL2 fallback, and interaction callbacks", () => {
    const harness = createMockPlatform();
    const smallPayload = createTestPayload(1024);
    const largePayload = createTestPayload(100_000);
    const engineEvents: EngineChangeEvent[] = [];
    const onInvalidate = vi.fn();

    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { data: SpectrumDataPayload }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: props.data,
        mode: "auto",
        interactive: true,
        platform: harness.platform,
        interactionOptions: {
          requestAnimationFrame: harness.raf.requestAnimationFrame,
          cancelAnimationFrame: harness.raf.cancelAnimationFrame,
        },
        onEngineChange: (ev) => {
          engineEvents.push(ev);
        },
        onInvalidate,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host, { data: smallPayload }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.activeKind).toBe("canvas2d");

    // Cross 80k hysteresis threshold -> switches to webgl2
    mounted.rerender(createElement(Host, { data: largePayload }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.activeKind).toBe("webgl2");
    expect(engineEvents.some((e) => e.activeKind === "webgl2")).toBe(true);

    // Wheel interaction triggers onInvalidate
    const hostEl = mounted.host.firstElementChild as HTMLDivElement;
    mockElementBoundingRect(hostEl, { left: 0, top: 0, width: 800, height: 400 });
    act(() => {
      hostEl.dispatchEvent(createWheelEvent({ clientX: 400, clientY: 200, deltaY: -120 }));
      harness.raf.flushAll();
    });
    expect(onInvalidate).toHaveBeenCalled();

    mounted.unmount();
  });

  it("resets isCleared latch when Path A requestRender() or Path B revision resumes after clear()", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { revision: number }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        revision: props.revision,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host, { revision: 1 }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(512);

    // Clear resets sampleCount to 0
    act(() => {
      latestHandle!.clear();
    });
    expect(latestHandle!.sampleCount).toBe(0);

    // Path A resume restores sampleCount on rAF flush
    act(() => {
      latestHandle!.requestRender();
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(512);

    // Clear again, then resume via Path B revision bump
    act(() => {
      latestHandle!.clear();
    });
    expect(latestHandle!.sampleCount).toBe(0);

    commitPayloadRevision(payload, 512);
    mounted.rerender(createElement(Host, { revision: 2 }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(512);

    mounted.unmount();
  });

  it("transitions cleanly between data -> traces -> data without throwing", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const traces = createTestTraceCollection(0, 50, 128);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { data?: SpectrumDataPayload; traces?: TraceCollection }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: props.data,
        traces: props.traces,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host, { data: payload }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(256);

    mounted.rerender(createElement(Host, { traces }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(128);

    mounted.rerender(createElement(Host, { data: payload }));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(256);

    mounted.unmount();
  });

  it("forwards decimationPort and settlementSink cleanly and polls on render", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const decimationPort = createSyncDecimationPort({
      poolPairs: 2,
      transitCapacitySamples: 512,
    });
    const pollSpy = vi.spyOn(decimationPort, "poll");
    const settlementSink: SettlementSink = {
      onSettled(lease): void {
        decimationPort.release(lease);
      },
    };

    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      useSpectrumEngine(ref, {
        data: payload,
        decimationPort,
        settlementSink,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host));
    act(() => {
      harness.raf.flushAll();
    });
    expect(pollSpy).toHaveBeenCalled();

    mounted.unmount();
    decimationPort.dispose();
  });

  it("handles WebGL2 fallback and records fallback state cleanly", () => {
    const harness = createMockPlatform({ webgl2ShouldFail: true });
    const payload = createTestPayload(100_000);
    const onFallback = vi.fn();
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        mode: "webgl2",
        platform: harness.platform,
        onWebGL2Fallback: onFallback,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host));
    act(() => {
      harness.raf.flushAll();
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(latestHandle!.webgl2Fallback).toBe(true);
    expect(latestHandle!.activeKind).toBe("canvas2d");

    mounted.unmount();
  });

  it("ignores stale rAF callbacks from a disposed controller after unmount", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);

    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      useSpectrumEngine(ref, {
        data: payload,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host));
    // Unmount BEFORE flushing scheduled mount rAF
    mounted.unmount();

    expect(() => {
      harness.raf.flushAll();
    }).not.toThrow();
  });

  it("resets isCleared latch on synchronous render() after clear()", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(512);
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host));
    act(() => {
      harness.raf.flushAll();
    });
    expect(latestHandle!.sampleCount).toBe(512);

    act(() => {
      latestHandle!.clear();
    });
    expect(latestHandle!.sampleCount).toBe(0);

    act(() => {
      latestHandle!.render();
    });
    expect(latestHandle!.sampleCount).toBe(512);

    mounted.unmount();
  });

  it("forwards dynamic homeDomain updates, onGestureStateChange, and WebGL2 contextLost/contextRestored events", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(100_000);
    const onGestureStateChange = vi.fn();
    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { homeDomain: ViewportDomain }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        mode: "webgl2",
        interactive: true,
        homeDomain: props.homeDomain,
        platform: harness.platform,
        interactionOptions: {
          requestAnimationFrame: harness.raf.requestAnimationFrame,
          cancelAnimationFrame: harness.raf.cancelAnimationFrame,
        },
        onGestureStateChange,
        onContextLost,
        onContextRestored,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, { homeDomain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 } }),
    );
    act(() => {
      harness.raf.flushAll();
    });

    // Dynamic homeDomain update propagates to interaction controller
    const nextHome: ViewportDomain = { xMin: 10, xMax: 90, yMin: -70, yMax: -10 };
    mounted.rerender(createElement(Host, { homeDomain: nextHome }));
    expect(latestHandle!.interaction!.homeDomain).toEqual(nextHome);

    // Wheel interaction triggers onGestureStateChange
    const hostEl = mounted.host.firstElementChild as HTMLDivElement;
    mockElementBoundingRect(hostEl, { left: 0, top: 0, width: 800, height: 400 });
    act(() => {
      hostEl.dispatchEvent(createWheelEvent({ clientX: 400, clientY: 200, deltaY: -120 }));
      harness.raf.flushAll();
    });
    expect(onGestureStateChange).toHaveBeenCalled();

    // Context lost & restored events update snapshot and invoke callbacks
    const webglCanvas = hostEl.querySelectorAll("canvas")[1] ?? hostEl.querySelector("canvas")!;
    act(() => {
      webglCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(latestHandle!.contextLost).toBe(true);

    act(() => {
      webglCanvas.dispatchEvent(new Event("webglcontextrestored"));
    });
    expect(onContextRestored).toHaveBeenCalledTimes(1);
    expect(latestHandle!.contextLost).toBe(false);

    mounted.unmount();
  });

  it("batches simultaneous traces + domain + mode updates into a single store notification and preserves constant controlled domain", () => {
    const harness = createMockPlatform();
    const p1 = createTestPayload(256);
    const p2 = createTestPayload(512);
    const tracesA = createTraceCollection(
      [{ id: "a", payload: p1, yAxisId: "y0", style: { color: "#38bdf8", lineWidthCss: 1.5 } }],
      [{ id: "y0", scaleKind: Y_SCALE_KIND_LINEAR, side: AXIS_SIDE_LEFT, domainMin: -90, domainMax: 10 }],
      0,
      256,
    );
    const tracesB = createTraceCollection(
      [{ id: "b", payload: p2, yAxisId: "y0", style: { color: "#f97316", lineWidthCss: 1.5 } }],
      [{ id: "y0", scaleKind: Y_SCALE_KIND_LINEAR, side: AXIS_SIDE_LEFT, domainMin: -100, domainMax: 20 }],
      0,
      512,
    );
    const fixedControlledDomain: ViewportDomain = { xMin: 20, xMax: 80, yMin: -60, yMax: -10 };
    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: { traces: TraceCollection; mode: EngineSelectionMode }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        traces: props.traces,
        domain: fixedControlledDomain,
        mode: props.mode,
        platform: harness.platform,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host, { traces: tracesA, mode: "auto" }));
    act(() => {
      harness.raf.flushAll();
    });

    const storeListener = vi.fn();
    const unsub = latestHandle!.subscribe(storeListener);

    // Change traces + mode while keeping exact same fixedControlledDomain reference
    mounted.rerender(createElement(Host, { traces: tracesB, mode: "canvas2d" }));

    // Single batched store notification (no intermediate transient snapshot)
    expect(storeListener).toHaveBeenCalledTimes(1);
    // Controlled domain was NOT clobbered by tracesB's natural extent
    expect(latestHandle!.controller!.domain).toEqual(fixedControlledDomain);
    expect(latestHandle!.domain).toEqual(fixedControlledDomain);
    expect(latestHandle!.mode).toBe("canvas2d");

    unsub();
    mounted.unmount();
  });
});
