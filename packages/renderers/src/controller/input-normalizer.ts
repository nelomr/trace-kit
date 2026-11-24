import {
  AXIS_MASK_NONE,
  AXIS_MASK_X,
  AXIS_MASK_XY,
  AXIS_MASK_Y,
  isInsidePlotArea,
  type AxisMask,
  type ViewportTransform,
} from "@trace-kit/core";
import type { PointerRegion, WheelZoomAxis } from "./interaction-types.js";

/** Default CSS pixel height per discrete line for `DOM_DELTA_LINE` wheel events. */
export const DEFAULT_WHEEL_LINE_HEIGHT_PX = 32;
/** Default fallback page height in CSS pixels for `DOM_DELTA_PAGE` when viewport height is invalid. */
export const DEFAULT_WHEEL_PAGE_FALLBACK_PX = 800;
/** Maximum absolute normalized CSS pixel delta per wheel event. */
export const MAX_WHEEL_DELTA_PX = 400;
/** Default exponential wheel sensitivity (`factor = exp(deltaPx * sensitivity)`). */
export const DEFAULT_WHEEL_SENSITIVITY = 0.001;
/** Default minimum CSS pixel displacement to promote box-zoom from `"pending"` to `"active"`. */
export const DEFAULT_MIN_BOX_SIZE_CSS = 4;
/** Default trailing settle debounce duration in milliseconds for wheel bursts. */
export const DEFAULT_SETTLE_DEBOUNCE_MS = 120;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * Partitions a device-pixel coordinate `(deviceX, deviceY)` into one of four mutually disjoint
 * regions against `transform`: `"plot"`, `"x-gutter"`, `"y-gutter"`, or `"outside"`.
 */
export function classifyPointerRegion(
  transform: ViewportTransform,
  deviceX: number,
  deviceY: number,
): PointerRegion {
  if (!Number.isFinite(deviceX) || !Number.isFinite(deviceY)) {
    return "outside";
  }
  if (isInsidePlotArea(transform, deviceX, deviceY)) {
    return "plot";
  }
  const plotRight = transform.plotLeft + transform.plotWidth;
  const plotBottom = transform.plotTop + transform.plotHeight;
  if (
    deviceY > plotBottom &&
    deviceY <= transform.deviceHeight &&
    deviceX >= transform.plotLeft &&
    deviceX <= plotRight
  ) {
    return "x-gutter";
  }
  if (
    deviceX >= 0 &&
    deviceX < transform.plotLeft &&
    deviceY >= transform.plotTop &&
    deviceY <= plotBottom
  ) {
    return "y-gutter";
  }
  return "outside";
}

/**
 * Normalizes cross-browser wheel deltas (`DOM_DELTA_PIXEL`, `DOM_DELTA_LINE`, `DOM_DELTA_PAGE`,
 * and macOS `Shift + Wheel` `deltaX` remapping) into clamped CSS pixels in
 * `[-MAX_WHEEL_DELTA_PX, +MAX_WHEEL_DELTA_PX]`.
 */
export function normalizeWheelDeltaPx(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  shiftKey: boolean,
  pageHeightCss: number,
): number {
  const raw = shiftKey
    ? Math.abs(deltaY) >= Math.abs(deltaX)
      ? deltaY
      : deltaX
    : deltaY;
  if (!Number.isFinite(raw) || raw === 0) {
    return 0;
  }

  let px: number;
  if (deltaMode === DOM_DELTA_LINE) {
    px = raw * DEFAULT_WHEEL_LINE_HEIGHT_PX;
  } else if (deltaMode === DOM_DELTA_PAGE) {
    const pageHeight =
      Number.isFinite(pageHeightCss) && pageHeightCss > 0
        ? pageHeightCss
        : DEFAULT_WHEEL_PAGE_FALLBACK_PX;
    px = raw * pageHeight;
  } else {
    px = raw;
  }

  if (!Number.isFinite(px)) {
    return 0;
  }
  if (px > MAX_WHEEL_DELTA_PX) {
    return MAX_WHEEL_DELTA_PX;
  }
  if (px < -MAX_WHEEL_DELTA_PX) {
    return -MAX_WHEEL_DELTA_PX;
  }
  return px;
}

/**
 * Resolves the active `AxisMask` for a wheel zoom event given the hit-tested `region`,
 * configured `wheelAxis`, `gutterInteraction` flag, and `altKey`/`shiftKey` modifiers.
 */
export function resolveWheelAxisMask(
  region: PointerRegion,
  wheelAxis: WheelZoomAxis,
  gutterInteraction: boolean,
  altKey: boolean,
  shiftKey: boolean,
): AxisMask {
  if (region === "outside") {
    return AXIS_MASK_NONE;
  }
  if (gutterInteraction && region === "x-gutter") {
    return AXIS_MASK_X;
  }
  if (gutterInteraction && region === "y-gutter") {
    return AXIS_MASK_Y;
  }
  if (!gutterInteraction && region !== "plot") {
    return AXIS_MASK_NONE;
  }
  if (altKey && !shiftKey) {
    return AXIS_MASK_X;
  }
  if (shiftKey && !altKey) {
    return AXIS_MASK_Y;
  }
  if (wheelAxis === "x") {
    return AXIS_MASK_X;
  }
  if (wheelAxis === "y") {
    return AXIS_MASK_Y;
  }
  return AXIS_MASK_XY;
}

/**
 * Maps a container-local CSS X coordinate to device pixels using cached rect width, falling back
 * to `cssX * transform.dpr` when layout dimensions are unavailable (`rectWidth <= 0`).
 */
export function mapCssToDeviceX(
  cssX: number,
  rectWidth: number,
  transform: ViewportTransform,
): number {
  if (rectWidth > 0 && Number.isFinite(rectWidth)) {
    return (cssX / rectWidth) * transform.deviceWidth;
  }
  return cssX * transform.dpr;
}

/**
 * Maps a container-local CSS Y coordinate to device pixels using cached rect height, falling back
 * to `cssY * transform.dpr` when layout dimensions are unavailable (`rectHeight <= 0`).
 */
export function mapCssToDeviceY(
  cssY: number,
  rectHeight: number,
  transform: ViewportTransform,
): number {
  if (rectHeight > 0 && Number.isFinite(rectHeight)) {
    return (cssY / rectHeight) * transform.deviceHeight;
  }
  return cssY * transform.dpr;
}

/**
 * Maps a device-pixel X coordinate back to container-local CSS pixels for overlay positioning.
 */
export function mapDeviceToCssX(
  deviceX: number,
  rectWidth: number,
  transform: ViewportTransform,
): number {
  if (rectWidth > 0 && Number.isFinite(rectWidth) && transform.deviceWidth > 0) {
    return (deviceX / transform.deviceWidth) * rectWidth;
  }
  return transform.dpr > 0 ? deviceX / transform.dpr : deviceX;
}

/**
 * Maps a device-pixel Y coordinate back to container-local CSS pixels for overlay positioning.
 */
export function mapDeviceToCssY(
  deviceY: number,
  rectHeight: number,
  transform: ViewportTransform,
): number {
  if (rectHeight > 0 && Number.isFinite(rectHeight) && transform.deviceHeight > 0) {
    return (deviceY / transform.deviceHeight) * rectHeight;
  }
  return transform.dpr > 0 ? deviceY / transform.dpr : deviceY;
}
