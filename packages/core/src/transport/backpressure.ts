/**
 * Transport stats contract: a fixed-shape block of counters and gauges backed by preallocated
 * typed arrays, so every increment and every read is a typed-array store/load and never an
 * object allocation. `TransportHealth` is a pure, ordered function of pool state — never a
 * wall-clock gate — recomputed on every `acquire()` and every `poll()`.
 */

/** Exported so a caller can preallocate its own view. Equals `StatCounter`'s member count. */
export const TRANSPORT_STAT_COUNT_I32 = 14;
/** Exported so a caller can preallocate its own view. Equals `StatGauge`'s member count. */
export const TRANSPORT_STAT_COUNT_F64 = 3;

export const enum StatCounter {
  ChunksAccepted = 0,
  ChunksDropped = 1,
  ConsecutiveDrops = 2, // reset to 0 on every accept
  MaxConsecutiveDrops = 3, // high-water mark, never reset
  SamplesDropped = 4,
  LeasesOutstanding = 5,
  PoolExhaustionEvents = 6, // transitions into the saturated condition
  StaleSettlements = 7,
  OwnershipViolations = 8,
  RemintEvents = 9,
  ResponderFailures = 10,
  DomainRebuilds = 11,
  DomainShifts = 12,
  Health = 13,
}

export const enum StatGauge {
  LastAcceptMs = 0,
  LastSubmitMs = 1,
  OldestInFlightMs = 2,
}

export const enum TransportHealth {
  Ready = 0,
  Saturated = 1, // dropping, but still accepting
  Stalled = 2, // no accept for stallDropThreshold consecutive drops
  Recovering = 3,
  Degraded = 4, // re-mint cap reached; terminal
}

/** A fixed-shape stats block. `counters`/`gauges` are long-lived and returned by reference. */
export interface TransportStatsView {
  /** `Int32Array`, length = `TRANSPORT_STAT_COUNT_I32`. */
  readonly counters: Int32Array;
  /** `Float64Array`, length = `TRANSPORT_STAT_COUNT_F64`. */
  readonly gauges: Float64Array;
}

/** Allocates a fresh, zeroed stats view. Callers own the returned view for the pool's lifetime. */
export function createTransportStatsView(): TransportStatsView {
  return {
    counters: new Int32Array(TRANSPORT_STAT_COUNT_I32),
    gauges: new Float64Array(TRANSPORT_STAT_COUNT_F64),
  };
}

/**
 * Copies `source` into caller-owned `out` in place via `.set()`. Returns nothing so a caller
 * cannot mistake this for a factory. Throws (construction-time-shaped, not hot-path) if `out`
 * is undersized — a misconfigured caller should fail loudly rather than silently truncate.
 */
export function readStatsInto(
  source: TransportStatsView,
  out: TransportStatsView,
): void {
  if (
    out.counters.length < TRANSPORT_STAT_COUNT_I32 ||
    out.gauges.length < TRANSPORT_STAT_COUNT_F64
  ) {
    throw new RangeError(
      `readStats: out view is undersized (counters=${out.counters.length}, ` +
        `gauges=${out.gauges.length}); need at least ${TRANSPORT_STAT_COUNT_I32} and ` +
        `${TRANSPORT_STAT_COUNT_F64}.`,
    );
  }
  out.counters.set(source.counters);
  out.gauges.set(source.gauges);
}

/**
 * `Health` is a pure, ordered, first-match function of pool state. No clause reads a clock;
 * every condition is a deterministic work count or a slot census.
 */
export function deriveHealth(state: {
  remintCapReached: boolean;
  hasLostSlot: boolean;
  consecutiveDrops: number;
  stallDropThreshold: number;
}): TransportHealth {
  if (state.remintCapReached) {
    return TransportHealth.Degraded;
  }
  if (state.hasLostSlot) {
    return TransportHealth.Recovering;
  }
  if (state.consecutiveDrops >= state.stallDropThreshold) {
    return TransportHealth.Stalled;
  }
  if (state.consecutiveDrops > 0) {
    return TransportHealth.Saturated;
  }
  return TransportHealth.Ready;
}
