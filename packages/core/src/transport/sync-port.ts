/**
 * `createSyncDecimationPort` — the synchronous in-thread default `DecimationPort`. Runs
 * `minMaxEnvelope`/`lttb` inline on the calling thread, and does NOT short-circuit the state
 * machine: `submit` moves the slot to `InFlight`, performs the work, moves it to `Settled`, and
 * pushes the lease into the pool's own preallocated settlement ring drained by `poll`. Zero
 * browser globals, trivially Node- and SSR-safe.
 */
import { lttb } from "../decimation/lttb.js";
import { minMaxEnvelope } from "../decimation/min-max.js";
import type { TransportStatsView } from "./backpressure.js";
import { type BufferPool, type BufferPoolConfig, createBufferPool } from "./buffer-pool.js";
import {
  DecimationKind,
  type DecimationPort,
  type FailureReason,
  PortMode,
  type SettlementSink,
} from "./decimation-port.js";
import { SATURATED, type Lease, type Saturated } from "./ownership.js";

export type SyncDecimationPortConfig = BufferPoolConfig;

export function createSyncDecimationPort(
  config: SyncDecimationPortConfig = {},
): DecimationPort {
  const pool: BufferPool = createBufferPool(config);

  const requestKind = new Int32Array(pool.poolPairs);
  const requestSampleCount = new Int32Array(pool.poolPairs);
  const requestBucketCount = new Int32Array(pool.poolPairs);
  const requestDomainMin = new Float64Array(pool.poolPairs);
  const requestDomainMax = new Float64Array(pool.poolPairs);

  function slotOf(lease: number): number {
    return lease & 0b111;
  }

  const port: DecimationPort = {
    mode: PortMode.Synchronous,
    poolPairs: pool.poolPairs,
    transitCapacitySamples: pool.transitCapacitySamples,

    setKind(lease, kind) {
      requestKind[slotOf(lease)] = kind;
    },
    setSampleCount(lease, count) {
      requestSampleCount[slotOf(lease)] = count;
    },
    setBucketCount(lease, buckets) {
      requestBucketCount[slotOf(lease)] = buckets;
    },
    setDomain(lease, min, max) {
      requestDomainMin[slotOf(lease)] = min;
      requestDomainMax[slotOf(lease)] = max;
    },

    acquire(): Lease<"acquired"> | Saturated {
      return pool.acquire();
    },

    viewX(lease) {
      return pool.viewX(lease);
    },
    viewY(lease) {
      return pool.viewY(lease);
    },
    viewOut(lease) {
      return pool.viewOut(lease);
    },
    viewIndices(lease) {
      return pool.viewIndices(lease);
    },

    submit(lease: Lease<"acquired">): Lease<"inflight"> | Saturated {
      const slot = slotOf(lease);
      const kind = requestKind[slot] as DecimationKind;
      const sampleCount = requestSampleCount[slot] ?? 0;
      const bucketCount = requestBucketCount[slot] ?? 0;

      // The port's own views must be captured while the lease is still in the readable
      // `Acquired` phase — the accessor rejects `InFlight` from every caller, including this
      // in-thread responder. A real (change 8) worker responder instead receives the
      // transferred buffers directly in its own realm; the synchronous port simulates that by
      // reading its slot-resident storage before handing the (never-actually-detaching) lease
      // to `pool.submit`.
      const x = pool.viewX(lease);
      const y = pool.viewY(lease);
      const out = pool.viewOut(lease);
      const indices = pool.viewIndices(lease);

      const inflight = pool.submit(lease);
      if (inflight === SATURATED) return SATURATED;

      let outCount = 0;
      if (kind === DecimationKind.Lttb) {
        outCount = lttb(x, y, 0, sampleCount, indices, 0, bucketCount);
      } else {
        outCount = minMaxEnvelope(y, 0, sampleCount, out, 0, bucketCount);
      }

      pool.settle(inflight, outCount);
      return inflight;
    },

    poll(sink: SettlementSink): number {
      return pool.poll(sink);
    },

    release(lease) {
      pool.release(lease);
    },

    reportResponderFailure(reason: FailureReason) {
      pool.reportResponderFailure(reason);
    },
    noteDroppedSamples(count: number) {
      pool.noteDroppedSamples(count);
    },
    readStats(out: TransportStatsView) {
      pool.readStats(out);
    },
    dispose() {
      pool.dispose();
    },
  };

  return port;
}
