/**
 * Pure, DOM-free, zero-allocation viewport interaction math: cursor-anchored wheel zoom,
 * snapshot-based drag-pan, plot-clamped box-zoom and domain clamping, in IEEE-754 binary64 against
 * a `ViewportTransform`, with first-class base-10 logarithmic Y support.
 *
 * Every mutation writes scalar results directly into a caller-owned out-parameter (`out`) and
 * returns a `boolean`. There are no module-level mutable variables, no loops, no object or array
 * allocations, no closures, and no newly-computed float64 values passed across helper call
 * boundaries (preventing V8 HeapNumber boxing even when TurboFan does not inline a helper).
 *
 * Numerical stance:
 * - Zoom places the new minimum at `min + u * (S - S')` rather than `anchor - (anchor - min) * f`,
 *   because at an absolute X near `1550 nm` the latter subtracts two nearly equal values.
 * - Drag-pan is computed from a snapshot captured once at `pointerdown`, never by integrating
 *   per-frame deltas, so returning to the start pixel restores the start domain bit-for-bit and
 *   no rounding drift accumulates over a long drag.
 * - Logarithmic Y is always mutated in decade space (`log10`), then exponentiated and clamped to
 *   `[1e-300, 1e300]` so `createViewportTransform` can never see a non-positive or non-finite Y.
 */
import {
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
} from "./transform.js";

export const AXIS_MASK_NONE = 0;
export const AXIS_MASK_X = 1;
export const AXIS_MASK_Y = 2;
export const AXIS_MASK_XY = 3;

export type AxisMask = 0 | 1 | 2 | 3;

/** Built-in float64 ULP safety floor multiplier: `max(|min|, |max|, 1) * 1e-12`. */
export const ULP_MIN_SPAN_FACTOR = 1e-12;
/** Minimum permitted base-10 exponent for logarithmic Y domains (`1e-300`). */
export const LOG_EXPONENT_MIN = -300;
/** Maximum permitted base-10 exponent for logarithmic Y domains (`1e300`). */
export const LOG_EXPONENT_MAX = 300;
/** Default minimum decade span on logarithmic Y axes. */
export const DEFAULT_MIN_LOG_DECADES_Y = 1e-6;

const LOG_VALUE_MIN = 1e-300;
const LOG_VALUE_MAX = 1e300;
const LOG_ULP_DECADE_FLOOR = 1e-12;
/**
 * Head-room over the ULP floor. A span recomputed as `max - min` after the domain endpoints are
 * rounded to the float64 grid can differ from the requested span by about one grid step, i.e. up
 * to `~2.2e-4` of the floor near `1550`. The guard keeps the *observed* span at or above
 * `computeUlpMinSpan` instead of straddling it.
 */
const ULP_FLOOR_GUARD = 1.001;

/** Caller-owned mutable out-parameter written in place by viewport interaction math. */
export interface MutableViewportDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Optional hard outer domain boundaries for clamping pan, zoom, and box-zoom mutations. */
export interface ViewportDomainBounds {
  readonly xMin?: number;
  readonly xMax?: number;
  readonly yMin?: number;
  readonly yMax?: number;
}

/** Optional domain/span clamping constraints shared across all interactive and programmatic mutations. */
export interface ViewportDomainConstraints {
  readonly bounds?: ViewportDomainBounds;
  readonly minSpanX?: number;
  readonly maxSpanX?: number;
  readonly minSpanY?: number;
  readonly maxSpanY?: number;
  /** Minimum base-10 decade span on `Y_SCALE_KIND_LOG` axes. Default: `1e-6`. */
  readonly minLogDecadesY?: number;
}

/** Caller-owned snapshot captured once at `pointerdown` to make drag-pan drift-free. */
export interface PanGestureSnapshot {
  startDeviceX: number;
  startDeviceY: number;
  startXMin: number;
  startXMax: number;
  startYMin: number;
  startYMax: number;
  startPlotWidth: number;
  startPlotHeight: number;
  startYScaleKind: number;
  startYLogMin: number;
  startYLogMax: number;
}

/** Cold-path factory returning `{ xMin, xMax, yMin, yMax }`. */
export function createMutableViewportDomain(
  xMin = 0,
  xMax = 1,
  yMin = -1,
  yMax = 1,
): MutableViewportDomain {
  return { xMin, xMax, yMin, yMax };
}

/** Cold-path factory returning a zero-initialized pan snapshot. */
export function createPanGestureSnapshot(): PanGestureSnapshot {
  return {
    startDeviceX: 0,
    startDeviceY: 0,
    startXMin: 0,
    startXMax: 0,
    startYMin: 0,
    startYMax: 0,
    startPlotWidth: 0,
    startPlotHeight: 0,
    startYScaleKind: 0,
    startYLogMin: 0,
    startYLogMax: 0,
  };
}

