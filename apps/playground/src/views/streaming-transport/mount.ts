import type { ButtonApi } from "@tweakpane/core";
import {
  DecimationKind,
  SATURATED,
  StatCounter,
  StatGauge,
  TransportHealth,
  applyDomainChange,
  createBucketAccumulator,
  createRawSampleRing,
  createSpectrumDataPayload,
  createTransportStatsView,
  createWorkerDecimationPort,
  detectTransportCapabilities,
  ingestBatch,
  materializeBucketsToPayload,
  materializeTier3ToPayload,
  projectTier3,
  rebuildDomain,
  type BucketAccumulator,
  type DecimationPort,
  type Lease,
  type RawSampleRing,
  type SettlementSink,
  type SpectrumDataPayload,
  type Tier3ProjectionTarget,
  type TransportStatsView,
  type WorkerFactory,
  type WorkerLike,
  type WorkerMessageEventLike,
} from "@trace-kit/core";
import { Canvas2DRenderer, type AxisLayout, type FigureStyle } from "@trace-kit/renderers";
import { withBindingScope } from "../../shell/binding-scope.js";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";

const RING_CAPACITY = 65_536;
const BUCKET_COUNT = 512;
const INITIAL_DOMAIN_SPAN = 4_096;
const MAX_DELTA_SIZE = 2_048;
const TRANSIT_CAPACITY = 8_192;
const DEFAULT_POOL_PAIRS = 3;
const DEFAULT_LEASE_TIMEOUT_MS = 1_500;
const DEFAULT_STALL_DROP_THRESHOLD = 4;
const DEFAULT_MAX_REMINT_EVENTS = 16;
const MIN_PLOT_HEIGHT = 240;
const VIEWPORT_GUTTER = 24;
const LABEL_GUTTER_CSS = 56;
const PAN_STEP_BUCKETS = 10;

const HEALTH_NAMES: readonly string[] = [
  "Ready",
  "Saturated",
  "Stalled",
  "Recovering",
  "Degraded",
];

function healthName(value: number): string {
  return HEALTH_NAMES[value] ?? "Unknown";
}

