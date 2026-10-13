# Capability: webgl2-plot-surface

## Requirements

### Requirement: The Caller Supplies Three Stacked Surfaces; the Renderer Creates No DOM
Rationale: a canvas that has produced a `2d` context can never yield a `webgl2` context, so one visible 2D canvas cannot host the WebGL2 renderer without copying its pixels. A design that drew into a hidden GL canvas and composited it onto the visible 2D canvas with `drawImage` each frame measured p95 11.0-17.5 ms on a Metal GPU (Intel Iris Plus) and 17.4-21.5 ms on SwiftShader at 1600x1200, against a 4.0 ms frame-copy budget, and was rejected. Three stacked canvases (an opaque 2D underlay for background and grid, a transparent WebGL2 plot canvas, and a transparent 2D overlay for axes, ticks and labels) reproduce the Canvas2D paint order with no copy.

The constructor of `WebGL2FigureRenderer` MUST accept `{ surfaces }` with
`surfaces: WebGL2FigureSurfaces`, an exported interface of three readonly fields `underlay`,
`plot` and `overlay`, each `HTMLCanvasElement | OffscreenCanvas`. The three MUST be distinct
objects, otherwise the constructor throws a `TypeError`. The renderer MUST acquire the underlay's
context with `acquire2dContext`, the overlay's with a `2d` request whose `alpha` is `true` (the
overlay must be transparent), and the plot canvas's with `getContext("webgl2", attributes)`, where
`attributes` has `alpha: true`, `premultipliedAlpha: true` and `antialias: false` and its other fields are the fixed values of `GL_CONTEXT_ATTRIBUTES`. It MUST NOT request any other context id on any surface. It MUST
NOT create, insert, style or position any DOM element or canvas: stacking the three canvases
(same CSS box, underlay below, overlay above) is the caller's responsibility. No public member MUST
expose a GL context or a GL object.

#### Scenario: Each surface receives exactly its own context request
- **GIVEN**: three surface fakes that record every `getContext` call, the plot fake returning the
  recording fake GL
- **WHEN**: `new WebGL2FigureRenderer({ surfaces })` is called
- **THEN**: the underlay received exactly one `getContext("2d", ...)`, the overlay exactly one
  `getContext("2d", ...)` with `alpha: true`, the plot exactly one `getContext("webgl2", ...)`, and
  no other call was made

#### Scenario: Identical surfaces are rejected
- **GIVEN**: `surfaces` whose `underlay` and `overlay` are the same canvas
- **WHEN**: the constructor runs
- **THEN**: it throws a `TypeError` and requests no context

#### Scenario: No GL type is reachable from the public declaration
- **GIVEN**: the compiled declaration of `WebGL2FigureRenderer`, its options and
  `WebGL2FigureSurfaces`
- **WHEN**: the member and parameter types are inspected
- **THEN**: none references `WebGL2RenderingContext`, `WebGLProgram` or `WebGLBuffer`

#### Scenario: The renderer creates no DOM
- **GIVEN**: the `webgl2` sources
- **WHEN**: they are searched for `createElement`, `appendChild`, `new OffscreenCanvas` and `style.`
- **THEN**: there is no match

#### Scenario: A WebGL2 smoke test runs in the visual project
- **GIVEN**: the `visual` Vitest project
- **WHEN**: the smoke test creates a canvas, requests `webgl2` and clears it to a color
- **THEN**: the context is non-null and `readPixels` returns that color

### Requirement: All Three Backing Stores Track the Same Device Size
`resize(width, height, dpr)` MUST set `width` and `height` of all three surfaces to
`round(width * dpr)` and `round(height * dpr)` device pixels and recompute `transform` and the
shared `FigureLayout`. The GL viewport used by every draw MUST be `(0, 0, deviceWidth, deviceHeight)`
of the same transform. `resize` MUST NOT issue any draw, clear or paint call. `dpr` is injected and
MUST NOT be read from a global.

#### Scenario: All surfaces get the same device size
- **GIVEN**: a renderer over the three fakes
- **WHEN**: `resize(800, 600, 2)` is called
- **THEN**: all three surfaces report `width === 1600` and `height === 1200`, and the recording
  fakes show no drawing call

#### Scenario: A fractional dpr rounds like Canvas2D
- **GIVEN**: `resize(333, 211, 1.5)`
- **WHEN**: the sizes are read
- **THEN**: all three surfaces are `500 x 317`

#### Scenario: The GL viewport matches the device size
- **GIVEN**: the renderer after `resize(800, 600, 2)`
- **WHEN**: `render()` runs on the recording fake GL
- **THEN**: the recorded `viewport` call is `(0, 0, 1600, 1200)`

### Requirement: Layer Order Reproduces Canvas2D's Paint Order
`render()` MUST paint, in this order: (1) on the underlay, reset the transform to identity, fill the
background over the full backing store, then the X and Y gridlines; (2) on the plot canvas, clear to
fully transparent `(0, 0, 0, 0)` and draw the trace and marker passes; (3) on the overlay, reset the
transform to identity, clear the full backing store to transparent with `clearRect`, then paint the
bottom axis and every Y axis column. With the underlay below the plot canvas and the overlay above
it, the composited figure has Canvas2D's order: background, grid, traces, axes. `render()` MUST NOT
copy pixels between surfaces and MUST NOT rely on `preserveDrawingBuffer`. `clear()` MUST paint the
background on the underlay, clear the overlay and clear the plot canvas to transparent.

