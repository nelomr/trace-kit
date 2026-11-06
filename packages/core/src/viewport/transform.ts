/**
 * `ViewportTransform` — a frozen flat object of numbers mapping data space (payload X offsets
 * from `xOrigin`, Y samples) to device-pixel space. The X domain is absolute physical X
 * (`xOrigin + x[i]`) and the transform carries its offset-space left edge `xOffsetMin`, so the
 * per-sample projection subtracts one precomputed binary64 value. Flat and frozen so it survives
 * `structuredClone` intact (no prototype loss) and so a stray mutation on the hot path fails
 * loudly as a `TypeError` in strict mode rather than silently disagreeing with an exporter
 * holding the same reference. `projectX`/`projectY`/`unprojectX`/`unprojectY`/
 * `isInsidePlotArea` are module-level free functions, not methods, so every call site is
 * monomorphic rather than a polymorphic property load.
 */
import type { SpectrumDataPayload } from "../payload/spectrum-data-payload.js";

/** Linear Y projection. The value `0` is the historical, and remains the default, behaviour. */
export const Y_SCALE_KIND_LINEAR = 0;
/** Base-10 logarithmic Y projection. */
export const Y_SCALE_KIND_LOG = 1;
// Values >= 2 are reserved for future scale kinds (e.g. symlog) and must not be assigned here.

export interface ViewportTransform {
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly yDomainMin: number;
  readonly yDomainMax: number;

  readonly xOrigin: number;
  /**
   * Left edge of the X domain in the payload's offset space (`xDomainMin - xOrigin`), binary64.
   * The only X value the projection reads besides scale and plot left.
   */
  readonly xOffsetMin: number;

  readonly deviceWidth: number;
  readonly deviceHeight: number;
  readonly dpr: number;

  readonly plotLeft: number;
  readonly plotTop: number;
  readonly plotWidth: number;
  readonly plotHeight: number;

  readonly xScale: number;
  /**
   * Device pixels per domain unit on a linear Y axis. Deliberately `NaN` on a logarithmic axis:
   * there is no single pixels-per-unit ratio there, and a consumer that multiplies by it without
   * checking the scale kind produces a non-finite result that fails visibly on first render
   * instead of a plausible-looking wrong plot.
   */
  readonly yScale: number;
  readonly yBase: number;
  readonly yScaleKind: number;
  /** Base-10 logarithm of `yDomainMin`. `0` on a linear axis. */
  readonly yLogDomainMin: number;
  /** Device pixels per decade. `0` on a linear axis, and on a log axis of zero span. */
  readonly yLogScale: number;
}

export interface CreateViewportTransformOptions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly insetTop: number;
  readonly insetBottom: number;
  /** Left edge of the visible X window in absolute physical X (`xOrigin + x[i]` space). */
  readonly xDomainMin: number;
  /** Right edge of the visible X window in absolute physical X. */
  readonly xDomainMax: number;
  readonly yDomainMin: number;
  readonly yDomainMax: number;
  /** Binary64 origin of the payload this transform serves; `0` when it serves no payload. */
  readonly xOrigin: number;
  /** Defaults to `Y_SCALE_KIND_LINEAR` when omitted, matching pre-change behaviour verbatim. */
  readonly yScaleKind?: number;
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
  const yScaleKind = options.yScaleKind ?? Y_SCALE_KIND_LINEAR;

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

  // Computed once here so the per-sample projection pays a single subtraction. Two finite
  // operands can still overflow to Infinity; failing at construction keeps a non-finite origin
  // out of every downstream projection and GPU upload.
  const xOffsetMin = xDomainMin - xOrigin;
  requireFinite(xOffsetMin, "xDomainMin - xOrigin");

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
  if (!Number.isInteger(yScaleKind) || yScaleKind < 0 || yScaleKind > 1) {
    throw new RangeError(
      `yScaleKind must be an integer in [0, 1] (0 = linear, 1 = log); received ${yScaleKind}.`,
    );
  }
  if (yScaleKind === Y_SCALE_KIND_LOG && yDomainMin <= 0) {
    throw new RangeError(
      `a logarithmic Y axis requires yDomainMin > 0; received ${yDomainMin}.`,
    );
  }

  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);

  const plotLeft = insetLeft * dpr;
  const plotTop = insetTop * dpr;
  const plotWidth = deviceWidth - (insetLeft + insetRight) * dpr;
  const plotHeight = deviceHeight - (insetTop + insetBottom) * dpr;

  const xSpan = xDomainMax - xDomainMin;
  const xScale = xSpan === 0 ? 0 : plotWidth / xSpan;

  let yScale: number;
  let yBase: number;
  let yLogDomainMin: number;
  let yLogScale: number;
  if (yScaleKind === Y_SCALE_KIND_LOG) {
    yScale = Number.NaN;
    yBase = plotTop + plotHeight;
    yLogDomainMin = Math.log10(yDomainMin);
    const logSpan = Math.log10(yDomainMax) - yLogDomainMin;
    yLogScale = logSpan === 0 ? 0 : plotHeight / logSpan;
  } else {
    const ySpan = yDomainMax - yDomainMin;
    yScale = ySpan === 0 ? 0 : plotHeight / ySpan;
    yBase = plotTop + plotHeight + yDomainMin * yScale;
    yLogDomainMin = 0;
    yLogScale = 0;
  }

  return Object.freeze({
    xDomainMin,
    xDomainMax,
    yDomainMin,
    yDomainMax,
    xOrigin,
    xOffsetMin,
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
    yScaleKind,
    yLogDomainMin,
    yLogScale,
  });
}

