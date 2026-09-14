// Shared GC-observation helper for the ownership prototype (and any future `--expose-gc`
// instrumented probe under `bench/`). Extracted from the committed
// `openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs` pattern: the same
// `PerformanceObserver({ entryTypes: ['gc'] })` instrumentation, but splitting scavenge (minor)
// GC events from major GC events by `entry.detail.kind` against the Node `NODE_PERFORMANCE_GC_*`
// constants — a major GC can be triggered by anything else in the process and must
// never silently count against a scavenge-only gate.
import { PerformanceObserver, constants } from "node:perf_hooks";

/**
 * Starts observing `gc` performance entries. Returns a handle exposing `reset()` (clears the
 * running counts without disconnecting), `counts()` (a plain object snapshot: `{ scavengeCount,
 * majorCount, otherCount }`), and `disconnect()` (stops observing — call this exactly once when
 * the gate is no longer needed).
 */
export function createGcGate() {
  let scavengeCount = 0;
  let majorCount = 0;
  let otherCount = 0;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const kind = entry.detail && entry.detail.kind;
      if (kind === constants.NODE_PERFORMANCE_GC_MINOR) {
        scavengeCount += 1;
      } else if (kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
        majorCount += 1;
      } else {
        otherCount += 1;
      }
    }
  });
  observer.observe({ entryTypes: ["gc"] });

  return {
    reset() {
      scavengeCount = 0;
      majorCount = 0;
      otherCount = 0;
    },
    counts() {
      return { scavengeCount, majorCount, otherCount };
    },
    disconnect() {
      observer.disconnect();
    },
  };
}

/**
 * Waits `ms` milliseconds so pending GC performance-entry callbacks (delivered asynchronously by
 * the observer) have a chance to run before the caller reads `counts()`. Mirrors the 30 ms
 * settle delay used by the committed evidence probes this module is adapted from.
 */
export function settle(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Forces a GC cycle. Requires the process to be started with `--expose-gc`; throws otherwise,
 *  loudly, rather than silently no-op-ing and letting a caller believe the heap was cleared. */
export function forceGc() {
  if (typeof globalThis.gc !== "function") {
    throw new Error(
      "forceGc(): globalThis.gc is not available — run this process with --expose-gc.",
    );
  }
  globalThis.gc();
}
