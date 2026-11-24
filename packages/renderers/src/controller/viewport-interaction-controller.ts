import {
  AXIS_MASK_NONE,
  AXIS_MASK_X,
  AXIS_MASK_XY,
  AXIS_MASK_Y,
  capturePanGestureSnapshot,
  clampViewportDomain,
  computeBoxZoomDomain,
  computePanDomain,
  computeZoomDomain,
  createMutableViewportDomain,
  createPanGestureSnapshot,
  type AxisMask,
  type MutableViewportDomain,
  type PanGestureSnapshot,
  type ViewportDomainConstraints,
  type ViewportTransform,
} from "@trace-kit/core";
import { BoxZoomOverlay } from "./box-zoom-overlay.js";
import {
  DEFAULT_MIN_BOX_SIZE_CSS,
  DEFAULT_SETTLE_DEBOUNCE_MS,
  DEFAULT_WHEEL_SENSITIVITY,
  classifyPointerRegion,
  mapCssToDeviceX,
  mapCssToDeviceY,
  mapDeviceToCssX,
  mapDeviceToCssY,
  normalizeWheelDeltaPx,
  resolveWheelAxisMask,
} from "./input-normalizer.js";
import type {
  BoxSelectEvent,
  BoxZoomState,
  GestureStateChangeEvent,
  InteractionDragMode,
  InteractionGestureState,
  PointerRegion,
  ViewportInteractionController,
  ViewportInteractionControllerOptions,
  ViewportMutationReason,
  WheelZoomAxis,
} from "./interaction-types.js";
import { InvalidationScheduler, snapshotDomain } from "./invalidation-scheduler.js";
import type { SpectrumEngineController, ViewportDomain } from "./types.js";

function assertPositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `ViewportInteractionController: ${name} must be a finite number > 0 (received ${value}).`,
    );
  }
  return value;
}

function assertNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `ViewportInteractionController: ${name} must be a finite number >= 0 (received ${value}).`,
    );
  }
  return value;
}

