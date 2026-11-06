// Type-only fixture: the walk's axis kind is required, so a call site cannot silently keep the
// linear-only gap rule. Never executed by Vitest; type-checked by `tsc --noEmit`.
import { Y_SCALE_KIND_LINEAR } from "@trace-kit/core";
import {
  collectIsolatedSampleIndices,
  countIsolatedSegments,
} from "../../src/path/isolated-markers.js";

const x = new Float32Array(3);
const y = new Float32Array(3);
const indices = new Int32Array(0);
const out = new Int32Array(3);

// @ts-expect-error — `yScaleKind` is required, there is no linear default.
countIsolatedSegments(x, y, indices, 0, 3);
countIsolatedSegments(x, y, indices, 0, 3, Y_SCALE_KIND_LINEAR);

// @ts-expect-error — `yScaleKind` is required before the output buffer.
collectIsolatedSampleIndices(x, y, indices, 0, 3, out);
collectIsolatedSampleIndices(x, y, indices, 0, 3, Y_SCALE_KIND_LINEAR, out);
