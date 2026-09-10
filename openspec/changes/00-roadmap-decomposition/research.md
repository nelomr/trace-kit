# Research Evidence

schema: gentle-ai.sdd-research/v1
request_id: rr-20260910T104736Z-platform-claims
revision: 4
change: 00-roadmap-decomposition
outcome: done
artifact_store: openspec
accessed_at: 2026-09-10
source_classes_requested: [documentation, open-web]
source_classes_observed: [documentation, open-web]

## Outcome rationale — why `partial` and not `done`

The delegated phase reported `done` with four CONFIRMED verdicts. The orchestrator downgrades
the outcome to `partial` against the evidence standard this request itself declared, which
states: *"A verdict may not be upgraded on corroborating sources alone."*

- **Lane 2** rests entirely on engine bug trackers. The Khronos WebGL specification text could
  not be retrieved (HTTP 403), so no primary normative source backs the verdict. Two independent
  engines corroborating the behaviour is strong evidence of the behaviour, but under the declared
  standard it is `PARTIALLY CONFIRMED`, not `CONFIRMED`.
- **Lane 4** validated only its negative half. The claim that `performance.memory` cannot prove
  zero allocation is primary-sourced and confirmed. The lane's replacement-instrumentation
  sub-questions — Node `perf_hooks` GC observer, CDP `HeapProfiler.startSampling`, and
  `measureUserAgentSpecificMemory()` isolation requirements — were not answered with sources, and
  the returned envelope instead suggested static review plus the DevTools Memory tab, which does
  not satisfy a CI-gateable criterion.

Per the lifecycle contract, a `partial` outcome excludes unvalidated claims. Claims C1, C3 and C4
below are validated and admissible. Claim C2 is admitted at reduced confidence and flagged. The
replacement-instrumentation question is recorded as an open gap, not as a claim.

## Sources

| id | class | title | publisher | url | accessed_at | tier |
|----|-------|-------|-----------|-----|-------------|------|
| S1 | documentation | Transferable objects | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects | 2026-09-10 | primary |
| S2 | documentation | HTMLCanvasElement: getContext() method | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext | 2026-09-10 | primary |
| S3 | documentation | Performance: memory property | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory | 2026-09-10 | primary |
| S4 | open-web | Bug 1560771 — gl.lineWidth not working with WebGL 2 context | Mozilla Bugzilla | https://bugzilla.mozilla.org/show_bug.cgi?id=1560771 | 2026-09-10 | corroborating |
| S5 | open-web | Line width setting in WebGL has no effect (41247812) | Chromium Issue Tracker | https://issues.chromium.org/issues/41247812 | 2026-09-10 | corroborating |
| S6 | open-web | ANGLE (software) | Wikipedia | https://en.wikipedia.org/wiki/ANGLE_(software) | 2026-09-10 | corroborating |

### Excerpts

- **S1**: "Following a transfer, the original object is no longer usable; it no longer points to
  the transferred resource, and any attempt to read or write the object will throw an exception."
- **S2**: "It is not possible to get a different drawing context object on a given canvas
  element." — and `getContext` "returns ... null if the context identifier is not supported, or
  the canvas has already been set to a different context mode."
- **S3**: "The non-standard and legacy memory read-only property ... the information this API
  provides is unreliable as it might overestimate actual memory usage if web pages share the same
  heap, or might underestimate actual memory usage if web pages use workers and/or cross-site
  iframes that are allocated in separate heaps."
- **S4**: "glLineWidth is deprecated in newer versions of core opengl, we currently ignore
  lineWidth when using core profile."
- **S5**: Issue title "Line width setting in WebGL has no effect", reported reproducible
  cross-browser.

## Claims

### C1 — `transfer-detaches-sender-arraybuffer` — CONFIRMED
Sources: S1 (primary).
A transferred `ArrayBuffer` is detached in the sending realm; `byteLength` becomes `0` and reads
or writes through pre-existing views fail. Standardized via the structured-clone transfer steps
and therefore consistent across V8, SpiderMonkey and JSC. No mechanism exists to un-detach in
place; returning ownership requires transferring the buffer back.

**Consequence:** the pooled single-ownership round-trip protocol stands. `@trace-kit/core` must
state buffer consumption as an explicit contract of its transport API.

