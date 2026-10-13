/**
 * CSS color to straight-alpha RGBA floats in `[0, 1]`, for the `u_color` uniform. Cold path: it
 * runs when a trace set is applied, never per frame, so it is free to use regular expressions.
 *
 * Only the forms a figure palette and a canvas serialization produce are accepted: `#rgb`,
 * `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Anything else (a named color, `hsl()`)
 * is normalized by the caller through the 2D context, which reads back a canonical form.
 */

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL =
  /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

function channel(hex: string, start: number, width: number): number {
  const digits = hex.slice(start, start + width);
  const value = Number.parseInt(width === 1 ? digits + digits : digits, 16);
  return value / 255;
}

/**
 * Writes the color into `out[offset .. offset + 4)` and returns `true`, or returns `false` and
 * leaves `out` untouched when the string is not one of the accepted forms.
 */
export function tryParseCssColorInto(color: string, out: Float32Array, offset: number): boolean {
  const text = color.trim();
  const hex = HEX.exec(text);
  if (hex !== null) {
    const body = hex[1] ?? "";
    const width = body.length <= 4 ? 1 : 2;
    const hasAlpha = body.length === 4 || body.length === 8;
    out[offset] = channel(body, 0, width);
    out[offset + 1] = channel(body, width, width);
    out[offset + 2] = channel(body, 2 * width, width);
    out[offset + 3] = hasAlpha ? channel(body, 3 * width, width) : 1;
    return true;
  }
  const functional = FUNCTIONAL.exec(text);
  if (functional !== null) {
    const red = Number.parseFloat(functional[1] ?? "");
    const green = Number.parseFloat(functional[2] ?? "");
    const blue = Number.parseFloat(functional[3] ?? "");
    const alphaText = functional[4];
    let alpha = 1;
    if (alphaText !== undefined) {
      alpha = alphaText.endsWith("%")
        ? Number.parseFloat(alphaText) / 100
        : Number.parseFloat(alphaText);
    }
    if (![red, green, blue, alpha].every(Number.isFinite)) return false;
    out[offset] = Math.min(255, Math.max(0, red)) / 255;
    out[offset + 1] = Math.min(255, Math.max(0, green)) / 255;
    out[offset + 2] = Math.min(255, Math.max(0, blue)) / 255;
    out[offset + 3] = Math.min(1, Math.max(0, alpha));
    return true;
  }
  return false;
}

/** As `tryParseCssColorInto`, throwing a `TypeError` that names the color when it cannot parse. */
export function parseCssColorInto(color: string, out: Float32Array, offset: number): void {
  if (!tryParseCssColorInto(color, out, offset)) {
    throw new TypeError(`parseCssColorInto: cannot parse the CSS color "${color}".`);
  }
}
