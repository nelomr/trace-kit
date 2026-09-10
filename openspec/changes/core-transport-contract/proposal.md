# Proposal: core-transport-contract

> Change 3 of the 16-change decomposition in
> `openspec/changes/00-roadmap-decomposition/exploration.md` (§2 inventory, §3 graph).
> Hard prerequisite: **change 2 — `core-decimation-math`** (and transitively change 1).
>
> **This is the highest-risk change in the entire sixteen-change plan.** Exploration §4 ranks it
> Critical, and it is the only change in the plan whose deliverables include a de-risking
> prototype run before any consumer of the contract exists.

## Problem / Motivation

The input brief hands buffers to a worker with `postMessage(msg, [x.buffer, y.buffer])` and
never describes how ownership returns. Claim **C1** — CONFIRMED against a primary
specification-level source, and consistent across V8, SpiderMonkey and JSC because it is
standardised in the structured-clone transfer steps — establishes what actually happens:

> A transferred `ArrayBuffer` is **detached in the sending realm**. `byteLength` becomes `0` and
> reads or writes through pre-existing views fail. **No mechanism exists to un-detach in
> place**; returning ownership requires transferring the buffer back.

Traced over the brief's own 60 Hz streaming requirement (exploration §1.1), the brief's design
does not merely leak — it stops working on the second frame:

- **Frame 1:** the main thread transfers X and Y. It can no longer re-decimate, hit-test, read a
  tooltip value, export SVG, or rebuild a `Path2D`. Every one of those is a feature the brief
  demands elsewhere.
- The worker returns the decimated result; the source buffers stay in the worker, or are lost.
- **Frame 2:** the main thread has no source buffer left to send. Broken.

The failure also propagates silently into WebGL context restoration (exploration §1.4). On
`webglcontextlost` every GL object dies and restoration requires re-uploading all buffer content
**from CPU-side data**. If the CPU-side copy was transferred away, the chart stays permanently
blank after a restore, and the brief's own degradation criterion cannot be met.

This is why the change exists as a first-class unit that the brief never named, and why it sits
at position 3. Exploration §4 states the stakes precisely: the ownership protocol "fixes the
public API shape of `setData`/`pushStreamData`, gates GL context restore, and the
`SharedArrayBuffer` variant forces COOP/COEP, which excludes GitHub Pages and breaks StackBlitz
embeds. **Wrong choice is a breaking change across every package and documented example.**"
Thirteen changes sit behind it. It must be de-risked with a prototype **before any renderer
exists**, which is exactly what this change delivers.

The rejected alternative is recorded for the audit trail: `buffer.slice(0)` copy-on-send. At
4 MB per frame at 60 Hz that is 240 MB/s of garbage — a frontal violation of CLAUDE.md rule 2.

## Proposed Approach

Define the contract, ship the synchronous default implementation, and prove the protocol with a
prototype. No real `Worker` anywhere in this change.

1. **`DecimationPort` interface with a synchronous in-thread default.** The port is the seam.
   Its default implementation runs `minMaxEnvelope` and `lttb` from change 2 **synchronously on
   the calling thread**: zero browser globals, trivially Node- and SSR-safe, trivially
   tree-shakeable. Per exploration §1.9 the Node-isomorphism criterion is satisfied by this
   synchronous path, which is what lets `@trace-kit/core` stay isomorphic (CLAUDE.md rule 5)
   while an asynchronous transport exists at all.

2. **The pooled single-ownership round-trip protocol.** The main thread owns a pool of N X/Y
   buffer pairs plus output buffers. A request carries **all** of its buffers in the transfer
   list, and the responder transfers **all of them back**. The invariant, stated normatively:
   **exactly one owner at any instant**, for every buffer, at every point in the protocol.
   Buffers may be re-minted **only** on the failure path (`onerror`, `onmessageerror`), where the
   responder has died holding them.

3. **Mandatory backpressure that drops rather than allocates.** If no pool pair is free when a
   chunk arrives, the chunk is **dropped** and a telemetry counter is incremented. It is never
   queued into a fresh allocation. This is the direct consequence of CLAUDE.md rule 2 in a
   streaming context: the only two options at saturation are "allocate" and "drop", and
   allocating is forbidden.

4. **Buffer consumption stated as an explicit API contract.** Per claim **C1**'s recorded
   consequence, `@trace-kit/core` must state buffer consumption as an explicit contract of its
   transport API rather than leaving it implicit. A caller that reads a buffer it has handed to
   the port is making a contract violation, and the contract has to say so in the types and in
   the documentation.

