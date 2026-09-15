import type { Pane } from "tweakpane";
import { asRoutePath, type RoutePath, type ViewTeardown } from "./view.js";
import { resolveView } from "./registry.js";

export interface RouterOptions {
  readonly container: HTMLElement;
  readonly panel: Pane;
}

export interface Router {
  /**
   * Resolves and mounts `path` (or renders "not found" for `undefined`/an unresolved path),
   * awaiting the previous view's teardown first. Exposed directly (rather than only through
   * `hashchange`) so a caller can await the full mount/unmount cycle deterministically.
   */
  navigate(path: RoutePath | undefined): Promise<void>;
}

/**
 * Constructs the hashchange-driven router (design.md §D3, §D4, §D7). On every navigation it
 * builds a fresh `AbortController`, aborts the previous mount's controller and awaits its
 * teardown, then mounts the next view with the new controller's signal. Hash-based routing
 * only (`location.hash`) — no History API, per §D4.
 */
export function createRouter(options: RouterOptions): Router {
  const { container, panel } = options;
  let activeController: AbortController | undefined;
  let activeTeardown: ViewTeardown | undefined;
  let panelChildCountBeforeMount = panel.children.length;

  async function navigate(path: RoutePath | undefined): Promise<void> {
    const previousController = activeController;
    const previousTeardown = activeTeardown;
    const previousPanelChildCount = panelChildCountBeforeMount;
    activeController = undefined;
    activeTeardown = undefined;

    previousController?.abort();
    if (previousTeardown) {
      await previousTeardown();
    }

    // A view's `tweakpane` contributions are reclaimed by diffing the shared panel's child
    // count around the mount, the same "assert by platform-observed count, not by
    // self-reporting" discipline used for listeners and animation frames: the view never has
    // to remember or return what it added, and a contribution it forgot to remove cannot
    // silently outlive the view because the diff removes it regardless.
    for (const child of panel.children.slice(previousPanelChildCount)) {
      panel.remove(child);
    }

    container.replaceChildren();

    const definition = path ? resolveView(path) : undefined;
    if (!definition) {
      const notFound = document.createElement("p");
      notFound.textContent = "Not found.";
      container.appendChild(notFound);
      return;
    }

    panelChildCountBeforeMount = panel.children.length;
    const controller = new AbortController();
    activeController = controller;
    activeTeardown = await definition.mount({
      container,
      panel,
      signal: controller.signal,
    });
  }

  function currentPathFromHash(): RoutePath | undefined {
    const raw = location.hash.slice(1);
    if (raw.length === 0) {
      return undefined;
    }
    try {
      return asRoutePath(raw);
    } catch {
      return undefined;
    }
  }

  window.addEventListener("hashchange", () => {
    void navigate(currentPathFromHash());
  });

  return { navigate };
}
