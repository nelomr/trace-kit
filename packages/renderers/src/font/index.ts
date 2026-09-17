import { TRACEKIT_INTER_WOFF2_DATA_URL } from "./tracekit-inter.woff2.js";
import { TRACEKIT_INTER_FAMILY } from "./family.js";

export { TRACEKIT_INTER_FAMILY } from "./family.js";

let registrationPromise: Promise<boolean> | undefined;

/**
 * Registers the embedded font subset with the document's `FontFaceSet`, once, so
 * `document.fonts.check(...)` for `TRACEKIT_INTER_FAMILY` returns true before a caller paints
 * text with it. This module is imported by `style.ts`, which `Canvas2DRenderer` imports for
 * `DEFAULT_FIGURE_STYLE` — but the renderer itself never calls this function and never awaits
 * font readiness, since it paints on `OffscreenCanvas` in a worker where there is no
 * `document` at all (CLAUDE.md rule 5: the renderer stays DOM-free). Registration is instead a
 * concern for whichever DOM-attached caller wants the family to be definitely ready before the
 * first paint — typically once, at application start-up.
 *
 * Returns `false` immediately, without touching `FontFaceSet`, when no `document` exists (a
 * worker, a Node test, an isomorphic import) — this must never throw off-DOM, since `src/font`
 * is reachable from any consumer of the package, not only DOM-attached ones.
 */
export async function ensureDefaultFont(): Promise<boolean> {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return false;
  }
  if (document.fonts.check(`10px "${TRACEKIT_INTER_FAMILY}"`)) {
    return true;
  }
  registrationPromise ??= (async () => {
    const face = new FontFace(TRACEKIT_INTER_FAMILY, `url(${TRACEKIT_INTER_WOFF2_DATA_URL})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
    return true;
  })();
  return registrationPromise;
}
