/**
 * Pure, DOM-free decimation-invalidation adapters. They keep every `SpectrumDataPayload`
 * mutation and every `DecimationPort` buffer copy inside `@trace-kit/core`, so the renderer-side
 * viewport controller only ever talks to callback interfaces.
 *
 * - `createStreamingInvalidationAdapter` bridges a viewport change to the incremental
 *   `RawSampleRing` + `BucketAccumulator` pipeline: a non-mutating Tier-3 bounding projection
 *   while a gesture is live, and the mandatory Tier-1/Tier-2 settled re-decimation afterwards.
 * - `createWindowDecimationAdapter` bridges a viewport change to a `DecimationPort`: it slices
 *   the visible window out of a full-resolution source payload in f64 absolute X and submits it
 *   with latest-wins superseding and stale-settlement rejection.
 *
 * Steady-state `invalidate`/`request`/`poll` calls allocate nothing: the tier-selection request,
 * sample span, window options and settlement sink are created once at construction, and pending
 * work lives in scalar fields rather than a queue.
 */
import type { SpectrumDataPayload } from "../payload/spectrum-data-payload.js";
import {
  createSampleSpan,
  resolveSampleWindow,
  type SampleSpan,
  type SampleWindowOptions,
} from "../viewport/window.js";
import type { TransportStatsView } from "./backpressure.js";
import {
  DecimationKind,
  type DecimationPort,
  type SettlementSink,
} from "./decimation-port.js";
import {
  materializeBucketsToPayload,
  materializeTier3ToPayload,
} from "./materialize.js";
import { SATURATED, type Lease } from "./ownership.js";
import {
  MAX_BUCKETS,
  applyDomainChange,
  projectTier3,
  type BucketAccumulator,
  type RawSampleRing,
  type Tier3ProjectionTarget,
} from "./streaming-contract.js";

/** `"gesture"` is the live, non-mutating preview; `"settled"` is the committed re-decimation. */
export type InvalidationPhase = "gesture" | "settled";

export interface StreamingInvalidationAdapterOptions {
  readonly ring: RawSampleRing;
  readonly accumulator: BucketAccumulator;
  readonly tier3Target: Tier3ProjectionTarget;
  readonly payload: SpectrumDataPayload;
  /** f64 origin of the ring/accumulator X space. Default: `payload.xOrigin`. */
  readonly ringXOrigin?: number;
  /** Tier-3 output resolution. Default: `accumulator.bucketCount`. */
  readonly targetBucketCount?: number;
  readonly stats?: TransportStatsView;
}

export interface StreamingInvalidationAdapter {
  /** `0` before the first successful invalidation, otherwise the tier that served it. */
  readonly lastTier: 0 | 1 | 2 | 3;
  readonly lastVertexCount: number;
  /**
   * Re-decimates the absolute physical X window `[xMin, xMax]` into the payload and returns the
   * emitted vertex count, or `0` (touching nothing) on a non-finite or non-positive span.
   */
  invalidate(phase: InvalidationPhase, xMin: number, xMax: number): number;
}

/** Mutable twin of `TierSelectionRequest`, allocated once and rewritten per settled call. */
interface MutableTierSelectionRequest {
  requestedDomainMin: number;
  requestedInvBucketWidth: number;
  inGesture: boolean;
}

