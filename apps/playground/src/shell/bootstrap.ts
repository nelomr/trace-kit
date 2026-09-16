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

const container = document.getElementById("app");
if (!container) {
  throw new Error('index.html is missing its "#app" host element.');
}

const router = createRouter({ container, panel: sharedPanel });

// No hash on load (a bare "/" visit, or a hash the router couldn't parse) lands on the
// landing view rather than a "not found" panel. Setting `location.hash` — instead of calling
// `router.navigate("/home")` directly — keeps there being exactly one path that drives a
// navigation (the router's own `hashchange` listener), so the address bar, back/forward, and
// a page refresh all agree with what's on screen.
const initialPath = currentPathFromHash();
if (initialPath) {
  void router.navigate(initialPath);
} else {
  location.hash = "/home";
}
