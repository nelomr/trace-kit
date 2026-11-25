import type {
  DecimationPort,
  DecimationSelection,
  SettlementSink,
  SpectrumDataPayload,
  TraceCollection,
  YAxisRegistration,
} from "@trace-kit/core";
import type { AxisLayout, FigureStyle } from "@trace-kit/renderers";
import type {
  BoxSelectEvent,
  EngineChangeEvent,
  EngineSelectionMode,
  GestureStateChangeEvent,
  HysteresisConfig,
  InteractionDragMode,
  ViewportDomain,
  ViewportInvalidationEvent,
  ViewportMutationReason,
  WebGL2ContextLostEvent,
  WebGL2ContextRestoredEvent,
  WebGL2FallbackEvent,
} from "@trace-kit/renderers/controller";
import {
  defineComponent,
  h,
  shallowRef,
  type PropType,
  type RenderFunction,
  type SlotsType,
  type VNodeChild,
} from "vue";
import type {
  SpectrumEngineHandle,
  SpectrumEnginePlatformOptions,
  SpectrumEngineReadyEvent,
  TraceSpectrumViewerSlotProps,
  TraceSpectrumViewerSlots,
  TraceViewportInteractionOptions,
} from "./types.js";
import { useSpectrumEngine } from "./use-spectrum-engine.js";

const VIEWER_STYLE = Object.freeze({ position: "relative" });
const SURFACE_STYLE = Object.freeze({
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
});
const SLOT_OVERLAY_STYLE = Object.freeze({
  position: "absolute",
  inset: "0",
  pointerEvents: "none",
});

/**
 * Pure-TypeScript Vue 3 component wrapping `useSpectrumEngine` with strict two-layer
 * VDOM/hydration-safe DOM isolation (`[data-trace-kit-viewer]` -> childless
 * `[data-trace-kit-surface]` -> optional sibling `[data-trace-kit-slot-overlay]` -> optional
 * trailing `#default`), non-colliding `figureStyle` prop, 10 typed `emits`, lazy getter-backed
 * scoped slots, and `expose(SpectrumEngineHandle)`.
 */