function detectBackingLabel(): "Shared" | "Transfer" {
  const caps = detectTransportCapabilities();
  if (caps.sharedMemory && caps.crossOriginIsolated && typeof Atomics !== "undefined") {
    return "Shared";
  }
  return "Transfer";
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

function nextUint32(state: number): number {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

function fillSyntheticLorentzianBatch(
  xs: Float32Array,
  ys: Float32Array,
  startX: number,
  count: number,
  prngState: number,
): number {
  let state = prngState >>> 0;
  const period = 1_024;
  const halfWidth = 36;
  const halfWidthSq = halfWidth * halfWidth;

  for (let i = 0; i < count; i += 1) {
    const x = startX + i;
    const localX = x % period;
    const centerA = 320 + ((Math.floor(x / period) * 73) % 240);
    const centerB = 740;
    const dxA = localX - centerA;
    const dxB = localX - centerB;
    const peakA = halfWidthSq / (dxA * dxA + halfWidthSq);
    const peakB = (0.55 * halfWidthSq) / (dxB * dxB + halfWidthSq * 0.5);

    state = nextUint32(state);
    const noise = (state / 4_294_967_296 - 0.5) * 0.06;

    xs[i] = x;
    ys[i] = peakA + peakB + noise;
  }

  return state;
}

interface FaultInjectableWorker extends WorkerLike {
  injectCrash(): void;
  injectStall(): void;
}

function wrapWithFaultInjection(inner: WorkerLike): FaultInjectableWorker {
  let stalled = false;
  const messageListeners = new Set<(event: WorkerMessageEventLike) => void>();
  const errorListeners = new Set<(event: unknown) => void>();
  const messageErrorListeners = new Set<(event: unknown) => void>();

  const forwardMessage = (event: WorkerMessageEventLike): void => {
    if (stalled) return;
    for (const listener of messageListeners) {
      listener(event);
    }
  };

  const forwardError = (event: unknown): void => {
    if (stalled) return;
    for (const listener of errorListeners) {
      listener(event);
    }
  };

  const forwardMessageError = (event: unknown): void => {
    if (stalled) return;
    for (const listener of messageErrorListeners) {
      listener(event);
    }
  };

  inner.addEventListener("message", forwardMessage);
  inner.addEventListener("error", forwardError);
  inner.addEventListener("messageerror", forwardMessageError);

  return {
    postMessage(message: unknown, transfer?: ArrayBuffer[]): void {
      if (stalled) return;
      if (transfer !== undefined) {
        inner.postMessage(message, transfer);
      } else {
        inner.postMessage(message);
      }
    },
    terminate(): void | Promise<number> {
      inner.removeEventListener("message", forwardMessage);
      inner.removeEventListener("error", forwardError);
      inner.removeEventListener("messageerror", forwardMessageError);
      return inner.terminate();
    },
    addEventListener(
      type: "message" | "error" | "messageerror",
      listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
    ): void {
      if (type === "message") {
        messageListeners.add(listener);
      } else if (type === "error") {
        errorListeners.add(listener as (event: unknown) => void);
      } else {
        messageErrorListeners.add(listener as (event: unknown) => void);
      }
    },
    removeEventListener(
      type: "message" | "error" | "messageerror",
      listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
    ): void {
      if (type === "message") {
        messageListeners.delete(listener);
      } else if (type === "error") {
        errorListeners.delete(listener as (event: unknown) => void);
      } else {
        messageErrorListeners.delete(listener as (event: unknown) => void);
      }
    },
    injectCrash(): void {
      const error = new Error("Injected responder crash");
      for (const listener of errorListeners) {
        listener(error);
      }
    },
    injectStall(): void {
      stalled = true;
      // Silently halt the underlying worker so neither Transfer nor Shared replies arrive
      // until the port's lazy deadline sweep expires and triggers timeout recovery.
      inner.removeEventListener("message", forwardMessage);
      inner.removeEventListener("error", forwardError);
      inner.removeEventListener("messageerror", forwardMessageError);
      void inner.terminate();
    },
  };
}

function createDefaultBrowserWorker(): WorkerLike {
  return new Worker(new URL("./streaming.worker.ts", import.meta.url), {
    type: "module",
  });
}

export interface StreamingFrameSnapshot {
  readonly payload: SpectrumDataPayload;
  readonly payloadRevision: number;
  readonly accumulatorRevision: number;
  readonly statsView: TransportStatsView;
  readonly ring: RawSampleRing;
  readonly accumulator: BucketAccumulator;
  readonly port: DecimationPort;
  readonly lastWorkerOutCount: number;
}

export interface StreamingTransportOptions {
  readonly workerFactory?: WorkerFactory;
  readonly statsView?: TransportStatsView;
  readonly now?: () => number;
  readonly leaseTimeoutMs?: number;
  readonly stallDropThreshold?: number;
  readonly maxRemintEvents?: number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
  readonly onFrame?: (snapshot: StreamingFrameSnapshot) => void;
}

interface HudFields {
  readonly health: HTMLElement;
  readonly backing: HTMLElement;
  readonly chunksAccepted: HTMLElement;
  readonly chunksDropped: HTMLElement;
  readonly leasesOutstanding: HTMLElement;
  readonly responderFailures: HTMLElement;
  readonly remintEvents: HTMLElement;
  readonly staleSettlements: HTMLElement;
  readonly domainShifts: HTMLElement;
  readonly domainRebuilds: HTMLElement;
  readonly oldestInFlightMs: HTMLElement;
  readonly workerOutCount: HTMLElement;
}

function createHud(parent: HTMLElement): HudFields {
  const hud = document.createElement("div");
  hud.setAttribute("data-role", "transport-hud");
  hud.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.5rem;" +
    "padding:0.75rem;border:1px solid var(--tk-color-border,#1c2530);border-radius:6px;" +
    "background:var(--tk-color-surface,#10161d);font-family:ui-monospace,monospace;font-size:12px";

  function metric(label: string, initial: string): HTMLElement {
    const cell = document.createElement("div");
    cell.style.cssText = "display:flex;justify-content:space-between;gap:0.5rem";
    const nameEl = document.createElement("span");
    nameEl.style.color = "var(--tk-color-text-muted,#8a97a8)";
    nameEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.style.color = "var(--tk-color-text,#e6edf5)";
    valueEl.textContent = initial;
    cell.append(nameEl, valueEl);
    hud.appendChild(cell);
    return valueEl;
  }

  const fields: HudFields = {
    health: metric("Health", "Ready"),
    backing: metric("Backing", detectBackingLabel()),
    chunksAccepted: metric("ChunksAccepted", "0"),
    chunksDropped: metric("ChunksDropped", "0"),
    leasesOutstanding: metric("LeasesOutstanding", "0"),
    responderFailures: metric("ResponderFailures", "0"),
    remintEvents: metric("RemintEvents", "0"),
    staleSettlements: metric("StaleSettlements", "0"),
    domainShifts: metric("DomainShifts", "0"),
    domainRebuilds: metric("DomainRebuilds", "0"),
    oldestInFlightMs: metric("OldestInFlightMs", "0.0 ms"),
    workerOutCount: metric("WorkerOutCount", "0"),
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

/**
 * Mounts the `/streaming-transport` showcase view: real Web Worker decimation via
 * `createWorkerDecimationPort`, incremental `RawSampleRing` + `BucketAccumulator` streaming,
 * zero-allocation `Retained` payload materialization into `Canvas2DRenderer`, a single reused
 * `TransportStatsView` telemetry HUD, Tier 1/2/3 navigation controls, and stall/crash injection.
 */
export function mountStreamingTransport(
  host: ViewHost,
  options?: StreamingTransportOptions,
): ViewTeardown {
  const baseWorkerFactory = options?.workerFactory ?? createDefaultBrowserWorker;
  const now = options?.now ?? (() => performance.now());
  const requestFrame =
    options?.requestFrame ?? ((cb: FrameRequestCallback) => window.requestAnimationFrame(cb));
  const cancelFrame = options?.cancelFrame ?? ((id: number) => window.cancelAnimationFrame(id));

  let activeWorker: FaultInjectableWorker | null = null;
  const wrappedWorkerFactory: WorkerFactory = () => {
    const wrapped = wrapWithFaultInjection(baseWorkerFactory());
    activeWorker = wrapped;
    return wrapped;
  };

  const port = createWorkerDecimationPort({
    workerFactory: wrappedWorkerFactory,
    poolPairs: DEFAULT_POOL_PAIRS,
    transitCapacitySamples: TRANSIT_CAPACITY,
    leaseTimeoutMs: options?.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS,
    stallDropThreshold: options?.stallDropThreshold ?? DEFAULT_STALL_DROP_THRESHOLD,
    maxRemintEvents: options?.maxRemintEvents ?? DEFAULT_MAX_REMINT_EVENTS,
    now,
  });

  // Retained streaming state — allocated once, never wrapped in any reactive proxy.
  const ring = createRawSampleRing(RING_CAPACITY);
  const accumulator = createBucketAccumulator(BUCKET_COUNT);
  rebuildDomain(accumulator, ring, 0, BUCKET_COUNT / INITIAL_DOMAIN_SPAN);
  const tier3Target: Tier3ProjectionTarget = {
    min: new Float32Array(BUCKET_COUNT),
    max: new Float32Array(BUCKET_COUNT),
    count: new Int32Array(BUCKET_COUNT),
  };
  const payload = createSpectrumDataPayload({
    capacity: BUCKET_COUNT * 2,
    xOrigin: 0,
    xUnit: "sample",
    yUnit: "a.u.",
  });
  const batchX = new Float32Array(MAX_DELTA_SIZE);
  const batchY = new Float32Array(MAX_DELTA_SIZE);
  const statsView = options?.statsView ?? createTransportStatsView();

  const controls = {
    running: true,
    rateHz: 60,
    deltaSize: 128,
    decimationKind: DecimationKind.MinMaxEnvelope,
    tier3Zoom: 1,
  };

  let nextSampleX = 0;
  let prngState = 0x1234_5678;
  let lastTickMs = -Infinity;
  let lastWorkerOutCount = 0;
  let manualNav = false;
  let disposed = false;
  let rafId: number | null = null;

  // DOM layout
  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;gap:0.75rem;padding:0.75rem;font-family:var(--tk-font-family,system-ui,sans-serif)";

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center";

  const panLeftBtn = makeButton("Tier-1 Pan (-10)", "tier1-pan-left");
  const panRightBtn = makeButton("Tier-1 Pan (+10)", "tier1-pan-right");
  const zoomInBtn = makeButton("Tier-2 Zoom In", "tier2-zoom-in");
  const zoomOutBtn = makeButton("Tier-2 Zoom Out", "tier2-zoom-out");
  const stallBtn = makeButton("Inject Stall", "inject-stall");
  const crashBtn = makeButton("Inject Crash", "inject-crash");

  const tier3Label = document.createElement("label");
  tier3Label.style.cssText =
    "display:inline-flex;align-items:center;gap:0.4rem;font-size:12px;color:var(--tk-color-text-muted,#8a97a8)";
  tier3Label.textContent = "Tier-3 Preview ";
  const tier3Slider = document.createElement("input");
  tier3Slider.type = "range";
  tier3Slider.min = "0.25";
  tier3Slider.max = "4";
  tier3Slider.step = "0.05";
  tier3Slider.value = "1";
  tier3Slider.setAttribute("data-action", "tier3-preview");
  tier3Slider.setAttribute("aria-label", "Tier-3 preview zoom");
  tier3Label.appendChild(tier3Slider);

  toolbar.append(
    panLeftBtn,
    panRightBtn,
    zoomInBtn,
    zoomOutBtn,
    tier3Label,
    stallBtn,
    crashBtn,
  );

  const hud = createHud(root);
  root.appendChild(toolbar);

  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  root.appendChild(canvas);
  host.container.appendChild(root);

  const { style, axes } = readFigureTokensFromCss();
  const renderer = new Canvas2DRenderer({ surface: canvas, style, axes });
  renderer.setData(payload);

  const settlementSink: SettlementSink = {
    onSettled(lease: Lease<"settled">, outCount: number): void {
      // Touch settled output view to verify ownership before releasing the slot.
      const kind = controls.decimationKind;
      if (kind === DecimationKind.MinMaxEnvelope) {
        const out = port.viewOut(lease);
        if (outCount > 0 && out.length > 0) {
          lastWorkerOutCount = outCount;
        }
      } else {
        const indices = port.viewIndices(lease);
        if (outCount > 0 && indices.length > 0) {
          lastWorkerOutCount = outCount;
        }
      }
      port.release(lease);
    },
  };

  function syncStatsAndHud(): void {
    // Preserve streaming domain counters across `port.readStats` while reusing one TransportStatsView.
    const domainShifts = statsView.counters[StatCounter.DomainShifts] ?? 0;
    const domainRebuilds = statsView.counters[StatCounter.DomainRebuilds] ?? 0;
    port.readStats(statsView);
    statsView.counters[StatCounter.DomainShifts] = domainShifts;
    statsView.counters[StatCounter.DomainRebuilds] = domainRebuilds;

    const c = statsView.counters;
    const g = statsView.gauges;
    hud.health.textContent = healthName(c[StatCounter.Health] ?? TransportHealth.Ready);
    hud.chunksAccepted.textContent = String(c[StatCounter.ChunksAccepted] ?? 0);
    hud.chunksDropped.textContent = String(c[StatCounter.ChunksDropped] ?? 0);
    hud.leasesOutstanding.textContent = String(c[StatCounter.LeasesOutstanding] ?? 0);
    hud.responderFailures.textContent = String(c[StatCounter.ResponderFailures] ?? 0);
    hud.remintEvents.textContent = String(c[StatCounter.RemintEvents] ?? 0);
    hud.staleSettlements.textContent = String(c[StatCounter.StaleSettlements] ?? 0);
    hud.domainShifts.textContent = String(c[StatCounter.DomainShifts] ?? 0);
    hud.domainRebuilds.textContent = String(c[StatCounter.DomainRebuilds] ?? 0);
    hud.oldestInFlightMs.textContent = `${(g[StatGauge.OldestInFlightMs] ?? 0).toFixed(1)} ms`;
    hud.workerOutCount.textContent = String(lastWorkerOutCount);
  }

  function emitSnapshot(): void {
    options?.onFrame?.({
      payload,
      payloadRevision: payload.revision,
      accumulatorRevision: accumulator.revision,
      statsView,
      ring,
      accumulator,
      port,
      lastWorkerOutCount,
    });
  }

  function renderCurrentView(): void {
    const baseSpan = accumulator.bucketCount / accumulator.invBucketWidth;
    let renderDomainMin = accumulator.domainMin;
    let renderDomainMax = accumulator.domainMin + baseSpan;

    if (Math.abs(controls.tier3Zoom - 1) > 1e-6) {
      const previewSpan = baseSpan / controls.tier3Zoom;
      const center = accumulator.domainMin + baseSpan * 0.5;
      const previewMin = center - previewSpan * 0.5;
      const previewInvWidth = accumulator.bucketCount / previewSpan;
      projectTier3(
        accumulator,
        previewMin,
        previewInvWidth,
        accumulator.bucketCount,
        tier3Target,
        ring,
      );
      materializeTier3ToPayload(
        tier3Target,
        accumulator.bucketCount,
        previewMin,
        previewInvWidth,
        payload,
      );
      renderDomainMin = previewMin;
      renderDomainMax = previewMin + previewSpan;
    } else {
      materializeBucketsToPayload(accumulator, payload);
    }

    renderer.setDomain(renderDomainMin, renderDomainMax, -0.2, 1.4);
    renderer.render();
    syncStatsAndHud();
    emitSnapshot();
  }

  function submitDeltaToWorker(count: number): boolean {
    const lease = port.acquire();
    if (lease === SATURATED) {
      port.noteDroppedSamples(count);
      return false;
    }
    const clampedCount = Math.min(count, port.transitCapacitySamples);
    const vx = port.viewX(lease);
    const vy = port.viewY(lease);
    for (let i = 0; i < clampedCount; i += 1) {
      vx[i] = batchX[i]!;
      vy[i] = batchY[i]!;
    }
    const kind = controls.decimationKind;
    const buckets = Math.min(BUCKET_COUNT, Math.max(2, clampedCount >> 1));
    port.setKind(lease, kind);
    port.setSampleCount(lease, clampedCount);
    port.setBucketCount(lease, buckets);
    port.setDomain(lease, batchX[0] ?? 0, batchX[clampedCount - 1] ?? 1);
    port.submit(lease);
    return true;
  }

  function panByBuckets(bucketDelta: number): void {
    manualNav = true;
    controls.tier3Zoom = 1;
    tier3Slider.value = "1";
    const step = bucketDelta / accumulator.invBucketWidth;
    applyDomainChange(
      accumulator,
      ring,
      {
        requestedDomainMin: accumulator.domainMin + step,
        requestedInvBucketWidth: accumulator.invBucketWidth,
        inGesture: false,
      },
      statsView,
    );
    renderCurrentView();
  }

  function zoomByFactor(factor: number): void {
    manualNav = true;
    controls.tier3Zoom = 1;
    tier3Slider.value = "1";
    const currentSpan = accumulator.bucketCount / accumulator.invBucketWidth;
    const nextSpan = Math.max(64, Math.min(RING_CAPACITY, currentSpan / factor));
    const center = accumulator.domainMin + currentSpan * 0.5;
    const nextDomainMin = center - nextSpan * 0.5;
    const nextInvWidth = accumulator.bucketCount / nextSpan;
    applyDomainChange(
      accumulator,
      ring,
      {
        requestedDomainMin: nextDomainMin,
        requestedInvBucketWidth: nextInvWidth,
        inGesture: false,
      },
      statsView,
    );
    renderCurrentView();
  }

  function triggerTier3Preview(zoomValue: number): void {
    controls.tier3Zoom = zoomValue;
    renderCurrentView();
  }

  function triggerInjectStall(): void {
    activeWorker?.injectStall();
    syncStatsAndHud();
  }

  function triggerInjectCrash(): void {
    // Ensure a lease is strictly InFlight when the worker crashes so the pool transitions it to
    // Lost, terminates the worker, increments ResponderFailures & RemintEvents, and lazily
    // respawns on the next frame — identically for both real async and synchronous test workers.
    port.poll(settlementSink);
    const delta = Math.max(16, Math.min(MAX_DELTA_SIZE, Math.floor(controls.deltaSize)));
    if (nextSampleX === 0) {
      prngState = fillSyntheticLorentzianBatch(batchX, batchY, nextSampleX, delta, prngState);
    }
    const lease = port.acquire();
    if (lease !== SATURATED) {
      const clamped = Math.min(delta, port.transitCapacitySamples);
      const vx = port.viewX(lease);
      const vy = port.viewY(lease);
      for (let i = 0; i < clamped; i += 1) {
        vx[i] = batchX[i]!;
        vy[i] = batchY[i]!;
      }
      port.setKind(lease, controls.decimationKind);
      port.setSampleCount(lease, clamped);
      port.setBucketCount(lease, Math.min(BUCKET_COUNT, Math.max(2, clamped >> 1)));
      port.setDomain(lease, batchX[0] ?? 0, batchX[clamped - 1] ?? 1);
      const crashingWorker = activeWorker;
      if (crashingWorker !== null) {
        crashingWorker.injectStall();
        port.submit(lease);
        crashingWorker.injectCrash();
      } else {
        port.submit(lease);
      }
    } else {
      activeWorker?.injectCrash();
    }
    syncStatsAndHud();
    emitSnapshot();
  }

  function resizeToContainer(): void {
    canvas.style.width = "100%";
    const box = canvas.getBoundingClientRect();
    const width = box.width || 640;
    const height = Math.max(MIN_PLOT_HEIGHT, window.innerHeight - box.top - VIEWPORT_GUTTER);
    canvas.style.height = `${height}px`;
    renderer.resize(width, height, window.devicePixelRatio || 1);
    renderCurrentView();
  }

  function onTick(frameTimeMs: number): void {
    if (disposed) return;
    rafId = null;

    port.poll(settlementSink);

    const minIntervalMs = 1_000 / Math.max(1, controls.rateHz);
    if (controls.running && frameTimeMs - lastTickMs >= minIntervalMs) {
      lastTickMs = frameTimeMs;
      const delta = Math.max(16, Math.min(MAX_DELTA_SIZE, Math.floor(controls.deltaSize)));
      prngState = fillSyntheticLorentzianBatch(batchX, batchY, nextSampleX, delta, prngState);
      nextSampleX += delta;

      ingestBatch(ring, batchX, batchY, 0, delta, accumulator);

      // Keep rolling window following live head via Tier-1 aligned shifts unless user navigated manually.
      const span = accumulator.bucketCount / accumulator.invBucketWidth;
      if (!manualNav && nextSampleX > accumulator.domainMin + span) {
        const bucketWidth = 1 / accumulator.invBucketWidth;
        const shiftBuckets = Math.ceil((nextSampleX - (accumulator.domainMin + span)) / bucketWidth);
        applyDomainChange(
          accumulator,
          ring,
          {
            requestedDomainMin: accumulator.domainMin + shiftBuckets * bucketWidth,
            requestedInvBucketWidth: accumulator.invBucketWidth,
            inGesture: false,
          },
          statsView,
        );
      }

      submitDeltaToWorker(delta);
      port.poll(settlementSink);
      renderCurrentView();
    } else {
      syncStatsAndHud();
    }

    if (!disposed) {
      rafId = requestFrame(onTick);
    }
  }

  // Event listeners — explicitly paired with removeEventListener in teardown so net count is 0.
  const onPanLeft = (): void => panByBuckets(-PAN_STEP_BUCKETS);
  const onPanRight = (): void => panByBuckets(PAN_STEP_BUCKETS);
  const onZoomIn = (): void => zoomByFactor(2);
  const onZoomOut = (): void => zoomByFactor(0.5);
  const onTier3Input = (): void => {
    const parsed = Number(tier3Slider.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      triggerTier3Preview(parsed);
    }
  };
  const onStallClick = (): void => triggerInjectStall();
  const onCrashClick = (): void => triggerInjectCrash();

  panLeftBtn.addEventListener("click", onPanLeft);
  panRightBtn.addEventListener("click", onPanRight);
  zoomInBtn.addEventListener("click", onZoomIn);
  zoomOutBtn.addEventListener("click", onZoomOut);
  tier3Slider.addEventListener("input", onTier3Input);
  stallBtn.addEventListener("click", onStallClick);
  crashBtn.addEventListener("click", onCrashClick);
  window.addEventListener("resize", resizeToContainer);

  // Tweakpane controls — every binding and button tracked and removed on teardown.
  const scope = withBindingScope(host.panel);
  scope.addBinding(controls, "running", { label: "Streaming" });
  scope.addBinding(controls, "rateHz", { label: "Rate (Hz)", min: 5, max: 60, step: 1 });
  scope.addBinding(controls, "deltaSize", {
    label: "Delta Size",
    min: 16,
    max: MAX_DELTA_SIZE,
    step: 16,
  });
  scope.addBinding(controls, "decimationKind", {
    label: "Decimation",
    options: {
      MinMaxEnvelope: DecimationKind.MinMaxEnvelope,
      Lttb: DecimationKind.Lttb,
      MinMaxEnvelopeIndices: DecimationKind.MinMaxEnvelopeIndices,
    },
  });
  const tier3Binding = scope.addBinding(controls, "tier3Zoom", {
    label: "Tier-3 Zoom",
    min: 0.25,
    max: 4,
    step: 0.05,
  });
  const onTier3BindingChange = (): void => {
    tier3Slider.value = String(controls.tier3Zoom);
    triggerTier3Preview(controls.tier3Zoom);
  };
  tier3Binding.on("change", onTier3BindingChange);

  const panelButtons: ButtonApi[] = [];
  function addPanelButton(title: string, onClick: () => void): void {
    const button = host.panel.addButton({ title });
    button.on("click", onClick);
    panelButtons.push(button);
  }
  addPanelButton("Tier-1 Pan (-10)", onPanLeft);
  addPanelButton("Tier-1 Pan (+10)", onPanRight);
  addPanelButton("Tier-2 Zoom In", onZoomIn);
  addPanelButton("Tier-2 Zoom Out", onZoomOut);
  addPanelButton("Inject Stall", onStallClick);
  addPanelButton("Inject Crash", onCrashClick);

  const resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(host.container);
  resizeToContainer();

  rafId = requestFrame(onTick);

  return () => {
    if (disposed) return;
    disposed = true;
    if (rafId !== null) {
      cancelFrame(rafId);
      rafId = null;
    }
    resizeObserver.disconnect();
    window.removeEventListener("resize", resizeToContainer);
    panLeftBtn.removeEventListener("click", onPanLeft);
    panRightBtn.removeEventListener("click", onPanRight);
    zoomInBtn.removeEventListener("click", onZoomIn);
    zoomOutBtn.removeEventListener("click", onZoomOut);
    tier3Slider.removeEventListener("input", onTier3Input);
    stallBtn.removeEventListener("click", onStallClick);
    crashBtn.removeEventListener("click", onCrashClick);
    tier3Binding.off("change", onTier3BindingChange);
    for (const button of panelButtons) {
      host.panel.remove(button);
    }
    panelButtons.length = 0;
    scope.disposeAll();
    port.dispose();
    renderer.dispose();
    root.remove();
  };
}

export function mount(host: ViewHost): ViewTeardown {
  return mountStreamingTransport(host);
}
