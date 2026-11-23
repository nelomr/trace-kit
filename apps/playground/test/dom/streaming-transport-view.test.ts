import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pane } from "tweakpane";
import {
  StatCounter,
  createDecimationWorkerHandler,
  createTransportStatsView,
  type SpectrumDataPayload,
  type TransportStatsView,
  type WorkerFactory,
  type WorkerLike,
  type WorkerMessageEventLike,
} from "@trace-kit/core";
import type { TraceDrawingContext } from "@trace-kit/renderers";
import { asRoutePath } from "../../src/shell/view.js";
import { resolveView } from "../../src/shell/registry.js";
import { mount as mountHome } from "../../src/views/home/mount.js";
import {
  mountStreamingTransport,
  type StreamingFrameSnapshot,
} from "../../src/views/streaming-transport/mount.js";

class StubPath2D {
  moveTo(): void {}
  lineTo(): void {}
}

class InMemoryTestWorker implements WorkerLike {
  terminated = false;
  private readonly messageListeners = new Set<(event: WorkerMessageEventLike) => void>();
  private readonly errorListeners = new Set<(event: unknown) => void>();
  private readonly messageErrorListeners = new Set<(event: unknown) => void>();
  private readonly handler = createDecimationWorkerHandler({
    postMessage: (message: unknown) => {
      if (this.terminated) return;
      const event: WorkerMessageEventLike = { data: message };
      for (const listener of this.messageListeners) {
        listener(event);
      }
    },
  });

  postMessage(message: unknown): void {
    if (this.terminated) return;
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "init-sab"
    ) {
      // Simulate non-isolated browser worker rejecting SharedArrayBuffer cloning so
      // `createWorkerDecimationPort` exercises its Transfer backing in single-threaded DOM tests.
      throw new Error("DataCloneError: SharedArrayBuffer unavailable in non-isolated test worker");
    }
    this.handler.handleMessage(message);
  }

  terminate(): void {
    this.terminated = true;
    this.handler.dispose();
  }

  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "messageerror", listener: (event: unknown) => void): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener);
    } else if (type === "error") {
      this.errorListeners.add(listener as (event: unknown) => void);
    } else {
      this.messageErrorListeners.add(listener as (event: unknown) => void);
    }
  }

  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: "error", listener: (event: unknown) => void): void;
  removeEventListener(type: "messageerror", listener: (event: unknown) => void): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: WorkerMessageEventLike) => void) | ((event: unknown) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener);
    } else if (type === "error") {
      this.errorListeners.delete(listener as (event: unknown) => void);
    } else {
      this.messageErrorListeners.delete(listener as (event: unknown) => void);
    }
  }
}

interface ControlledRaf {
  readonly request: (cb: FrameRequestCallback) => number;
  readonly cancel: (id: number) => void;
  readonly activeCount: () => number;
  readonly cancelledIds: number[];
  step(nowMs: number): void;
}

function createControlledRaf(): ControlledRaf {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelledIds: number[] = [];

  return {
    request(cb: FrameRequestCallback): number {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, cb);
      return id;
    },
    cancel(id: number): void {
      cancelledIds.push(id);
      callbacks.delete(id);
    },
    activeCount(): number {
      return callbacks.size;
    },
    cancelledIds,
    step(nowMs: number): void {
      const batch = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, cb] of batch) {
        cb(nowMs);
      }
    },
  };
}