5. **The de-risking prototype — an explicit, first-class deliverable.** A committed, re-runnable
   harness that drives the pooled protocol for **60 seconds at 60 Hz** under **`--trace-gc`**
   and asserts:
   - **zero scavenges** over the full run, and
   - **zero detached-buffer exceptions** over the full run.

   It runs before any renderer exists. Its purpose is to fail here, cheaply, rather than after
   changes 5–14 have been built on a broken ownership model. A prototype that cannot be run
   again later is not accepted; it is committed alongside the existing evidence probes.

6. **`SharedArrayBuffer` as an optional runtime-detected fast path, never a requirement.** Per
   confirmed decision 4. `SharedArrayBuffer` plus an SPSC ring buffer is genuinely attractive —
   no detach, no round-trip latency, and `crossOriginIsolated` restores full `performance.now()`
   precision, which exploration §1.5 needs for sub-millisecond criteria. But it requires
   `COOP: same-origin` + `COEP: require-corp`, which **GitHub Pages cannot serve** and which
   **breaks third-party embeds without CORP** — a direct collision with the brief's own
   StackBlitz and public-deployment criteria. Therefore: the default transport is the pooled
   ownership round-trip, which works under any deployment; `SharedArrayBuffer` is detected at
   runtime and used only when available; COOP/COEP is never a requirement of TraceKit. Claim
   **C4c** reinforces this from a second direction —
   `measureUserAgentSpecificMemory` requires exactly the isolation this decision declines, and is
   therefore ruled out as an instrumentation option anywhere in the plan.

7. **The core never constructs a `Worker`.** Per exploration §1.9, `Worker` and `self` are
   browser globals exactly like `window`, and
   `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` — the only form
   Vite, Rollup, webpack 5 and Next.js recognise statically — **breaks the CJS output** that the
   dual-format build produces. So: the core exports the pure algorithms plus the `DecimationPort`
   interface, and the real worker is **injected** as a `workerFactory: () => Worker` by the
   adapter or the host application. Capability detection (`typeof Worker !== 'undefined'`) stays
   **lazy, inside a function body**, never at module scope — a top-level reference alone breaks
   SSR bundling and defeats tree-shaking. The injected worker itself lands in **change 8**, not
   here.

## Capabilities (Contract for `sdd-spec`)

### New Capabilities

- `decimation-port`: the `DecimationPort` interface — its request and response shapes, its
  synchronous in-thread default implementation, and the lazy in-function-body capability
  detection rule.
- `buffer-ownership-protocol`: the pooled single-ownership round-trip. Pool sizing, the
  transfer-all / transfer-all-back rule, the exactly-one-owner-at-any-instant invariant, the
  explicit buffer-consumption contract on the public API, and the failure-path-only re-minting
  rule.
- `transport-backpressure`: the saturation policy — drop the chunk, increment the telemetry
  counter, never allocate — and the counter's observable contract.
- `shared-array-buffer-capability`: `SharedArrayBuffer` as a runtime-detected optional fast path,
  with the normative statement that COOP/COEP is never required and that no TraceKit feature may
  be gated on cross-origin isolation.
- `ownership-prototype-gate`: the 60-second 60 Hz round-trip harness under `--trace-gc` asserting
  zero scavenges and zero detached-buffer exceptions, committed and re-runnable.

### Modified Capabilities

- `spectrum-data-payload` (from change 2): gains the transport-facing ownership semantics — which
  buffers a payload owns, what a caller may read after handing a payload to a port, and how
  ownership returns.
- `allocation-free-hot-path` (from change 2): extended from single-threaded numeric loops to the
  transport path, where the no-allocation rule is what forces the drop-on-saturation policy.

## Impact on TraceKit Packages

- `packages/core`: the whole of this change. `DecimationPort`, the synchronous implementation,
  the pool, the backpressure policy, the runtime `SharedArrayBuffer` detection, and the
  prototype harness. Remains 100% isomorphic — and specifically contains **no reference to
  `Worker` or `self` at module scope**, and constructs no `Worker` at all.
- `packages/renderers`, `packages/vue`, `packages/react`: not created and not touched (changes 5,
  10, 11). They are the eventual consumers of this contract, which is the whole reason it is
  frozen before they exist.
- `apps/playground`: not touched. Change 4 does **not** depend on this change (exploration §3:
  "4 has no dependency on 3 and can run alongside 2/3 once 1 lands"), so the two can proceed in
  parallel.

## Acceptance Criteria Model

Per confirmed decision 3, every criterion here is a deterministic work-count or invariant
assertion plus a relative budget. There is no literal wall-clock gate.

**Ownership invariants (deterministic, hardware-independent)** — the load-bearing gates:

