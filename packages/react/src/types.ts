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
import type { CSSProperties, ReactNode, RefObject } from "react";

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

/** Payload delivered to `onReady` once the controller attaches to a host element. */
export interface SpectrumEngineReadyEvent {
  readonly controller: SpectrumEngineController;
  readonly interaction: ViewportInteractionController | null;
}

/** Frozen discrete metadata snapshot exposed via `useSyncExternalStore`. */
export interface SpectrumEngineSnapshot {
  readonly isReady: boolean;
  readonly activeKind: EngineKind;
  readonly mode: EngineSelectionMode;
  readonly domain: ViewportDomain;
  readonly sampleCount: number;
  readonly contextLost: boolean;
  readonly webgl2Fallback: boolean;
  readonly gestureState: InteractionGestureState;
}

export interface UseSpectrumEngineOptions {
  // Synchronized reactive props (shallow-diffed imperatively in single commit order)
  readonly data?: SpectrumDataPayload | null | undefined;
  readonly traces?: TraceCollection | null | undefined;
  readonly revision?: number | undefined;
  readonly domain?: ViewportDomain | undefined;
  readonly mode?: EngineSelectionMode | undefined;
  readonly decimation?: DecimationSelection | undefined;
  readonly interactive?: boolean | undefined;
  readonly dragMode?: InteractionDragMode | undefined;
  readonly homeDomain?: ViewportDomain | undefined;

  // Mount-time (immutable) engine options
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

  /**
   * When `false`, disables metadata re-render subscriptions in the calling component while
   * keeping `subscribe` / `getSnapshot` live for isolated child overlays. Default: `true`.
   */
  readonly subscribeState?: boolean | undefined;

  // Event callbacks (always invoked via latest-callback ref — never tear down the controller)
  readonly onReady?: ((event: SpectrumEngineReadyEvent) => void) | undefined;
  readonly onDomainChange?:
    | ((domain: ViewportDomain, reason: ViewportMutationReason) => void)
    | undefined;
  readonly onInvalidate?: ((event: ViewportInvalidationEvent) => void) | undefined;
  readonly onBoxSelect?: ((event: BoxSelectEvent) => void) | undefined;
  readonly onGestureStateChange?: ((event: GestureStateChangeEvent) => void) | undefined;
  readonly onEngineChange?: ((event: EngineChangeEvent) => void) | undefined;
  readonly onWebGL2Fallback?: ((event: WebGL2FallbackEvent) => void) | undefined;
  readonly onContextLost?: ((event: WebGL2ContextLostEvent) => void) | undefined;
  readonly onContextRestored?: ((event: WebGL2ContextRestoredEvent) => void) | undefined;
}

/** Imperative ref handle exposed by `TraceSpectrumViewer` via `forwardRef` / `useImperativeHandle`. */
export interface SpectrumEngineHandle {
  /** Live active `SpectrumEngineController` instance, or `null` prior to mount / after dispose. */
  readonly controller: SpectrumEngineController | null;
  /** Live active `ViewportInteractionController` instance, or `null` when detached/disabled. */
  readonly interaction: ViewportInteractionController | null;

  // 11 no-op-guarded imperative methods matching `@trace-kit/vue` 1:1 (arrow-typed for safe destructuring)
  readonly render: () => void;
  readonly requestRender: () => void;
  readonly clear: () => void;
  readonly setDomain: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  readonly resize: (width: number, height: number, dpr?: number) => void;
  readonly retryWebGL2: () => boolean;
  readonly resetDomain: () => void;
  readonly zoomByFactor: (
    factorX: number,
    factorY: number,
    normX?: number,
    normY?: number,
  ) => boolean;
  readonly panByFraction: (fractionX: number, fractionY: number) => boolean;
  readonly cancelGesture: () => void;
  readonly dispose: () => void;
}

/** Full return shape of `useSpectrumEngine`. */
export interface UseSpectrumEngineReturn extends SpectrumEngineSnapshot, SpectrumEngineHandle {
  readonly controllerRef: RefObject<SpectrumEngineController | null>;
  readonly interactionRef: RefObject<ViewportInteractionController | null>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SpectrumEngineSnapshot;
  readonly getServerSnapshot: () => SpectrumEngineSnapshot;
}

/** Props accepted by `<TraceSpectrumViewer />`. */
export interface TraceSpectrumViewerProps extends Omit<UseSpectrumEngineOptions, "subscribeState"> {
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly id?: string | undefined;
  /**
   * Optional overlay render prop mounted inside an isolated sibling `[data-trace-kit-slot-overlay]`.
   * Subscribes independently via `useSyncExternalStore` so rapid pan/zoom updates never re-render
   * `TraceSpectrumViewer` or reconcile `[data-trace-kit-surface]`.
   */
  readonly renderOverlay?: ((snapshot: SpectrumEngineSnapshot) => ReactNode) | undefined;
  readonly children?: ReactNode;
}
