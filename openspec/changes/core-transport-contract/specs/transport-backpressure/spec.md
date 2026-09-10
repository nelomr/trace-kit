# Capability: transport-backpressure

> Change: `core-transport-contract`. New capability. Encodes design.md §D2, §D3.

## ADDED Requirements

### Requirement: Saturation Drops the Chunk and Counts, Never Allocates
When no pool pair is free, `acquire()` MUST return `SATURATED` (`-1`), the ingest path MUST drop
the incoming chunk, and a telemetry counter MUST increment — all without allocating any object.
Counters MUST be held in preallocated typed arrays (`Int32Array` counters, `Float64Array`
gauges).

#### Scenario: A dropped chunk increments the counter with no allocation
- **GIVEN**: a pool with all `poolPairs` slots currently `Acquired` or `InFlight`
- **WHEN**: a new chunk arrives and `acquire()` is called
- **THEN**: `acquire()` returns `SATURATED`, `stats.counters[StatCounter.ChunksDropped]`
  increments by exactly `1`, and a `PerformanceObserver` GC-event count over the call is `0`

#### Scenario: Stats are surfaced via a caller-owned view, never a returned object
- **GIVEN**: a caller-owned `TransportStatsView` passed to `readStats`
- **WHEN**: `port.readStats(view)` is called repeatedly (once per frame)
- **THEN**: no new object is returned or constructed by `readStats`; the same `view` instance is
  reused and its typed-array contents are updated via `set()`

### Requirement: Healthy-Dropping Versus Pathological-Stall Discrimination
The system MUST distinguish healthy steady-state dropping (`ChunksAccepted` strictly increasing
and `ConsecutiveDrops <= poolPairs`) from a pathological stall (`ConsecutiveDrops >=
stallDropThreshold`, default `120`, while `ChunksAccepted` has not moved), and MUST expose this
as a `Health` state (`Ready`, `Saturated`, `Stalled`, `Recovering`, `Degraded`). The distinction
MUST be a deterministic work count, never a wall-clock threshold.

#### Scenario: A healthy producer-faster-than-responder pattern does not report Stalled
- **GIVEN**: a responder that keeps up overall but the producer is faster, causing periodic
  drops with `ConsecutiveDrops` never exceeding `poolPairs`
- **WHEN**: stats are read over the run
- **THEN**: `Health` never reports `Stalled`, and `ChunksAccepted` is observed to strictly
  increase between reads

#### Scenario: An injected 10-frame stall does not trip the Stalled state
- **GIVEN**: a responder frozen for exactly 10 consecutive frames, then resumed
- **WHEN**: stats are read during and after the freeze
- **THEN**: `ChunksDropped` increases by exactly `10`, allocation count is unchanged, and
  `Health` never becomes `Stalled` (10 < 120)

#### Scenario: An injected 200-frame stall trips Stalled and clears on next accept
- **GIVEN**: a responder frozen for 200 consecutive frames
- **WHEN**: stats are read during the freeze and then after the responder accepts one chunk
- **THEN**: during the freeze `Health === Stalled`, and after the next accepted chunk `Health`
  returns to a non-`Stalled` value

### Requirement: Deterministic Stats Contract Backed by Preallocated Typed Arrays
`TransportStatsView` MUST expose `counters: Int32Array` and `gauges: Float64Array` of fixed,
documented length, indexed by the `StatCounter` and `StatGauge` enums, so every increment is a
typed-array store rather than an object mutation.

#### Scenario: Reading stats does not allocate
- **GIVEN**: a caller-owned `TransportStatsView` reused across 1,000 frames
- **WHEN**: `readStats` is called once per frame for 1,000 frames under `--expose-gc`
- **THEN**: the observed GC event count over those calls is `0`
