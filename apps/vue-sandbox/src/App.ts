import {
  DecimationKind,
  SATURATED,
  StatCounter,
  TransportHealth,
  createTransportStatsView,
  createWorkerDecimationPort,
  detectTransportCapabilities,
  exportCsv,
  exportNpy,
  type CsvTraceSource,
  type DecimationPort,
  type DecimationSelection,
  type Lease,
  type NpyArrayKind,
  type SettlementSink,
  type SpectrumDataPayload,
  type TraceCollection,
  type YAxisRegistration,
} from "@trace-kit/core";
import type { AxisLayout } from "@trace-kit/renderers";
import {
  DEFAULT_HYSTERESIS_CONFIG,
  classifyHysteresisBand,
  type EngineChangeEvent,
  type EngineKind,
  type EngineSelectionMode,
  type InteractionDragMode,
  type SpectrumEngineController,
  type ViewportDomain,
  type ViewportInteractionController,
} from "@trace-kit/renderers/controller";
import { TRACEKIT_INTER_EMBEDDED_FONT, ensureDefaultFont } from "@trace-kit/renderers/font";
import { exportToSvg } from "@trace-kit/renderers/svg";
import {
  TraceSpectrumViewer,
  snapshotDomain,
  type SpectrumEngineReadyEvent,
  type TraceSpectrumViewerSlotProps,
} from "@trace-kit/vue";
import {
  computed,
  defineComponent,
  h,
  isProxy,
  isShallow,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  watch,
  type VNode,
} from "vue";
import {
  MAX_SAMPLES,
  MIN_SAMPLES,
  SAMPLE_PRESETS,
  SAMPLE_STEP,
  SCENARIOS,
  SCENARIO_ORDER,
  buildDwdmCollection,
  computeWindowOpticalMetrics,
  createSignalPool,
  populateFbgScenario,
  populateLiveGridX,
  populateLogPowerScenario,
  stepLiveSpectrum,
  type ScenarioId,
} from "./signals.ts";
import {
  createThemeController,
  figureStyleForScheme,
  type ThemePreference,
} from "./theme.ts";

type DecimationChoice = "native" | "lttb" | "min-max";

const DECIMATION_MAP: Readonly<Record<DecimationChoice, DecimationSelection | undefined>> =
  Object.freeze({
    native: undefined,
    lttb: Object.freeze({ algorithm: "lttb" as const }),
    "min-max": Object.freeze({ algorithm: "min-max" as const }),
  });

const SANDBOX_AXES_LAYOUT: Partial<AxisLayout> = Object.freeze({
  labelGutter: 56,
  tickLength: 4,
  targetTickCount: 6,
});

function formatWavelength(nm: number, spanNm: number): string {
  if (!Number.isFinite(nm)) return "--";
  if (spanNm < 0.002) return nm.toFixed(6);
  if (spanNm < 0.05) return nm.toFixed(4);
  if (spanNm < 2) return nm.toFixed(3);
  return nm.toFixed(2);
}

function formatSpanNm(spanNm: number): string {
  if (!Number.isFinite(spanNm) || spanNm <= 0) return "--";
  if (spanNm < 0.001) return `${(spanNm * 1_000_000).toFixed(1)} fm`;
  if (spanNm < 0.1) return `${(spanNm * 1_000).toFixed(2)} pm`;
  return `${spanNm.toFixed(3)} nm`;
}

function formatYValue(value: number, isLog: boolean): string {
  if (!Number.isFinite(value)) return "--";
  if (isLog) {
    if (value >= 0.1 && value < 1000) return value.toFixed(2);
    return value.toExponential(1);
  }
  return value.toFixed(1);
}

function formatSampleText(count: number): string {
  const band = classifyHysteresisBand(count, DEFAULT_HYSTERESIS_CONFIG);
  const formatted = count.toLocaleString("en-US");
  if (band === "above-up") return `${formatted} samples (above WebGL2 threshold)`;
  if (band === "below-down") return `${formatted} samples (below Canvas2D threshold)`;
  return `${formatted} samples (inside 64k to 80k hysteresis deadband)`;
}

function formatPresetChip(count: number): string {
  return `${Math.round(count / 1_000)}k`;
}

const WORKER_HEALTH_NAMES: readonly string[] = [
  "Ready",
  "Saturated",
  "Stalled",
  "Recovering",
  "Degraded",
];

