/**
 * Single reusable sibling `<div data-trace-kit-overlay="box-zoom">` appended directly to
 * `SpectrumEngineController.container`. Updated exclusively via CSS `transform: translate3d(...)`,
 * `width`, `height`, and `display` so box-zoom sweeps trigger zero canvas repaints.
 */

const OVERLAY_ATTR = "data-trace-kit-overlay";
const OVERLAY_ROLE = "box-zoom";

function createOverlayElement(container: HTMLElement): HTMLDivElement {
  const el = container.ownerDocument.createElement("div");
  el.setAttribute(OVERLAY_ATTR, OVERLAY_ROLE);
  el.style.position = "absolute";
  el.style.left = "0";
  el.style.top = "0";
  el.style.pointerEvents = "none";
  el.style.willChange = "transform";
  el.style.display = "none";
  el.style.boxSizing = "border-box";
  el.style.border = "1px solid rgba(63, 182, 255, 0.9)";
  el.style.background = "rgba(63, 182, 255, 0.16)";
  return el;
}

export class BoxZoomOverlay {
  #element: HTMLDivElement | null;
  #visible = false;

  constructor(container: HTMLElement) {
    const el = createOverlayElement(container);
    container.appendChild(el);
    this.#element = el;
  }

  showRect(xCss: number, yCss: number, widthCss: number, heightCss: number): void {
    const el = this.#element;
    if (el === null) return;
    const safeW = widthCss > 0 ? widthCss : 0;
    const safeH = heightCss > 0 ? heightCss : 0;
    el.style.transform = `translate3d(${xCss}px, ${yCss}px, 0)`;
    el.style.width = `${safeW}px`;
    el.style.height = `${safeH}px`;
    if (!this.#visible) {
      el.style.display = "block";
      this.#visible = true;
    }
  }

  hide(): void {
    const el = this.#element;
    if (el === null) return;
    if (this.#visible || el.style.display !== "none") {
      el.style.display = "none";
      this.#visible = false;
    }
  }

  dispose(): void {
    const el = this.#element;
    if (el === null) return;
    this.#element = null;
    this.#visible = false;
    el.remove();
  }
}
