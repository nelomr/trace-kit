/** @vitest-environment happy-dom */
import type {
  SpectrumEngineController,
  ViewportInteractionController,
} from "@trace-kit/renderers/controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  createSSRApp,
  defineComponent,
  effectScope,
  h,
  markRaw,
  nextTick,
  ref,
  shallowRef,
  type ShallowUnwrapRef,
} from "vue";
import { renderToString } from "vue/server-renderer";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import type {
  SpectrumEngineHandle,
  SpectrumEngineReadyEvent,
  TraceSpectrumViewerSlotProps,
  UseSpectrumEngineReturn,
} from "../../src/types.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import {
  createMockPlatform,
  createMountedHost,
  createTestPayload,
  mockElementBoundingRect,
} from "./test-helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("vue-ssr-and-lifecycle: component & effectScope lifecycles (happy-dom)", () => {
  it("mounts strictly in onMounted, rebinds across v-if toggles, and disposes on unmount", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const showHost = ref(true);
    const readyEvents: SpectrumEngineReadyEvent[] = [];
    let controllerDuringSetup: unknown = "unset";
    let isReadyDuringSetup: boolean | null = null;
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        const handle = useSpectrumEngine(containerRef, {
          platform: harness.platform,
          onReady: (ev) => readyEvents.push(ev),
        });
        handleRef = handle;
        controllerDuringSetup = handle.controller.value;
        isReadyDuringSetup = handle.isReady.value;

        return () =>
          showHost.value
            ? h("div", { ref: containerRef, "data-testid": "dynamic-host" })
            : h("span", "hidden");
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    // 1. Strictly null during setup()
    expect(controllerDuringSetup).toBeNull();
    expect(isReadyDuringSetup).toBe(false);

    // 2. Active after onMounted
    const handle = handleRef!;
    const controller1 = handle.controller.value;
    expect(controller1).not.toBeNull();
    expect(handle.isReady.value).toBe(true);
    expect(readyEvents.length).toBe(1);

    // 3. v-if toggles false -> disposes controller1
    showHost.value = false;
    await nextTick();
    expect(controller1!.disposed).toBe(true);
    expect(handle.controller.value).toBeNull();
    expect(handle.interaction.value).toBeNull();
    expect(handle.isReady.value).toBe(false);

    // 4. v-if toggles back true -> mounts fresh controller2
    showHost.value = true;
    await nextTick();
    const controller2 = handle.controller.value;
    expect(controller2).not.toBeNull();
    expect(controller2).not.toBe(controller1);
    expect(handle.isReady.value).toBe(true);
    expect(readyEvents.length).toBe(2);

    // 5. Unmount disposes controller2
    app.unmount();
    expect(controller2!.disposed).toBe(true);
    expect(handle.controller.value).toBeNull();
    expect(handle.isReady.value).toBe(false);
  });

  it("mounts in a standalone effectScope() and disposes cleanly on scope.stop()", async () => {
    const harness = createMockPlatform();
    const hostEl = createMountedHost();
    const scope = effectScope();
    let handleRef: UseSpectrumEngineReturn | null = null;

    scope.run(() => {
      handleRef = useSpectrumEngine(shallowRef(hostEl), {
        interactive: true,
        platform: harness.platform,
      });
    });

    await nextTick();
    const handle = handleRef!;
    const controller = handle.controller.value;
    const interaction = handle.interaction.value;

    expect(controller).not.toBeNull();
    expect(interaction).not.toBeNull();
    expect(handle.isReady.value).toBe(true);

    scope.stop();
    expect(interaction!.disposed).toBe(true);
    expect(controller!.disposed).toBe(true);
    expect(handle.controller.value).toBeNull();
    expect(handle.interaction.value).toBeNull();
    expect(handle.isReady.value).toBe(false);
  });

  it("invokes interaction.dispose() strictly before controller.dispose(), restores touchAction, and is idempotent", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    let hostEl: HTMLDivElement | null = null;
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          interactive: true,
          platform: harness.platform,
        });
        return () =>
          h("div", {
            style: { touchAction: "auto" },
            ref: (el) => {
              const div = el instanceof HTMLDivElement ? el : null;
              containerRef.value = div;
              if (div !== null) {
                hostEl = div;
              }
            },
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    expect(hostEl).not.toBeNull();
    mockElementBoundingRect(hostEl!, { left: 0, top: 0, width: 800, height: 400 });

    const handle = handleRef!;
    const controller = handle.controller.value!;
    const interaction = handle.interaction.value!;
    expect(hostEl!.style.touchAction).toBe("none");

    // Start an active drag gesture so controller.gestureActive === true
    hostEl!.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: 300,
        clientY: 200,
        bubbles: true,
      }),
    );
    expect(controller.gestureActive).toBe(true);

    const callOrder: string[] = [];
    let controllerDisposedWhenGestureReleased: boolean | null = null;
    const origSetGestureActive = controller.setGestureActive.bind(controller);
    vi.spyOn(controller, "setGestureActive").mockImplementation((active: boolean) => {
      if (!active) {
        controllerDisposedWhenGestureReleased = controller.disposed;
      }
      origSetGestureActive(active);
    });
    const origInteractionDispose = interaction.dispose.bind(interaction);
    const origControllerDispose = controller.dispose.bind(controller);
    const interactionDisposeSpy = vi
      .spyOn(interaction, "dispose")
      .mockImplementation(() => {
        callOrder.push("interaction.dispose");
        origInteractionDispose();
      });
    const controllerDisposeSpy = vi
      .spyOn(controller, "dispose")
      .mockImplementation(() => {
        callOrder.push("controller.dispose");
        origControllerDispose();
      });

    app.unmount();

    expect(callOrder).toEqual(["interaction.dispose", "controller.dispose"]);
    expect(controllerDisposedWhenGestureReleased).toBe(false);
    expect(hostEl!.style.touchAction).toBe("auto");
    expect(handle.controller.value).toBeNull();
    expect(handle.interaction.value).toBeNull();
    expect(handle.isReady.value).toBe(false);
    expect(handle.gestureState.value).toBe("idle");

    // Repeated dispose() calls are completely idempotent
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(interactionDisposeSpy).toHaveBeenCalledTimes(1);
    expect(controllerDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a disposed controller after dynamic v-if false -> true mount (interactive true & false)", async () => {
    for (const interactive of [true, false]) {
      const harness = createMockPlatform();
      const mountTarget = createMountedHost();
      const showHost = ref(false);
      let handleRef: UseSpectrumEngineReturn | null = null;

      const Host = defineComponent({
        setup() {
          const containerRef = shallowRef<HTMLDivElement | null>(null);
          handleRef = useSpectrumEngine(containerRef, {
            interactive,
            platform: harness.platform,
          });
          return () =>
            showHost.value
              ? h("div", { ref: containerRef, "data-testid": "dynamic-host" })
              : h("span", "hidden");
        },
      });

      const app = createApp(Host);
      app.mount(mountTarget);
      const handle = handleRef!;
      expect(handle.controller.value).toBeNull();
      expect(handle.isReady.value).toBe(false);

      // Dynamically mount container via v-if false -> true
      showHost.value = true;
      await nextTick();
      const controller1 = handle.controller.value;
      expect(controller1).not.toBeNull();
      expect(handle.isReady.value).toBe(true);
      expect(harness.canvas2dRenderers.length).toBe(1);
      expect(harness.createdCanvases.length).toBe(1);

      // Explicitly dispose while host element remains mounted
      handle.dispose();
      await nextTick();

      // Must NOT resurrect a new controller or canvas on post-flush
      expect(controller1!.disposed).toBe(true);
      expect(handle.controller.value).toBeNull();
      expect(handle.interaction.value).toBeNull();
      expect(handle.isReady.value).toBe(false);
      expect(harness.canvas2dRenderers.length).toBe(1);
      expect(harness.createdCanvases.length).toBe(1);
      expect(mountTarget.querySelectorAll("canvas").length).toBe(0);

      app.unmount();
    }
  });

  it("does not resurrect a disposed controller after v-if true -> false -> true rebind", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const showHost = ref(true);
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          interactive: true,
          platform: harness.platform,
        });
        return () =>
          showHost.value
            ? h("div", { ref: containerRef, "data-testid": "dynamic-host" })
            : h("span", "hidden");
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    const handle = handleRef!;
    expect(harness.canvas2dRenderers.length).toBe(1);

    showHost.value = false;
    await nextTick();
    expect(handle.controller.value).toBeNull();

    showHost.value = true;
    await nextTick();
    const controller2 = handle.controller.value;
    expect(controller2).not.toBeNull();
    expect(handle.isReady.value).toBe(true);
    expect(harness.canvas2dRenderers.length).toBe(2);

    handle.dispose();
    await nextTick();

    expect(controller2!.disposed).toBe(true);
    expect(handle.controller.value).toBeNull();
    expect(handle.interaction.value).toBeNull();
    expect(handle.isReady.value).toBe(false);
    expect(harness.canvas2dRenderers.length).toBe(2);
    expect(mountTarget.querySelectorAll("canvas").length).toBe(0);

    app.unmount();
  });

  it("disposes cleanly when v-if transitions true -> false on the same tick immediately after mount", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const showHost = ref(true);
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          platform: harness.platform,
        });
        return () =>
          showHost.value
            ? h("div", { ref: containerRef })
            : h("span", "hidden");
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    const controller1 = handleRef!.controller.value;
    expect(controller1).not.toBeNull();

    // Same-tick v-if toggle immediately after mount
    showHost.value = false;
    await nextTick();

    expect(controller1!.disposed).toBe(true);
    expect(handleRef!.controller.value).toBeNull();
    expect(handleRef!.isReady.value).toBe(false);
    expect(harness.resizeObservers.activeCount()).toBe(0);

    app.unmount();
  });
});