describe("/streaming-transport view", () => {
  let addCount = 0;
  let removeCount = 0;
  let originalAdd: typeof EventTarget.prototype.addEventListener;
  let originalRemove: typeof EventTarget.prototype.removeEventListener;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalPath2D: typeof globalThis.Path2D;
  let strokeCalls = 0;

  beforeEach(() => {
    document.body.innerHTML = "";
    addCount = 0;
    removeCount = 0;
    strokeCalls = 0;
    originalPath2D = globalThis.Path2D;
    // Test boundary stub: happy-dom has no global Path2D implementation.
    // eslint-disable-next-line no-restricted-syntax
    globalThis.Path2D = StubPath2D as unknown as typeof Path2D;

    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalAdd = EventTarget.prototype.addEventListener;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof originalAdd>
    ) {
      addCount += 1;
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof originalRemove>
    ) {
      removeCount += 1;
      return originalRemove.apply(this, args);
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    const context: TraceDrawingContext = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "miter",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      setTransform(): void {},
      fillRect(): void {},
      beginPath(): void {},
      moveTo(): void {},
      lineTo(): void {},
      stroke(): void {
        strokeCalls += 1;
      },
      setLineDash(): void {},
      fill(): void {},
      fillText(): void {},
      save(): void {},
      restore(): void {},
      rect(): void {},
      clip(): void {},
    };
    // Test boundary stub: happy-dom has no 2D canvas context backend.
    // eslint-disable-next-line no-restricted-syntax
    const fakeGetContext = (() => context) as unknown as typeof originalGetContext;
    HTMLCanvasElement.prototype.getContext = fakeGetContext;
  });

  afterEach(() => {
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.Path2D = originalPath2D;
  });

  function setupMounted(extra?: { leaseTimeoutMs?: number; stallDropThreshold?: number }) {
    const workers: InMemoryTestWorker[] = [];
    const workerFactory: WorkerFactory = () => {
      const worker = new InMemoryTestWorker();
      workers.push(worker);
      return worker;
    };
    const raf = createControlledRaf();
    let clockMs = 1_000;
    const now = (): number => clockMs;
    const advanceClock = (deltaMs: number): void => {
      clockMs += deltaMs;
    };

    const statsView = createTransportStatsView();
    const snapshots: StreamingFrameSnapshot[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Pane();
    const panelBefore = panel.children.length;
    const controller = new AbortController();

    const teardown = mountStreamingTransport(
      { container, panel, signal: controller.signal },
      {
        workerFactory,
        statsView,
        now,
        leaseTimeoutMs: extra?.leaseTimeoutMs ?? 200,
        stallDropThreshold: extra?.stallDropThreshold ?? 2,
        requestFrame: raf.request,
        cancelFrame: raf.cancel,
        onFrame: (snapshot) => {
          snapshots.push(snapshot);
        },
      },
    );

    return {
      container,
      panel,
      panelBefore,
      controller,
      workers,
      raf,
      statsView,
      snapshots,
      advanceClock,
      now,
      teardown,
    };
  }

  it("renders streaming frames, advances payload.revision monotonically, preserves Retained buffers, and reuses one TransportStatsView", async () => {
    const ctx = setupMounted();
    expect(ctx.container.querySelectorAll("canvas")).toHaveLength(1);

    const revisions: number[] = [];
    const seenStatsRefs = new Set<TransportStatsView>();
    const seenCounterArrays = new Set<Int32Array>();
    const seenGaugeArrays = new Set<Float64Array>();
    let lastPayload: SpectrumDataPayload | null = null;

    for (let frame = 0; frame < 5; frame += 1) {
      ctx.advanceClock(20);
      ctx.raf.step(ctx.now());
      const latest = ctx.snapshots.at(-1);
      expect(latest).toBeDefined();
      if (latest !== undefined) {
        revisions.push(latest.payloadRevision);
        seenStatsRefs.add(latest.statsView);
        seenCounterArrays.add(latest.statsView.counters);
        seenGaugeArrays.add(latest.statsView.gauges);
        lastPayload = latest.payload;
      }
    }

    for (let i = 1; i < revisions.length; i += 1) {
      expect(revisions[i]!).toBeGreaterThan(revisions[i - 1]!);
    }
    expect(strokeCalls).toBeGreaterThan(0);
    expect(lastPayload).not.toBeNull();
    expect(lastPayload!.x.buffer.byteLength).toBeGreaterThan(0);
    expect(lastPayload!.y.buffer.byteLength).toBeGreaterThan(0);

    // Single preallocated TransportStatsView reused across every frame.
    expect(seenStatsRefs.size).toBe(1);
    expect(seenCounterArrays.size).toBe(1);
    expect(seenGaugeArrays.size).toBe(1);
    expect(ctx.statsView.counters[StatCounter.ChunksAccepted]).toBeGreaterThan(0);

    // Telemetry HUD contains all required fields.
    const hudText = ctx.container.querySelector('[data-role="transport-hud"]')?.textContent ?? "";
    expect(hudText).toContain("Health");
    expect(hudText).toContain("Backing");
    expect(hudText).toContain("ChunksAccepted");
    expect(hudText).toContain("ChunksDropped");
    expect(hudText).toContain("LeasesOutstanding");
    expect(hudText).toContain("ResponderFailures");
    expect(hudText).toContain("RemintEvents");
    expect(hudText).toContain("StaleSettlements");
    expect(hudText).toContain("DomainShifts");
    expect(hudText).toContain("DomainRebuilds");
    expect(hudText).toContain("OldestInFlightMs");

    await ctx.teardown();
  });

  it("increments DomainShifts on Tier-1 pan, DomainRebuilds on Tier-2 zoom, and runs non-mutating Tier-3 preview", async () => {
    const ctx = setupMounted();
    // Ingest initial frames so ring and accumulator have data.
    for (let i = 0; i < 4; i += 1) {
      ctx.advanceClock(20);
      ctx.raf.step(ctx.now());
    }

    const shiftsBefore = ctx.statsView.counters[StatCounter.DomainShifts]!;
    const rebuildsBefore = ctx.statsView.counters[StatCounter.DomainRebuilds]!;

    const panButton = ctx.container.querySelector<HTMLButtonElement>('button[data-action="tier1-pan-right"]');
    const zoomButton = ctx.container.querySelector<HTMLButtonElement>('button[data-action="tier2-zoom-in"]');
    const tier3Slider = ctx.container.querySelector<HTMLInputElement>('input[data-action="tier3-preview"]');
    expect(panButton).not.toBeNull();
    expect(zoomButton).not.toBeNull();
    expect(tier3Slider).not.toBeNull();

    panButton!.click();
    expect(ctx.statsView.counters[StatCounter.DomainShifts]).toBe(shiftsBefore + 1);
    expect(ctx.statsView.counters[StatCounter.DomainRebuilds]).toBe(rebuildsBefore);

    zoomButton!.click();
    expect(ctx.statsView.counters[StatCounter.DomainRebuilds]).toBe(rebuildsBefore + 1);

    const shiftsBeforePreview = ctx.statsView.counters[StatCounter.DomainShifts]!;
    const rebuildsBeforePreview = ctx.statsView.counters[StatCounter.DomainRebuilds]!;
    const accRevBefore = ctx.snapshots.at(-1)!.accumulatorRevision;

    tier3Slider!.value = "2";
    tier3Slider!.dispatchEvent(new Event("input"));
    expect(ctx.statsView.counters[StatCounter.DomainShifts]).toBe(shiftsBeforePreview);
    expect(ctx.statsView.counters[StatCounter.DomainRebuilds]).toBe(rebuildsBeforePreview);
    expect(ctx.snapshots.at(-1)!.accumulatorRevision).toBe(accRevBefore);
    expect(ctx.snapshots.at(-1)!.payload.x.buffer.byteLength).toBeGreaterThan(0);

    await ctx.teardown();
  });

  it("injects responder crash, increments ResponderFailures & RemintEvents, preserves Retained payload, and respawns worker", async () => {
    const ctx = setupMounted();
    for (let i = 0; i < 3; i += 1) {
      ctx.advanceClock(20);
      ctx.raf.step(ctx.now());
    }

    const workersBefore = ctx.workers.length;
    const acceptedBefore = ctx.statsView.counters[StatCounter.ChunksAccepted]!;
    const crashButton = ctx.container.querySelector<HTMLButtonElement>('button[data-action="inject-crash"]');
    expect(crashButton).not.toBeNull();

    crashButton!.click();

    expect(ctx.statsView.counters[StatCounter.ResponderFailures]).toBeGreaterThanOrEqual(1);
    expect(ctx.statsView.counters[StatCounter.RemintEvents]).toBeGreaterThanOrEqual(1);
    expect(ctx.workers[0]!.terminated).toBe(true);

    // Retained payload remains intact without detaching.
    const snapAfterCrash = ctx.snapshots.at(-1)!;
    expect(snapAfterCrash.payload.x.buffer.byteLength).toBeGreaterThan(0);
    expect(snapAfterCrash.payload.y.buffer.byteLength).toBeGreaterThan(0);

    // Next streaming frames lazily respawn a fresh worker and resume accepting chunks.
    for (let i = 0; i < 3; i += 1) {
      ctx.advanceClock(20);
      ctx.raf.step(ctx.now());
    }
    expect(ctx.workers.length).toBeGreaterThan(workersBefore);
    expect(ctx.statsView.counters[StatCounter.ChunksAccepted]!).toBeGreaterThan(acceptedBefore);

    await ctx.teardown();
  });

  it("injects responder stall, observes saturation/stall/timeout recovery, and resumes streaming", async () => {
    const ctx = setupMounted({ leaseTimeoutMs: 200, stallDropThreshold: 2 });
    for (let i = 0; i < 2; i += 1) {
      ctx.advanceClock(20);
      ctx.raf.step(ctx.now());
    }

    const stallButton = ctx.container.querySelector<HTMLButtonElement>('button[data-action="inject-stall"]');
    expect(stallButton).not.toBeNull();
    stallButton!.click();

    // Advance 6 frames at 20 ms (120 ms < 200 ms timeout) to fill all 3 pool pairs and drop 3 chunks.
    for (let i = 0; i < 6; i += 1) {
      ctx.advanceClock(20);
      ctx.raf.step(ctx.now());
    }
    expect(ctx.statsView.counters[StatCounter.ChunksDropped]!).toBeGreaterThanOrEqual(2);

    // Advance past leaseTimeoutMs to trigger lazy deadline sweep timeout recovery.
    ctx.advanceClock(250);
    ctx.raf.step(ctx.now());
    expect(ctx.statsView.counters[StatCounter.ResponderFailures]!).toBeGreaterThanOrEqual(1);
    expect(ctx.statsView.counters[StatCounter.RemintEvents]!).toBeGreaterThanOrEqual(1);

    // Streaming resumes cleanly on a respawned worker.
    const acceptedAfterRecovery = ctx.statsView.counters[StatCounter.ChunksAccepted]!;
    ctx.advanceClock(20);
    ctx.raf.step(ctx.now());
    expect(ctx.statsView.counters[StatCounter.ChunksAccepted]!).toBeGreaterThan(acceptedAfterRecovery);

    await ctx.teardown();
  });

  it("tears down cleanly: cancels rAF, terminates worker, removes panel bindings, nets listeners to zero, and leaves no canvas", async () => {
    const ctx = setupMounted();
    ctx.advanceClock(20);
    ctx.raf.step(ctx.now());

    expect(ctx.raf.activeCount()).toBe(1);
    expect(ctx.panel.children.length).toBeGreaterThan(ctx.panelBefore);

    ctx.controller.abort();
    await ctx.teardown();

    expect(ctx.raf.activeCount()).toBe(0);
    expect(ctx.raf.cancelledIds.length).toBeGreaterThanOrEqual(1);
    expect(ctx.workers.every((w) => w.terminated)).toBe(true);
    expect(addCount - removeCount).toBe(0);
    expect(ctx.panel.children.length).toBe(ctx.panelBefore);
    expect(ctx.container.querySelectorAll("canvas")).toHaveLength(0);
    expect(ctx.container.childElementCount).toBe(0);
  });

  it("registers at /streaming-transport without editing shell or /home and appears as a link on /home", async () => {
    await import("../../src/views/index.js");
    const view = resolveView(asRoutePath("/streaming-transport"));
    expect(view).toBeDefined();
    expect(view?.label).toBe("Streaming Transport");

    // Mount /home and confirm /streaming-transport appears automatically.
    const homeContainer = document.createElement("div");
    const panel = new Pane();
    const controller = new AbortController();
    const teardownHome = mountHome({ container: homeContainer, panel, signal: controller.signal });
    const links = Array.from(homeContainer.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("#/streaming-transport");
    await teardownHome();

    // Confirm no shell or /home source mentions streaming-transport.
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const shellFile of ["router.ts", "registry.ts", "bootstrap.ts", "view.ts"]) {
      expect(readFileSync(path.join(here, "../../src/shell", shellFile), "utf8")).not.toContain(
        "streaming-transport",
      );
    }
    expect(readFileSync(path.join(here, "../../src/views/home/mount.ts"), "utf8")).not.toContain(
      "streaming-transport",
    );
  });
});
