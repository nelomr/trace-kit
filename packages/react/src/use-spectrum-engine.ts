import type {
  DecimationSelection,
  SpectrumDataPayload,
  TraceCollection,
} from "@trace-kit/core";
import {
  createSpectrumEngineController,
  createViewportInteractionController,
  type EngineKind,
  type EngineSelectionMode,
  type InteractionDragMode,
  type InteractionGestureState,
  type SpectrumEngineController,
  type SpectrumEngineControllerOptions,
  type ViewportDomain,
  type ViewportInteractionController,
  type ViewportInteractionControllerOptions,
  type ViewportMutationReason,
} from "@trace-kit/renderers/controller";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  DEFAULT_DOMAIN_SNAPSHOT,
  assertDataTracesExclusive,
  decimationEqual,
  domainsEqual,
  normalizeOptional,
  snapshotDomain,
} from "./domain-sync.js";
import type {
  SpectrumEngineSnapshot,
  UseSpectrumEngineOptions,
  UseSpectrumEngineReturn,
} from "./types.js";

interface MetadataStore {
  snapshot: SpectrumEngineSnapshot;
  readonly serverSnapshot: SpectrumEngineSnapshot;
  readonly listeners: Set<() => void>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SpectrumEngineSnapshot;
  readonly getServerSnapshot: () => SpectrumEngineSnapshot;
  readonly update: (patch: Partial<SpectrumEngineSnapshot>) => void;
}

function createMetadataStore(
  initialMode: EngineSelectionMode,
  initialDomain: ViewportDomain,
): MetadataStore {
  const initialSnapshot: SpectrumEngineSnapshot = Object.freeze({
    isReady: false,
    activeKind: "canvas2d",
    mode: initialMode,
    domain: initialDomain,
    sampleCount: 0,
    contextLost: false,
    webgl2Fallback: false,
    gestureState: "idle",
  });

  const listeners = new Set<() => void>();

  const store: MetadataStore = {
    snapshot: initialSnapshot,
    serverSnapshot: initialSnapshot,
    listeners,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): SpectrumEngineSnapshot {
      return store.snapshot;
    },
    getServerSnapshot(): SpectrumEngineSnapshot {
      return store.serverSnapshot;
    },
    update(patch: Partial<SpectrumEngineSnapshot>): void {
      const prev = store.snapshot;
      const nextIsReady = patch.isReady ?? prev.isReady;
      const nextActiveKind: EngineKind = patch.activeKind ?? prev.activeKind;
      const nextMode: EngineSelectionMode = patch.mode ?? prev.mode;
      const nextDomain: ViewportDomain = patch.domain ?? prev.domain;
      const nextSampleCount = patch.sampleCount ?? prev.sampleCount;
      const nextContextLost = patch.contextLost ?? prev.contextLost;
      const nextWebgl2Fallback = patch.webgl2Fallback ?? prev.webgl2Fallback;
      const nextGestureState: InteractionGestureState = patch.gestureState ?? prev.gestureState;

      if (
        nextIsReady === prev.isReady &&
        nextActiveKind === prev.activeKind &&
        nextMode === prev.mode &&
        domainsEqual(nextDomain, prev.domain) &&
        nextSampleCount === prev.sampleCount &&
        nextContextLost === prev.contextLost &&
        nextWebgl2Fallback === prev.webgl2Fallback &&
        nextGestureState === prev.gestureState
      ) {
        return;
      }

      store.snapshot = Object.freeze({
        isReady: nextIsReady,
        activeKind: nextActiveKind,
        mode: nextMode,
        domain: nextDomain,
        sampleCount: nextSampleCount,
        contextLost: nextContextLost,
        webgl2Fallback: nextWebgl2Fallback,
        gestureState: nextGestureState,
      });

      for (const listener of listeners) {
        listener();
      }
    },
  };

  return store;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const NOOP_UNSUBSCRIBE = (): void => {};
function noopSubscribe(): () => void {
  return NOOP_UNSUBSCRIBE;
}

interface SyncTracker {
  mountedContainer: HTMLElement | null;
  manuallyDisposedContainer: HTMLElement | null;
  lastAppliedData: SpectrumDataPayload | undefined;
  lastAppliedTraces: TraceCollection | undefined;
  prevDomain: ViewportDomain | undefined;
  prevMode: EngineSelectionMode | undefined;
  prevDecimation: DecimationSelection | undefined;
  prevRevision: number | undefined;
  isCleared: boolean;
}

