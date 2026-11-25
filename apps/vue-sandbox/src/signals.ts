import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  type SpectrumDataPayload,
  type TraceCollection,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { ViewportDomain } from "@trace-kit/renderers/controller";
import { markRaw } from "vue";
import type { ResolvedScheme } from "./theme.ts";

export type ScenarioId = "fbg-1550" | "dwdm-40ch" | "live-60hz" | "log-y-mw";
export type AxisMode = "linear" | "log";

export const MIN_SAMPLES = 10_000;
export const MAX_SAMPLES = 250_000;
export const SAMPLE_STEP = 2_000;
export const HYSTERESIS_DOWN = 64_000;
export const HYSTERESIS_UP = 80_000;

export const SAMPLE_PRESETS: readonly number[] = Object.freeze([
  10_000,
  64_000,
  72_000,
  80_000,
  150_000,
  250_000,
]);

export const LINEAR_Y_AXES: readonly YAxisRegistration[] = Object.freeze([
  Object.freeze({
    id: "power-dbm",
    scaleKind: Y_SCALE_KIND_LINEAR,
    domainMin: -72,
    domainMax: 4,
    side: AXIS_SIDE_LEFT,
  }),
]);

export const LOG_Y_AXES: readonly YAxisRegistration[] = Object.freeze([
  Object.freeze({
    id: "power",
    scaleKind: Y_SCALE_KIND_LOG,
    domainMin: 1e-6,
    domainMax: 10,
    side: AXIS_SIDE_LEFT,
  }),
]);

export interface ScenarioDescriptor {
  readonly id: ScenarioId;
  readonly label: string;
  readonly shortBadge: string;
  readonly summary: string;
  readonly axisMode: AxisMode;
  readonly defaultSamples: number;
  readonly yUnit: string;
  readonly homeDomain: ViewportDomain;
  readonly yAxes: readonly YAxisRegistration[];
  readonly precisionZoomDomain?: ViewportDomain;
}

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDescriptor>> = Object.freeze({
  "fbg-1550": Object.freeze({
    id: "fbg-1550",
    label: "FBG 1550 nm",
    shortBadge: "f64 xOrigin",
    summary: "C-band π-shifted Fiber Bragg Grating array with sub-pm notch at 1550.0001 nm.",
    axisMode: "linear",
    defaultSamples: 120_000,
    yUnit: "dBm",
    homeDomain: Object.freeze({ xMin: 1549.999, xMax: 1550.003, yMin: -72, yMax: 4 }),
    yAxes: LINEAR_Y_AXES,
    precisionZoomDomain: Object.freeze({
      xMin: 1549.9999,
      xMax: 1550.0003,
      yMin: -66,
      yMax: 2,
    }),
  }),
  "dwdm-40ch": Object.freeze({
    id: "dwdm-40ch",
    label: "DWDM 40-Ch",
    shortBadge: "Multi-Trace",
    summary: "40-channel 100 GHz C-band comb comparing reference vs active sweep in the deadband.",
    axisMode: "linear",
    defaultSamples: 72_000,
    yUnit: "dBm",
    homeDomain: Object.freeze({ xMin: 1529.0, xMax: 1562.0, yMin: -72, yMax: 4 }),
    yAxes: LINEAR_Y_AXES,
  }),
  "live-60hz": Object.freeze({
    id: "live-60hz",
    label: "Live 60 Hz",
    shortBadge: "Zero-VDOM",
    summary: "In-place Retained buffer streaming via commitPayloadRevision + requestRender.",
    axisMode: "linear",
    defaultSamples: 96_000,
    yUnit: "dBm",
    homeDomain: Object.freeze({ xMin: 1550.0, xMax: 1554.0, yMin: -72, yMax: 4 }),
    yAxes: LINEAR_Y_AXES,
  }),
  "log-y-mw": Object.freeze({
    id: "log-y-mw",
    label: "Log-Y (mW)",
    shortBadge: "Log10 Axis",
    summary: "7-decade optical power spectrum (1e-6 to 10 mW) with log-space pan and zoom.",
    axisMode: "log",
    defaultSamples: 48_000,
    yUnit: "mW",
    homeDomain: Object.freeze({ xMin: 1550.0, xMax: 1570.0, yMin: 1e-6, yMax: 10 }),
    yAxes: LOG_Y_AXES,
  }),
});