function detectWorkerBacking(): "Shared" | "Transfer" {
  const caps = detectTransportCapabilities();
  if (caps.sharedMemory && caps.crossOriginIsolated && typeof Atomics !== "undefined") {
    return "Shared";
  }
  return "Transfer";
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Installs roving-tabindex keyboard navigation for all `[role="toolbar"]` containers ONLY
 * when native `focusgroup` is not supported by the browser.
 */
function attachToolbarRovingFallback(root: HTMLElement): () => void {
  if ("focusGroup" in HTMLElement.prototype) {
    return () => {};
  }

  const getToolbarItems = (toolbar: HTMLElement): HTMLElement[] =>
    Array.from(
      toolbar.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
    );

  const syncTabIndices = (): void => {
    const toolbars = Array.from(root.querySelectorAll<HTMLElement>('[role="toolbar"]'));
    for (const toolbar of toolbars) {
      const items = getToolbarItems(toolbar);
      if (items.length === 0) continue;
      let activeIdx = items.findIndex(
        (el) => el.getAttribute("aria-pressed") === "true" || el.tabIndex === 0,
      );
      if (activeIdx < 0) activeIdx = 0;
      for (let i = 0; i < items.length; i += 1) {
        items[i]!.tabIndex = i === activeIdx ? 0 : -1;
      }
    }
  };

  syncTabIndices();

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const toolbar = target.closest<HTMLElement>('[role="toolbar"]');
    if (toolbar === null) return;

    const items = getToolbarItems(toolbar);
    const idx = items.indexOf(target);
    if (idx < 0 || items.length < 2) return;

    const rtl = getComputedStyle(toolbar).direction === "rtl";
    const vertical = toolbar.getAttribute("aria-orientation") === "vertical";

    let nextIdx = -1;
    if (vertical) {
      if (event.key === "ArrowDown") {
        nextIdx = (idx + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        nextIdx = (idx - 1 + items.length) % items.length;
      }
    } else if (event.key === "ArrowRight") {
      nextIdx = (idx + (rtl ? -1 : 1) + items.length) % items.length;
    } else if (event.key === "ArrowLeft") {
      nextIdx = (idx + (rtl ? 1 : -1) + items.length) % items.length;
    }

    if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = items.length - 1;
    }

    if (nextIdx >= 0) {
      event.preventDefault();
      for (let i = 0; i < items.length; i += 1) {
        items[i]!.tabIndex = i === nextIdx ? 0 : -1;
      }
      items[nextIdx]!.focus();
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const toolbar = target.closest<HTMLElement>('[role="toolbar"]');
    if (toolbar === null) return;
    const items = getToolbarItems(toolbar);
    if (!items.includes(target)) return;
    for (const item of items) {
      item.tabIndex = item === target ? 0 : -1;
    }
  };

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("focusin", onFocusIn);

  return () => {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("focusin", onFocusIn);
  };
}

export const App = defineComponent({
  name: "TraceKitOsaSandbox",
  setup() {
    const shellRef = shallowRef<HTMLElement | null>(null);
    const theme = createThemeController();
    const signalPool = createSignalPool();

    const scenarioId = shallowRef<ScenarioId>("fbg-1550");
    const sampleCount = shallowRef<number>(SCENARIOS["fbg-1550"].defaultSamples);
    const engineMode = shallowRef<EngineSelectionMode>("auto");
    const decimationChoice = shallowRef<DecimationChoice>("native");
    const dragMode = shallowRef<InteractionDragMode>("pan");
    const drawerOpen = shallowRef<boolean>(false);
    const liveStreaming = shallowRef<boolean>(true);
    const fontReady = shallowRef<boolean>(false);

    // Non-proxied payload/traces refs fed to TraceSpectrumViewer
    const currentData = shallowRef<SpectrumDataPayload | undefined>(undefined);
    const currentTraces = shallowRef<TraceCollection | undefined>(undefined);
    const payloadRevision = shallowRef<number>(0);

    // Controlled viewport domain (shallowRef so isShallow(domainRef) === true)
    const domainRef = shallowRef<ViewportDomain>(snapshotDomain(SCENARIOS["fbg-1550"].homeDomain));

    // Raw controller/interaction handles captured from onReady
    const liveController = shallowRef<SpectrumEngineController | null>(null);
    const liveInteraction = shallowRef<ViewportInteractionController | null>(null);

    // Live telemetry refs (updated on events / throttled 250 ms timer during 60 Hz stream)
    const activeEngineKind = shallowRef<EngineKind>("canvas2d");
    const activeCanvasCount = shallowRef<number>(1);
    const engineSwitchCount = shallowRef<number>(0);
    const contextLostState = shallowRef<boolean>(false);
    const webgl2FallbackState = shallowRef<boolean>(false);
    const measuredFps = shallowRef<number | null>(null);
    const measuredFrameMs = shallowRef<number | null>(null);
    const statusAnnouncement = shallowRef<string>("");

    // Optional off-main-thread Web Worker decimation pipeline (WorkerDecimationPort)
    const workerEnabled = shallowRef<boolean>(false);
    const workerBacking = shallowRef<"Shared" | "Transfer">(detectWorkerBacking());
    const workerHealthLabel = shallowRef<string>("Off");
    const workerOutCount = shallowRef<number>(0);
    const workerRoundtripMs = shallowRef<number | null>(null);

    let workerPort: DecimationPort | null = null;
    let workerPollRafId: number | null = null;
    let workerSubmittedAtMs = 0;
    const workerStatsView = createTransportStatsView();

    // Active WEBGL_lose_context extension retained across Lose -> Restore
    let activeLoseContextExt: WEBGL_lose_context | null = null;
    let rafStreamId: number | null = null;
    let streamFrameCounter = 0;
    let streamStartTimeMs = 0;
    let fpsSampleStartMs = 0;
    let fpsFrameAcc = 0;
    let frameCostAccMs = 0;
    let stopRovingFallback: (() => void) | null = null;

    const currentScenario = computed(() => SCENARIOS[scenarioId.value]);
    const currentFigureStyle = computed(() => figureStyleForScheme(theme.resolvedScheme.value));
    const currentDecimation = computed(() => DECIMATION_MAP[decimationChoice.value]);
    const viewerKey = computed(
      () => `${theme.resolvedScheme.value}-${currentScenario.value.axisMode}`,
    );

    const hysteresisBand = computed(() =>
      classifyHysteresisBand(sampleCount.value, DEFAULT_HYSTERESIS_CONFIG),
    );

    const payloadIsProxy = computed(() => {
      const target = currentTraces.value ?? currentData.value;
      return target !== undefined ? isProxy(target) : false;
    });

    const controllerIsProxy = computed(() => {
      const ctrl = liveController.value;
      return ctrl !== null ? isProxy(ctrl) : false;
    });

    const domainIsShallow = isShallow(domainRef);

    const activePrimaryPayload = computed<SpectrumDataPayload>(() => {
      if (scenarioId.value === "dwdm-40ch") {
        return signalPool.dwdmActivePayload;
      }
      return currentData.value ?? signalPool.fbgPayload;
    });

    const opticalMetrics = computed(() => {
      // Track payloadRevision & domainRef so metrology refreshes cleanly on scenario/zoom changes
      void payloadRevision.value;
      const dom = domainRef.value;
      const isLog = currentScenario.value.axisMode === "log";
      return computeWindowOpticalMetrics(activePrimaryPayload.value, dom.xMin, dom.xMax, isLog);
    });

    function stopWorkerPoll(): void {
      if (workerPollRafId !== null) {
        window.cancelAnimationFrame(workerPollRafId);
        workerPollRafId = null;
      }
    }

    const workerSettlementSink: SettlementSink = {
      onSettled(lease: Lease<"settled">, outCount: number): void {
        const port = workerPort;
        if (port === null) return;
        const kind =
          decimationChoice.value === "lttb"
            ? DecimationKind.Lttb
            : DecimationKind.MinMaxEnvelope;
        if (kind === DecimationKind.MinMaxEnvelope) {
          void port.viewOut(lease);
        } else {
          void port.viewIndices(lease);
        }
        workerOutCount.value = outCount;
        workerRoundtripMs.value = Number(
          Math.max(0.01, performance.now() - workerSubmittedAtMs).toFixed(2),
        );
        port.release(lease);
        port.readStats(workerStatsView);
        const hCode = workerStatsView.counters[StatCounter.Health] ?? TransportHealth.Ready;
        workerHealthLabel.value = WORKER_HEALTH_NAMES[hCode] ?? "Ready";
        stopWorkerPoll();
      },
    };

    function disposeWorkerPort(): void {
      stopWorkerPoll();
      if (workerPort !== null) {
        workerPort.dispose();
        workerPort = null;
      }
      workerHealthLabel.value = "Off";
      workerOutCount.value = 0;
      workerRoundtripMs.value = null;
    }

    function runWorkerDecimationPass(): void {
      if (!workerEnabled.value || workerPort === null) return;
      const port = workerPort;
      const payload = activePrimaryPayload.value;
      const lease = port.acquire();
      if (lease === SATURATED) {
        workerHealthLabel.value = "Saturated";
        return;
      }

      const count = Math.min(payload.sampleCount, port.transitCapacitySamples);
      const vx = port.viewX(lease);
      const vy = port.viewY(lease);
      vx.set(payload.x.subarray(0, count));
      vy.set(payload.y.subarray(0, count));

      const kind =
        decimationChoice.value === "lttb"
          ? DecimationKind.Lttb
          : DecimationKind.MinMaxEnvelope;
      const buckets = Math.min(1024, Math.max(16, count >> 2));
      port.setKind(lease, kind);
      port.setSampleCount(lease, count);
      port.setBucketCount(lease, buckets);
      port.setDomain(lease, payload.xMin - payload.xOrigin, payload.xMax - payload.xOrigin);

      workerSubmittedAtMs = performance.now();
      port.submit(lease);

      stopWorkerPoll();
      const pollTick = (): void => {
        if (workerPort === null || !workerEnabled.value) {
          workerPollRafId = null;
          return;
        }
        workerPort.poll(workerSettlementSink);
        workerPort.readStats(workerStatsView);
        const outstanding = workerStatsView.counters[StatCounter.LeasesOutstanding] ?? 0;
        const hCode = workerStatsView.counters[StatCounter.Health] ?? TransportHealth.Ready;
        workerHealthLabel.value = WORKER_HEALTH_NAMES[hCode] ?? "Ready";
        if (outstanding > 0) {
          workerPollRafId = window.requestAnimationFrame(pollTick);
        } else {
          workerPollRafId = null;
        }
      };
      workerPollRafId = window.requestAnimationFrame(pollTick);
    }

    function setWorkerPipelineEnabled(enabled: boolean): void {
      if (enabled === workerEnabled.value) return;
      workerEnabled.value = enabled;
      if (!enabled) {
        disposeWorkerPort();
        announce("Worker decimation pipeline disabled");
        return;
      }

      workerBacking.value = detectWorkerBacking();
      workerPort = createWorkerDecimationPort({
        workerFactory: () =>
          new Worker(new URL("./decimation.worker.ts", import.meta.url), {
            type: "module",
          }),
        poolPairs: 2,
        transitCapacitySamples: MAX_SAMPLES,
      });
      workerHealthLabel.value = "Ready";
      runWorkerDecimationPass();
      announce(`Web Worker decimation pipeline enabled (${workerBacking.value})`);
    }

    function announce(message: string): void {
      statusAnnouncement.value = message;
    }

    function stopLiveLoop(): void {
      if (rafStreamId !== null) {
        window.cancelAnimationFrame(rafStreamId);
        rafStreamId = null;
      }
      measuredFps.value = null;
      measuredFrameMs.value = null;
    }

    function startLiveLoop(): void {
      stopLiveLoop();
      if (scenarioId.value !== "live-60hz" || !liveStreaming.value) return;

      streamStartTimeMs = performance.now();
      fpsSampleStartMs = streamStartTimeMs;
      fpsFrameAcc = 0;
      frameCostAccMs = 0;

      const tick = (nowMs: number): void => {
        if (scenarioId.value !== "live-60hz" || !liveStreaming.value) {
          rafStreamId = null;
          return;
        }
        const ctrl = liveController.value;
        if (ctrl !== null && !ctrl.disposed && !ctrl.contextLost) {
          const t0 = performance.now();
          streamFrameCounter += 1;
          stepLiveSpectrum(
            signalPool.livePayload,
            sampleCount.value,
            (nowMs - streamStartTimeMs) * 0.001,
            streamFrameCounter,
          );
          ctrl.requestRender();
          const dt = performance.now() - t0;

          fpsFrameAcc += 1;
          frameCostAccMs += dt;
          const elapsedWindow = nowMs - fpsSampleStartMs;
          if (elapsedWindow >= 250) {
            measuredFps.value = Math.round((fpsFrameAcc * 1000) / elapsedWindow);
            measuredFrameMs.value = Number((frameCostAccMs / fpsFrameAcc).toFixed(2));
            fpsSampleStartMs = nowMs;
            fpsFrameAcc = 0;
            frameCostAccMs = 0;
          }
        }
        rafStreamId = window.requestAnimationFrame(tick);
      };

      rafStreamId = window.requestAnimationFrame(tick);
    }

    function applyScenarioData(id: ScenarioId, samples: number, resetViewport: boolean): void {
      const descriptor = SCENARIOS[id];
      if (id === "fbg-1550") {
        populateFbgScenario(signalPool.fbgPayload, samples);
        currentTraces.value = undefined;
        currentData.value = signalPool.fbgPayload;
      } else if (id === "dwdm-40ch") {
        currentData.value = undefined;
        currentTraces.value = buildDwdmCollection(
          signalPool,
          samples,
          theme.resolvedScheme.value,
        );
      } else if (id === "live-60hz") {
        populateLiveGridX(signalPool.livePayload, samples);
        stepLiveSpectrum(signalPool.livePayload, samples, 0, streamFrameCounter + 1);
        currentTraces.value = undefined;
        currentData.value = signalPool.livePayload;
      } else {
        populateLogPowerScenario(signalPool.logPayload, samples);
        currentTraces.value = undefined;
        currentData.value = signalPool.logPayload;
      }

      if (resetViewport) {
        domainRef.value = snapshotDomain(descriptor.homeDomain);
      }
      payloadRevision.value += 1;
      if (workerEnabled.value) {
        runWorkerDecimationPass();
      }
    }

    // Initialize default FBG 1550 nm dataset immediately
    applyScenarioData("fbg-1550", sampleCount.value, true);

    function selectScenario(nextId: ScenarioId): void {
      if (nextId === scenarioId.value) return;
      stopLiveLoop();
      scenarioId.value = nextId;
      const nextSamples = SCENARIOS[nextId].defaultSamples;
      sampleCount.value = nextSamples;
      applyScenarioData(nextId, nextSamples, true);
      if (nextId === "live-60hz") {
        liveStreaming.value = true;
        startLiveLoop();
      }
      announce(`Loaded scenario ${SCENARIOS[nextId].label} (${nextSamples.toLocaleString("en-US")} samples)`);
    }

    function updateSampleCount(nextCount: number): void {
      const clamped = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(nextCount)));
      if (clamped === sampleCount.value) return;
      sampleCount.value = clamped;
      applyScenarioData(scenarioId.value, clamped, false);
    }

    function toggleLiveStreaming(): void {
      liveStreaming.value = !liveStreaming.value;
      if (liveStreaming.value) {
        startLiveLoop();
        announce("Live 60 Hz acquisition resumed");
      } else {
        stopLiveLoop();
        announce("Live 60 Hz acquisition paused");
      }
    }

    function zoomPrecision1550(): void {
      const target = SCENARIOS["fbg-1550"].precisionZoomDomain;
      if (target === undefined) return;
      if (scenarioId.value !== "fbg-1550") {
        selectScenario("fbg-1550");
      }
      domainRef.value = snapshotDomain(target);
      announce("Zoomed to 4.0 pm pi-phase-shifted FBG notch at 1550.000100 nm (32 pm span)");
    }

    function resetView(): void {
      const interaction = liveInteraction.value;
      if (interaction !== null && !interaction.disposed) {
        interaction.resetDomain();
      } else {
        domainRef.value = snapshotDomain(currentScenario.value.homeDomain);
      }
      announce("Viewport reset to home domain");
    }

    function toggleGlContextLoss(): void {
      const ctrl = liveController.value;
      if (ctrl === null || ctrl.disposed || ctrl.activeKind !== "webgl2") {
        announce("GPU context loss simulation requires active WebGL2 engine");
        return;
      }

      if (contextLostState.value) {
        const ext = activeLoseContextExt;
        if (ext === null) {
          announce("No active WEBGL_lose_context handle available to restore");
          return;
        }
        ext.restoreContext();
        announce("Restoring WebGL2 context");
        return;
      }

      const plotCanvas = ctrl.canvases[1];
      if (plotCanvas === undefined) {
        announce("WebGL2 plot canvas is unavailable");
        return;
      }
      const gl = plotCanvas.getContext("webgl2");
      if (gl === null) {
        announce("Unable to acquire WebGL2 context from plot canvas");
        return;
      }
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext === null) {
        announce("WEBGL_lose_context extension is not supported in this browser");
        return;
      }
      activeLoseContextExt = ext;
      ext.loseContext();
    }

    function handleExportSvg(): void {
      const ctrl = liveController.value;
      const activeSource = currentTraces.value ?? currentData.value;
      if (ctrl === null || ctrl.disposed || activeSource === undefined) {
        announce("Cannot export SVG before renderer is ready");
        return;
      }

      const liveDom = ctrl.domain;
      const exportYAxes: readonly YAxisRegistration[] = currentScenario.value.yAxes.map(
        (axis, idx) =>
          idx === 0
            ? {
                ...axis,
                domainMin: liveDom.yMin,
                domainMax: liveDom.yMax,
              }
            : axis,
      );

      const svgMarkup = exportToSvg(
        {
          traces: activeSource,
          domain: {
            xMin: liveDom.xMin,
            xMax: liveDom.xMax,
            yMin: liveDom.yMin,
            yMax: liveDom.yMax,
          },
          yAxes: exportYAxes,
          width: Math.max(320, Math.round(ctrl.width)),
          height: Math.max(200, Math.round(ctrl.height)),
          style: currentFigureStyle.value,
          axes: SANDBOX_AXES_LAYOUT,
        },
        {
          idPrefix: "tracekit-osa",
          embedFont: TRACEKIT_INTER_EMBEDDED_FONT,
        },
      );

      const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
      triggerBlobDownload(blob, `tracekit-${scenarioId.value}.svg`);

      announce(
        `Exported SVG (${sampleCount.value.toLocaleString("en-US")} samples, ${Math.round(svgMarkup.length / 1024)} KB)`,
      );
    }

    function handleExportCsv(): void {
      const ctrl = liveController.value;
      const dom = ctrl !== null && !ctrl.disposed ? ctrl.domain : domainRef.value;
      const source: CsvTraceSource =
        currentTraces.value !== undefined
          ? currentTraces.value
          : { entries: [{ id: scenarioId.value, payload: activePrimaryPayload.value }] };

      const parts: string[] = [];
      let totalBytes = 0;
      for (const chunk of exportCsv(source, dom.xMin, dom.xMax)) {
        parts.push(chunk);
        totalBytes += chunk.length;
      }
      triggerBlobDownload(
        new Blob(parts, { type: "text/csv;charset=utf-8" }),
        `tracekit-${scenarioId.value}-raw.csv`,
      );
      announce(
        `Exported un-decimated CSV window (${Math.max(1, Math.round(totalBytes / 1024))} KB)`,
      );
    }

    function handleExportNpy(axis: NpyArrayKind): void {
      const ctrl = liveController.value;
      const dom = ctrl !== null && !ctrl.disposed ? ctrl.domain : domainRef.value;
      const payload = activePrimaryPayload.value;

      const parts: Uint8Array<ArrayBuffer>[] = [];
      let totalBytes = 0;
      for (const chunk of exportNpy(payload, axis, dom.xMin, dom.xMax)) {
        const copy = chunk.slice();
        parts.push(copy);
        totalBytes += copy.byteLength;
      }
      triggerBlobDownload(
        new Blob(parts, { type: "application/octet-stream" }),
        `tracekit-${scenarioId.value}-${axis}.npy`,
      );
      announce(
        `Exported NumPy .npy ${axis.toUpperCase()} buffer (${Math.max(1, Math.round(totalBytes / 1024))} KB)`,
      );
    }

    function setThemePreference(next: ThemePreference): void {
      theme.setPreference(next);
      announce(`Color scheme set to ${next}`);
    }

    // Re-color DWDM traces cleanly when resolved theme switches
    watch(
      () => theme.resolvedScheme.value,
      () => {
        if (scenarioId.value === "dwdm-40ch") {
          currentTraces.value = buildDwdmCollection(
            signalPool,
            sampleCount.value,
            theme.resolvedScheme.value,
          );
          payloadRevision.value += 1;
        }
      },
    );

    // Clear stale GL extension handle whenever viewer remounts via key change.
    // Remember the pre-remount engine so theme-only remounts do not inflate engineSwitchCount
    // when the newly mounted controller settles back onto the same engine kind.
    let suppressRemountSwitch = false;
    let remountPreviousKind: EngineKind | null = null;
    watch(
      viewerKey,
      () => {
        suppressRemountSwitch = true;
        remountPreviousKind = activeEngineKind.value;
        activeLoseContextExt = null;
        contextLostState.value = false;
        liveController.value = null;
        liveInteraction.value = null;
      },
      { flush: "sync" },
    );

    function handleViewerReady(event: SpectrumEngineReadyEvent): void {
      liveController.value = event.controller;
      liveInteraction.value = event.interaction;
      activeEngineKind.value = event.controller.activeKind;
      activeCanvasCount.value = event.controller.canvases.length;
      webgl2FallbackState.value = event.controller.webgl2Fallback;
      contextLostState.value = event.controller.contextLost;
      if (scenarioId.value === "live-60hz" && liveStreaming.value) {
        startLiveLoop();
      }
    }

    function handleEngineChange(event: EngineChangeEvent): void {
      activeEngineKind.value = event.activeKind;
      const ctrl = liveController.value;
      activeCanvasCount.value =
        ctrl !== null && !ctrl.disposed
          ? ctrl.canvases.length
          : event.activeKind === "webgl2"
            ? 3
            : 1;
      if (event.previousKind !== null && event.previousKind !== event.activeKind) {
        if (suppressRemountSwitch && event.activeKind === remountPreviousKind) {
          suppressRemountSwitch = false;
          remountPreviousKind = null;
        } else {
          suppressRemountSwitch = false;
          remountPreviousKind = null;
          engineSwitchCount.value += 1;
        }
        activeLoseContextExt = null;
        contextLostState.value = false;
        announce(
          `Switched engine to ${event.activeKind.toUpperCase()} (${event.sampleCount.toLocaleString("en-US")} samples)`,
        );
      }
    }

    onMounted(() => {
      if (shellRef.value !== null) {
        stopRovingFallback = attachToolbarRovingFallback(shellRef.value);
      }
      void ensureDefaultFont()
        .then((loaded) => {
          fontReady.value = loaded;
          const ctrl = liveController.value;
          if (ctrl !== null && !ctrl.disposed) {
            ctrl.requestRender();
          }
        })
        .catch(() => {
          fontReady.value = false;
        });
    });

    onBeforeUnmount(() => {
      stopLiveLoop();
      disposeWorkerPort();
      if (stopRovingFallback !== null) {
        stopRovingFallback();
        stopRovingFallback = null;
      }
      theme.dispose();
    });

    function renderBrandMark(): VNode {
      return h(
        "span",
        { class: "osa-brand-mark", "aria-hidden": "true" },
        h(
          "svg",
          {
            width: "14",
            height: "14",
            viewBox: "0 0 16 16",
            fill: "none",
          },
          [
            h("path", {
              d: "M1.5 11.5H4.2L6 4.2L8.2 12.2L10.3 6.2L11.8 11.5H14.5",
              stroke: "currentColor",
              "stroke-width": "1.6",
              "stroke-linecap": "square",
              "stroke-linejoin": "miter",
            }),
          ],
        ),
      );
    }

    function renderOverlaySlot(slotProps: TraceSpectrumViewerSlotProps): VNode {
      const dom = slotProps.domain;
      const spanNm = Math.max(0, dom.xMax - dom.xMin);
      const isLog = currentScenario.value.axisMode === "log";
      const band = hysteresisBand.value;
      const bandLabel =
        band === "above-up"
          ? "ABOVE-UP (>=80k)"
          : band === "below-down"
            ? "BELOW-DOWN (<=64k)"
            : "DEADBAND (64k-80k)";

      const metrics = opticalMetrics.value;
      const peakLambdaStr = Number.isFinite(metrics.peakXNm)
        ? `${formatWavelength(metrics.peakXNm, spanNm)} nm`
        : "--";
      const peakPowerStr = Number.isFinite(metrics.peakY)
        ? `${formatYValue(metrics.peakY, isLog)} ${currentScenario.value.yUnit}`
        : "--";
      const dynRangeStr = Number.isFinite(metrics.dynamicRangeDb)
        ? `${metrics.dynamicRangeDb.toFixed(1)} dB`
        : "--";

      return h("div", { class: "osa-overlay-hud" }, [
        h("div", { class: "osa-overlay-row" }, [
          h("div", { class: "osa-readout-block" }, [
            h("div", { class: "osa-readout-line" }, [
              h("span", { class: "osa-readout-key" }, "λ"),
              h(
                "span",
                { class: "osa-readout-val" },
                `${formatWavelength(dom.xMin, spanNm)} — ${formatWavelength(dom.xMax, spanNm)} nm`,
              ),
            ]),
            h("div", { class: "osa-readout-line" }, [
              h("span", { class: "osa-readout-key" }, "Δλ"),
              h("span", { class: "osa-readout-val" }, formatSpanNm(spanNm)),
            ]),
            h("div", { class: "osa-readout-line" }, [
              h("span", { class: "osa-readout-key" }, "PK"),
              h("span", { class: "osa-readout-val" }, `${peakLambdaStr} · ${peakPowerStr}`),
            ]),
            h("div", { class: "osa-readout-line" }, [
              h("span", { class: "osa-readout-key" }, "DR"),
              h(
                "span",
                { class: "osa-readout-val" },
                `${dynRangeStr} · ${currentScenario.value.instrumentProfile}`,
              ),
            ]),
          ]),
          h("div", { class: "osa-overlay-badges" }, [
            h("div", { class: "osa-band-pill", "data-band": band }, bandLabel),
            slotProps.contextLost
              ? h("div", { class: "osa-gl-alert" }, "GL CONTEXT LOST · LOOP SUSPENDED")
              : null,
          ]),
        ]),
        scenarioId.value === "dwdm-40ch"
          ? h("div", { class: "osa-overlay-row" }, [
              h("div", { class: "osa-legend-strip" }, [
                h("span", { class: "osa-legend-item" }, [
                  h("span", { class: "osa-legend-swatch", "data-variant": "active" }),
                  "C-Band Active (Ch 34 −10 dB · Ch 48 +12 GHz)",
                ]),
                h("span", { class: "osa-legend-item" }, [
                  h("span", { class: "osa-legend-swatch", "data-variant": "ref" }),
                  "ITU-T G.694.1 Ref (100 GHz)",
                ]),
              ]),
            ])
          : h("div", { class: "osa-overlay-row" }),
      ]);
    }

    return () => {
      const activeKind = activeEngineKind.value;
      const isWebGL2 = activeKind === "webgl2";
      const canvasCount = activeCanvasCount.value;
      const engineBadgeText = isWebGL2
        ? `WEBGL2 · ${canvasCount} CANVASES`
        : `CANVAS2D · ${canvasCount} CANVAS`;
      const proxyBadgeText =
        !payloadIsProxy.value && !controllerIsProxy.value ? "PROXY: NONE" : "PROXY: DETECTED";
      const fpsBadgeText =
        scenarioId.value === "live-60hz" && measuredFps.value !== null && measuredFrameMs.value !== null
          ? `${measuredFps.value} FPS · ${measuredFrameMs.value.toFixed(2)} ms`
          : scenarioId.value === "live-60hz" && !liveStreaming.value
            ? "STREAM: PAUSED"
            : "IDLE · ON-DEMAND";

      const glStatusText = contextLostState.value
        ? "LOST"
        : webgl2FallbackState.value
          ? "FALLBACK"
          : isWebGL2
            ? "HEALTHY"
            : "STANDBY (2D)";

      const glStatusTone = contextLostState.value
        ? "danger"
        : webgl2FallbackState.value
          ? "warn"
          : isWebGL2
            ? "true"
            : "warn";

      return h("div", { ref: shellRef, class: "osa-shell" }, [
        // Top Instrument Bar (48px)
        h("header", { class: "osa-topbar" }, [
          h("div", { class: "osa-brand" }, [
            renderBrandMark(),
            h("span", { class: "osa-brand-name" }, "TRACEKIT"),
            h("span", { class: "osa-model-plate" }, "OSA-1550 // @trace-kit/vue"),
          ]),
          h("div", { class: "osa-telemetry-strip", "aria-label": "Engine telemetry summary" }, [
            h("span", { class: "osa-chip", "data-tone": activeKind }, [
              h("span", { class: "osa-chip-dot", "aria-hidden": "true" }),
              engineBadgeText,
            ]),
            h(
              "span",
              {
                class: "osa-chip",
                "data-tone": !payloadIsProxy.value && !controllerIsProxy.value ? "ok" : "danger",
              },
              proxyBadgeText,
            ),
            h("span", { class: "osa-chip" }, fpsBadgeText),
            h(
              "span",
              { class: "osa-chip" },
              `${sampleCount.value.toLocaleString("en-US")} PTS`,
            ),
          ]),
          h("div", { class: "osa-topbar-actions" }, [
            h(
              "div",
              {
                role: "toolbar",
                "aria-label": "Navigation and appearance",
                focusgroup: "toolbar wrap",
              },
              [
                h("div", { role: "group", "aria-label": "Companion workspace" }, [
                  h("a", { class: "osa-lab-link", href: "../" }, "Vanilla Lab"),
                ]),
                h("span", { role: "separator", "aria-orientation": "vertical" }),
                h("div", { role: "group", "aria-label": "Color scheme" }, [
                  (
                    [
                      ["system", "Auto"],
                      ["dark", "Dark"],
                      ["light", "Light"],
                    ] as const
                  ).map(([pref, label]) =>
                    h(
                      "button",
                      {
                        key: pref,
                        type: "button",
                        class: "tk-btn",
                        "aria-pressed": String(theme.preference.value === pref),
                        onClick: () => {
                          setThemePreference(pref);
                        },
                      },
                      label,
                    ),
                  ),
                ]),
              ],
            ),
            h(
              "button",
              {
                type: "button",
                class: "tk-btn osa-drawer-toggle",
                "aria-expanded": String(drawerOpen.value),
                "aria-controls": "osa-inspector-rack",
                onClick: () => {
                  drawerOpen.value = !drawerOpen.value;
                },
              },
              drawerOpen.value ? "Close Rack" : "Controls",
            ),
          ]),
        ]),

        // Main Workbench (Canvas Stage + Right Precision Rack)
        h("div", { class: "osa-workbench" }, [
          h("main", { class: "osa-stage-column", "aria-label": "Optical spectrum display" }, [
            h("div", { class: "osa-viewer-host" }, [
              h(
                TraceSpectrumViewer,
                {
                  key: viewerKey.value,
                  data: currentData.value,
                  traces: currentTraces.value,
                  revision: payloadRevision.value,
                  domain: domainRef.value,
                  homeDomain: currentScenario.value.homeDomain,
                  mode: engineMode.value,
                  decimation: currentDecimation.value,
                  dragMode: dragMode.value,
                  interactive: true,
                  autoResize: true,
                  figureStyle: currentFigureStyle.value,
                  axes: SANDBOX_AXES_LAYOUT,
                  yAxes: currentScenario.value.yAxes,
                  onReady: handleViewerReady,
                  "onUpdate:domain": (nextDomain: ViewportDomain) => {
                    domainRef.value = nextDomain;
                  },
                  onEngineChange: handleEngineChange,
                  onWebgl2Fallback: () => {
                    webgl2FallbackState.value = true;
                    activeEngineKind.value = "canvas2d";
                    activeCanvasCount.value = 1;
                    announce("WebGL2 unavailable — latched Canvas2D fallback");
                  },
                  onContextLost: () => {
                    contextLostState.value = true;
                    announce("WebGL2 context lost — loop suspended");
                  },
                  onContextRestored: () => {
                    contextLostState.value = false;
                    activeLoseContextExt = null;
                    announce("WebGL2 context restored");
                  },
                },
                {
                  overlay: renderOverlaySlot,
                },
              ),
            ]),
            h("div", { class: "osa-gesture-bar" }, [
              h(
                "span",
                "Drag: Pan · Shift+Drag: Box Zoom · Wheel: Cursor Zoom · Alt/Shift+Wheel: X/Y · Dbl-Click: Reset · Gutters: Single-Axis",
              ),
              h(
                "span",
                { class: "osa-gesture-state" },
                fontReady.value ? "FONT: TRACEKIT INTER" : "FONT: SYSTEM",
              ),
            ]),
          ]),

          // Right Precision Instrument Rack (312px)
          h(
            "aside",
            {
              id: "osa-inspector-rack",
              class: "osa-rack",
              "aria-label": "Instrument controls and diagnostics",
              "data-open": String(drawerOpen.value),
            },
            [
              h("div", { class: "rack-scroll" }, [
                // Section 1: Signal Scenario
                h("section", { class: "rack-section" }, [
                  h("div", { class: "rack-section-head" }, [
                    h("h2", { class: "rack-section-title" }, "1. Signal Scenario"),
                    h("span", { class: "rack-section-meta" }, currentScenario.value.shortBadge),
                  ]),
                  h(
                    "div",
                    {
                      role: "toolbar",
                      "aria-label": "Optical signal scenario",
                      focusgroup: "toolbar wrap",
                      class: "tk-toolbar-grid-2",
                    },
                    SCENARIO_ORDER.map((id) => {
                      const item = SCENARIOS[id];
                      return h(
                        "button",
                        {
                          key: id,
                          type: "button",
                          class: "tk-btn tk-btn-scenario",
                          "aria-pressed": String(scenarioId.value === id),
                          onClick: () => {
                            selectScenario(id);
                          },
                        },
                        [
                          h("span", { class: "tk-btn-scenario-title" }, item.label),
                          h("span", { class: "tk-btn-scenario-sub" }, item.shortBadge),
                        ],
                      );
                    }),
                  ),
                  h("div", { class: "rack-spec-strip" }, [
                    h("span", { class: "rack-spec-tag" }, currentScenario.value.standardRef),
                    h("span", { class: "rack-spec-tag" }, currentScenario.value.instrumentProfile),
                  ]),
                  h("p", { class: "rack-summary" }, currentScenario.value.summary),
                  scenarioId.value === "fbg-1550"
                    ? h(
                        "button",
                        {
                          type: "button",
                          class: "tk-btn tk-btn-accent",
                          onClick: zoomPrecision1550,
                        },
                        "Inspect 4.0 pm π-Notch (1550.0001 nm)",
                      )
                    : scenarioId.value === "live-60hz"
                      ? h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn",
                            "aria-pressed": String(liveStreaming.value),
                            onClick: toggleLiveStreaming,
                          },
                          liveStreaming.value ? "Pause 60 Hz Acquisition" : "Resume 60 Hz Acquisition",
                        )
                      : null,
                ]),

                // Section 2: Sample Density & Hysteresis Deadband
                h("section", { class: "rack-section" }, [
                  h("div", { class: "rack-section-head" }, [
                    h(
                      "label",
                      {
                        for: "osa-sample-slider",
                        class: "rack-section-title",
                      },
                      "2. Sample Density",
                    ),
                    h(
                      "span",
                      { class: "rack-section-meta" },
                      sampleCount.value.toLocaleString("en-US"),
                    ),
                  ]),
                  h("div", { class: "tk-slider-wrap" }, [
                    h("input", {
                      id: "osa-sample-slider",
                      type: "range",
                      class: "tk-slider",
                      min: String(MIN_SAMPLES),
                      max: String(MAX_SAMPLES),
                      step: String(SAMPLE_STEP),
                      value: String(sampleCount.value),
                      "aria-valuetext": formatSampleText(sampleCount.value),
                      style: {
                        "--attr-min": String(MIN_SAMPLES),
                        "--attr-max": String(MAX_SAMPLES),
                        "--control-value": String(sampleCount.value),
                      },
                      onInput: (event: Event) => {
                        const input = event.target;
                        if (input instanceof HTMLInputElement) {
                          updateSampleCount(Number(input.value));
                        }
                      },
                    }),
                    h("div", { class: "tk-deadband-scale", "aria-hidden": "true" }, [
                      h("div", { class: "tk-deadband-bar" }, [
                        h("div", { class: "tk-deadband-zone" }),
                      ]),
                      h("div", { class: "tk-deadband-ticks" }, [
                        h("span", "10k"),
                        h("span", { class: "tk-deadband-ticks-mid" }, "64k ⇄ 80k deadband"),
                        h("span", "250k"),
                      ]),
                    ]),
                  ]),
                  h(
                    "div",
                    {
                      role: "toolbar",
                      "aria-label": "Sample count presets",
                      focusgroup: "toolbar wrap",
                      class: "tk-toolbar-grid-6",
                    },
                    SAMPLE_PRESETS.map((preset) =>
                      h(
                        "button",
                        {
                          key: preset,
                          type: "button",
                          class: "tk-btn",
                          onClick: () => {
                            updateSampleCount(preset);
                            announce(`Sample count set to ${preset.toLocaleString("en-US")}`);
                          },
                        },
                        formatPresetChip(preset),
                      ),
                    ),
                  ),
                ]),

                // Section 3: Engine, Decimation & Pointer Tool
                h("section", { class: "rack-section" }, [
                  h("div", { class: "rack-section-head" }, [
                    h("h2", { class: "rack-section-title" }, "3. Engine & Interaction"),
                    h("span", { class: "rack-section-meta" }, activeKind.toUpperCase()),
                  ]),
                  h("div", { class: "tk-control-row" }, [
                    h("span", { class: "tk-control-label" }, "Engine Mode"),
                    h(
                      "div",
                      {
                        role: "toolbar",
                        "aria-label": "Engine selection mode",
                        focusgroup: "toolbar wrap",
                        class: "tk-toolbar-grid-3",
                      },
                      (
                        [
                          ["auto", "Auto"],
                          ["canvas2d", "Canvas2D"],
                          ["webgl2", "WebGL2"],
                        ] as const
                      ).map(([modeVal, label]) =>
                        h(
                          "button",
                          {
                            key: modeVal,
                            type: "button",
                            class: "tk-btn",
                            "aria-pressed": String(engineMode.value === modeVal),
                            onClick: () => {
                              engineMode.value = modeVal;
                              announce(`Engine mode set to ${label}`);
                            },
                          },
                          label,
                        ),
                      ),
                    ),
                  ]),
                  h("div", { class: "tk-control-row" }, [
                    h("span", { class: "tk-control-label" }, "Decimation Kernel"),
                    h(
                      "div",
                      {
                        role: "toolbar",
                        "aria-label": "Decimation algorithm",
                        focusgroup: "toolbar wrap",
                        class: "tk-toolbar-grid-3",
                      },
                      (
                        [
                          ["native", "Native"],
                          ["lttb", "LTTB"],
                          ["min-max", "Min-Max"],
                        ] as const
                      ).map(([choice, label]) =>
                        h(
                          "button",
                          {
                            key: choice,
                            type: "button",
                            class: "tk-btn",
                            "aria-pressed": String(decimationChoice.value === choice),
                            onClick: () => {
                              decimationChoice.value = choice;
                              if (workerEnabled.value) {
                                runWorkerDecimationPass();
                              }
                              announce(`Decimation kernel set to ${label}`);
                            },
                          },
                          label,
                        ),
                      ),
                    ),
                  ]),
                  h("div", { class: "tk-control-row" }, [
                    h("span", { class: "tk-control-label" }, "Primary Drag Tool"),
                    h(
                      "div",
                      {
                        role: "toolbar",
                        "aria-label": "Pointer drag mode",
                        focusgroup: "toolbar wrap",
                        class: "tk-toolbar-grid-2",
                      },
                      (
                        [
                          ["pan", "Pan"],
                          ["box-zoom", "Box Zoom"],
                        ] as const
                      ).map(([toolVal, label]) =>
                        h(
                          "button",
                          {
                            key: toolVal,
                            type: "button",
                            class: "tk-btn",
                            "aria-pressed": String(dragMode.value === toolVal),
                            onClick: () => {
                              dragMode.value = toolVal;
                              announce(`Primary drag tool set to ${label}`);
                            },
                          },
                          label,
                        ),
                      ),
                    ),
                  ]),
                  h("div", { class: "tk-control-row" }, [
                    h("span", { class: "tk-control-label" }, "Off-Main-Thread Worker"),
                    h(
                      "div",
                      {
                        role: "toolbar",
                        "aria-label": "Web Worker decimation pipeline",
                        focusgroup: "toolbar wrap",
                        class: "tk-toolbar-grid-2",
                      },
                      [
                        h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn",
                            "aria-pressed": String(!workerEnabled.value),
                            onClick: () => {
                              setWorkerPipelineEnabled(false);
                            },
                          },
                          "Main Thread",
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn",
                            "aria-pressed": String(workerEnabled.value),
                            onClick: () => {
                              setWorkerPipelineEnabled(true);
                            },
                          },
                          "Web Worker",
                        ),
                      ],
                    ),
                  ]),
                ]),

                // Section 4: GPU Context Recovery & Publication / Raw Export
                h("section", { class: "rack-section" }, [
                  h("div", { class: "rack-section-head" }, [
                    h("h2", { class: "rack-section-title" }, "4. GPU Recovery & Export"),
                    h("span", { class: "rack-section-meta" }, glStatusText),
                  ]),
                  h(
                    "div",
                    {
                      role: "toolbar",
                      "aria-label": "GPU recovery and viewport actions",
                      focusgroup: "toolbar wrap",
                      class: "tk-toolbar-grid-2",
                    },
                    [
                      h(
                        "button",
                        {
                          type: "button",
                          class: [
                            "tk-btn",
                            contextLostState.value
                              ? "tk-btn-emerald"
                              : isWebGL2
                                ? "tk-btn-danger"
                                : "tk-btn-action",
                          ],
                          "aria-disabled": String(!isWebGL2),
                          onClick: toggleGlContextLoss,
                        },
                        contextLostState.value ? "Restore GL Context" : "Lose GL Context",
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          class: "tk-btn tk-btn-action",
                          onClick: resetView,
                        },
                        "Reset View",
                      ),
                    ],
                  ),
                  h("div", { class: "tk-control-row" }, [
                    h("span", { class: "tk-control-label" }, "Visible Window Export (Raw & Vector)"),
                    h(
                      "div",
                      {
                        role: "toolbar",
                        "aria-label": "Export vector and raw data",
                        focusgroup: "toolbar wrap",
                        class: "tk-toolbar-grid-4",
                      },
                      [
                        h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn tk-btn-accent",
                            onClick: handleExportSvg,
                          },
                          "SVG",
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn tk-btn-action",
                            onClick: handleExportCsv,
                          },
                          "CSV",
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn tk-btn-action",
                            onClick: () => {
                              handleExportNpy("x");
                            },
                          },
                          ".npy X",
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            class: "tk-btn tk-btn-action",
                            onClick: () => {
                              handleExportNpy("y");
                            },
                          },
                          ".npy Y",
                        ),
                      ],
                    ),
                  ]),
                ]),

                // Section 5: Vue Reactivity Isolation & Worker Telemetry
                h("section", { class: "rack-section" }, [
                  h("div", { class: "rack-section-head" }, [
                    h("h2", { class: "rack-section-title" }, "5. Isolation & Worker"),
                    h("span", { class: "rack-section-meta" }, "LIVE PROBE"),
                  ]),
                  h("div", { class: "tk-diag-grid" }, [
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "isProxy(payload)"),
                      h(
                        "span",
                        {
                          class: "tk-diag-val",
                          "data-ok": payloadIsProxy.value ? "danger" : "true",
                        },
                        String(payloadIsProxy.value),
                      ),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "isProxy(controller)"),
                      h(
                        "span",
                        {
                          class: "tk-diag-val",
                          "data-ok": controllerIsProxy.value ? "danger" : "true",
                        },
                        String(controllerIsProxy.value),
                      ),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "isShallow(domain)"),
                      h(
                        "span",
                        {
                          class: "tk-diag-val",
                          "data-ok": domainIsShallow ? "true" : "danger",
                        },
                        String(domainIsShallow),
                      ),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "Active Canvases"),
                      h("span", { class: "tk-diag-val" }, String(canvasCount)),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "Engine Switches"),
                      h("span", { class: "tk-diag-val" }, String(engineSwitchCount.value)),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "GL Context"),
                      h(
                        "span",
                        {
                          class: "tk-diag-val",
                          "data-ok": glStatusTone,
                        },
                        glStatusText,
                      ),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "Worker Port"),
                      h(
                        "span",
                        {
                          class: "tk-diag-val",
                          "data-ok": workerEnabled.value ? "true" : "warn",
                        },
                        workerEnabled.value
                          ? `${workerHealthLabel.value} · ${workerBacking.value}`
                          : "OFF",
                      ),
                    ]),
                    h("div", { class: "tk-diag-cell" }, [
                      h("span", { class: "tk-diag-key" }, "Worker Out / RTT"),
                      h(
                        "span",
                        { class: "tk-diag-val" },
                        workerEnabled.value && workerRoundtripMs.value !== null
                          ? `${workerOutCount.value} · ${workerRoundtripMs.value.toFixed(1)} ms`
                          : "--",
                      ),
                    ]),
                  ]),
                ]),
              ]),
            ],
          ),
        ]),

        // Live announcement region outside toolbars
        h("p", { role: "status", class: "sr-status" }, statusAnnouncement.value),
      ]);
    };
  },
});
