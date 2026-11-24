# Capability: wheel-zoom-anchoring

> Change: `viewport-interaction-controller` (Roadmap step `9.3`). Pure, DOM-free, allocation-free cursor-anchored exponential zoom math in IEEE-754 float64 (`@trace-kit/core`) supporting linear X/Y and decade-space logarithmic Y (`Y_SCALE_KIND_LOG`), exact round-trip inverse symmetry, float64 ULP minimum span floor, configurable span/domain clamping, degenerate-axis guards, axis-mask resolution (plot, gutters, `Alt`/`Shift` modifiers), and wheel-burst `gestureActive` latching with trailing settle.

## Requirements

### Requirement: Pure Cursor-Anchored Exponential Zoom Math in IEEE-754 Float64
`@trace-kit/core` MUST export `computeZoomDomain(transform, factorX, factorY, anchorDeviceX, anchorDeviceY, axisMask, constraints, out)` (along with `AXIS_MASK_NONE = 0`, `AXIS_MASK_X = 1`, `AXIS_MASK_Y = 2`, `AXIS_MASK_XY = 3`, `computeUlpMinSpan`, `clampViewportDomain`, and `createMutableViewportDomain`) as pure, DOM-free, zero-allocation functions writing results into the caller-owned `out: MutableViewportDomain` and returning a `boolean` indicating whether any enabled axis changed validly.

For a linear axis (X, or Y when `transform.yScaleKind === Y_SCALE_KIND_LINEAR`):
- Normalized anchor fraction:
  - $u_x = \text{clamp}((anchorDeviceX - \text{plotLeft}) / \text{plotWidth}, 0, 1)$
  - $u_y = \text{clamp}(((\text{plotTop} + \text{plotHeight}) - anchorDeviceY) / \text{plotHeight}, 0, 1)$
- Given original span $S = d_{\max} - d_{\min} > 0$ and positive finite zoom factor $z > 0$ ($z < 1$ zooms in, $z > 1$ zooms out):
  - Clamped new span $S' = \text{clamp}(S \cdot z, S_{\min}, S_{\max})$, where $S_{\min} = \max(\text{callerMinSpan} ?? 0, S_{\text{ulpFloor}})$ and $S_{\text{ulpFloor}} = \max(|d_{\min}|, |d_{\max}|, 1) \cdot 10^{-12}$.
  - New bounds computed directly from span difference $\Delta S = S - S'$ to avoid catastrophic cancellation at high `xOrigin` offsets:
    $$d'_{\min} = d_{\min} + u \cdot \Delta S, \qquad d'_{\max} = d'_{\min} + S'$$

For wheel inputs, the controller MUST compute multiplicative zoom factors via $z = \exp(\text{normalizedDeltaPx} \cdot \text{sensitivity})$ so that opposite wheel ticks satisfy exact inverse symmetry $z(+\delta) \cdot z(-\delta) = 1$.

#### Scenario: Cursor physical coordinate stays invariant at 1550.0001 nm deep zoom
- **GIVEN**: a `ViewportTransform` with `xOrigin = 1550`, `xDomainMin = 1550.0001`, `xDomainMax = 1550.0002`, `plotLeft = 80`, `plotWidth = 800`, and cursor at `anchorDeviceX = 280` ($u_x = 0.25$, physical anchor $1550.000125\text{ nm}$)
- **WHEN**: `computeZoomDomain` runs with `factorX = 0.5`, `factorY = 1`, `axisMask = AXIS_MASK_X`, and a new `ViewportTransform` is built from `out`
- **THEN**: `out.xMax - out.xMin` equals `5e-5` within `1e-12` relative tolerance, and `unprojectX(nextTransform, 280)` equals `1550.000125` within `1e-12` nm

#### Scenario: Exponential wheel zoom in and out returns to the initial domain
- **GIVEN**: a mounted `ViewportInteractionController` on linear domain `[100, 200] x [-50, 50]`
- **WHEN**: a `wheel` event with `deltaY = -100` (zoom in) is followed at the exact same client coordinate by a `wheel` event with `deltaY = +100` (zoom out)
- **THEN**: `controller.domain` returns to `[100, 200] x [-50, 50]` within `1e-10` relative error on both X and Y

