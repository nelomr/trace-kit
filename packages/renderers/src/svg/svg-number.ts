/** Decimal places of every coordinate and length in an exported document, in CSS pixels. Two
 * places is a hundredth of a CSS pixel: far below what any display or print resolution resolves,
 * so rounding never moves a vertex visibly, while keeping documents compact. */
export const SVG_COORDINATE_DECIMALS = 2;

/** `toFixed` switches to exponent notation at 1e21, which no SVG number grammar for coordinates
 * should ever carry; clamping far below that keeps the output exponent-free for every input. */
const MAX_MAGNITUDE = 1e9;

/**
 * The single numeric formatter of the exporter. `toFixed` is locale-independent by the language
 * specification (always `.` as the separator) and rounds the exact binary value, so the same
 * double formats to the same text on every platform. Trailing zeros and a dangling point are then
 * trimmed by an index scan, and `-0` (including values like `-0.004` that round to it) is
 * normalized to `0` so the sign of zero can never leak into a document.
 */
export function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const clamped = value > MAX_MAGNITUDE ? MAX_MAGNITUDE : value < -MAX_MAGNITUDE ? -MAX_MAGNITUDE : value;
  const fixed = clamped.toFixed(SVG_COORDINATE_DECIMALS);

  let end = fixed.length;
  while (end > 0 && fixed.charCodeAt(end - 1) === 48) end -= 1;
  if (end > 0 && fixed.charCodeAt(end - 1) === 46) end -= 1;
  const trimmed = end === fixed.length ? fixed : fixed.slice(0, end);
  return trimmed === "-0" ? "0" : trimmed;
}
