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
- **THEN**: `acquire()` returns `SATURATED` (`-1`) and
  `stats.counters[StatCounter.ChunksDropped]` increments by exactly `1`

#### Scenario: Sustained dropping allocates nothing
- **GIVEN**: a saturated pool driven through 10,000 consecutive rejected `acquire()` calls under
  `--expose-gc`, after warm-up
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events over the measured window
- **THEN**: the observed count is `0`, and `stats.counters[StatCounter.ChunksDropped]` has
  increased by exactly `10_000`

#### Scenario: An allocating control proves the sustained-dropping gate is live
- **GIVEN**: a variant of the same saturated-drop path, in the same test run, that allocates one
  object per rejected `acquire()` call over the identical `10_000` iterations
- **WHEN**: the same `PerformanceObserver` instrumentation measures it
- **THEN**: the control's observed GC event count is greater than `0` while the real path's is
  `0` in the same run, so the `0` above is a discrimination and not a measurement that would
  also be produced by instrumentation that never fired

#### Scenario: Saturation never queues into a fresh allocation
- **GIVEN**: a saturated pool and an incoming chunk
- **WHEN**: the ingest path handles the saturation
- **THEN**: the chunk is discarded rather than buffered, and the port exposes no growable queue,
  pending-chunk list, or overflow buffer in its type surface or its internal state

#### Scenario: Stats are surfaced via a caller-owned view, never a returned object
- **GIVEN**: a caller-owned `TransportStatsView` passed to `readStats`
- **WHEN**: `port.readStats(view)` is called repeatedly (once per frame) and, on each call, the
  return value and the identities of `view.counters` and `view.gauges` are recorded
- **THEN**: `readStats` returns `undefined` on every call, and `view.counters` and `view.gauges`
  are reference-identical (`===`) to the instances captured before the first call, so the view
  was written in place rather than replaced
- **AND**: the recorded counter values change across calls, proving the in-place write actually
  occurred and the identity check is not passing over an inert view

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
  equals exactly `Ready` — not merely some value other than `Stalled` — because an accepted
  `acquire` resets `ConsecutiveDrops` to `0` and no slot is `Lost`

### Requirement: `Health` Is a Total, Ordered Function of Port State
`Health` MUST be derived by evaluating these conditions in order, first match winning, recomputed
on every `acquire` and every `poll`: `Degraded` when the re-mint cap has been reached or
`dispose()` has been called (terminal, never left); else `Recovering` when at least one slot is
`Lost`; else `Stalled` when `ConsecutiveDrops >= stallDropThreshold`; else `Saturated` when
`ConsecutiveDrops > 0`; else `Ready`. No clause may read a clock. Counter ownership MUST be fixed
the same way: `acquire()` owns `ChunksAccepted`, `ChunksDropped`, `ConsecutiveDrops` (reset to `0`
on every successful acquire), `MaxConsecutiveDrops`, and `PoolExhaustionEvents` — the last
incremented only on the `0 -> 1` transition of `ConsecutiveDrops`, so it counts entries into
saturation rather than dropped chunks. `SamplesDropped` MUST be written only by
`noteDroppedSamples(count)`, because `acquire()` does not know the size of the chunk that was
dropped.

#### Scenario: Every Health state is reachable and the ordering is observable
- **GIVEN**: one port driven through a scripted sequence: a clean accept; one drop; a run of
  `stallDropThreshold` drops; a drop taken while one slot is `Lost` from an injected failure; and
  finally `dispose()`
- **WHEN**: `Health` is read after each step
- **THEN**: the observed sequence is exactly `Ready`, `Saturated`, `Stalled`, `Recovering`,
  `Degraded`
- **AND**: the fourth reading is `Recovering` rather than `Stalled` even though
  `ConsecutiveDrops >= stallDropThreshold` still holds at that moment, which is the observable
  that proves the order is `Recovering` before `Stalled` rather than the two being independent

#### Scenario: PoolExhaustionEvents counts entries into saturation, not dropped chunks
- **GIVEN**: a saturated pool driven through `50` consecutive rejected `acquire()` calls, then one
  successful `acquire()`, then `50` more rejected calls
- **WHEN**: the counters are read
- **THEN**: `ChunksDropped` has increased by exactly `100` and `PoolExhaustionEvents` by exactly
  `2`
- **AND**: `MaxConsecutiveDrops` is exactly `50` while `ConsecutiveDrops` is exactly `50`, so the
  reset on the intervening accept is observed rather than assumed

#### Scenario: SamplesDropped moves only through noteDroppedSamples
- **GIVEN**: a saturated pool, and `10` rejected `acquire()` calls of which only the first `4` are
  followed by `noteDroppedSamples(1_000)`
- **WHEN**: the counters are read
- **THEN**: `SamplesDropped` is exactly `4_000` while `ChunksDropped` is exactly `10`, so
  `acquire()` is proven not to write `SamplesDropped` itself and `noteDroppedSamples` is proven to
  write it

### Requirement: Bounded Failure-Path Recovery Behind a Lazy Deadline Sweep
The failure path MUST be detected on two channels and swept lazily. `reportResponderFailure(reason)`
is the explicit channel, taking a numeric `FailureReason` so reporting allocates nothing. The
deadline channel MUST compare the oldest in-flight dispatch timestamp against `leaseTimeoutMs`
(default `1000`) inside `acquire()` and `poll()` only: no `setTimeout`, no `setInterval`, and no
timer handle may exist anywhere in the port, so nothing keeps an event loop alive after
`dispose()`. Timestamps MUST come from `globalThis.performance.now()` when available and
`Date.now()` otherwise, with that check inside a function body and never at module scope.

