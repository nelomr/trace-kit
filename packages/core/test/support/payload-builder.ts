import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type MutableSpectrumDataPayload,
  type SpectrumDataPayload,
} from "../../src/payload/spectrum-data-payload.js";

export interface BuildPayloadOptions {
  /** X offsets from `xOrigin`, stored as f32. */
  readonly x: ArrayLike<number>;
  /** Y samples; defaults to the sample index. */
  readonly y?: ArrayLike<number>;
  readonly xOrigin?: number;
  /** Capacity of the buffers; defaults to the sample count. Anything beyond it is a stale tail. */
  readonly capacity?: number;
  /** Value written into the unused tail of both buffers (proves `sampleCount` bounds every read). */
  readonly staleTail?: number;
}

/** Builds a committed payload of `x.length` valid samples inside a possibly larger buffer. */
export function buildPayload(options: BuildPayloadOptions): SpectrumDataPayload {
  const count = options.x.length;
  const capacity = options.capacity ?? count;
  const payload = createSpectrumDataPayload({
    capacity,
    xOrigin: options.xOrigin ?? 0,
    xUnit: "nm",
    yUnit: "dBm",
  }) as MutableSpectrumDataPayload;
  if (options.staleTail !== undefined) {
    payload.x.fill(options.staleTail);
    payload.y.fill(options.staleTail);
  }
  for (let i = 0; i < count; i += 1) {
    payload.x[i] = options.x[i] ?? 0;
    payload.y[i] = options.y?.[i] ?? i;
  }
  commitPayloadRevision(payload, count);
  return payload;
}

/** Payload whose absolute X equals `absolute` exactly (zero origin, f32-representable inputs). */
export function payloadFromAbsoluteX(absolute: ArrayLike<number>): SpectrumDataPayload {
  return buildPayload({ x: absolute });
}