/**
 * Copies the transform state a drag-pan needs into `out` at `pointerdown`. On a log axis with a
 * positive domain the decade bounds are recorded too; otherwise they are `0`.
 */
export function capturePanGestureSnapshot(
  transform: ViewportTransform,
  startDeviceX: number,
  startDeviceY: number,
  out: PanGestureSnapshot,
): PanGestureSnapshot {
  out.startDeviceX = startDeviceX;
  out.startDeviceY = startDeviceY;
  out.startXMin = transform.xDomainMin;
  out.startXMax = transform.xDomainMax;
  out.startYMin = transform.yDomainMin;
  out.startYMax = transform.yDomainMax;
  out.startPlotWidth = transform.plotWidth;
  out.startPlotHeight = transform.plotHeight;
  out.startYScaleKind = transform.yScaleKind;
  if (
    transform.yScaleKind === Y_SCALE_KIND_LOG &&
    transform.yDomainMin > 0 &&
    transform.yDomainMax > 0
  ) {
    out.startYLogMin = transform.yLogDomainMin;
    out.startYLogMax = Math.log10(transform.yDomainMax);
  } else {
    out.startYLogMin = 0;
    out.startYLogMax = 0;
  }
  return out;
}

/** Built-in float64 ULP safety floor: `max(|domainMin|, |domainMax|, 1) * 1e-12`. */
export function computeUlpMinSpan(domainMin: number, domainMax: number): number {
  return Math.max(Math.abs(domainMin), Math.abs(domainMax), 1) * ULP_MIN_SPAN_FACTOR;
}

// ---------------------------------------------------------------------------------------------
// Internal scalar helpers — each helper is self-contained (zero nested calls passing computed
// doubles) and writes directly into `out.xMin/xMax` or `out.yMin/yMax`.
// ---------------------------------------------------------------------------------------------

/** Clamps `out.xMin/xMax` (when `writeX`) or `out.yMin/yMax` in place for a linear axis. */
function clampLinearInPlace(
  out: MutableViewportDomain,
  writeX: boolean,
  constraints: ViewportDomainConstraints | undefined,
  preserveSpan: boolean,
): boolean {
  const min = writeX ? out.xMin : out.yMin;
  const max = writeX ? out.xMax : out.yMax;
  if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) return false;

  const bounds = constraints === undefined ? undefined : constraints.bounds;
  const boundMinOpt = bounds === undefined ? undefined : writeX ? bounds.xMin : bounds.yMin;
  const boundMaxOpt = bounds === undefined ? undefined : writeX ? bounds.xMax : bounds.yMax;
  const hasBoundMin = boundMinOpt !== undefined && Number.isFinite(boundMinOpt);
  const hasBoundMax = boundMaxOpt !== undefined && Number.isFinite(boundMaxOpt);
  const boundMin = hasBoundMin ? boundMinOpt : Number.NEGATIVE_INFINITY;
  const boundMax = hasBoundMax ? boundMaxOpt : Number.POSITIVE_INFINITY;

  let nextMin = min;
  let nextMax = max;
  if (!preserveSpan) {
    const absMin = min < 0 ? -min : min;
    const absMax = max < 0 ? -max : max;
    const maxAbs = absMin > absMax ? (absMin > 1 ? absMin : 1) : absMax > 1 ? absMax : 1;
    const floor = maxAbs * ULP_MIN_SPAN_FACTOR * ULP_FLOOR_GUARD;

    const minSpanOpt =
      constraints === undefined ? undefined : writeX ? constraints.minSpanX : constraints.minSpanY;
    const maxSpanOpt =
      constraints === undefined ? undefined : writeX ? constraints.maxSpanX : constraints.maxSpanY;
    let limitLo =
      minSpanOpt !== undefined &&
      minSpanOpt > 0 &&
      minSpanOpt < Number.POSITIVE_INFINITY &&
      minSpanOpt > floor
        ? minSpanOpt
        : floor;
    let limitHi =
      maxSpanOpt !== undefined && maxSpanOpt > 0 && maxSpanOpt < Number.POSITIVE_INFINITY
        ? maxSpanOpt
        : Number.POSITIVE_INFINITY;
    if (limitHi < limitLo) limitHi = limitLo;
    if (hasBoundMin && hasBoundMax) {
      const boundSpan = boundMax - boundMin;
      if (boundSpan > 0) {
        if (limitHi > boundSpan) limitHi = boundSpan;
        if (limitLo > boundSpan) limitLo = boundSpan;
      }
    }
    const span = max - min;
    const clamped = span < limitLo ? limitLo : span > limitHi ? limitHi : span;
    if (clamped !== span) {
      const center = (min + max) * 0.5;
      nextMin = center - clamped * 0.5;
      nextMax = nextMin + clamped;
    }
  }

  const finalSpan = nextMax - nextMin;
  let lo = nextMin;
  let hi = nextMax;
  if (finalSpan >= boundMax - boundMin) {
    lo = boundMin;
    hi = boundMax;
  } else if (nextMin < boundMin) {
    lo = boundMin;
    hi = boundMin + finalSpan;
    if (hi > boundMax) hi = boundMax;
  } else if (nextMax > boundMax) {
    hi = boundMax;
    lo = boundMax - finalSpan;
    if (lo < boundMin) lo = boundMin;
  }
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return false;
  if (lo === min && hi === max) return true;
  if (writeX) {
    out.xMin = lo;
    out.xMax = hi;
  } else {
    out.yMin = lo;
    out.yMax = hi;
  }
  return true;
}

