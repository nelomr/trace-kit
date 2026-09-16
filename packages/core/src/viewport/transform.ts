/**
 * `ViewportTransform` — a frozen flat object of numbers mapping data space (X offsets from
 * `payload.xOrigin`, Y samples) to device-pixel space. Flat and frozen so it survives
 * `structuredClone` intact (no prototype loss) and so a stray mutation on the hot path fails
 * loudly as a `TypeError` in strict mode rather than silently disagreeing with an exporter
 * holding the same reference. `projectX`/`projectY`/`unprojectX`/`unprojectY`/
 * `isInsidePlotArea` are module-level free functions, not methods, so every call site is
 * monomorphic rather than a polymorphic property load.
 */
import type { SpectrumDataPayload } from "../payload/spectrum-data-payload.js";

export interface ViewportTransform {
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly yDomainMin: number;
  readonly yDomainMax: number;

  readonly xOrigin: number;

  readonly deviceWidth: number;
  readonly deviceHeight: number;
  readonly dpr: number;

  readonly plotLeft: number;
  readonly plotTop: number;
  readonly plotWidth: number;
  readonly plotHeight: number;

  readonly xScale: number;
  readonly yScale: number;
  readonly yBase: number;
}

export interface CreateViewportTransformOptions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly insetTop: number;
  readonly insetBottom: number;
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly yDomainMin: number;
  readonly yDomainMax: number;
  readonly xOrigin: number;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite; received ${String(value)}.`);
  }
}

export function createViewportTransform(
  options: CreateViewportTransformOptions,
): ViewportTransform {
  const {
    cssWidth,
    cssHeight,
    dpr,
    insetLeft,
    insetRight,
    insetTop,
    insetBottom,
    xDomainMin,
    xDomainMax,
    yDomainMin,
    yDomainMax,
    xOrigin,
  } = options;

  requireFinite(cssWidth, "cssWidth");
  requireFinite(cssHeight, "cssHeight");
  requireFinite(dpr, "dpr");
  requireFinite(insetLeft, "insetLeft");
  requireFinite(insetRight, "insetRight");
  requireFinite(insetTop, "insetTop");
  requireFinite(insetBottom, "insetBottom");
  requireFinite(xDomainMin, "xDomainMin");
  requireFinite(xDomainMax, "xDomainMax");
  requireFinite(yDomainMin, "yDomainMin");
  requireFinite(yDomainMax, "yDomainMax");
  requireFinite(xOrigin, "xOrigin");

  if (dpr <= 0) {
    throw new RangeError(`dpr must be > 0; received ${dpr}.`);
  }
  if (insetLeft < 0 || insetRight < 0 || insetTop < 0 || insetBottom < 0) {
    throw new RangeError("insets must be >= 0.");
  }
  if (insetLeft + insetRight >= cssWidth) {
    throw new RangeError(
      `insetLeft + insetRight (${insetLeft + insetRight}) must be < cssWidth (${cssWidth}).`,
    );
  }
  if (insetTop + insetBottom >= cssHeight) {
    throw new RangeError(
      `insetTop + insetBottom (${insetTop + insetBottom}) must be < cssHeight (${cssHeight}).`,
    );
  }

  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);

  const plotLeft = insetLeft * dpr;
  const plotTop = insetTop * dpr;
  const plotWidth = deviceWidth - (insetLeft + insetRight) * dpr;
  const plotHeight = deviceHeight - (insetTop + insetBottom) * dpr;

  const xSpan = xDomainMax - xDomainMin;
  const ySpan = yDomainMax - yDomainMin;
  const xScale = xSpan === 0 ? 0 : plotWidth / xSpan;
  const yScale = ySpan === 0 ? 0 : plotHeight / ySpan;
  const yBase = plotTop + plotHeight + yDomainMin * yScale;

  return Object.freeze({
    xDomainMin,
    xDomainMax,
    yDomainMin,
    yDomainMax,
    xOrigin,
    deviceWidth,
    deviceHeight,
    dpr,
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
    xScale,
    yScale,
    yBase,
  });
}

export function projectX(t: ViewportTransform, xOffset: number): number {
  return t.plotLeft + (xOffset - t.xDomainMin) * t.xScale;
}

export function projectY(t: ViewportTransform, yValue: number): number {
  return t.yBase - yValue * t.yScale;
}

export function unprojectX(t: ViewportTransform, devicePixelX: number): number {
  return t.xScale === 0
    ? t.xDomainMin
    : t.xDomainMin + (devicePixelX - t.plotLeft) / t.xScale;
}

export function unprojectY(t: ViewportTransform, devicePixelY: number): number {
  return t.yScale === 0
    ? t.yDomainMin
    : (t.yBase - devicePixelY) / t.yScale;
}

export function isInsidePlotArea(
  t: ViewportTransform,
  deviceX: number,
  deviceY: number,
): boolean {
  return (
    deviceX >= t.plotLeft &&
    deviceX <= t.plotLeft + t.plotWidth &&
    deviceY >= t.plotTop &&
    deviceY <= t.plotTop + t.plotHeight
  );
}

/**
 * A stale transform reference is internally consistent but may have been derived from a
 * payload the renderer no longer holds. Comparing `xOrigin` catches the one mismatch that
 * would silently misplot: every X offset is meaningless without knowing what it is an offset
 * from.
 */
export function transformMatchesPayload(
  t: ViewportTransform,
  payload: SpectrumDataPayload,
): boolean {
  return t.xOrigin === payload.xOrigin;
}
