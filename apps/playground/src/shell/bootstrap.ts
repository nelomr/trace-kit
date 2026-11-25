import "../styles/tokens.css";
import "../styles/base.css";
import { sharedPanel } from "./panel.js";
import { createRouter } from "./router.js";
import { asRoutePath, type RoutePath } from "./view.js";
// The sole registration side-effect import. Every later view adds itself by adding one line
// inside `views/index.ts` — this file never grows past this one import.
import "../views/index.ts";

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

const root = document.getElementById("app");
if (!root) {
  throw new Error('index.html is missing its "#app" host element.');
}

// Persistent minimal navigation bar for non-home lab views so users can jump back to Home
// or switch to the companion Vue 3 OSA-1550 sandbox without relying on browser Back.
const navBar = document.createElement("nav");
navBar.setAttribute("aria-label", "Playground navigation");
navBar.style.cssText =
  "display:none;align-items:center;justify-content:space-between;gap:0.75rem;" +
  "padding:0.45rem 0.9rem;border-bottom:1px solid var(--tk-color-border,#1c2530);" +
  "background:var(--tk-color-surface,#10161d);font-family:ui-monospace,monospace;font-size:12px";

const navLeft = document.createElement("div");
navLeft.style.cssText = "display:flex;align-items:center;gap:0.75rem";

const homeLink = document.createElement("a");
homeLink.href = "#/home";
homeLink.textContent = "← Home";
homeLink.style.cssText =
  "display:inline-flex;align-items:center;padding:0.2rem 0.55rem;border:1px solid var(--tk-color-border,#1c2530);" +
  "border-radius:4px;background:var(--tk-color-surface-raised,#161e27);color:var(--tk-color-text,#e6edf5);" +
  "text-decoration:none;font-weight:600";

const routeBadge = document.createElement("span");
routeBadge.style.cssText = "color:var(--tk-color-text-muted,#8a97a8)";

navLeft.append(homeLink, routeBadge);

const vueLink = document.createElement("a");
vueLink.href = "./vue/";
vueLink.textContent = "Vue 3 OSA Sandbox →";
vueLink.style.cssText =
  "display:inline-flex;align-items:center;padding:0.2rem 0.55rem;border:1px solid var(--tk-color-accent,#3fb6ff);" +
  "border-radius:4px;color:var(--tk-color-accent,#3fb6ff);text-decoration:none;font-weight:600";

navBar.append(navLeft, vueLink);

const container = document.createElement("div");
container.id = "tk-view-host";
root.append(navBar, container);

function syncNavBar(): void {
  const hash = location.hash.slice(1);
  const isHome = hash.length === 0 || hash === "/home";
  navBar.style.display = isHome ? "none" : "flex";
  routeBadge.textContent = isHome ? "" : `TraceKit Vanilla Lab · ${hash}`;
}

window.addEventListener("hashchange", syncNavBar);

const router = createRouter({ container, panel: sharedPanel });

// No hash on load (a bare "/" visit, or a hash the router couldn't parse) lands on the
// landing view rather than a "not found" panel. Setting `location.hash` — instead of calling
// `router.navigate("/home")` directly — keeps there being exactly one path that drives a
// navigation (the router's own `hashchange` listener), so the address bar, back/forward, and
// a page refresh all agree with what's on screen.
const initialPath = currentPathFromHash();
if (initialPath) {
  syncNavBar();
  void router.navigate(initialPath);
} else {
  location.hash = "/home";
  syncNavBar();
}
