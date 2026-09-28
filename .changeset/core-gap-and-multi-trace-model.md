---
"@trace-kit/core": patch
"@trace-kit/renderers": patch
---

Define `NaN` in a Y buffer as a gap sentinel that no decimator or renderer may bridge:
`lttb` and `minMaxEnvelope`/`minMaxEnvelopeIndices` now preserve a gap through decimation
instead of silently absorbing it into a neighbouring bucket, emitting `-1`/`NaN` break markers
consumers can detect without re-scanning the source buffer. Gap-free input is unchanged —
`lttb`'s single-traversal path and both min-max functions' output are byte-identical to before
this change.

Adds `TraceCollection` to `@trace-kit/core`: an ordered, frozen set of `SpectrumDataPayload`
entries sharing one X domain, each bound to a `YAxisRegistration.id` with its own style.

`Canvas2DRenderer` gains `setTraces(collection)`, drawing one `Path2D` per trace against its
own resolved transform and style, with per-trace decimation memoization (a revision bump on one
trace never re-decimates its siblings) and a `minMaxEnvelopeIndices` fallback when `lttb` cannot
represent a trace's gaps within its threshold. `setData(payload)` keeps its existing single-trace
behavior unchanged. A finite segment that resolves to exactly one source sample (an isolated
sample between two gaps) is painted as a filled square marker by default, so a real measured
sample is never silently invisible; opt out per trace via `TraceStyle.markIsolatedSamples`.
