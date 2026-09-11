---
"@trace-kit/core": patch
---

Add `minMaxEnvelope` and `lttb` decimation algorithms, a branded typed-buffer vocabulary, and `SpectrumDataPayload`, each allocation-free on the hot path and enforced by a loop-scoped lint rule and a GC-event gate.
