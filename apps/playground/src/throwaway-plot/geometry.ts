/**
 * Pure coordinate math for the throwaway plot: data-space -> pixel-space mapping and axis
 * tick placement. Plain numbers in, plain numbers out, no `CanvasRenderingContext2D`
 * involved — this is the half of the routine that is unit-testable under happy-dom, which
 * returns `null` from `getContext("2d")`.
 */

export interface Domain {
  readonly min: number;
  readonly max: number;
}

export interface PixelRange {
  readonly min: number;
  readonly max: number;
}

/** Maps a data-space value in `domain` to a pixel-space value in `range`, linearly. */
export function dataToPixel(value: number, domain: Domain, range: PixelRange): number {
  const domainSpan = domain.max - domain.min;
  if (domainSpan === 0) {
    return range.min;
  }
  const fraction = (value - domain.min) / domainSpan;
  return range.min + fraction * (range.max - range.min);
}

/** Places `count` evenly spaced tick values across `domain`, `count >= 2` including both ends. */
export function axisTicks(domain: Domain, count: number): number[] {
  if (count < 2) {
    throw new RangeError(`axisTicks requires count >= 2; received ${count}`);
  }
  const ticks: number[] = [];
  const step = (domain.max - domain.min) / (count - 1);
  for (let i = 0; i < count; i += 1) {
    ticks.push(domain.min + step * i);
  }
  return ticks;
}
