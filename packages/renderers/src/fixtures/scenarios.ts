/**
 * Parity-minimal render-scenario fixtures (P4): the five payloads change 7
 * (`renderers-webgl2`) will need to compare a WebGL2 backend's output against, and this
 * change's own visual-regression goldens are generated against. Shipped as published package
 * source — reachable through the stable `@trace-kit/renderers/fixtures` subpath — rather than
 * left under `test/`, so a later package's own test suite can import a fixture without a
 * relative path that reaches across package boundaries.
 *
 * Every field here is backend-agnostic: no field names Canvas2D or WebGL2, and `dpr` is a
 * plain numeric field driving `FigureRenderer.resize`'s own `dpr` parameter, never read from
 * `window.devicePixelRatio`. Every `payload` is a real, frozen `SpectrumDataPayload` built once
 * at module load, never re-allocated per import (this module is evaluated once per process).
 *
 * Every fixture renders at `800×400` CSS pixels at `dpr: 2`, except `decimation-minmax`, which
 * is the one `dpr: 1` fixture — its dpr path is covered by a golden rather than only by a
 * `resize` call assertion.
 *
 * Isolation note for future framework wrappers (Vue/React, later roadmap changes): a
 * `ScenarioFixture.payload` must never be wrapped in a deep-reactive proxy or a plain
 * `useState` — isolate it with `shallowRef`/`markRaw` (Vue) or keep it behind a `useRef`
 * (React), exactly as `DEFAULT_FIGURE_STYLE`'s own module documents for `FigureStyle`.
 */
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type SpectrumDataPayload,
} from "@trace-kit/core";

export interface ScenarioDomain {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface ScenarioViewport {
  /** CSS pixels. */
  readonly width: number;
  /** CSS pixels. */
  readonly height: number;
}

export interface ScenarioFixture {
  /** Stable, kebab-case identifier — also the golden PNG's file stem (no platform/browser
   * token; see `visual-golden-corpus`'s naming requirement). */
  readonly id: string;
  /** One of the five P4-agreed descriptions, verbatim. */
  readonly description: string;
  readonly payload: SpectrumDataPayload;
  readonly domain: ScenarioDomain;
  readonly viewport: ScenarioViewport;
  /** Plain numeric device-pixel-ratio hint, never read from a global. */
  readonly dpr: number;
}

const STANDARD_VIEWPORT: ScenarioViewport = { width: 800, height: 400 };

/** xorshift32, matching `apps/playground/src/views/core-math/lorentzian.ts`'s own generator —
 * deterministic across processes and platforms, which is the entire point of a fixture used to
 * produce a byte-stable golden image. */
function nextUint32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function buildLorentzianPayload(
  sampleCount: number,
  centerFrequency: number,
  fwhm: number,
  noiseFloor: number,
  seed: number,
): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 0,
    xUnit: "index",
    yUnit: "a.u.",
  });
  const halfWidth = fwhm / 2;
  const halfWidthSquared = halfWidth * halfWidth;
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const dx = i - centerFrequency;
    const lineshape = halfWidthSquared / (dx * dx + halfWidthSquared);
    prngState = nextUint32(prngState);
    const noise = (prngState / 0xffffffff) * 2 - 1;
    payload.x[i] = i;
    payload.y[i] = lineshape + noise * noiseFloor;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

function buildFlatNoisePayload(
  sampleCount: number,
  amplitude: number,
  seed: number,
): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 0,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = (prngState / 0xffffffff) * 2 - 1;
    payload.x[i] = i;
    payload.y[i] = noise * amplitude;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

/** A flat baseline with exactly one deliberate single-sample spike, so a Min-Max-decimated
 * render can be asserted to still show the spike as painted pixels — a naive uniform
 * sub-sample would drop a single-sample spike entirely, so this is the minimal fixture that
 * proves the envelope algorithm preserves it instead. */
function buildSingleSpikePayload(sampleCount: number, spikeIndex: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 0,
    xUnit: "index",
    yUnit: "a.u.",
  });
  for (let i = 0; i < sampleCount; i += 1) {
    payload.x[i] = i;
    payload.y[i] = i === spikeIndex ? 1 : 0;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

const smoothCurvePayload = buildLorentzianPayload(512, 256, 80, 0, 1);
const resonancePeakPayload = buildLorentzianPayload(4_096, 2_048, 60, 0, 7);
const noiseFloorPayload = buildFlatNoisePayload(8_192, 0.02, 13);
const decimationSpikePayload = buildSingleSpikePayload(200_000, 100_000);

export const SCENARIO_FIXTURES: readonly ScenarioFixture[] = Object.freeze([
  Object.freeze({
    id: "simple-trace",
    description: "simple trace",
    payload: smoothCurvePayload,
    domain: { xMin: 0, xMax: 512, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    id: "axes-grid",
    description: "axes with grid",
    payload: smoothCurvePayload,
    domain: { xMin: 0, xMax: 512, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    id: "resonance-peak",
    description: "resonance peak",
    // Domain clipped to roughly ±5 linewidths (fwhm=60) around the centre frequency (2048):
    // the golden only needs to assert the apex survives decimation, not the full flat wings
    // either side of it, so there is no reason to render domain the golden never inspects.
    domain: { xMin: 1_748, xMax: 2_348, yMin: -0.05, yMax: 1.05 },
    payload: resonancePeakPayload,
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    id: "noise-floor",
    description: "noise floor",
    payload: noiseFloorPayload,
    domain: { xMin: 0, xMax: 8_192, yMin: -0.05, yMax: 0.05 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    id: "decimation-minmax",
    description: "decimation case",
    payload: decimationSpikePayload,
    domain: { xMin: 0, xMax: 200_000, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 1,
  }),
]);