function assertFiniteDomainBounds(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  caller: string,
): void {
  if (
    !Number.isFinite(xMin) ||
    !Number.isFinite(xMax) ||
    !Number.isFinite(yMin) ||
    !Number.isFinite(yMax)
  ) {
    throw new RangeError(
      `ViewportInteractionController.${caller}: domain bounds must all be finite numbers.`,
    );
  }
}

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampScalar(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function trySetPointerCapture(container: HTMLElement, pointerId: number): void {
  if (typeof container.setPointerCapture !== "function") return;
  try {
    container.setPointerCapture(pointerId);
  } catch {
    // Synthetic PointerEvents in headless/DOM harnesses may throw NotFoundError.
  }
}

function tryReleasePointerCapture(container: HTMLElement, pointerId: number): void {
  if (typeof container.releasePointerCapture !== "function") return;
  try {
    container.releasePointerCapture(pointerId);
  } catch {
    // Ignore when the pointer was never captured or already released.
  }
}

function isPrimaryContact(event: PointerEvent): boolean {
  if (event.pointerType === "touch" || event.pointerType === "pen") {
    return true;
  }
  return event.button === 0;
}

class ViewportInteractionControllerImpl implements ViewportInteractionController {
  readonly #controller: SpectrumEngineController;
  readonly #container: HTMLElement;
  readonly #escapeTarget: EventTarget;
  readonly #blurTarget: EventTarget | null;
  readonly #wheelAxis: WheelZoomAxis;
  readonly #wheelSensitivity: number;
  readonly #pinchSensitivity: number;
  readonly #gutterInteraction: boolean;
  readonly #doubleClickReset: boolean;
  readonly #minBoxSizeCss: number;
  readonly #settleDebounceMs: number;
  readonly #manageTouchAction: boolean;
  readonly #priorTouchAction: string;
  readonly #constraints: ViewportDomainConstraints | undefined;
  readonly #onDomainChange:
    | ((domain: ViewportDomain, reason: ViewportMutationReason) => void)
    | undefined;
  readonly #onBoxSelect: ((event: BoxSelectEvent) => void) | undefined;
  readonly #onGestureStateChange: ((event: GestureStateChangeEvent) => void) | undefined;

  readonly #overlay: BoxZoomOverlay;
  readonly #scheduler: InvalidationScheduler;

  readonly #scratchDomain: MutableViewportDomain = createMutableViewportDomain();
  readonly #panSnapshot: PanGestureSnapshot = createPanGestureSnapshot();
  readonly #homeDomainStorage: MutableViewportDomain;
  readonly #homeDomainView: ViewportDomain;

  #dragMode: InteractionDragMode;
  #enabled: boolean;
  #disposed = false;
  #state: InteractionGestureState = "idle";
  #boxState: BoxZoomState = "idle";
  #lastRegion: PointerRegion = "outside";
  #gestureLatched = false;
  #escapeAttached = false;
  #gestureEpoch = 0;

  // Cached container bounding rect scalars (refreshed on pointerdown/wheel/dblclick; NEVER in pointermove).
  #rectLeft = 0;
  #rectTop = 0;
  #rectWidth = 0;
  #rectHeight = 0;

  // Preallocated 2-slot scalar pointer tracking table (zero Map/Set/object allocations).
  #p1Active = false;
  #p1Id = 0;
  #p1X = 0;
  #p1Y = 0;
  #p2Active = false;
  #p2Id = 0;
  #p2X = 0;
  #p2Y = 0;

  // Active pan / pinch / wheel frame-coalescing scalar state.
  #activeAxisMask: AxisMask = AXIS_MASK_NONE;
  #pendingDeviceX = 0;
  #pendingDeviceY = 0;
  #hasPendingMove = false;
  #hasPendingWheelFrame = false;

  #pinchStartTransform: ViewportTransform | null = null;
  #pinchStartDist = 0;
  #pinchAnchorX = 0;
  #pinchAnchorY = 0;

  // Active box-zoom scalar coordinates.
  #boxStartDeviceX = 0;
  #boxStartDeviceY = 0;
  #boxCurrentDeviceX = 0;
  #boxCurrentDeviceY = 0;
  #boxStartCssX = 0;
  #boxStartCssY = 0;

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#disposed || !this.#enabled) return;
    if (!isPrimaryContact(event)) return;

    this.#refreshRect();
    const cssX = event.clientX - this.#rectLeft;
    const cssY = event.clientY - this.#rectTop;
    const t = this.#controller.transform;
    const devX = mapCssToDeviceX(cssX, this.#rectWidth, t);
    const devY = mapCssToDeviceY(cssY, this.#rectHeight, t);

    // 3rd or subsequent simultaneous pointer: ignore without mutating active slots.
    if (this.#p1Active && this.#p2Active) {
      return;
    }

    // 2nd pointer arriving while 1 pointer is already active -> transition to 2-pointer pinch.
    if (this.#p1Active && !this.#p2Active) {
      if (event.pointerId === this.#p1Id) return;
      const region = classifyPointerRegion(t, devX, devY);
      const wasBox = this.#state === "box-pending" || this.#state === "box-active";
      this.#p2Active = true;
      this.#p2Id = event.pointerId;
      this.#p2X = devX;
      this.#p2Y = devY;
      trySetPointerCapture(this.#container, event.pointerId);

      // Prepare pinch state before user callbacks so re-entrancy or throws never re-latch with 0 pointers.
      this.#scheduler.cancelFrame();
      this.#hasPendingMove = false;
      this.#pinchStartTransform = this.#controller.transform;
      this.#pinchAnchorX = (this.#p1X + this.#p2X) * 0.5;
      this.#pinchAnchorY = (this.#p1Y + this.#p2Y) * 0.5;
      this.#pinchStartDist = Math.hypot(this.#p2X - this.#p1X, this.#p2Y - this.#p1Y);
      this.#activeAxisMask = AXIS_MASK_XY;
      this.#latchGestureActive();
      this.#attachEscapeListener();

      if (wasBox) {
        this.#overlay.hide();
        try {
          if (!this.#setState("pinching", "cancelled", region)) return;
          this.#setState("pinching", "idle", region);
        } catch (error) {
          this.#resetToIdleAfterError();
          throw error;
        }
        return;
      }

      try {
        this.#setState("pinching", "idle", region);
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
      return;
    }

    // 1st pointer down: hit-test against plot and axis gutters.
    const region = classifyPointerRegion(t, devX, devY);
    if (region === "outside") return;
    if (region !== "plot" && !this.#gutterInteraction) return;

    // Cancel any trailing wheel settle timer if a pointer gesture supersedes a wheel burst.
    if (this.#state === "wheeling") {
      this.#scheduler.cancelWheelSettle();
      this.#scheduler.cancelFrame();
      this.#hasPendingWheelFrame = false;
    }

    this.#p1Active = true;
    this.#p1Id = event.pointerId;
    this.#p1X = devX;
    this.#p1Y = devY;
    trySetPointerCapture(this.#container, event.pointerId);

    const wantsBoxZoom =
      region === "plot" && (this.#dragMode === "box-zoom" || event.shiftKey);

    if (wantsBoxZoom) {
      this.#boxStartDeviceX = devX;
      this.#boxStartDeviceY = devY;
      this.#boxCurrentDeviceX = devX;
      this.#boxCurrentDeviceY = devY;
      this.#boxStartCssX = cssX;
      this.#boxStartCssY = cssY;
      this.#overlay.hide();
      this.#latchGestureActive();
      this.#attachEscapeListener();
      try {
        this.#setState("box-pending", "pending", region);
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
      return;
    }

    this.#activeAxisMask =
      region === "x-gutter"
        ? AXIS_MASK_X
        : region === "y-gutter"
          ? AXIS_MASK_Y
          : AXIS_MASK_XY;
    capturePanGestureSnapshot(t, devX, devY, this.#panSnapshot);
    this.#pendingDeviceX = devX;
    this.#pendingDeviceY = devY;
    this.#hasPendingMove = false;
    this.#latchGestureActive();
    this.#attachEscapeListener();
    try {
      this.#setState("panning", "idle", region);
    } catch (error) {
      this.#resetToIdleAfterError();
      throw error;
    }
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#disposed || !this.#enabled) return;
    if (!this.#p1Active && !this.#p2Active) return;

    const isP1 = this.#p1Active && event.pointerId === this.#p1Id;
    const isP2 = this.#p2Active && event.pointerId === this.#p2Id;
    if (!isP1 && !isP2) return;

    // Reflow-free mapping using cached rect scalars (zero getBoundingClientRect() calls).
    const cssX = event.clientX - this.#rectLeft;
    const cssY = event.clientY - this.#rectTop;
    const t = this.#controller.transform;
    const devX = mapCssToDeviceX(cssX, this.#rectWidth, t);
    const devY = mapCssToDeviceY(cssY, this.#rectHeight, t);

    if (isP1) {
      this.#p1X = devX;
      this.#p1Y = devY;
    } else {
      this.#p2X = devX;
      this.#p2Y = devY;
    }

    if (this.#state === "box-pending" || this.#state === "box-active") {
      this.#boxCurrentDeviceX = devX;
      this.#boxCurrentDeviceY = devY;
      if (this.#boxState === "pending") {
        const dxCss = cssX - this.#boxStartCssX;
        const dyCss = cssY - this.#boxStartCssY;
        const maxDisp = Math.abs(dxCss) >= Math.abs(dyCss) ? Math.abs(dxCss) : Math.abs(dyCss);
        if (maxDisp >= this.#minBoxSizeCss) {
          try {
            if (!this.#setState("box-active", "active", "plot")) return;
          } catch (error) {
            this.#resetToIdleAfterError();
            throw error;
          }
        }
      }
      if (this.#boxState === "active") {
        const plotLeft = t.plotLeft;
        const plotRight = t.plotLeft + t.plotWidth;
        const plotTop = t.plotTop;
        const plotBottom = t.plotTop + t.plotHeight;
        const cStartX = clampScalar(this.#boxStartDeviceX, plotLeft, plotRight);
        const cCurX = clampScalar(this.#boxCurrentDeviceX, plotLeft, plotRight);
        const cStartY = clampScalar(this.#boxStartDeviceY, plotTop, plotBottom);
        const cCurY = clampScalar(this.#boxCurrentDeviceY, plotTop, plotBottom);
        const leftDev = cStartX <= cCurX ? cStartX : cCurX;
        const rightDev = cStartX >= cCurX ? cStartX : cCurX;
        const topDev = cStartY <= cCurY ? cStartY : cCurY;
        const bottomDev = cStartY >= cCurY ? cStartY : cCurY;
        const xCss = mapDeviceToCssX(leftDev, this.#rectWidth, t);
        const yCss = mapDeviceToCssY(topDev, this.#rectHeight, t);
        const wCss = mapDeviceToCssX(rightDev, this.#rectWidth, t) - xCss;
        const hCss = mapDeviceToCssY(bottomDev, this.#rectHeight, t) - yCss;
        this.#overlay.showRect(xCss, yCss, wCss, hCss);
      }
      return;
    }

    if (this.#state === "panning") {
      this.#pendingDeviceX = devX;
      this.#pendingDeviceY = devY;
      this.#hasPendingMove = true;
      this.#scheduler.scheduleFrame(this.#onGestureFrame);
      return;
    }

    if (this.#state === "pinching" && this.#p1Active && this.#p2Active) {
      this.#hasPendingMove = true;
      this.#scheduler.scheduleFrame(this.#onGestureFrame);
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (this.#disposed) return;
    const isP1 = this.#p1Active && event.pointerId === this.#p1Id;
    const isP2 = this.#p2Active && event.pointerId === this.#p2Id;
    if (!isP1 && !isP2) return;

    const cssX = event.clientX - this.#rectLeft;
    const cssY = event.clientY - this.#rectTop;
    const t = this.#controller.transform;
    const devX = mapCssToDeviceX(cssX, this.#rectWidth, t);
    const devY = mapCssToDeviceY(cssY, this.#rectHeight, t);

    if (this.#state === "pinching") {
      if (isP1) {
        this.#p1X = devX;
        this.#p1Y = devY;
      } else {
        this.#p2X = devX;
        this.#p2Y = devY;
      }
      // Apply any unrendered pinch displacement before clearing the lifted slot.
      if (this.#p1Active && this.#p2Active && this.#hasPendingMove) {
        this.#scheduler.cancelFrame();
        this.#hasPendingMove = false;
        const epoch = this.#gestureEpoch;
        try {
          this.#applyPinchFromSlots("pinch-end");
        } catch (error) {
          this.#resetToIdleAfterError();
          throw error;
        }
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
      }

      tryReleasePointerCapture(this.#container, event.pointerId);
      if (isP1) {
        if (this.#p2Active) {
          // Promote slot 2 into slot 1 so slot 1 is always occupied when 1 pointer remains.
          this.#p1Active = true;
          this.#p1Id = this.#p2Id;
          this.#p1X = this.#p2X;
          this.#p1Y = this.#p2Y;
          this.#p2Active = false;
        } else {
          this.#p1Active = false;
        }
      } else {
        this.#p2Active = false;
      }

      if (this.#p1Active) {
        return;
      }

      this.#scheduler.cancelFrame();
      this.#hasPendingMove = false;
      this.#pinchStartTransform = null;
      this.#detachEscapeListener();
      try {
        if (!this.#setState("idle", "idle", this.#lastRegion)) return;
        this.#finishSettled("pinch-end");
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
      return;
    }

    tryReleasePointerCapture(this.#container, event.pointerId);
    this.#p1Active = false;
    this.#p2Active = false;
    this.#detachEscapeListener();

    if (this.#state === "box-pending" || this.#state === "box-active") {
      const wasActive = this.#boxState === "active";
      this.#boxCurrentDeviceX = devX;
      this.#boxCurrentDeviceY = devY;
      this.#overlay.hide();

      if (!wasActive) {
        try {
          if (!this.#setState("idle", "cancelled", "plot")) return;
          if (!this.#setState("idle", "idle", "plot")) return;
        } catch (error) {
          this.#resetToIdleAfterError();
          throw error;
        }
        this.#releaseGestureActive();
        return;
      }

      const startX = this.#boxStartDeviceX;
      const startY = this.#boxStartDeviceY;
      const endX = this.#boxCurrentDeviceX;
      const endY = this.#boxCurrentDeviceY;
      const valid = computeBoxZoomDomain(
        this.#controller.transform,
        startX,
        startY,
        endX,
        endY,
        AXIS_MASK_XY,
        this.#constraints,
        this.#scratchDomain,
      );

      if (!valid) {
        try {
          if (!this.#setState("idle", "cancelled", "plot")) return;
          if (!this.#setState("idle", "idle", "plot")) return;
        } catch (error) {
          this.#resetToIdleAfterError();
          throw error;
        }
        this.#releaseGestureActive();
        return;
      }

      const nextXMin = this.#scratchDomain.xMin;
      const nextXMax = this.#scratchDomain.xMax;
      const nextYMin = this.#scratchDomain.yMin;
      const nextYMax = this.#scratchDomain.yMax;

      try {
        this.#controller.setDomain(nextXMin, nextXMax, nextYMin, nextYMax);
        if (!this.#setState("idle", "committed", "plot")) return;
        if (!this.#setState("idle", "idle", "plot")) return;
        const epoch = this.#gestureEpoch;
        this.#onDomainChange?.(this.#controller.domain, "box-zoom");
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#onBoxSelect?.({
          domain: snapshotDomain(this.#controller.domain),
          startDeviceX: startX,
          startDeviceY: startY,
          endDeviceX: endX,
          endDeviceY: endY,
        });
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#scheduler.emitSettled(this.#controller.domain, "box-zoom");
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#releaseGestureActive();
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#controller.requestRender();
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
      return;
    }

    if (this.#state === "panning") {
      this.#scheduler.cancelFrame();
      this.#pendingDeviceX = devX;
      this.#pendingDeviceY = devY;
      const flushMove = this.#hasPendingMove;
      this.#hasPendingMove = false;
      const epoch = this.#gestureEpoch;

      try {
        if (flushMove) {
          const ok = computePanDomain(
            this.#panSnapshot,
            this.#pendingDeviceX,
            this.#pendingDeviceY,
            this.#activeAxisMask,
            this.#constraints,
            this.#scratchDomain,
          );
          if (ok) {
            this.#controller.setDomain(
              this.#scratchDomain.xMin,
              this.#scratchDomain.xMax,
              this.#scratchDomain.yMin,
              this.#scratchDomain.yMax,
            );
            this.#onDomainChange?.(this.#controller.domain, "pan-end");
            if (this.#disposed || this.#gestureEpoch !== epoch) return;
          }
        }
        if (!this.#setState("idle", "idle", this.#lastRegion)) return;
        this.#finishSettled("pan-end");
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
    }
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    if (this.#disposed) return;
    const isP1 = this.#p1Active && event.pointerId === this.#p1Id;
    const isP2 = this.#p2Active && event.pointerId === this.#p2Id;
    if (!isP1 && !isP2) return;
    this.#abortActiveGesture(true);
  };

  readonly #onLostPointerCapture = (event: PointerEvent): void => {
    if (this.#disposed) return;
    const isP1 = this.#p1Active && event.pointerId === this.#p1Id;
    const isP2 = this.#p2Active && event.pointerId === this.#p2Id;
    if (!isP1 && !isP2) return;
    this.#abortActiveGesture(true);
  };

  readonly #onWheel = (event: WheelEvent): void => {
    if (this.#disposed || !this.#enabled) return;

    this.#refreshRect();
    const cssX = event.clientX - this.#rectLeft;
    const cssY = event.clientY - this.#rectTop;
    const t = this.#controller.transform;
    const devX = mapCssToDeviceX(cssX, this.#rectWidth, t);
    const devY = mapCssToDeviceY(cssY, this.#rectHeight, t);
    const region = classifyPointerRegion(t, devX, devY);
    const axisMask = resolveWheelAxisMask(
      region,
      this.#wheelAxis,
      this.#gutterInteraction,
      event.altKey,
      event.shiftKey,
    );

    if (axisMask === AXIS_MASK_NONE) {
      return;
    }

    event.preventDefault();

    // Do not interrupt active pointer capture gestures with wheel ticks.
    if (
      this.#state === "panning" ||
      this.#state === "pinching" ||
      this.#state === "box-pending" ||
      this.#state === "box-active"
    ) {
      return;
    }

    const deltaPx = normalizeWheelDeltaPx(
      event.deltaX,
      event.deltaY,
      event.deltaMode,
      event.shiftKey,
      this.#controller.height,
    );
    if (deltaPx === 0) return;

    const sensitivity = event.ctrlKey ? this.#pinchSensitivity : this.#wheelSensitivity;
    const factor = Math.exp(deltaPx * sensitivity);
    const changed = computeZoomDomain(
      t,
      factor,
      factor,
      devX,
      devY,
      axisMask,
      this.#constraints,
      this.#scratchDomain,
    );
    if (!changed) return;

    const nextXMin = this.#scratchDomain.xMin;
    const nextXMax = this.#scratchDomain.xMax;
    const nextYMin = this.#scratchDomain.yMin;
    const nextYMax = this.#scratchDomain.yMax;

    try {
      if (this.#state !== "wheeling") {
        this.#latchGestureActive();
        this.#attachEscapeListener();
        if (!this.#setState("wheeling", "idle", region)) return;
      } else {
        this.#lastRegion = region;
      }

      const epoch = this.#gestureEpoch;
      this.#controller.setDomain(nextXMin, nextXMax, nextYMin, nextYMax);
      this.#onDomainChange?.(this.#controller.domain, "wheel");
      if (this.#disposed || this.#gestureEpoch !== epoch) return;

      this.#hasPendingWheelFrame = true;
      this.#scheduler.scheduleFrame(this.#onGestureFrame);
      this.#scheduler.armWheelSettle(this.#settleDebounceMs, this.#onWheelSettle);
    } catch (error) {
      this.#resetToIdleAfterError();
      throw error;
    }
  };

  readonly #onDblClick = (event: MouseEvent): void => {
    if (this.#disposed || !this.#enabled || !this.#doubleClickReset) return;
    this.#refreshRect();
    const cssX = event.clientX - this.#rectLeft;
    const cssY = event.clientY - this.#rectTop;
    const t = this.#controller.transform;
    const devX = mapCssToDeviceX(cssX, this.#rectWidth, t);
    const devY = mapCssToDeviceY(cssY, this.#rectHeight, t);
    if (classifyPointerRegion(t, devX, devY) !== "plot") return;
    this.resetDomain();
  };

  readonly #onKeyDown = (event: Event): void => {
    if (this.#disposed) return;
    if ("key" in event && (event as KeyboardEvent).key === "Escape") {
      this.#abortActiveGesture(true);
    }
  };

  readonly #onWindowBlur = (): void => {
    if (this.#disposed) return;
    if (
      this.#state === "panning" ||
      this.#state === "pinching" ||
      this.#state === "box-pending" ||
      this.#state === "box-active"
    ) {
      this.#abortActiveGesture(true);
    }
  };

  readonly #onGestureFrame = (): void => {
    if (this.#disposed) return;

    if (this.#state === "panning" && this.#hasPendingMove) {
      this.#hasPendingMove = false;
      const ok = computePanDomain(
        this.#panSnapshot,
        this.#pendingDeviceX,
        this.#pendingDeviceY,
        this.#activeAxisMask,
        this.#constraints,
        this.#scratchDomain,
      );
      if (!ok) return;
      const epoch = this.#gestureEpoch;
      try {
        this.#controller.setDomain(
          this.#scratchDomain.xMin,
          this.#scratchDomain.xMax,
          this.#scratchDomain.yMin,
          this.#scratchDomain.yMax,
        );
        this.#onDomainChange?.(this.#controller.domain, "pan");
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#scheduler.emitGesture(this.#controller.domain, "pan");
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#controller.requestRender();
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
      return;
    }

    if (this.#state === "pinching" && this.#hasPendingMove && this.#p1Active && this.#p2Active) {
      this.#hasPendingMove = false;
      const epoch = this.#gestureEpoch;
      try {
        const applied = this.#applyPinchFromSlots("pinch");
        if (!applied || this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#scheduler.emitGesture(this.#controller.domain, "pinch");
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#controller.requestRender();
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
      return;
    }

    if (this.#state === "wheeling" && this.#hasPendingWheelFrame) {
      this.#hasPendingWheelFrame = false;
      const epoch = this.#gestureEpoch;
      try {
        this.#scheduler.emitGesture(this.#controller.domain, "wheel");
        if (this.#disposed || this.#gestureEpoch !== epoch) return;
        this.#controller.requestRender();
      } catch (error) {
        this.#resetToIdleAfterError();
        throw error;
      }
    }
  };

  readonly #onWheelSettle = (): void => {
    if (this.#disposed || this.#state !== "wheeling") return;
    this.#scheduler.cancelFrame();
    this.#hasPendingWheelFrame = false;
    this.#detachEscapeListener();
    try {
      if (!this.#setState("idle", "idle", this.#lastRegion)) return;
      this.#finishSettled("wheel-settle");
    } catch (error) {
      this.#resetToIdleAfterError();
      throw error;
    }
  };

  constructor(options: ViewportInteractionControllerOptions) {
    const wheelSensitivity = assertPositiveFinite(
      options.wheelSensitivity ?? DEFAULT_WHEEL_SENSITIVITY,
      "wheelSensitivity",
    );
    const pinchSensitivity = assertPositiveFinite(
      options.pinchSensitivity ?? wheelSensitivity * 4,
      "pinchSensitivity",
    );
    const minBoxSizeCss = assertNonNegativeFinite(
      options.minBoxSizeCss ?? DEFAULT_MIN_BOX_SIZE_CSS,
      "minBoxSizeCss",
    );
    const settleDebounceMs = assertNonNegativeFinite(
      options.settleDebounceMs ?? DEFAULT_SETTLE_DEBOUNCE_MS,
      "settleDebounceMs",
    );

    const initialHome = options.homeDomain ?? options.controller.domain;
    assertFiniteDomainBounds(
      initialHome.xMin,
      initialHome.xMax,
      initialHome.yMin,
      initialHome.yMax,
      "constructor(homeDomain)",
    );

    this.#controller = options.controller;
    this.#container = options.controller.container;
    this.#escapeTarget = this.#container.ownerDocument ?? this.#container;
    const defaultView = this.#container.ownerDocument?.defaultView ?? null;
    this.#blurTarget =
      defaultView !== null &&
      typeof defaultView.addEventListener === "function" &&
      typeof defaultView.removeEventListener === "function"
        ? defaultView
        : null;
    this.#dragMode = options.dragMode ?? "pan";
    this.#wheelAxis = options.wheelAxis ?? "xy";
    this.#wheelSensitivity = wheelSensitivity;
    this.#pinchSensitivity = pinchSensitivity;
    this.#gutterInteraction = options.gutterInteraction ?? true;
    this.#doubleClickReset = options.doubleClickReset ?? true;
    this.#minBoxSizeCss = minBoxSizeCss;
    this.#settleDebounceMs = settleDebounceMs;
    this.#manageTouchAction = options.manageTouchAction ?? true;
    this.#enabled = options.enabled ?? true;
    this.#constraints = options.constraints;
    this.#onDomainChange = options.onDomainChange;
    this.#onBoxSelect = options.onBoxSelect;
    this.#onGestureStateChange = options.onGestureStateChange;

    this.#homeDomainStorage = createMutableViewportDomain(
      initialHome.xMin,
      initialHome.xMax,
      initialHome.yMin,
      initialHome.yMax,
    );
    const homeStorage = this.#homeDomainStorage;
    this.#homeDomainView = Object.freeze({
      get xMin(): number {
        return homeStorage.xMin;
      },
      get xMax(): number {
        return homeStorage.xMax;
      },
      get yMin(): number {
        return homeStorage.yMin;
      },
      get yMax(): number {
        return homeStorage.yMax;
      },
    });

    this.#scheduler = new InvalidationScheduler({
      ...(options.onInvalidate !== undefined ? { onInvalidate: options.onInvalidate } : {}),
      ...(options.requestAnimationFrame !== undefined
        ? { requestAnimationFrame: options.requestAnimationFrame }
        : {}),
      ...(options.cancelAnimationFrame !== undefined
        ? { cancelAnimationFrame: options.cancelAnimationFrame }
        : {}),
      ...(options.setTimeout !== undefined ? { setTimeout: options.setTimeout } : {}),
      ...(options.clearTimeout !== undefined ? { clearTimeout: options.clearTimeout } : {}),
    });

    this.#priorTouchAction = this.#container.style.touchAction;
    if (this.#manageTouchAction) {
      this.#container.style.touchAction = "none";
    }

    this.#overlay = new BoxZoomOverlay(this.#container);
    this.#attachContainerListeners();
  }

  get state(): InteractionGestureState {
    return this.#state;
  }

  get dragMode(): InteractionDragMode {
    return this.#dragMode;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get homeDomain(): ViewportDomain {
    return this.#homeDomainView;
  }

  zoomByFactor(factorX: number, factorY: number, normX = 0.5, normY = 0.5): boolean {
    if (this.#disposed) return false;
    if (
      !Number.isFinite(factorX) ||
      factorX <= 0 ||
      !Number.isFinite(factorY) ||
      factorY <= 0 ||
      !Number.isFinite(normX) ||
      !Number.isFinite(normY)
    ) {
      return false;
    }
    const axisMask = ((factorX !== 1 ? AXIS_MASK_X : 0) |
      (factorY !== 1 ? AXIS_MASK_Y : 0)) as AxisMask;
    if (axisMask === AXIS_MASK_NONE) return false;

    this.#abortActiveGesture(true);
    if (this.#disposed) return false;

    const t = this.#controller.transform;
    const anchorX = t.plotLeft + clampUnit(normX) * t.plotWidth;
    const anchorY = t.plotTop + t.plotHeight - clampUnit(normY) * t.plotHeight;
    const changed = computeZoomDomain(
      t,
      factorX,
      factorY,
      anchorX,
      anchorY,
      axisMask,
      this.#constraints,
      this.#scratchDomain,
    );
    if (!changed) return false;

    this.#commitImperativeDomain(
      this.#scratchDomain.xMin,
      this.#scratchDomain.xMax,
      this.#scratchDomain.yMin,
      this.#scratchDomain.yMax,
      "programmatic",
    );
    return true;
  }

  panByFraction(fractionX: number, fractionY: number): boolean {
    if (this.#disposed) return false;
    if (!Number.isFinite(fractionX) || !Number.isFinite(fractionY)) return false;
    const axisMask = ((fractionX !== 0 ? AXIS_MASK_X : 0) |
      (fractionY !== 0 ? AXIS_MASK_Y : 0)) as AxisMask;
    if (axisMask === AXIS_MASK_NONE) return false;

    this.#abortActiveGesture(true);
    if (this.#disposed) return false;

    const t = this.#controller.transform;
    capturePanGestureSnapshot(t, 0, 0, this.#panSnapshot);
    const targetDeviceX = -fractionX * t.plotWidth;
    const targetDeviceY = fractionY * t.plotHeight;
    const ok = computePanDomain(
      this.#panSnapshot,
      targetDeviceX,
      targetDeviceY,
      axisMask,
      this.#constraints,
      this.#scratchDomain,
    );
    if (!ok) return false;

    const nextXMin = this.#scratchDomain.xMin;
    const nextXMax = this.#scratchDomain.xMax;
    const nextYMin = this.#scratchDomain.yMin;
    const nextYMax = this.#scratchDomain.yMax;
    if (
      nextXMin === t.xDomainMin &&
      nextXMax === t.xDomainMax &&
      nextYMin === t.yDomainMin &&
      nextYMax === t.yDomainMax
    ) {
      return false;
    }

    this.#commitImperativeDomain(nextXMin, nextXMax, nextYMin, nextYMax, "programmatic");
    return true;
  }

  commitBoxDomain(xMin: number, xMax: number, yMin: number, yMax: number): boolean {
    if (this.#disposed) return false;
    this.#scratchDomain.xMin = xMin;
    this.#scratchDomain.xMax = xMax;
    this.#scratchDomain.yMin = yMin;
    this.#scratchDomain.yMax = yMax;
    const ok = clampViewportDomain(
      this.#scratchDomain,
      this.#controller.transform.yScaleKind,
      this.#constraints,
      false,
    );
    if (!ok) return false;

    const nextXMin = this.#scratchDomain.xMin;
    const nextXMax = this.#scratchDomain.xMax;
    const nextYMin = this.#scratchDomain.yMin;
    const nextYMax = this.#scratchDomain.yMax;

    this.#abortActiveGesture(true);
    if (this.#disposed) return false;

    this.#commitImperativeDomain(nextXMin, nextXMax, nextYMin, nextYMax, "box-zoom");
    return true;
  }

  resetDomain(): void {
    if (this.#disposed) return;
    this.#abortActiveGesture(true);
    if (this.#disposed) return;

    const { xMin, xMax, yMin, yMax } = this.#homeDomainStorage;
    if (
      !Number.isFinite(xMin) ||
      !Number.isFinite(xMax) ||
      !Number.isFinite(yMin) ||
      !Number.isFinite(yMax)
    ) {
      return;
    }
    this.#commitImperativeDomain(xMin, xMax, yMin, yMax, "reset");
  }

  setHomeDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    if (this.#disposed) return;
    assertFiniteDomainBounds(xMin, xMax, yMin, yMax, "setHomeDomain");
    this.#homeDomainStorage.xMin = xMin;
    this.#homeDomainStorage.xMax = xMax;
    this.#homeDomainStorage.yMin = yMin;
    this.#homeDomainStorage.yMax = yMax;
  }

  setDragMode(mode: InteractionDragMode): void {
    if (this.#disposed) return;
    this.#dragMode = mode;
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    if (!enabled) {
      this.#abortActiveGesture(true);
    }
  }

  cancelGesture(): void {
    if (this.#disposed) return;
    this.#abortActiveGesture(true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#gestureEpoch += 1;

    this.#scheduler.dispose();
    this.#detachContainerListeners();
    this.#detachEscapeListener();
    this.#releaseActivePointers();
    this.#overlay.dispose();

    this.#state = "idle";
    this.#boxState = "idle";
    this.#hasPendingMove = false;
    this.#hasPendingWheelFrame = false;
    this.#pinchStartTransform = null;

    if (this.#manageTouchAction) {
      this.#container.style.touchAction = this.#priorTouchAction;
    }

    this.#releaseGestureActive();
  }

  #attachContainerListeners(): void {
    this.#container.addEventListener("pointerdown", this.#onPointerDown);
    this.#container.addEventListener("pointermove", this.#onPointerMove);
    this.#container.addEventListener("pointerup", this.#onPointerUp);
    this.#container.addEventListener("pointercancel", this.#onPointerCancel);
    this.#container.addEventListener("lostpointercapture", this.#onLostPointerCapture);
    this.#container.addEventListener("wheel", this.#onWheel, { passive: false });
    this.#container.addEventListener("dblclick", this.#onDblClick);
    this.#blurTarget?.addEventListener("blur", this.#onWindowBlur);
  }

  #detachContainerListeners(): void {
    this.#container.removeEventListener("pointerdown", this.#onPointerDown);
    this.#container.removeEventListener("pointermove", this.#onPointerMove);
    this.#container.removeEventListener("pointerup", this.#onPointerUp);
    this.#container.removeEventListener("pointercancel", this.#onPointerCancel);
    this.#container.removeEventListener("lostpointercapture", this.#onLostPointerCapture);
    this.#container.removeEventListener("wheel", this.#onWheel);
    this.#container.removeEventListener("dblclick", this.#onDblClick);
    this.#blurTarget?.removeEventListener("blur", this.#onWindowBlur);
  }

  #attachEscapeListener(): void {
    if (this.#escapeAttached || this.#disposed) return;
    this.#escapeAttached = true;
    this.#escapeTarget.addEventListener("keydown", this.#onKeyDown);
  }

  #detachEscapeListener(): void {
    if (!this.#escapeAttached) return;
    this.#escapeAttached = false;
    this.#escapeTarget.removeEventListener("keydown", this.#onKeyDown);
  }

  #refreshRect(): void {
    if (typeof this.#container.getBoundingClientRect === "function") {
      const rect = this.#container.getBoundingClientRect();
      this.#rectLeft = rect.left;
      this.#rectTop = rect.top;
      this.#rectWidth = rect.width;
      this.#rectHeight = rect.height;
    } else {
      this.#rectLeft = 0;
      this.#rectTop = 0;
      this.#rectWidth = 0;
      this.#rectHeight = 0;
    }
  }

  #latchGestureActive(): void {
    if (this.#gestureLatched || this.#disposed) return;
    this.#gestureLatched = true;
    this.#controller.setGestureActive(true);
  }

  #releaseGestureActive(): void {
    if (!this.#gestureLatched) return;
    this.#gestureLatched = false;
    this.#controller.setGestureActive(false);
  }

  #releaseActivePointers(): void {
    if (this.#p1Active) {
      const id = this.#p1Id;
      this.#p1Active = false;
      tryReleasePointerCapture(this.#container, id);
    }
    if (this.#p2Active) {
      const id = this.#p2Id;
      this.#p2Active = false;
      tryReleasePointerCapture(this.#container, id);
    }
  }

  #setState(
    nextState: InteractionGestureState,
    nextBoxState: BoxZoomState,
    region: PointerRegion,
  ): boolean {
    const prevState = this.#state;
    const prevBoxState = this.#boxState;
    this.#state = nextState;
    this.#boxState = nextBoxState;
    this.#lastRegion = region;
    if (prevState !== nextState || prevBoxState !== nextBoxState) {
      const epoch = ++this.#gestureEpoch;
      this.#onGestureStateChange?.({
        previousState: prevState,
        state: nextState,
        boxState: nextBoxState,
        region,
      });
      return !this.#disposed && this.#gestureEpoch === epoch;
    }
    return !this.#disposed;
  }

  #applyPinchFromSlots(reason: "pinch" | "pinch-end"): boolean {
    const dist = Math.hypot(this.#p2X - this.#p1X, this.#p2Y - this.#p1Y);
    if (!Number.isFinite(dist) || dist <= 0) return false;
    if (this.#pinchStartDist <= 0 || this.#pinchStartTransform === null) {
      this.#pinchStartDist = dist;
      this.#pinchStartTransform = this.#controller.transform;
      this.#pinchAnchorX = (this.#p1X + this.#p2X) * 0.5;
      this.#pinchAnchorY = (this.#p1Y + this.#p2Y) * 0.5;
      return false;
    }
    const factor = this.#pinchStartDist / dist;
    const changed = computeZoomDomain(
      this.#pinchStartTransform,
      factor,
      factor,
      this.#pinchAnchorX,
      this.#pinchAnchorY,
      this.#activeAxisMask,
      this.#constraints,
      this.#scratchDomain,
    );
    if (!changed) return false;
    this.#controller.setDomain(
      this.#scratchDomain.xMin,
      this.#scratchDomain.xMax,
      this.#scratchDomain.yMin,
      this.#scratchDomain.yMax,
    );
    this.#onDomainChange?.(this.#controller.domain, reason);
    return true;
  }

  #finishSettled(reason: ViewportMutationReason): void {
    const epoch = this.#gestureEpoch;
    try {
      this.#scheduler.emitSettled(this.#controller.domain, reason);
      if (this.#disposed || this.#gestureEpoch !== epoch) return;
      this.#releaseGestureActive();
      if (this.#disposed || this.#gestureEpoch !== epoch) return;
      this.#controller.requestRender();
    } catch (error) {
      this.#releaseGestureActive();
      throw error;
    }
  }

  #commitImperativeDomain(
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    reason: ViewportMutationReason,
  ): void {
    const epoch = ++this.#gestureEpoch;
    try {
      this.#controller.setDomain(xMin, xMax, yMin, yMax);
      this.#onDomainChange?.(this.#controller.domain, reason);
      if (this.#disposed || this.#gestureEpoch !== epoch) return;
      this.#scheduler.emitSettled(this.#controller.domain, reason);
      if (this.#disposed || this.#gestureEpoch !== epoch) return;
      this.#releaseGestureActive();
      if (this.#disposed || this.#gestureEpoch !== epoch) return;
      this.#controller.requestRender();
    } catch (error) {
      this.#releaseGestureActive();
      throw error;
    }
  }

  #resetToIdleAfterError(): void {
    this.#gestureEpoch += 1;
    this.#scheduler.cancelFrame();
    this.#scheduler.cancelWheelSettle();
    this.#releaseActivePointers();
    this.#detachEscapeListener();
    this.#hasPendingMove = false;
    this.#hasPendingWheelFrame = false;
    this.#pinchStartTransform = null;
    this.#overlay.hide();
    this.#state = "idle";
    this.#boxState = "idle";
    this.#releaseGestureActive();
  }

  #abortActiveGesture(emitCancelledBox: boolean): void {
    this.#gestureEpoch += 1;
    this.#scheduler.cancelFrame();
    this.#scheduler.cancelWheelSettle();
    this.#releaseActivePointers();
    this.#detachEscapeListener();
    this.#hasPendingMove = false;
    this.#hasPendingWheelFrame = false;
    this.#pinchStartTransform = null;
    this.#overlay.hide();

    const wasBox = this.#state === "box-pending" || this.#state === "box-active";
    const region = this.#lastRegion;
    try {
      if (wasBox && emitCancelledBox) {
        if (!this.#setState("idle", "cancelled", region)) {
          return;
        }
        if (!this.#setState("idle", "idle", region)) {
          return;
        }
      } else if (this.#state !== "idle" || this.#boxState !== "idle") {
        if (!this.#setState("idle", "idle", region)) {
          return;
        }
      }
    } finally {
      if (this.#state === "idle") {
        this.#boxState = "idle";
        this.#releaseGestureActive();
      }
    }
  }
}

/**
 * Attaches a framework-agnostic DOM viewport interaction controller onto a
 * `SpectrumEngineController`.
 */
export function createViewportInteractionController(
  options: ViewportInteractionControllerOptions,
): ViewportInteractionController {
  return new ViewportInteractionControllerImpl(options);
}
