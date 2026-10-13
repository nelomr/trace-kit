/**
 * Formats one tick value for display. Presentation-only, deliberately outside `@trace-kit/core`
 * (locale and unit-suffix formatting is a presentation concern, not a data one); the caller
 * formats once per `tickRevision`, never once per `render()`. Plain rounding plus string
 * interpolation with no locale-aware API, so every host locale yields the same text.
 */
export function formatTickLabel(value: number, unit: string): string {
  const rounded = Math.round(value * 1000) / 1000;
  return unit.length > 0 ? `${rounded} ${unit}` : `${rounded}`;
}
