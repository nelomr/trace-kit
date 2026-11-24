import type {
  ViewportInvalidationEvent,
  ViewportMutationReason,
} from "./interaction-types.js";
import type { ViewportDomain } from "./types.js";

function defaultRequestAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return Number(globalThis.setTimeout(() => callback(Date.now()), 16));
}

function defaultCancelAnimationFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

function defaultSetTimeout(callback: () => void, ms: number): number {
  return Number(globalThis.setTimeout(callback, ms));
}

function defaultClearTimeout(handle: number): void {
  globalThis.clearTimeout(handle);
}

export function snapshotDomain(domain: ViewportDomain): ViewportDomain {
  return {
    xMin: domain.xMin,
    xMax: domain.xMax,
    yMin: domain.yMin,
    yMax: domain.yMax,
  };
}

export interface InvalidationSchedulerOptions {
  readonly onInvalidate?: (event: ViewportInvalidationEvent) => void;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly setTimeout?: (callback: () => void, ms: number) => number;
  readonly clearTimeout?: (handle: number) => void;
}

/**
 * Two-phase frame-budget-debounced invalidation scheduler coordinating rAF-coalesced gesture
 * previews (`phase: "gesture"`) and trailing settled commits (`phase: "settled"`) with a
 * strictly monotonic positive integer `seq`.
 */
export class InvalidationScheduler {
  readonly #onInvalidate: ((event: ViewportInvalidationEvent) => void) | undefined;
  readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelAnimationFrame: (handle: number) => void;
  readonly #setTimeout: (callback: () => void, ms: number) => number;
  readonly #clearTimeout: (handle: number) => void;

  #seq = 0;
  #rafHandle: number | null = null;
  #settleTimerHandle: number | null = null;
  #pendingFrameCallback: (() => void) | null = null;
  #pendingSettleCallback: (() => void) | null = null;
  #disposed = false;

  readonly #handleFrame: FrameRequestCallback = () => {
    this.#rafHandle = null;
    if (this.#disposed) return;
    const cb = this.#pendingFrameCallback;
    this.#pendingFrameCallback = null;
    cb?.();
  };

  readonly #handleSettleTimer = (): void => {
    this.#settleTimerHandle = null;
    if (this.#disposed) return;
    const cb = this.#pendingSettleCallback;
    this.#pendingSettleCallback = null;
    cb?.();
  };

  constructor(options: InvalidationSchedulerOptions) {
    this.#onInvalidate = options.onInvalidate;
    this.#requestAnimationFrame = options.requestAnimationFrame ?? defaultRequestAnimationFrame;
    this.#cancelAnimationFrame = options.cancelAnimationFrame ?? defaultCancelAnimationFrame;
    this.#setTimeout = options.setTimeout ?? defaultSetTimeout;
    this.#clearTimeout = options.clearTimeout ?? defaultClearTimeout;
  }

  emitGesture(domain: ViewportDomain, reason: ViewportMutationReason): void {
    if (this.#disposed) return;
    this.#seq += 1;
    const cb = this.#onInvalidate;
    if (cb !== undefined) {
      cb({
        phase: "gesture",
        domain: snapshotDomain(domain),
        seq: this.#seq,
        reason,
      });
    }
  }

  emitSettled(domain: ViewportDomain, reason: ViewportMutationReason): void {
    if (this.#disposed) return;
    this.cancelWheelSettle();
    this.#seq += 1;
    const cb = this.#onInvalidate;
    if (cb !== undefined) {
      cb({
        phase: "settled",
        domain: snapshotDomain(domain),
        seq: this.#seq,
        reason,
      });
    }
  }

  scheduleFrame(callback: () => void): void {
    if (this.#disposed) return;
    this.#pendingFrameCallback = callback;
    if (this.#rafHandle !== null) return;
    this.#rafHandle = this.#requestAnimationFrame(this.#handleFrame);
  }

  cancelFrame(): void {
    this.#pendingFrameCallback = null;
    if (this.#rafHandle !== null) {
      const handle = this.#rafHandle;
      this.#rafHandle = null;
      this.#cancelAnimationFrame(handle);
    }
  }

  armWheelSettle(debounceMs: number, onExpire: () => void): void {
    if (this.#disposed) return;
    this.cancelWheelSettle();
    this.#pendingSettleCallback = onExpire;
    this.#settleTimerHandle = this.#setTimeout(this.#handleSettleTimer, debounceMs);
  }

  cancelWheelSettle(): void {
    this.#pendingSettleCallback = null;
    if (this.#settleTimerHandle !== null) {
      const handle = this.#settleTimerHandle;
      this.#settleTimerHandle = null;
      this.#clearTimeout(handle);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancelFrame();
    this.cancelWheelSettle();
  }
}
