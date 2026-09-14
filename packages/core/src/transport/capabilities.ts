/**
 * Runtime capability detection. Every global reference lives inside a function body, never at
 * module scope — a top-level reference alone breaks SSR bundling and defeats tree-shaking. The
 * result is not cached at module scope either: a cached module-level value would be captured at
 * import time, which is the same SSR hazard in a different disguise.
 */

export interface TransportCapabilities {
  readonly sharedMemory: boolean;
  readonly workerConstructor: boolean;
  /**
   * Reported for observability only. No TraceKit feature is gated on this value, on
   * `SharedArrayBuffer`, or on serving Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy —
   * every ownership invariant passes with `SharedArrayBuffer` absent from the environment, which
   * keeps GitHub Pages and third-party embedding fully supported deployment targets.
   */
  readonly crossOriginIsolated: boolean;
}

interface MaybeGlobalExtras {
  Worker?: unknown;
  crossOriginIsolated?: boolean;
}

export function detectTransportCapabilities(): TransportCapabilities {
  const g = globalThis as typeof globalThis & MaybeGlobalExtras;
  return {
    sharedMemory: typeof g.SharedArrayBuffer !== "undefined",
    workerConstructor: typeof g.Worker !== "undefined",
    crossOriginIsolated:
      "crossOriginIsolated" in g && g.crossOriginIsolated === true,
  };
}

/**
 * Internal-only backing selector. Never referenced from `decimation-port.ts`'s public surface —
 * the public currency is a lease handle plus accessors, which never leaks which backing moved
 * the data. The `Shared` backing's SPSC ring is not implemented yet; selection exists so the seam
 * is present without a required config field.
 */
export const enum BufferBacking {
  Transfer = 0,
  Shared = 1,
}

/** `Shared` only when detected available; `Transfer` otherwise. Never a required config field. */
export function selectBufferBacking(
  capabilities: TransportCapabilities,
): BufferBacking {
  return capabilities.sharedMemory ? BufferBacking.Shared : BufferBacking.Transfer;
}
