import {
  asIndexBuffer,
  asYBuffer,
  commitPayloadRevision,
  createSpectrumDataPayload,
  lttb,
  minMaxEnvelope,
  type IndexBuffer,
  type SpectrumDataPayload,
  type YBuffer,
} from "@trace-kit/core";
import { Canvas2DRenderer, type AxisLayout, type FigureStyle } from "@trace-kit/renderers";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";
import { withBindingScope } from "../../shell/binding-scope.js";
import { generateLorentzian, type LorentzianParams } from "./lorentzian.js";
import { validateRun, MAX_OUT_ELEMENTS, MAX_SAMPLES } from "./validate-run.js";
import { measureRunMs } from "./timing.js";

export type AlgorithmKind = "lttb" | "min-max";

/** Floor for the plot height so a short viewport still yields a readable figure. */
const MIN_PLOT_HEIGHT = 240;
/** Breathing room kept below the canvas so the page never gains a scrollbar of its own. */
const VIEWPORT_GUTTER = 24;

/**
 * Fallback figure tokens, used whenever a custom property is absent (e.g. `tokens.css` isn't
 * loaded, as in a DOM test that mounts this view directly without `shell/bootstrap.ts`'s CSS
 * imports). These mirror `tokens.css`'s own values, not `DEFAULT_FIGURE_STYLE`'s smaller
 * font — the point of this bridge is a bigger, CSS-driven label size even when the stylesheet
 * is missing.
 */
const FALLBACK_LABEL_FONT_SIZE = "13px";
const FALLBACK_LABEL_FONT_FAMILY = "system-ui, sans-serif";
const FALLBACK_TRACE_COLOR = "#3fb6ff";
const FALLBACK_GRID_COLOR = "#1c2530";
const FALLBACK_AXIS_COLOR = "#3a4756";
const FALLBACK_LABEL_COLOR = "#8a97a8";
const FALLBACK_BACKGROUND_COLOR = "#0b0f14";

/**
 * Extra CSS pixels reserved below/left of `tickLength` for the label text itself, on top of
 * `computeAxisInsets`'s own font-size term — kept larger than the library default (14) so the
 * bigger token-driven label font in `tokens.css` isn't clipped against the plot area.
 */
const LABEL_GUTTER_CSS = 18;

/**
 * Reads the figure's CSS custom properties off `document.documentElement` exactly once, at
 * mount time: the renderer itself must never read style, because `getComputedStyle` forces
 * layout and does not exist on `OffscreenCanvas`. An absent or empty custom property (unset, or the
 * stylesheet not loaded at all) falls back to the same value `tokens.css` declares, so this
 * function behaves identically whether or not `bootstrap.ts`'s CSS imports ran.
 */
function readFigureTokensFromCss(): {
  style: Partial<FigureStyle>;
  axes: Partial<AxisLayout>;
} {
  const computed = getComputedStyle(document.documentElement);
  function token(name: string, fallback: string): string {
    const value = computed.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  }

  const fontSize = token("--tk-figure-label-font-size", FALLBACK_LABEL_FONT_SIZE);
  const fontFamily = token("--tk-figure-label-font-family", FALLBACK_LABEL_FONT_FAMILY);

  return {
    style: {
      backgroundColor: token("--tk-color-bg", FALLBACK_BACKGROUND_COLOR),
      traceColor: token("--tk-color-accent", FALLBACK_TRACE_COLOR),
      gridColor: token("--tk-color-grid", FALLBACK_GRID_COLOR),
      axisColor: token("--tk-color-axis", FALLBACK_AXIS_COLOR),
      labelColor: token("--tk-color-label", FALLBACK_LABEL_COLOR),
      // `computeAxisInsets` parses the leading `<n>px` token out of this string — keep the
      // size expressed in `px`, never `rem`/`em`, or the inset math silently falls back to 10.
      font: `${fontSize} ${fontFamily}`,
    },
    axes: {
      labelGutter: LABEL_GUTTER_CSS,
    },
  };
}

export interface RunReadout {
  kind: AlgorithmKind;
  view: IndexBuffer | YBuffer;
  length: number;
  timingMs: number;
}

export interface CoreMathState {
  readonly payload: SpectrumDataPayload;
  readonly lttbOut: IndexBuffer;
  readonly minMaxOut: YBuffer;
  readonly readout: RunReadout;
  sampleCount: number;
  /** Regenerates the signal in place and commits a new payload revision. */
  regenerate(params: LorentzianParams, rawSampleCount: number): void;
  /** Dispatches to the selected algorithm through `validateRun`; mutates `readout` in place. */
  run(kind: AlgorithmKind, rawControlValue: number): RunReadout;
  /**
   * Re-runs the current `readout.kind` through the shared warm-up + median-of-N harness and
   * stores the result in `readout.timingMs`. Allocates (the harness's own sample bookkeeping
   * does), so it is never called from the zero-allocation toggle path in `run`.
   */
  measureTiming(): number;
}

