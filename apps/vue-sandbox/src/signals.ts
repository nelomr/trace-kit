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

/** Exact SI vacuum speed of light in nm * THz (c = 299,792,458 m/s). */
export const C_NM_THZ = 299_792.458;

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

export interface ItuChannelEntry {
  readonly channel: number;
  readonly freqThz: number;
  readonly lambdaNm: number;
}

/**
 * Exact ITU-T Recommendation G.694.1 100 GHz C-band DWDM frequency grid
 * (Channels 21 through 60, anchored at Ch 31 = 193.10 THz = 1552.5244 nm).
 */
export const ITU_G694_1_C_BAND_100GHZ: readonly ItuChannelEntry[] = Object.freeze(
  Array.from({ length: 40 }, (_, idx) => {
    const channel = 21 + idx;
    const freqThz = Number((192.1 + idx * 0.1).toFixed(2));
    return Object.freeze({
      channel,
      freqThz,
      lambdaNm: C_NM_THZ / freqThz,
    });
  }),
);

/**
 * Converts strictly positive linear optical power (mW) to dBm:
 * P_dBm = 10 * log10(P_mW). All spectral additions occur in linear mW before log conversion.
 */
export function mwToDbm(powerMw: number): number {
  return 10 * Math.log10(powerMw > 1e-12 ? powerMw : 1e-12);
}

export const LINEAR_Y_AXES: readonly YAxisRegistration[] = Object.freeze([
  Object.freeze({
    id: "power-dbm",
    scaleKind: Y_SCALE_KIND_LINEAR,
    domainMin: -68,
    domainMax: 4,
    side: AXIS_SIDE_LEFT,
  }),
]);

/**
 * 5-decade linear optical power axis (0.001 mW = -30 dBm to 100 mW = +20 dBm).
 * Every decade tick formats cleanly (0.001..100 mW) under the renderer's 3-decimal tick formatter.
 */
export const LOG_Y_AXES: readonly YAxisRegistration[] = Object.freeze([
  Object.freeze({
    id: "power",
    scaleKind: Y_SCALE_KIND_LOG,
    domainMin: 1e-3,
    domainMax: 100,
    side: AXIS_SIDE_LEFT,
  }),
]);

