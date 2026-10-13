# Capability: playground-engine-parity-view

## Requirements

### Requirement: The View Draws One Scenario on Both Engines Side by Side
The view MUST let the user choose a scenario from the shared fixture set
(`SCENARIO_FIXTURES` from `@trace-kit/renderers/fixtures`) and MUST show two panes
side by side at the same CSS size (the fixture's viewport): the left is one `<canvas>` drawn by
`Canvas2DRenderer`; the right is a stack of three `<canvas>` elements (underlay, plot, overlay; same
CSS box, overlay on top) created by the view and passed as `surfaces` to `WebGL2FigureRenderer`, each applying the fixture through
`setData` or `setTraces`, `setDomain` and `resize` with the fixture's `dpr`. Each pane MUST carry a
visible label naming its engine. Fixture payloads MUST NOT be wrapped in a reactive proxy.

#### Scenario: Two labelled canvases of equal size appear
- **GIVEN**: the view mounted with a scenario selected and WebGL2 available (renderer factory
  injected as a fake in the happy-dom test)
- **WHEN**: it renders
- **THEN**: the Canvas2D pane has one `<canvas>` and the WebGL2 pane three stacked `<canvas>`
  elements, all with CSS width and height equal to the fixture's viewport, the panes labelled
  "Canvas2D" and "WebGL2"

#### Scenario: Changing the scenario redraws both
- **GIVEN**: the mounted view
- **WHEN**: another scenario is selected
- **THEN**: both renderers receive the new fixture (`setData`/`setTraces`, `setDomain`, `resize`,
  `render` recorded on each)

### Requirement: A Decimation Control Shows the Per-Engine Default
The view MUST provide a decimation selector with the options "Default", "LTTB" and "Min-Max".
"Default" MUST call `setDecimation(undefined)` on both renderers; "LTTB" and "Min-Max" MUST call
`setDecimation({ algorithm: "lttb" })` and `setDecimation({ algorithm: "min-max" })` on both. The
view MUST display, per pane, the vertex count of the last drawn frame, so the difference between
the Canvas2D default (LTTB at about twice the plot width) and the WebGL2 default (full payload) is
observable. Vertex counts MUST be derived from public renderer behaviour or injected
instrumentation, not from private fields.

#### Scenario: Selecting Default sends undefined to both
- **GIVEN**: the view with fake renderers recording `setDecimation`
- **WHEN**: "Default" is selected
- **THEN**: both fakes recorded `setDecimation(undefined)`

#### Scenario: Selecting LTTB sends the same selection to both
- **GIVEN**: the same view
- **WHEN**: "LTTB" is selected
- **THEN**: both recorded `setDecimation({ algorithm: "lttb" })`

#### Scenario: The vertex counts differ at the default on a dense fixture
- **GIVEN**: the `decimation-minmax` fixture (200,000 samples) with "Default" selected
- **WHEN**: the frame is drawn
- **THEN**: the Canvas2D pane's count is at most `2 * plotWidth` device pixels and the WebGL2
  pane's count is 200,000

### Requirement: Unavailable WebGL2 Degrades the Pane, Not the View
When constructing the `WebGL2FigureRenderer` throws, the view MUST NOT throw out of `mount`; it
MUST show an explicit message in the WebGL2 pane stating WebGL2 is unavailable and including the
error message, MUST keep the Canvas2D pane working, and MUST NOT substitute Canvas2D drawing in
the WebGL2 pane.

#### Scenario: A throwing WebGL2 constructor yields a message pane
- **GIVEN**: a renderer factory whose WebGL2 constructor throws `TypeError("webgl2 ...")`
- **WHEN**: the view mounts
- **THEN**: mount returns a teardown, the WebGL2 pane shows text containing "WebGL2" and
  "unavailable", and the Canvas2D canvas has been drawn

### Requirement: The View Balances Its Lifecycle
Unmounting MUST dispose both renderers, cancel any animation-frame callback and remove every
listener the view registered, and MUST leave no canvas in the DOM (`playground-routing` balanced
lifecycle). Each renderer MUST be disposed exactly once.

#### Scenario: Unmount disposes both and unregisters everything
- **GIVEN**: the view mounted with instrumented `addEventListener`/`removeEventListener` and
  `requestAnimationFrame`/`cancelAnimationFrame` and fake renderers
- **WHEN**: it is unmounted
- **THEN**: both fakes recorded exactly one `dispose`, registrations net to zero, and the host
  contains no `<canvas>`

#### Scenario: Remounting does not leak contexts
- **GIVEN**: the view mounted and unmounted ten times with recording fake renderers
- **WHEN**: the fakes' dispose counts are summed
- **THEN**: it equals the number of constructed renderers
