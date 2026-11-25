/** @vitest-environment happy-dom */
import { commitPayloadRevision } from "@trace-kit/core";
import type {
  BoxSelectEvent,
  EngineChangeEvent,
  GestureStateChangeEvent,
  ViewportDomain,
  ViewportInvalidationEvent,
  ViewportMutationReason,
  WebGL2ContextLostEvent,
  WebGL2ContextRestoredEvent,
  WebGL2FallbackEvent,
} from "@trace-kit/renderers/controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  isProxy,
  isReactive,
  markRaw,
  nextTick,
  ref,
  shallowRef,
  type ShallowUnwrapRef,
} from "vue";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import type {
  SpectrumEngineHandle,
  SpectrumEngineReadyEvent,
  TraceSpectrumViewerSlotProps,
} from "../../src/types.js";
import {
  createMockPlatform,
  createMountedHost,
  createTestPayload,
  createWheelEvent,
  mockElementBoundingRect,
} from "./test-helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<TraceSpectrumViewer> component (happy-dom)", () => {
  it("mounts cleanly with createApp + h(), renders two-layer DOM without slot-overlay, and defaults interactive & autoResize to true", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const payload = markRaw(createTestPayload(128));
    const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            ref: viewerRef,
            data: payload,
            mode: "canvas2d",
            platform: harness.platform,
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const viewer = mountTarget.querySelector<HTMLElement>("[data-trace-kit-viewer]");
    expect(viewer).not.toBeNull();
    expect(viewer!.style.position).toBe("relative");

    const surface = viewer!.querySelector<HTMLElement>("[data-trace-kit-surface]");
    expect(surface).not.toBeNull();
    expect(viewer!.children.length).toBe(1);
    expect(viewer!.children[0]).toBe(surface);
    expect(surface!.style.position).toBe("absolute");
    expect(surface!.style.width).toBe("100%");
    expect(surface!.style.height).toBe("100%");

    // Slot overlay wrapper omitted when #overlay slot is absent
    expect(viewer!.querySelector("[data-trace-kit-slot-overlay]")).toBeNull();

    // Imperative canvas mounted inside data-trace-kit-surface
    const canvases = surface!.querySelectorAll("canvas");
    expect(canvases.length).toBe(1);
    expect(harness.canvas2dRenderers[0]!.renderCount).toBeGreaterThanOrEqual(1);

    // Explicit boolean defaults: both interactive and autoResize default to true (not Vue false!)
    expect(viewerRef.value).not.toBeNull();
    expect(viewerRef.value!.isReady).toBe(true);
    expect(viewerRef.value!.interaction).not.toBeNull();
    expect(harness.resizeObservers.activeCount()).toBe(1);

    app.unmount();
  });

  it("renders #overlay as a pointer-events:none sibling after surface and preserves exact <canvas> references across re-renders", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const hudCount = ref(0);

    const Host = defineComponent({
      setup() {
        return () =>
          h(
            TraceSpectrumViewer,
            {
              data: markRaw(createTestPayload(64)),
              platform: harness.platform,
            },
            {
              overlay: (slotProps: TraceSpectrumViewerSlotProps) => [
                h("span", { "data-testid": "hud-count" }, `count:${hudCount.value}:ready:${String(slotProps.isReady)}`),
                h(
                  "button",
                  {
                    "data-testid": "hud-btn",
                    style: { pointerEvents: "auto" },
                  },
                  "Reset",
                ),
              ],
            },
          );
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    await nextTick();

    const viewer = mountTarget.querySelector("[data-trace-kit-viewer]") as HTMLElement;
    const surface = viewer.querySelector("[data-trace-kit-surface]") as HTMLElement;
    const overlay = viewer.querySelector<HTMLElement>("[data-trace-kit-slot-overlay]");

    expect(overlay).not.toBeNull();
    expect(viewer.children[0]).toBe(surface);
    expect(viewer.children[1]).toBe(overlay);
    expect(overlay!.style.position).toBe("absolute");
    expect(overlay!.style.pointerEvents).toBe("none");

    const canvasBefore = surface.querySelector("canvas");
    expect(canvasBefore).not.toBeNull();
    expect(overlay!.querySelector('[data-testid="hud-count"]')?.textContent).toBe(
      "count:0:ready:true",
    );

    // Trigger reactive HUD updates multiple times
    hudCount.value = 1;
    await nextTick();
    hudCount.value = 2;
    await nextTick();
    hudCount.value = 3;
    await nextTick();

    expect(overlay!.querySelector('[data-testid="hud-count"]')?.textContent).toBe(
      "count:3:ready:true",
    );
    // Exact same <canvas> DOM node instance preserved inside data-trace-kit-surface
    expect(surface.querySelector("canvas")).toBe(canvasBefore);

    app.unmount();
  });

  it("renders #default scoped slot as trailing sibling after surface and slot-overlay with typed slot props", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    let capturedSlotProps: Record<string, unknown> | null = null;

    const Host = defineComponent({
      setup() {
        return () =>
          h(
            TraceSpectrumViewer,
            {
              data: markRaw(createTestPayload(50)),
              mode: "canvas2d",
              platform: harness.platform,
            },
            {
              overlay: () => h("span", { "data-testid": "ov" }, "Overlay"),
              default: (props: TraceSpectrumViewerSlotProps) => {
                capturedSlotProps = {
                  isReady: props.isReady,
                  activeKind: props.activeKind,
                  mode: props.mode,
                  domain: props.domain,
                  sampleCount: props.sampleCount,
                  contextLost: props.contextLost,
                  webgl2Fallback: props.webgl2Fallback,
                  gestureState: props.gestureState,
                };
                return h("div", { "data-testid": "a11y-slot" }, `samples:${props.sampleCount}`);
              },
            },
          );
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();
    await nextTick();

    const viewer = mountTarget.querySelector("[data-trace-kit-viewer]") as HTMLElement;
    const surface = viewer.querySelector("[data-trace-kit-surface]") as HTMLElement;
    const overlay = viewer.querySelector("[data-trace-kit-slot-overlay]") as HTMLElement;
    const defaultNode = viewer.querySelector('[data-testid="a11y-slot"]') as HTMLElement;

    expect(viewer.children[0]).toBe(surface);
    expect(viewer.children[1]).toBe(overlay);
    expect(viewer.children[2]).toBe(defaultNode);
    expect(capturedSlotProps).toEqual({
      isReady: true,
      activeKind: "canvas2d",
      mode: "canvas2d",
      domain: { xMin: 0, xMax: 1, yMin: -1, yMax: 1 },
      sampleCount: 50,
      contextLost: false,
      webgl2Fallback: false,
      gestureState: "idle",
    });

    app.unmount();
  });

  it("forwards HTML style, class, and ARIA attributes to outer viewer while figureStyle configures the renderer without leaking DOM attributes", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            class: "my-viewer",
            style: "height: 320px; width: 640px",
            role: "region",
            "aria-label": "Optical Spectrum",
            figureStyle: { backgroundColor: "#111111" },
            platform: harness.platform,
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    const viewer = mountTarget.querySelector("[data-trace-kit-viewer]") as HTMLElement;
    expect(viewer.classList.contains("my-viewer")).toBe(true);
    expect(viewer.style.position).toBe("relative");
    expect(viewer.style.height).toBe("320px");
    expect(viewer.style.width).toBe("640px");
    expect(viewer.getAttribute("role")).toBe("region");
    expect(viewer.getAttribute("aria-label")).toBe("Optical Spectrum");
    expect(viewer.hasAttribute("figureStyle")).toBe(false);
    expect(viewer.hasAttribute("figure-style")).toBe(false);

    expect(harness.canvas2dOptions[0]!.style).toEqual({ backgroundColor: "#111111" });

    app.unmount();
  });

  it("supports bidirectional v-model:domain without echo loops and applies external parent mutations", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const parentDomain = shallowRef<ViewportDomain>({ xMin: 0, xMax: 100, yMin: -50, yMax: 50 });
    const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);
    const updateDomainEvents: ViewportDomain[] = [];

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            ref: viewerRef,
            domain: parentDomain.value,
            "onUpdate:domain": (next: ViewportDomain) => {
              updateDomainEvents.push(next);
              parentDomain.value = next;
            },
            platform: harness.platform,
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = viewerRef.value!;
    const setDomainSpy = vi.spyOn(handle.controller!, "setDomain");
    const requestRenderSpy = vi.spyOn(handle.controller!, "requestRender");

    // 1. Interactive pan updates v-model:domain with plain non-proxied snapshot and zero echo loop
    handle.panByFraction(0.1, 0);
    const setDomainAfterPan = setDomainSpy.mock.calls.length;
    const reqRenderAfterPan = requestRenderSpy.mock.calls.length;
    await nextTick();

    expect(updateDomainEvents.length).toBe(1);
    expect(isProxy(updateDomainEvents[0])).toBe(false);
    expect(Object.isFrozen(updateDomainEvents[0])).toBe(true);
    expect(parentDomain.value).toBe(updateDomainEvents[0]);
    expect(setDomainSpy.mock.calls.length).toBe(setDomainAfterPan);
    expect(requestRenderSpy.mock.calls.length).toBe(reqRenderAfterPan);

    // 2. External parent update applies controller.setDomain and schedules requestRender
    setDomainSpy.mockClear();
    requestRenderSpy.mockClear();
    parentDomain.value = { xMin: 15, xMax: 35, yMin: -40, yMax: 10 };
    await nextTick();

    expect(setDomainSpy).toHaveBeenCalledTimes(1);
    expect(setDomainSpy).toHaveBeenCalledWith(15, 35, -40, 10);
    expect(requestRenderSpy).toHaveBeenCalledTimes(1);
    expect(handle.domain).toEqual({ xMin: 15, xMax: 35, yMin: -40, yMax: 10 });

    app.unmount();
  });

  it("emits all 10 typed events with raw non-proxied controllers on ready", async () => {
    const harness = createMockPlatform({ webgl2ShouldFail: true });
    const mountTarget = createMountedHost();
    const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);

    const readyEvents: SpectrumEngineReadyEvent[] = [];
    const updateDomainEvents: ViewportDomain[] = [];
    const domainChangeEvents: Array<{ d: ViewportDomain; r: ViewportMutationReason }> = [];
    const invalidateEvents: ViewportInvalidationEvent[] = [];
    const boxSelectEvents: BoxSelectEvent[] = [];
    const gestureEvents: GestureStateChangeEvent[] = [];
    const engineEvents: EngineChangeEvent[] = [];
    const fallbackEvents: WebGL2FallbackEvent[] = [];
    const lostEvents: WebGL2ContextLostEvent[] = [];
    const restoredEvents: WebGL2ContextRestoredEvent[] = [];

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            ref: viewerRef,
            mode: "webgl2",
            dragMode: "box-zoom",
            domain: { xMin: 0, xMax: 100, yMin: -50, yMax: 50 },
            platform: harness.platform,
            interactionOptions: {
              requestAnimationFrame: harness.raf.requestAnimationFrame,
              cancelAnimationFrame: harness.raf.cancelAnimationFrame,
            },
            onReady: (e: SpectrumEngineReadyEvent) => readyEvents.push(e),
            "onUpdate:domain": (d: ViewportDomain) => updateDomainEvents.push(d),
            onDomainChange: (d: ViewportDomain, r: ViewportMutationReason) =>
              domainChangeEvents.push({ d, r }),
            onInvalidate: (e: ViewportInvalidationEvent) => invalidateEvents.push(e),
            onBoxSelect: (e: BoxSelectEvent) => boxSelectEvents.push(e),
            onGestureStateChange: (e: GestureStateChangeEvent) => gestureEvents.push(e),
            onEngineChange: (e: EngineChangeEvent) => engineEvents.push(e),
            onWebgl2Fallback: (e: WebGL2FallbackEvent) => fallbackEvents.push(e),
            onContextLost: (e: WebGL2ContextLostEvent) => lostEvents.push(e),
            onContextRestored: (e: WebGL2ContextRestoredEvent) => restoredEvents.push(e),
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    // 1. ready, engineChange, webgl2Fallback
    expect(readyEvents.length).toBe(1);
    expect(isProxy(readyEvents[0]!.controller)).toBe(false);
    expect(isReactive(readyEvents[0]!.controller)).toBe(false);
    expect(readyEvents[0]!.interaction).not.toBeNull();
    expect(isProxy(readyEvents[0]!.interaction)).toBe(false);
    expect(isReactive(readyEvents[0]!.interaction)).toBe(false);
    expect(engineEvents.length).toBeGreaterThanOrEqual(1);
    expect(fallbackEvents.length).toBe(1);

    // 2. wheel -> update:domain, domainChange, invalidate, gestureStateChange
    const surface = mountTarget.querySelector("[data-trace-kit-surface]") as HTMLElement;
    mockElementBoundingRect(surface, { left: 0, top: 0, width: 800, height: 400 });
    surface.dispatchEvent(createWheelEvent({ clientX: 400, clientY: 200, deltaY: -120 }));
    harness.raf.flush();
    expect(updateDomainEvents.length).toBeGreaterThanOrEqual(1);
    expect(domainChangeEvents.length).toBeGreaterThanOrEqual(1);
    expect(invalidateEvents.length).toBeGreaterThanOrEqual(1);
    expect(gestureEvents.length).toBeGreaterThanOrEqual(1);

    // 3. box-zoom drag -> boxSelect
    surface.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: 200,
        clientY: 100,
        bubbles: true,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: 400,
        clientY: 220,
        bubbles: true,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        button: 0,
        buttons: 0,
        clientX: 400,
        clientY: 220,
        bubbles: true,
      }),
    );
    expect(boxSelectEvents.length).toBe(1);

    // 4. WebGL2 retry + contextLost + contextRestored
    harness.setWebGL2ShouldFail(false);
    expect(viewerRef.value!.retryWebGL2()).toBe(true);
    const plotCanvas = viewerRef.value!.controller!.canvases[1]!;
    plotCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    plotCanvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(lostEvents.length).toBe(1);
    expect(restoredEvents.length).toBe(1);

    await nextTick();
    app.unmount();
  });

  it("exposes full SpectrumEngineHandle via expose() and repaints Path A requestRender() with zero Vue re-renders", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const payload = markRaw(createTestPayload(64, { capacity: 256 }));
    const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);
    let viewerParentRenders = 0;

    const Host = defineComponent({
      setup() {
        return () => {
          viewerParentRenders += 1;
          return h(TraceSpectrumViewer, {
            ref: viewerRef,
            data: payload,
            platform: harness.platform,
          });
        };
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = viewerRef.value!;
    expect(handle.controller).not.toBeNull();
    expect(isProxy(handle.controller)).toBe(false);
    expect(isReactive(handle.controller)).toBe(false);
    expect(handle.interaction).not.toBeNull();
    expect(isProxy(handle.interaction)).toBe(false);
    expect(handle.isReady).toBe(true);
    expect(handle.activeKind).toBe("canvas2d");
    expect(handle.mode).toBe("auto");
    expect(isProxy(handle.domain)).toBe(false);
    expect(handle.sampleCount).toBe(64);
    expect(handle.contextLost).toBe(false);
    expect(handle.webgl2Fallback).toBe(false);
    expect(handle.gestureState).toBe("idle");
    expect(typeof handle.render).toBe("function");
    expect(typeof handle.requestRender).toBe("function");
    expect(typeof handle.clear).toBe("function");
    expect(typeof handle.setDomain).toBe("function");
    expect(typeof handle.resize).toBe("function");
    expect(typeof handle.retryWebGL2).toBe("function");
    expect(typeof handle.resetDomain).toBe("function");
    expect(typeof handle.zoomByFactor).toBe("function");
    expect(typeof handle.panByFraction).toBe("function");
    expect(typeof handle.cancelGesture).toBe("function");
    expect(typeof handle.dispose).toBe("function");

    const rendersBeforeStream = viewerParentRenders;
    const renderer = harness.canvas2dRenderers[0]!;
    const drawBefore = renderer.renderCount;

    commitPayloadRevision(payload, 200);
    handle.requestRender();
    harness.raf.flush();
    await nextTick();

    expect(renderer.renderCount).toBe(drawBefore + 1);
    expect(handle.sampleCount).toBe(200);
    expect(viewerParentRenders).toBe(rendersBeforeStream);

    app.unmount();
  });

  it("infers SpectrumEngineHandle members directly on InstanceType<typeof TraceSpectrumViewer> without manual cast", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const payload = markRaw(createTestPayload(40, { capacity: 128 }));
    const viewerRef = shallowRef<InstanceType<typeof TraceSpectrumViewer> | null>(null);

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            ref: viewerRef,
            data: payload,
            platform: harness.platform,
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const instance = viewerRef.value!;
    expect(instance.isReady).toBe(true);
    expect(instance.controller).not.toBeNull();
    expect(instance.interaction).not.toBeNull();
    expect(instance.activeKind).toBe("canvas2d");
    expect(instance.mode).toBe("auto");
    expect(instance.sampleCount).toBe(40);
    expect(instance.contextLost).toBe(false);
    expect(instance.webgl2Fallback).toBe(false);
    expect(instance.gestureState).toBe("idle");
    expect(typeof instance.requestRender).toBe("function");
    expect(typeof instance.dispose).toBe("function");

    commitPayloadRevision(payload, 72);
    instance.requestRender();
    harness.raf.flush();
    expect(instance.sampleCount).toBe(72);

    instance.dispose();
    expect(instance.isReady).toBe(false);
    expect(instance.controller).toBeNull();

    app.unmount();
  });
});
