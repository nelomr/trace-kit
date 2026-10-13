/**
 * Render-scenario fixtures, shipped as published package source through the stable
 * `@trace-kit/renderers/fixtures` subpath so a later package's own test suite can import a
 * fixture without a relative path that reaches across package boundaries.
 *
 * The corpus is split in two. The *parity set* is the five payloads a second engine (WebGL2) will
 * be compared against, and the only group the pixel-parity loop iterates. The *SVG-extended set*
 * adds four figures (log axis, dual axis, gapped trace, two-trace overlay) that the SVG golden
 * corpus and the dedicated pixel tests consume. `SCENARIO_FIXTURES` is the nine, parity first.
 *
 * Every field here is backend-agnostic: no field names Canvas2D, WebGL2 or SVG, and `dpr` is a
 * plain numeric field driving `FigureRenderer.resize`'s own `dpr` parameter, never read from
 * `window.devicePixelRatio` (an SVG export ignores it and uses CSS pixels). Every payload is a
 * real, frozen-shape `SpectrumDataPayload` built once at module load, never re-allocated per
 * import (this module is evaluated once per process), and every builder is deterministic: no
 * `Math.random`, no clock.
 *
 * Every fixture renders at `800x400` CSS pixels at `dpr: 2`, except `decimation-minmax`, which is
 * the one `dpr: 1` fixture — its dpr path is covered by a golden rather than only by a `resize`
 * call assertion.
 *
 * Isolation note for future framework wrappers (Vue/React): a fixture's payload or collection
 * must never be wrapped in a deep-reactive proxy or a plain `useState` — isolate it with
 * `shallowRef`/`markRaw` (Vue) or keep it behind a `useRef` (React), exactly as
 * `DEFAULT_FIGURE_STYLE`'s own module documents for `FigureStyle`.
 */
import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
  type TraceCollection,
  type YAxisRegistration,
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

interface ScenarioFixtureBase {
  /** Stable, kebab-case identifier — also the golden file stem (no platform/browser token). */
  readonly id: string;
  readonly description: string;
  readonly domain: ScenarioDomain;
  readonly viewport: ScenarioViewport;
  /** Plain numeric device-pixel-ratio hint, never read from a global. */
  readonly dpr: number;
  /** Explicit Y axes, left-stacked in order. Omitted for the default single linear axis. */
  readonly yAxes?: readonly YAxisRegistration[];
}

export interface PayloadScenarioFixture extends ScenarioFixtureBase {
  readonly kind: "payload";
  readonly payload: SpectrumDataPayload;
}

export interface CollectionScenarioFixture extends ScenarioFixtureBase {
  readonly kind: "collection";
  readonly collection: TraceCollection;
}

export type ScenarioFixture = PayloadScenarioFixture | CollectionScenarioFixture;

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

/** A Lorentzian peak with a leading gap, an interior gap, a trailing gap, and one isolated
 * single-sample run between two gaps — every gap-shape category `gap-sentinel-semantics`
 * defines, in one fixture, so the golden this drives proves a visible break (not a bridged
 * line) at each shape and a filled-square marker at the isolated sample. */
