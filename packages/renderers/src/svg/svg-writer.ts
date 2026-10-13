import { escapeXml } from "./escape-xml.js";
import { formatSvgNumber } from "./svg-number.js";

/**
 * Appends one element per line to a chunk list and joins it once at the end. Every number goes
 * through `formatSvgNumber`, so a non-finite value can never reach the output, and every
 * caller-supplied string goes through `escapeXml`. Line endings are always `\n`.
 */
export class SvgWriter {
  readonly #chunks: string[] = [];

  /** Appends already-well-formed markup as one line. */
  raw(markup: string): void {
    this.#chunks.push(markup, "\n");
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.raw(
      `<line x1="${formatSvgNumber(x1)}" y1="${formatSvgNumber(y1)}" x2="${formatSvgNumber(x2)}" y2="${formatSvgNumber(y2)}"/>`,
    );
  }

  rect(x: number, y: number, width: number, height: number, fill: string | null): void {
    const fillAttr = fill === null ? "" : ` fill="${escapeXml(fill)}"`;
    this.raw(
      `<rect x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" width="${formatSvgNumber(width)}" height="${formatSvgNumber(height)}"${fillAttr}/>`,
    );
  }

  text(content: string, x: number, y: number, anchor: string, baseline: string): void {
    this.raw(
      `<text x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" text-anchor="${anchor}" dominant-baseline="${baseline}">${escapeXml(content)}</text>`,
    );
  }

  toString(): string {
    return this.#chunks.join("");
  }
}