export function createStreamingInvalidationAdapter(
  options: StreamingInvalidationAdapterOptions,
): StreamingInvalidationAdapter {
  const { ring, accumulator, tier3Target, payload, stats } = options;

  const effectiveOrigin = options.ringXOrigin ?? payload.xOrigin;
  if (!Number.isFinite(effectiveOrigin)) {
    throw new RangeError(`ringXOrigin must be finite; received ${effectiveOrigin}.`);
  }
  const targetBucketCount = options.targetBucketCount ?? accumulator.bucketCount;
  if (
    !Number.isInteger(targetBucketCount) ||
    targetBucketCount < 1 ||
    targetBucketCount > MAX_BUCKETS
  ) {
    throw new RangeError(
      `targetBucketCount must be an integer in [1, ${MAX_BUCKETS}]; received ${targetBucketCount}.`,
    );
  }
  if (
    tier3Target.min.length < targetBucketCount ||
    tier3Target.max.length < targetBucketCount ||
    tier3Target.count.length < targetBucketCount
  ) {
    throw new RangeError(
      `tier3Target buffers must have length >= ${targetBucketCount}.`,
    );
  }
  const largestBucketCount =
    targetBucketCount > accumulator.bucketCount ? targetBucketCount : accumulator.bucketCount;
  const requiredCapacity = largestBucketCount * 2;
  if (payload.capacity < requiredCapacity) {
    throw new RangeError(
      `payload.capacity (${payload.capacity}) must be >= max(targetBucketCount, accumulator.bucketCount) * 2 (${requiredCapacity}).`,
    );
  }

  const request: MutableTierSelectionRequest = {
    requestedDomainMin: 0,
    requestedInvBucketWidth: 0,
    inGesture: false,
  };
  let lastTier: 0 | 1 | 2 | 3 = 0;
  let lastVertexCount = 0;

  return {
    get lastTier(): 0 | 1 | 2 | 3 {
      return lastTier;
    },
    get lastVertexCount(): number {
      return lastVertexCount;
    },
    invalidate(phase: InvalidationPhase, xMin: number, xMax: number): number {
      const offsetMin = xMin - effectiveOrigin;
      const offsetMax = xMax - effectiveOrigin;
      const span = offsetMax - offsetMin;
      if (
        !(
          Number.isFinite(offsetMin) &&
          Number.isFinite(offsetMax) &&
          Number.isFinite(span) &&
          span > 0
        )
      ) {
        return 0;
      }

      if (phase === "gesture") {
        const invBucketWidth = targetBucketCount / span;
        if (!(Number.isFinite(invBucketWidth) && invBucketWidth > 0)) return 0;
        projectTier3(
          accumulator,
          offsetMin,
          invBucketWidth,
          targetBucketCount,
          tier3Target,
          ring,
        );
        const emitted = materializeTier3ToPayload(
          tier3Target,
          targetBucketCount,
          offsetMin,
          invBucketWidth,
          payload,
          effectiveOrigin,
        );
        lastTier = 3;
        lastVertexCount = emitted;
        return emitted;
      }

      const invBucketWidth = accumulator.bucketCount / span;
      if (!(Number.isFinite(invBucketWidth) && invBucketWidth > 0)) return 0;
      request.requestedDomainMin = offsetMin;
      request.requestedInvBucketWidth = invBucketWidth;
      request.inGesture = false;
      const result = applyDomainChange(accumulator, ring, request, stats);
      const emitted = materializeBucketsToPayload(accumulator, payload, effectiveOrigin);
      lastTier = result.tier;
      lastVertexCount = emitted;
      return emitted;
    },
  };
}

/** Invoked once per accepted (non-stale) settlement; the adapter releases `lease` afterwards. */
export type WindowDecimationAcceptedCallback = (
  lease: Lease<"settled">,
  outCount: number,
  seq: number,
) => void;

export interface WindowDecimationAdapterOptions {
  readonly sourcePayload: SpectrumDataPayload;
  readonly port: DecimationPort;
  readonly kind: DecimationKind;
  readonly bucketCount: number;
  /** Forwarded to `resolveSampleWindow`. Default: `true`. */
  readonly includeNeighbours?: boolean;
}

export interface WindowDecimationAdapter {
  readonly latestRequestedSeq: number;
  readonly activeSeq: number;
  readonly inFlight: boolean;
  readonly hasPending: boolean;
  readonly droppedStaleCount: number;
  /** Samples copied into the transit slot by the most recent submission attempt. */
  readonly lastWindowSampleCount: number;
  readonly disposed: boolean;
  /**
   * Requests decimation of the absolute X window `[xMin, xMax]`. Returns `true` iff the window was
   * submitted to the port immediately; `false` when it was stashed as the pending window,
   * rejected as invalid, or skipped because the window holds too few samples for the kernel.
   */
  request(xMin: number, xMax: number, seq: number): boolean;
  /** Drains settlements, invoking `onAccepted` for the non-stale one. Returns the drained count. */
  poll(onAccepted: WindowDecimationAcceptedCallback): number;
  /** Idempotent. Clears the pending slot and blocks further requests. */
  dispose(): void;
}

