import type { SpectrumDataPayload, TraceCollection } from "@trace-kit/core";
import {
  createSpectrumEngineController,
  createViewportInteractionController,
  type EngineKind,
  type EngineSelectionMode,
  type InteractionGestureState,
  type SpectrumEngineController,
  type SpectrumEngineControllerOptions,
  type ViewportDomain,
  type ViewportInteractionController,
  type ViewportInteractionControllerOptions,
  type ViewportMutationReason,
} from "@trace-kit/renderers/controller";
import {
  getCurrentInstance,
  getCurrentScope,
  markRaw,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type WatchStopHandle,
} from "vue";
import {
  DEFAULT_DOMAIN_SNAPSHOT,
  assertDataTracesExclusive,
  decimationEqual,
  domainsEqual,
  readonlyShallowRef,
  snapshotDomain,
  unwrapOptional,
} from "./domain-sync.js";
import type { UseSpectrumEngineOptions, UseSpectrumEngineReturn } from "./types.js";

/**
 * Vue 3 composable bridging `@trace-kit/renderers/controller` (`SpectrumEngineController`
 * and `ViewportInteractionController`) with strict reactivity isolation (`markRaw` +
 * `shallowRef` + `shallowReadonly` + ingress `toRaw`), zero deep watchers, multi-frame
 * `v-model:domain` echo suppression, and deterministic SSR/component/`effectScope` lifecycles.
 */
