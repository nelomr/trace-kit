import type {
  DecimationPort,
  DecimationSelection,
  SettlementSink,
  SpectrumDataPayload,
  TraceCollection,
  YAxisRegistration,
} from "@trace-kit/core";
import type { AxisLayout, FigureStyle } from "@trace-kit/renderers";
import type {
  BoxSelectEvent,
  EngineChangeEvent,
  EngineKind,
  EngineSelectionMode,
  GestureStateChangeEvent,
  HysteresisConfig,
  InteractionDragMode,
  InteractionGestureState,
  SpectrumEngineController,
  SpectrumEngineControllerOptions,
  ViewportDomain,
  ViewportInteractionController,
  ViewportInteractionControllerOptions,
  ViewportInvalidationEvent,
  ViewportMutationReason,
  WebGL2ContextLostEvent,
  WebGL2ContextRestoredEvent,
  WebGL2FallbackEvent,
} from "@trace-kit/renderers/controller";
import type { MaybeRefOrGetter, ShallowRef, VNodeChild } from "vue";

/** Grouped injectable platform and test seams forwarded to `createSpectrumEngineController`. */
export type SpectrumEnginePlatformOptions = Pick<
  SpectrumEngineControllerOptions,
  | "createCanvas2DRenderer"
  | "createWebGL2Renderer"
  | "createCanvas"
  | "resizeObserverFactory"
  | "getDevicePixelRatio"
  | "requestAnimationFrame"
  | "cancelAnimationFrame"
>;

/** Mount-time interaction configuration forwarded to `createViewportInteractionController`. */
export type TraceViewportInteractionOptions = Omit<
  ViewportInteractionControllerOptions,
  | "controller"
  | "enabled"
  | "dragMode"
  | "homeDomain"
  | "onDomainChange"
  | "onInvalidate"
  | "onBoxSelect"
  | "onGestureStateChange"
>;

/** Payload emitted by `onReady` / `ready` once the controller attaches to a host element. */
export interface SpectrumEngineReadyEvent {
  readonly controller: SpectrumEngineController;
  readonly interaction: ViewportInteractionController | null;
}

export interface UseSpectrumEngineOptions {
  // Reactive options (shallow-watched, diffed imperatively)
  readonly data?: MaybeRefOrGetter<SpectrumDataPayload | null | undefined>;
  /**
   * Multi-trace collection. Updating `traces` without a concurrent `domain` reference change
   * lets `controller.setTraces()` adopt the collection's X bounds and sync `handle.domain`
   * without emitting `onDomainChange`; pass a fresh `domain` object in the same flush to keep
   * a pinned viewport across trace updates.
   */
  readonly traces?: MaybeRefOrGetter<TraceCollection | null | undefined>;
  readonly revision?: MaybeRefOrGetter<number | undefined>;
  readonly domain?: MaybeRefOrGetter<ViewportDomain | undefined>;
  readonly mode?: MaybeRefOrGetter<EngineSelectionMode | undefined>;
  readonly decimation?: MaybeRefOrGetter<DecimationSelection | undefined>;
  readonly interactive?: MaybeRefOrGetter<boolean | undefined>;
  readonly dragMode?: MaybeRefOrGetter<InteractionDragMode | undefined>;
  readonly homeDomain?: MaybeRefOrGetter<ViewportDomain | undefined>;

  // Mount-time (immutable) engine options
  readonly figureStyle?: Partial<FigureStyle>;
  readonly axes?: Partial<AxisLayout>;
  readonly yAxes?: readonly YAxisRegistration[];
  readonly hysteresis?: HysteresisConfig;
  readonly decimationPort?: DecimationPort;
  readonly settlementSink?: SettlementSink;
  readonly autoResize?: boolean;
  readonly initialWidth?: number;
  readonly initialHeight?: number;
  readonly initialDpr?: number;
  readonly interactionOptions?: TraceViewportInteractionOptions;
  readonly platform?: SpectrumEnginePlatformOptions;

  // Event callbacks
  readonly onReady?: (event: SpectrumEngineReadyEvent) => void;
  readonly onDomainChange?: (domain: ViewportDomain, reason: ViewportMutationReason) => void;
  readonly onInvalidate?: (event: ViewportInvalidationEvent) => void;
  readonly onBoxSelect?: (event: BoxSelectEvent) => void;
  readonly onGestureStateChange?: (event: GestureStateChangeEvent) => void;
  readonly onEngineChange?: (event: EngineChangeEvent) => void;
  readonly onWebGL2Fallback?: (event: WebGL2FallbackEvent) => void;
  readonly onContextLost?: (event: WebGL2ContextLostEvent) => void;
  readonly onContextRestored?: (event: WebGL2ContextRestoredEvent) => void;
}

