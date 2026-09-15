import {
  allocateXBuffer,
  allocateYBuffer,
  asIndexBuffer,
  asYBuffer,
  lttb,
  minMaxEnvelope,
  type IndexBuffer,
  type XBuffer,
  type YBuffer,
} from "@trace-kit/core";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";
import { withBindingScope } from "../../shell/binding-scope.js";
import { drawPolyline } from "../../throwaway-plot/draw.js";
import { generateLorentzian, type LorentzianParams } from "./lorentzian.js";
import { validateRun, MAX_OUT_ELEMENTS, MAX_SAMPLES } from "./validate-run.js";
import { measureRunMs } from "./timing.js";

export type AlgorithmKind = "lttb" | "min-max";

export interface RunReadout {
  kind: AlgorithmKind;
  view: IndexBuffer | YBuffer;
  length: number;
  timingMs: number;
}

export interface CoreMathState {
  readonly xBuffer: XBuffer;
  readonly yBuffer: YBuffer;
  readonly lttbOut: IndexBuffer;
  readonly minMaxOut: YBuffer;
  readonly readout: RunReadout;
  sampleCount: number;
  /** Regenerates the signal in place; does not reallocate `xBuffer`/`yBuffer`. */
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
 * The buffer-ownership + control->algorithm portion of the `/core-math` view (design.md §D10,
 * §D11), separated from DOM wiring so it is exercisable from a Node test with no `happy-dom`
 * canvas limitation. Every buffer is allocated once, here, at the compile-time maximum; no
 * later call in this module reallocates.
 */
export function createCoreMathState(): CoreMathState {
  const xBuffer = allocateXBuffer(MAX_SAMPLES);
  const yBuffer = allocateYBuffer(MAX_SAMPLES);
  const outStore = new ArrayBuffer(MAX_OUT_ELEMENTS * 4);
  const lttbOut = asIndexBuffer(new Int32Array(outStore));
  const minMaxOut = asYBuffer(new Float32Array(outStore));

  const readout: RunReadout = { kind: "lttb", view: lttbOut, length: 0, timingMs: 0 };
  const state: CoreMathState = {
    xBuffer,
    yBuffer,
    lttbOut,
    minMaxOut,
    readout,
    sampleCount: 2,
    regenerate(params, rawSampleCount) {
      const { sampleCount } = validateRun(rawSampleCount, 2, 1);
      state.sampleCount = sampleCount;
      generateLorentzian(xBuffer, yBuffer, sampleCount, params);
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
        const length = lttb(xBuffer, yBuffer, 0, sampleCount, lttbOut, 0, threshold);
        readout.kind = "lttb";
        readout.view = lttbOut;
        readout.length = length;
      } else {
        const length = minMaxEnvelope(yBuffer, 0, sampleCount, minMaxOut, 0, bucketCount);
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
              lttb(xBuffer, yBuffer, 0, sampleCount, lttbOut, 0, readout.length);
            })
          : measureRunMs(name, () => {
              minMaxEnvelope(yBuffer, 0, sampleCount, minMaxOut, 0, readout.length / 2);
            });
      readout.timingMs = timingMs;
      return timingMs;
    },
  };
  return state;
}

/**
 * DOM mount entry for the `/core-math` view: registers panel bindings for FWHM, noise floor,
 * `sampleCount`, the LTTB/Min-Max toggle, and the algorithm's own control (threshold or
 * bucketCount), and wires a `requestAnimationFrame`-driven draw loop against the throwaway
 * plot. Returns the teardown that reverses everything mount did.
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

  function regenerateAndRun(): void {
    state.regenerate(params, controlState.sampleCount);
    state.run(
      controlState.mode,
      controlState.mode === "lttb" ? params.threshold : params.bucketCount,
    );
    state.measureTiming();
  }

  host.panel.on("change", regenerateAndRun);

  const canvas = document.createElement("canvas");
  canvas.width = host.container.clientWidth || 640;
  canvas.height = 320;
  host.container.appendChild(canvas);

  const resizeObserver = new ResizeObserver(() => {
    canvas.width = host.container.clientWidth || canvas.width;
  });
  resizeObserver.observe(host.container);

  // A reusable index axis for the throwaway plot's x-values, sized to the output buffers'
  // shared capacity and filled once — the draw loop never allocates a fresh array per frame.
  const indexAxis = new Float32Array(MAX_OUT_ELEMENTS);
  for (let i = 0; i < indexAxis.length; i += 1) {
    indexAxis[i] = i;
  }

  let rafHandle = -1;
  function frame(): void {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const xRange = { min: 0, max: canvas.width };
      const yRange = { min: canvas.height, max: 0 };
      // The LTTB output is a set of absolute sample indices, not a dense pixel-space series;
      // this throwaway routine only plots the Min-Max envelope, which is already in the right
      // shape. A full renderer (outside this directory) resolves the LTTB indirection.
      if (state.readout.kind === "min-max") {
        const yDomain = { min: -0.2, max: 1.2 };
        const xDomain = { min: 0, max: state.readout.length / 2 };
        drawPolyline(
          ctx,
          indexAxis,
          state.minMaxOut,
          state.readout.length,
          xDomain,
          yDomain,
          xRange,
          yRange,
        );
      }
    }
    rafHandle = requestAnimationFrame(frame);
  }
  rafHandle = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafHandle);
    resizeObserver.disconnect();
    host.panel.off("change", regenerateAndRun);
    scope.disposeAll();
    canvas.remove();
  };
}
