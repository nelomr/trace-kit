---
"@trace-kit/react": patch
---

Harden `@trace-kit/react` lifecycle, reactivity isolation, and tree-shaking: remove top-level `.displayName` side effect to preserve `/*#__PURE__*/` tree-shaking, reconcile dynamic `containerRef.current` transitions without leaks, declare `useSyncExternalStore` before passive effects for zero wasted mount renders under `subscribeState: false`, stabilize forwarded `useImperativeHandle` callback refs, batch prop-sync store notifications, and expand the parity test suite to 63 tests with `SIDE-EFFECTS.md`.