describe("vue-ssr-and-lifecycle: createSSRApp client hydration & 20-cycle leak stress (happy-dom)", () => {
  it("hydrates bare <TraceSpectrumViewer> SSR markup with zero Vue warnings and mounts canvas post-hydration", async () => {
    const harness = createMockPlatform();
    const payload = markRaw(createTestPayload(64));

    const makeApp = (
      onRef?: (handle: ShallowUnwrapRef<SpectrumEngineHandle> | null) => void,
    ) =>
      createSSRApp(
        defineComponent({
          setup() {
            return () =>
              h(TraceSpectrumViewer, {
                class: "hydrated-chart",
                style: "height: 300px",
                data: payload,
                platform: harness.platform,
                ref: (inst) => {
                  onRef?.((inst as ShallowUnwrapRef<SpectrumEngineHandle> | null) ?? null);
                },
              });
          },
        }),
      );

    const ssrHtml = await renderToString(makeApp());
    expect(ssrHtml).toContain("data-trace-kit-viewer");
    expect(ssrHtml).toContain("data-trace-kit-surface");
    expect(ssrHtml).not.toContain("<canvas");

    const host = createMountedHost();
    host.innerHTML = ssrHtml;

    let hydratedHandle: ShallowUnwrapRef<SpectrumEngineHandle> | null = null;
    const warnHandler = vi.fn();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const clientApp = makeApp((hndl) => {
        if (hndl !== null) hydratedHandle = hndl;
      });
      clientApp.config.warnHandler = warnHandler;
      clientApp.mount(host);
      await nextTick();

      expect(warnHandler).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(hydratedHandle).not.toBeNull();
      expect(hydratedHandle!.isReady).toBe(true);
      const surface = host.querySelector("[data-trace-kit-surface]") as HTMLElement;
      expect(surface.querySelectorAll("canvas").length).toBe(1);

      clientApp.unmount();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("hydrates <TraceSpectrumViewer> with #overlay and #default slots with zero Vue warnings", async () => {
    const harness = createMockPlatform();

    const makeApp = (
      onRef?: (handle: ShallowUnwrapRef<SpectrumEngineHandle> | null) => void,
    ) =>
      createSSRApp(
        defineComponent({
          setup() {
            return () =>
              h(
                TraceSpectrumViewer,
                {
                  platform: harness.platform,
                  ref: (inst) => {
                    onRef?.((inst as ShallowUnwrapRef<SpectrumEngineHandle> | null) ?? null);
                  },
                },
                {
                  overlay: (p: TraceSpectrumViewerSlotProps) =>
                    h("span", { class: "hud" }, `mode:${p.mode}`),
                  default: (p: TraceSpectrumViewerSlotProps) =>
                    h("div", { class: "sr-only" }, `samples:${p.sampleCount}`),
                },
              );
          },
        }),
      );

    const ssrHtml = await renderToString(makeApp());
    expect(ssrHtml).toContain("data-trace-kit-surface");
    expect(ssrHtml).toContain("data-trace-kit-slot-overlay");
    expect(ssrHtml).toContain("mode:auto");
    expect(ssrHtml).toContain("samples:0");

    const host = createMountedHost();
    host.innerHTML = ssrHtml;

    let hydratedHandle: ShallowUnwrapRef<SpectrumEngineHandle> | null = null;
    const warnHandler = vi.fn();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const clientApp = makeApp((hndl) => {
        if (hndl !== null) hydratedHandle = hndl;
      });
      clientApp.config.warnHandler = warnHandler;
      clientApp.mount(host);
      await nextTick();

      expect(warnHandler).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(hydratedHandle!.isReady).toBe(true);
      const surface = host.querySelector("[data-trace-kit-surface]") as HTMLElement;
      expect(surface.querySelectorAll("canvas").length).toBe(1);

      clientApp.unmount();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("leaks zero ResizeObservers, rAF handles, controllers, interactions, DOM nodes, or touch-action across 20 mount/unmount cycles", () => {
    const harness = createMockPlatform();
    const payload = markRaw(createTestPayload(128));
    const mountTarget = createMountedHost();
    const createdControllers: SpectrumEngineController[] = [];
    const createdInteractions: ViewportInteractionController[] = [];

    for (let cycle = 0; cycle < 20; cycle += 1) {
      let surfaceEl: HTMLElement | null = null;
      const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);

      const app = createApp(
        defineComponent({
          setup() {
            return () =>
              h(TraceSpectrumViewer, {
                ref: viewerRef,
                data: payload,
                interactive: true,
                platform: harness.platform,
                onReady: (ev: SpectrumEngineReadyEvent) => {
                  createdControllers.push(ev.controller);
                  if (ev.interaction !== null) {
                    createdInteractions.push(ev.interaction);
                  }
                },
              });
          },
        }),
      );

      app.mount(mountTarget);
      surfaceEl = mountTarget.querySelector<HTMLElement>("[data-trace-kit-surface]");
      expect(surfaceEl).not.toBeNull();
      expect(surfaceEl!.style.touchAction).toBe("none");

      // Trigger resize and a pending requestRender() BEFORE unmounting
      harness.resizeObservers.triggerAll(640 + cycle, 360);
      viewerRef.value!.requestRender();

      app.unmount();

      // Surface inline touch-action restored to pre-mount empty string on every cycle
      expect(surfaceEl!.style.touchAction).toBe("");
      expect(mountTarget.querySelectorAll("canvas").length).toBe(0);
      expect(mountTarget.querySelectorAll('[data-trace-kit-overlay="box-zoom"]').length).toBe(0);
    }

    expect(createdControllers.length).toBe(20);
    expect(createdInteractions.length).toBe(20);
    expect(harness.resizeObservers.activeCount()).toBe(0);
    expect(harness.raf.pendingCount()).toBe(0);
    for (let i = 0; i < 20; i += 1) {
      expect(createdControllers[i]!.disposed).toBe(true);
      expect(createdInteractions[i]!.disposed).toBe(true);
    }
  });
});