### C2 — `webgl-line-width-capped-at-one` — PARTIALLY CONFIRMED (downgraded)
Sources: S4, S5, S6 (all corroborating; no primary normative source retrieved).
`glLineWidth` is deprecated in modern OpenGL core profiles and is ignored there. This affects
core profiles on Linux and macOS and ANGLE-backed paths on Windows and macOS. Firefox aligned
its behaviour with Chrome following S4. There is no modern platform on which `lineWidth > 1` is
reliable.

**Correction to the exploration text (§1.2):** the exploration asserted that
`ALIASED_LINE_WIDTH_RANGE` is reported as `[1, 1]` on ANGLE/D3D11 and Metal. The evidence does
not support that specific reading and points the other way: the reported range **can be
misleading**, advertising something like `[1, 10]` while the effective rasterized width remains
1. This makes the engineering conclusion *stronger*, not weaker — `ALIASED_LINE_WIDTH_RANGE`
cannot be used as a feature-detection signal for thick-line support, so instanced quad expansion
must be the unconditional primary path rather than a fallback chosen by querying the range.

**Consequence:** the instanced-quad decision stands and hardens. The `LINE_STRIP` hairline fast
path must be selected by requested style (effective width <= 1 device pixel), never by querying
the line-width range.

### C3 — `canvas-context-type-permanently-exclusive` — CONFIRMED
Sources: S2 (primary).
Once a canvas element's context mode is set, requesting a different context type returns `null`
— it does not throw — and this is permanent for the element. No documented reset mechanism
(resize, clearing, `width` assignment) restores it.

**Consequence:** the stacked dual-canvas swap protocol in change 9 is required, not preferred.
Engine switching must create or reveal a second `<canvas>` element.

### C4 — `performance-memory-cannot-prove-zero-allocation` — CONFIRMED
Sources: S3 (primary).
`performance.memory` is explicitly documented as non-standard, legacy, Chromium-only, and
unreliable, over- or under-reporting depending on heap sharing, workers and cross-site iframes.
It is absent from Firefox and Safari. It therefore cannot serve as proof of zero allocation per
frame.

**Consequence:** the negative half of confirmed decision 3 stands — no acceptance criterion may
gate on `performance.memory`. The positive half (asserting zero allocation via GC-event counts)
remains unvalidated and is carried as gap G2.

## Contradictions

- The returned envelope proposed static code review plus the DevTools Memory tab as the
  substitute for `performance.memory`. That contradicts the orchestrator's confirmed decision 3,
  which requires a deterministic, CI-gateable assertion. Neither manual review nor an interactive
  DevTools panel is automatable, so the substitute is rejected pending G2.

## Gaps

- **G1 (lane 2):** the Khronos WebGL 1.0/2.0 specification text was unreachable (HTTP 403). No
  primary normative source establishes what a conformant implementation may report for
  `ALIASED_LINE_WIDTH_RANGE`. Blocks C2 from reaching CONFIRMED.
- **G2 (lane 4):** the replacement-instrumentation sub-questions returned no sources — Node
  `perf_hooks` `PerformanceObserver` with `entryTypes: ['gc']`, CDP
  `HeapProfiler.startSampling` / `getSamplingProfile` and its drivability from a Playwright CDP
  session, and whether `measureUserAgentSpecificMemory()` requires cross-origin isolation and at
  what granularity. This is the mechanism every zero-allocation acceptance criterion in changes
  2, 5, 7 and 16 depends on, so it must be closed before `sdd-spec` writes those criteria.
- **G3 (all lanes):** Safari/WebKit behaviour was not verified for any lane. Evidence covers
  Chromium and Firefox. Low risk for C1 and C3 (both specification-level), higher for C2.

## Uncertainty and freshness

All sources accessed 2026-09-10. C1 and C3 are specification-level and stable. C4 documents a
legacy non-standard API whose status is unlikely to improve. C2 describes deprecation behaviour
that has been stable across engine generations, but its confidence is limited by tier, not by
age.

## Product choices

None. Product decisions are recorded in the exploration artifact §7 and are not authoritative
here.

---

# Revision 2 — gap closure

revision: 2
outcome: partial
request_id: rr-20260910T104736Z-platform-claims

## Delegation defect (orchestrator-owned, recorded for honesty)

