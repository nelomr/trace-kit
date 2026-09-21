---
"@trace-kit/core": patch
"@trace-kit/renderers": patch
---

Generalize the viewport transform to support a base-10 logarithmic Y scale
(`Y_SCALE_KIND_LOG`) with a total, finite inverse, and N independent Y axes sharing one X
domain (`createAxisTransforms`, `YAxisRegistration`). Adds `selectLogTicks`, a fully
transcendental-free decade tick selector with a non-empty-result guarantee. The existing
linear, single-axis path is unchanged — every field, coefficient and rendered pixel stays
byte-identical.

`@trace-kit/renderers`'s `Canvas2DRenderer` gains an optional `yAxes` registration list
(`computeAxisInsets` now takes a `yAxisCount`), painting N left-stacked axes with decade
gridlines for a log-kind axis, dispatching to `selectLogTicks` or `selectTicks` per axis.
