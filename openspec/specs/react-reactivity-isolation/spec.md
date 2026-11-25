# Spec: react-reactivity-isolation

## Requirements

### Requirement: Unmanaged Ref Isolation for Imperative Handles and Payloads
`@trace-kit/react` MUST store `SpectrumEngineController`, `ViewportInteractionController`, `SpectrumDataPayload`, and `TraceCollection` references exclusively in React refs (`useRef`) and MUST NEVER place them into React `useState` or trigger deep object cloning/serialization on ingress.

#### Scenario: Path A 60 Hz in-place streaming causes zero React re-renders
- **GIVEN**: A mounted `TraceSpectrumViewer` (or `useSpectrumEngine` consumer) attached to a `SpectrumDataPayload`
- **WHEN**: The producer mutates `payload.y` in place, calls `commitPayloadRevision(payload, n)`, and invokes `handle.requestRender()` across 60 consecutive animation frames while discrete metadata (`activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`) remains unchanged
- **THEN**: The host React component render count MUST increase by `0` across all 60 frames and `payload.y.buffer` identity MUST remain identical

### Requirement: Selective Metadata Store Notification
`useSpectrumEngine` MUST expose discrete metadata (`isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`) through a tear-free external store (`useSyncExternalStore`) that notifies subscribers ONLY when at least one of those 8 fields changes by `Object.is` (or 4-scalar coordinate inequality for `domain`).

#### Scenario: Overlay isolation prevents viewer re-renders during interactive pan/zoom
- **GIVEN**: A mounted `TraceSpectrumViewer` with a `renderOverlay` prop
- **WHEN**: User pan/zoom gestures update `domain` repeatedly via `ViewportInteractionController`
- **THEN**: Only the isolated overlay host component re-renders to display the new domain, while the outer `TraceSpectrumViewer` body and `[data-trace-kit-surface]` DOM node MUST NOT unmount or recreate canvases

### Requirement: Dual Echo Guard for Controlled Domain Synchronization
When a consumer controls `domain` via React state (`domain` + `onDomainChange`), `useSpectrumEngine` MUST suppress feedback loops using both 4-scalar coordinate comparison (`domainsEqual`) and object-identity membership in a `WeakSet<ViewportDomain>` of previously emitted snapshots.

#### Scenario: Controlled React state loop produces zero redundant setDomain calls
- **GIVEN**: A controlled consumer passing `domain={domain}` and `onDomainChange={setDomain}` to `TraceSpectrumViewer`
- **WHEN**: An interactive pan/zoom gesture emits a frozen `ViewportDomain` snapshot and React re-renders with that emitted snapshot (or a shallow copy with identical 4 coordinates)
- **THEN**: `controller.setDomain(...)` MUST NOT be re-invoked and `onDomainChange` MUST fire exactly once per gesture update
