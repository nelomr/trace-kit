import type { RoutePath, ViewDefinition } from "./view.js";

// Additive registration only. A view registers itself by calling `registerView` from its own
// module; no shell file names a view, so adding a route is a new file plus one import line in
// `views/index.ts`, never an edit here.
const registry = new Map<RoutePath, ViewDefinition>();

/** Additive registration. Throws on a duplicate path — a silent overwrite is a bug, not a merge. */
export function registerView(definition: ViewDefinition): void {
  if (registry.has(definition.path)) {
    throw new Error(`a view is already registered at "${definition.path}"`);
  }
  registry.set(definition.path, definition);
}

/** Resolution. Returns `undefined` for an unknown path; the router renders a not-found panel. */
export function resolveView(path: RoutePath): ViewDefinition | undefined {
  return registry.get(path);
}

/** The registered set, for the nav and for the "resolves exactly the registered views" test. */
export function registeredViews(): readonly ViewDefinition[] {
  return Array.from(registry.values());
}
