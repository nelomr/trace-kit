import type { SpectrumDataPayload, TraceCollection } from "@trace-kit/core";
import type { FigureRendererKind } from "../figure-renderer.js";

/** Discriminant identifying an underlying figure rendering backend. */
export type EngineKind = FigureRendererKind;

/** Engine selection strategy for `SpectrumEngineController`. */
export type EngineSelectionMode = "auto" | "canvas2d" | "webgl2";

/** Disjoint sample-count band relative to `downThreshold` and `upThreshold`. */
export type HysteresisBand = "below-down" | "deadband" | "above-up";

export interface HysteresisConfig {
  /** Sample count N at or above which "auto" mode switches Canvas2D -> WebGL2. Default: 80_000. */
  readonly upThreshold?: number;
  /** Sample count N at or below which "auto" mode switches WebGL2 -> Canvas2D. Default: 64_000. */
  readonly downThreshold?: number;
}

export interface ResolvedHysteresisConfig {
  readonly upThreshold: number;
  readonly downThreshold: number;
}

export const DEFAULT_HYSTERESIS_CONFIG: ResolvedHysteresisConfig = Object.freeze({
  upThreshold: 80_000,
  downThreshold: 64_000,
});

export interface HysteresisEvaluationInput {
  readonly mode: EngineSelectionMode;
  readonly activeKind: EngineKind;
  readonly sampleCount: number;
  readonly config: ResolvedHysteresisConfig;
  readonly gestureActive: boolean;
  readonly webgl2Fallback: boolean;
}

export interface HysteresisEvaluationResult {
  /** The engine that should be active right now after applying gesture deferral and fallback latches. */
  readonly targetKind: EngineKind;
  /** The engine desired by mode, thresholds, and fallback state before gesture deferral. */
  readonly desiredKind: EngineKind;
  /** Non-null when an eligible switch is deferred because `gestureActive === true`. */
  readonly pendingKind: EngineKind | null;
  /** True when `targetKind !== activeKind` and the caller should execute an engine swap now. */
  readonly shouldSwitch: boolean;
  /** Position of `sampleCount` relative to `downThreshold` and `upThreshold`. */
  readonly band: HysteresisBand;
}

/**
 * Validates and resolves optional hysteresis thresholds into a frozen config.
 * Enforces strict `0 < downThreshold < upThreshold` with finite positive integers so
 * the three bands are pairwise disjoint and boundary thrashing is impossible.
 */
export function resolveHysteresisConfig(config?: HysteresisConfig): ResolvedHysteresisConfig {
  const upThreshold = config?.upThreshold ?? DEFAULT_HYSTERESIS_CONFIG.upThreshold;
  const downThreshold = config?.downThreshold ?? DEFAULT_HYSTERESIS_CONFIG.downThreshold;

  if (
    !Number.isFinite(upThreshold) ||
    !Number.isFinite(downThreshold) ||
    !Number.isInteger(upThreshold) ||
    !Number.isInteger(downThreshold) ||
    downThreshold <= 0 ||
    upThreshold <= 0 ||
    downThreshold >= upThreshold
  ) {
    throw new RangeError(
      `Invalid hysteresis thresholds (downThreshold=${downThreshold}, upThreshold=${upThreshold}): both must be finite positive integers with 0 < downThreshold < upThreshold.`,
    );
  }

  return Object.freeze({ upThreshold, downThreshold });
}

/** Classifies a sample count into one of three strictly disjoint bands. */
export function classifyHysteresisBand(
  sampleCount: number,
  config: ResolvedHysteresisConfig,
): HysteresisBand {
  if (sampleCount <= config.downThreshold) return "below-down";
  if (sampleCount >= config.upThreshold) return "above-up";
  return "deadband";
}

/** Returns the non-negative integer sample count of a single payload (0 when null). */
export function computePayloadSampleCount(payload: SpectrumDataPayload | null): number {
  if (payload === null) return 0;
  const count = payload.sampleCount | 0;
  return count > 0 ? count : 0;
}

/** Sums the non-negative integer sample counts across all entries in a trace collection. */
export function computeTracesSampleCount(collection: TraceCollection | null): number {
  if (collection === null) return 0;
  const entries = collection.entries;
  let total = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const count = entry.payload.sampleCount | 0;
    if (count > 0) total += count;
  }
  return total;
}

/**
 * Zero-allocation scalar helper computing the desired engine kind before gesture deferral.
 * Used internally by `SpectrumEngineControllerImpl` on its render path and by
 * `evaluateHysteresisTarget`.
 */
export function resolveDesiredEngine(
  mode: EngineSelectionMode,
  activeKind: EngineKind,
  sampleCount: number,
  downThreshold: number,
  upThreshold: number,
  webgl2Fallback: boolean,
): EngineKind {
  if (mode === "canvas2d" || webgl2Fallback) return "canvas2d";
  if (mode === "webgl2") return "webgl2";
  if (activeKind === "canvas2d" && sampleCount >= upThreshold) return "webgl2";
  if (activeKind === "webgl2" && sampleCount <= downThreshold) return "canvas2d";
  return activeKind;
}

/** Pure hysteresis state-machine evaluation for external callers and policy unit tests. */
export function evaluateHysteresisTarget(
  input: HysteresisEvaluationInput,
): HysteresisEvaluationResult {
  const band = classifyHysteresisBand(input.sampleCount, input.config);
  const desiredKind = resolveDesiredEngine(
    input.mode,
    input.activeKind,
    input.sampleCount,
    input.config.downThreshold,
    input.config.upThreshold,
    input.webgl2Fallback,
  );

  if (input.gestureActive && desiredKind !== input.activeKind) {
    return {
      targetKind: input.activeKind,
      desiredKind,
      pendingKind: desiredKind,
      shouldSwitch: false,
      band,
    };
  }

  return {
    targetKind: desiredKind,
    desiredKind,
    pendingKind: null,
    shouldSwitch: desiredKind !== input.activeKind,
    band,
  };
}
