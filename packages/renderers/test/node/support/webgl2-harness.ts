/**
 * Builds a `WebGL2FigureRenderer` over three fake surfaces whose contexts all write into one
 * ordered log, so a test can assert the layer order across the 2D underlay, the GL plot canvas and
 * the 2D overlay in a single sequence.
 */
import type { RecordedCall } from "./recording-context.js";
import { FakeSurface, asSurface } from "./fake-surface.js";
import { RecordingGl2Context, type RecordingGl2Options } from "./recording-gl2-context.js";
import { RecordingOverlayContext } from "./recording-overlay-context.js";
import {
  WebGL2FigureRenderer,
  type WebGL2FigureRendererOptions,
} from "../../../src/webgl2/webgl2-figure-renderer.js";

export interface Harness {
  readonly renderer: WebGL2FigureRenderer;
  readonly log: RecordedCall[];
  readonly gl: RecordingGl2Context;
  readonly underlayContext: RecordingOverlayContext;
  readonly overlayContext: RecordingOverlayContext;
  readonly underlay: FakeSurface<RecordingOverlayContext>;
  readonly plot: FakeSurface<RecordingGl2Context>;
  readonly overlay: FakeSurface<RecordingOverlayContext>;
}

export interface HarnessOptions {
  readonly glOptions?: RecordingGl2Options;
  readonly rendererOptions?: Omit<WebGL2FigureRendererOptions, "surfaces">;
}

export interface Parts {
  readonly log: RecordedCall[];
  readonly gl: RecordingGl2Context;
  readonly underlayContext: RecordingOverlayContext;
  readonly overlayContext: RecordingOverlayContext;
  readonly underlay: FakeSurface<RecordingOverlayContext>;
  readonly plot: FakeSurface<RecordingGl2Context>;
  readonly overlay: FakeSurface<RecordingOverlayContext>;
}

export function createParts(glOptions: RecordingGl2Options = {}): Parts {
  const log: RecordedCall[] = [];
  const gl = new RecordingGl2Context({ log, ...glOptions });
  const underlayContext = new RecordingOverlayContext(log);
  const overlayContext = new RecordingOverlayContext(log);
  return {
    log,
    gl,
    underlayContext,
    overlayContext,
    underlay: new FakeSurface(underlayContext),
    plot: new FakeSurface(gl),
    overlay: new FakeSurface(overlayContext),
  };
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const parts = createParts(options.glOptions);
  const renderer = new WebGL2FigureRenderer({
    ...options.rendererOptions,
    surfaces: {
      underlay: asSurface(parts.underlay),
      plot: asSurface(parts.plot),
      overlay: asSurface(parts.overlay),
    },
  });
  return { renderer, ...parts };
}
