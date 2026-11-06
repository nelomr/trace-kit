---
"@trace-kit/renderers": patch
---

Canvas2D, SVG export and WebGL2 now agree on traces that leave the plot, on infinite samples and on
log-axis samples that cannot be drawn. Canvas2D no longer paints trace ink outside the plot
rectangle, and the three backends share one rule for each of these cases.

**Canvas2D: plot clipping.** Traces and isolated-sample markers are clipped to the plot rectangle,
so a payload that extends past the visible X domain (or below a log axis) no longer paints into the
axis gutters. The axes, tick marks and labels are drawn afterwards and stay unclipped. The clip is
one `save` / `clip` / `restore` bracket per frame with no extra allocation.

**Canvas2D and SVG: `±Infinity`.** A `+Infinity` or `-Infinity` Y sample is drawn to the plot edge
(top for `+Infinity`, bottom for `-Infinity` on an ascending axis, mirrored on an inverted one)
instead of being bridged on Canvas2D. SVG used to write the non-finite coordinate as `0`, which put
a linear `-Infinity` at the top of the document; it now reaches the plot edge too. Coordinates are
clamped to a guard band so no non-finite number reaches the path.

**All engines: log-axis `y <= 0`.** On a logarithmic Y axis a sample that is `0` or negative lifts
the pen like a gap on Canvas2D and SVG (WebGL2 already collapsed it), and a sample isolated by such
a gap now gets an isolated-sample marker on every engine. Marker output on WebGL2 and in exported
SVG therefore changes for log-axis input that contains non-positive samples; linear axes and
positive log samples are unchanged, and no committed golden needs regenerating.

**Canvas2D: single-payload decimation.** `setData` now goes through the same decimation rule as the
trace-collection path, so when LTTB is infeasible for a fragmented payload it falls back to the
min-max envelope, as WebGL2 and SVG already did.

**Migration.** `TraceDrawingContext` gains `save()`, `restore()`, `rect(x, y, w, h)` and `clip()`.
A custom context passed to `Canvas2DRenderer` must provide them; `CanvasRenderingContext2D` and
`OffscreenCanvasRenderingContext2D` already do. The only recorded divergence left between Canvas2D
and WebGL2 is that a trace `dash` style is ignored on WebGL2.
