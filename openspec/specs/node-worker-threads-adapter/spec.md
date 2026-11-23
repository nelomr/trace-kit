# Capability: node-worker-threads-adapter

## Requirements

### Requirement: Node `worker_threads` Host and Worker Adapters
`@trace-kit/core/node` MUST export `adaptNodeWorker`, `createNodeWorkerFactory`,
`createNodeParentPortEndpoint`, and `attachNodeDecimationWorker`:
- `adaptNodeWorker(nodeWorker)` MUST adapt a `node:worker_threads` `Worker` instance to
  `WorkerLike`, translating EventEmitter `"message"`, `"error"`, and `"messageerror"` events into
  the `WorkerLike` listener interface (reusing a single mutable event shell per adapter so steady
  state avoids per-message wrapper allocations), forwarding unexpected non-zero `"exit"` events
  (when not terminated by the host) to `"error"` listeners so fatal worker exits always trigger
  recovery, forwarding `postMessage(msg, transfer)` (supporting both transferable `ArrayBuffer`
  lists and `SharedArrayBuffer` payloads), and mapping `terminate()` to terminate the underlying
  worker thread.
- `createNodeWorkerFactory(filename, options?)` MUST return a `WorkerFactory` that constructs a
  fresh `node:worker_threads` `Worker` on each invocation and wraps it with `adaptNodeWorker`.
- `createNodeParentPortEndpoint(port)` MUST adapt a `node:worker_threads` `MessagePort`
  (`parentPort`) to `WorkerMessageEndpoint`.
- `attachNodeDecimationWorker(port)` MUST attach the pure decimation worker handler to `port` via
  `createNodeParentPortEndpoint(port)` and return a detach callback that removes the registered
  listener.

#### Scenario: Real Node worker_threads executes Transfer and Shared round trips
- **GIVEN**: a `createWorkerDecimationPort` configured with `createNodeWorkerFactory` pointing at a
  worker module calling `attachNodeDecimationWorker(parentPort)`
- **WHEN**: round trips for `MinMaxEnvelope`, `Lttb`, and `MinMaxEnvelopeIndices` execute in both
  `Transfer` and `Shared` backings, followed by `dispose()`
- **THEN**: every settled output matches `createSyncDecimationPort` bit-for-bit, `terminate()`
  shuts down the thread cleanly, and no dangling handle keeps the Node process open

#### Scenario: Uncaught worker throw or unexpected non-zero exit triggers recovery
- **GIVEN**: a real `node:worker_threads` worker script that throws an uncaught error (or exits
  with non-zero status) on a sentinel request
- **WHEN**: `createWorkerDecimationPort` submits that request and then acquires a subsequent lease
- **THEN**: the adapter forwards the error event to the port's failure handler, `ResponderFailures`
  increments by `1`, the crashed thread is terminated, and the respawned thread settles the next
  request cleanly

### Requirement: Strict Bundle Isolation From Browser and Root Subpaths
`@trace-kit/core/node` MUST be the only subpath in `@trace-kit/core` that imports
`node:worker_threads`. Neither `@trace-kit/core` (root `.`) nor `@trace-kit/core/worker` may import
or reference `node:worker_threads` or any other `node:*` builtin, and importing
`@trace-kit/core/node` MUST perform zero top-level side effects (no worker spawning at import time).

#### Scenario: Root and worker bundles contain zero node:worker_threads references
- **GIVEN**: the built `packages/core/dist/` ESM and CJS outputs for `.` and `./worker`
- **WHEN**: a build-output inspection test scans those files for `worker_threads` and `node:`
- **THEN**: zero matches are found in `.` and `./worker`, while `./node` declares
  `node:worker_threads` as an external import and resolves cleanly in both ESM and CJS under Node
