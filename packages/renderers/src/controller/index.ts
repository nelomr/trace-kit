export { createSpectrumEngineController } from "./engine-controller.js";
export {
  DEFAULT_HYSTERESIS_CONFIG,
  classifyHysteresisBand,
  computePayloadSampleCount,
  computeTracesSampleCount,
  evaluateHysteresisTarget,
  resolveHysteresisConfig,
} from "./hysteresis.js";
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
