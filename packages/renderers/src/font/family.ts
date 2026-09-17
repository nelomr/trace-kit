/**
 * The CSS font family name `DEFAULT_FIGURE_STYLE.font` requests. Renamed from upstream
 * "Inter" so a consumer who separately loads their own full Inter never collides with this
 * package's narrow axis-label subset under the same family name — registering `ensureDefaultFont`
 * must never silently override a consumer's own, more complete "Inter" face.
 *
 * Deliberately its own module, with no import of the embedded font data: `style.ts` and the
 * main package entry both need this string, and neither may pull in the ~8 KB base64 data URL
 * that only `ensureDefaultFont` (in `./index.ts`, imported only via the `/font` subpath) needs.
 * A shared bundler chunk cannot be split cleanly if the string and the data URL are declared in
 * the same module — this file exists so it doesn't have to be.
 */
export const TRACEKIT_INTER_FAMILY = "TraceKit Inter";