export interface ScenarioDescriptor {
  readonly id: ScenarioId;
  readonly label: string;
  readonly shortBadge: string;
  readonly instrumentProfile: string;
  readonly standardRef: string;
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
    label: "π-FBG 1550 nm",
    shortBadge: "f64 xOrigin",
    instrumentProfile: "BOSA / Coherent (0.08 pm RBW)",
    standardRef: "π-Shifted FBG (4 pm Notch)",
    summary:
      "Single C-band π-phase-shifted Fiber Bragg Grating (180 pm stopband, 4.0 pm notch at 1550.000100 nm) summed in linear mW.",
    axisMode: "linear",
    defaultSamples: 120_000,
    yUnit: "dBm",
    homeDomain: Object.freeze({ xMin: 1549.74, xMax: 1550.26, yMin: -68, yMax: 4 }),
    yAxes: LINEAR_Y_AXES,
    precisionZoomDomain: Object.freeze({
      xMin: 1549.984,
      xMax: 1550.016,
      yMin: -66,
      yMax: 2,
    }),
  }),
  "dwdm-40ch": Object.freeze({
    id: "dwdm-40ch",
    label: "DWDM ITU 40-Ch",
    shortBadge: "ITU-T G.694.1",
    instrumentProfile: "OSA AQ6370-Class (20 pm RBW)",
    standardRef: "ITU-T G.694.1 (100 GHz)",
    summary:
      "Exact 100 GHz ITU-T C-band grid (Ch 21–60, λ = c/f anchored at 193.10 THz) with EDFA ASE floor, Ch 34 loss, and Ch 48 +12 GHz drift.",
    axisMode: "linear",
    defaultSamples: 72_000,
    yUnit: "dBm",
    homeDomain: Object.freeze({ xMin: 1528.6, xMax: 1561.8, yMin: -68, yMax: 4 }),
    yAxes: LINEAR_Y_AXES,
  }),
  "live-60hz": Object.freeze({
    id: "live-60hz",
    label: "Live 60 Hz",
    shortBadge: "Zero-VDOM",
    instrumentProfile: "FDML Swept Interrogator (5 pm)",
    standardRef: "DFB + SMSR Linear Power",
    summary:
      "In-place Retained buffer acquisition via commitPayloadRevision + requestRender with linear-power ASE noise floor.",
    axisMode: "linear",
    defaultSamples: 96_000,
    yUnit: "dBm",
    homeDomain: Object.freeze({ xMin: 1549.8, xMax: 1554.2, yMin: -68, yMax: 4 }),
    yAxes: LINEAR_Y_AXES,
  }),
  "log-y-mw": Object.freeze({
    id: "log-y-mw",
    label: "Log-Y (mW)",
    shortBadge: "Log10 Axis",
    instrumentProfile: "Optical Power Density (mW)",
    standardRef: "5-Decade Log10 (0.001–100 mW)",
    summary:
      "5-decade linear optical power spectrum (0.001 to 100 mW; −30 to +20 dBm) with base-10 log pan and zoom.",
    axisMode: "log",
    defaultSamples: 48_000,
    yUnit: "mW",
    homeDomain: Object.freeze({ xMin: 1549.6, xMax: 1570.4, yMin: 1e-3, yMax: 100 }),
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
        xOrigin: 1549.74,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    dwdmRefPayload: markRaw(
      createSpectrumDataPayload({
        capacity: halfCapacity,
        xOrigin: 1528.6,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    dwdmActivePayload: markRaw(
      createSpectrumDataPayload({
        capacity: halfCapacity,
        xOrigin: 1528.6,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    livePayload: markRaw(
      createSpectrumDataPayload({
        capacity: MAX_SAMPLES,
        xOrigin: 1549.8,
        xUnit: "nm",
        yUnit: "dBm",
      }),
    ),
    logPayload: markRaw(
      createSpectrumDataPayload({
        capacity: MAX_SAMPLES,
        xOrigin: 1549.6,
        xUnit: "nm",
        yUnit: "mW",
      }),
    ),
  });
}

/**
 * Single C-band π-phase-shifted Fiber Bragg Grating (reflection spectrum, BOSA 0.08 pm profile).
 *
 * Physics:
 * - Stopband centered at exact 1550.000100 nm (offset 0.260100 nm from xOrigin = 1549.740 nm),
 *   stopband FWHM ≈ 180 pm (half-width 90 pm), peak reflection ≈ −2.0 dBm (0.631 mW).
 * - Central π-phase-shift transmission notch at exact 1550.000100 nm with FWHM = 4.0 pm
 *   (HWHM = 2.0 pm), applied multiplicatively in linear optical power to drop ~34 dB to ~−36 dBm.
 * - Apodized Bragg side-lobes outside the stopband + linear ASE/detector floor (~−62 dBm).
 * - All powers are combined in linear mW before converting to dBm via 10 * log10(P_mW).
 */
export function populateFbgScenario(payload: SpectrumDataPayload, sampleCount: number): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;
  const span = 0.52;
  const invDenom = span / Math.max(1, n - 1);
  const centerOffset = 1550.0001 - payload.xOrigin; // 0.260100 nm
  const peakPowerMw = 0.631; // −2.0 dBm
  const aseFloorMw = 6.31e-7; // −62.0 dBm
  let prng = 0x1550_f8a1;

  for (let i = 0; i < n; i += 1) {
    const offset = i * invDenom;
    x[i] = offset;

    const delta = offset - centerOffset;

    // Flat-top super-Lorentzian Bragg stopband (FWHM ≈ 180 pm, HWHM = 90 pm)
    const uStop = delta / 0.09;
    const uStop2 = uStop * uStop;
    const stopbandRefl = 1 / (1 + uStop2 * uStop2 * uStop2);

    // Multiplicative π-phase-shift notch (FWHM = 4.0 pm -> HWHM = 2.0 pm = 0.002 nm)
    // Depth factor 0.99962 yields ~34.2 dB central rejection inside the reflection band
    const uNotch = delta / 0.002;
    const notchTransmission = 1 - 0.99962 / (1 + uNotch * uNotch);

    // Apodized Bragg grating side-lobes decaying outside the stopband (~−24 to −40 dB)
    const arg = delta * 135;
    const sinc = Math.abs(arg) < 1e-6 ? 1 : Math.sin(arg) / arg;
    const sideLobeEnvelope = 1 / (1 + (delta / 0.19) * (delta / 0.19));
    const sideLobePowerMw = 0.0085 * sinc * sinc * sideLobeEnvelope;

    // Detector shot/ASE noise in linear power (prominent at −62 dBm floor, quiet at −2 dBm peak)
    prng = nextXorShift32(prng);
    const u1 = prng / 4_294_967_296;
    prng = nextXorShift32(prng);
    const u2 = prng / 4_294_967_296;
    const floorNoiseMw = aseFloorMw * (0.65 + 0.7 * u1);
    const rinFactor = 1 + (u2 - 0.5) * 0.018; // ~±0.04 dB laser RIN on peak

    const signalMw = (peakPowerMw * stopbandRefl * notchTransmission + sideLobePowerMw) * rinFactor;
    y[i] = mwToDbm(signalMw + floorNoiseMw);
  }

  commitPayloadRevision(payload, n);
}

/**
 * DWDM 40-Ch: two-trace TraceCollection (Reference + Active C-band comb) on the exact
 * ITU-T G.694.1 100 GHz frequency grid (Ch 21 = 192.10 THz .. Ch 60 = 196.00 THz).
 */
export function buildDwdmCollection(
  pool: SignalPool,
  totalSamples: number,
  scheme: ResolvedScheme,
): TraceCollection {
  const clamped = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, totalSamples));
  const refCount = Math.floor(clamped / 2);
  const activeCount = clamped - refCount;

  populateDwdmTrace(pool.dwdmRefPayload, refCount, false);
  populateDwdmTrace(pool.dwdmActivePayload, activeCount, true);

  const activeColor = scheme === "dark" ? "#38bdf8" : "#0284c7";
  const refColor = scheme === "dark" ? "#f59e0b" : "#d97706";

  return markRaw(
    createTraceCollection(
      [
        {
          id: "itu-reference",
          payload: pool.dwdmRefPayload,
          yAxisId: "power-dbm",
          style: {
            color: refColor,
            lineWidthCss: 1.2,
            dash: [5, 4],
          },
        },
        {
          id: "c-band-active",
          payload: pool.dwdmActivePayload,
          yAxisId: "power-dbm",
          style: {
            color: activeColor,
            lineWidthCss: 1.5,
          },
        },
      ],
      LINEAR_Y_AXES,
      1528.6,
      1561.8,
    ),
  );
}

function populateDwdmTrace(
  payload: SpectrumDataPayload,
  sampleCount: number,
  isActive: boolean,
): void {
  const n = Math.max(1000, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;
  const span = 33.2;
  const xOrigin = payload.xOrigin;
  const invDenom = span / Math.max(1, n - 1);
  let prng = isActive ? 0x40c4_a11e : 0x40c4_00ef;

  for (let i = 0; i < n; i += 1) {
    const offset = i * invDenom;
    x[i] = offset;

    const lambdaNm = xOrigin + offset;
    const freqThz = C_NM_THZ / lambdaNm;

    // EDFA ASE floor in linear mW (~−45 dBm = 3.16e-5 mW across C-band with gain curvature)
    const norm = offset / span;
    const aseDbm = -46.2 + 2.4 * Math.sin(norm * Math.PI) + (isActive ? (norm - 0.5) * 1.8 : 0);
    const aseMw = Math.pow(10, aseDbm * 0.1);

    // Exact ITU-T G.694.1 100 GHz channel lookup (Ch 21 = 192.10 THz .. Ch 60 = 196.00 THz)
    const idx = Math.round((freqThz - 192.1) * 10);
    let channelMw = 0;
    if (idx >= 0 && idx < ITU_G694_1_C_BAND_100GHZ.length) {
      const entry = ITU_G694_1_C_BAND_100GHZ[idx]!;
      // Simulate +12 GHz laser frequency drift on ITU Ch 48 (194.80 THz, 1538.98 nm)
      const channelFreqThz = isActive && entry.channel === 48 ? entry.freqThz + 0.012 : entry.freqThz;
      const dfGhz = (freqThz - channelFreqThz) * 1000;
      // 32 Gbaud DP-QPSK optical spectrum convolved with 20 pm (~2.5 GHz) OSA RBW (HWHM ≈ 14 GHz)
      const u = dfGhz / 14.0;
      const u2 = u * u;
      const shape = 1 / (1 + u2 * u2);

      // Nominal channel power ~−3.0 dBm (0.50 mW -> ~28 dB OSNR over −45 dBm ASE)
      let chDbm = -3.0 - 0.025 * Math.abs(entry.channel - 40.5);
      if (isActive) {
        // Positive C-band EDFA gain tilt (+1.8 dB from short to long λ)
        chDbm += (40.5 - entry.channel) * 0.045;
        // Ch 34 (193.40 THz, 1550.12 nm): −10 dB WSS/VOA attenuation fault
        if (entry.channel === 34) chDbm -= 10.0;
        // Ch 48 (194.80 THz, 1538.98 nm): −5.2 dB power degradation with +12 GHz drift
        if (entry.channel === 48) chDbm -= 5.2;
      }
      channelMw = Math.pow(10, chDbm * 0.1) * shape;
    }

    prng = nextXorShift32(prng);
    const uNoise = prng / 4_294_967_296;
    const aseJitterMw = aseMw * (0.72 + (isActive ? 0.56 : 0.24) * uNoise);
    const rinFactor = 1 + (uNoise - 0.5) * (isActive ? 0.025 : 0.01);

    y[i] = mwToDbm(channelMw * rinFactor + aseJitterMw);
  }

  commitPayloadRevision(payload, n);
}

/**
 * Live 60 Hz: prepares the X grid once per sample-count change, then updates Y in place
 * every animation frame by summing linear optical powers (mW) and converting to dBm.
 */
export function populateLiveGridX(payload: SpectrumDataPayload, sampleCount: number): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const invDenom = 4.4 / Math.max(1, n - 1);
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

  // Thermal wavelength tuning + coupled-cavity side-mode breathing (linear power in mW)
  const mainCenter = 2.05 + 0.22 * Math.sin(elapsedSec * 1.1);
  const sideACenter = mainCenter - 0.45 + 0.03 * Math.cos(elapsedSec * 2.2);
  const sideBCenter = mainCenter + 0.48 + 0.04 * Math.sin(elapsedSec * 1.8);
  const auxCenter = 3.35 + 0.07 * Math.cos(elapsedSec * 0.85);

  const mainMw = 0.88 + 0.16 * Math.sin(elapsedSec * 2.8); // ~−0.5 dBm
  const sideAMw = 0.0018 + 0.0007 * Math.cos(elapsedSec * 2.4); // ~−27 dBm (SMSR ~27 dB)
  const sideBMw = 0.00095 + 0.00035 * Math.sin(elapsedSec * 2.0 + 1.1); // ~−30 dBm
  const auxMw = 0.032 + 0.008 * Math.cos(elapsedSec * 1.3); // ~−15 dBm probe
  const aseFloorMw = 5.2e-7 * (1 + 0.15 * Math.sin(elapsedSec * 0.7)); // ~−62.8 dBm

  let prng = ((frameCounter * 2654435761) ^ 0x9e37_79b9) >>> 0;
  if (prng === 0) prng = 0x1357_9bdf;

  const invMainW = 1 / 0.022;
  const invSideW = 1 / 0.038;
  const invAuxW = 1 / 0.032;
  const invLn10Times10 = 10 / Math.LN10;

  for (let i = 0; i < n; i += 1) {
    const xv = x[i] ?? 0;

    const dm = (xv - mainCenter) * invMainW;
    const da = (xv - sideACenter) * invSideW;
    const db = (xv - sideBCenter) * invSideW;
    const dp = (xv - auxCenter) * invAuxW;

    const dm2 = dm * dm;
    const pMain = mainMw / (1 + dm2 * dm2);
    const pA = sideAMw / (1 + da * da);
    const pB = sideBMw / (1 + db * db);
    const pAux = auxMw / (1 + dp * dp);

    // Inline xorshift32 (zero call overhead in 60 Hz hot loop)
    prng ^= prng << 13;
    prng ^= prng >>> 17;
    prng ^= prng << 5;
    const u = (prng >>> 0) * 2.3283064365386963e-10;

    // Linear-power floor noise: shimmers naturally on the −63 dBm ASE floor, quiet on 0 dBm peak
    const totalMw = pMain + pA + pB + pAux + aseFloorMw * (0.45 + 1.1 * u);
    y[i] = Math.log(totalMw > 1e-12 ? totalMw : 1e-12) * invLn10Times10;
  }

  commitPayloadRevision(payload, n);
}

/**
 * Log-Y (mW): 5-decade linear optical power spectrum from 0.001 mW (−30 dBm) to 100 mW (+20 dBm)
 * across 1549.6..1570.4 nm. Strictly positive at every sample for base-10 log projection.
 */
export function populateLogPowerScenario(payload: SpectrumDataPayload, sampleCount: number): void {
  const n = Math.max(MIN_SAMPLES, Math.min(payload.capacity, sampleCount));
  const x = payload.x;
  const y = payload.y;
  const span = 20.8;
  const invDenom = span / Math.max(1, n - 1);
  let prng = 0x10a9_77c3;

  for (let i = 0; i < n; i += 1) {
    const offset = i * invDenom;
    x[i] = offset;

    // High-power C-band carrier at 1556.4 nm (~28 mW = +14.5 dBm), SMSR side modes, ASE pedestal
    const dCarrier = (offset - 6.8) / 0.095;
    const dSide1 = (offset - 4.4) / 0.14;
    const dSide2 = (offset - 9.2) / 0.16;
    const dSide3 = (offset - 13.8) / 0.24;
    const dAse = (offset - 8.2) / 3.5;

    const dC2 = dCarrier * dCarrier;
    const carrier = 28.0 / (1 + dC2 * dC2);
    const sideModes =
      0.48 / (1 + dSide1 * dSide1) +
      0.16 / (1 + dSide2 * dSide2) +
      0.042 / (1 + dSide3 * dSide3);
    const asePedestal = 0.016 / (1 + dAse * dAse);
    const floor = 0.0024 * (1 + 0.28 * Math.cos(offset * 0.42));

    prng = nextXorShift32(prng);
    const u = prng / 4_294_967_296;
    const rinFactor = 0.985 + 0.03 * u;
    const floorJitter = floor * (0.78 + 0.44 * u);

    const powerMw = (carrier + sideModes + asePedestal) * rinFactor + floorJitter;
    y[i] = powerMw > 0.0011 ? powerMw : 0.0011;
  }

  commitPayloadRevision(payload, n);
}

export interface WindowOpticalMetrics {
  readonly visibleSamples: number;
  readonly peakXNm: number;
  readonly peakY: number;
  readonly minY: number;
  readonly dynamicRangeDb: number;
}

/**
 * Computes live optical metrology over the visible X domain [xMin, xMax] of a payload
 * without heap-allocating intermediate arrays.
 */
export function computeWindowOpticalMetrics(
  payload: SpectrumDataPayload,
  xMin: number,
  xMax: number,
  isLog: boolean,
): WindowOpticalMetrics {
  const n = payload.sampleCount;
  const x = payload.x;
  const y = payload.y;
  const xOrigin = payload.xOrigin;
  const relMin = xMin - xOrigin;
  const relMax = xMax - xOrigin;

  let visibleSamples = 0;
  let peakX = Number.NaN;
  let peakY = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  for (let i = 0; i < n; i += 1) {
    const xv = x[i]!;
    if (xv < relMin || xv > relMax) continue;
    const yv = y[i]!;
    if (!Number.isFinite(yv)) continue;
    visibleSamples += 1;
    if (yv > peakY) {
      peakY = yv;
      peakX = xOrigin + xv;
    }
    if (yv < minY) {
      minY = yv;
    }
  }

  if (visibleSamples === 0) {
    return {
      visibleSamples: 0,
      peakXNm: Number.NaN,
      peakY: Number.NaN,
      minY: Number.NaN,
      dynamicRangeDb: Number.NaN,
    };
  }

  const dynamicRangeDb = isLog
    ? 10 * Math.log10(Math.max(1e-12, peakY) / Math.max(1e-12, minY))
    : peakY - minY;

  return {
    visibleSamples,
    peakXNm: peakX,
    peakY,
    minY,
    dynamicRangeDb,
  };
}