/**
 * React 18/19 hook bridging `@trace-kit/renderers/controller` (`SpectrumEngineController`
 * and `ViewportInteractionController`) with strict `useRef` unmanaged-canvas isolation,
 * selective `useSyncExternalStore` notifications (zero React re-renders during 60 Hz Path A
 * streaming), dual echo suppression for controlled `domain`, latest-callback ref stability,
 * and `<React.StrictMode>` / Node SSR safety.
 */
export function useSpectrumEngine(
  containerRef: RefObject<HTMLElement | null>,
  options?: UseSpectrumEngineOptions,
): UseSpectrumEngineReturn {
  const rawDataProp = normalizeOptional(options?.data);
  const rawTracesProp = normalizeOptional(options?.traces);
  // Fail fast before any effect or controller mutation
  assertDataTracesExclusive(rawDataProp, rawTracesProp);

  const controllerRef = useRef<SpectrumEngineController | null>(null);
  const interactionRef = useRef<ViewportInteractionController | null>(null);
  const emittedDomainsRef = useRef<WeakSet<ViewportDomain> | null>(null);
  if (emittedDomainsRef.current === null) {
    emittedDomainsRef.current = new WeakSet<ViewportDomain>();
  }

  const storeRef = useRef<MetadataStore | null>(null);
  if (storeRef.current === null) {
    const initialMode: EngineSelectionMode = options?.mode ?? "auto";
    const initialDomain =
      options?.domain !== undefined ? snapshotDomain(options.domain) : DEFAULT_DOMAIN_SNAPSHOT;
    storeRef.current = createMetadataStore(initialMode, initialDomain);
  }
  const store = storeRef.current;

  // Declare useSyncExternalStore BEFORE all passive lifecycle effects so React's
  // internal subscribeToStore effect runs prior to mountContainer(). This prevents
  // a wasted second mount render under subscribeState: false and avoids mount tearing
  // under subscribeState: true.
  const shouldSubscribe = options?.subscribeState ?? true;
  const snapshot = useSyncExternalStore(
    shouldSubscribe ? store.subscribe : noopSubscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const trackerRef = useRef<SyncTracker>({
    mountedContainer: null,
    manuallyDisposedContainer: null,
    lastAppliedData: undefined,
    lastAppliedTraces: undefined,
    prevDomain: undefined,
    prevMode: undefined,
    prevDecimation: undefined,
    prevRevision: undefined,
    isCleared: false,
  });

  // Latest options/callbacks holder — synchronized via isomorphic layout effect prior to
  // child useEffects, mount/reconcile, and prop sync so inline callback closures never
  // trigger controller teardown and render remains pure.
  const latestOptionsRef = useRef<UseSpectrumEngineOptions | undefined>(options);
  useIsomorphicLayoutEffect(() => {
    latestOptionsRef.current = options;
  });

  const emitDomainSnapshot = useCallback(
    (liveDomain: ViewportDomain, reason: ViewportMutationReason): void => {
      const snapshot = snapshotDomain(liveDomain);
      emittedDomainsRef.current?.add(snapshot);
      store.update({ domain: snapshot });
      latestOptionsRef.current?.onDomainChange?.(snapshot, reason);
    },
    [store],
  );

  const syncControllerMetadata = useCallback(
    (controller: SpectrumEngineController): void => {
      if (controller.disposed) return;
      store.update({
        activeKind: controller.activeKind,
        mode: controller.mode,
        webgl2Fallback: controller.webgl2Fallback,
        contextLost: controller.contextLost,
        sampleCount: trackerRef.current.isCleared ? 0 : controller.sampleCount,
      });
    },
    [store],
  );

  const attachInteraction = useCallback(
    (controller: SpectrumEngineController): ViewportInteractionController => {
      const opts = latestOptionsRef.current;
      const rawHomeDomain = opts?.homeDomain;
      const currentDragMode: InteractionDragMode = opts?.dragMode ?? "pan";
      const baseOpts = opts?.interactionOptions;

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
          latestOptionsRef.current?.onInvalidate?.(event);
        },
        onBoxSelect(event) {
          latestOptionsRef.current?.onBoxSelect?.(event);
        },
        onGestureStateChange(event) {
          store.update({ gestureState: event.state });
          latestOptionsRef.current?.onGestureStateChange?.(event);
        },
      };

      const rawInteraction = createViewportInteractionController(interactionOpts);
      interactionRef.current = rawInteraction;
      store.update({ gestureState: rawInteraction.state });
      return rawInteraction;
    },
    [emitDomainSnapshot, store],
  );

  const disposeInternal = useCallback(
    (isManual: boolean): void => {
      const activeInteraction = interactionRef.current;
      const activeController = controllerRef.current;
      const tracker = trackerRef.current;
      const previousContainer = tracker.mountedContainer;

      // Null refs BEFORE invoking .dispose() so re-entrant callbacks observe torn-down state.
      interactionRef.current = null;
      controllerRef.current = null;
      tracker.mountedContainer = null;
      if (isManual && previousContainer !== null) {
        tracker.manuallyDisposedContainer = previousContainer;
      }
      tracker.lastAppliedData = undefined;
      tracker.lastAppliedTraces = undefined;
      tracker.prevDomain = undefined;
      tracker.prevMode = undefined;
      tracker.prevDecimation = undefined;
      tracker.prevRevision = undefined;
      tracker.isCleared = false;

      store.update({
        isReady: false,
        gestureState: "idle",
      });

      // Strict teardown ordering: interaction FIRST, then controller SECOND.
      try {
        if (activeInteraction !== null && !activeInteraction.disposed) {
          activeInteraction.dispose();
        }
      } finally {
        if (activeController !== null && !activeController.disposed) {
          activeController.dispose();
        }
      }
    },
    [store],
  );

  const dispose = useCallback((): void => {
    disposeInternal(true);
  }, [disposeInternal]);

  const mountContainer = useCallback(
    (el: HTMLElement): void => {
      const opts = latestOptionsRef.current;
      const rawData = normalizeOptional(opts?.data);
      const rawTraces = normalizeOptional(opts?.traces);
      assertDataTracesExclusive(rawData, rawTraces);

      const platform = opts?.platform;
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
            controllerRef.current === attachedController &&
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

      const initialMode = opts?.mode;
      const initialDecimation = opts?.decimation;

      const controllerOpts: SpectrumEngineControllerOptions = {
        container: el,
        autoResize: opts?.autoResize ?? true,
        requestAnimationFrame: wrappedRaf,
        ...(baseCancelRaf !== undefined ? { cancelAnimationFrame: baseCancelRaf } : {}),
        ...(initialMode !== undefined ? { mode: initialMode } : {}),
        ...(opts?.figureStyle !== undefined ? { style: opts.figureStyle } : {}),
        ...(opts?.axes !== undefined ? { axes: opts.axes } : {}),
        ...(opts?.yAxes !== undefined ? { yAxes: opts.yAxes } : {}),
        ...(opts?.hysteresis !== undefined ? { hysteresis: opts.hysteresis } : {}),
        ...(initialDecimation !== undefined ? { decimation: initialDecimation } : {}),
        ...(opts?.decimationPort !== undefined ? { decimationPort: opts.decimationPort } : {}),
        ...(opts?.settlementSink !== undefined ? { settlementSink: opts.settlementSink } : {}),
        ...(opts?.initialWidth !== undefined ? { initialWidth: opts.initialWidth } : {}),
        ...(opts?.initialHeight !== undefined ? { initialHeight: opts.initialHeight } : {}),
        ...(opts?.initialDpr !== undefined ? { initialDpr: opts.initialDpr } : {}),
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
          const current = controllerRef.current;
          const patch: Partial<SpectrumEngineSnapshot> = {
            activeKind: event.activeKind,
            mode: event.mode,
            ...(!trackerRef.current.isCleared ? { sampleCount: event.sampleCount } : {}),
            ...(current !== null && !current.disposed
              ? {
                  webgl2Fallback: current.webgl2Fallback,
                  contextLost: current.contextLost,
                }
              : {}),
          };
          store.update(patch);
          latestOptionsRef.current?.onEngineChange?.(event);
        },
        onWebGL2Fallback(event) {
          store.update({
            webgl2Fallback: true,
            activeKind: "canvas2d",
            contextLost: false,
            mode: event.attemptedMode,
            ...(!trackerRef.current.isCleared ? { sampleCount: event.sampleCount } : {}),
          });
          latestOptionsRef.current?.onWebGL2Fallback?.(event);
        },
        onContextLost(event) {
          store.update({
            contextLost: true,
            activeKind: event.activeKind,
            mode: event.mode,
            ...(!trackerRef.current.isCleared ? { sampleCount: event.sampleCount } : {}),
          });
          latestOptionsRef.current?.onContextLost?.(event);
        },
        onContextRestored(event) {
          store.update({
            contextLost: false,
            activeKind: event.activeKind,
            mode: event.mode,
            ...(!trackerRef.current.isCleared ? { sampleCount: event.sampleCount } : {}),
          });
          latestOptionsRef.current?.onContextRestored?.(event);
        },
      };

      const rawController = createSpectrumEngineController(controllerOpts);
      attachedController = rawController;
      controllerRef.current = rawController;
      const tracker = trackerRef.current;
      tracker.mountedContainer = el;
      tracker.manuallyDisposedContainer = null;
      tracker.isCleared = false;

      try {
        // Deterministic sync order: setData / setTraces strictly BEFORE setDomain
        if (rawData !== undefined) {
          rawController.setData(rawData);
          tracker.lastAppliedData = rawData;
          tracker.lastAppliedTraces = undefined;
        } else if (rawTraces !== undefined) {
          rawController.setTraces(rawTraces);
          tracker.lastAppliedTraces = rawTraces;
          tracker.lastAppliedData = undefined;
        }

        const rawDomain = opts?.domain;
        if (rawDomain !== undefined) {
          rawController.setDomain(rawDomain.xMin, rawDomain.xMax, rawDomain.yMin, rawDomain.yMax);
        }

        tracker.prevDomain = opts?.domain;
        tracker.prevMode = opts?.mode;
        tracker.prevDecimation = opts?.decimation;
        tracker.prevRevision = opts?.revision;

        const initialInteractive = opts?.interactive ?? true;
        if (initialInteractive) {
          attachInteraction(rawController);
        }

        store.update({
          isReady: true,
          activeKind: rawController.activeKind,
          mode: rawController.mode,
          domain: snapshotDomain(rawController.domain),
          sampleCount: rawController.sampleCount,
          contextLost: rawController.contextLost,
          webgl2Fallback: rawController.webgl2Fallback,
          gestureState: interactionRef.current?.state ?? "idle",
        });

        if (rawData !== undefined || rawTraces !== undefined) {
          rawController.requestRender();
        }

        latestOptionsRef.current?.onReady?.({
          controller: rawController,
          interaction: interactionRef.current,
        });
      } catch (error) {
        disposeInternal(false);
        throw error;
      }
    },
    [attachInteraction, disposeInternal, store, syncControllerMetadata],
  );

  // Unmount & React.StrictMode simulated cleanup effect
  useEffect(() => {
    return () => {
      trackerRef.current.manuallyDisposedContainer = null;
      disposeInternal(false);
    };
  }, [disposeInternal]);

  // Dynamic containerRef.current lifecycle reconciliation (handles null -> el -> null -> el2
  // and swapped DOM nodes while preventing resurrection after manual handle.dispose()).
  useEffect(() => {
    const el = containerRef.current;
    const tracker = trackerRef.current;

    if (el === null) {
      tracker.manuallyDisposedContainer = null;
      if (tracker.mountedContainer !== null) {
        disposeInternal(false);
      }
      return;
    }

    if (el === tracker.mountedContainer) return;
    if (el === tracker.manuallyDisposedContainer) return;

    if (tracker.mountedContainer !== null) {
      disposeInternal(false);
    }
    mountContainer(el);
  });

  // Single-commit ordered prop synchronization effect
  const nextDomain = options?.domain;
  const nextMode = options?.mode;
  const nextDecimation = options?.decimation;
  const nextRevision = options?.revision;

  useEffect(() => {
    const active = controllerRef.current;
    if (active === null || active.disposed) return;

    const tracker = trackerRef.current;
    assertDataTracesExclusive(rawDataProp, rawTracesProp);

    let needsRender = false;
    let tracesApplied = false;
    let pendingPatch: Partial<SpectrumEngineSnapshot> | null = null;
    const queuePatch = (patch: Partial<SpectrumEngineSnapshot>): void => {
      pendingPatch = pendingPatch === null ? patch : { ...pendingPatch, ...patch };
    };

    // Step 1: data / traces diff strictly BEFORE domain
    if (rawDataProp !== tracker.lastAppliedData || rawTracesProp !== tracker.lastAppliedTraces) {
      if (rawDataProp !== undefined) {
        active.setData(rawDataProp);
        tracker.isCleared = false;
        queuePatch({ sampleCount: active.sampleCount });
        needsRender = true;
      } else if (rawTracesProp !== undefined) {
        active.setTraces(rawTracesProp);
        tracker.isCleared = false;
        tracesApplied = true;
        queuePatch({
          sampleCount: active.sampleCount,
          domain: snapshotDomain(active.domain),
        });
        needsRender = true;
      } else if (tracker.lastAppliedData !== undefined || tracker.lastAppliedTraces !== undefined) {
        active.clear();
        tracker.isCleared = true;
        queuePatch({ sampleCount: 0 });
      }
      tracker.lastAppliedData = rawDataProp;
      tracker.lastAppliedTraces = rawTracesProp;
    }

    // Step 2: domain diff strictly AFTER data / traces, with Dual Echo Guard
    // Also re-apply controlled domain if Step 1 setTraces() overwrote the controller extent.
    if (nextDomain !== tracker.prevDomain || (tracesApplied && nextDomain !== undefined)) {
      if (
        nextDomain !== undefined &&
        !(emittedDomainsRef.current?.has(nextDomain) ?? false) &&
        !domainsEqual(nextDomain, active.domain)
      ) {
        active.setDomain(nextDomain.xMin, nextDomain.xMax, nextDomain.yMin, nextDomain.yMax);
        queuePatch({ domain: snapshotDomain(active.domain) });
        needsRender = true;
      }
      tracker.prevDomain = nextDomain;
    }

    // Step 3: mode diff
    if (nextMode !== tracker.prevMode) {
      const resolvedMode: EngineSelectionMode = nextMode ?? "auto";
      if (resolvedMode !== active.mode) {
        active.setMode(resolvedMode);
        if (!active.disposed) {
          queuePatch({
            activeKind: active.activeKind,
            mode: active.mode,
            webgl2Fallback: active.webgl2Fallback,
            contextLost: active.contextLost,
            sampleCount: tracker.isCleared ? 0 : active.sampleCount,
          });
        }
        needsRender = true;
      }
      tracker.prevMode = nextMode;
    }

    // Step 4: decimation diff (structural equality)
    if (nextDecimation !== tracker.prevDecimation) {
      if (!decimationEqual(nextDecimation, active.decimation)) {
        active.setDecimation(nextDecimation);
        needsRender = true;
      }
      tracker.prevDecimation = nextDecimation;
    }

    // Step 5: scalar revision bump (Path B streaming seam)
    if (nextRevision !== tracker.prevRevision) {
      if (nextRevision !== undefined) {
        if (rawDataProp !== undefined || rawTracesProp !== undefined) {
          tracker.isCleared = false;
        }
        needsRender = true;
      }
      tracker.prevRevision = nextRevision;
    }

    // Flush batched metadata snapshot once per commit (avoids transient intermediate emissions)
    if (pendingPatch !== null) {
      store.update(pendingPatch);
    }

    // Step 6: single coalesced requestRender()
    if (needsRender && !active.disposed) {
      active.requestRender();
    }
  }, [
    nextDecimation,
    nextDomain,
    nextMode,
    nextRevision,
    rawDataProp,
    rawTracesProp,
    store,
  ]);

  // Separate effect for ViewportInteractionController coordination
  const nextInteractive = options?.interactive;
  const nextDragMode = options?.dragMode;
  const nextHomeDomain = options?.homeDomain;

  useEffect(() => {
    const activeController = controllerRef.current;
    if (activeController === null || activeController.disposed) return;

    const resolvedInteractive = nextInteractive ?? true;
    let activeInteraction = interactionRef.current;

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
      const resolvedDragMode: InteractionDragMode = nextDragMode ?? "pan";
      if (resolvedDragMode !== activeInteraction.dragMode) {
        activeInteraction.setDragMode(resolvedDragMode);
      }
      if (
        nextHomeDomain !== undefined &&
        !domainsEqual(nextHomeDomain, activeInteraction.homeDomain)
      ) {
        activeInteraction.setHomeDomain(
          nextHomeDomain.xMin,
          nextHomeDomain.xMax,
          nextHomeDomain.yMin,
          nextHomeDomain.yMax,
        );
      }
    }
  }, [attachInteraction, nextDragMode, nextHomeDomain, nextInteractive]);

  // All 11 stable no-op-guarded imperative methods
  const render = useCallback((): void => {
    const active = controllerRef.current;
    if (active === null || active.disposed) return;
    const tracker = trackerRef.current;
    const opts = latestOptionsRef.current;
    if (
      tracker.lastAppliedData !== undefined ||
      tracker.lastAppliedTraces !== undefined ||
      (opts?.data === undefined && opts?.traces === undefined)
    ) {
      tracker.isCleared = false;
    }
    active.render();
    if (controllerRef.current === active && !active.disposed) {
      syncControllerMetadata(active);
    }
  }, [syncControllerMetadata]);

  const requestRender = useCallback((): void => {
    const active = controllerRef.current;
    if (active === null || active.disposed) return;
    const tracker = trackerRef.current;
    const opts = latestOptionsRef.current;
    if (
      tracker.lastAppliedData !== undefined ||
      tracker.lastAppliedTraces !== undefined ||
      (opts?.data === undefined && opts?.traces === undefined)
    ) {
      tracker.isCleared = false;
    }
    active.requestRender();
  }, []);

  const clear = useCallback((): void => {
    const active = controllerRef.current;
    if (active === null || active.disposed) return;
    active.clear();
    trackerRef.current.isCleared = true;
    store.update({ sampleCount: 0 });
  }, [store]);

  const setDomain = useCallback(
    (xMin: number, xMax: number, yMin: number, yMax: number): void => {
      const active = controllerRef.current;
      if (active === null || active.disposed) return;
      active.setDomain(xMin, xMax, yMin, yMax);
      emitDomainSnapshot(active.domain, "programmatic");
    },
    [emitDomainSnapshot],
  );

  const resize = useCallback((width: number, height: number, dpr?: number): void => {
    const active = controllerRef.current;
    if (active === null || active.disposed) return;
    active.resize(width, height, dpr ?? active.dpr);
  }, []);

  const retryWebGL2 = useCallback((): boolean => {
    const active = controllerRef.current;
    if (active === null || active.disposed) return false;
    const recovered = active.retryWebGL2();
    syncControllerMetadata(active);
    return recovered;
  }, [syncControllerMetadata]);

  const resetDomain = useCallback((): void => {
    const active = interactionRef.current;
    if (active === null || active.disposed) return;
    active.resetDomain();
  }, []);

  const zoomByFactor = useCallback(
    (factorX: number, factorY: number, normX?: number, normY?: number): boolean => {
      const active = interactionRef.current;
      if (active === null || active.disposed) return false;
      return active.zoomByFactor(factorX, factorY, normX, normY);
    },
    [],
  );

  const panByFraction = useCallback((fractionX: number, fractionY: number): boolean => {
    const active = interactionRef.current;
    if (active === null || active.disposed) return false;
    return active.panByFraction(fractionX, fractionY);
  }, []);

  const cancelGesture = useCallback((): void => {
    const active = interactionRef.current;
    if (active === null || active.disposed) return;
    active.cancelGesture();
  }, []);

  return useMemo<UseSpectrumEngineReturn>(
    () => ({
      get controller() {
        return controllerRef.current;
      },
      get interaction() {
        return interactionRef.current;
      },
      controllerRef,
      interactionRef,
      isReady: snapshot.isReady,
      activeKind: snapshot.activeKind,
      mode: snapshot.mode,
      domain: snapshot.domain,
      sampleCount: snapshot.sampleCount,
      contextLost: snapshot.contextLost,
      webgl2Fallback: snapshot.webgl2Fallback,
      gestureState: snapshot.gestureState,
      subscribe: store.subscribe,
      getSnapshot: store.getSnapshot,
      getServerSnapshot: store.getServerSnapshot,
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
    }),
    [
      cancelGesture,
      clear,
      dispose,
      panByFraction,
      render,
      requestRender,
      resetDomain,
      resize,
      retryWebGL2,
      setDomain,
      snapshot,
      store,
      zoomByFactor,
    ],
  );
}