### Requirement: Decade-Space Logarithmic Y-Axis Zoom (`Y_SCALE_KIND_LOG`)
When `transform.yScaleKind === Y_SCALE_KIND_LOG` and Y is included in `axisMask`, `computeZoomDomain` MUST operate in base-10 logarithmic decade space:
- Let $L_{\min} = \log_{10}(y_{\min})$ (`transform.yLogDomainMin`), $L_{\max} = \log_{10}(y_{\max})$, decade span $D = L_{\max} - L_{\min} > 0$, and $u_y = \text{clamp}(((\text{plotTop} + \text{plotHeight}) - anchorDeviceY) / \text{plotHeight}, 0, 1)$.
- Enforce minimum decade span $D_{\min} = \max(\text{constraints.minLogDecadesY} ?? 10^{-6}, 10^{-12})$ and optional `maxSpan` / exponent constraints so that $[L'_{\min}, L'_{\max}] \subseteq [-300, +300]$ (`LOG_EXPONENT_MIN` to `LOG_EXPONENT_MAX`), sliding without collapsing span when hitting an exponent wall.
- Compute $D' = \text{clamp}(D \cdot \text{factorY}, D_{\min}, D_{\max})$, $L'_{\min} = L_{\min} + u_y \cdot (D - D')$, $L'_{\max} = L'_{\min} + D'$, and exponentiate $y'_{\min} = 10^{L'_{\min}}$, $y'_{\max} = 10^{L'_{\max}}$.
- The resulting domain MUST always satisfy `Number.isFinite(y'Min) && Number.isFinite(y'Max) && y'Min > 0 && y'Max > y'Min` so `createViewportTransform` with `Y_SCALE_KIND_LOG` never throws `RangeError`.

#### Scenario: Log-Y zoom preserves the anchored value under the cursor and stays strictly positive
- **GIVEN**: a `ViewportTransform` with `yScaleKind = Y_SCALE_KIND_LOG`, `yDomainMin = 1e-3`, `yDomainMax = 1e3` ($6$ decades), `plotTop = 20`, `plotHeight = 300`, and cursor at the vertical midpoint `anchorDeviceY = 170` ($u_y = 0.5$, anchored value $10^0 = 1$)
- **WHEN**: `computeZoomDomain` runs with `factorX = 1`, `factorY = 0.5`, `axisMask = AXIS_MASK_Y`
- **THEN**: `out.yMin` equals `10 ** -1.5`, `out.yMax` equals `10 ** 1.5` (3 decades centered on `1`), `out.yMin > 0`, and `createViewportTransform` succeeds with `unprojectY(nextTransform, 170)` equal to `1` within `1e-12`

#### Scenario: Extreme zoom-out on a log-Y axis clamps cleanly to exponent bounds [-300, +300]
- **GIVEN**: a `ViewportTransform` with `yScaleKind = Y_SCALE_KIND_LOG`, `yDomainMin = 1e-250`, `yDomainMax = 1e250`
- **WHEN**: `computeZoomDomain` is called repeatedly with `factorY = 10` (aggressive zoom out)
- **THEN**: `out.yMin >= 1e-300`, `out.yMax <= 1e300`, both are strictly finite and positive, and `createViewportTransform` never throws `RangeError`

### Requirement: Built-In ULP Floor, Configurable Bounds Clamping, and Degenerate-Axis No-Op Guards
Every zoom mutation MUST enforce:
1. Built-in float64 ULP safety floor $S_{\text{ulpFloor}} = \max(|d_{\min}|, |d_{\max}|, 1) \cdot 10^{-12}$ so repeated zoom-in can never collapse `xMax === xMin`, collapse `yMax === yMin`, or make `xScale === 0` or `Infinity`.
2. Optional `constraints`: `minSpanX`, `maxSpanX`, `minSpanY`, `maxSpanY`, `minLogDecadesY` (default `1e-6`), and `bounds?: { xMin?, xMax?, yMin?, yMax? }`. When zoomed bounds exceed a configured hard bound, `clampViewportDomain` MUST slide the window inside `[bounds.min, bounds.max]` preserving the clamped span if the span fits, or clamp to `[bounds.min, bounds.max]` if the span exceeds the total allowed bound width.
3. Degenerate-axis guard: if an axis has `max <= min`, non-finite bounds, `plotWidth <= 0` (for X), `plotHeight <= 0` (for Y), or non-positive/non-finite `factor`, that axis MUST remain unchanged (no division by zero, no `NaN`/`Infinity` emitted). If no axis in `axisMask` can change, `computeZoomDomain` MUST return `false`.