export function createWindowDecimationAdapter(
  options: WindowDecimationAdapterOptions,
): WindowDecimationAdapter {
  const { sourcePayload, port, kind, bucketCount } = options;
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    throw new RangeError(`bucketCount must be an integer >= 1; received ${bucketCount}.`);
  }
  if (kind === DecimationKind.Lttb && bucketCount < 2) {
    throw new RangeError(
      `bucketCount must be >= 2 for DecimationKind.Lttb; received ${bucketCount}.`,
    );
  }

  const span: SampleSpan = createSampleSpan();
  const windowOptions: SampleWindowOptions = {
    includeNeighbours: options.includeNeighbours ?? true,
  };
  // Smallest window the selected kernel accepts (`lttb` needs >= 2 samples).
  const minWindowSamples = kind === DecimationKind.Lttb ? 2 : 1;

  let pendingXMin = 0;
  let pendingXMax = 0;
  let pendingSeq = 0;
  let hasPending = false;

  let latestRequestedSeq = 0;
  let activeSeq = 0;
  let inFlight = false;
  let droppedStaleCount = 0;
  let lastWindowSampleCount = 0;
  let disposed = false;

  let currentOnAccepted: WindowDecimationAcceptedCallback | null = null;

  function stashPending(xMin: number, xMax: number, seq: number): void {
    pendingXMin = xMin;
    pendingXMax = xMax;
    pendingSeq = seq;
    hasPending = true;
  }

  function submitWindow(xMin: number, xMax: number, seq: number): boolean {
    // Any newer direct submission (including one that skips due to insufficient samples)
    // unconditionally supersedes an earlier SATURATED-stashed pending slot.
    hasPending = false;
    const acquired = port.acquire();
    if (acquired === SATURATED) {
      stashPending(xMin, xMax, seq);
      return false;
    }

    resolveSampleWindow(sourcePayload, xMin, xMax, span, windowOptions);
    const spanLength = span.end - span.start;
    const copyCount =
      spanLength <= port.transitCapacitySamples ? spanLength : port.transitCapacitySamples;
    lastWindowSampleCount = copyCount;

    // Deep-zoom kernel guard: an empty or single-sample window cannot be decimated by `lttb`
    // (and an empty one cannot be bucketed at all), and the bucket count may never exceed the
    // sample count. Release the lease instead of letting a kernel throw `RangeError`.
    if (copyCount < minWindowSamples) {
      port.release(acquired);
      return false;
    }
    const effectiveBuckets = bucketCount <= copyCount ? bucketCount : copyCount;

    const srcX = sourcePayload.x;
    const srcY = sourcePayload.y;
    const dstX = port.viewX(acquired);
    const dstY = port.viewY(acquired);
    const base = span.start;
    for (let i = 0; i < copyCount; i += 1) {
      dstX[i] = srcX[base + i]!;
      dstY[i] = srcY[base + i]!;
    }

    port.setKind(acquired, kind);
    port.setSampleCount(acquired, copyCount);
    port.setBucketCount(acquired, effectiveBuckets);
    port.setDomain(acquired, xMin - sourcePayload.xOrigin, xMax - sourcePayload.xOrigin);

    const submitted = port.submit(acquired);
    if (submitted === SATURATED) {
      port.release(acquired);
      stashPending(xMin, xMax, seq);
      return false;
    }
    inFlight = true;
    activeSeq = seq;
    return true;
  }

  function submitPending(): void {
    const nextXMin = pendingXMin;
    const nextXMax = pendingXMax;
    const nextSeq = pendingSeq;
    hasPending = false;
    submitWindow(nextXMin, nextXMax, nextSeq);
  }

  const sink: SettlementSink = {
    onSettled(lease: Lease<"settled">, outCount: number): void {
      const settledSeq = activeSeq;
      inFlight = false;
      try {
        if (!disposed) {
          if (settledSeq < latestRequestedSeq) {
            droppedStaleCount += 1;
          } else if (currentOnAccepted !== null) {
            currentOnAccepted(lease, outCount, settledSeq);
          }
        }
      } finally {
        // The lease is returned to the pool even when the consumer callback throws.
        port.release(lease);
      }
      if (!disposed && hasPending) {
        submitPending();
      }
    },
  };

  return {
    get latestRequestedSeq(): number {
      return latestRequestedSeq;
    },
    get activeSeq(): number {
      return activeSeq;
    },
    get inFlight(): boolean {
      return inFlight;
    },
    get hasPending(): boolean {
      return hasPending;
    },
    get droppedStaleCount(): number {
      return droppedStaleCount;
    },
    get lastWindowSampleCount(): number {
      return lastWindowSampleCount;
    },
    get disposed(): boolean {
      return disposed;
    },

    request(xMin: number, xMax: number, seq: number): boolean {
      if (disposed || !Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
        return false;
      }
      latestRequestedSeq = seq;
      if (inFlight) {
        stashPending(xMin, xMax, seq);
        return false;
      }
      return submitWindow(xMin, xMax, seq);
    },

    poll(onAccepted: WindowDecimationAcceptedCallback): number {
      currentOnAccepted = onAccepted;
      let drained = 0;
      try {
        drained = port.poll(sink);
      } finally {
        currentOnAccepted = null;
      }
      // A window stashed while the port was saturated has no settlement to wake it; retry here.
      if (!disposed && hasPending && !inFlight) {
        submitPending();
      }
      return drained;
    },

    dispose(): void {
      disposed = true;
      hasPending = false;
    },
  };
}