export function useSpectrumEngine(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options?: UseSpectrumEngineOptions,
): UseSpectrumEngineReturn {
  const controllerRef = shallowRef<SpectrumEngineController | null>(null);
  const interactionRef = shallowRef<ViewportInteractionController | null>(null);

  const isReadyRef = shallowRef(false);
  const activeKindRef = shallowRef<EngineKind>("canvas2d");
  const modeRef = shallowRef<EngineSelectionMode>(toValue(options?.mode) ?? "auto");
  const initialDomain = unwrapOptional(toValue(options?.domain));
  const domainRef = shallowRef<ViewportDomain>(
    initialDomain !== undefined ? snapshotDomain(initialDomain) : DEFAULT_DOMAIN_SNAPSHOT,
  );
  const sampleCountRef = shallowRef(0);
  const contextLostRef = shallowRef(false);
  const webgl2FallbackRef = shallowRef(false);
  const gestureStateRef = shallowRef<InteractionGestureState>("idle");

  const emittedDomains = new WeakSet<ViewportDomain>();

  let mountedContainer: HTMLElement | null = null;
  let lastAppliedData: SpectrumDataPayload | undefined = undefined;
  let lastAppliedTraces: TraceCollection | undefined = undefined;
  let isCleared = false;

  function emitDomainSnapshot(liveDomain: ViewportDomain, reason: ViewportMutationReason): void {
    const snapshot = snapshotDomain(liveDomain);
    emittedDomains.add(snapshot);
    domainRef.value = snapshot;
    options?.onDomainChange?.(snapshot, reason);
  }

  function syncControllerMetadata(controller: SpectrumEngineController): void {
    if (controller.disposed) return;
    activeKindRef.value = controller.activeKind;
    modeRef.value = controller.mode;
    webgl2FallbackRef.value = controller.webgl2Fallback;
    contextLostRef.value = controller.contextLost;
    sampleCountRef.value = isCleared ? 0 : controller.sampleCount;
  }

  function attachInteraction(controller: SpectrumEngineController): ViewportInteractionController {
    const rawHomeDomain = unwrapOptional(toValue(options?.homeDomain));
    const currentDragMode = toValue(options?.dragMode) ?? "pan";
    const baseOpts = options?.interactionOptions;

    const interactionOpts: ViewportInteractionControllerOptions = {
      ...baseOpts,
      controller,
      enabled: true,
      dragMode: currentDragMode,
      ...(rawHomeDomain !== undefined ? { homeDomain: rawHomeDomain } : {}),
      onDomainChange(liveDomain, reason) {
        emitDomainSnapshot(liveDomain, reason);
      },
      onInvalidate(event) {
        options?.onInvalidate?.(event);
      },
      onBoxSelect(event) {
        options?.onBoxSelect?.(event);
      },
      onGestureStateChange(event) {
        gestureStateRef.value = event.state;
        options?.onGestureStateChange?.(event);
      },
    };

    const rawInteraction = markRaw(createViewportInteractionController(interactionOpts));
    interactionRef.value = rawInteraction;
    gestureStateRef.value = rawInteraction.state;
    return rawInteraction;
  }

  function dispose(): void {
    const activeInteraction = interactionRef.value;
    const activeController = controllerRef.value;

    // Null refs BEFORE invoking .dispose() so any re-entrant call or callback
    // observes torn-down state and becomes an immediate idempotent no-op.
    interactionRef.value = null;
    controllerRef.value = null;
    mountedContainer = null;
    lastAppliedData = undefined;
    lastAppliedTraces = undefined;
    isCleared = false;
    isReadyRef.value = false;
    gestureStateRef.value = "idle";

    // Strict teardown ordering: interaction FIRST (releases active gesture against a live
    // controller and restores container.style.touchAction), then controller SECOND.
    try {
      if (activeInteraction !== null && !activeInteraction.disposed) {
        activeInteraction.dispose();
      }
    } finally {
      if (activeController !== null && !activeController.disposed) {
        activeController.dispose();
      }
    }
  }

  function attach(el: HTMLElement): void {
    const rawData = unwrapOptional(toValue(options?.data));
    const rawTraces = unwrapOptional(toValue(options?.traces));
    assertDataTracesExclusive(rawData, rawTraces);

    const platform = options?.platform;
    const baseRaf: (callback: FrameRequestCallback) => number =
      platform?.requestAnimationFrame ??
      ((callback: FrameRequestCallback): number => {
        if (typeof globalThis.requestAnimationFrame === "function") {
          return globalThis.requestAnimationFrame(callback);
        }
        return Number(setTimeout(() => callback(Date.now()), 16));
      });

    let attachedController: SpectrumEngineController | null = null;

    const wrappedRaf = (callback: FrameRequestCallback): number =>
      baseRaf((timestamp) => {
        callback(timestamp);
        if (
          attachedController !== null &&
          controllerRef.value === attachedController &&
          !attachedController.disposed
        ) {
          syncControllerMetadata(attachedController);
        }
      });

    const baseCancelRaf: ((handle: number) => void) | undefined =
      platform?.cancelAnimationFrame ??
      (typeof globalThis.requestAnimationFrame === "function"
        ? undefined
        : (handle: number): void => {
            clearTimeout(handle);
          });

    const initialMode = toValue(options?.mode);
    const initialDecimation = unwrapOptional(toValue(options?.decimation));
    const rawDecimationPort = unwrapOptional(options?.decimationPort);
    const rawSettlementSink = unwrapOptional(options?.settlementSink);

    const controllerOpts: SpectrumEngineControllerOptions = {
      container: el,
      autoResize: options?.autoResize ?? true,
      requestAnimationFrame: wrappedRaf,
      ...(baseCancelRaf !== undefined ? { cancelAnimationFrame: baseCancelRaf } : {}),
      ...(initialMode !== undefined ? { mode: initialMode } : {}),
      ...(options?.figureStyle !== undefined ? { style: options.figureStyle } : {}),
      ...(options?.axes !== undefined ? { axes: options.axes } : {}),
      ...(options?.yAxes !== undefined ? { yAxes: options.yAxes } : {}),
      ...(options?.hysteresis !== undefined ? { hysteresis: options.hysteresis } : {}),
      ...(initialDecimation !== undefined ? { decimation: initialDecimation } : {}),
      ...(rawDecimationPort !== undefined ? { decimationPort: rawDecimationPort } : {}),
      ...(rawSettlementSink !== undefined ? { settlementSink: rawSettlementSink } : {}),
      ...(options?.initialWidth !== undefined ? { initialWidth: options.initialWidth } : {}),
      ...(options?.initialHeight !== undefined ? { initialHeight: options.initialHeight } : {}),
      ...(options?.initialDpr !== undefined ? { initialDpr: options.initialDpr } : {}),
      ...(platform?.createCanvas2DRenderer !== undefined
        ? { createCanvas2DRenderer: platform.createCanvas2DRenderer }
        : {}),
      ...(platform?.createWebGL2Renderer !== undefined
        ? { createWebGL2Renderer: platform.createWebGL2Renderer }
        : {}),
      ...(platform?.createCanvas !== undefined ? { createCanvas: platform.createCanvas } : {}),
      ...(platform?.resizeObserverFactory !== undefined
        ? { resizeObserverFactory: platform.resizeObserverFactory }
        : {}),
      ...(platform?.getDevicePixelRatio !== undefined
        ? { getDevicePixelRatio: platform.getDevicePixelRatio }
        : {}),
      onEngineChange(event) {
        // Re-entrancy safe: may fire synchronously inside createSpectrumEngineController
        // before `controllerRef.value` is assigned. Read directly from `event`.
        activeKindRef.value = event.activeKind;
        modeRef.value = event.mode;
        if (!isCleared) {
          sampleCountRef.value = event.sampleCount;
        }
        const current = controllerRef.value;
        if (current !== null && !current.disposed) {
          webgl2FallbackRef.value = current.webgl2Fallback;
          contextLostRef.value = current.contextLost;
        }
        options?.onEngineChange?.(event);
      },
      onWebGL2Fallback(event) {
        webgl2FallbackRef.value = true;
        activeKindRef.value = "canvas2d";
        contextLostRef.value = false;
        modeRef.value = event.attemptedMode;
        if (!isCleared) {
          sampleCountRef.value = event.sampleCount;
        }
        options?.onWebGL2Fallback?.(event);
      },
      onContextLost(event) {
        contextLostRef.value = true;
        activeKindRef.value = event.activeKind;
        modeRef.value = event.mode;
        if (!isCleared) {
          sampleCountRef.value = event.sampleCount;
        }
        options?.onContextLost?.(event);
      },
      onContextRestored(event) {
        contextLostRef.value = false;
        activeKindRef.value = event.activeKind;
        modeRef.value = event.mode;
        if (!isCleared) {
          sampleCountRef.value = event.sampleCount;
        }
        options?.onContextRestored?.(event);
      },
    };

    const rawController = markRaw(createSpectrumEngineController(controllerOpts));
    attachedController = rawController;
    controllerRef.value = rawController;
    mountedContainer = el;
    isCleared = false;

    try {
      // Deterministic sync order: setData / setTraces strictly BEFORE setDomain
      if (rawData !== undefined) {
        rawController.setData(rawData);
        lastAppliedData = rawData;
        lastAppliedTraces = undefined;
      } else if (rawTraces !== undefined) {
        rawController.setTraces(rawTraces);
        lastAppliedTraces = rawTraces;
        lastAppliedData = undefined;
      }

      const rawDomain = unwrapOptional(toValue(options?.domain));
      if (rawDomain !== undefined) {
        rawController.setDomain(rawDomain.xMin, rawDomain.xMax, rawDomain.yMin, rawDomain.yMax);
      }

      domainRef.value = snapshotDomain(rawController.domain);
      syncControllerMetadata(rawController);

      const initialInteractive = toValue(options?.interactive) ?? true;
      if (initialInteractive) {
        attachInteraction(rawController);
      }

      isReadyRef.value = true;

      if (rawData !== undefined || rawTraces !== undefined) {
        rawController.requestRender();
      }

      options?.onReady?.({
        controller: rawController,
        interaction: interactionRef.value,
      });
    } catch (error) {
      dispose();
      throw error;
    }
  }

  function rebind(nextEl: HTMLElement | null | undefined): void {
    const el = nextEl ?? null;
    if (el === mountedContainer) return;
    if (mountedContainer !== null || controllerRef.value !== null) {
      dispose();
    }
    if (el !== null) {
      attach(el);
    }
  }

  // Single-flush ordered shallow watcher for engine state (strictly shallow, never recursive).
  watch(
    () =>
      [
        toValue(options?.data),
        toValue(options?.traces),
        toValue(options?.domain),
        toValue(options?.mode),
        toValue(options?.decimation),
        toValue(options?.revision),
      ] as const,
    (
      [nextData, nextTraces, nextDomain, nextMode, nextDecimation, nextRevision],
      [, , prevDomain, prevMode, prevDecimation, prevRevision],
    ) => {
      const active = controllerRef.value;
      if (active === null || active.disposed) return;

      // Step 1: Fail-fast mutual exclusivity BEFORE any controller mutation
      const rawData = unwrapOptional(nextData);
      const rawTraces = unwrapOptional(nextTraces);
      assertDataTracesExclusive(rawData, rawTraces);

      let needsRender = false;

      // Step 2: data / traces diff strictly BEFORE domain
      if (rawData !== lastAppliedData || rawTraces !== lastAppliedTraces) {
        if (rawData !== undefined) {
          active.setData(rawData);
          isCleared = false;
          sampleCountRef.value = active.sampleCount;
          needsRender = true;
        } else if (rawTraces !== undefined) {
          active.setTraces(rawTraces);
          isCleared = false;
          sampleCountRef.value = active.sampleCount;
          domainRef.value = snapshotDomain(active.domain);
          needsRender = true;
        } else if (lastAppliedData !== undefined || lastAppliedTraces !== undefined) {
          active.clear();
          isCleared = true;
          sampleCountRef.value = 0;
        }
        lastAppliedData = rawData;
        lastAppliedTraces = rawTraces;
      }

      // Step 3: domain diff strictly AFTER data / traces, with Dual Echo Guard
      if (nextDomain !== prevDomain) {
        const rawNextDomain = unwrapOptional(nextDomain);
        if (
          rawNextDomain !== undefined &&
          !emittedDomains.has(rawNextDomain) &&
          !domainsEqual(rawNextDomain, active.domain)
        ) {
          active.setDomain(
            rawNextDomain.xMin,
            rawNextDomain.xMax,
            rawNextDomain.yMin,
            rawNextDomain.yMax,
          );
          domainRef.value = snapshotDomain(active.domain);
          needsRender = true;
        }
      }

      // Step 4: mode diff
      if (nextMode !== prevMode) {
        const resolvedMode: EngineSelectionMode = nextMode ?? "auto";
        if (resolvedMode !== active.mode) {
          active.setMode(resolvedMode);
          syncControllerMetadata(active);
          needsRender = true;
        }
      }

      // Step 5: decimation diff (structural equality avoids redundant re-config)
      if (nextDecimation !== prevDecimation) {
        const rawDecimation = unwrapOptional(nextDecimation);
        if (!decimationEqual(rawDecimation, active.decimation)) {
          active.setDecimation(rawDecimation);
          needsRender = true;
        }
      }

      // Step 6: scalar revision bump (Path B streaming seam — no setData, no clone)
      if (nextRevision !== prevRevision && nextRevision !== undefined) {
        if (rawData !== undefined || rawTraces !== undefined) {
          isCleared = false;
        }
        needsRender = true;
      }

      // Step 7: single coalesced requestRender()
      if (needsRender && !active.disposed) {
        active.requestRender();
      }
    },
  );

  // Separate shallow watcher for ViewportInteractionController coordination.
  watch(
    () =>
      [
        toValue(options?.interactive),
        toValue(options?.dragMode),
        toValue(options?.homeDomain),
      ] as const,
    ([nextInteractive, nextDragMode, nextHomeDomain]) => {
      const activeController = controllerRef.value;
      if (activeController === null || activeController.disposed) return;

      const resolvedInteractive = nextInteractive ?? true;
      let activeInteraction = interactionRef.value;

      if (resolvedInteractive) {
        if (activeInteraction === null || activeInteraction.disposed) {
          activeInteraction = attachInteraction(activeController);
        } else if (!activeInteraction.enabled) {
          activeInteraction.setEnabled(true);
        }
      } else if (activeInteraction !== null && !activeInteraction.disposed) {
        if (activeInteraction.enabled) {
          activeInteraction.setEnabled(false);
        }
      }

      if (activeInteraction !== null && !activeInteraction.disposed) {
        const resolvedDragMode = nextDragMode ?? "pan";
        if (resolvedDragMode !== activeInteraction.dragMode) {
          activeInteraction.setDragMode(resolvedDragMode);
        }
        const rawHomeDomain = unwrapOptional(nextHomeDomain);
        if (rawHomeDomain !== undefined && !domainsEqual(rawHomeDomain, activeInteraction.homeDomain)) {
          activeInteraction.setHomeDomain(
            rawHomeDomain.xMin,
            rawHomeDomain.xMax,
            rawHomeDomain.yMin,
            rawHomeDomain.yMax,
          );
        }
      }
    },
  );

  // Dual lifecycle registration: Vue component vs standalone effectScope()
  if (getCurrentInstance() !== null) {
    let isMounted = false;
    let stopContainerWatch: WatchStopHandle | null = null;

    const stopLifecycle = (): void => {
      isMounted = false;
      if (stopContainerWatch !== null) {
        stopContainerWatch();
        stopContainerWatch = null;
      }
      dispose();
    };

    onMounted(() => {
      isMounted = true;
      // Register source-only watch inside onMounted AFTER template ref hydration so:
      // 1. oldValue captures the initially mounted element (handles same-tick mount -> v-if=false).
      // 2. rebind() runs with Vue tracking paused, never tracking controllerRef/interactionRef/options.
      stopContainerWatch = watch(
        () => toValue(container),
        (nextEl) => {
          if (!isMounted) return;
          rebind(nextEl);
        },
        { flush: "post" },
      );
      rebind(toValue(container));
    });

    onBeforeUnmount(stopLifecycle);
    onScopeDispose(stopLifecycle);
  } else if (typeof document !== "undefined") {
    watch(
      () => toValue(container),
      (nextEl) => {
        rebind(nextEl);
      },
      { immediate: true, flush: "post" },
    );

    if (getCurrentScope() !== undefined) {
      onScopeDispose(() => {
        dispose();
      });
    }
  }

  // All 11 no-op-guarded imperative methods
  function render(): void {
    const active = controllerRef.value;
    if (active === null || active.disposed) return;
    active.render();
    if (controllerRef.value === active && !active.disposed) {
      syncControllerMetadata(active);
    }
  }

  function requestRender(): void {
    const active = controllerRef.value;
    if (active === null || active.disposed) return;
    if (
      lastAppliedData !== undefined ||
      lastAppliedTraces !== undefined ||
      (options?.data === undefined && options?.traces === undefined)
    ) {
      isCleared = false;
    }
    active.requestRender();
  }

  function clear(): void {
    const active = controllerRef.value;
    if (active === null || active.disposed) return;
    active.clear();
    isCleared = true;
    sampleCountRef.value = 0;
  }

  function setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    const active = controllerRef.value;
    if (active === null || active.disposed) return;
    active.setDomain(xMin, xMax, yMin, yMax);
    emitDomainSnapshot(active.domain, "programmatic");
  }

  function resize(width: number, height: number, dpr?: number): void {
    const active = controllerRef.value;
    if (active === null || active.disposed) return;
    active.resize(width, height, dpr ?? active.dpr);
  }

  function retryWebGL2(): boolean {
    const active = controllerRef.value;
    if (active === null || active.disposed) return false;
    const recovered = active.retryWebGL2();
    syncControllerMetadata(active);
    return recovered;
  }

  function resetDomain(): void {
    const active = interactionRef.value;
    if (active === null || active.disposed) return;
    active.resetDomain();
  }

  function zoomByFactor(
    factorX: number,
    factorY: number,
    normX?: number,
    normY?: number,
  ): boolean {
    const active = interactionRef.value;
    if (active === null || active.disposed) return false;
    return active.zoomByFactor(factorX, factorY, normX, normY);
  }

  function panByFraction(fractionX: number, fractionY: number): boolean {
    const active = interactionRef.value;
    if (active === null || active.disposed) return false;
    return active.panByFraction(fractionX, fractionY);
  }

  function cancelGesture(): void {
    const active = interactionRef.value;
    if (active === null || active.disposed) return;
    active.cancelGesture();
  }

  return {
    controller: readonlyShallowRef(controllerRef),
    interaction: readonlyShallowRef(interactionRef),
    isReady: readonlyShallowRef(isReadyRef),
    activeKind: readonlyShallowRef(activeKindRef),
    mode: readonlyShallowRef(modeRef),
    domain: readonlyShallowRef(domainRef),
    sampleCount: readonlyShallowRef(sampleCountRef),
    contextLost: readonlyShallowRef(contextLostRef),
    webgl2Fallback: readonlyShallowRef(webgl2FallbackRef),
    gestureState: readonlyShallowRef(gestureStateRef),
    render,
    requestRender,
    clear,
    setDomain,
    resize,
    retryWebGL2,
    resetDomain,
    zoomByFactor,
    panByFraction,
    cancelGesture,
    dispose,
  };
}
