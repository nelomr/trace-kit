/** @vitest-environment happy-dom */
import {
  commitPayloadRevision,
  createSyncDecimationPort,
  type DecimationPort,
  type SettlementSink,
  type SpectrumDataPayload,
  type TraceCollection,
} from "@trace-kit/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  isProxy,
  isReactive,
  isReadonly,
  isRef,
  isShallow,
  markRaw,
  nextTick,
  reactive,
  ref,
  shallowRef,
  toRaw,
  type ShallowUnwrapRef,
} from "vue";
import { snapshotDomain } from "../../src/domain-sync.js";
import { TraceSpectrumViewer } from "../../src/trace-spectrum-viewer.js";
import type { SpectrumEngineHandle, UseSpectrumEngineReturn } from "../../src/types.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import {
  createMockPlatform,
  createMountedHost,
  createTestPayload,
  createTestTraceCollection,
} from "./test-helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("snapshotDomain purity & immutability", () => {
  it("returns a fresh frozen plain object detached from live getter views", () => {
    let xMin = 10;
    let xMax = 20;
    let yMin = -50;
    let yMax = 0;

    const liveView = Object.freeze({
      get xMin(): number {
        return xMin;
      },
      get xMax(): number {
        return xMax;
      },
      get yMin(): number {
        return yMin;
      },
      get yMax(): number {
        return yMax;
      },
    });

    const snap1 = snapshotDomain(liveView);
    expect(snap1).not.toBe(liveView);
    expect(Object.isFrozen(snap1)).toBe(true);
    expect(isProxy(snap1)).toBe(false);
    expect(isReactive(snap1)).toBe(false);
    expect(snap1).toEqual({ xMin: 10, xMax: 20, yMin: -50, yMax: 0 });

    // Mutate backing scalars; snap1 must stay frozen at its original values.
    xMin = 30;
    xMax = 40;
    yMin = -80;
    yMax = -10;
    const snap2 = snapshotDomain(liveView);
    expect(snap1).toEqual({ xMin: 10, xMax: 20, yMin: -50, yMax: 0 });
    expect(snap2).toEqual({ xMin: 30, xMax: 40, yMin: -80, yMax: -10 });
    expect(snap1).not.toBe(snap2);
  });
});