On detection every `InFlight` slot MUST move to `Lost`, be re-minted with fresh backing and views,
and have its `generation` incremented so a zombie reply for a pre-failure lease fails the
generation compare, is discarded, and increments `StaleSettlements`. Re-minting MUST be capped at
`maxRemintEvents` (default `8`); at the cap the lost slots MUST NOT be re-minted, `Health` MUST
become `Degraded` terminally, and `acquire()` MUST return `SATURATED` permanently.

#### Scenario: A hung responder that fires no event is recovered by the lazy sweep
- **GIVEN**: a lease submitted and never settled, with the port's time source advanced past
  `leaseTimeoutMs`, and no call to `reportResponderFailure`
- **WHEN**: `acquire()` is called
- **THEN**: the sweep moves the timed-out slot to `Lost` and back to `Free` via re-mint,
  `stats.counters[StatCounter.ResponderFailures]` increments by exactly `1` with
  `FailureReason.Timeout`, and the returned lease is usable
- **AND**: an identical port whose time source is advanced to exactly `leaseTimeoutMs - 1`
  performs no sweep in the same run — `ResponderFailures` stays exactly `0` — so the recovery
  above is attributable to the deadline and not to `acquire()` sweeping unconditionally

#### Scenario: No timer is ever created
- **GIVEN**: a test that replaces `globalThis.setTimeout` and `globalThis.setInterval` with
  counting stubs before the port is constructed
- **WHEN**: a full run including a timeout-triggered sweep and `dispose()` completes
- **THEN**: both stubs record exactly `0` calls
- **AND**: a control in the same run that schedules one `setTimeout` directly records exactly `1`,
  proving the stubs are installed and observing

#### Scenario: The re-mint cap is terminal
- **GIVEN**: `maxRemintEvents = 8` and a crash-looping responder driven through `9` injected
  failures
- **WHEN**: counters and health are read after each failure
- **THEN**: `RemintEvents` stops increasing at exactly `8 * poolPairs` and does not increase on the
  ninth failure, `Health` is `Degraded`, and every subsequent `acquire()` returns `SATURATED`
- **AND**: after the eighth failure and before the ninth, `Health` returned to `Ready` and
  `acquire()` returned a usable lease, so the terminal state is reached at the cap rather than at
  the first failure

### Requirement: Deterministic Stats Contract Backed by Preallocated Typed Arrays
`TransportStatsView` MUST expose `counters: Int32Array` and `gauges: Float64Array` of fixed,
documented length, indexed by the `StatCounter` and `StatGauge` enums, so every increment is a
typed-array store rather than an object mutation. Those lengths MUST be exported as
`TRANSPORT_STAT_COUNT_I32 = 14` and `TRANSPORT_STAT_COUNT_F64 = 3`, each equal to its enum's
member count, so a caller can preallocate a conforming view without guessing.

The primary assertion that `readStats` does not allocate MUST be the deterministic count of
objects `readStats` constructs per call, which MUST be exactly `0`. A GC-event count MUST NOT be
the primary assertion here: over a window as short as 1,000 calls it is a thresholded proxy that
reports `0` both when nothing is allocated and when a small amount is allocated without filling
the nursery, so it is retained only as subordinate corroboration.

#### Scenario: The declared view lengths match the enums
- **GIVEN**: the exported `TRANSPORT_STAT_COUNT_I32` and `TRANSPORT_STAT_COUNT_F64`, and a view
  the port itself accepts
- **WHEN**: the constants are read and a view is allocated from them
- **THEN**: they are exactly `14` and `3`, and `readStats` writes a value at index
  `StatCounter.Health` (`13`) and at index `StatGauge.OldestInFlightMs` (`2`) — so the lengths are
  proven to reach the last member of each enum rather than merely being asserted
- **AND**: a view allocated one element short in either array is rejected by `readStats` rather
  than written past or silently truncated

#### Scenario: readStats constructs exactly zero objects per call
- **GIVEN**: a caller-owned `TransportStatsView` reused across 1,000 frames, with an allocation
  counter instrumented on every object-constructing site reachable from `readStats`
- **WHEN**: `readStats` is called once per frame for 1,000 frames
- **THEN**: the instrumented construction count is exactly `0` across all 1,000 calls, asserted
  by exact equality with no tolerance

#### Scenario: An allocating control variant proves the readStats instrumentation is live
- **GIVEN**: a control variant of `readStats`, in the same test run, that constructs one object
  per call over the identical 1,000 calls
- **WHEN**: the same instrumentation measures it
- **THEN**: the control's construction count is exactly `1_000` and its observed GC event count
  is greater than `0`, while the real `readStats` reports `0` for both in the same run

#### Scenario: The GC-event count corroborates as a secondary measurement
- **GIVEN**: the same 1,000-frame run under `--expose-gc`
- **WHEN**: a `PerformanceObserver({ entryTypes: ['gc'] })` counts events over the measured window
- **THEN**: the observed count is `0`, recorded as corroboration subordinate to the
  construction-count assertion rather than as the determination itself