/**
 * Projects a payload X offset (`payload.x[i]`, relative to that payload's `xOrigin`) to device
 * pixels. The subtraction origin is `xOffsetMin`, the domain minimum in that same offset space,
 * so the hot loop costs one subtraction and one multiplication and never touches `xOrigin`.
 * A caller holding an absolute X must subtract the trace's own `xOrigin` first.
 */
export function projectX(t: ViewportTransform, xOffset: number): number {
  return t.plotLeft + (xOffset - t.xOffsetMin) * t.xScale;
}

export function projectY(t: ViewportTransform, yValue: number): number {
  // The scale kind is fixed for the lifetime of a transform, so this branch is loop-invariant
  // within any render pass and the predictor resolves it after the first sample.
  return t.yScaleKind === Y_SCALE_KIND_LINEAR
    ? t.yBase - yValue * t.yScale
    : t.yBase - (Math.log10(yValue) - t.yLogDomainMin) * t.yLogScale;
}

/**
 * Inverts a device pixel to absolute physical X (`xOrigin + x[i]` space), the same space as
 * `xDomainMin`. It does not depend on `xOrigin`; subtract a payload's origin to get its offset.
 * Total and unclamped: pixels outside the plot area extrapolate, and a zero-span axis returns
 * `xDomainMin` instead of dividing by zero.
 */
export function unprojectX(t: ViewportTransform, devicePixelX: number): number {
  return t.xScale === 0
    ? t.xDomainMin
    : t.xDomainMin + (devicePixelX - t.plotLeft) / t.xScale;
}

export function unprojectY(t: ViewportTransform, devicePixelY: number): number {
  if (t.yScaleKind === Y_SCALE_KIND_LINEAR) {
    return t.yScale === 0 ? t.yDomainMin : (t.yBase - devicePixelY) / t.yScale;
  }
  // A zero-decade domain has no invertible mapping; every pixel reads back as the single
  // domain value, matching the linear zero-span behaviour rather than dividing by zero.
  if (t.yLogScale === 0) return t.yDomainMin;
  return 10 ** ((t.yBase - devicePixelY) / t.yLogScale + t.yLogDomainMin);
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
 * payload the renderer no longer holds. Payload X offsets are meaningful only relative to the
 * origin that `xOffsetMin` was derived from, so comparing `xOrigin` catches the one mismatch that
 * would silently misplot. The domain is not a payload property and `xOffsetMin` is a pure
 * function of it and `xOrigin`, so the origin alone is sufficient.
 */
export function transformMatchesPayload(
  t: ViewportTransform,
  payload: SpectrumDataPayload,
): boolean {
  return t.xOrigin === payload.xOrigin;
}