describe("vue-reactivity-isolation (happy-dom)", () => {
  it("exposes shallowReadonly shallowRefs with non-proxied raw controller, interaction, and metadata", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    let capturedHandle: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        const handle = useSpectrumEngine(containerRef, {
          interactive: true,
          platform: harness.platform,
        });
        capturedHandle = handle;
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    expect(capturedHandle).not.toBeNull();
    const handle = capturedHandle!;

    // Controller & interaction refs
    expect(isRef(handle.controller)).toBe(true);
    expect(isShallow(handle.controller)).toBe(true);
    expect(isReadonly(handle.controller)).toBe(true);
    expect(handle.controller.value).not.toBeNull();
    expect(isProxy(handle.controller.value)).toBe(false);
    expect(isReactive(handle.controller.value)).toBe(false);
    expect(toRaw(handle.controller.value)).toBe(handle.controller.value);

    expect(isRef(handle.interaction)).toBe(true);
    expect(isShallow(handle.interaction)).toBe(true);
    expect(isReadonly(handle.interaction)).toBe(true);
    expect(handle.interaction.value).not.toBeNull();
    expect(isProxy(handle.interaction.value)).toBe(false);
    expect(isReactive(handle.interaction.value)).toBe(false);
    expect(toRaw(handle.interaction.value)).toBe(handle.interaction.value);

    // Every exposed metadata ref must satisfy isShallow === true and isReadonly === true
    const metadataRefs = [
      handle.isReady,
      handle.activeKind,
      handle.mode,
      handle.domain,
      handle.sampleCount,
      handle.contextLost,
      handle.webgl2Fallback,
      handle.gestureState,
    ];
    for (const metaRef of metadataRefs) {
      expect(isRef(metaRef)).toBe(true);
      expect(isShallow(metaRef)).toBe(true);
      expect(isReadonly(metaRef)).toBe(true);
    }

    // Domain snapshot value itself must not be wrapped in a Proxy
    expect(isProxy(handle.domain.value)).toBe(false);
    expect(isReactive(handle.domain.value)).toBe(false);
    expect(toRaw(handle.domain.value)).toBe(handle.domain.value);

    app.unmount();
  });

  it("survives wrapping { controller, interaction } and { handle } inside reactive() without ES #private TypeError", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    let capturedHandle: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        const handle = useSpectrumEngine(containerRef, {
          interactive: true,
          platform: harness.platform,
        });
        capturedHandle = handle;
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    const handle = capturedHandle!;

    const store = reactive({
      controller: handle.controller.value,
      interaction: handle.interaction.value,
    });
    const wrappedHandleStore = reactive({ handle });

    expect(isProxy(store.controller)).toBe(false);
    expect(isProxy(store.interaction)).toBe(false);
    expect(isProxy(wrappedHandleStore.handle.controller)).toBe(false);
    expect(isProxy(wrappedHandleStore.handle.interaction)).toBe(false);

    expect(() => {
      const kind = store.controller?.activeKind;
      const dom = store.controller?.domain;
      const count = store.controller?.sampleCount;
      const state = store.interaction?.state;
      expect(kind).toBe("canvas2d");
      expect(dom).toBeDefined();
      expect(typeof count).toBe("number");
      expect(state).toBe("idle");
      store.controller?.setDomain(10, 50, -30, 10);
      store.controller?.render();
      store.controller?.requestRender();
      store.interaction?.resetDomain();
    }).not.toThrow();

    app.unmount();
  });

  it("unwraps ref()-wrapped SpectrumDataPayload via toRaw before forwarding to SpectrumEngineController", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const rawPayload = createTestPayload(128);
    // Deliberately wrap non-frozen mutable SpectrumDataPayload in deep Vue ref()
    const deepPayloadRef = ref<SpectrumDataPayload>(rawPayload);
    expect(isProxy(deepPayloadRef.value)).toBe(true);

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        useSpectrumEngine(containerRef, {
          data: deepPayloadRef,
          platform: harness.platform,
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const renderer = harness.canvas2dRenderers[0];
    expect(renderer).toBeDefined();
    expect(renderer!.setDataCalls.length).toBeGreaterThanOrEqual(1);
    const received = renderer!.setDataCalls[0]!;

    expect(isProxy(received)).toBe(false);
    expect(isReactive(received)).toBe(false);
    expect(received).toBe(rawPayload);
    expect(received.x).toBe(rawPayload.x);
    expect(received.y).toBe(rawPayload.y);
    expect(isProxy(received.x)).toBe(false);
    expect(isProxy(received.y)).toBe(false);

    app.unmount();
  });

  it("unwraps reactive()-wrapped TraceCollection, DecimationPort, and SettlementSink via toRaw", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const rawTraces = createTestTraceCollection(0, 100, 64);
    const rawPort: DecimationPort = createSyncDecimationPort();
    const settledTargets: unknown[] = [];
    const rawSink: SettlementSink = {
      onSettled(lease) {
        settledTargets.push(lease);
        return false;
      },
    };

    const reactiveTraces = ref<TraceCollection>(rawTraces);
    const reactivePort = reactive(rawPort);
    const reactiveSink = reactive(rawSink);

    const capturedHandles: UseSpectrumEngineReturn[] = [];
    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        capturedHandles.push(
          useSpectrumEngine(containerRef, {
            traces: reactiveTraces,
            decimationPort: reactivePort,
            settlementSink: reactiveSink,
            platform: harness.platform,
          }),
        );
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const renderer = harness.canvas2dRenderers[0]!;
    expect(renderer.setTracesCalls.length).toBeGreaterThanOrEqual(1);
    const receivedTraces = renderer.setTracesCalls[0]!;
    expect(isProxy(receivedTraces)).toBe(false);
    expect(isReactive(receivedTraces)).toBe(false);
    expect(receivedTraces).toBe(rawTraces);
    expect(receivedTraces.entries[0]!.payload.x).toBe(rawTraces.entries[0]!.payload.x);
    const capturedHandle = capturedHandles[0];
    expect(capturedHandle?.controller.value).not.toBeNull();

    // Verify rendering polls the raw unwrapped port without proxy errors
    expect(() => capturedHandle?.render()).not.toThrow();

    app.unmount();
    rawPort.dispose();
  });

  it("preserves zero-copy typed-array identity with shallowRef(markRaw(payload)) on <TraceSpectrumViewer>", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const rawPayload = createTestPayload(128);
    const payloadRef = shallowRef(markRaw(rawPayload));

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            data: payloadRef.value,
            platform: harness.platform,
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const renderer = harness.canvas2dRenderers[0]!;
    expect(renderer.setDataCalls[0]).toBe(rawPayload);
    expect(renderer.setDataCalls[0]!.x).toBe(rawPayload.x);
    expect(renderer.setDataCalls[0]!.y).toBe(rawPayload.y);
    expect(isProxy(payloadRef.value)).toBe(false);

    app.unmount();
  });

  it("supports Path A imperative requestRender() for in-place commitPayloadRevision() with zero Vue re-renders", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const rawPayload = createTestPayload(128, { capacity: 512 });
    const payloadRef = shallowRef(markRaw(rawPayload));
    const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);
    let parentRenderCount = 0;

    const Host = defineComponent({
      setup() {
        return () => {
          parentRenderCount += 1;
          return h(TraceSpectrumViewer, {
            ref: viewerRef,
            data: payloadRef.value,
            platform: harness.platform,
          });
        };
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const renderer = harness.canvas2dRenderers[0]!;
    expect(viewerRef.value).not.toBeNull();
    expect(viewerRef.value!.sampleCount).toBe(128);
    const initialSetDataCount = renderer.setDataCalls.length;
    const initialRenderCount = renderer.renderCount;
    const rendersAfterMount = parentRenderCount;

    // Mutate payload in place (60 Hz streaming hot path)
    for (let i = 0; i < 256; i += 1) {
      rawPayload.x[i] = i;
      rawPayload.y[i] = -50 + i * 0.05;
    }
    commitPayloadRevision(rawPayload, 256);
    viewerRef.value!.requestRender();
    harness.raf.flush();
    await nextTick();

    expect(renderer.setDataCalls.length).toBe(initialSetDataCount);
    expect(renderer.renderCount).toBe(initialRenderCount + 1);
    expect(renderer.lastRenderedSampleCount).toBe(256);
    expect(renderer.setDataCalls[0]).toBe(rawPayload);
    expect(renderer.setDataCalls[0]!.y).toBe(rawPayload.y);
    expect(viewerRef.value!.sampleCount).toBe(256);
    expect(parentRenderCount).toBe(rendersAfterMount);

    app.unmount();
  });

  it("supports Path B scalar revision prop triggering controller.requestRender() without replacing payload", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const rawPayload = createTestPayload(128, { capacity: 1024 });
    const payloadRef = shallowRef(markRaw(rawPayload));
    const rev = ref(rawPayload.revision);
    const viewerRef = shallowRef<ShallowUnwrapRef<SpectrumEngineHandle> | null>(null);

    const Host = defineComponent({
      setup() {
        return () =>
          h(TraceSpectrumViewer, {
            ref: viewerRef,
            data: payloadRef.value,
            revision: rev.value,
            platform: harness.platform,
          });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const renderer = harness.canvas2dRenderers[0]!;
    const initialSetDataCount = renderer.setDataCalls.length;
    const initialRenderCount = renderer.renderCount;

    for (let i = 0; i < 512; i += 1) {
      rawPayload.x[i] = i;
      rawPayload.y[i] = -40;
    }
    commitPayloadRevision(rawPayload, 512);
    rev.value = rawPayload.revision;
    await nextTick();
    harness.raf.flush();

    expect(renderer.setDataCalls.length).toBe(initialSetDataCount);
    expect(renderer.renderCount).toBe(initialRenderCount + 1);
    expect(renderer.lastRenderedSampleCount).toBe(512);
    expect(viewerRef.value!.sampleCount).toBe(512);
    expect(isProxy(rawPayload)).toBe(false);

    app.unmount();
  });
});
