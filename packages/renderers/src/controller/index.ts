export { createSpectrumEngineController } from "./engine-controller.js";
export {
  DEFAULT_HYSTERESIS_CONFIG,
  classifyHysteresisBand,
  computePayloadSampleCount,
  computeTracesSampleCount,
  evaluateHysteresisTarget,
  resolveHysteresisConfig,
} from "./hysteresis.js";
export {
  DEFAULT_MIN_BOX_SIZE_CSS,
  DEFAULT_SETTLE_DEBOUNCE_MS,
  DEFAULT_WHEEL_LINE_HEIGHT_PX,
  DEFAULT_WHEEL_PAGE_FALLBACK_PX,
  DEFAULT_WHEEL_SENSITIVITY,
  MAX_WHEEL_DELTA_PX,
  classifyPointerRegion,
  normalizeWheelDeltaPx,
  resolveWheelAxisMask,
} from "./input-normalizer.js";
export { createViewportInteractionController } from "./viewport-interaction-controller.js";
export type {
  EngineKind,
  EngineSelectionMode,
  HysteresisBand,
  HysteresisConfig,
  HysteresisEvaluationInput,
  HysteresisEvaluationResult,
  ResolvedHysteresisConfig,
} from "./hysteresis.js";
export type {
  BoxSelectEvent,
  BoxZoomState,
  GestureStateChangeEvent,
  InteractionDragMode,
  InteractionGestureState,
  PointerRegion,
  ViewportInteractionController,
  ViewportInteractionControllerOptions,
  ViewportInvalidationEvent,
  ViewportInvalidationPhase,
  ViewportMutationReason,
  WheelZoomAxis,
} from "./interaction-types.js";
export type {
  EngineChangeEvent,
  EngineChangeReason,
  ResizeObserverCallbackLike,
  ResizeObserverEntryLike,
  ResizeObserverLike,
  SpectrumEngineController,
  SpectrumEngineControllerOptions,
  ViewportDomain,
  WebGL2FallbackEvent,
} from "./types.js";
