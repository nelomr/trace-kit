import type {
  DecimationPort,
  DecimationSelection,
  SettlementSink,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
  YAxisRegistration,
} from "@trace-kit/core";
import type { Canvas2DRendererOptions } from "../canvas2d/canvas2d-renderer.js";
import type { FigureRenderer } from "../figure-renderer.js";
import type { AxisLayout, FigureStyle } from "../style.js";
import type { WebGL2FigureRendererOptions } from "../webgl2/webgl2-figure-renderer.js";
import type {
  EngineKind,
  EngineSelectionMode,
  HysteresisConfig,
  ResolvedHysteresisConfig,
} from "./hysteresis.js";

/** Authoritative visible data domain held by `SpectrumEngineController`. */
export interface ViewportDomain {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** Reason why the active engine initialized or transitioned. */
export type EngineChangeReason =
  | "init"
  | "hysteresis-up"
  | "hysteresis-down"
  | "mode-change"
  | "gesture-end"
  | "webgl2-fallback"
  | "webgl2-retry";

/** Event delivered to `onEngineChange` whenever the active engine mounts or switches. */
export interface EngineChangeEvent {
  readonly previousKind: EngineKind | null;
  readonly activeKind: EngineKind;
  readonly sampleCount: number;
  readonly mode: EngineSelectionMode;
  readonly reason: EngineChangeReason;
}

/** Event delivered to `onWebGL2Fallback` after fallback Canvas2D is mounted and active. */
export interface WebGL2FallbackEvent {
  readonly error: unknown;
  readonly attemptedMode: EngineSelectionMode;
  readonly sampleCount: number;
}

/** Minimal `ResizeObserverEntry` shape accepted by injectable observer seams. */
export interface ResizeObserverEntryLike {
  readonly contentRect: {
    readonly width: number;
    readonly height: number;
  };
}

/** Callback signature invoked by a `ResizeObserverLike` implementation. */
export type ResizeObserverCallbackLike = (entries: readonly ResizeObserverEntryLike[]) => void;

/** Minimal `ResizeObserver` surface used by `SpectrumEngineController`. */
export interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export interface SpectrumEngineControllerOptions {
  /** Stable outer host element into which the controller mounts and swaps managed `<canvas>` elements. */
  readonly container: HTMLElement;
  /** Engine selection mode. Default: `"auto"`. */
  readonly mode?: EngineSelectionMode;
  /** Hysteresis thresholds for `"auto"` mode. Default: `{ upThreshold: 80_000, downThreshold: 64_000 }`. */
  readonly hysteresis?: HysteresisConfig;
  /** Shared figure style forwarded to active renderers. */
  readonly style?: Partial<FigureStyle>;
  /** Shared axis layout forwarded to active renderers. */
  readonly axes?: Partial<AxisLayout>;
  /** Explicit left-stacked Y axis registrations forwarded to active renderers. */
  readonly yAxes?: readonly YAxisRegistration[];
  /** Initial decimation intent. `undefined` preserves each backend's native default across swaps. */
  readonly decimation?: DecimationSelection;
  /** Optional `DecimationPort` drained via `port.poll(settlementSink)` on each render pass. Requires `settlementSink`. */
  readonly decimationPort?: DecimationPort;
  /** Required whenever `decimationPort` is provided; receives settled leases during `render()`. */
  readonly settlementSink?: SettlementSink;
  /** Observe `container` via `ResizeObserver` and coalesce resizes through `requestRender()`. Default: `true`. */
  readonly autoResize?: boolean;
  /** Initial CSS width in pixels (must be finite and > 0 if provided). Default: container width or `800`. */
  readonly initialWidth?: number;
  /** Initial CSS height in pixels (must be finite and > 0 if provided). Default: container height or `400`. */
  readonly initialHeight?: number;
  /** Initial device pixel ratio (must be finite and > 0 if provided). Default: `getDevicePixelRatio()` or `1`. */
  readonly initialDpr?: number;
  /** Callback invoked whenever the active engine initializes or switches. */
  readonly onEngineChange?: (event: EngineChangeEvent) => void;
  /** Callback invoked after Canvas2D fallback is mounted when WebGL2 creation, replay, or pre-render throws. */
  readonly onWebGL2Fallback?: (event: WebGL2FallbackEvent) => void;

  // Injectable test and platform seams:
  readonly createCanvas2DRenderer?: (options: Canvas2DRendererOptions) => FigureRenderer;
  readonly createWebGL2Renderer?: (options: WebGL2FigureRendererOptions) => FigureRenderer;
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly resizeObserverFactory?: (callback: ResizeObserverCallbackLike) => ResizeObserverLike;
  readonly getDevicePixelRatio?: () => number;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
}

/**
 * Framework-agnostic dual-engine orchestrator owning a stable outer host `container`,
 * zero-flicker 1-canvas <-> 3-canvas atomic DOM swaps, authoritative state replay,
 * hysteresis switching, mid-gesture deferral, and deterministic WebGL2 fallback.
 */
export interface SpectrumEngineController {
  readonly activeKind: EngineKind;
  readonly mode: EngineSelectionMode;
  readonly hysteresis: ResolvedHysteresisConfig;
  readonly pendingKind: EngineKind | null;
  readonly gestureActive: boolean;
  readonly webgl2Fallback: boolean;
  readonly sampleCount: number;
  readonly disposed: boolean;
  readonly container: HTMLElement;
  /** Currently mounted `<canvas>` elements inside `container` (1 for Canvas2D, 3 for WebGL2, 0 after dispose). */
  readonly canvases: readonly HTMLCanvasElement[];
  /** Active renderer's `ViewportTransform` (device-pixel extents: `deviceWidth`, `deviceHeight`, `plotWidth`, `plotHeight`). */
  readonly transform: ViewportTransform;
  /** Authoritative visible domain (seeded from `yAxes[0]` or `[-1, 1]`, updated by `setDomain` and `setTraces`). */
  readonly domain: ViewportDomain;
  readonly decimation: DecimationSelection | undefined;
  /** Current CSS width in pixels. */
  readonly width: number;
  /** Current CSS height in pixels. */
  readonly height: number;
  /** Current device pixel ratio. */
  readonly dpr: number;

  setData(payload: SpectrumDataPayload): void;
  setTraces(collection: TraceCollection): void;
  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void;
  resize(width: number, height: number, dpr: number): void;
  setDecimation(selection: DecimationSelection | undefined): void;
  setMode(mode: EngineSelectionMode): void;
  setGestureActive(active: boolean): void;
  /** Clears `webgl2Fallback` latch, syncs revisions, and attempts WebGL2 if eligible and not mid-gesture; returns `activeKind === "webgl2"`. */
  retryWebGL2(): boolean;
  /** Synchronous frame execution: polls optional `DecimationPort`, syncs revisions, evaluates hysteresis if dirty, swaps if needed, and renders. */
  render(): void;
  /** Schedules at most one coalesced `requestAnimationFrame` callback to invoke `render()`. */
  requestRender(): void;
  /** Clears the active renderer's backing store(s). */
  clear(): void;
  /** Terminal, idempotent teardown. */
  dispose(): void;
}
