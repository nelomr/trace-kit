import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type DecimationSelection,
  type SpectrumDataPayload,
} from "@trace-kit/core";
import type { AxisLayout, FigureRenderer, FigureStyle } from "@trace-kit/renderers";
import {
  classifyHysteresisBand,
  createSpectrumEngineController,
  type EngineChangeEvent,
  type EngineSelectionMode,
  type SpectrumEngineControllerOptions,
  type WebGL2FallbackEvent,
} from "@trace-kit/renderers/controller";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import {
  WebGL2FigureRenderer,
  type WebGL2FigureRendererOptions,
} from "@trace-kit/renderers/webgl2";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";

const MAX_SAMPLES = 250_000;
const MIN_SAMPLES = 10_000;
const INITIAL_SAMPLES = 10_000;
const X_ORIGIN_NM = 1550;
const X_SPAN_NM = 40;
const Y_MIN_DBM = -80;
const Y_MAX_DBM = 6;
const STAGE_HEIGHT_PX = 420;
const LABEL_GUTTER_CSS = 56;

const SAMPLE_PRESETS: readonly number[] = [
  10_000,
  50_000,
  64_000,
  72_000,
  80_000,
  150_000,
  250_000,
];

type DecimationChoice = "default" | "lttb" | "min-max";

const DECIMATION_SELECTIONS: Readonly<Record<DecimationChoice, DecimationSelection | undefined>> = {
  default: undefined,
  lttb: { algorithm: "lttb" },
  "min-max": { algorithm: "min-max" },
};

