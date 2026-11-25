# @trace-kit/react

## 0.0.3

### Patch Changes

- [`d22963e`](https://github.com/nelomr/trace-kit/commit/d22963ec282e6943039484ab7a7a1d15e8595e71) Thanks [@nelomr](https://github.com/nelomr)! - Harden `@trace-kit/react` lifecycle, reactivity isolation, and tree-shaking: remove top-level `.displayName` side effect to preserve `/*#__PURE__*/` tree-shaking, reconcile dynamic `containerRef.current` transitions without leaks, declare `useSyncExternalStore` before passive effects for zero wasted mount renders under `subscribeState: false`, stabilize forwarded `useImperativeHandle` callback refs, batch prop-sync store notifications, and expand the parity test suite to 63 tests with `SIDE-EFFECTS.md`.

## 0.0.2

### Patch Changes

- [`15d761b`](https://github.com/nelomr/trace-kit/commit/15d761b40a7b9b1241e61c216765a7a4cc4665e7) Thanks [@nelomr](https://github.com/nelomr)! - Add `@trace-kit/react` (Step 11 `react-adapter`): unmanaged-canvas `useSpectrumEngine` hook, pure-TypeScript `forwardRef` `<TraceSpectrumViewer>` with isolated `<OverlayHost>`, `snapshotDomain`, selective `useSyncExternalStore` reactivity isolation (0 React re-renders during 60 Hz Path A streaming), dual echo guard for controlled `domain`, `<React.StrictMode>` double-invoke safety, and Node SSR `renderToString` isomorphism.