/**
 * The payload-ownership + control->algorithm portion of the `/core-math` view, separated from
 * DOM wiring so it is exercisable from a Node test with no
 * `happy-dom` canvas limitation. `payload.x`/`payload.y` are allocated once, here, at the
 * compile-time maximum; no later call in this module reallocates them — `regenerate` writes
 * into the same buffers and commits a new revision instead.
 */
export function createCoreMathState(): CoreMathState {
  const payload = createSpectrumDataPayload({
    capacity: MAX_SAMPLES,
    xOrigin: 0,
    xUnit: "index",
    yUnit: "a.u.",
  });
  const outStore = new ArrayBuffer(MAX_OUT_ELEMENTS * 4);
  const lttbOut = asIndexBuffer(new Int32Array(outStore));
  const minMaxOut = asYBuffer(new Float32Array(outStore));

  const readout: RunReadout = { kind: "lttb", view: lttbOut, length: 0, timingMs: 0 };
  const state: CoreMathState = {
    payload,
    lttbOut,
    minMaxOut,
    readout,
    sampleCount: 2,
    regenerate(params, rawSampleCount) {
      const { sampleCount } = validateRun(rawSampleCount, 2, 1);
      state.sampleCount = sampleCount;
      generateLorentzian(payload.x, payload.y, sampleCount, params);
      commitPayloadRevision(payload, sampleCount);
    },
    run(kind, rawControlValue) {
      // The interactive toggle path itself stays allocation-free — no benchmark harness call
      // here. The millisecond table is a deliberately separate, explicitly-invoked measurement
      // (`measureTiming`), because `runBenchmark`'s own sample bookkeeping allocates and must
      // not be conflated with "toggling the algorithm allocates nothing".
      const { sampleCount, threshold, bucketCount } = validateRun(
        state.sampleCount,
        kind === "lttb" ? rawControlValue : 2,
        kind === "min-max" ? rawControlValue : 1,
      );
      state.sampleCount = sampleCount;

      if (kind === "lttb") {
        const length = lttb(payload.x, payload.y, 0, sampleCount, lttbOut, 0, threshold);
        readout.kind = "lttb";
        readout.view = lttbOut;
        readout.length = length;
      } else {
        const length = minMaxEnvelope(payload.y, 0, sampleCount, minMaxOut, 0, bucketCount);
        readout.kind = "min-max";
        readout.view = minMaxOut;
        readout.length = length;
      }
      return readout;
    },
    measureTiming() {
      const sampleCount = state.sampleCount;
      const name = readout.kind === "lttb" ? "core-math-lttb" : "core-math-min-max";
      const timingMs =
        readout.kind === "lttb"
          ? measureRunMs(name, () => {
              lttb(payload.x, payload.y, 0, sampleCount, lttbOut, 0, readout.length);
            })
          : measureRunMs(name, () => {
              minMaxEnvelope(payload.y, 0, sampleCount, minMaxOut, 0, readout.length / 2);
            });
      readout.timingMs = timingMs;
      return timingMs;
    },
  };
  return state;
}

/**
 * Watches `devicePixelRatio` changes via a `matchMedia` query keyed to the current ratio.
 * A `resolution`-based media query only fires once the ratio it was built against stops
 * matching, so the listener recreates the query against the new ratio on every change —
 * there is no single query that stays valid across a `dpr` change.
 */
function watchDevicePixelRatio(onChange: (dpr: number) => void, signal: AbortSignal): void {
  function arm(): void {
    const dpr = window.devicePixelRatio || 1;
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener(
      "change",
      () => {
        onChange(window.devicePixelRatio || 1);
        arm();
      },
      { signal, once: true },
    );
  }
  arm();
}

/**
 * DOM mount entry for the `/core-math` view: registers panel bindings for FWHM, noise floor,
 * `sampleCount`, the LTTB/Min-Max toggle, and the algorithm's own control (threshold or
 * bucketCount), and wires a `Canvas2DRenderer` against a real `<canvas>` element — owning
 * `ResizeObserver`-driven `resize()` calls and `devicePixelRatio` observation, the adapter
 * responsibilities the renderer contract itself never performs. Returns the teardown that
 * reverses everything mount did.
 */