Both `sdd-research` invocations were handicapped by the orchestrator's intake, not by the agent.
The agent's grants are `documentation=[WebFetch]` and `open-web=[WebSearch, WebFetch]` — it has
**no file-read tool**. Passing the persisted intent *by path* was therefore unusable in
revision 1 and again in revision 2, so revision 2 reconstructed lane 4b's sub-questions by theme
rather than reading them. Any future research delegation must inline the full intake text in the
prompt; the on-disk artifact is the audit record, not the transport.

Consequence: revision 2's lane 4b conclusion that "no public, deterministic, CI-automatable API
exists" is a **false negative** produced by the missing sub-questions, and is refuted below by
direct local measurement.

## Additional sources

| id | class | title | publisher | url | accessed_at | tier |
|----|-------|-------|-----------|-----|-------------|------|
| S7 | documentation | WebGL 1.0 Specification (Khronos official repository mirror) | Khronos Group | https://raw.githubusercontent.com/KhronosGroup/WebGL/main/specs/latest/1.0/index.html | 2026-09-10 | primary |
| S8 | open-web | Line Width — Khronos Community Forums | Khronos Group | https://community.khronos.org/t/line-width/2512 | 2026-09-10 | corroborating |
| S9 | documentation | Measure Memory API (WICG Draft Community Group Report) | WICG | https://wicg.github.io/performance-measure-memory/ | 2026-09-10 | primary |
| S10 | measurement | Local reproducible GC-observer probe | this repository | openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs | 2026-09-10 | primary (direct measurement) |

## Claims (revision 2)

### C2b — `webgl-line-width-spec-text` — PARTIALLY CONFIRMED (gap G1 partially closed)
Sources: S7 (primary, declaration only), S8 and S5 (corroborating).
The WebGL 1.0 specification declares `undefined lineWidth(GLfloat width)` and
`const GLenum ALIASED_LINE_WIDTH_RANGE = 0x846E`, but does not itself define line rasterization —
it defers to OpenGL ES, and that deferral is part of the normative text. The causal explanation
is corroborating-tier: Direct3D exposes no line-width control, so an ANGLE/D3D11 backend reports
a maximum of 1.0 in order to remain conformant. Chromium classifies the resulting behaviour as
accepted design, not an open defect.

`registry.khronos.org` returned HTTP 403 on every attempt across both revisions, so the explicit
normative sentence disclaiming any guarantee of widths above 1.0 was never retrieved. G1 stays
open at the normative-text level.

**Platform nuance refined:** on Windows via ANGLE/Direct3D the reported range is consistently
`[1, 1]`; on macOS and Linux native GL backends the reported range may be wider but is
driver-dependent and still unhonoured in core profiles. So both failure shapes exist in the
wild — a truthful `[1, 1]` and a wider range that is not honoured. Either way the range is not a
usable feature-detection signal, which is the operative conclusion.

**Consequence:** the instanced-quad decision stands, unconditionally, and is not gated on
querying `ALIASED_LINE_WIDTH_RANGE`.

### C4b — `allocation-instrumentation` — CONFIRMED for the Node-side CI gate (gap G2 closed for changes 2 and 5)
Sources: S10 (primary, direct measurement), S9 (primary, for the rejected alternative).

Direct measurement on Node v20.20.0 under `--expose-gc`, 200 iterations of a Min-Max envelope
over a 1e6-sample `Float32Array` reduced to 1000 buckets, comparing an allocation-free variant
writing into a preallocated output buffer against a variant allocating one object per bucket:

| variant | GC events observed | `used_heap_size` delta |
|---|---|---|
| allocation-free | **0** | 32,104 bytes (observer bookkeeping, not the loop) |
| one object per bucket | **17** | — |

`PerformanceObserver` accepts `entryTypes: ['gc']`, and each entry carries `detail.kind` and
`detail.flags` against the documented `NODE_PERFORMANCE_GC_*` constants (`GC_MAJOR`, `GC_MINOR`,
`GC_INCREMENTAL`, `GC_WEAKCB` and the `GC_FLAGS_*` set), plus a `duration`. A sample entry:
`{"name":"gc","kind":1,"flags":0,"dur":0.386}`.

The discrimination is total and reproducible: zero versus seventeen events over identical
iteration counts. "Zero GC events over N iterations" is therefore a **sound, deterministic,
CI-assertable proxy for zero allocation** in the hot path, and confirmed decision 3 is
implementable as written. The probe is committed at
`openspec/changes/00-roadmap-decomposition/evidence/gc-observer-probe.mjs` and is re-runnable.

