---
"@trace-kit/core": patch
"@trace-kit/renderers": patch
---

The X domain now lives in one space everywhere: absolute physical X (`xOrigin + x[i]`). Before,
the projection, ticks and GPU path read it as payload offsets while the export window, CSV and
`.npy` read it as absolute X, so a payload with a non-zero `xOrigin` was drawn over one range and
exported from another.

**Migration.** Payloads with `xOrigin = 0` are unaffected: projection, ticks, gridlines, uniforms
and exports are bit-identical. If you passed offsets as the domain for a payload with a non-zero
`xOrigin`, add `xOrigin` to both bounds.

**Core.**

- `ViewportTransform` gains `xOffsetMin` (`xDomainMin - xOrigin`, binary64, computed once at
  construction; construction throws if it overflows). It now has 19 fields.
- `projectX(t, xOffset)` keeps its signature and its payload-offset input, and now subtracts
  `xOffsetMin`, so the hot loop stays one subtraction and one multiplication.
- `unprojectX` returns absolute X, the same space as `xDomainMin`.
- `TraceCollection.xDomainMin`/`xDomainMax` are documented as absolute X, shared by entries with
  different `xOrigin`.

**Renderers.**

- `setDomain` bounds and `TraceCollection` X bounds are absolute X. X tick labels show absolute
  values, and traces with different `xOrigin` in one collection are placed at their physical X.
- Gridlines and tick marks are computed once in the shared layout from the absolute domain and
  no longer depend on any trace's origin.
- WebGL2: the uniform `u_xOrigin` is renamed `u_xOffsetMin` and carries the hi/lo split of
  `xOffsetMin`, so deep zooms keep their float32 precision under a non-zero origin.
- `setTraces` resets the origin remembered from a previous `setData`, so a collection never
  inherits a stale single-payload origin.
- The `overlay-two-axis` fixture's log trace keeps `xOrigin = 1000` with offsets `-1000..-701`,
  so its absolute X matches the linear trace and its CSV/`.npy` are no longer empty for the
  default window. No golden changes.
