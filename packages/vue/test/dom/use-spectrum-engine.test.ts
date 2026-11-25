/** @vitest-environment happy-dom */
import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  commitPayloadRevision,
  type DecimationSelection,
  type SpectrumDataPayload,
  type TraceCollection,
  type YAxisRegistration,
} from "@trace-kit/core";
import type {
  BoxSelectEvent,
  EngineChangeEvent,
  EngineSelectionMode,
  GestureStateChangeEvent,
  InteractionDragMode,
  ViewportDomain,
  ViewportInvalidationEvent,
  ViewportMutationReason,
  WebGL2ContextLostEvent,
  WebGL2ContextRestoredEvent,
  WebGL2FallbackEvent,
} from "@trace-kit/renderers/controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, markRaw, nextTick, shallowRef } from "vue";
import type { SpectrumEngineReadyEvent, UseSpectrumEngineReturn } from "../../src/types.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import {
  createMockPlatform,
  createMountedHost,
  createTestPayload,
  createTestTraceCollection,
  createWheelEvent,
  mockElementBoundingRect,
} from "./test-helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useSpectrumEngine composable (happy-dom)", () => {
  it("forwards mount-time options including figureStyle -> style and grouped platform seams", () => {
    const harness = createMockPlatform({ dpr: 2 });
    const mountTarget = createMountedHost();
    const readyEvents: SpectrumEngineReadyEvent[] = [];
    const engineChanges: EngineChangeEvent[] = [];
    const yAxes: readonly YAxisRegistration[] = [
      {
        id: "y0",
        scaleKind: Y_SCALE_KIND_LINEAR,
        side: AXIS_SIDE_LEFT,
        domainMin: -80,
        domainMax: 10,
      },
    ];

    let handleRef: UseSpectrumEngineReturn | null = null;
    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          figureStyle: { backgroundColor: "#121212" },
          axes: { targetTickCount: 8 },
          yAxes,
          hysteresis: { upThreshold: 100_000, downThreshold: 70_000 },
          autoResize: false,
          initialWidth: 640,
          initialHeight: 320,
          initialDpr: 2,
          platform: harness.platform,
          onReady: (ev) => readyEvents.push(ev),
          onEngineChange: (ev) => engineChanges.push(ev),
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    const handle = handleRef!;
    expect(handle.isReady.value).toBe(true);
    expect(handle.activeKind.value).toBe("canvas2d");
    expect(handle.mode.value).toBe("auto");
    expect(harness.resizeObservers.instances.length).toBe(0);
    expect(harness.canvas2dOptions.length).toBe(1);
    expect(harness.canvas2dOptions[0]!.style).toEqual({ backgroundColor: "#121212" });
    expect(harness.canvas2dOptions[0]!.axes).toEqual({ targetTickCount: 8 });
    expect(harness.canvas2dOptions[0]!.yAxes).toBe(yAxes);
    expect(handle.controller.value!.width).toBe(640);
    expect(handle.controller.value!.height).toBe(320);
    expect(handle.controller.value!.dpr).toBe(2);
    expect(handle.controller.value!.hysteresis).toEqual({
      upThreshold: 100_000,
      downThreshold: 70_000,
    });
    expect(readyEvents.length).toBe(1);
    expect(readyEvents[0]!.controller).toBe(handle.controller.value);
    expect(readyEvents[0]!.interaction).toBe(handle.interaction.value);
    // Re-entrant onEngineChange("init") during constructor fired cleanly
    expect(engineChanges.length).toBe(1);
    expect(engineChanges[0]!.reason).toBe("init");
    expect(engineChanges[0]!.activeKind).toBe("canvas2d");

    app.unmount();
  });

  it("throws synchronous TypeError when both data and traces are non-nullish at mount", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const payload = createTestPayload(32);
    const traces = createTestTraceCollection(0, 50, 32);

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        useSpectrumEngine(containerRef, {
          data: payload,
          traces,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    let capturedError: unknown = null;
    app.config.errorHandler = (err) => {
      capturedError = err;
    };
    app.mount(mountTarget);

    expect(capturedError).toBeInstanceOf(TypeError);
    expect((capturedError as Error).message).toMatch(/data.*traces/i);
    // Zero controllers leaked
    expect(harness.canvas2dRenderers.length).toBe(0);
    expect(harness.resizeObservers.activeCount()).toBe(0);

    app.unmount();
  });

  it("throws synchronous TypeError when reactive update makes both data and traces non-nullish without corrupting state", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const dataRef = shallowRef<SpectrumDataPayload | null>(markRaw(createTestPayload(64)));
    const tracesRef = shallowRef<TraceCollection | null>(null);
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          data: dataRef,
          traces: tracesRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    let capturedError: unknown = null;
    app.config.errorHandler = (err) => {
      capturedError = err;
    };
    app.mount(mountTarget);
    harness.raf.flush();

    expect(handleRef!.sampleCount.value).toBe(64);
    const renderer = harness.canvas2dRenderers[0]!;
    const setTracesBefore = renderer.setTracesCalls.length;

    tracesRef.value = markRaw(createTestTraceCollection(0, 50, 32));
    await nextTick();

    expect(capturedError).toBeInstanceOf(TypeError);
    expect(renderer.setTracesCalls.length).toBe(setTracesBefore);
    expect(handleRef!.sampleCount.value).toBe(64);
    expect(handleRef!.isReady.value).toBe(true);

    app.unmount();
  });

  it("invokes controller.clear() and keeps sampleCount at 0 when data/traces transition to nullish", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const dataRef = shallowRef<SpectrumDataPayload | null>(markRaw(createTestPayload(100)));
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          data: dataRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();
    expect(handleRef!.sampleCount.value).toBe(100);

    const renderer = harness.canvas2dRenderers[0]!;
    const clearBefore = renderer.clearCount;

    dataRef.value = null;
    await nextTick();

    expect(renderer.clearCount).toBe(clearBefore + 1);
    expect(handleRef!.sampleCount.value).toBe(0);

    // Even if an imperative render() runs while cleared, sampleCount stays 0 until new data arrives
    handleRef!.render();
    expect(handleRef!.sampleCount.value).toBe(0);

    // Providing new data clears isCleared and restores sampleCount
    dataRef.value = markRaw(createTestPayload(42));
    await nextTick();
    harness.raf.flush();
    expect(handleRef!.sampleCount.value).toBe(42);

    app.unmount();
  });

  it("enforces setTraces-before-setDomain at mount and on combined single-flush updates coalesced to 1 rAF", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const tracesRef = shallowRef<TraceCollection | null>(markRaw(createTestTraceCollection(0, 100, 64)));
    const domainRef = shallowRef<ViewportDomain>({ xMin: 20, xMax: 40, yMin: -60, yMax: 0 });
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          traces: tracesRef,
          domain: domainRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = handleRef!;
    expect(handle.controller.value!.domain).toEqual({ xMin: 20, xMax: 40, yMin: -60, yMax: 0 });
    expect(handle.domain.value).toEqual({ xMin: 20, xMax: 40, yMin: -60, yMax: 0 });

    // Combined same-flush update
    harness.raf.resetScheduleCount();
    const renderer = harness.canvas2dRenderers[0]!;
    const renderCountBefore = renderer.renderCount;

    tracesRef.value = markRaw(createTestTraceCollection(0, 500, 128));
    domainRef.value = { xMin: 100, xMax: 200, yMin: -80, yMax: -10 };
    await nextTick();

    expect(harness.raf.scheduleCount()).toBe(1);
    harness.raf.flush();

    expect(renderer.renderCount).toBe(renderCountBefore + 1);
    expect(handle.controller.value!.domain).toEqual({ xMin: 100, xMax: 200, yMin: -80, yMax: -10 });
    expect(handle.domain.value).toEqual({ xMin: 100, xMax: 200, yMin: -80, yMax: -10 });

    app.unmount();
  });

  it("forwards reactive mode and decimation updates and skips equivalent decimation literals", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const modeRef = shallowRef<EngineSelectionMode>("auto");
    const decimationRef = shallowRef<DecimationSelection | undefined>(undefined);
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          mode: modeRef,
          decimation: decimationRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();
    harness.raf.resetScheduleCount();

    modeRef.value = "canvas2d";
    decimationRef.value = { algorithm: "lttb", threshold: 1024 };
    await nextTick();

    expect(handleRef!.mode.value).toBe("canvas2d");
    expect(handleRef!.controller.value!.mode).toBe("canvas2d");
    expect(handleRef!.controller.value!.decimation).toEqual({ algorithm: "lttb", threshold: 1024 });
    expect(harness.raf.scheduleCount()).toBe(1);
    harness.raf.flush();

    // Structurally equal literal should not trigger redundant setDecimation or requestRender
    const renderer = harness.canvas2dRenderers[0]!;
    const decCallsBefore = renderer.setDecimationCalls.length;
    harness.raf.resetScheduleCount();
    decimationRef.value = { algorithm: "lttb", threshold: 1024 };
    await nextTick();
    expect(renderer.setDecimationCalls.length).toBe(decCallsBefore);
    expect(harness.raf.scheduleCount()).toBe(0);

    app.unmount();
  });

  it("attaches ViewportInteractionController by default and forwards interaction callbacks", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const domainEvents: Array<{ domain: ViewportDomain; reason: ViewportMutationReason }> = [];
    const invalidationEvents: ViewportInvalidationEvent[] = [];
    const boxSelectEvents: BoxSelectEvent[] = [];
    const gestureEvents: GestureStateChangeEvent[] = [];
    let hostEl: HTMLDivElement | null = null;
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          domain: { xMin: 0, xMax: 100, yMin: -50, yMax: 50 },
          platform: harness.platform,
          interactionOptions: {
            requestAnimationFrame: harness.raf.requestAnimationFrame,
            cancelAnimationFrame: harness.raf.cancelAnimationFrame,
          },
          onDomainChange: (d, r) => domainEvents.push({ domain: d, reason: r }),
          onInvalidate: (ev) => invalidationEvents.push(ev),
          onBoxSelect: (ev) => boxSelectEvents.push(ev),
          onGestureStateChange: (ev) => gestureEvents.push(ev),
        });
        return () =>
          h("div", {
            ref: (el) => {
              const div = el instanceof HTMLDivElement ? el : null;
              containerRef.value = div;
              hostEl = div;
            },
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    expect(hostEl).not.toBeNull();
    mockElementBoundingRect(hostEl!, { left: 0, top: 0, width: 800, height: 400 });

    const handle = handleRef!;
    expect(handle.interaction.value).not.toBeNull();
    expect(hostEl!.style.touchAction).toBe("none");

    // Drive wheel zoom
    hostEl!.dispatchEvent(createWheelEvent({ clientX: 400, clientY: 200, deltaY: -120 }));
    harness.raf.flush();

    expect(domainEvents.length).toBeGreaterThanOrEqual(1);
    expect(domainEvents[0]!.reason).toBe("wheel");
    expect(invalidationEvents.length).toBeGreaterThanOrEqual(1);
    expect(gestureEvents.length).toBeGreaterThanOrEqual(1);
    expect(handle.gestureState.value).toBe("wheeling");
    expect(boxSelectEvents.length).toBe(0);

    app.unmount();
  });

  it("skips ViewportInteractionController when interactive=false at mount and preserves touch-action", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const readyEvents: SpectrumEngineReadyEvent[] = [];
    let hostEl: HTMLDivElement | null = null;
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          interactive: false,
          platform: harness.platform,
          onReady: (ev) => readyEvents.push(ev),
        });
        return () =>
          h("div", {
            style: { touchAction: "pan-y" },
            ref: (el) => {
              const div = el instanceof HTMLDivElement ? el : null;
              containerRef.value = div;
              hostEl = div;
            },
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    expect(handleRef!.interaction.value).toBeNull();
    expect(readyEvents.length).toBe(1);
    expect(readyEvents[0]!.interaction).toBeNull();
    expect(hostEl!.querySelector('[data-trace-kit-overlay="box-zoom"]')).toBeNull();
    expect(hostEl!.style.touchAction).toBe("pan-y");

    app.unmount();
  });

  it("lazily attaches one interaction instance on false->true and reuses setEnabled on subsequent toggles", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const interactiveRef = shallowRef(false);
    const dragModeRef = shallowRef<InteractionDragMode>("pan");
    const homeDomainRef = shallowRef<ViewportDomain>({ xMin: 0, xMax: 10, yMin: -1, yMax: 1 });
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          interactive: interactiveRef,
          dragMode: dragModeRef,
          homeDomain: homeDomainRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    expect(handleRef!.interaction.value).toBeNull();

    // Update dragMode & homeDomain before lazy attach
    dragModeRef.value = "box-zoom";
    homeDomainRef.value = { xMin: 5, xMax: 25, yMin: -50, yMax: 0 };
    await nextTick();
    expect(handleRef!.interaction.value).toBeNull();

    // First false -> true creates single instance honoring current dragMode & homeDomain
    interactiveRef.value = true;
    await nextTick();
    const instance1 = handleRef!.interaction.value;
    expect(instance1).not.toBeNull();
    expect(instance1!.enabled).toBe(true);
    expect(instance1!.dragMode).toBe("box-zoom");
    expect(instance1!.homeDomain).toEqual({ xMin: 5, xMax: 25, yMin: -50, yMax: 0 });

    // true -> false reuses same instance
    interactiveRef.value = false;
    await nextTick();
    expect(handleRef!.interaction.value).toBe(instance1);
    expect(instance1!.enabled).toBe(false);

    // false -> true reuses same instance
    interactiveRef.value = true;
    await nextTick();
    expect(handleRef!.interaction.value).toBe(instance1);
    expect(instance1!.enabled).toBe(true);

    // Runtime dragMode / homeDomain updates forward directly
    dragModeRef.value = "pan";
    homeDomainRef.value = { xMin: 1, xMax: 2, yMin: -3, yMax: 4 };
    await nextTick();
    expect(instance1!.dragMode).toBe("pan");
    expect(instance1!.homeDomain).toEqual({ xMin: 1, xMax: 2, yMin: -3, yMax: 4 });

    app.unmount();
  });

  it("synchronizes lifecycle callbacks (WebGL2 fallback, hysteresis switch, contextLost/contextRestored)", async () => {
    const harness = createMockPlatform({ webgl2ShouldFail: true });
    const mountTarget = createMountedHost();
    const engineEvents: EngineChangeEvent[] = [];
    const fallbackEvents: WebGL2FallbackEvent[] = [];
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];
    const modeRef = shallowRef<EngineSelectionMode>("webgl2");
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          mode: modeRef,
          platform: harness.platform,
          onEngineChange: (ev) => engineEvents.push(ev),
          onWebGL2Fallback: (ev) => fallbackEvents.push(ev),
          onContextLost: (ev) => lostEvents.push(ev),
          onContextRestored: (ev) => restoredEvents.push(ev),
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    // Initial WebGL2 attempt failed -> fallback to canvas2d
    const handle = handleRef!;
    expect(handle.activeKind.value).toBe("canvas2d");
    expect(handle.webgl2Fallback.value).toBe(true);
    expect(fallbackEvents.length).toBe(1);
    expect(engineEvents.length).toBeGreaterThanOrEqual(1);

    // Enable WebGL2 and call retryWebGL2()
    harness.setWebGL2ShouldFail(false);
    const recovered = handle.retryWebGL2();
    expect(recovered).toBe(true);
    expect(handle.activeKind.value).toBe("webgl2");
    expect(handle.webgl2Fallback.value).toBe(false);

    // Trigger webglcontextlost and webglcontextrestored on WebGL2 plot canvas (canvases[1])
    const plotCanvas = handle.controller.value!.canvases[1]!;
    expect(plotCanvas).toBeDefined();

    plotCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(handle.contextLost.value).toBe(true);
    expect(lostEvents.length).toBe(1);
    expect(lostEvents[0]!.activeKind).toBe("webgl2");

    plotCanvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(handle.contextLost.value).toBe(false);
    expect(restoredEvents.length).toBe(1);
    expect(restoredEvents[0]!.restoreCount).toBe(1);

    await nextTick();
    app.unmount();
  });

  it("no-ops safely on all 11 imperative methods before mount and after dispose, and delegates when active", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const preMountResults: { retry: boolean; zoom: boolean; pan: boolean } = {
      retry: true,
      zoom: true,
      pan: true,
    };
    const domainEvents: Array<{ domain: ViewportDomain; reason: ViewportMutationReason }> = [];
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        const handle = useSpectrumEngine(containerRef, {
          interactive: true,
          domain: { xMin: 0, xMax: 100, yMin: -10, yMax: 10 },
          platform: harness.platform,
          onDomainChange: (d, r) => domainEvents.push({ domain: d, reason: r }),
        });
        handleRef = handle;

        // Invoke all 11 methods BEFORE mount (containerRef is null)
        expect(() => {
          handle.render();
          handle.requestRender();
          handle.clear();
          handle.setDomain(0, 10, -1, 1);
          handle.resize(500, 300, 2);
          preMountResults.retry = handle.retryWebGL2();
          handle.resetDomain();
          preMountResults.zoom = handle.zoomByFactor(0.5, 1, 0.5, 0.5);
          preMountResults.pan = handle.panByFraction(0.1, 0);
          handle.cancelGesture();
          handle.dispose();
        }).not.toThrow();

        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    expect(preMountResults).toEqual({ retry: false, zoom: false, pan: false });

    // Active delegation
    const handle = handleRef!;
    const rawPayload = createTestPayload(32, { capacity: 64 });
    handle.controller.value!.setData(rawPayload);
    handle.render();
    expect(handle.sampleCount.value).toBe(32);

    handle.resize(900, 450, 2);
    expect(handle.controller.value!.width).toBe(900);
    expect(handle.controller.value!.height).toBe(450);
    expect(handle.controller.value!.dpr).toBe(2);

    expect(handle.zoomByFactor(0.5, 0.5, 0.5, 0.5)).toBe(true);
    expect(handle.domain.value.xMax - handle.domain.value.xMin).toBeCloseTo(50, 5);

    expect(handle.panByFraction(0.1, 0)).toBe(true);
    handle.resetDomain();
    expect(handle.domain.value).toEqual({ xMin: 0, xMax: 100, yMin: -10, yMax: 10 });

    handle.setDomain(10, 20, -5, 5);
    expect(handle.domain.value).toEqual({ xMin: 10, xMax: 20, yMin: -5, yMax: 5 });
    expect(domainEvents.at(-1)?.reason).toBe("programmatic");

    handle.cancelGesture();
    expect(typeof handle.retryWebGL2()).toBe("boolean");

    // In-place mutation + requestRender via wrapped rAF updates sampleCount
    commitPayloadRevision(rawPayload, 48);
    handle.requestRender();
    harness.raf.flush();
    expect(handle.sampleCount.value).toBe(48);

    // Clear via imperative method resets sampleCount
    handle.clear();
    expect(handle.sampleCount.value).toBe(0);

    // Post-dispose no-op safety
    const onDomainBeforeDispose = vi.fn();
    expect(onDomainBeforeDispose).not.toHaveBeenCalled();
    handle.dispose();
    expect(handle.isReady.value).toBe(false);
    expect(handle.controller.value).toBeNull();
    expect(handle.interaction.value).toBeNull();

    expect(() => {
      handle.render();
      handle.requestRender();
      handle.clear();
      handle.setDomain(0, 10, -1, 1);
      handle.resize(500, 300, 2);
      expect(handle.retryWebGL2()).toBe(false);
      handle.resetDomain();
      expect(handle.zoomByFactor(0.5, 1)).toBe(false);
      expect(handle.panByFraction(0.1, 0)).toBe(false);
      handle.cancelGesture();
      handle.dispose();
    }).not.toThrow();

    app.unmount();
  });

  it("syncs contextLost=false and mode before invoking onWebGL2Fallback during a broken context restore", () => {
    const harness = createMockPlatform({ webgl2ShouldFail: false });
    const mountTarget = createMountedHost();
    const observedInFallback: Array<{
      readonly contextLost: boolean;
      readonly mode: EngineSelectionMode;
      readonly activeKind: string;
      readonly webgl2Fallback: boolean;
    }> = [];
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          mode: "webgl2",
          platform: harness.platform,
          onWebGL2Fallback: () => {
            observedInFallback.push({
              contextLost: handleRef!.contextLost.value,
              mode: handleRef!.mode.value,
              activeKind: handleRef!.activeKind.value,
              webgl2Fallback: handleRef!.webgl2Fallback.value,
            });
          },
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    const handle = handleRef!;
    expect(handle.activeKind.value).toBe("webgl2");
    const plotCanvas = handle.controller.value!.canvases[1]!;

    // Lose WebGL2 context, then fail reconstruction on restore -> fallback to Canvas2D
    plotCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(handle.contextLost.value).toBe(true);

    harness.setWebGL2ShouldFail(true, "Restore reconstruction failed");
    plotCanvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(observedInFallback).toEqual([
      {
        contextLost: false,
        mode: "webgl2",
        activeKind: "canvas2d",
        webgl2Fallback: true,
      },
    ]);

    app.unmount();
  });

  it("ignores stale custom-rAF callbacks from a disposed controller after container rebind", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const pendingCallbacks: FrameRequestCallback[] = [];
    const dataRef = shallowRef<SpectrumDataPayload>(markRaw(createTestPayload(32, { capacity: 128 })));
    const containerElRef = shallowRef<HTMLDivElement | null>(null);
    const useSecondHost = shallowRef(false);
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        handleRef = useSpectrumEngine(containerElRef, {
          data: dataRef,
          platform: {
            ...harness.platform,
            // Deliberately ignore cancelAnimationFrame to simulate a stale rAF firing after rebind
            requestAnimationFrame: (cb) => {
              pendingCallbacks.push(cb);
              return pendingCallbacks.length;
            },
            cancelAnimationFrame: () => {},
          },
        });
        return () =>
          useSecondHost.value
            ? h("div", { key: "host-2", ref: containerElRef })
            : h("div", { key: "host-1", ref: containerElRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    const handle = handleRef!;
    const controller1 = handle.controller.value!;
    expect(pendingCallbacks.length).toBeGreaterThanOrEqual(1);
    const staleCbFromController1 = pendingCallbacks[pendingCallbacks.length - 1]!;

    // Rebind container to host-2 -> controller1 disposed, controller2 attached
    useSecondHost.value = true;
    await nextTick();
    const controller2 = handle.controller.value!;
    expect(controller2).not.toBe(controller1);
    expect(controller1.disposed).toBe(true);
    expect(handle.sampleCount.value).toBe(32);

    // Advance controller2's underlying sampleCount without running controller2's own frame yet
    const freshPayload = markRaw(createTestPayload(96));
    controller2.setData(freshPayload);
    expect(controller2.sampleCount).toBe(96);
    expect(handle.sampleCount.value).toBe(32);

    // Stale callback from controller1 fires late -> must NOT sync metadata against controller2
    staleCbFromController1(16);
    expect(handle.sampleCount.value).toBe(32);

    app.unmount();
  });

  it("resets isCleared latch when Path A requestRender() or Path B revision resumes streaming on the same payload after clear()", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const payload = markRaw(createTestPayload(64, { capacity: 256 }));
    const revisionRef = shallowRef(0);
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          data: payload,
          revision: revisionRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = handleRef!;
    expect(handle.sampleCount.value).toBe(64);

    // Path A: clear() then commitPayloadRevision + handle.requestRender()
    handle.clear();
    expect(handle.sampleCount.value).toBe(0);

    commitPayloadRevision(payload, 128);
    handle.requestRender();
    harness.raf.flush();
    expect(handle.sampleCount.value).toBe(128);

    // Path B: clear() then commitPayloadRevision + reactive :revision bump
    handle.clear();
    expect(handle.sampleCount.value).toBe(0);

    commitPayloadRevision(payload, 192);
    revisionRef.value = 1;
    await nextTick();
    harness.raf.flush();
    expect(handle.sampleCount.value).toBe(192);

    app.unmount();
  });
});