export const SCENARIO_ORDER: readonly ScenarioId[] = Object.freeze([
  "fbg-1550",
  "dwdm-40ch",
  "live-60hz",
  "log-y-mw",
]);

function nextXorShift32(state: number): number {
  let x = state | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

export interface SignalPool {
  readonly fbgPayload: SpectrumDataPayload;
  readonly dwdmRefPayload: SpectrumDataPayload;
  readonly dwdmActivePayload: SpectrumDataPayload;
  readonly livePayload: SpectrumDataPayload;
  readonly logPayload: SpectrumDataPayload;
}

/**
 * Allocates all Retained signal buffers once up front (marked raw so Vue never proxies them).
 * Sample-count adjustments and 60 Hz streaming mutate these buffers in place via
 * `commitPayloadRevision(...)` with zero heap reallocations.
 */
export function createSignalPool(): SignalPool {
  const halfCapacity = Math.ceil(MAX_SAMPLES / 2);
  return markRaw({
    fbgPayload: markRaw(
      createSpectrumDataPayload({
        capacity: MAX_SAMPLES,
        xOrigin: 1549.999,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    dwdmRefPayload: markRaw(
      createSpectrumDataPayload({
        capacity: halfCapacity,
        xOrigin: 1529.0,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    dwdmActivePayload: markRaw(
      createSpectrumDataPayload({
        capacity: halfCapacity,
        xOrigin: 1529.0,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    livePayload: markRaw(
      createSpectrumDataPayload({
        capacity: MAX_SAMPLES,
        xOrigin: 1550.0,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    logPayload: markRaw(
      createSpectrumDataPayload({
        capacity: MAX_SAMPLES,
        xOrigin: 1550.0,
        xUnit: "nm",
        yUnit: "mW",
      }),
    ),
  });
}

/**
 * FBG 1550 nm: 5 C-band Bragg gratings spanning 1549.9990..1550.0030 nm.
 * Primary pi-phase-shifted grating sits at exact 1550.000100 nm (offset 0.001100 nm)
 * with a deep sub-picometer central notch and symmetric side-lobes.
 */
export function populateFbgScenario(payload: SpectrumDataPayload, sampleCount: number): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;
  const span = 0.004;
  const invDenom = span / Math.max(1, n - 1);
  let prng = 0x1550_f8a1;

  for (let i = 0; i < n; i += 1) {
    const offset = i * invDenom;
    x[i] = offset;

    // Primary pi-shifted FBG at 1550.000100 nm (offset 0.001100 nm)
    const dMain = offset - 0.0011;
    const uMain = dMain / 0.000095;
    const uNotch = dMain / 0.000011;
    const uSideL = (dMain + 0.000072) / 0.000016;
    const uSideR = (dMain - 0.000072) / 0.000016;
    const mainBroad = 58 / (1 + uMain * uMain);
    const piNotch = -46 / (1 + uNotch * uNotch);
    const sideLobes = 12 / (1 + uSideL * uSideL) + 11.5 / (1 + uSideR * uSideR);

    // Secondary Bragg grating array peaks across the 4 pm band
    const d2 = (offset - 0.00038) / 0.000055;
    const d3 = (offset - 0.00192) / 0.000062;
    const d4 = (offset - 0.00274) / 0.000048;
    const d5 = (offset - 0.00346) / 0.00007;
    const secondary =
      42 / (1 + d2 * d2) +
      49 / (1 + d3 * d3) +
      38 / (1 + d4 * d4) +
      44 / (1 + d5 * d5);

    const fpRipple = 1.6 * Math.sin(offset * 92_000);
    prng = nextXorShift32(prng);
    const noise = (prng / 4_294_967_296 - 0.5) * 2.1;

    y[i] = -64 + mainBroad + piNotch + sideLobes + secondary + fpRipple + noise;
  }

  commitPayloadRevision(payload, n);
}

/**
 * DWDM 40-Ch: two-trace TraceCollection (Reference + Active C-Band comb) spanning
 * 1529.0..1562.0 nm with 40 ITU-T 100 GHz (~0.80 nm) channels and realistic EDFA ASE floor.
 */
export function buildDwdmCollection(
  pool: SignalPool,
  totalSamples: number,
  scheme: ResolvedScheme,
): TraceCollection {
  const clamped = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, totalSamples));
  const refCount = Math.floor(clamped / 2);
  const activeCount = clamped - refCount;
  const span = 33.0;
  const channelSpacing = 0.8;
  const firstChannelOffset = 0.55;

  populateDwdmTrace(pool.dwdmRefPayload, refCount, span, firstChannelOffset, channelSpacing, false);
  populateDwdmTrace(
    pool.dwdmActivePayload,
    activeCount,
    span,
    firstChannelOffset,
    channelSpacing,
    true,
  );

  const activeColor = scheme === "dark" ? "#38bdf8" : "#0284c7";
  const refColor = scheme === "dark" ? "#f59e0b" : "#d97706";

  return markRaw(
    createTraceCollection(
      [
        {
          id: "reference",
          payload: pool.dwdmRefPayload,
          yAxisId: "power-dbm",
          style: {
            color: refColor,
            lineWidthCss: 1.2,
            dash: [5, 4],
          },
        },
        {
          id: "active",
          payload: pool.dwdmActivePayload,
          yAxisId: "power-dbm",
          style: {
            color: activeColor,
            lineWidthCss: 1.5,
          },
        },
      ],
      LINEAR_Y_AXES,
      1529.0,
      1562.0,
    ),
  );
}

function populateDwdmTrace(
  payload: SpectrumDataPayload,
  sampleCount: number,
  span: number,
  firstOffset: number,
  spacing: number,
  isActive: boolean,
): void {
  const n = Math.max(1000, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;
  const invDenom = span / Math.max(1, n - 1);
  let prng = isActive ? 0x40c4_a11e : 0x40c4_00ef;

  for (let i = 0; i < n; i += 1) {
    const offset = i * invDenom;
    x[i] = offset;

    // EDFA ASE floor with gentle C-band gain curvature
    const norm = offset / span;
    const aseBase = -59.5 + 3.2 * Math.sin(norm * Math.PI) + (isActive ? (norm - 0.5) * 2.8 : 0);

    // Nearest ITU-T 100 GHz channel index in [0, 39]
    const rawIdx = Math.round((offset - firstOffset) / spacing);
    let signal = 0;
    if (rawIdx >= 0 && rawIdx < 40) {
      const center = firstOffset + rawIdx * spacing;
      const drift = isActive && rawIdx === 28 ? 0.065 : 0;
      const d = (offset - (center + drift)) / 0.048;
      const d2 = d * d;
      // Flat-top super-Lorentzian optical channel profile
      let peakHeight = 52.0 - 1.8 * Math.abs(rawIdx - 19.5) * 0.14;
      if (isActive) {
        // Gain tilt + simulated channel impairments on ch 13 and ch 28
        peakHeight += (rawIdx - 20) * 0.11;
        if (rawIdx === 13) peakHeight -= 11.5;
        if (rawIdx === 28) peakHeight -= 6.2;
      }
      signal = peakHeight / (1 + d2 * d2);
    }

    prng = nextXorShift32(prng);
    const noise = (prng / 4_294_967_296 - 0.5) * (isActive ? 2.8 : 1.4);
    y[i] = aseBase + signal + noise;
  }

  commitPayloadRevision(payload, n);
}

/**
 * Live 60 Hz: prepares the X grid once per sample-count change, then updates Y in place
 * every animation frame using fast rational Lorentzians + inline xorshift32 shot noise.
 */
export function populateLiveGridX(payload: SpectrumDataPayload, sampleCount: number): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const invDenom = 4.0 / Math.max(1, n - 1);
  for (let i = 0; i < n; i += 1) {
    x[i] = i * invDenom;
  }
}

export function stepLiveSpectrum(
  payload: SpectrumDataPayload,
  sampleCount: number,
  elapsedSec: number,
  frameCounter: number,
): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;

  // Thermal wavelength drift + coupled cavity side-mode breathing
  const mainCenter = 1.85 + 0.24 * Math.sin(elapsedSec * 1.15);
  const sideACenter = mainCenter - 0.42 + 0.04 * Math.cos(elapsedSec * 2.3);
  const sideBCenter = mainCenter + 0.51 + 0.05 * Math.sin(elapsedSec * 1.85);
  const pumpCenter = 3.12 + 0.09 * Math.cos(elapsedSec * 0.9);
  const mainAmp = 57 + 4.5 * Math.sin(elapsedSec * 3.1);
  const sideAAmp = 33 + 6.5 * Math.cos(elapsedSec * 2.6);
  const sideBAmp = 28 + 5.2 * Math.sin(elapsedSec * 2.1 + 1.1);
  const pumpAmp = 44 + 3.2 * Math.cos(elapsedSec * 1.4);
  const floorShift = 1.4 * Math.sin(elapsedSec * 0.7);

  let prng = ((frameCounter * 2654435761) ^ 0x9e37_79b9) >>> 0;
  if (prng === 0) prng = 0x1357_9bdf;

  const invMainW = 1 / 0.032;
  const invSideW = 1 / 0.055;
  const invPumpW = 1 / 0.045;

  for (let i = 0; i < n; i += 1) {
    const xv = x[i] ?? 0;

    const dm = (xv - mainCenter) * invMainW;
    const da = (xv - sideACenter) * invSideW;
    const db = (xv - sideBCenter) * invSideW;
    const dp = (xv - pumpCenter) * invPumpW;

    const pMain = mainAmp / (1 + dm * dm);
    const pA = sideAAmp / (1 + da * da);
    const pB = sideBAmp / (1 + db * db);
    const pPump = pumpAmp / (1 + dp * dp);

    // Inline xorshift32 (zero call overhead in 60 Hz hot loop)
    prng ^= prng << 13;
    prng ^= prng >>> 17;
    prng ^= prng << 5;
    const noise = ((prng >>> 0) * 2.3283064365386963e-10 - 0.5) * 4.4;

    y[i] = -64.5 + floorShift + pMain + pA + pB + pPump + noise;
  }

  commitPayloadRevision(payload, n);
}

/**
 * Log-Y (mW): 7-decade optical power spectrum from 1e-6 mW (-60 dBm) to 10 mW (+10 dBm)
 * across 1550..1570 nm. Strictly positive at every sample for base-10 log projection.
 */
export function populateLogPowerScenario(payload: SpectrumDataPayload, sampleCount: number): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;
  const span = 20.0;
  const invDenom = span / Math.max(1, n - 1);
  let prng = 0x10a9_77c3;

  for (let i = 0; i < n; i += 1) {
    const offset = i * invDenom;
    x[i] = offset;

    // Carrier at 1556.4 nm (~6.2 mW), SMSR side modes, broad ASE pedestal, Raman floor
    const dCarrier = (offset - 6.4) / 0.09;
    const dSide1 = (offset - 4.1) / 0.14;
    const dSide2 = (offset - 8.9) / 0.16;
    const dSide3 = (offset - 13.6) / 0.24;
    const dAse = (offset - 7.8) / 3.4;

    const carrier = 6.2 / (1 + dCarrier * dCarrier * dCarrier * dCarrier);
    const sideModes =
      0.085 / (1 + dSide1 * dSide1) +
      0.032 / (1 + dSide2 * dSide2) +
      0.009 / (1 + dSide3 * dSide3);
    const asePedestal = 0.0018 / (1 + dAse * dAse);
    const floor = 4.2e-6 * (1 + 0.35 * Math.cos(offset * 0.45));

    prng = nextXorShift32(prng);
    const multNoise = 0.82 + (prng / 4_294_967_296) * 0.36;

    const powerMw = (carrier + sideModes + asePedestal + floor) * multNoise;
    y[i] = powerMw > 1.2e-6 ? powerMw : 1.2e-6;
  }

  commitPayloadRevision(payload, n);
}
