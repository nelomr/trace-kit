/**
 * `@trace-kit/vue`
 * Zero-proxy, SSR-safe Vue 3 adapter for TraceKit spectrum visualization.
 *
 * Exact runtime export surface (sorted):
 * `["TraceSpectrumViewer", "snapshotDomain", "useSpectrumEngine"]`.
 */
export { snapshotDomain } from "./domain-sync.js";
export { TraceSpectrumViewer } from "./trace-spectrum-viewer.js";
export { useSpectrumEngine } from "./use-spectrum-engine.js";
export type {
  SpectrumEngineHandle,
  SpectrumEnginePlatformOptions,
  SpectrumEngineReadyEvent,
  TraceSpectrumViewerEmits,
  TraceSpectrumViewerProps,
  TraceSpectrumViewerSlotProps,
  TraceSpectrumViewerSlots,
  TraceViewportInteractionOptions,
  UseSpectrumEngineOptions,
  UseSpectrumEngineReturn,
} from "./types.js";