/** Clamps `out.yMin/yMax` in place for a logarithmic Y axis in decade space. */
function clampLogYInPlace(
  out: MutableViewportDomain,
  constraints: ViewportDomainConstraints | undefined,
  preserveSpan: boolean,
): boolean {
  const yMin = out.yMin;
  const yMax = out.yMax;
  if (!(Number.isFinite(yMin) && Number.isFinite(yMax) && yMin > 0 && yMax > yMin)) {
    return false;
  }
  const bounds = constraints === undefined ? undefined : constraints.bounds;
  const boundMinOpt = bounds === undefined ? undefined : bounds.yMin;
  const boundMaxOpt = bounds === undefined ? undefined : bounds.yMax;

  let expLo = LOG_EXPONENT_MIN;
  if (boundMinOpt !== undefined && boundMinOpt > 0 && boundMinOpt < Number.POSITIVE_INFINITY) {
    const exponent = Math.log10(boundMinOpt);
    if (exponent > expLo) expLo = exponent;
  }
  let expHi = LOG_EXPONENT_MAX;
  if (boundMaxOpt !== undefined && boundMaxOpt > 0 && boundMaxOpt < Number.POSITIVE_INFINITY) {
    const exponent = Math.log10(boundMaxOpt);
    if (exponent < expHi) expHi = exponent;
  }
  if (!(expHi > expLo)) return false;

  const maxDecades = expHi - expLo;
  const minLogOpt = constraints === undefined ? undefined : constraints.minLogDecadesY;
  let minDecades =
    minLogOpt !== undefined && minLogOpt > 0 && minLogOpt < Number.POSITIVE_INFINITY
      ? minLogOpt
      : DEFAULT_MIN_LOG_DECADES_Y;
  if (minDecades < LOG_ULP_DECADE_FLOOR) minDecades = LOG_ULP_DECADE_FLOOR;
  if (minDecades > maxDecades) minDecades = maxDecades;

  const startLogMin = Math.log10(yMin);
  const startLogMax = Math.log10(yMax);
  let lMin = startLogMin;
  let lMax = startLogMax;
  if (!preserveSpan) {
    const decades = lMax - lMin;
    const clamped =
      decades < minDecades ? minDecades : decades > maxDecades ? maxDecades : decades;
    if (clamped !== decades) {
      const center = (lMin + lMax) * 0.5;
      lMin = center - clamped * 0.5;
      lMax = lMin + clamped;
    }
  }

  const span = lMax - lMin;
  let slidLo = lMin;
  let slidHi = lMax;
  if (span >= expHi - expLo) {
    slidLo = expLo;
    slidHi = expHi;
  } else if (lMin < expLo) {
    slidLo = expLo;
    slidHi = expLo + span;
    if (slidHi > expHi) slidHi = expHi;
  } else if (lMax > expHi) {
    slidHi = expHi;
    slidLo = expHi - span;
    if (slidLo < expLo) slidLo = expLo;
  }

  if (slidLo === startLogMin && slidHi === startLogMax) {
    return true;
  }

  let lo = 10 ** slidLo;
  if (lo < LOG_VALUE_MIN) lo = LOG_VALUE_MIN;
  let hi = 10 ** slidHi;
  if (hi > LOG_VALUE_MAX) hi = LOG_VALUE_MAX;
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo)) return false;
  out.yMin = lo;
  out.yMax = hi;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Public hot-path functions
// ---------------------------------------------------------------------------------------------

