/**
 * `SpectrumDataPayload` — the domain model owned by `@trace-kit/core`.
 *
 * A flat interface: typed arrays and numbers, no nested object, no class, no getter, no
 * method. That flatness is what lets a Vue `markRaw`/`shallowRef` or a React `useRef`
 * isolate it in one line, and it is what gives the payload a single, stable V8 hidden class
 * for the life of the process.
 */
import {
  allocateXBuffer,
  allocateYBuffer,
  type IndexBuffer,
  type Retained,
  type XBuffer,
  type YBuffer,
} from "../buffers/brand.js";
// `Retained`, `XBuffer`, `YBuffer` remain imported for the interface's own type annotations
// below even though the factory itself needs no assertion against them.

export interface SpectrumDataPayload {
  /** Capacity-sized. Holds X **offsets from `xOrigin`**, not absolute X. */
  readonly x: Retained<XBuffer>;
  /** Capacity-sized. Holds Y samples. */
  readonly y: Retained<YBuffer>;
  /** `x.length === y.length === capacity`. Fixed for the payload's lifetime. */
  readonly capacity: number;
  /** f64 origin the f32 X offsets are relative to. Fixed for the payload's lifetime. */
  readonly xOrigin: number;
  readonly xUnit: string;
  readonly yUnit: string;

  /** Length of the valid data prefix. Consumers read only `[0, sampleCount)`. */
  readonly sampleCount: number;
  /** Monotonic. Increments on every authoritative mutation. Never decreases, never resets. */
  readonly revision: number;

  /** Extents over `[0, sampleCount)` at the current `revision`. NaN when `sampleCount === 0`. */
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * The mutable twin of `SpectrumDataPayload`. Never part of the public export surface
 * (branded-buffers spec's "Public Export Surface", spectrum-data-payload spec's "mutable
 * payload type is not part of the public export surface").
 */
export interface MutableSpectrumDataPayload
  extends Omit<
    SpectrumDataPayload,
    "sampleCount" | "revision" | "xMin" | "xMax" | "yMin" | "yMax"
  > {
  sampleCount: number;
  revision: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Cold-path result envelope. Constructed once per consumer, reused across frames. */
export interface DecimationResultCursor {
  indices: IndexBuffer;
  count: number;
  sourceRevision: number;
}

export interface CreateSpectrumDataPayloadOptions {
  capacity: number;
  xOrigin: number;
  xUnit: string;
  yUnit: string;
}

/**
 * The only authorized construction path for a `SpectrumDataPayload`. Returns the mutable
 * shape typed as the readonly interface — legal because `readonly` modifiers are not checked
 * in assignability, so no assertion is used.
 */
export function createSpectrumDataPayload(
  options: CreateSpectrumDataPayloadOptions,
): SpectrumDataPayload {
  const { capacity, xOrigin, xUnit, yUnit } = options;

  const payload: MutableSpectrumDataPayload = {
    x: allocateXBuffer(capacity),
    y: allocateYBuffer(capacity),
    capacity,
    xOrigin,
    xUnit,
    yUnit,
    sampleCount: 0,
    revision: 0,
    xMin: NaN,
    xMax: NaN,
    yMin: NaN,
    yMax: NaN,
  };

  return payload;
}

/**
 * The only authorized mutation entry point (spectrum-data-payload spec's "Monotonic Revision
 * Field, Mutated Only Through commitPayloadRevision"). Validates `sampleCount` against the
 * payload's fixed `capacity`, writes the new `sampleCount`, recomputes the four extents over
 * `[0, sampleCount)`, and increments `revision` by exactly `1`. `xOrigin` is untouched.
 */
export function commitPayloadRevision(
  payload: MutableSpectrumDataPayload,
  sampleCount: number,
): void {
  if (
    !Number.isInteger(sampleCount) ||
    sampleCount < 0 ||
    sampleCount > payload.capacity
  ) {
    throw new RangeError(
      `sampleCount must be an integer in [0, capacity=${payload.capacity}]; received ${sampleCount}.`,
    );
  }

  payload.sampleCount = sampleCount;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (let i = 0; i < sampleCount; i += 1) {
    const xValue = payload.x[i];
    const yValue = payload.y[i];
    if (xValue !== undefined) {
      if (xValue < xMin) xMin = xValue;
      if (xValue > xMax) xMax = xValue;
    }
    if (yValue !== undefined) {
      if (yValue < yMin) yMin = yValue;
      if (yValue > yMax) yMax = yValue;
    }
  }

  payload.xMin = sampleCount === 0 ? NaN : xMin;
  payload.xMax = sampleCount === 0 ? NaN : xMax;
  payload.yMin = sampleCount === 0 ? NaN : yMin;
  payload.yMax = sampleCount === 0 ? NaN : yMax;
  payload.revision += 1;
}

/**
 * Guards an LTTB `DecimationResultCursor` against reuse from a stale revision
 * (spectrum-data-payload spec's "LTTB Indices Valid Only Against Their Producing Revision").
 */
export function isCursorCurrent(
  cursor: DecimationResultCursor,
  payload: SpectrumDataPayload,
): boolean {
  return cursor.sourceRevision === payload.revision;
}
