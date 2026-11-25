# Spec: react-spectrum-component

## Requirements

### Requirement: Hydration-Safe Two-Layer Unmanaged DOM Structure
`TraceSpectrumViewer` MUST be implemented in pure TypeScript with `createElement` (no JSX runtime dependency) and MUST render a `[data-trace-kit-viewer]` outer `<div>` containing:
1. A childless `[data-trace-kit-surface]` `<div>` (`position: absolute; inset: 0; width: 100%; height: 100%`) dedicated exclusively to `SpectrumEngineController`'s managed canvases.
2. An optional sibling `[data-trace-kit-slot-overlay]` `<div>` (`position: absolute; inset: 0; pointer-events: none`) rendered ONLY when `renderOverlay` is supplied.
3. Optional trailing `children`.

#### Scenario: Overlay and children remain siblings of the unmanaged canvas surface
- **GIVEN**: `TraceSpectrumViewer` rendered with `renderOverlay` and `children`
- **WHEN**: `SpectrumEngineController` mounts and swaps 1-canvas Canvas2D <-> 3-canvas WebGL2 inside `[data-trace-kit-surface]`
- **THEN**: `[data-trace-kit-slot-overlay]` and `children` remain siblings of `[data-trace-kit-surface]` and are never cleared or touched by controller canvas swaps

### Requirement: Non-Colliding figureStyle Prop and Standard HTML Attributes
`TraceSpectrumViewer` MUST accept `figureStyle?: Partial<FigureStyle>` for renderer styling while forwarding standard `className`, `style`, and `id` onto the outer `[data-trace-kit-viewer]` container with `position: "relative"` preserved by default.

#### Scenario: style and figureStyle coexist without collision
- **GIVEN**: `TraceSpectrumViewer` rendered with `className="osa-stage"`, `style={{ height: "400px" }}`, and `figureStyle={{ backgroundColor: "#090c10" }}`
- **WHEN**: Mounted in the DOM
- **THEN**: The outer `[data-trace-kit-viewer]` carries `class="osa-stage"` and `height: 400px`, while `createSpectrumEngineController` receives `style: { backgroundColor: "#090c10" }`

### Requirement: Forwarded Imperative Handle and Event Callbacks
`TraceSpectrumViewer` MUST wrap `forwardRef` and expose `SpectrumEngineHandle` via `useImperativeHandle`, supporting both React 18 `forwardRef` and React 19 `ref` prop usage, and MUST forward all controller/interaction lifecycle callbacks (`onReady`, `onDomainChange`, `onInvalidate`, `onBoxSelect`, `onGestureStateChange`, `onEngineChange`, `onWebGL2Fallback`, `onContextLost`, `onContextRestored`).

#### Scenario: Parent ref accesses imperative methods and live controller handle
- **GIVEN**: A parent rendering `<TraceSpectrumViewer ref={viewerRef} onReady={onReady} />`
- **WHEN**: The component mounts
- **THEN**: `viewerRef.current` exposes `controller`, `interaction`, and all 11 imperative methods, and `onReady` receives `{ controller, interaction }`