/**
 * Validates and clamps both axes of `domain` in place (X linear; Y linear or logarithmic per
 * `yScaleKind`). Returns `false`, leaving `domain` untouched, when either axis is non-finite,
 * inverted or zero-span, or when a log-Y minimum is not strictly positive. `preserveSpan`
 * slides the domain into the bounds instead of shrinking it and skips span limits.
 */
export function clampViewportDomain(
  domain: MutableViewportDomain,
  yScaleKind: number,
  constraints: ViewportDomainConstraints | undefined,
  preserveSpan: boolean,
): boolean {
  const prevXMin = domain.xMin;
  const prevXMax = domain.xMax;
  if (!clampLinearInPlace(domain, true, constraints, preserveSpan)) {
    return false;
  }

  const yOk =
    yScaleKind === Y_SCALE_KIND_LOG
      ? clampLogYInPlace(domain, constraints, preserveSpan)
      : clampLinearInPlace(domain, false, constraints, preserveSpan);
  if (!yOk) {
    domain.xMin = prevXMin;
    domain.xMax = prevXMax;
    return false;
  }

  return true;
}

/**
 * Cursor-anchored zoom. `out` starts at the transform's domain; each enabled, valid axis is then
 * replaced with its zoomed domain (the anchor's data value stays under the cursor). A degenerate
 * axis is left untouched. Returns `true` iff at least one axis actually changed.
 */