export const TraceSpectrumViewer = /*#__PURE__*/ defineComponent({
  name: "TraceSpectrumViewer",
  props: {
    data: {
      type: Object as PropType<SpectrumDataPayload | null | undefined>,
      default: undefined,
    },
    traces: {
      type: Object as PropType<TraceCollection | null | undefined>,
      default: undefined,
    },
    revision: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
    domain: {
      type: Object as PropType<ViewportDomain | undefined>,
      default: undefined,
    },
    mode: {
      type: String as PropType<EngineSelectionMode | undefined>,
      default: undefined,
    },
    decimation: {
      type: Object as PropType<DecimationSelection | undefined>,
      default: undefined,
    },
    interactive: {
      type: Boolean,
      default: true,
    },
    dragMode: {
      type: String as PropType<InteractionDragMode | undefined>,
      default: undefined,
    },
    homeDomain: {
      type: Object as PropType<ViewportDomain | undefined>,
      default: undefined,
    },
    figureStyle: {
      type: Object as PropType<Partial<FigureStyle> | undefined>,
      default: undefined,
    },
    axes: {
      type: Object as PropType<Partial<AxisLayout> | undefined>,
      default: undefined,
    },
    yAxes: {
      type: Array as PropType<readonly YAxisRegistration[] | undefined>,
      default: undefined,
    },
    hysteresis: {
      type: Object as PropType<HysteresisConfig | undefined>,
      default: undefined,
    },
    decimationPort: {
      type: Object as PropType<DecimationPort | undefined>,
      default: undefined,
    },
    settlementSink: {
      type: Object as PropType<SettlementSink | undefined>,
      default: undefined,
    },
    autoResize: {
      type: Boolean,
      default: true,
    },
    initialWidth: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
    initialHeight: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
    initialDpr: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
    interactionOptions: {
      type: Object as PropType<TraceViewportInteractionOptions | undefined>,
      default: undefined,
    },
    platform: {
      type: Object as PropType<SpectrumEnginePlatformOptions | undefined>,
      default: undefined,
    },
  },
  emits: {
    ready: (event: SpectrumEngineReadyEvent): boolean => event.controller !== undefined,
    "update:domain": (domain: ViewportDomain): boolean => typeof domain.xMin === "number",
    domainChange: (domain: ViewportDomain, reason: ViewportMutationReason): boolean =>
      typeof domain.xMin === "number" && typeof reason === "string",
    invalidate: (event: ViewportInvalidationEvent): boolean => typeof event.seq === "number",
    boxSelect: (event: BoxSelectEvent): boolean => typeof event.startDeviceX === "number",
    gestureStateChange: (event: GestureStateChangeEvent): boolean => typeof event.state === "string",
    engineChange: (event: EngineChangeEvent): boolean => typeof event.activeKind === "string",
    webgl2Fallback: (event: WebGL2FallbackEvent): boolean => typeof event.sampleCount === "number",
    contextLost: (event: WebGL2ContextLostEvent): boolean =>
      typeof event.statusMessage === "string",
    contextRestored: (event: WebGL2ContextRestoredEvent): boolean =>
      typeof event.restoreCount === "number",
  },
  slots: Object as SlotsType<TraceSpectrumViewerSlots>,
  setup(props, { slots, emit, expose }): SpectrumEngineHandle | RenderFunction {
    const surfaceRef = shallowRef<HTMLDivElement | null>(null);

    const handle = useSpectrumEngine(surfaceRef, {
      data: () => props.data,
      traces: () => props.traces,
      revision: () => props.revision,
      domain: () => props.domain,
      mode: () => props.mode,
      decimation: () => props.decimation,
      interactive: () => props.interactive,
      dragMode: () => props.dragMode,
      homeDomain: () => props.homeDomain,
      ...(props.figureStyle !== undefined ? { figureStyle: props.figureStyle } : {}),
      ...(props.axes !== undefined ? { axes: props.axes } : {}),
      ...(props.yAxes !== undefined ? { yAxes: props.yAxes } : {}),
      ...(props.hysteresis !== undefined ? { hysteresis: props.hysteresis } : {}),
      ...(props.decimationPort !== undefined ? { decimationPort: props.decimationPort } : {}),
      ...(props.settlementSink !== undefined ? { settlementSink: props.settlementSink } : {}),
      autoResize: props.autoResize,
      ...(props.initialWidth !== undefined ? { initialWidth: props.initialWidth } : {}),
      ...(props.initialHeight !== undefined ? { initialHeight: props.initialHeight } : {}),
      ...(props.initialDpr !== undefined ? { initialDpr: props.initialDpr } : {}),
      ...(props.interactionOptions !== undefined
        ? { interactionOptions: props.interactionOptions }
        : {}),
      ...(props.platform !== undefined ? { platform: props.platform } : {}),
      onReady(event) {
        emit("ready", event);
      },
      onDomainChange(snapshot, reason) {
        emit("update:domain", snapshot);
        emit("domainChange", snapshot, reason);
      },
      onInvalidate(event) {
        emit("invalidate", event);
      },
      onBoxSelect(event) {
        emit("boxSelect", event);
      },
      onGestureStateChange(event) {
        emit("gestureStateChange", event);
      },
      onEngineChange(event) {
        emit("engineChange", event);
      },
      onWebGL2Fallback(event) {
        emit("webgl2Fallback", event);
      },
      onContextLost(event) {
        emit("contextLost", event);
      },
      onContextRestored(event) {
        emit("contextRestored", event);
      },
    });

    expose(handle);

    // Lazy getter-backed slot props: when no slot reads a property, zero reactive refs are
    // tracked by the render effect, keeping 60 Hz Path A streaming at 0 Vue re-renders.
    const slotProps: TraceSpectrumViewerSlotProps = {
      get isReady() {
        return handle.isReady.value;
      },
      get activeKind() {
        return handle.activeKind.value;
      },
      get mode() {
        return handle.mode.value;
      },
      get domain() {
        return handle.domain.value;
      },
      get sampleCount() {
        return handle.sampleCount.value;
      },
      get contextLost() {
        return handle.contextLost.value;
      },
      get webgl2Fallback() {
        return handle.webgl2Fallback.value;
      },
      get gestureState() {
        return handle.gestureState.value;
      },
    };

    return () => {
      const children: VNodeChild[] = [
        h("div", {
          ref: surfaceRef,
          "data-trace-kit-surface": "",
          style: SURFACE_STYLE,
        }),
      ];

      if (slots.overlay !== undefined) {
        const overlayContent = slots.overlay(slotProps);
        const overlayChildren =
          overlayContent === null || overlayContent === undefined
            ? undefined
            : Array.isArray(overlayContent)
              ? overlayContent
              : [overlayContent];
        children.push(
          h(
            "div",
            {
              "data-trace-kit-slot-overlay": "",
              style: SLOT_OVERLAY_STYLE,
            },
            overlayChildren,
          ),
        );
      }

      if (slots.default !== undefined) {
        children.push(slots.default(slotProps));
      }

      return h(
        "div",
        {
          "data-trace-kit-viewer": "",
          style: VIEWER_STYLE,
        },
        children,
      );
    };
  },
});
