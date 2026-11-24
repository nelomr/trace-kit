/**
 * Package-internal recovery seam for `WebGL2FigureRenderer`.
 *
 * Uses `Symbol.for("trace-kit.webgl2.recovery")` resolved lazily inside helper functions so the
 * module has zero top-level side effects and resolves identically across separate ESM and CJS
 * bundles without widening `FigureRenderer` or `WebGL2FigureRenderer.prototype`.
 */

const RECOVERY_SYMBOL_KEY = "trace-kit.webgl2.recovery";

export interface WebGL2RecoveryHandle {
  readonly isContextLost: () => boolean;
  readonly rehydrate: () => void;
}

export function attachRecoveryHandle(target: object, handle: WebGL2RecoveryHandle): void {
  Object.defineProperty(target, Symbol.for(RECOVERY_SYMBOL_KEY), {
    value: handle,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

function isRecoveryHandle(value: unknown): value is WebGL2RecoveryHandle {
  if (typeof value !== "object" || value === null) return false;
  const isContextLost: unknown = Reflect.get(value, "isContextLost");
  const rehydrate: unknown = Reflect.get(value, "rehydrate");
  return typeof isContextLost === "function" && typeof rehydrate === "function";
}

export function getRecoveryHandle(renderer: object): WebGL2RecoveryHandle | null {
  const candidate: unknown = Reflect.get(renderer, Symbol.for(RECOVERY_SYMBOL_KEY));
  return isRecoveryHandle(candidate) ? candidate : null;
}
