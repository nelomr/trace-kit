// Type-only fixture (branded-buffers spec's "Mutually incompatible buffer brands are not
// assignable" and both Retained/Transit scenarios). This file is never executed by Vitest;
// its only purpose is to be type-checked by `tsc --noEmit`.
import type {
  Retained,
  Transit,
  XBuffer,
  YBuffer,
} from "../../src/buffers/brand.js";

declare function acceptsXBuffer(buf: XBuffer): void;
declare function submitToPool(buf: Transit<Float32Array>): void;
declare function readFromPayload(buf: Retained<Float32Array>): void;

declare const yBuffer: YBuffer;
declare const retainedFloat32: Retained<Float32Array>;
declare const transitFloat32: Transit<Float32Array>;

// @ts-expect-error — YBuffer's axis tag is 'y', not 'x'; axis brands must not be assignable.
acceptsXBuffer(yBuffer);
// @ts-expect-error — ownership tag is 'retained', not 'transit'; Retained must not satisfy Transit.
submitToPool(retainedFloat32);
// @ts-expect-error — ownership tag is 'transit', not 'retained'; Transit must not satisfy Retained.
readFromPayload(transitFloat32);
