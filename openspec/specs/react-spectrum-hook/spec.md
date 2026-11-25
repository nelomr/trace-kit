# Spec: react-spectrum-hook

## Requirements

### Requirement: Hook Signature and Exact Imperative Handle Surface
`@trace-kit/react` MUST export `useSpectrumEngine(containerRef, options?)` returning stable ref handles (`controllerRef`, `interactionRef`), current reactive metadata (`isReady`, `activeKind`, `mode`, `domain`, `sampleCount`, `contextLost`, `webgl2Fallback`, `gestureState`), external-store subscription accessors (`subscribe`, `getSnapshot`), and 11 no-op-guarded imperative methods (`render`, `requestRender`, `clear`, `setDomain`, `resize`, `retryWebGL2`, `resetDomain`, `zoomByFactor`, `panByFraction`, `cancelGesture`, `dispose`).

#### Scenario: Pre-mount and post-dispose imperative calls are safe no-ops
- **GIVEN**: A `useSpectrumEngine` handle before attachment or after `dispose()`
- **WHEN**: Every imperative method (`render`, `requestRender`, `clear`, `setDomain`, `resize`, `retryWebGL2`, `resetDomain`, `zoomByFactor`, `panByFraction`, `cancelGesture`, `dispose`) is invoked
- **THEN**: No method throws, `retryWebGL2()`/`zoomByFactor()`/`panByFraction()` return `false`, and `dispose()` is idempotent

### Requirement: Fail-Fast Data and Traces Mutual Exclusivity
`useSpectrumEngine` MUST throw a synchronous `TypeError` if both `data` and `traces` are provided as non-nullish values simultaneously, before mutating the underlying controller.

#### Scenario: Simultaneous data and traces throws TypeError
- **GIVEN**: A `useSpectrumEngine` call or update passing both a `SpectrumDataPayload` in `data` and a `TraceCollection` in `traces`
- **WHEN**: The hook mounts or synchronizes options
- **THEN**: A `TypeError` is thrown synchronously and neither `setData` nor `setTraces` is called with conflicting state

### Requirement: Ordered Imperative Synchronization and Callback Stability
On mount and option updates, `useSpectrumEngine` MUST apply `data`/`traces` strictly before `domain`, coalesce multiple prop changes in a single commit into at most one `requestRender()`, and MUST keep event callbacks fresh via ref indirection so changing inline callback props NEVER tears down or recreates `SpectrumEngineController`.

#### Scenario: Data and domain update together in one React commit
- **GIVEN**: A mounted `useSpectrumEngine` instance
- **WHEN**: A React re-render simultaneously updates `data`, `domain`, `mode`, `decimation`, and passes fresh inline callback closures
- **THEN**: `setData` runs strictly before `setDomain`, `requestRender()` is invoked at most once, the controller instance identity is preserved, and subsequent events invoke the newest callback closure
