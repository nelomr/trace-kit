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
  Atomics?: unknown;
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
 * the data. `Transfer` is the universal default; `Shared` is an optional detected fast path.
 */
export const enum BufferBacking {
  Transfer = 0,
  Shared = 1,
}

/**
 * Selects `Shared` when `SharedArrayBuffer` and `Atomics` are available (and, in browser realms
 * where `crossOriginIsolated` or `Worker` is present, when `crossOriginIsolated` is true);
 * otherwise defaults to `Transfer`. Never a required config field.
 */
export function selectBufferBacking(
  capabilities: TransportCapabilities,
): BufferBacking {
  if (!capabilities.sharedMemory) return BufferBacking.Transfer;
  const g = globalThis as typeof globalThis & MaybeGlobalExtras;
  if (typeof g.Atomics === "undefined") return BufferBacking.Transfer;
  const isBrowserRealm =
    capabilities.workerConstructor ||
    typeof g.crossOriginIsolated === "boolean";
  if (isBrowserRealm && !capabilities.crossOriginIsolated) {
    return BufferBacking.Transfer;
  }
  return BufferBacking.Shared;
}
