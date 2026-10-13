import type { MarkerSink } from "../path/isolated-markers.js";
import type { PolylineSink } from "../path/polyline-sink.js";
import { formatSvgNumber } from "./svg-number.js";
import type { SvgWriter } from "./svg-writer.js";

/**
 * Collects absolute `M`/`L` path data. Implements the same two-method seam `Path2D` satisfies, so
 * the shared trace walker defines gap breaks, leading/trailing/consecutive gaps and the decimated
 * break marker once for both backends. Only `M` and `L` can ever be produced: a curve command
 * would fabricate data between samples.
 */
export class SvgPathSink implements PolylineSink {
  readonly #commands: string[] = [];

  /** True once any segment started; a trace that never saw a finite sample writes no path. */
  get hasSegment(): boolean {
    return this.#commands.length > 0;
  }

  moveTo(x: number, y: number): void {
    this.#commands.push(`M${formatSvgNumber(x)} ${formatSvgNumber(y)}`);
  }

  lineTo(x: number, y: number): void {
    this.#commands.push(`L${formatSvgNumber(x)} ${formatSvgNumber(y)}`);
  }

  pathData(): string {
    return this.#commands.join(" ");
  }
}

/** Writes each isolated-sample square straight into the document as a filled `<rect>`, in sample
 * order, so markers follow the trace's line path exactly as the shared walker visits them. */
export class SvgMarkerSink implements MarkerSink {
  readonly #writer: SvgWriter;
  readonly #fill: string;

  constructor(writer: SvgWriter, fill: string) {
    this.#writer = writer;
    this.#fill = fill;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.#writer.rect(x, y, w, h, this.#fill);
  }
}
