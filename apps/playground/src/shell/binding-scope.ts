import type { Pane } from "tweakpane";
import type { Bindable, BindingApi, BindingParams } from "@tweakpane/core";

// Split out of `panel.ts` deliberately: `panel.ts` constructs the single shared `Pane` at
// module scope, which requires a real DOM and therefore cannot be
// imported by a Node-side test. This helper has no DOM dependency of its own, so
// buffer-ownership logic that needs it (but not the shared panel itself) can import it
// without pulling a `new Pane()` construction into a Node test process.

export interface BindingScope {
  /** Adds a binding to `pane` and records the handle so `disposeAll` can remove it. */
  addBinding<TObject extends Bindable, TKey extends keyof TObject>(
    target: TObject,
    key: TKey,
    options?: BindingParams,
  ): BindingApi<unknown, TObject[TKey]>;
  /** Removes every binding this scope minted from the pane. Called once, at teardown. */
  disposeAll(): void;
}

/**
 * A per-view binding-handle tracking helper: every `addBinding` call through the returned
 * scope is recorded, and `disposeAll` calls `pane.remove(handle)` for each one — the mechanism
 * that makes "a view's panel contributions are removed on unmount" true without the view
 * itself having to remember what it added.
 */
export function withBindingScope(pane: Pane): BindingScope {
  const handles: Array<BindingApi<unknown, unknown>> = [];
  return {
    addBinding(target, key, options) {
      const handle = pane.addBinding(target, key, options);
      handles.push(handle);
      return handle;
    },
    disposeAll() {
      for (const handle of handles) {
        pane.remove(handle);
      }
      handles.length = 0;
    },
  };
}
