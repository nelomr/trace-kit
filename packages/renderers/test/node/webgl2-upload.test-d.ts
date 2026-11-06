// Type-only fixture: the upload's axis kind is required, so a call site cannot silently keep the
// linear-only gap rule. Never executed by Vitest; type-checked by `tsc --noEmit`.
import { Y_SCALE_KIND_LINEAR, type SpectrumDataPayload } from "@trace-kit/core";
import type { Gl2Context } from "../../src/webgl2/gl-context.js";
import type { TraceGpuSlot } from "../../src/webgl2/trace-slot.js";
import { ensureTraceUploaded } from "../../src/webgl2/upload.js";

declare const gl: Gl2Context;
declare const slot: TraceGpuSlot;
declare const payload: SpectrumDataPayload;

// @ts-expect-error — `yScaleKind` is required, there is no linear default.
ensureTraceUploaded(gl, slot, payload, 800, null, true);
ensureTraceUploaded(gl, slot, payload, 800, null, true, Y_SCALE_KIND_LINEAR);