export interface SpectrumEngineHandle {
  // Non-reactive raw controller refs (instances tagged with markRaw)
  readonly controller: Readonly<ShallowRef<SpectrumEngineController | null>>;
  readonly interaction: Readonly<ShallowRef<ViewportInteractionController | null>>;

  // Readonly shallow reactive state refs
  readonly isReady: Readonly<ShallowRef<boolean>>;
  readonly activeKind: Readonly<ShallowRef<EngineKind>>;
  readonly mode: Readonly<ShallowRef<EngineSelectionMode>>;
  readonly domain: Readonly<ShallowRef<ViewportDomain>>;
  readonly sampleCount: Readonly<ShallowRef<number>>;
  readonly contextLost: Readonly<ShallowRef<boolean>>;
  readonly webgl2Fallback: Readonly<ShallowRef<boolean>>;
  readonly gestureState: Readonly<ShallowRef<InteractionGestureState>>;

  // Safe no-op-guarded imperative methods
  render(): void;
  requestRender(): void;
  clear(): void;
  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void;
  resize(width: number, height: number, dpr?: number): void;
  retryWebGL2(): boolean;
  resetDomain(): void;
  zoomByFactor(factorX: number, factorY: number, normX?: number, normY?: number): boolean;
  panByFraction(fractionX: number, fractionY: number): boolean;
  cancelGesture(): void;
  dispose(): void;
}

export type UseSpectrumEngineReturn = SpectrumEngineHandle;

export interface TraceSpectrumViewerProps {
  readonly data?: SpectrumDataPayload | null | undefined;
  /**
   * Multi-trace collection. Updating `:traces` without changing `:domain` lets
   * `controller.setTraces()` adopt the collection's X bounds and sync `handle.domain`
   * without emitting `update:domain`; pass a fresh `:domain` reference in the same flush
   * to keep a pinned viewport across trace updates.
   */
  readonly traces?: TraceCollection | null | undefined;
  readonly revision?: number | undefined;
  readonly domain?: ViewportDomain | undefined;
  readonly mode?: EngineSelectionMode | undefined;
  readonly decimation?: DecimationSelection | undefined;
  readonly interactive?: boolean | undefined;
  readonly dragMode?: InteractionDragMode | undefined;
  readonly homeDomain?: ViewportDomain | undefined;
  readonly figureStyle?: Partial<FigureStyle> | undefined;
  readonly axes?: Partial<AxisLayout> | undefined;
  readonly yAxes?: readonly YAxisRegistration[] | undefined;
  readonly hysteresis?: HysteresisConfig | undefined;
  readonly decimationPort?: DecimationPort | undefined;
  readonly settlementSink?: SettlementSink | undefined;
  readonly autoResize?: boolean | undefined;
  readonly initialWidth?: number | undefined;
  readonly initialHeight?: number | undefined;
  readonly initialDpr?: number | undefined;
  readonly interactionOptions?: TraceViewportInteractionOptions | undefined;
  readonly platform?: SpectrumEnginePlatformOptions | undefined;
}

export interface TraceSpectrumViewerEmits {
  readonly ready: [event: SpectrumEngineReadyEvent];
  readonly "update:domain": [domain: ViewportDomain];
  readonly domainChange: [domain: ViewportDomain, reason: ViewportMutationReason];
  readonly invalidate: [event: ViewportInvalidationEvent];
  readonly boxSelect: [event: BoxSelectEvent];
  readonly gestureStateChange: [event: GestureStateChangeEvent];
  readonly engineChange: [event: EngineChangeEvent];
  readonly webgl2Fallback: [event: WebGL2FallbackEvent];
  readonly contextLost: [event: WebGL2ContextLostEvent];
  readonly contextRestored: [event: WebGL2ContextRestoredEvent];
}

export interface TraceSpectrumViewerSlotProps {
  readonly isReady: boolean;
  readonly activeKind: EngineKind;
  readonly mode: EngineSelectionMode;
  readonly domain: ViewportDomain;
  readonly sampleCount: number;
  readonly contextLost: boolean;
  readonly webgl2Fallback: boolean;
  readonly gestureState: InteractionGestureState;
}

export interface TraceSpectrumViewerSlots {
  readonly overlay?: (props: TraceSpectrumViewerSlotProps) => VNodeChild;
  readonly default?: (props: TraceSpectrumViewerSlotProps) => VNodeChild;
}
