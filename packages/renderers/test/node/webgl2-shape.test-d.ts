// Type-only fixture: the narrow `Gl2Context` seam the renderer is written against must be a
// subset of the real `WebGL2RenderingContext`, so a real context can be passed wherever the
// recording fake can. Never executed by Vitest; only type-checked by `tsc --noEmit`.
import type { Gl2Context } from "../../src/webgl2/gl-context.js";

declare const real: WebGL2RenderingContext;
export const acceptsRealContext: Gl2Context = real;
