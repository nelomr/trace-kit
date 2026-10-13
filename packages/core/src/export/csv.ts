/**
 * Lazy CSV serializer over the authoritative payload buffers: one `trace_id,x,y` row per
 * in-window sample, in collection order, never from decimated or drawn points.
 */
import type { SpectrumDataPayload } from "../payload/spectrum-data-payload.js";
import {
  createSampleSpan,
  resolveSampleWindow,
  type SampleWindowOptions,
} from "../viewport/window.js";
import { formatExportNumber } from "./number-format.js";

/** Anything with ordered `{ id, payload }` entries; `TraceCollection` satisfies it structurally. */
export interface CsvTraceSource {
  readonly entries: readonly {
    readonly id: string;
    readonly payload: SpectrumDataPayload;
  }[];
}

export interface CsvExportOptions extends SampleWindowOptions {
  /** Data rows per yielded chunk. Positive integer; default `CSV_DEFAULT_ROWS_PER_CHUNK`. */
  readonly rowsPerChunk?: number;
}

/**
 * Rows per chunk when the caller does not choose. At roughly 25-50 bytes per row a chunk is
 * 100-200 KB: large enough that generator resumption is amortised over thousands of rows, small
 * enough that chunks do not churn large-object space.
 */
export const CSV_DEFAULT_ROWS_PER_CHUNK = 4096;

const CSV_HEADER = "trace_id,x,y\n";
const NEEDS_QUOTING = /[",\r\n]/;

/** RFC 4180 field: quote only when the text would otherwise break the record structure. */
function escapeTraceId(id: string): string {
  return NEEDS_QUOTING.test(id) ? '"' + id.replaceAll('"', '""') + '"' : id;
}

/**
 * Exports the rows of every entry whose absolute X lies in `[xMin, xMax]` (see
 * `resolveSampleWindow` for the window rules and the ascending-X precondition).
 *
 * The first chunk is exactly the header line; every later chunk holds whole `\n`-terminated rows,
 * at most `rowsPerChunk` of them, so chunk size is bounded independently of `sampleCount` and the
 * concatenated bytes do not depend on the chunking. X is the f64 sum `xOrigin + x[i]` and Y the
 * stored f32 widened to f64, both in shortest round-trip text; a gap is `NaN` and still emits its
 * row. Nothing is read until the first `next()`.
 *
 * @throws RangeError when `rowsPerChunk` is not a positive integer (before any read).
 */
export function exportCsv(
  source: CsvTraceSource,
  xMin: number,
  xMax: number,
  options?: CsvExportOptions,
): Generator<string, void, undefined> {
  const rowsPerChunk = options?.rowsPerChunk ?? CSV_DEFAULT_ROWS_PER_CHUNK;
  if (!Number.isInteger(rowsPerChunk) || rowsPerChunk < 1) {
    throw new RangeError(`rowsPerChunk must be a positive integer; received ${String(rowsPerChunk)}.`);
  }
  // Calling a generator function runs none of its body, so validation above is the only eager step.
  return csvChunks(source, xMin, xMax, options, rowsPerChunk);
}

function* csvChunks(
  source: CsvTraceSource,
  xMin: number,
  xMax: number,
  options: SampleWindowOptions | undefined,
  rowsPerChunk: number,
): Generator<string, void, undefined> {
  yield CSV_HEADER;

  const entries = source.entries;
  const span = createSampleSpan();
  let chunk = "";
  let rows = 0;

  for (let e = 0; e < entries.length; e += 1) {
    const entry = entries[e];
    if (entry === undefined) continue;
    const payload = entry.payload;
    resolveSampleWindow(payload, xMin, xMax, span, options);
    if (span.end === span.start) continue;

    // Escaped id and row prefix are per-entry constants, not per-row work.
    const prefix = escapeTraceId(entry.id) + ",";
    const origin = payload.xOrigin;
    const x = payload.x;
    const y = payload.y;

    for (let i = span.start; i < span.end; i += 1) {
      chunk +=
        prefix +
        formatExportNumber(origin + (x[i] as number)) +
        "," +
        formatExportNumber(y[i] as number) +
        "\n";
      rows += 1;
      if (rows === rowsPerChunk) {
        yield chunk;
        chunk = "";
        rows = 0;
      }
    }
  }

  if (rows > 0) yield chunk;
}
