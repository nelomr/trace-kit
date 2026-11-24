import type { ViewportDomainConstraints } from "@trace-kit/core";
import type { SpectrumEngineController, ViewportDomain } from "./types.js";

/** Default primary pointer drag mode inside the plot area. */
export type InteractionDragMode = "pan" | "box-zoom";

/** Default wheel zoom axis inside the plot area when no modifier key is held. */
export type WheelZoomAxis = "xy" | "x" | "y";

/** Disjoint hit-test region of a device-pixel coordinate relative to the plot rectangle. */
export type PointerRegion = "plot" | "x-gutter" | "y-gutter" | "outside";

/** Explicit 5-state machine for box-zoom selection (shared seam for range selection). */
export type BoxZoomState = "idle" | "pending" | "active" | "committed" | "cancelled";

/** Active gesture state of a `ViewportInteractionController`. */
export type InteractionGestureState =
  | "idle"
  | "panning"
  | "pinching"
  | "wheeling"
  | "box-pending"
  | "box-active";

/** Two-phase invalidation lifecycle reported to `onInvalidate`. */
export type ViewportInvalidationPhase = "gesture" | "settled";

/** Semantic cause of a viewport domain mutation or invalidation event. */
export type ViewportMutationReason =
  | "pan"
  | "pan-end"
  | "wheel"
  | "wheel-settle"
  | "pinch"
  | "pinch-end"
  | "box-zoom"
  | "reset"
  | "programmatic";

/** Event delivered to `onInvalidate` during coalesced gesture previews and settled commits. */
export interface ViewportInvalidationEvent {
  readonly phase: ViewportInvalidationPhase;
  readonly domain: ViewportDomain;
  readonly seq: number;
  readonly reason: ViewportMutationReason;
}

/** Event delivered to `onBoxSelect` when a box-zoom selection commits a valid domain. */
export interface BoxSelectEvent {
  readonly domain: ViewportDomain;
  readonly startDeviceX: number;
  readonly startDeviceY: number;
  readonly endDeviceX: number;
  readonly endDeviceY: number;
}

/** Event delivered to `onGestureStateChange` on every gesture or box-zoom state transition. */
export interface GestureStateChangeEvent {
  readonly previousState: InteractionGestureState;
  readonly state: InteractionGestureState;
  readonly boxState: BoxZoomState;
  readonly region: PointerRegion;
}

/** Configuration options for `createViewportInteractionController`. */
export interface ViewportInteractionControllerOptions {
  readonly controller: SpectrumEngineController;
  /** Default primary drag behavior inside the plot area. Default: `"pan"`. */
  readonly dragMode?: InteractionDragMode;
  /** Default wheel zoom axis inside the plot area when no modifier is held. Default: `"xy"`. */
  readonly wheelAxis?: WheelZoomAxis;
  /** Exponential wheel sensitivity (`factor = exp(deltaPx * sensitivity)`). Default: `0.001`. */
  readonly wheelSensitivity?: number;
  /** Exponential trackpad pinch sensitivity (`ctrlKey === true`). Default: `wheelSensitivity * 4`. */
  readonly pinchSensitivity?: number;
  /** Enable single-axis drag and wheel interaction in X/Y axis gutters. Default: `true`. */
  readonly gutterInteraction?: boolean;
  /** Restore `homeDomain` on double-click inside `"plot"`. Default: `true`. */
  readonly doubleClickReset?: boolean;
  /** Minimum CSS drag distance to promote box-zoom from `"pending"` to `"active"`. Default: `4`. */
  readonly minBoxSizeCss?: number;
  /** Wheel-burst trailing settle debounce duration in milliseconds. Default: `120`. */
  readonly settleDebounceMs?: number;
  /** Save container inline `touch-action`, set `"none"` while attached, restore on `dispose()`. Default: `true`. */
  readonly manageTouchAction?: boolean;
  /** Initial enabled state. Default: `true`. */
  readonly enabled?: boolean;
  /** Optional domain bounds and span clamping constraints. */
  readonly constraints?: ViewportDomainConstraints;
  /** Explicit home domain restored by `resetDomain()` / `dblclick`. Defaults to `controller.domain` at attach. */
  readonly homeDomain?: ViewportDomain;
  readonly onDomainChange?: (domain: ViewportDomain, reason: ViewportMutationReason) => void;
  readonly onInvalidate?: (event: ViewportInvalidationEvent) => void;
  readonly onBoxSelect?: (event: BoxSelectEvent) => void;
  readonly onGestureStateChange?: (event: GestureStateChangeEvent) => void;

  // Injectable test and platform seams:
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly setTimeout?: (callback: () => void, ms: number) => number;
  readonly clearTimeout?: (handle: number) => void;
}

/**
 * Framework-agnostic DOM viewport interaction controller composing over
 * `SpectrumEngineController` for drag-pan, cursor-anchored wheel zoom, 2-pointer pinch,
 * 5-state CSS-composited box-zoom, frame-budget-debounced invalidation, and programmatic control.
 */
export interface ViewportInteractionController {
  readonly state: InteractionGestureState;
  readonly dragMode: InteractionDragMode;
  readonly enabled: boolean;
  readonly disposed: boolean;
  readonly homeDomain: ViewportDomain;

  zoomByFactor(factorX: number, factorY: number, normX?: number, normY?: number): boolean;
  panByFraction(fractionX: number, fractionY: number): boolean;
  commitBoxDomain(xMin: number, xMax: number, yMin: number, yMax: number): boolean;
  resetDomain(): void;
  setHomeDomain(xMin: number, xMax: number, yMin: number, yMax: number): void;
  setDragMode(mode: InteractionDragMode): void;
  setEnabled(enabled: boolean): void;
  cancelGesture(): void;
  dispose(): void;
}