Incidental corroboration of the audit's timing estimate: the allocation-free Min-Max pass
measured ~1.72 ms per 1e6-sample iteration, inside the predicted 1-3 ms band and far under the
brief's 15 ms budget.

### C4c — `measureUserAgentSpecificMemory` is unusable here — CONFIRMED
Sources: S9 (primary).
The WICG report requires that "the current Realm's settings object's cross-origin isolated
capability is true", otherwise the call "returns a promise rejected with a `SecurityError`
DOMException", and states the API is "intended for aggregating memory usage data from
production" rather than per-operation tracking.

**Consequence:** this API is doubly ruled out — it needs the COOP/COEP isolation that confirmed
decision 4 declines, and it is aggregate and asynchronous by design. It is not a candidate for
any acceptance criterion.

## Remaining gaps after revision 2

- **G1 (open, low risk):** no primary normative sentence disclaiming line widths above 1.0;
  `registry.khronos.org` blocks automated fetches. Two independent engines plus the Khronos
  forum explanation corroborate the behaviour, and the engineering conclusion does not depend on
  the exact wording, so this is accepted as a documented residual risk rather than a blocker.
- **G4 (open, deferred to change 7):** the browser-side instrumentation — CDP
  `HeapProfiler.startSampling` / `getSamplingProfile` for per-call-site attribution, driven from
  a Playwright `CDPSession` — remains unsourced and unverified. It is not needed for changes 1-5,
  whose zero-allocation criteria are Node-side and now covered by C4b. It must be closed before
  `sdd-spec` writes the WebGL2 render-loop criteria in change 7.
- **G3 (open, low risk):** Safari/WebKit behaviour unverified across all lanes.

## Gate assessment (orchestrator)

Research outcome stays `partial`, but the blocking question is resolved for the first proposal
batch: the Node-side zero-allocation gate is proven by direct measurement, and every acceptance
criterion in changes 1-4 is now writable against validated evidence. G4 is scoped to change 7
and G1/G3 are accepted residual risks. Proposal admission for batch 1 (changes 1-4) proceeds;
change 7 must not enter `sdd-spec` until G4 is closed.

---

# Revision 3 — gap G4 closed by direct measurement

revision: 3
outcome: done
request_id: rr-20260910T104736Z-platform-claims

## Additional source

| id | class | title | publisher | url | accessed_at | tier |
|----|-------|-------|-----------|-----|-------------|------|
| S11 | measurement | Local reproducible CDP HeapProfiler sampling probe | this repository | openspec/changes/00-roadmap-decomposition/evidence/cdp-heap-sampling-probe.mjs | 2026-09-10 | primary (direct measurement) |

### C4d — CDP `HeapProfiler` sampling attributes allocations per call site — CONFIRMED, with a hard constraint on how it may be asserted
Sources: S11 (primary, direct measurement).

Measured against Chrome 152.0.7977.83 headless, speaking raw CDP over WebSocket with no
third-party dependencies (so this is reproducible in CI without a Playwright install, and
identical calls are reachable from a Playwright `CDPSession`). `HeapProfiler.enable`,
`HeapProfiler.startSampling { samplingInterval }`, `HeapProfiler.stopSampling` are all available
and the returned `profile.head` is a call tree whose nodes carry `callFrame.functionName` and
`selfSize`, which is what per-call-site attribution requires.

Two named call sites, each run 300 times over a 200k-sample `Float32Array` reduced to 1000
buckets — one pushing an object per bucket, one writing into a preallocated output buffer:

| samplingInterval | bytes attributed to `allocatingRenderPath` | bytes attributed to `cleanRenderPath` |
|---|---|---|
| 2048 | 2,112 | **0** |
| 128 | 3,368 | **0** |

**The constraint — sampled magnitudes are not usable.** The allocating path performs ~300,000
object allocations, on the order of 9 MB, yet total sampled bytes came back as 8,276 (interval
2048) and 3,708 (interval 128). The profiler under-reports by three orders of magnitude and
does not scale predictably with the sampling interval, because it is a statistical sampler and
V8's escape analysis removes much of the allocation before it is ever sampled. Additionally,
the allocation-free run still accumulated ~3.5 KB attributed to `(anonymous)` and
`(BYTECODE_COMPILER)` — engine and compilation noise unrelated to the hot path.

