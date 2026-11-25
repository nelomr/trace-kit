# Spec: react-ssr-and-lifecycle

## Requirements

### Requirement: Node SSR Isomorphism with Zero DOM Globals
Importing `@trace-kit/react` and rendering `TraceSpectrumViewer` via `react-dom/server` `renderToString` in a pure Node.js environment without `window`, `document`, `ResizeObserver`, or `HTMLCanvasElement` MUST succeed without throwing and MUST emit valid markup containing `data-trace-kit-viewer` and `data-trace-kit-surface`.

#### Scenario: renderToString succeeds in plain Node environment
- **GIVEN**: A Node.js environment where `typeof window === "undefined"` and `typeof document === "undefined"`
- **WHEN**: `@trace-kit/react` is imported and `renderToString(createElement(TraceSpectrumViewer, { data }))` is called
- **THEN**: Valid HTML markup containing `data-trace-kit-viewer` and `data-trace-kit-surface` is returned with zero thrown errors and zero controller instantiation

### Requirement: StrictMode Double-Mount Safety and Teardown Ordering
Under `<React.StrictMode>` (mount -> cleanup -> remount) and normal unmounting, `@trace-kit/react` MUST dispose `ViewportInteractionController` strictly BEFORE `SpectrumEngineController`, MUST null internal refs prior to invoking `.dispose()`, MUST remove all managed canvases and restore container `touchAction`, and MUST cleanly re-attach on the second StrictMode mount without leaking canvases or listeners.

#### Scenario: React.StrictMode double-invoke leaves exactly one active controller and zero leaked canvases
- **GIVEN**: `TraceSpectrumViewer` mounted inside `<React.StrictMode>` with a test spy controller and interaction factory
- **WHEN**: React executes mount -> cleanup -> remount, and later unmounts
- **THEN**: Cleanup disposes `interaction` strictly before `controller`, remount leaves exactly 1 live controller and expected canvas count, and final unmount leaves 0 canvases and 0 active listeners