export interface EngineControllerViewOptions {
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

function populateOpticalSpectrum(payload: SpectrumDataPayload): void {
  const x = payload.x;
  const y = payload.y;
  const denom = Math.max(1, payload.capacity - 1);
  let prng = 0x51a7_9c3d;

  for (let i = 0; i < payload.capacity; i += 1) {
    const offsetNm = (i / denom) * X_SPAN_NM;
    x[i] = offsetNm;

    // Periodic multi-peak optical spectrum so every prefix [0, N) shows sharp Lorentzian peaks.
    const localNm = offsetNm % 1.6;
    const d1 = localNm - 0.45;
    const d2 = localNm - 1.1;
    const peak1 = 52 / (1 + (d1 / 0.035) * (d1 / 0.035));
    const peak2 = 34 / (1 + (d2 / 0.06) * (d2 / 0.06));
    const ripple = 2.5 * Math.sin(offsetNm * 1.7);

    prng = nextUint32(prng);
    const noise = (prng / 4_294_967_296 - 0.5) * 4.2;

    y[i] = -68 + peak1 + peak2 + ripple + noise;
  }
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

function isEngineSelectionMode(value: string): value is EngineSelectionMode {
  return value === "auto" || value === "canvas2d" || value === "webgl2";
}

function isDecimationChoice(value: string): value is DecimationChoice {
  return value === "default" || value === "lttb" || value === "min-max";
}

function formatPresetLabel(count: number): string {
  return `${Math.round(count / 1_000)}k`;
}

interface HudFields {
  readonly activeEngine: HTMLElement;
  readonly selectionMode: HTMLElement;
  readonly sampleCount: HTMLElement;
  readonly hysteresisBand: HTMLElement;
  readonly canvasCount: HTMLElement;
  readonly pendingEngine: HTMLElement;
  readonly gestureActive: HTMLElement;
  readonly webgl2Fallback: HTMLElement;
  readonly switchCount: HTMLElement;
}

function createHud(parent: HTMLElement): HudFields {
  const hud = document.createElement("div");
  hud.setAttribute("data-role", "controller-hud");
  hud.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:0.5rem;" +
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
    selectionMode: metric("Mode", "selection-mode", "auto"),
    sampleCount: metric("Samples", "sample-count", String(INITIAL_SAMPLES)),
    hysteresisBand: metric("Band", "hysteresis-band", "below-down"),
    canvasCount: metric("Canvases", "canvas-count", "1"),
    pendingEngine: metric("Pending", "pending-engine", "none"),
    gestureActive: metric("Gesture", "gesture-active", "false"),
    webgl2Fallback: metric("Fallback", "webgl2-fallback", "false"),
    switchCount: metric("Switches", "switch-count", "0"),
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

export async function mountEngineController(
  host: ViewHost,
  options?: EngineControllerViewOptions,
): Promise<ViewTeardown> {
  if (options?.ensureFont !== undefined) {
    await options.ensureFont();
  } else {
    await ensureDefaultFont();
  }

  if (host.signal.aborted) {
    return () => {};
  }

  // Preallocate a single Retained payload up to 250,000 samples (zero per-change buffer reallocations).
  const payload = createSpectrumDataPayload({
    capacity: MAX_SAMPLES,
    xOrigin: X_ORIGIN_NM,
    xUnit: "nm",
    yUnit: "dBm",
  });
  populateOpticalSpectrum(payload);
  commitPayloadRevision(payload, INITIAL_SAMPLES);

  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;gap:0.75rem;padding:0.75rem;" +
    "font-family:var(--tk-font-family,system-ui,sans-serif)";

  const hud = createHud(root);

  const controlsBar = document.createElement("div");
  controlsBar.style.cssText = "display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center";

  const presetHandlers: Array<{ button: HTMLButtonElement; handler: () => void }> = [];
  for (const preset of SAMPLE_PRESETS) {
    const button = makeButton(formatPresetLabel(preset), `samples-${preset}`);
    controlsBar.appendChild(button);
    presetHandlers.push({
      button,
      handler: () => {
        applySampleCount(preset);
      },
    });
  }

  const sliderLabel = document.createElement("label");
  sliderLabel.style.cssText =
    "display:inline-flex;align-items:center;gap:0.4rem;font-size:12px;" +
    "color:var(--tk-color-text-muted,#8a97a8)";
  sliderLabel.textContent = "Samples ";
  const sampleSlider = document.createElement("input");
  sampleSlider.type = "range";
  sampleSlider.min = String(MIN_SAMPLES);
  sampleSlider.max = String(MAX_SAMPLES);
  sampleSlider.step = "1000";
  sampleSlider.value = String(INITIAL_SAMPLES);
  sampleSlider.setAttribute("data-action", "sample-count-slider");
  sampleSlider.setAttribute("aria-label", "Sample count");
  sliderLabel.appendChild(sampleSlider);

  const modeSelect = document.createElement("select");
  modeSelect.setAttribute("data-action", "mode-select");
  modeSelect.setAttribute("aria-label", "Engine selection mode");
  for (const [value, label] of [
    ["auto", "Mode: Auto"],
    ["canvas2d", "Mode: Canvas2D"],
    ["webgl2", "Mode: WebGL2"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }

  const decimationSelect = document.createElement("select");
  decimationSelect.setAttribute("data-action", "decimation-select");
  decimationSelect.setAttribute("aria-label", "Decimation");
  for (const [value, label] of [
    ["default", "Decimation: Default"],
    ["lttb", "Decimation: LTTB"],
    ["min-max", "Decimation: Min-Max"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    decimationSelect.appendChild(opt);
  }

  const gestureLabel = document.createElement("label");
  gestureLabel.style.cssText =
    "display:inline-flex;align-items:center;gap:0.35rem;font-size:12px;" +
    "color:var(--tk-color-text-muted,#8a97a8);cursor:pointer";
  const gestureToggle = document.createElement("input");
  gestureToggle.type = "checkbox";
  gestureToggle.setAttribute("data-action", "gesture-toggle");
  gestureLabel.append(gestureToggle, document.createTextNode("Gesture Lock"));

  const failureLabel = document.createElement("label");
  failureLabel.style.cssText =
    "display:inline-flex;align-items:center;gap:0.35rem;font-size:12px;" +
    "color:var(--tk-color-text-muted,#8a97a8);cursor:pointer";
  const failureToggle = document.createElement("input");
  failureToggle.type = "checkbox";
  failureToggle.setAttribute("data-action", "simulate-webgl2-failure");
  failureLabel.append(failureToggle, document.createTextNode("Simulate WebGL2 Failure"));

  controlsBar.append(sliderLabel, modeSelect, decimationSelect, gestureLabel, failureLabel);
  root.appendChild(controlsBar);

  const stage = document.createElement("div");
  stage.setAttribute("data-role", "controller-stage");
  stage.style.cssText =
    `position:relative;width:100%;height:${STAGE_HEIGHT_PX}px;` +
    "border:1px solid var(--tk-color-border,#1c2530);border-radius:6px;overflow:hidden";
  root.appendChild(stage);

  host.container.appendChild(root);

  let disposed = false;
  let switchCount = 0;
  let simulateWebGL2Failure = false;
  let lastFallbackMessage = "";

  const baseCreateWebGL2 =
    options?.createWebGL2Renderer ??
    ((glOptions: WebGL2FigureRendererOptions): FigureRenderer =>
      new WebGL2FigureRenderer(glOptions));

  const wrappedCreateWebGL2 = (glOptions: WebGL2FigureRendererOptions): FigureRenderer => {
    if (simulateWebGL2Failure) {
      throw new Error("Simulated WebGL2 context acquisition failure");
    }
    return baseCreateWebGL2(glOptions);
  };

  const { style, axes } = readFigureTokensFromCss();

  const controllerOptions: SpectrumEngineControllerOptions = {
    container: stage,
    mode: "auto",
    style,
    axes,
    autoResize: options?.autoResize ?? true,
    initialWidth: 800,
    initialHeight: STAGE_HEIGHT_PX,
    createWebGL2Renderer: wrappedCreateWebGL2,
    ...(options?.createCanvas2DRenderer !== undefined
      ? { createCanvas2DRenderer: options.createCanvas2DRenderer }
      : {}),
    onEngineChange(event: EngineChangeEvent): void {
      if (event.previousKind !== null) {
        switchCount += 1;
      }
    },
    onWebGL2Fallback(event: WebGL2FallbackEvent): void {
      lastFallbackMessage =
        event.error instanceof Error ? event.error.message : String(event.error);
    },
  };

  const controller = createSpectrumEngineController(controllerOptions);

  function syncHud(): void {
    const band = classifyHysteresisBand(controller.sampleCount, controller.hysteresis);
    hud.activeEngine.textContent = controller.activeKind;
    hud.selectionMode.textContent = controller.mode;
    hud.sampleCount.textContent = String(controller.sampleCount);
    hud.hysteresisBand.textContent = band;
    hud.canvasCount.textContent = String(controller.canvases.length);
    hud.pendingEngine.textContent = controller.pendingKind ?? "none";
    hud.gestureActive.textContent = String(controller.gestureActive);
    hud.webgl2Fallback.textContent = String(controller.webgl2Fallback);
    hud.webgl2Fallback.title = controller.webgl2Fallback ? lastFallbackMessage : "";
    hud.switchCount.textContent = String(switchCount);
  }

  function applySampleCount(targetCount: number): void {
    if (disposed) return;
    const clamped = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(targetCount)));
    sampleSlider.value = String(clamped);
    commitPayloadRevision(payload, clamped);
    const xSpan = payload.x[clamped - 1] ?? X_SPAN_NM;
    controller.setDomain(X_ORIGIN_NM, X_ORIGIN_NM + Math.max(1e-3, xSpan), Y_MIN_DBM, Y_MAX_DBM);
    controller.render();
    syncHud();
  }

  const onSliderInput = (): void => {
    const parsed = Number(sampleSlider.value);
    if (Number.isFinite(parsed)) {
      applySampleCount(parsed);
    }
  };

  const onModeChange = (): void => {
    if (disposed) return;
    const value = modeSelect.value;
    if (isEngineSelectionMode(value)) {
      controller.setMode(value);
      syncHud();
    }
  };

  const onDecimationChange = (): void => {
    if (disposed) return;
    const value = decimationSelect.value;
    if (isDecimationChoice(value)) {
      controller.setDecimation(DECIMATION_SELECTIONS[value]);
      controller.render();
      syncHud();
    }
  };

  const onGestureChange = (): void => {
    if (disposed) return;
    controller.setGestureActive(gestureToggle.checked);
    syncHud();
  };

  const onFailureChange = (): void => {
    if (disposed) return;
    simulateWebGL2Failure = failureToggle.checked;
    if (!simulateWebGL2Failure) {
      lastFallbackMessage = "";
      controller.retryWebGL2();
    }
    syncHud();
  };

  for (const { button, handler } of presetHandlers) {
    button.addEventListener("click", handler);
  }
  sampleSlider.addEventListener("input", onSliderInput);
  modeSelect.addEventListener("change", onModeChange);
  decimationSelect.addEventListener("change", onDecimationChange);
  gestureToggle.addEventListener("change", onGestureChange);
  failureToggle.addEventListener("change", onFailureChange);

  controller.setData(payload);
  const initialXSpan = payload.x[INITIAL_SAMPLES - 1] ?? X_SPAN_NM;
  controller.setDomain(
    X_ORIGIN_NM,
    X_ORIGIN_NM + Math.max(1e-3, initialXSpan),
    Y_MIN_DBM,
    Y_MAX_DBM,
  );
  controller.render();
  syncHud();

  return () => {
    if (disposed) return;
    disposed = true;
    for (const { button, handler } of presetHandlers) {
      button.removeEventListener("click", handler);
    }
    sampleSlider.removeEventListener("input", onSliderInput);
    modeSelect.removeEventListener("change", onModeChange);
    decimationSelect.removeEventListener("change", onDecimationChange);
    gestureToggle.removeEventListener("change", onGestureChange);
    failureToggle.removeEventListener("change", onFailureChange);
    controller.dispose();
    root.remove();
  };
}

export function mount(host: ViewHost): Promise<ViewTeardown> {
  return mountEngineController(host);
}
