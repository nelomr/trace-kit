/**
 * Shared decimal text for every exported number (X and Y alike).
 *
 * `String(number)` is the ECMAScript shortest round-trip form: `.` separator, no grouping, no
 * locale lookup, and it already spells `NaN`, `Infinity` and `-Infinity`. The one value it
 * mangles is negative zero (`String(-0)` is `"0"`, which would silently drop the sign bit), so
 * that case is spelled out; `1 / value < 0` separates it from `+0` without a call.
 */
export function formatExportNumber(value: number): string {
  return value === 0 && 1 / value < 0 ? "-0" : String(value);
}