- Over a full round-trip, every buffer has **exactly one owner at every observable point**.
  Asserted directly against claim **C1**'s mechanism: after handing a buffer to the port, the
  sender observes `byteLength === 0`; after ownership returns, `byteLength` is restored to the
  original value and reads through fresh views succeed.
- Reading through a **pre-existing** view after transfer fails, and the API contract documents
  it. This is asserted as expected behaviour, not worked around.
- Buffer identity is preserved across the round trip for the pooled case — the returned buffer is
  the same buffer, not a copy.
- Pool allocation count is **constant** for the lifetime of the port under steady-state
  operation, regardless of chunk count or chunk size. Re-minting occurs on the failure path only,
  and a test drives that path explicitly.
- At saturation the incoming chunk is dropped and the telemetry counter increments by exactly
  one. Allocation count does not change.

**The prototype gate** — 60 seconds at 60 Hz (3,600 round trips) under `--trace-gc`: **zero
scavenges**, **zero detached-buffer exceptions**. This is a count assertion, not a timing one,
so it is stable across hardware.

**Zero allocation** — asserted by **GC-event count** (claim **C4b**): a `PerformanceObserver`
with `entryTypes: ['gc']` reports zero `gc` entries over N round trips of the synchronous port,
with an allocating control variant in the same test proving the gate is live. **C4b** measured 0
events against 17 for the allocating control over identical iteration counts, so the
discrimination is total. Never `performance.memory` (claim **C4**: non-standard, Chromium-only,
quantized at ~100 KB, post-GC), never `measureUserAgentSpecificMemory` (claim **C4c**), never a
total-heap delta, never an absolute magnitude. The browser-side form, when it is eventually
needed, is **zero bytes attributed to the named hot-path function** in a CDP `HeapProfiler`
sampling profile (claim **C4d**) — and **C4d** records that sampled magnitudes under-report by
three orders of magnitude and do not scale predictably with the sampling interval, so only the
binary named-function form is ever sound.

**`SharedArrayBuffer` criteria** — the port operates correctly and passes every ownership
invariant with `SharedArrayBuffer` **absent**; detection is lazy and inside a function body; and
no code path requires `crossOriginIsolated`. A test asserts the non-isolated environment is
fully supported, because that is the deployment TraceKit actually targets.

**Isomorphism criteria** — the core loads and the synchronous port runs to completion in a plain
Node environment with no DOM globals; a source-level gate asserts no `Worker`/`self` reference at
module scope and no `Worker` construction anywhere in `packages/core`.

**Relative regression budget** — round-trip throughput of the synchronous port is measured warm,
median-of-N, against a baseline recorded on the same runner. Literal per-round-trip millisecond
figures are **informational benchmarks** recorded by change 16.

## Scope & Non-Goals

Deliberately deferred, with the owning change named:

- **The real `Worker`, the injected `workerFactory`, and the actual cross-thread transfer**:
  change 8 (`worker-streaming-transport`). This change freezes the contract the worker will
  satisfy; it ships no worker.
- **The `SharedArrayBuffer` SPSC ring-buffer implementation**: change 8. This change defines it
  as an optional detected capability and specifies that nothing may require it.
- **The optional Node `worker_threads` adapter behind a `"node"` export condition**: change 8.
  Noted here because `worker_threads.Worker` has a genuinely different API — no
  `addEventListener`, different `MessagePort` semantics (exploration §1.9) — so it cannot be
  folded into the browser path.
- **Incremental O(new samples) streaming decimation over a raw-sample ring buffer**: change 8.
  Exploration §1.1 records that re-decimating 1e6 points every frame is O(n) per frame and that
  the correct design for 60 Hz streaming is incremental. This change ships the ownership
  protocol; change 8 ships the incremental algorithm that runs inside it.
- **Any renderer, and the authoritative main-thread CPU payload reference used for GL context
  restore**: changes 5, 7 and 9. The GL-restore dependency is called out in the motivation
  because it is *why* the protocol must be right, not because it is built here.
- **`setData` / `pushStreamData` as public engine API**: change 9 (`engine-controller`). Their
  shape is *determined* by this change's ownership decision, which is precisely why it is frozen
  first.
- **Any browser-side profiling or CDP instrumentation**: change 7.

Package scope is `@trace-kit/*`. The brief's `@optic-vis/*` is a stale template leftover
(exploration §3.11).

## Delivery

Delivery strategy is **`exception-ok`**, explicitly accepted by the user: one PR for this
change, and the 400-line review budget is **not** a blocker. The interface, the pool, the
backpressure policy, the invariant tests and the 60-second prototype harness travel together;
merging the contract without the prototype that de-risks it would forfeit the entire purpose of
the change.

Versioning follows CLAUDE.md rule 8: a Changesets `patch` bump within the `0.0.x` series.