#### Scenario: Repeated extreme zoom-in stops safely above the float64 ULP floor
- **GIVEN**: a `ViewportTransform` at `xDomainMin = 1550`, `xDomainMax = 1551`
- **WHEN**: `computeZoomDomain` is iterated `200` times with `factorX = 0.5`
- **THEN**: on every iteration `out.xMax > out.xMin`, `out.xMax - out.xMin >= Math.max(Math.abs(out.xMin), Math.abs(out.xMax), 1) * 1e-12`, and `createViewportTransform` produces a finite, strictly positive `xScale`

#### Scenario: Zooming out against hard domain bounds clamps cleanly without exceeding bounds
- **GIVEN**: a domain `[40, 60] x [0, 10]` with `constraints = { bounds: { xMin: 0, xMax: 100 } }`
- **WHEN**: `computeZoomDomain` runs with `factorX = 10` (`axisMask = AXIS_MASK_X`)
- **THEN**: `out.xMin === 0` and `out.xMax === 100`

#### Scenario: Zero-span flat signal axis is a safe no-op
- **GIVEN**: a `ViewportTransform` with flat Y domain `yDomainMin = 5`, `yDomainMax = 5` (`yScale === 0`) and valid X domain `[0, 10]`
- **WHEN**: `computeZoomDomain` runs with `factorX = 0.5`, `factorY = 0.5`, `axisMask = AXIS_MASK_XY`
- **THEN**: X zooms cleanly while `out.yMin === 5` and `out.yMax === 5` remain unchanged with zero `NaN` or `Infinity`

### Requirement: Axis-Mask Resolution for Plot, Gutters, and Keyboard Modifiers
`resolveWheelAxisMask(region, wheelAxis, gutterInteraction, altKey, shiftKey)` MUST determine the active `axisMask` deterministically:
1. If `region === "outside"`: return `AXIS_MASK_NONE`.
2. If `gutterInteraction === true` and `region === "x-gutter"`: return `AXIS_MASK_X`.
3. If `gutterInteraction === true` and `region === "y-gutter"`: return `AXIS_MASK_Y`.
4. If `gutterInteraction === false` and `region !== "plot"`: return `AXIS_MASK_NONE`.
5. Inside `"plot"`:
   - If `altKey && !shiftKey`: return `AXIS_MASK_X`.
   - If `shiftKey && !altKey`: return `AXIS_MASK_Y`.
   - Otherwise follow configured `wheelAxis` (default `"xy"` $\to$ `AXIS_MASK_XY`; `"x"` $\to$ `AXIS_MASK_X`; `"y"` $\to$ `AXIS_MASK_Y`).

#### Scenario: Modifiers and gutters restrict wheel zoom to the intended single axis
- **GIVEN**: `wheelAxis = "xy"` and `gutterInteraction = true`
- **WHEN**: `resolveWheelAxisMask` is called for `("plot", false, false)`, `("plot", true, false)`, `("plot", false, true)`, `("x-gutter", false, false)`, and `("y-gutter", false, false)`
- **THEN**: the returned masks are `AXIS_MASK_XY`, `AXIS_MASK_X`, `AXIS_MASK_Y`, `AXIS_MASK_X`, and `AXIS_MASK_Y` respectively

### Requirement: Wheel-Burst `gestureActive` Latching and Trailing Settle
On the first active wheel zoom tick, `ViewportInteractionController` MUST call `controller.setGestureActive(true)`, transition `interaction.state` to `"wheeling"`, apply the mutated domain via `controller.setDomain(...)`, schedule coalesced frame rendering via `controller.requestRender()`, and arm a trailing settle timer for `settleDebounceMs` (default `120` ms). Each subsequent wheel tick arriving before the timer fires MUST reset the timer and keep `controller.gestureActive === true`. When the debounce timer expires, the controller MUST fire the trailing settled invalidation hook, transition `interaction.state` back to `"idle"`, call `controller.setGestureActive(false)` (flushing any deferred `canvas2d <-> webgl2` hysteresis swap), and schedule `controller.requestRender()`.

#### Scenario: Rapid wheel burst keeps gestureActive latched until settleDebounceMs elapses
- **GIVEN**: a `ViewportInteractionController` with `settleDebounceMs = 120` and injected fake timers
- **WHEN**: `10` wheel events are dispatched at `t = 0, 20, 40, ..., 180 ms`
- **THEN**: `controller.gestureActive` remains `true` at `t = 250 ms` (`70 ms` after last tick), and flips to `false` at `t = 300 ms` (`120 ms` after last tick) with `interaction.state === "idle"`