#### Scenario: The recorded order is complete and fixed
- **GIVEN**: a renderer over recording 2D fakes and the recording GL fake sharing one ordered log,
  with data present
- **WHEN**: `render()` runs
- **THEN**: the log shows the underlay background `fillRect` and every gridline stroke, then the GL
  `clear` and draw calls, then the overlay `clearRect` and every axis line, tick and label call, and
  no `drawImage` anywhere

#### Scenario: Grid lies under the trace in a real browser
- **GIVEN**: a real Chromium page with the three canvases stacked, rendering a trace that crosses a
  gridline
- **WHEN**: the composited page pixels are read at the crossing and on the gridline far from the trace
- **THEN**: the crossing has the trace color and the far pixel has the gridline color

#### Scenario: An empty payload still clears every layer
- **GIVEN**: a payload with `sampleCount = 0`
- **WHEN**: `render()` runs
- **THEN**: the underlay is painted, the GL `clear` and the overlay `clearRect` are recorded, and no
  `drawArraysInstanced`

### Requirement: Axes, Grid and Labels Reuse the Canvas2D Axes Code and `FigureLayout`
The renderer MUST paint gridlines on the underlay and axes on the overlay by calling the existing
`drawXGridlines`, `drawYGridlines`, `drawBottomAxis` and `drawLeftAxis` with a `FigureLayout`
created and updated by the shared `createFigureLayout`, `updateFigureGeometry` and
`refreshFigureTicks`. It MUST NOT re-implement tick selection, label formatting, insets, column
offsets or decade gridlines, and MUST NOT draw text in GL. Dual-axis figures MUST draw one stacked
column per registered Y axis exactly as Canvas2D does. The axes functions MUST NOT be modified to suit the WebGL2 renderer.

#### Scenario: The axis painters receive the shared layout
- **GIVEN**: spies on the four axis functions and the layout functions
- **WHEN**: `render()` runs for a two-axis (`yAxes` of length 2) figure
- **THEN**: `drawXGridlines` is called once, `drawYGridlines` and `drawLeftAxis` twice each with
  the layout's per-axis transforms, ticks and `axisColumnOffsets`, and `drawBottomAxis` once; the
  gridline painters receive the underlay context and the axis painters the overlay context

#### Scenario: Axis pixels are identical between engines
- **GIVEN**: the `axes-grid` fixture, applied unmodified (its payload included), rendered on both
  engines in Chromium, the WebGL2 layers composed in the same task
- **WHEN**: the two figures are compared outside the plot rectangle grown by
  `ceil(lineWidthCss * dpr) + K_INSET` device pixels
- **THEN**: the pixels are identical (the same painters run on the same layout)

#### Scenario: No text is drawn through GL
- **GIVEN**: the `webgl2` sources and the recording fake GL
- **WHEN**: they are searched for `fillText` on the GL path, `texImage2D` of label bitmaps and text atlases
- **THEN**: none appears

### Requirement: The Overlay Uses a Narrow Context Type and Leaves `TraceDrawingContext` Unchanged
The overlay context MUST be typed through an internal interface that extends `TraceDrawingContext`
with only `clearRect(x: number, y: number, w: number, h: number): void`. `TraceDrawingContext` and
`RecordingContext` MUST NOT be modified. Acquisition MUST NOT use `any`, `as any`, `as unknown as`
or a suppressing assertion.

#### Scenario: Canvas2D fakes are untouched
- **GIVEN**: `TraceDrawingContext` and `RecordingContext`
- **WHEN**: their members are compared with the pre-change declaration
- **THEN**: they are identical

### Requirement: Unavailable Contexts Are Observable Construction Errors With No Fallback
When the plot surface's `getContext("webgl2", ...)` returns `null` (including a canvas that already
produced a `2d` context), or when the underlay's or overlay's `getContext("2d")` returns `null`,
the constructor MUST throw a `TypeError` synchronously whose message names the missing context
kind (`webgl2` or `2d`) and the surface (`underlay`, `plot` or `overlay`), after releasing anything it
created. The renderer MUST NOT fall back to Canvas2D drawing or to a software path: engine switching
is owned by the later `engine-controller` step.

#### Scenario: A null webgl2 context throws a TypeError naming webgl2
- **GIVEN**: a plot-surface fake whose `getContext("webgl2")` returns `null`
- **WHEN**: `new WebGL2FigureRenderer({ surfaces })` is called
- **THEN**: it throws a `TypeError` whose message contains `webgl2` and `plot`

#### Scenario: A plot canvas that already holds a 2d context is rejected
- **GIVEN**: a real `HTMLCanvasElement` on which `getContext("2d")` has already been called, passed
  as `plot`, in Chromium
- **WHEN**: the constructor runs
- **THEN**: it throws a `TypeError` naming `webgl2`

#### Scenario: A null 2d context throws a TypeError naming 2d
- **GIVEN**: an underlay whose `getContext("2d")` returns `null` (the happy-dom default)
- **WHEN**: the constructor runs
- **THEN**: it throws a `TypeError` whose message contains `2d`

#### Scenario: No fallback code path exists
- **GIVEN**: the `webgl2` sources
- **WHEN**: they are searched for an import of `Canvas2DRenderer` and for `try`/`catch` around the
  context acquisition that continues construction
- **THEN**: there is none

