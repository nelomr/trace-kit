import { registeredViews } from "../../shell/registry.js";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";

/**
 * The landing view, reached at `/home` and as the default when the hash is empty. Lists every
 * other registered view as a link. Native hash navigation (`<a href="#/path">`) handles the
 * click — the router's own `hashchange` listener reacts to it — so this view adds no listener
 * of its own and its teardown is a plain DOM removal.
 *
 * Reads `registeredViews()` at mount time, after every view module has registered itself
 * through `views/index.ts`'s import chain, so the list is always the real registered set and
 * never hand-maintained.
 */
export function mount(host: ViewHost): ViewTeardown {
  const root = document.createElement("div");
  root.style.maxWidth = "640px";
  root.style.margin = "2rem auto";
  root.style.fontFamily = "system-ui, sans-serif";

  const heading = document.createElement("h1");
  heading.textContent = "TraceKit Playground";
  heading.style.fontSize = "1.5rem";
  heading.style.marginBottom = "0.25rem";
  root.appendChild(heading);

  const intro = document.createElement("p");
  intro.textContent =
    "A live sandbox for @trace-kit/core's decimation algorithms, and for the renderers and " +
    "framework adapters that later changes add.";
  intro.style.color = "#666";
  root.appendChild(intro);

  const list = document.createElement("ul");
  list.style.listStyle = "none";
  list.style.padding = "0";
  list.style.marginTop = "1.5rem";

  const views = registeredViews().filter((view) => view.path !== "/home");
  if (views.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No views registered yet.";
    empty.style.color = "#888";
    list.appendChild(empty);
  }
  for (const view of views) {
    const item = document.createElement("li");
    item.style.margin = "0.5rem 0";
    const link = document.createElement("a");
    link.href = `#${view.path}`;
    link.textContent = view.label;
    link.style.fontSize = "1.1rem";
    link.style.textDecoration = "none";
    link.style.color = "#2563eb";
    item.appendChild(link);
    list.appendChild(item);
  }
  root.appendChild(list);

  host.container.appendChild(root);

  return () => {
    root.remove();
  };
}