**Therefore the acceptance criterion must be written as a named-function assertion, never a
total-heap one:** *zero bytes attributed to the named hot-path function in the sampling profile*.
That signal was exactly 0 across both sampling intervals while the allocating control was
non-zero in both, so the discrimination is reliable in the binary form. Asserting on total
sampled bytes would fail on engine noise, and asserting on absolute magnitudes would be
meaningless.

**Consequence:** gap G4 is closed. The WebGL2 render-loop zero-allocation criterion in change 7
is writable: assert zero bytes attributed to the renderer's `render` function via CDP sampling,
paired with the Node-side GC-event gate from C4b for the algorithmic paths. Change 7 is
unblocked for `sdd-spec`.

## Final gate assessment

Research outcome: **`done`**.

Every question that gates an acceptance criterion is answered with primary evidence:
- C1 buffer detach — primary (specification-level).
- C3 canvas context exclusivity — primary (specification-level).
- C4/C4c `performance.memory` and `measureUserAgentSpecificMemory` both ruled out — primary.
- C4b Node-side zero-allocation gate — primary, direct reproducible measurement.
- C4d browser-side zero-allocation gate — primary, direct reproducible measurement, with the
  named-function constraint recorded above.

Accepted residual risks, neither of which changes an engineering decision:
- **G1** — the exact Khronos normative sentence on line-width guarantees was never retrievable
  (`registry.khronos.org` returns HTTP 403 to automated fetches). The behaviour is corroborated
  by two independent engines plus the Khronos forum explanation, and the decision (unconditional
  instanced quads, never feature-detect via the reported range) does not depend on the wording.
- **G3** — Safari/WebKit unverified. C1 and C3 are specification-level and portable; C2's
  conclusion is already the conservative one on every platform.

Proposal admission is open for all changes.

---

# Revision 4 — transfer round-trip allocation behaviour

revision: 4
outcome: done
request_id: rr-20260910T104736Z-platform-claims

## Additional source

| id | class | title | publisher | url | accessed_at | tier |
|----|-------|-------|-----------|-----|-------------|------|
| S12 | measurement | Local reproducible pooled transfer round-trip probe | this repository | openspec/changes/00-roadmap-decomposition/evidence/transfer-roundtrip-probe.mjs | 2026-09-10 | primary (direct measurement) |

### C1b — a pooled transfer round trip produces zero observable scavenges at streaming rates — CONFIRMED
Sources: S12 (primary, direct measurement), C1 (specification-level, for the detach semantics).

The `core-transport-contract` design initially concluded that because each settlement must
re-mint typed-array views over the returned buffers — `O(1)` objects per round trip — the
proposal's "zero scavenges" gate is unachievable when read literally against a real transfer.

Measurement refutes that conclusion. `O(1)` allocation and an *observable scavenge* are distinct
properties: a few short-lived young-generation view objects per round trip stay below the
scavenge threshold at streaming rates. Measured on Node v20.20.0 under `--expose-gc`, with the
round trip implemented as `structuredClone(payload, { transfer })` in both directions so detach
semantics are real in both realms, over 3,600 iterations (60 seconds at 60 Hz):

| `deltaSamples` | GC events | ms per round trip |
|---|---|---|
| 4,096 | **0** | 0.0219 |
| 16,384 | **0** | 0.0560 |
| 65,536 | **0** | 0.2011 |
| 262,144 | **0** | 0.7455 |

GC events are flat at zero across a 64x range of payload size, which also confirms the design's
P5 invariance condition in advance rather than leaving it open. Per-round-trip time scales with
payload only because the probe's responder performs an `O(n)` copy over the buffer — that is the
responder's own work, not transfer overhead.

**Consequences.**
1. The transfer-mode pass condition stays **zero scavenge events**, not a relaxed `O(1)` budget.
2. Change 2's spec must **not** weaken `allocation-free-hot-path` to "`O(1)` per round trip
   instead of zero". That was listed among the items change 2 should absorb from the design; it
   is withdrawn. Every other absorption item from the design stands.
3. P5 is retained as a regression guard rather than an open falsification question.
4. Confirmed decision 4 is unaffected and does not need escalation: the design named "promoting
   the shared-memory path from optional to recommended" as the fallback if P5 failed, and P5
   passes, so `SharedArrayBuffer` stays optional as the user chose.

The design artifact has been amended in place with this measurement and its consequence.
