import { RecordingContext, type RecordedCall } from "./recording-context.js";

/**
 * `RecordingContext` writing into a caller-supplied log, plus a logged `clearRect`. Sharing the log
 * with a `RecordingGl2Context` yields one ordered sequence across the 2D underlay, the GL plot and
 * the 2D overlay; `overlay.clearRect` is the marker that the overlay's calls begin. The base class
 * is left alone so every Canvas2D suite keeps its exact surface.
 */
export class RecordingOverlayContext extends RecordingContext {
  override readonly calls: RecordedCall[];

  constructor(log: RecordedCall[]) {
    super();
    this.calls = log;
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ name: "overlay.clearRect", args: [x, y, w, h] });
  }
}