export function mount(host: ViewHost): ViewTeardown {
  const state = createCoreMathState();
  const params: LorentzianParams & { threshold: number; bucketCount: number } = {
    seed: 1,
    centerFrequency: 500,
    fwhm: 50,
    noiseFloor: 0.02,
    threshold: 500,
    bucketCount: 200,
  };
  const controlState = { sampleCount: 10_000, mode: "lttb" as AlgorithmKind };

  state.regenerate(params, controlState.sampleCount);
  state.run(controlState.mode, params.threshold);

  const scope = withBindingScope(host.panel);
  scope.addBinding(params, "fwhm", { min: 1, max: 500, step: 1 });
  scope.addBinding(params, "noiseFloor", { min: 0, max: 1, step: 0.01 });
  scope.addBinding(controlState, "sampleCount", { min: 2, max: 1_000_000, step: 1 });
  scope.addBinding(controlState, "mode", {
    options: { lttb: "lttb", "min-max": "min-max" },
  });
  scope.addBinding(params, "threshold", { min: 2, max: MAX_OUT_ELEMENTS, step: 1 });
  scope.addBinding(params, "bucketCount", { min: 1, max: MAX_OUT_ELEMENTS / 2, step: 1 });

  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  host.container.appendChild(canvas);

  const { style, axes } = readFigureTokensFromCss();
  const renderer = new Canvas2DRenderer({ surface: canvas, style, axes });
  renderer.setData(state.payload);

  function currentDomain(): { xMin: number; xMax: number; yMin: number; yMax: number } {
    const { payload } = state;
    if (payload.sampleCount === 0 || Number.isNaN(payload.yMin)) {
      return { xMin: 0, xMax: 1, yMin: -1, yMax: 1 };
    }
    const ySpan = payload.yMax - payload.yMin;
    const yPad = ySpan === 0 ? 1 : ySpan * 0.1;
    return {
      xMin: payload.xMin,
      xMax: payload.xMax,
      yMin: payload.yMin - yPad,
      yMax: payload.yMax + yPad,
    };
  }

  function paint(): void {
    const domain = currentDomain();
    renderer.setDomain(domain.xMin, domain.xMax, domain.yMin, domain.yMax);
    renderer.render();
  }

  let currentDpr = window.devicePixelRatio || 1;
  function resizeToContainer(): void {
    // `resize` only sets the backing-store attributes, which are dpr-scaled; without an
    // explicit CSS size the element would lay out at that device-pixel count and overflow on
    // any dpr > 1. Width is delegated to the content box rather than `clientWidth`, which
    // counts the container's padding and would overflow by exactly that much.
    canvas.style.width = "100%";
    const box = canvas.getBoundingClientRect();
    const width = box.width || 640;
    // The container has no intrinsic height — its own content defines it — so reading
    // `clientHeight` would feed the canvas its own size back. The viewport remainder below
    // the canvas's top edge is the independent measure.
    const height = Math.max(MIN_PLOT_HEIGHT, window.innerHeight - box.top - VIEWPORT_GUTTER);
    canvas.style.height = `${height}px`;
    renderer.resize(width, height, currentDpr);
    paint();
  }

  const resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(host.container);
  // The observer above only reports container-box changes; a viewport height change leaves
  // that box untouched while the height this view derives from it does change.
  window.addEventListener("resize", resizeToContainer, { signal: host.signal });
  watchDevicePixelRatio((dpr) => {
    currentDpr = dpr;
    resizeToContainer();
  }, host.signal);

  resizeToContainer();

  // Drives both the timing readout (via `state.run`/`measureTiming`) and the renderer's
  // decimation selection (via `renderer.setDecimation`) from the same `controlState`/`params`
  // fields — they must not diverge, since a user toggling `mode`/`threshold`/`bucketCount`
  // expects the drawn trace to reflect the same choice the readout table reports.
  function regenerateAndRun(): void {
    state.regenerate(params, controlState.sampleCount);
    state.run(
      controlState.mode,
      controlState.mode === "lttb" ? params.threshold : params.bucketCount,
    );
    state.measureTiming();
    renderer.setDecimation(
      controlState.mode === "lttb"
        ? { algorithm: "lttb", threshold: params.threshold }
        : { algorithm: "min-max", bucketCount: params.bucketCount },
    );
    paint();
  }

  host.panel.on("change", regenerateAndRun);

  return () => {
    resizeObserver.disconnect();
    host.panel.off("change", regenerateAndRun);
    scope.disposeAll();
    renderer.dispose();
    canvas.remove();
  };
}