export function computeZoomDomain(
  transform: ViewportTransform,
  factorX: number,
  factorY: number,
  anchorDeviceX: number,
  anchorDeviceY: number,
  axisMask: AxisMask,
  constraints: ViewportDomainConstraints | undefined,
  out: MutableViewportDomain,
): boolean {
  const xMin = transform.xDomainMin;
  const xMax = transform.xDomainMax;
  const yMin = transform.yDomainMin;
  const yMax = transform.yDomainMax;
  out.xMin = xMin;
  out.xMax = xMax;
  out.yMin = yMin;
  out.yMax = yMax;

  const bounds = constraints === undefined ? undefined : constraints.bounds;
  let changed = false;

  if (
    (axisMask & AXIS_MASK_X) !== 0 &&
    transform.plotWidth > 0 &&
    Number.isFinite(factorX) &&
    factorX > 0 &&
    Number.isFinite(anchorDeviceX) &&
    Number.isFinite(xMin) &&
    Number.isFinite(xMax) &&
    xMax > xMin
  ) {
    const rawU = (anchorDeviceX - transform.plotLeft) / transform.plotWidth;
    const u = rawU > 0 ? (rawU < 1 ? rawU : 1) : 0;

    const absMin = xMin < 0 ? -xMin : xMin;
    const absMax = xMax < 0 ? -xMax : xMax;
    const maxAbs = absMin > absMax ? (absMin > 1 ? absMin : 1) : absMax > 1 ? absMax : 1;
    const floor = maxAbs * ULP_MIN_SPAN_FACTOR * ULP_FLOOR_GUARD;

    const minSpanOpt = constraints === undefined ? undefined : constraints.minSpanX;
    const maxSpanOpt = constraints === undefined ? undefined : constraints.maxSpanX;
    let limitLo =
      minSpanOpt !== undefined &&
      minSpanOpt > 0 &&
      minSpanOpt < Number.POSITIVE_INFINITY &&
      minSpanOpt > floor
        ? minSpanOpt
        : floor;
    let limitHi =
      maxSpanOpt !== undefined && maxSpanOpt > 0 && maxSpanOpt < Number.POSITIVE_INFINITY
        ? maxSpanOpt
        : Number.POSITIVE_INFINITY;
    if (limitHi < limitLo) limitHi = limitLo;

    const boundMinOpt = bounds === undefined ? undefined : bounds.xMin;
    const boundMaxOpt = bounds === undefined ? undefined : bounds.xMax;
    const hasBoundMin = boundMinOpt !== undefined && Number.isFinite(boundMinOpt);
    const hasBoundMax = boundMaxOpt !== undefined && Number.isFinite(boundMaxOpt);
    const boundMin = hasBoundMin ? boundMinOpt : Number.NEGATIVE_INFINITY;
    const boundMax = hasBoundMax ? boundMaxOpt : Number.POSITIVE_INFINITY;
    if (hasBoundMin && hasBoundMax) {
      const boundSpan = boundMax - boundMin;
      if (boundSpan > 0) {
        if (limitHi > boundSpan) limitHi = boundSpan;
        if (limitLo > boundSpan) limitLo = boundSpan;
      }
    }

    const span = xMax - xMin;
    let nextSpan = span * factorX;
    if (nextSpan < limitLo) nextSpan = limitLo;
    else if (nextSpan > limitHi) nextSpan = limitHi;
    const nextMin = xMin + u * (span - nextSpan);
    const nextMax = nextMin + nextSpan;

    let lo = nextMin;
    let hi = nextMax;
    if (nextSpan >= boundMax - boundMin) {
      lo = boundMin;
      hi = boundMax;
    } else if (nextMin < boundMin) {
      lo = boundMin;
      hi = boundMin + nextSpan;
      if (hi > boundMax) hi = boundMax;
    } else if (nextMax > boundMax) {
      hi = boundMax;
      lo = boundMax - nextSpan;
      if (lo < boundMin) lo = boundMin;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      out.xMin = lo;
      out.xMax = hi;
      if (lo !== xMin || hi !== xMax) changed = true;
    }
  }

  if (
    (axisMask & AXIS_MASK_Y) !== 0 &&
    transform.plotHeight > 0 &&
    Number.isFinite(factorY) &&
    factorY > 0 &&
    Number.isFinite(anchorDeviceY) &&
    Number.isFinite(yMin) &&
    Number.isFinite(yMax) &&
    yMax > yMin
  ) {
    const rawU = (transform.plotTop + transform.plotHeight - anchorDeviceY) / transform.plotHeight;
    const u = rawU > 0 ? (rawU < 1 ? rawU : 1) : 0;
    const boundMinOpt = bounds === undefined ? undefined : bounds.yMin;
    const boundMaxOpt = bounds === undefined ? undefined : bounds.yMax;

    if (transform.yScaleKind === Y_SCALE_KIND_LOG) {
      const logMin = transform.yLogDomainMin;
      const logMax = Math.log10(yMax);
      const decades = logMax - logMin;
      if (decades > 0 && Number.isFinite(decades) && yMin > 0) {
        let expLo = LOG_EXPONENT_MIN;
        if (boundMinOpt !== undefined && boundMinOpt > 0 && boundMinOpt < Number.POSITIVE_INFINITY) {
          const exponent = Math.log10(boundMinOpt);
          if (exponent > expLo) expLo = exponent;
        }
        let expHi = LOG_EXPONENT_MAX;
        if (boundMaxOpt !== undefined && boundMaxOpt > 0 && boundMaxOpt < Number.POSITIVE_INFINITY) {
          const exponent = Math.log10(boundMaxOpt);
          if (exponent < expHi) expHi = exponent;
        }
        if (expHi > expLo) {
          const maxDecades = expHi - expLo;
          const minLogOpt = constraints === undefined ? undefined : constraints.minLogDecadesY;
          let minDecades =
            minLogOpt !== undefined && minLogOpt > 0 && minLogOpt < Number.POSITIVE_INFINITY
              ? minLogOpt
              : DEFAULT_MIN_LOG_DECADES_Y;
          if (minDecades < LOG_ULP_DECADE_FLOOR) minDecades = LOG_ULP_DECADE_FLOOR;
          if (minDecades > maxDecades) minDecades = maxDecades;

          let nextDecades = decades * factorY;
          if (nextDecades < minDecades) nextDecades = minDecades;
          else if (nextDecades > maxDecades) nextDecades = maxDecades;
          const nextLogMin = logMin + u * (decades - nextDecades);
          const nextLogMax = nextLogMin + nextDecades;

          let slidLo = nextLogMin;
          let slidHi = nextLogMax;
          if (nextDecades >= expHi - expLo) {
            slidLo = expLo;
            slidHi = expHi;
          } else if (nextLogMin < expLo) {
            slidLo = expLo;
            slidHi = expLo + nextDecades;
            if (slidHi > expHi) slidHi = expHi;
          } else if (nextLogMax > expHi) {
            slidHi = expHi;
            slidLo = expHi - nextDecades;
            if (slidLo < expLo) slidLo = expLo;
          }

          let lo = 10 ** slidLo;
          if (lo < LOG_VALUE_MIN) lo = LOG_VALUE_MIN;
          let hi = 10 ** slidHi;
          if (hi > LOG_VALUE_MAX) hi = LOG_VALUE_MAX;
          if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo) {
            out.yMin = lo;
            out.yMax = hi;
            if (lo !== yMin || hi !== yMax) changed = true;
          }
        }
      }
    } else {
      const absMin = yMin < 0 ? -yMin : yMin;
      const absMax = yMax < 0 ? -yMax : yMax;
      const maxAbs = absMin > absMax ? (absMin > 1 ? absMin : 1) : absMax > 1 ? absMax : 1;
      const floor = maxAbs * ULP_MIN_SPAN_FACTOR * ULP_FLOOR_GUARD;

      const minSpanOpt = constraints === undefined ? undefined : constraints.minSpanY;
      const maxSpanOpt = constraints === undefined ? undefined : constraints.maxSpanY;
      let limitLo =
        minSpanOpt !== undefined &&
        minSpanOpt > 0 &&
        minSpanOpt < Number.POSITIVE_INFINITY &&
        minSpanOpt > floor
          ? minSpanOpt
          : floor;
      let limitHi =
        maxSpanOpt !== undefined && maxSpanOpt > 0 && maxSpanOpt < Number.POSITIVE_INFINITY
          ? maxSpanOpt
          : Number.POSITIVE_INFINITY;
      if (limitHi < limitLo) limitHi = limitLo;

      const hasBoundMin = boundMinOpt !== undefined && Number.isFinite(boundMinOpt);
      const hasBoundMax = boundMaxOpt !== undefined && Number.isFinite(boundMaxOpt);
      const boundMin = hasBoundMin ? boundMinOpt : Number.NEGATIVE_INFINITY;
      const boundMax = hasBoundMax ? boundMaxOpt : Number.POSITIVE_INFINITY;
      if (hasBoundMin && hasBoundMax) {
        const boundSpan = boundMax - boundMin;
        if (boundSpan > 0) {
          if (limitHi > boundSpan) limitHi = boundSpan;
          if (limitLo > boundSpan) limitLo = boundSpan;
        }
      }

      const span = yMax - yMin;
      let nextSpan = span * factorY;
      if (nextSpan < limitLo) nextSpan = limitLo;
      else if (nextSpan > limitHi) nextSpan = limitHi;
      const nextMin = yMin + u * (span - nextSpan);
      const nextMax = nextMin + nextSpan;

      let lo = nextMin;
      let hi = nextMax;
      if (nextSpan >= boundMax - boundMin) {
        lo = boundMin;
        hi = boundMax;
      } else if (nextMin < boundMin) {
        lo = boundMin;
        hi = boundMin + nextSpan;
        if (hi > boundMax) hi = boundMax;
      } else if (nextMax > boundMax) {
        hi = boundMax;
        lo = boundMax - nextSpan;
        if (lo < boundMin) lo = boundMin;
      }
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        out.yMin = lo;
        out.yMax = hi;
        if (lo !== yMin || hi !== yMax) changed = true;
      }
    }
  }

  return changed;
}

