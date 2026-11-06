// Type-only fixture: the trace section is bracketed in a clip, so the drawing seam must expose the
// four state/clip members with the exact DOM shapes, and both real 2D contexts must still satisfy
// it without a cast. Never executed by Vitest; type-checked by `tsc --noEmit`.
import type { TraceDrawingContext } from "../../src/surface.js";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type SaveShape = Assert<Equal<TraceDrawingContext["save"], () => void>>;
export type RestoreShape = Assert<Equal<TraceDrawingContext["restore"], () => void>>;
export type RectShape = Assert<
  Equal<TraceDrawingContext["rect"], (x: number, y: number, w: number, h: number) => void>
>;
export type ClipShape = Assert<Equal<TraceDrawingContext["clip"], () => void>>;

declare const domContext: CanvasRenderingContext2D;
declare const offscreenContext: OffscreenCanvasRenderingContext2D;
export const fromDom: TraceDrawingContext = domContext;
export const fromOffscreen: TraceDrawingContext = offscreenContext;
