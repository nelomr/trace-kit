import { registeredViews } from "../../shell/registry.js";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";

/**
 * The landing view, reached at `/home` and as the default when the hash is empty. Lists every
 * other registered view as an interactive lab card alongside a direct link to the companion
 * Vue 3 Instrument Sandbox (`./vue/`). Native hash navigation (`<a href="#/path">`) handles
 * route transitions — the router's own `hashchange` listener reacts to it — so this view adds
 * no listener of its own and its teardown is a plain DOM removal.
 *
 * Reads `registeredViews()` at mount time, after every view module has registered itself
 * through `views/index.ts`'s import chain, so the list is always the real registered set and
 * never hand-maintained.
 */
export function mount(host: ViewHost): ViewTeardown {
  const root = document.createElement("div");
  root.style.cssText =
    "max-width:960px;margin:0 auto;padding:var(--tk-space-6) 0;" +
    "font-family:var(--tk-font-family);color:var(--tk-color-text);";

  const header = document.createElement("header");
  header.style.cssText =
    "border-bottom:1px solid var(--tk-color-border);padding-bottom:var(--tk-space-6);" +
    "margin-bottom:var(--tk-space-6);";

  const eyebrow = document.createElement("div");
  eyebrow.textContent = "TRACEKIT // VANILLA TS LABORATORY";
  eyebrow.style.cssText =
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;" +
    "letter-spacing:0.08em;color:var(--tk-color-accent);margin-bottom:var(--tk-space-2);";
  header.appendChild(eyebrow);

  const heading = document.createElement("h1");
  heading.textContent = "TraceKit Playground";
  heading.style.cssText =
    "font-size:var(--tk-font-size-xl);line-height:1.2;margin:0 0 var(--tk-space-2) 0;" +
    "letter-spacing:-0.015em;";
  header.appendChild(heading);

  const intro = document.createElement("p");
  intro.textContent =
    "Zero-framework testbed for @trace-kit/core decimation kernels, dual-engine Canvas2D/WebGL2 " +
    "orchestration, viewport interaction math, streaming transport, and publication-grade SVG export.";
  intro.style.cssText =
    "margin:0;max-width:68ch;color:var(--tk-color-text-muted);font-size:var(--tk-font-size-base);";
  header.appendChild(intro);
  root.appendChild(header);

  const companionBanner = document.createElement("section");
  companionBanner.style.cssText =
    "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;" +
    "gap:var(--tk-space-4);padding:var(--tk-space-4);margin-bottom:var(--tk-space-6);" +
    "background:var(--tk-color-surface);border:1px solid var(--tk-color-border);" +
    "border-left:3px solid var(--tk-color-accent);border-radius:var(--tk-radius-sm);";

  const companionCopy = document.createElement("div");
  const companionTitle = document.createElement("div");
  companionTitle.textContent = "Vue 3 Optical Spectrum Analyzer Sandbox";
  companionTitle.style.cssText =
    "font-weight:600;font-size:var(--tk-font-size-base);margin-bottom:2px;";
  companionCopy.appendChild(companionTitle);

  const companionDesc = document.createElement("div");
  companionDesc.textContent =
    "Full-bleed OSA-1550 benchtop workbench powered by @trace-kit/vue with zero-proxy telemetry, " +
    "60 Hz streaming, log-Y power scaling, and live WebGL2 context loss/recovery.";
  companionDesc.style.cssText =
    "color:var(--tk-color-text-muted);font-size:var(--tk-font-size-sm);max-width:60ch;";
  companionCopy.appendChild(companionDesc);
  companionBanner.appendChild(companionCopy);

  const vueLink = document.createElement("a");
  vueLink.href = "./vue/";
  vueLink.textContent = "Launch Vue 3 Instrument Sandbox ->";
  vueLink.style.cssText =
    "display:inline-flex;align-items:center;padding:0.55rem 0.95rem;" +
    "background:var(--tk-color-surface-raised);border:1px solid var(--tk-color-accent);" +
    "border-radius:var(--tk-radius-sm);color:var(--tk-color-accent);text-decoration:none;" +
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--tk-font-size-sm);" +
    "font-weight:600;white-space:nowrap;";
  companionBanner.appendChild(vueLink);
  root.appendChild(companionBanner);

  const sectionTitle = document.createElement("h2");
  sectionTitle.textContent = "Registered Verification Views";
  sectionTitle.style.cssText =
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;" +
    "text-transform:uppercase;letter-spacing:0.08em;color:var(--tk-color-text-muted);" +
    "margin:0 0 var(--tk-space-3) 0;";
  root.appendChild(sectionTitle);

  const list = document.createElement("ul");
  list.style.cssText =
    "list-style:none;padding:0;margin:0;display:grid;" +
    "grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--tk-space-3);";

  const views = registeredViews().filter((view) => view.path !== "/home");
  if (views.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No views registered yet.";
    empty.style.cssText =
      "color:var(--tk-color-text-muted);padding:var(--tk-space-4);" +
      "background:var(--tk-color-surface);border:1px solid var(--tk-color-border);" +
      "border-radius:var(--tk-radius-sm);";
    list.appendChild(empty);
  }
  for (const view of views) {
    const item = document.createElement("li");
    item.style.margin = "0";

    const link = document.createElement("a");
    link.href = `#${view.path}`;
    link.style.cssText =
      "display:flex;flex-direction:column;gap:var(--tk-space-1);height:100%;" +
      "padding:var(--tk-space-4);background:var(--tk-color-surface);" +
      "border:1px solid var(--tk-color-border);border-radius:var(--tk-radius-sm);" +
      "text-decoration:none;color:var(--tk-color-text);";

    const labelEl = document.createElement("span");
    labelEl.textContent = view.label;
    labelEl.style.cssText = "font-weight:600;font-size:var(--tk-font-size-base);";
    link.appendChild(labelEl);

    const routeEl = document.createElement("span");
    routeEl.textContent = `#${view.path}`;
    routeEl.style.cssText =
      "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;" +
      "color:var(--tk-color-accent);";
    link.appendChild(routeEl);

    item.appendChild(link);
    list.appendChild(item);
  }
  root.appendChild(list);

  host.container.appendChild(root);

  return () => {
    root.remove();
  };
}
