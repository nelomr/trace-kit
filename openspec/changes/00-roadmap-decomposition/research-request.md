# Research Request (persisted intent — immutable input to `sdd-research`)

schema: gentle-ai.sdd-research-request/v1
request_id: rr-20260910T104736Z-platform-claims
revision: 1
change: 00-roadmap-decomposition
created_at: 2026-09-10T10:47:36Z
selected: true
outcome: done
exploration_reference: openspec/changes/00-roadmap-decomposition/exploration.md
evidence_artifact: openspec/changes/00-roadmap-decomposition/research.md
artifact_store: openspec

## Requested source classes

- `documentation` — normative specifications and official reference documentation
  (WHATWG HTML Standard, ECMAScript, Khronos OpenGL ES / WebGL, MDN).
- `open-web` — implementation source and issue trackers (Chromium, ANGLE, Gecko, WebKit),
  admissible as primary when quoting source or maintainer statements; blogs, Stack Overflow
  and library READMEs are corroborating only and may never carry a CONFIRMED verdict alone.

## Evidence standard

Each lane returns `CONFIRMED`, `PARTIALLY CONFIRMED` or `REFUTED`, with at least one primary
source per verdict, the exact quoted normative sentence or source line, the full URL, the
source tier, and any version or platform variation. A verdict may not be upgraded on
corroborating sources alone. Unvalidated claims are excluded from a `partial` or `blocked`
outcome.

## Questions

### Lane 1 — `transfer-detaches-sender-arraybuffer`
Does `postMessage(message, [buf])` / `postMessage(message, { transfer: [buf] })` detach `buf`
in the sending realm, such that `buf.byteLength === 0` afterwards and pre-existing
`TypedArray` views over it read as empty or throw? Establish, from the HTML Standard transfer
steps and the ECMAScript `DetachArrayBuffer` abstract operation, what happens to the buffer and
to pre-existing views, whether transferring back is the specified mechanism for returning
ownership, and whether any specified means exists to un-detach a buffer in place.

### Lane 2 — `webgl-line-width-capped-at-one`
Is `ALIASED_LINE_WIDTH_RANGE` reported as `[1, 1]` on desktop Chrome via ANGLE over D3D11
(Windows) and Metal (macOS), making `gl.lineWidth(n > 1)` silently ineffective and
`LINE_STRIP` unusable for thick lines? Establish whether a conformant OpenGL ES 3.0 / WebGL 2.0
implementation may report `[1, 1]`; then find ANGLE or Chromium source or tracker evidence for
the actual reported range on the D3D11 and Metal backends. Also report what Firefox and Safari
report, whether an out-of-range `lineWidth` raises an error or is clamped silently, and whether
instanced quad expansion is the standard workaround.

### Lane 3 — `canvas-context-type-permanently-exclusive`
After `getContext('2d')` succeeds on an `HTMLCanvasElement`, does a later
`getContext('webgl2')` on the same element return `null` (and vice versa), permanently for the
element's lifetime? Establish this from the HTML Standard `getContext` algorithm and its
context-mode steps, and determine whether any reset mechanism exists (resize, clearing,
`width` assignment, element replacement). Note whether `OffscreenCanvas` behaves identically.

### Lane 4 — `performance-memory-cannot-prove-zero-allocation`
Is `performance.memory.usedJSHeapSize` a non-standard Chromium-only value that is deliberately
quantized as a side-channel mitigation, lazily updated, and reflective of post-GC state — and
therefore incapable of demonstrating zero allocation per frame? Report the actual granularity,
its stated rationale, any dependence on cross-origin isolation, and browser availability. Then
establish the correct instrumentation with primary sources: (a) Node `perf_hooks`
`PerformanceObserver` with `entryTypes: ['gc']` — does it exist, what does it report, and is
"zero GC events over N iterations" a sound allocation proxy; (b) CDP
`HeapProfiler.startSampling` / `getSamplingProfile` — does it attribute allocated bytes per
call site, and is it drivable from a Playwright CDP session; (c) does
`measureUserAgentSpecificMemory()` require cross-origin isolation, and at what granularity.

## Why these four and nothing else

The 16-change decomposition in the exploration artifact rests on exactly these four platform
behaviours. Lane 1 determines the buffer-ownership protocol and therefore the public shape of
`setData` and `pushStreamData`. Lane 2 determines the WebGL2 primitive, shader and VBO binding
layout. Lane 3 determines whether flicker-free engine switching needs a stacked dual canvas.
Lane 4 determines how every zero-allocation acceptance criterion is written. If any lane is
refuted, the decomposition must be revised before any proposal is admitted.

---

# Revision 2 — follow-up lanes to close gaps G1 and G2

revision: 2
created_at: 2026-09-10T10:50:42Z
supersedes_outcome_of: revision 1 (`partial`)
prior_evidence: openspec/changes/00-roadmap-decomposition/research.md

Revision 1 returned four verdicts but two gaps block a `done` outcome under this request's own
evidence standard. These two lanes exist solely to close them. Lanes already CONFIRMED at
primary tier (C1, C3, C4-negative) are NOT to be re-researched.

### Lane 2b — `webgl-line-width-spec-text` (closes G1)
Retrieve the **normative specification text**, not engine bug trackers, establishing what a
conformant implementation may report and honour for line width. Specifically: the OpenGL ES 3.0
specification section covering `LineWidth` and `ALIASED_LINE_WIDTH_RANGE`, and the WebGL 2.0
specification's treatment of it. Establish (a) whether reporting a maximum of 1 is conformant,
(b) whether an implementation may advertise a wider range than it honours, and (c) whether
`lineWidth` outside the reported range raises `INVALID_VALUE` or is clamped silently. The
Khronos registry returned HTTP 403 on the previous attempt; try the registry's raw specification
paths, the Khronos GitHub specification repositories, and the OpenGL ES 3.0 PDF or HTML mirrors.
If no primary source can be reached, say so plainly and leave the verdict at PARTIALLY
CONFIRMED — do not substitute secondary sources.

### Lane 4b — `allocation-instrumentation` (closes G2)
Establish, with primary sources, the correct CI-gateable instrumentation to replace
`performance.memory`. This is the mechanism every zero-allocation acceptance criterion in
changes 2, 5, 7 and 16 will be written against, so unsourced recommendations are not acceptable.
Answer each of:
(a) Node.js `perf_hooks`: does `PerformanceObserver` accept `entryTypes: ['gc']`, what does a
    `PerformanceEntry` of that type report (kind, flags, duration), and is "zero GC events over
    N iterations" a sound proxy for zero allocation? Cite the Node.js API documentation.
(b) Chrome DevTools Protocol `HeapProfiler` domain: do `startSampling` and
    `getSamplingProfile` attribute allocated bytes per call site, what is the sampling
    interval parameter, and can the domain be driven from a Playwright `CDPSession`? Cite the
    CDP domain reference and the Playwright API documentation.
(c) `performance.measureUserAgentSpecificMemory()`: does it require cross-origin isolation,
    what granularity and breakdown does it return, and is it synchronous or asynchronous?
(d) `v8.getHeapStatistics()` under `--expose-gc`: is a forced-GC heap delta a defensible
    assertion, and what are its documented limitations?

Note explicitly: the revision-1 envelope proposed static code review plus the DevTools Memory
tab. That is rejected as non-automatable and therefore unusable as a CI gate. The replacement
must be assertable from a test process.

## Source classes (unchanged)

`documentation`, `open-web`. Corroborating sources may never carry a CONFIRMED verdict alone.
