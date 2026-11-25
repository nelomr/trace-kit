import { commitPayloadRevision, type DecimationSelection, type SpectrumDataPayload } from "@trace-kit/core";
import type {
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

    // Flush rAF and verify imperative methods work cleanly
    act(() => {
      harness.raf.flushAll();
    });
    expect(renderer.renderCount).toBeGreaterThanOrEqual(1);

    act(() => {
      handle.resize(640, 320, 2);
      handle.setDomain(20, 80, -60, -10);
      handle.render();
      handle.clear();
      handle.requestRender();
      handle.resetDomain();
      handle.cancelGesture();
    });
    expect(renderer.resizeCalls.some((c) => c.width === 640 && c.height === 320 && c.dpr === 2)).toBe(true);
    expect(renderer.clearCount).toBe(1);
    let zoomResult = false;
    let panResult = false;
    let retryResult = false;
    act(() => {
      zoomResult = handle.zoomByFactor(0.5, 0.5);
      panResult = handle.panByFraction(0.1, 0);
      retryResult = handle.retryWebGL2();
    });
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

    // Controller instance MUST survive inline callback replacement
    expect(latestHandle!.controller).toBe(initialController);
    // Multiple prop changes coalesce to a single rAF schedule
    expect(harness.raf.scheduleCount()).toBe(1);

    // Latest callback closure is invoked (not stale cb1)
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

  it("coordinates interactive, dragMode, homeDomain, revision bumps, and WebGL2 fallback cleanly", () => {
    const harness = createMockPlatform({ webgl2ShouldFail: true });
    const payload = createTestPayload(100_000);
    const onFallback = vi.fn();

    let latestHandle: UseSpectrumEngineReturn | null = null;

    function Host(props: {
      interactive: boolean;
      dragMode: InteractionDragMode;
      homeDomain: ViewportDomain;
      revision: number;
    }) {
      const ref = useRef<HTMLDivElement | null>(null);
      latestHandle = useSpectrumEngine(ref, {
        data: payload,
        mode: "webgl2",
        interactive: props.interactive,
        dragMode: props.dragMode,
        homeDomain: props.homeDomain,
        revision: props.revision,
        platform: harness.platform,
        onWebGL2Fallback: onFallback,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, {
        interactive: false,
        dragMode: "pan",
        homeDomain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 },
        revision: 1,
      }),
    );

    act(() => {
      harness.raf.flushAll();
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(latestHandle!.webgl2Fallback).toBe(true);
    expect(latestHandle!.activeKind).toBe("canvas2d");
    expect(latestHandle!.interaction).toBeNull();

    // Enable interaction and switch dragMode + bump revision
    harness.raf.resetScheduleCount();
    commitPayloadRevision(payload, 100_000);
    mounted.rerender(
      createElement(Host, {
        interactive: true,
        dragMode: "box-zoom",
        homeDomain: { xMin: 5, xMax: 95, yMin: -75, yMax: 0 },
        revision: 2,
      }),
    );

    expect(latestHandle!.interaction).not.toBeNull();
    expect(latestHandle!.interaction!.enabled).toBe(true);
    expect(latestHandle!.interaction!.dragMode).toBe("box-zoom");
    expect(harness.raf.scheduleCount()).toBe(1);

    mounted.unmount();
  });
});
