import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";
import type {
  SpectrumEngineHandle,
  SpectrumEngineSnapshot,
  TraceSpectrumViewerProps,
} from "./types.js";
import { useSpectrumEngine } from "./use-spectrum-engine.js";

const VIEWER_STYLE: CSSProperties = Object.freeze({ position: "relative" });
const SURFACE_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
});
const SLOT_OVERLAY_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
  inset: "0",
  pointerEvents: "none",
});

interface OverlayHostProps {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SpectrumEngineSnapshot;
  readonly getServerSnapshot: () => SpectrumEngineSnapshot;
  readonly renderOverlay: (snapshot: SpectrumEngineSnapshot) => ReactNode;
}

/**
 * Isolated overlay host: subscribes to discrete engine metadata via `useSyncExternalStore`
 * so rapid pan/zoom domain changes update only the sibling overlay without re-rendering
 * `TraceSpectrumViewer` or reconciling the unmanaged `[data-trace-kit-surface]` canvas container.
 */
function OverlayHost(props: OverlayHostProps): ReactNode {
  const snapshot = useSyncExternalStore(
    props.subscribe,
    props.getSnapshot,
    props.getServerSnapshot,
  );
  return createElement(
    "div",
    {
      "data-trace-kit-slot-overlay": "",
      style: SLOT_OVERLAY_STYLE,
    },
    props.renderOverlay(snapshot),
  );
}

/**
 * Pure-TypeScript React 18/19 component wrapping `useSpectrumEngine` with strict two-layer
 * unmanaged DOM isolation (`[data-trace-kit-viewer]` -> childless `[data-trace-kit-surface]` ->
 * optional isolated sibling `[data-trace-kit-slot-overlay]` -> optional trailing `children`),
 * non-colliding `figureStyle` prop alongside standard `className`/`style`, and forwarded
 * `SpectrumEngineHandle` imperative ref.
 */
export const TraceSpectrumViewer: ForwardRefExoticComponent<
  TraceSpectrumViewerProps & RefAttributes<SpectrumEngineHandle>
> = /*#__PURE__*/ forwardRef<SpectrumEngineHandle, TraceSpectrumViewerProps>(
  function TraceSpectrumViewer(props, ref) {
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    const handle = useSpectrumEngine(surfaceRef, {
      data: props.data,
      traces: props.traces,
      revision: props.revision,
      domain: props.domain,
      mode: props.mode,
      decimation: props.decimation,
      interactive: props.interactive,
      dragMode: props.dragMode,
      homeDomain: props.homeDomain,
      figureStyle: props.figureStyle,
      axes: props.axes,
      yAxes: props.yAxes,
      hysteresis: props.hysteresis,
      decimationPort: props.decimationPort,
      settlementSink: props.settlementSink,
      autoResize: props.autoResize,
      initialWidth: props.initialWidth,
      initialHeight: props.initialHeight,
      initialDpr: props.initialDpr,
      interactionOptions: props.interactionOptions,
      platform: props.platform,
      subscribeState: false,
      onReady: props.onReady,
      onDomainChange: props.onDomainChange,
      onInvalidate: props.onInvalidate,
      onBoxSelect: props.onBoxSelect,
      onGestureStateChange: props.onGestureStateChange,
      onEngineChange: props.onEngineChange,
      onWebGL2Fallback: props.onWebGL2Fallback,
      onContextLost: props.onContextLost,
      onContextRestored: props.onContextRestored,
    });

    useImperativeHandle(
      ref,
      (): SpectrumEngineHandle => ({
        get controller() {
          return handle.controllerRef.current;
        },
        get interaction() {
          return handle.interactionRef.current;
        },
        render: handle.render,
        requestRender: handle.requestRender,
        clear: handle.clear,
        setDomain: handle.setDomain,
        resize: handle.resize,
        retryWebGL2: handle.retryWebGL2,
        resetDomain: handle.resetDomain,
        zoomByFactor: handle.zoomByFactor,
        panByFraction: handle.panByFraction,
        cancelGesture: handle.cancelGesture,
        dispose: handle.dispose,
      }),
      [
        handle.cancelGesture,
        handle.clear,
        handle.controllerRef,
        handle.dispose,
        handle.interactionRef,
        handle.panByFraction,
        handle.render,
        handle.requestRender,
        handle.resetDomain,
        handle.resize,
        handle.retryWebGL2,
        handle.setDomain,
        handle.zoomByFactor,
      ],
    );

    const viewerStyle: CSSProperties =
      props.style === undefined ? VIEWER_STYLE : { ...VIEWER_STYLE, ...props.style };

    const surfaceElement = createElement("div", {
      key: "surface",
      ref: surfaceRef,
      "data-trace-kit-surface": "",
      style: SURFACE_STYLE,
    });

    const overlayElement =
      props.renderOverlay !== undefined
        ? createElement(OverlayHost, {
            key: "overlay",
            subscribe: handle.subscribe,
            getSnapshot: handle.getSnapshot,
            getServerSnapshot: handle.getServerSnapshot,
            renderOverlay: props.renderOverlay,
          })
        : null;

    return createElement(
      "div",
      {
        "data-trace-kit-viewer": "",
        ...(props.id !== undefined ? { id: props.id } : {}),
        ...(props.className !== undefined ? { className: props.className } : {}),
        style: viewerStyle,
      },
      surfaceElement,
      overlayElement,
      props.children,
    );
  },
);
