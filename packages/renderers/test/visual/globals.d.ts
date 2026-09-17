/**
 * `__TRACEKIT_VISUAL_IS_LINUX_CI__` is a Vite `define` replacement, baked into the bundle at
 * config-evaluation time (Node-side, in `vitest.config.ts`) — never read from a runtime
 * global, since browser-mode test code executes in an actual browser where `process` does not
 * exist. See `vitest.config.ts`'s `visual` project entry.
 */
declare const __TRACEKIT_VISUAL_IS_LINUX_CI__: boolean;
