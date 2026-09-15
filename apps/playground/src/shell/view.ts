import type { Pane } from "tweakpane";

/** Branded so a stray string cannot be passed where a registered route is required. */
declare const RoutePathBrand: unique symbol;
export type RoutePath = string & { readonly [RoutePathBrand]: "trace-kit.playground-route" };

/** The only way to mint a RoutePath. Enforces the leading-slash convention. */
export function asRoutePath(value: string): RoutePath {
  if (!value.startsWith("/") || value.length < 2) {
    throw new RangeError(
      `a route path must start with "/" and be non-empty; received "${value}"`,
    );
  }
  return value as RoutePath;
}

/** Everything a view is given at mount. Extended additively by later changes. */
export interface ViewHost {
  /** The element the view owns. The shell empties it after unmount resolves. */
  readonly container: HTMLElement;
  /** The ONE shared tweakpane root. */
  readonly panel: Pane;
  /**
   * Aborted immediately before `unmount` is awaited. A view that passes this to every
   * `addEventListener({ signal })` call satisfies the listener half of the balanced-lifecycle
   * requirement without writing a single `removeEventListener`.
   */
  readonly signal: AbortSignal;
}

/**
 * Returned by `mount`. Async because a WebGL-owning view may release a context
 * (`WEBGL_lose_context.loseContext()`) and await a pending frame before doing so.
 */
export type ViewTeardown = () => void | Promise<void>;

export interface ViewDefinition {
  readonly path: RoutePath;
  /** Human-readable nav label. */
  readonly label: string;
  /** Mounts the view. MUST return the teardown that reverses everything it did. */
  mount(host: ViewHost): ViewTeardown | Promise<ViewTeardown>;
}