/**
 * Drag-pan from a `pointerdown` snapshot. The domain is recomputed from the snapshot and the
 * total pointer displacement on every call, so returning to the start pixel restores the start
 * domain exactly. Returns `true` iff at least one enabled axis was valid and evaluated cleanly,
 * including a zero displacement.
 */
export function computePanDomain(
  snapshot: PanGestureSnapshot,
  currentDeviceX: number,
  currentDeviceY: number,
  axisMask: AxisMask,
  constraints: ViewportDomainConstraints | undefined,
  out: MutableViewportDomain,
): boolean {
  const startXMin = snapshot.startXMin;
  const startXMax = snapshot.startXMax;
  const startYMin = snapshot.startYMin;
  const startYMax = snapshot.startYMax;
  out.xMin = startXMin;
  out.xMax = startXMax;
  out.yMin = startYMin;
  out.yMax = startYMax;

  const bounds = constraints === undefined ? undefined : constraints.bounds;
  let evaluated = false;

  if (
    (axisMask & AXIS_MASK_X) !== 0 &&
    snapshot.startPlotWidth > 0 &&
    Number.isFinite(startXMin) &&
    Number.isFinite(startXMax) &&
    startXMax > startXMin &&
    Number.isFinite(currentDeviceX)
  ) {
    const displacement = currentDeviceX - snapshot.startDeviceX;
    let nextMin = startXMin;
    let nextMax = startXMax;
    if (displacement !== 0) {
      const shift = (-displacement * (startXMax - startXMin)) / snapshot.startPlotWidth;
      nextMin = startXMin + shift;
      nextMax = startXMax + shift;
    }
    const boundMinOpt = bounds === undefined ? undefined : bounds.xMin;
    const boundMaxOpt = bounds === undefined ? undefined : bounds.xMax;
    const boundMin =
      boundMinOpt !== undefined && Number.isFinite(boundMinOpt)
        ? boundMinOpt
        : Number.NEGATIVE_INFINITY;
    const boundMax =
      boundMaxOpt !== undefined && Number.isFinite(boundMaxOpt)
        ? boundMaxOpt
        : Number.POSITIVE_INFINITY;
    const span = nextMax - nextMin;
    let lo = nextMin;
    let hi = nextMax;
    if (span >= boundMax - boundMin) {
      lo = boundMin;
      hi = boundMax;
    } else if (nextMin < boundMin) {
      lo = boundMin;
      hi = boundMin + span;
      if (hi > boundMax) hi = boundMax;
    } else if (nextMax > boundMax) {
      hi = boundMax;
      lo = boundMax - span;
      if (lo < boundMin) lo = boundMin;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      out.xMin = lo;
      out.xMax = hi;
      evaluated = true;
    }
  }

  if (
    (axisMask & AXIS_MASK_Y) !== 0 &&
    snapshot.startPlotHeight > 0 &&
    Number.isFinite(startYMin) &&
    Number.isFinite(startYMax) &&
    startYMax > startYMin &&
    Number.isFinite(currentDeviceY)
  ) {
    const displacement = currentDeviceY - snapshot.startDeviceY;
    const boundMinOpt = bounds === undefined ? undefined : bounds.yMin;
    const boundMaxOpt = bounds === undefined ? undefined : bounds.yMax;

    if (snapshot.startYScaleKind === Y_SCALE_KIND_LOG) {
      const startLogMin = snapshot.startYLogMin;
      const startLogMax = snapshot.startYLogMax;
      if (startYMin > 0 && startLogMax > startLogMin) {
        let expLo = LOG_EXPONENT_MIN;
        if (boundMinOpt !== undefined && boundMinOpt > 0 && boundMinOpt < Number.POSITIVE_INFINITY) {
          const exponent = Math.log10(boundMinOpt);
          if (exponent > expLo) expLo = exponent;
        }
        let expHi = LOG_EXPONENT_MAX;
        if (boundMaxOpt !== undefined && boundMaxOpt > 0 && boundMaxOpt < Number.POSITIVE_INFINITY) {
          const exponent = Math.log10(boundMaxOpt);
          if (exponent < expHi) expHi = exponent;
        }
        if (expHi > expLo) {
          let nextLogMin = startLogMin;
          let nextLogMax = startLogMax;
          if (displacement !== 0) {
            const shift =
              (displacement * (startLogMax - startLogMin)) / snapshot.startPlotHeight;
            nextLogMin = startLogMin + shift;
            nextLogMax = startLogMax + shift;
          }
          const span = nextLogMax - nextLogMin;
          let slidLo = nextLogMin;
          let slidHi = nextLogMax;
          if (span >= expHi - expLo) {
            slidLo = expLo;
            slidHi = expHi;
          } else if (nextLogMin < expLo) {
            slidLo = expLo;
            slidHi = expLo + span;
            if (slidHi > expHi) slidHi = expHi;
          } else if (nextLogMax > expHi) {
            slidHi = expHi;
            slidLo = expHi - span;
            if (slidLo < expLo) slidLo = expLo;
          }
          if (slidLo === startLogMin && slidHi === startLogMax) {
            evaluated = true;
          } else {
            let lo = 10 ** slidLo;
            if (lo < LOG_VALUE_MIN) lo = LOG_VALUE_MIN;
            let hi = 10 ** slidHi;
            if (hi > LOG_VALUE_MAX) hi = LOG_VALUE_MAX;
            if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo) {
              out.yMin = lo;
              out.yMax = hi;
              evaluated = true;
            }
          }
        }
      }
    } else {
      let nextMin = startYMin;
      let nextMax = startYMax;
      if (displacement !== 0) {
        const shift = (displacement * (startYMax - startYMin)) / snapshot.startPlotHeight;
        nextMin = startYMin + shift;
        nextMax = startYMax + shift;
      }
      const boundMin =
        boundMinOpt !== undefined && Number.isFinite(boundMinOpt)
          ? boundMinOpt
          : Number.NEGATIVE_INFINITY;
      const boundMax =
        boundMaxOpt !== undefined && Number.isFinite(boundMaxOpt)
          ? boundMaxOpt
          : Number.POSITIVE_INFINITY;
      const span = nextMax - nextMin;
      let lo = nextMin;
      let hi = nextMax;
      if (span >= boundMax - boundMin) {
        lo = boundMin;
        hi = boundMax;
      } else if (nextMin < boundMin) {
        lo = boundMin;
        hi = boundMin + span;
        if (hi > boundMax) hi = boundMax;
      } else if (nextMax > boundMax) {
        hi = boundMax;
        lo = boundMax - span;
        if (lo < boundMin) lo = boundMin;
      }
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        out.yMin = lo;
        out.yMax = hi;
        evaluated = true;
      }
    }
  }

  return evaluated;
}