function buildGappedPayload(
  sampleCount: number,
  centerFrequency: number,
  fwhm: number,
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
  // Leading gap: [0, 20). Interior gap: [200, 230). Isolated sample: index 300, flanked by
  // gaps on both sides ([299] and [301, 305)). Trailing gap: [sampleCount - 15, sampleCount).
  for (let i = 0; i < sampleCount; i += 1) {
    const dx = i - centerFrequency;
    const lineshape = halfWidthSquared / (dx * dx + halfWidthSquared);
    prngState = nextUint32(prngState);
    const noise = ((prngState / 0xffffffff) * 2 - 1) * 0.01;
    payload.x[i] = i;
    const inLeadingGap = i < 20;
    const inInteriorGap = i >= 200 && i < 230;
    const inIsolatingGap = i === 299 || (i > 300 && i < 305);
    const inTrailingGap = i >= sampleCount - 15;
    payload.y[i] =
      inLeadingGap || inInteriorGap || inIsolatingGap || inTrailingGap
        ? NaN
        : lineshape + noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

/** A monotonically rising, multi-decade payload (spanning ~3 decades) with a small amount of
 * deterministic noise — exercises decade thinning and mantissa minors on a log Y axis, which a
 * flat or single-decade fixture would not. */
function buildLogSweepPayload(sampleCount: number, seed: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 0,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = 1 + ((prngState / 0xffffffff) * 2 - 1) * 0.05;
    payload.x[i] = i;
    payload.y[i] = 1 * 10 ** ((i / (sampleCount - 1)) * 3) * noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

/** The overlay scenario's linear-axis trace: a bounded oscillation, sampled from `xOrigin: 0` —
 * proves two traces sharing one X domain but sampled from different absolute origins still land
 * correctly against their own transform. */
function buildOverlayLinearPayload(
  sampleCount: number,
  seed: number,
  xOrigin: number,
): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = ((prngState / 0xffffffff) * 2 - 1) * 0.05;
    payload.x[i] = i;
    payload.y[i] = Math.sin(i * 0.05) * 5 + noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

/** The overlay scenario's log-axis trace: strictly positive (a log Y domain has no meaning for a
 * non-positive value), sampled from a distinct `xOrigin`. */
function buildOverlayLogPayload(
  sampleCount: number,
  seed: number,
  xOrigin: number,
): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = 1 + ((prngState / 0xffffffff) * 2 - 1) * 0.05;
    payload.x[i] = i;
    payload.y[i] = 1 * 10 ** ((i / (sampleCount - 1)) * 2) * noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

const smoothCurvePayload = buildLorentzianPayload(512, 256, 80, 0, 1);
const resonancePeakPayload = buildLorentzianPayload(4_096, 2_048, 60, 0, 7);
const noiseFloorPayload = buildFlatNoisePayload(8_192, 0.02, 13);
const decimationSpikePayload = buildSingleSpikePayload(200_000, 100_000);
const gappedTracePayload = buildGappedPayload(512, 256, 80, 5);
const logSweepPayload = buildLogSweepPayload(512, 41);
const dualAxisPayload = buildLogSweepPayload(512, 43);
const overlayLinearPayload = buildOverlayLinearPayload(300, 17, 0);
const overlayLogPayload = buildOverlayLogPayload(300, 19, 1000);

const LOG_AXIS: YAxisRegistration = Object.freeze({
  id: "log",
  scaleKind: Y_SCALE_KIND_LOG,
  domainMin: 1,
  domainMax: 1000,
  side: AXIS_SIDE_LEFT,
});
const LINEAR_UNIT_AXIS: YAxisRegistration = Object.freeze({
  id: "linear",
  scaleKind: Y_SCALE_KIND_LINEAR,
  domainMin: -1,
  domainMax: 1,
  side: AXIS_SIDE_LEFT,
});
const OVERLAY_LINEAR_AXIS: YAxisRegistration = Object.freeze({
  id: "linear",
  scaleKind: Y_SCALE_KIND_LINEAR,
  domainMin: -10,
  domainMax: 10,
  side: AXIS_SIDE_LEFT,
});
const OVERLAY_LOG_AXIS: YAxisRegistration = Object.freeze({
  id: "log",
  scaleKind: Y_SCALE_KIND_LOG,
  domainMin: 1,
  domainMax: 200,
  side: AXIS_SIDE_LEFT,
});
const OVERLAY_AXES: readonly YAxisRegistration[] = Object.freeze([
  OVERLAY_LINEAR_AXIS,
  OVERLAY_LOG_AXIS,
]);

const overlayCollection = createTraceCollection(
  [
    {
      id: "linear-trace",
      payload: overlayLinearPayload,
      yAxisId: "linear",
      style: { color: "#3fb6ff" },
    },
    {
      id: "log-trace",
      payload: overlayLogPayload,
      yAxisId: "log",
      style: { color: "#ff7a45", dash: [6, 4] },
    },
  ],
  OVERLAY_AXES,
  0,
  299,
);

export const PARITY_SCENARIO_FIXTURES: readonly PayloadScenarioFixture[] = Object.freeze([
  Object.freeze({
    kind: "payload" as const,
    id: "simple-trace",
    description: "simple trace",
    payload: smoothCurvePayload,
    domain: { xMin: 0, xMax: 512, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    kind: "payload" as const,
    id: "axes-grid",
    description: "axes with grid",
    payload: smoothCurvePayload,
    domain: { xMin: 0, xMax: 512, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    kind: "payload" as const,
    id: "resonance-peak",
    description: "resonance peak",
    // Domain clipped to roughly +-5 linewidths (fwhm=60) around the centre frequency (2048):
    // the golden only needs to assert the apex survives decimation, not the full flat wings
    // either side of it, so there is no reason to render domain the golden never inspects.
    domain: { xMin: 1_748, xMax: 2_348, yMin: -0.05, yMax: 1.05 },
    payload: resonancePeakPayload,
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    kind: "payload" as const,
    id: "noise-floor",
    description: "noise floor",
    payload: noiseFloorPayload,
    domain: { xMin: 0, xMax: 8_192, yMin: -0.05, yMax: 0.05 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    kind: "payload" as const,
    id: "decimation-minmax",
    description: "decimation case",
    payload: decimationSpikePayload,
    domain: { xMin: 0, xMax: 200_000, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 1,
  }),
]);

export const SVG_EXTENDED_SCENARIO_FIXTURES: readonly ScenarioFixture[] = Object.freeze([
  Object.freeze({
    kind: "payload" as const,
    id: "log-axis",
    description: "log axis",
    payload: logSweepPayload,
    domain: { xMin: 0, xMax: 511, yMin: 1, yMax: 1000 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
    yAxes: Object.freeze([LOG_AXIS]),
  }),
  Object.freeze({
    kind: "payload" as const,
    id: "dual-axis",
    description: "dual axis",
    payload: dualAxisPayload,
    domain: { xMin: 0, xMax: 511, yMin: 1, yMax: 1000 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
    yAxes: Object.freeze([LOG_AXIS, LINEAR_UNIT_AXIS]),
  }),
  Object.freeze({
    kind: "payload" as const,
    id: "gapped-trace",
    description: "gapped trace",
    payload: gappedTracePayload,
    domain: { xMin: 0, xMax: 512, yMin: -0.1, yMax: 1.1 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
  }),
  Object.freeze({
    kind: "collection" as const,
    id: "overlay-two-axis",
    description: "overlay two-axis",
    collection: overlayCollection,
    domain: { xMin: 0, xMax: 299, yMin: -10, yMax: 10 },
    viewport: STANDARD_VIEWPORT,
    dpr: 2,
    yAxes: OVERLAY_AXES,
  }),
]);

export const SCENARIO_FIXTURES: readonly ScenarioFixture[] = Object.freeze([
  ...PARITY_SCENARIO_FIXTURES,
  ...SVG_EXTENDED_SCENARIO_FIXTURES,
]);
