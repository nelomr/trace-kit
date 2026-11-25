import {
  AXIS_SIDE_LEFT,
  DecimationKind,
  Y_SCALE_KIND_LOG,
  commitPayloadRevision,
  createBucketAccumulator,
  createRawSampleRing,
  createSampleSpan,
  createSpectrumDataPayload,
  createStreamingInvalidationAdapter,
  createSyncDecimationPort,
  createWindowDecimationAdapter,
  ingestBatch,
  rebuildDomain,
  resolveSampleWindow,
  type DecimationPort,
  type Lease,
  type SpectrumDataPayload,
  type StreamingInvalidationAdapter,
  type Tier3ProjectionTarget,
  type WindowDecimationAdapter,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { AxisLayout, FigureRenderer, FigureStyle } from "@trace-kit/renderers";
import {
  classifyPointerRegion,
  createSpectrumEngineController,
  createViewportInteractionController,
  type InteractionDragMode,
  type PointerRegion,
  type SpectrumEngineController,
  type SpectrumEngineControllerOptions,
  type ViewportDomain,
  type ViewportInteractionController,
  type ViewportInvalidationEvent,
  type WheelZoomAxis,
} from "@trace-kit/renderers/controller";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import {
  WebGL2FigureRenderer,
  type WebGL2FigureRendererOptions,
} from "@trace-kit/renderers/webgl2";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";

type PresetId = "linear-broadband" | "log-y-power" | "deep-zoom-1550";
type InvalidationMode = "direct" | "streaming-ring" | "windowed-port";

const MAX_SAMPLES = 90_000;
const INITIAL_SAMPLES = 10_000;
const RING_CAPACITY = 16_384;
const BUCKET_COUNT = 256;
const STAGE_HEIGHT_PX = 420;
const LABEL_GUTTER_CSS = 56;
const X_ORIGIN_NM = 1550;

interface PresetConfig {
  readonly id: PresetId;
  readonly xOrigin: number;
  readonly offsetMin: number;
  readonly offsetMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly yUnit: string;
  readonly isLogY: boolean;
  readonly highPrecisionX: boolean;
  readonly yAxes: readonly YAxisRegistration[] | undefined;
}

const PRESETS: Readonly<Record<PresetId, PresetConfig>> = {
  "linear-broadband": {
    id: "linear-broadband",
    xOrigin: X_ORIGIN_NM,
    offsetMin: 0,
    offsetMax: 40,
    yMin: -80,
    yMax: 0,
    yUnit: "dBm",
    isLogY: false,
    highPrecisionX: false,
    yAxes: undefined,
  },
  "log-y-power": {
    id: "log-y-power",
    xOrigin: X_ORIGIN_NM,
    offsetMin: 0,
    offsetMax: 40,
    yMin: 1e-4,
    yMax: 1e2,
    yUnit: "mW",
    isLogY: true,
    highPrecisionX: false,
    yAxes: [
      {
        id: "power",
        scaleKind: Y_SCALE_KIND_LOG,
        domainMin: 1e-4,
        domainMax: 1e2,
        side: AXIS_SIDE_LEFT,
      },
    ],
  },
  "deep-zoom-1550": {
    id: "deep-zoom-1550",
    xOrigin: X_ORIGIN_NM,
    offsetMin: 0.0001,
    offsetMax: 0.0002,
    yMin: -80,
    yMax: 0,
    yUnit: "dBm",
    isLogY: false,
    highPrecisionX: true,
    yAxes: undefined,
  },
};

export interface ViewportInteractionViewOptions {
  /** Injectable Canvas2D renderer factory for deterministic happy-dom view tests. */
  readonly createCanvas2DRenderer?: SpectrumEngineControllerOptions["createCanvas2DRenderer"];
  /** Injectable WebGL2 renderer factory for deterministic happy-dom view tests. */
  readonly createWebGL2Renderer?: SpectrumEngineControllerOptions["createWebGL2Renderer"];
  /** Disable ResizeObserver in headless DOM tests when false. Default: true. */
  readonly autoResize?: boolean;
  /** Injectable font loader hook for tests. Default: `ensureDefaultFont` from `@trace-kit/renderers/font`. */
  readonly ensureFont?: () => Promise<void>;
}

function nextUint32(state: number): number {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

function populatePresetPayload(
  payload: SpectrumDataPayload,
  preset: PresetConfig,
  sampleCount: number,
): void {
  const x = payload.x;
  const y = payload.y;
  const count = Math.max(2, Math.min(payload.capacity, sampleCount));
  const denom = count - 1;
  const span = preset.offsetMax - preset.offsetMin;
  let prng = 0x51a7_9c3d;

  for (let i = 0; i < count; i += 1) {
    const u = i / denom;
    const offsetNm = preset.offsetMin + u * span;
    x[i] = offsetNm;

    prng = nextUint32(prng);
    const noise = (prng / 4_294_967_296 - 0.5) * 3.0;

    if (preset.id === "deep-zoom-1550") {
      // Sharp sub-picometre Lorentzian optical resonance centered at 1550.00015 nm
      const d1 = offsetNm - 0.00015;
      const d2 = offsetNm - 0.000172;
      const peak1 = 56 / (1 + (d1 / 0.000004) * (d1 / 0.000004));
      const peak2 = 30 / (1 + (d2 / 0.000006) * (d2 / 0.000006));
      y[i] = -72 + peak1 + peak2 + noise * 0.6;
    } else {
      const localNm = offsetNm % 2.5;
      const d1 = localNm - 0.7;
      const d2 = localNm - 1.8;
      const peak1 = 50 / (1 + (d1 / 0.06) * (d1 / 0.06));
      const peak2 = 32 / (1 + (d2 / 0.1) * (d2 / 0.1));
      const ripple = 2.0 * Math.sin(offsetNm * 1.4);
      const dbm = -68 + peak1 + peak2 + ripple + noise;

      if (preset.isLogY) {
        // Convert dBm-like envelope into strictly positive optical power in [1e-4, 1e2] mW
        const exponent = -4 + ((dbm + 80) / 80) * 6;
        const clampedExp = Math.max(-3.9, Math.min(1.9, exponent));
        y[i] = 10 ** clampedExp;
      } else {
        y[i] = dbm;
      }
    }
  }

  commitPayloadRevision(payload, count);
}

function readFigureTokensFromCss(): {
  style: Partial<FigureStyle>;
  axes: Partial<AxisLayout>;
} {
  const computed = getComputedStyle(document.documentElement);
  function token(name: string, fallback: string): string {
    const value = computed.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  }

  const fontSize = token("--tk-figure-label-font-size", "13px");
  const fontFamily = token("--tk-figure-label-font-family", "system-ui, sans-serif");

  return {
    style: {
      backgroundColor: token("--tk-color-bg", "#0b0f14"),
      traceColor: token("--tk-color-accent", "#3fb6ff"),
      gridColor: token("--tk-color-grid", "#1c2530"),
      axisColor: token("--tk-color-axis", "#3a4756"),
      labelColor: token("--tk-color-label", "#8a97a8"),
      font: `${fontSize} ${fontFamily}`,
    },
    axes: {
      labelGutter: LABEL_GUTTER_CSS,
    },
  };
}

function isPresetId(value: string): value is PresetId {
  return value === "linear-broadband" || value === "log-y-power" || value === "deep-zoom-1550";
}

function isDragMode(value: string): value is InteractionDragMode {
  return value === "pan" || value === "box-zoom";
}

function isWheelAxis(value: string): value is WheelZoomAxis {
  return value === "xy" || value === "x" || value === "y";
}

function isInvalidationMode(value: string): value is InvalidationMode {
  return value === "direct" || value === "streaming-ring" || value === "windowed-port";
}

function formatDomainX(xMin: number, xMax: number, highPrecision: boolean): string {
  const span = Math.abs(xMax - xMin);
  const digits = highPrecision || span < 0.01 ? 7 : 4;
  return `[${xMin.toFixed(digits)}, ${xMax.toFixed(digits)}]`;
}

function formatDomainY(yMin: number, yMax: number, isLogY: boolean): string {
  if (isLogY) {
    return `[${yMin.toExponential(2)}, ${yMax.toExponential(2)}]`;
  }
  return `[${yMin.toFixed(2)}, ${yMax.toFixed(2)}]`;
}

interface HudFields {
  readonly activeEngine: HTMLElement;
  readonly domainX: HTMLElement;
  readonly domainY: HTMLElement;
  readonly gestureState: HTMLElement;
  readonly gestureActive: HTMLElement;
  readonly pointerRegion: HTMLElement;
  readonly invalidationSeq: HTMLElement;
  readonly invalidationPhase: HTMLElement;
  readonly visibleSamples: HTMLElement;
}

function createHud(parent: HTMLElement): HudFields {
  const hud = document.createElement("div");
  hud.setAttribute("data-role", "interaction-hud");
  hud.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:0.5rem;" +
    "padding:0.75rem;border:1px solid var(--tk-color-border,#1c2530);border-radius:6px;" +
    "background:var(--tk-color-surface,#10161d);font-family:ui-monospace,monospace;font-size:12px";

  function metric(label: string, field: string, initial: string): HTMLElement {
    const cell = document.createElement("div");
    cell.style.cssText = "display:flex;justify-content:space-between;gap:0.5rem";
    const nameEl = document.createElement("span");
    nameEl.style.color = "var(--tk-color-text-muted,#8a97a8)";
    nameEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.setAttribute("data-field", field);
    valueEl.style.color = "var(--tk-color-text,#e6edf5)";
    valueEl.textContent = initial;
    cell.append(nameEl, valueEl);
    hud.appendChild(cell);
    return valueEl;
  }

  const fields: HudFields = {
    activeEngine: metric("Active Engine", "active-engine", "canvas2d"),
    domainX: metric("Domain X", "domain-x", "[1550.0000, 1590.0000]"),
    domainY: metric("Domain Y", "domain-y", "[-80.00, 0.00]"),
    gestureState: metric("Gesture State", "gesture-state", "idle"),
    gestureActive: metric("Gesture Active", "gesture-active", "false"),
    pointerRegion: metric("Pointer Region", "pointer-region", "outside"),
    invalidationSeq: metric("Invalidation Seq", "invalidation-seq", "0"),
    invalidationPhase: metric("Invalidation Phase", "invalidation-phase", "idle"),
    visibleSamples: metric("Visible Samples", "visible-samples", String(INITIAL_SAMPLES)),
  };

  parent.appendChild(hud);
  return fields;
}

function makeButton(label: string, action: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("data-action", action);
  button.style.cssText =
    "padding:0.35rem 0.65rem;border:1px solid var(--tk-color-border,#1c2530);border-radius:4px;" +
    "background:var(--tk-color-surface-raised,#161e27);color:var(--tk-color-text,#e6edf5);" +
    "font-size:12px;cursor:pointer";
  return button;
}

function makeSelect(
  action: string,
  ariaLabel: string,
  entries: ReadonlyArray<readonly [string, string]>,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.setAttribute("data-action", action);
  select.setAttribute("aria-label", ariaLabel);
  select.style.cssText =
    "padding:0.3rem 0.5rem;border:1px solid var(--tk-color-border,#1c2530);border-radius:4px;" +
    "background:var(--tk-color-surface-raised,#161e27);color:var(--tk-color-text,#e6edf5);" +
    "font-size:12px";
  for (const [value, label] of entries) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  return select;
}

export async function mountViewportInteraction(
  host: ViewHost,
  options?: ViewportInteractionViewOptions,
): Promise<ViewTeardown> {
  if (options?.ensureFont !== undefined) {
    await options.ensureFont();
  } else {
    await ensureDefaultFont();
  }

  if (host.signal.aborted) {
    return () => {};
  }

  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;gap:0.75rem;padding:0.75rem;" +
    "font-family:var(--tk-font-family,system-ui,sans-serif)";

  const hud = createHud(root);

  const controlsBar = document.createElement("div");
  controlsBar.style.cssText = "display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center";

  const presetSelect = makeSelect("preset-select", "Dataset preset", [
    ["linear-broadband", "Preset: Linear Broadband"],
    ["log-y-power", "Preset: Log-Y Power"],
    ["deep-zoom-1550", "Preset: Deep Zoom 1550.0001 nm"],
  ]);
  const dragModeSelect = makeSelect("drag-mode-select", "Drag mode", [
    ["pan", "Drag: Pan"],
    ["box-zoom", "Drag: Box Zoom"],
  ]);
  const wheelAxisSelect = makeSelect("wheel-axis-select", "Wheel zoom axis", [
    ["xy", "Wheel: XY"],
    ["x", "Wheel: X Only"],
    ["y", "Wheel: Y Only"],
  ]);
  const sampleCountSelect = makeSelect("sample-count-select", "Sample count", [
    ["10000", "Samples: 10k (Canvas2D)"],
    ["90000", "Samples: 90k (WebGL2)"],
  ]);
  const invalidationModeSelect = makeSelect("invalidation-mode-select", "Invalidation mode", [
    ["direct", "Invalidation: Direct"],
    ["streaming-ring", "Invalidation: Streaming Ring"],
    ["windowed-port", "Invalidation: Windowed Port"],
  ]);

  const zoomInBtn = makeButton("Zoom In", "zoom-in");
  const zoomOutBtn = makeButton("Zoom Out", "zoom-out");
  const panLeftBtn = makeButton("Pan Left", "pan-left");
  const panRightBtn = makeButton("Pan Right", "pan-right");
  const resetDomainBtn = makeButton("Reset Domain", "reset-domain");

  controlsBar.append(
    presetSelect,
    dragModeSelect,
    wheelAxisSelect,
    sampleCountSelect,
    invalidationModeSelect,
    zoomInBtn,
    zoomOutBtn,
    panLeftBtn,
    panRightBtn,
    resetDomainBtn,
  );
  root.appendChild(controlsBar);

  const stage = document.createElement("div");
  stage.setAttribute("data-role", "interaction-stage");
  stage.style.cssText =
    `position:relative;width:100%;height:${STAGE_HEIGHT_PX}px;` +
    "border:1px solid var(--tk-color-border,#1c2530);border-radius:6px;overflow:hidden";
  root.appendChild(stage);

  host.container.appendChild(root);

  const { style, axes } = readFigureTokensFromCss();
  const baseCreateWebGL2 =
    options?.createWebGL2Renderer ??
    ((glOptions: WebGL2FigureRendererOptions): FigureRenderer =>
      new WebGL2FigureRenderer(glOptions));

  // Preallocated payloads and scratch span
  const sourcePayload = createSpectrumDataPayload({
    capacity: MAX_SAMPLES,
    xOrigin: X_ORIGIN_NM,
    xUnit: "nm",
    yUnit: "dBm",
  });
  const streamingPayload = createSpectrumDataPayload({
    capacity: BUCKET_COUNT * 2,
    xOrigin: X_ORIGIN_NM,
    xUnit: "nm",
    yUnit: "dBm",
  });
  const windowedPayload = createSpectrumDataPayload({
    capacity: BUCKET_COUNT * 2,
    xOrigin: X_ORIGIN_NM,
    xUnit: "nm",
    yUnit: "dBm",
  });

  const tier3Target: Tier3ProjectionTarget = {
    min: new Float32Array(BUCKET_COUNT),
    max: new Float32Array(BUCKET_COUNT),
    count: new Int32Array(BUCKET_COUNT),
  };
  const sampleSpan = createSampleSpan();

  let disposed = false;
  let currentPreset: PresetConfig = PRESETS["linear-broadband"];
  let currentSampleCount = INITIAL_SAMPLES;
  let currentDragMode: InteractionDragMode = "pan";
  let currentWheelAxis: WheelZoomAxis = "xy";
  let currentInvalidationMode: InvalidationMode = "direct";

  let lastPointerRegion: PointerRegion = "outside";
  let lastInvalidationSeq = 0;
  let lastInvalidationPhase: "idle" | "gesture" | "settled" = "idle";
  let lastVisibleSamples = INITIAL_SAMPLES;

  let controller: SpectrumEngineController | null = null;
  let interaction: ViewportInteractionController | null = null;
  let streamingAdapter: StreamingInvalidationAdapter | null = null;
  let decimationPort: DecimationPort | null = null;
  let windowedAdapter: WindowDecimationAdapter | null = null;

  function presetHomeDomain(preset: PresetConfig): ViewportDomain {
    return {
      xMin: preset.xOrigin + preset.offsetMin,
      xMax: preset.xOrigin + preset.offsetMax,
      yMin: preset.yMin,
      yMax: preset.yMax,
    };
  }

  function rebuildInvalidationPipelines(preset: PresetConfig): void {
    if (windowedAdapter !== null) {
      windowedAdapter.dispose();
      windowedAdapter = null;
    }
    if (decimationPort !== null) {
      decimationPort.dispose();
      decimationPort = null;
    }

    // 1. Streaming ring + bucket accumulator adapter
    const ring = createRawSampleRing(RING_CAPACITY);
    const accumulator = createBucketAccumulator(BUCKET_COUNT);
    const ringCount = Math.min(RING_CAPACITY, sourcePayload.sampleCount);
    ingestBatch(ring, sourcePayload.x, sourcePayload.y, 0, ringCount, accumulator);
    const offsetSpan = Math.max(1e-9, preset.offsetMax - preset.offsetMin);
    rebuildDomain(accumulator, ring, preset.offsetMin, BUCKET_COUNT / offsetSpan);

    streamingAdapter = createStreamingInvalidationAdapter({
      ring,
      accumulator,
      tier3Target,
      payload: streamingPayload,
      ringXOrigin: preset.xOrigin,
    });

    // 2. Windowed DecimationPort adapter (synchronous in-thread default, zero Worker construction)
    decimationPort = createSyncDecimationPort({
      transitCapacitySamples: MAX_SAMPLES,
    });
    windowedAdapter = createWindowDecimationAdapter({
      sourcePayload,
      port: decimationPort,
      kind: DecimationKind.Lttb,
      bucketCount: BUCKET_COUNT,
      includeNeighbours: true,
    });
  }

  function applyWindowedDecimation(domain: ViewportDomain, seq: number): void {
    if (controller === null || windowedAdapter === null || decimationPort === null) return;
    const port = decimationPort;
    windowedAdapter.request(domain.xMin, domain.xMax, seq);
    windowedAdapter.poll((lease: Lease<"settled">, outCount: number) => {
      const inX = port.viewX(lease);
      const inY = port.viewY(lease);
      const indices = port.viewIndices(lease);
      const limit = Math.min(outCount, windowedPayload.capacity);
      for (let i = 0; i < limit; i += 1) {
        const idx = indices[i] ?? 0;
        windowedPayload.x[i] = inX[idx] ?? 0;
        windowedPayload.y[i] = inY[idx] ?? 0;
      }
      commitPayloadRevision(windowedPayload, limit);
    });
    lastVisibleSamples =
      windowedAdapter.lastWindowSampleCount > 0
        ? windowedAdapter.lastWindowSampleCount
        : windowedPayload.sampleCount;
    controller.setData(windowedPayload);
  }

  function applyStreamingDecimation(
    phase: "gesture" | "settled",
    domain: ViewportDomain,
  ): void {
    if (controller === null || streamingAdapter === null) return;
    const emitted = streamingAdapter.invalidate(phase, domain.xMin, domain.xMax);
    if (emitted > 0) {
      lastVisibleSamples = emitted;
      controller.setData(streamingPayload);
    }
  }

  function syncDirectVisibleSamples(domain: ViewportDomain): void {
    resolveSampleWindow(sourcePayload, domain.xMin, domain.xMax, sampleSpan);
    lastVisibleSamples = Math.max(0, sampleSpan.end - sampleSpan.start);
  }

  function syncHud(): void {
    if (controller === null || interaction === null) return;
    const domain = controller.domain;
    hud.activeEngine.textContent = controller.activeKind;
    hud.domainX.textContent = formatDomainX(
      domain.xMin,
      domain.xMax,
      currentPreset.highPrecisionX,
    );
    hud.domainY.textContent = formatDomainY(domain.yMin, domain.yMax, currentPreset.isLogY);
    hud.gestureState.textContent = interaction.state;
    hud.gestureActive.textContent = String(controller.gestureActive);
    hud.pointerRegion.textContent = lastPointerRegion;
    hud.invalidationSeq.textContent = String(lastInvalidationSeq);
    hud.invalidationPhase.textContent = lastInvalidationPhase;
    hud.visibleSamples.textContent = String(lastVisibleSamples);
  }

  function handleInvalidate(event: ViewportInvalidationEvent): void {
    if (disposed || controller === null) return;
    lastInvalidationSeq = event.seq;
    lastInvalidationPhase = event.phase;

    if (currentInvalidationMode === "streaming-ring") {
      applyStreamingDecimation(event.phase, event.domain);
    } else if (currentInvalidationMode === "windowed-port") {
      if (event.phase === "settled") {
        applyWindowedDecimation(event.domain, event.seq);
      } else {
        syncDirectVisibleSamples(event.domain);
      }
    } else {
      syncDirectVisibleSamples(event.domain);
    }

    syncHud();
  }

  function attachInteractionController(home: ViewportDomain): void {
    if (interaction !== null) {
      interaction.dispose();
      interaction = null;
    }
    if (controller === null) return;

    interaction = createViewportInteractionController({
      controller,
      dragMode: currentDragMode,
      wheelAxis: currentWheelAxis,
      homeDomain: home,
      onDomainChange() {
        syncHud();
      },
      onInvalidate: handleInvalidate,
      onGestureStateChange(event) {
        lastPointerRegion = event.region;
        syncHud();
      },
    });
  }

  function mountControllersForPreset(preset: PresetConfig): void {
    if (interaction !== null) {
      interaction.dispose();
      interaction = null;
    }
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }

    populatePresetPayload(sourcePayload, preset, currentSampleCount);
    rebuildInvalidationPipelines(preset);

    const controllerOptions: SpectrumEngineControllerOptions = {
      container: stage,
      mode: "auto",
      style,
      axes,
      ...(preset.yAxes !== undefined ? { yAxes: preset.yAxes } : {}),
      autoResize: options?.autoResize ?? true,
      initialWidth: 800,
      initialHeight: STAGE_HEIGHT_PX,
      createWebGL2Renderer: baseCreateWebGL2,
      ...(options?.createCanvas2DRenderer !== undefined
        ? { createCanvas2DRenderer: options.createCanvas2DRenderer }
        : {}),
      onEngineChange() {
        syncHud();
      },
    };

    controller = createSpectrumEngineController(controllerOptions);
    const home = presetHomeDomain(preset);

    if (currentInvalidationMode === "streaming-ring") {
      applyStreamingDecimation("settled", home);
    } else if (currentInvalidationMode === "windowed-port") {
      applyWindowedDecimation(home, lastInvalidationSeq + 1);
    } else {
      controller.setData(sourcePayload);
      syncDirectVisibleSamples(home);
    }

    controller.setDomain(home.xMin, home.xMax, home.yMin, home.yMax);
    controller.render();

    attachInteractionController(home);
    syncHud();
  }

  function classifyClientPoint(clientX: number, clientY: number): PointerRegion {
    if (controller === null) return "outside";
    const t = controller.transform;
    const rect = stage.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const devX = rect.width > 0 ? (cssX / rect.width) * t.deviceWidth : cssX * t.dpr;
    const devY = rect.height > 0 ? (cssY / rect.height) * t.deviceHeight : cssY * t.dpr;
    return classifyPointerRegion(t, devX, devY);
  }

  const onStagePointerMove = (event: PointerEvent): void => {
    if (disposed) return;
    lastPointerRegion = classifyClientPoint(event.clientX, event.clientY);
    hud.pointerRegion.textContent = lastPointerRegion;
  };

  const onPresetChange = (): void => {
    if (disposed) return;
    const value = presetSelect.value;
    if (isPresetId(value)) {
      currentPreset = PRESETS[value];
      mountControllersForPreset(currentPreset);
    }
  };

  const onDragModeChange = (): void => {
    if (disposed || interaction === null) return;
    const value = dragModeSelect.value;
    if (isDragMode(value)) {
      currentDragMode = value;
      interaction.setDragMode(value);
      syncHud();
    }
  };

  const onWheelAxisChange = (): void => {
    if (disposed || controller === null) return;
    const value = wheelAxisSelect.value;
    if (isWheelAxis(value)) {
      currentWheelAxis = value;
      attachInteractionController(presetHomeDomain(currentPreset));
      syncHud();
    }
  };

  const onSampleCountChange = (): void => {
    if (disposed || controller === null) return;
    const parsed = Number(sampleCountSelect.value);
    if (!Number.isFinite(parsed) || parsed < 2) return;
    currentSampleCount = Math.min(MAX_SAMPLES, Math.round(parsed));
    populatePresetPayload(sourcePayload, currentPreset, currentSampleCount);
    rebuildInvalidationPipelines(currentPreset);

    const domain = controller.domain;
    if (currentInvalidationMode === "streaming-ring") {
      applyStreamingDecimation("settled", domain);
    } else if (currentInvalidationMode === "windowed-port") {
      applyWindowedDecimation(domain, lastInvalidationSeq + 1);
    } else {
      controller.setData(sourcePayload);
      syncDirectVisibleSamples(domain);
    }
    controller.render();
    syncHud();
  };

  const onInvalidationModeChange = (): void => {
    if (disposed || controller === null) return;
    const value = invalidationModeSelect.value;
    if (!isInvalidationMode(value)) return;
    currentInvalidationMode = value;

    const domain = controller.domain;
    if (value === "streaming-ring") {
      applyStreamingDecimation("settled", domain);
    } else if (value === "windowed-port") {
      applyWindowedDecimation(domain, lastInvalidationSeq + 1);
    } else {
      controller.setData(sourcePayload);
      syncDirectVisibleSamples(domain);
    }
    controller.render();
    syncHud();
  };

  const onZoomIn = (): void => {
    if (disposed || interaction === null) return;
    interaction.zoomByFactor(0.5, 0.5);
    syncHud();
  };

  const onZoomOut = (): void => {
    if (disposed || interaction === null) return;
    interaction.zoomByFactor(2, 2);
    syncHud();
  };

  const onPanLeft = (): void => {
    if (disposed || interaction === null) return;
    interaction.panByFraction(-0.2, 0);
    syncHud();
  };

  const onPanRight = (): void => {
    if (disposed || interaction === null) return;
    interaction.panByFraction(0.2, 0);
    syncHud();
  };

  const onResetDomain = (): void => {
    if (disposed || interaction === null) return;
    interaction.resetDomain();
    syncHud();
  };

  stage.addEventListener("pointermove", onStagePointerMove);
  presetSelect.addEventListener("change", onPresetChange);
  dragModeSelect.addEventListener("change", onDragModeChange);
  wheelAxisSelect.addEventListener("change", onWheelAxisChange);
  sampleCountSelect.addEventListener("change", onSampleCountChange);
  invalidationModeSelect.addEventListener("change", onInvalidationModeChange);
  zoomInBtn.addEventListener("click", onZoomIn);
  zoomOutBtn.addEventListener("click", onZoomOut);
  panLeftBtn.addEventListener("click", onPanLeft);
  panRightBtn.addEventListener("click", onPanRight);
  resetDomainBtn.addEventListener("click", onResetDomain);

  mountControllersForPreset(currentPreset);

  return () => {
    if (disposed) return;
    disposed = true;

    stage.removeEventListener("pointermove", onStagePointerMove);
    presetSelect.removeEventListener("change", onPresetChange);
    dragModeSelect.removeEventListener("change", onDragModeChange);
    wheelAxisSelect.removeEventListener("change", onWheelAxisChange);
    sampleCountSelect.removeEventListener("change", onSampleCountChange);
    invalidationModeSelect.removeEventListener("change", onInvalidationModeChange);
    zoomInBtn.removeEventListener("click", onZoomIn);
    zoomOutBtn.removeEventListener("click", onZoomOut);
    panLeftBtn.removeEventListener("click", onPanLeft);
    panRightBtn.removeEventListener("click", onPanRight);
    resetDomainBtn.removeEventListener("click", onResetDomain);

    if (interaction !== null) {
      interaction.dispose();
      interaction = null;
    }
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }
    if (windowedAdapter !== null) {
      windowedAdapter.dispose();
      windowedAdapter = null;
    }
    if (decimationPort !== null) {
      decimationPort.dispose();
      decimationPort = null;
    }
    streamingAdapter = null;

    root.remove();
  };
}

export function mount(host: ViewHost): Promise<ViewTeardown> {
  return mountViewportInteraction(host);
}