/**
 * Plot-clamped box-zoom. Both corners are clamped into the plot rectangle and sorted, so all four
 * sweep directions yield the same domain. `out` is written only once every enabled axis has
 * validated (with any disabled axis copied directly from `transform`, matching `computeZoomDomain`
 * and `computePanDomain`); otherwise it is left untouched and `false` is returned (zero-extent box
 * included).
 */
export function computeBoxZoomDomain(
  transform: ViewportTransform,
  startDeviceX: number,
  startDeviceY: number,
  endDeviceX: number,
  endDeviceY: number,
  axisMask: AxisMask,
  constraints: ViewportDomainConstraints | undefined,
  out: MutableViewportDomain,
): boolean {
  if (axisMask === AXIS_MASK_NONE) return false;
  if (
    !(
      Number.isFinite(startDeviceX) &&
      Number.isFinite(startDeviceY) &&
      Number.isFinite(endDeviceX) &&
      Number.isFinite(endDeviceY)
    )
  ) {
    return false;
  }
  const enableX = (axisMask & AXIS_MASK_X) !== 0;
  const enableY = (axisMask & AXIS_MASK_Y) !== 0;
  if (enableX && !(transform.plotWidth > 0)) return false;
  if (enableY && !(transform.plotHeight > 0)) return false;

  const plotLeft = transform.plotLeft;
  const plotRight = plotLeft + transform.plotWidth;
  const plotTop = transform.plotTop;
  const plotBottom = plotTop + transform.plotHeight;

  const cx0 = startDeviceX < plotLeft ? plotLeft : startDeviceX > plotRight ? plotRight : startDeviceX;
  const cx1 = endDeviceX < plotLeft ? plotLeft : endDeviceX > plotRight ? plotRight : endDeviceX;
  const cy0 = startDeviceY < plotTop ? plotTop : startDeviceY > plotBottom ? plotBottom : startDeviceY;
  const cy1 = endDeviceY < plotTop ? plotTop : endDeviceY > plotBottom ? plotBottom : endDeviceY;

  const leftPx = cx0 < cx1 ? cx0 : cx1;
  const rightPx = cx0 < cx1 ? cx1 : cx0;
  const topPx = cy0 < cy1 ? cy0 : cy1;
  const bottomPx = cy0 < cy1 ? cy1 : cy0;

  if (enableX && rightPx <= leftPx) return false;
  if (enableY && bottomPx <= topPx) return false;

  const prevXMin = out.xMin;
  const prevXMax = out.xMax;
  const prevYMin = out.yMin;
  const prevYMax = out.yMax;

  if (enableX) {
    const xScale = transform.xScale;
    out.xMin =
      xScale === 0 ? transform.xDomainMin : transform.xDomainMin + (leftPx - plotLeft) / xScale;
    out.xMax =
      xScale === 0 ? transform.xDomainMin : transform.xDomainMin + (rightPx - plotLeft) / xScale;
    if (!clampLinearInPlace(out, true, constraints, false)) {
      out.xMin = prevXMin;
      out.xMax = prevXMax;
      return false;
    }
  }

  if (enableY) {
    let ok: boolean;
    if (transform.yScaleKind === Y_SCALE_KIND_LOG) {
      const yLogScale = transform.yLogScale;
      if (yLogScale === 0) {
        out.yMin = transform.yDomainMin;
        out.yMax = transform.yDomainMin;
      } else {
        out.yMin = 10 ** ((transform.yBase - bottomPx) / yLogScale + transform.yLogDomainMin);
        out.yMax = 10 ** ((transform.yBase - topPx) / yLogScale + transform.yLogDomainMin);
      }
      ok = clampLogYInPlace(out, constraints, false);
    } else {
      const yScale = transform.yScale;
      out.yMin = yScale === 0 ? transform.yDomainMin : (transform.yBase - bottomPx) / yScale;
      out.yMax = yScale === 0 ? transform.yDomainMin : (transform.yBase - topPx) / yScale;
      ok = clampLinearInPlace(out, false, constraints, false);
    }
    if (!ok) {
      out.xMin = prevXMin;
      out.xMax = prevXMax;
      out.yMin = prevYMin;
      out.yMax = prevYMax;
      return false;
    }
  }

  if (!enableX) {
    out.xMin = transform.xDomainMin;
    out.xMax = transform.xDomainMax;
  }
  if (!enableY) {
    out.yMin = transform.yDomainMin;
    out.yMax = transform.yDomainMax;
  }

  return true;
}
