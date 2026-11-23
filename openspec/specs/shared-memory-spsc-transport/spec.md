# Capability: shared-memory-spsc-transport

## Requirements

### Requirement: Cache-Line-Separated Control Block and Persistent Data SharedArrayBuffers
When `BufferBacking.Shared` is selected, `createWorkerDecimationPort` MUST allocate one 64-byte
cache-line-separated control `SharedArrayBuffer` (`704` bytes, holding immutable layout headers,
host/worker atomic cursors, `shutdownFlag`, 16-entry SPSC request/response rings, and per-slot
`Int32`/`Float64` parameter tables) and one contiguous 64-byte-aligned data `SharedArrayBuffer`
backing all slot views (`x`, `y`, `out`, `indices`) once at port construction (and re-mint them
only on responder failure). A single one-time initialization message (`init-sab`) MUST hand the
control and data `SharedArrayBuffer` references to the worker so the worker binds its persistent
typed-array views once before entering its processing loop.

#### Scenario: Shared backing sends only one postMessage during initialization
- **GIVEN**: a `createWorkerDecimationPort` operating with `BufferBacking.Shared` over an
  instrumented `WorkerLike` wrapping a real thread
- **WHEN**: 500 `acquire` -> `submit` -> `poll` -> `release` round trips execute after startup
- **THEN**: `worker.postMessage` was called exactly once (for `init-sab`) and `0` times across all
  500 steady-state submissions and settlements

### Requirement: Zero-Detachment, Zero-Re-Mint Hot Path
In `BufferBacking.Shared` mode, `submit(lease)` MUST publish slot parameters and the packed lease
into the control SPSC request ring via `Atomics.store` + `Atomics.notify` without detaching any
buffer or calling `postMessage`. `poll(sink)` MUST drain completed `(lease, outCount)` entries from
the SPSC response ring via `Atomics.load`/`Atomics.store` without re-minting any typed-array view,
and MUST route worker-reported kernel error entries (`outCount === -1`) to the unified
`FailureReason.WorkerError` failure path. Slot view identities (`viewX`, `viewY`, `viewOut`,
`viewIndices`) MUST remain strictly identical (`===`) across steady-state round trips.

#### Scenario: Slot view identities and byteLengths remain invariant across Shared round trips
- **GIVEN**: a `createWorkerDecimationPort` in `BufferBacking.Shared` mode
- **WHEN**: the typed-array references from `viewX`, `viewY`, `viewOut`, and `viewIndices` for slot
  `0` are captured before `submit`, checked immediately after `submit`, and compared again after
  `poll` and `release` across 100 consecutive cycles
- **THEN**: every view retains its full `byteLength` throughout, every post-settlement view is
  strictly reference-identical (`===`) to the view allocated at construction, and view re-mint
  count is exactly `0`

#### Scenario: Shared backing produces bit-exact decimation parity with sync and Transfer
- **GIVEN**: deterministic Lorentzian and gap-containing waveforms processed through
  `createSyncDecimationPort`, `createWorkerDecimationPort` (`Transfer`), and
  `createWorkerDecimationPort` (`Shared`)
- **WHEN**: `MinMaxEnvelope`, `Lttb`, and `MinMaxEnvelopeIndices` requests complete on all three
- **THEN**: the settled output values and `outCount` are bit-for-bit identical across all three

### Requirement: Main Thread Never Blocks on `Atomics.wait`
The main-thread side of `BufferBacking.Shared` MUST NEVER call `Atomics.wait` anywhere in
`acquire`, `submit`, `poll`, `release`, `readStats`, or `dispose`. All main-thread synchronization
MUST use non-blocking `Atomics.load`, `Atomics.store`, and `Atomics.notify`.

#### Scenario: Shared port never invokes Atomics.wait on the main thread
- **GIVEN**: a spy installed on `Atomics.wait` on the calling thread
- **WHEN**: a `BufferBacking.Shared` port is constructed, driven through 200 round trips including
  saturation and empty `poll()` calls, and disposed
- **THEN**: `Atomics.wait` on the calling thread records exactly `0` calls

### Requirement: Bounded Worker Wait and Non-Hanging Shutdown
The worker-side `Shared` loop MUST use a bounded `Atomics.wait` timeout (`50 ms`, never `Infinity`)
and MUST inspect `shutdownFlag` both before and after waiting so a lost wakeup can never wedge the
worker thread. On `dispose()`, the main thread MUST execute `Atomics.store(ctrl, CTRL_SHUTDOWN, 1)`
and `Atomics.notify` on `CTRL_REQ_HEAD` before calling `worker.terminate()`, guaranteeing clean
non-hanging teardown in both Chromium Web Workers and Node `worker_threads`.

#### Scenario: Dispose exits cleanly without hanging in Node worker_threads and Chromium
- **GIVEN**: an idle `BufferBacking.Shared` port whose worker is blocked inside `Atomics.wait`
- **WHEN**: `port.dispose()` is called
- **THEN**: the worker exits cleanly, `dispose()` completes without hanging or leaking open
  handles, and the test process exits cleanly within the standard timeout

### Requirement: Full SharedArrayBuffer Re-Mint and Cross-Epoch Slot Safety on Responder Failure
When a responder error or lazy deadline timeout occurs in `BufferBacking.Shared` mode, the port
MUST signal shutdown and terminate the old worker immediately and, if
`remintEventCount < maxRemintEvents`, MUST allocate brand-new control and slot data
`SharedArrayBuffer` instances before transitioning failed slots back to `Free`. A newly spawned
replacement worker MUST NEVER share a `SharedArrayBuffer` backing with a previously failed or
timed-out worker. Any sibling slot currently held by the caller in `Acquired` or `Settled` state
from a previous SAB epoch MUST remain readable without corruption and MUST be migrated/rebound
cleanly onto the new `dataSab` on its next `submit()` (copying the valid `sampleCount` prefix) or
`release()`.

#### Scenario: Failure recovery replaces control and data SharedArrayBuffers before respawn
- **GIVEN**: a `BufferBacking.Shared` port whose worker hangs past `leaseTimeoutMs` while slot `0`
  is `InFlight` and sibling slot `1` is `Acquired` with caller-written samples
- **WHEN**: the lazy deadline sweep triggers recovery, slot `1` is subsequently submitted, and both
  slots execute on the respawned worker
- **THEN**: the old worker is terminated, the replacement slot views are backed by new
  `SharedArrayBuffer` instances (`newView.buffer !== oldView.buffer`), and both slot `1` and the
  recovered slot `0` settle accurately with the new generation

### Requirement: Defensive Fallback to Transfer on `init-sab` Clone Error
If posting the one-time `init-sab` message throws a `DataCloneError` (or any structured-clone error
rejecting `SharedArrayBuffer` transfer across realms), `createWorkerDecimationPort` MUST catch the
error cleanly, switch its internal backing to `BufferBacking.Transfer`, allocate plain
`ArrayBuffer`-backed slots, and proceed normally without throwing out of construction or failing
subsequent submissions.

#### Scenario: DataCloneError during init-sab falls back to Transfer seamlessly
- **GIVEN**: a `WorkerLike` whose `postMessage` throws a `DataCloneError` when given a message
  containing a `SharedArrayBuffer`, and accepts plain `ArrayBuffer` transfers normally
- **WHEN**: `createWorkerDecimationPort` is constructed with `Shared` initially selected and driven
  through a round trip
- **THEN**: construction does not throw, the port's internal backing becomes
  `BufferBacking.Transfer`, and the round trip settles cleanly over transferable `ArrayBuffer`s
