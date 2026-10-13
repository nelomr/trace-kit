import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CSV_DEFAULT_ROWS_PER_CHUNK,
  exportCsv,
  type CsvTraceSource,
} from "../../src/export/csv.js";
import * as rootEntry from "../../src/index.js";
import type { SpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";
import { buildPayload } from "../support/payload-builder.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

function join(generator: Iterable<string>): string {
  let out = "";
  for (const chunk of generator) out += chunk;
  return out;
}

function single(payload: SpectrumDataPayload, id = "t"): CsvTraceSource {
  return { entries: [{ id, payload }] };
}

function lines(text: string): string[] {
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

describe("exportCsv: document shape", () => {
  it("concatenates to a header and one line per in-window sample", () => {
    const payload = buildPayload({ x: [1, 2, 3], y: [10, 20, 30] });
    const chunks = [...exportCsv(single(payload), 0, 10)];
    expect(chunks[0]).toBe("trace_id,x,y\n");
    expect(lines(chunks.join(""))).toEqual(["trace_id,x,y", "t,1,10", "t,2,20", "t,3,30"]);
  });

  it("reads raw samples, never a decimated subset", () => {
    const count = 250_000;
    const x = new Float32Array(count);
    for (let i = 0; i < count; i += 1) x[i] = i;
    const payload = buildPayload({ x, y: x });
    let rows = 0;
    for (const chunk of exportCsv(single(payload), -Infinity, Infinity)) {
      for (let i = 0; i < chunk.length; i += 1) if (chunk.charCodeAt(i) === 10) rows += 1;
    }
    expect(rows).toBe(count + 1);
  });

  it("is lazy: nothing is read before the first next(), and next() is synchronous", () => {
    let reads = 0;
    const real = buildPayload({ x: [1, 2, 3] });
    const spy: SpectrumDataPayload = {
      ...real,
      get x() {
        reads += 1;
        return real.x;
      },
      get y() {
        reads += 1;
        return real.y;
      },
      get sampleCount() {
        reads += 1;
        return real.sampleCount;
      },
      get xOrigin() {
        reads += 1;
        return real.xOrigin;
      },
    };
    const source: CsvTraceSource = {
      get entries() {
        reads += 1;
        return [{ id: "t", payload: spy }];
      },
    };
    const generator = exportCsv(source, -Infinity, Infinity);
    expect(reads).toBe(0);
    const first = generator.next();
    expect(first).not.toBeInstanceOf(Promise);
    expect(first).toEqual({ value: "trace_id,x,y\n", done: false });
    generator.next();
    expect(reads).toBeGreaterThan(0);
  });

  it("rejects an invalid rowsPerChunk with a RangeError before any read", () => {
    let reads = 0;
    const source: CsvTraceSource = {
      get entries() {
        reads += 1;
        return [];
      },
    };
    for (const rowsPerChunk of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => exportCsv(source, 0, 1, { rowsPerChunk })).toThrow(RangeError);
    }
    expect(reads).toBe(0);
  });

  it("does not mutate the source", () => {
    const payload = buildPayload({ x: [1, 2, 3] });
    const before = { revision: payload.revision, sampleCount: payload.sampleCount };
    join(exportCsv(single(payload), 0, 10));
    expect({ revision: payload.revision, sampleCount: payload.sampleCount }).toEqual(before);
  });

  it("is a TraceCollection-compatible source and a root-entry export", () => {
    expect(rootEntry.exportCsv).toBe(exportCsv);
    expect(rootEntry.CSV_DEFAULT_ROWS_PER_CHUNK).toBe(CSV_DEFAULT_ROWS_PER_CHUNK);
    expect(CSV_DEFAULT_ROWS_PER_CHUNK).toBe(4096);
  });
});

describe("exportCsv: row order and windows", () => {
  it("keeps entry order, not id order", () => {
    const b = buildPayload({ x: [1, 2], y: [1, 2] });
    const a = buildPayload({ x: [1, 2], y: [3, 4] });
    const source: CsvTraceSource = {
      entries: [
        { id: "b", payload: b },
        { id: "a", payload: a },
      ],
    };
    expect(lines(join(exportCsv(source, 0, 10))).slice(1)).toEqual([
      "b,1,1",
      "b,2,2",
      "a,1,3",
      "a,2,4",
    ]);
  });

  it("resolves each entry on its own origin, sample count and span", () => {
    const p = buildPayload({ xOrigin: 1550, x: [0, 0.5, 1], y: [1, 2, 3] });
    const q = buildPayload({ xOrigin: 1500, x: [49, 50, 51, 52, 53], y: [5, 6, 7, 8, 9] });
    const source: CsvTraceSource = {
      entries: [
        { id: "p", payload: p },
        { id: "q", payload: q },
      ],
    };
    expect(lines(join(exportCsv(source, 1550.5, 1551.5))).slice(1)).toEqual([
      "p,1550.5,2",
      "p,1551,3",
      "q,1551,7",
    ]);
  });

  it("emits the header only for an empty window", () => {
    const payload = buildPayload({ x: [1, 2, 3] });
    expect(join(exportCsv(single(payload), 10, 20))).toBe("trace_id,x,y\n");
  });

  it("emits the header only for an empty collection", () => {
    expect(join(exportCsv({ entries: [] }, -Infinity, Infinity))).toBe("trace_id,x,y\n");
  });

  it("skips an entry without in-window samples without affecting the others", () => {
    const source: CsvTraceSource = {
      entries: [
        { id: "a", payload: buildPayload({ x: [1, 2] }) },
        { id: "b", payload: buildPayload({ x: [100, 200] }) },
      ],
    };
    const rows = lines(join(exportCsv(source, 0, 10))).slice(1);
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.startsWith("a,"))).toBe(true);
  });

  it("honours includeNeighbours", () => {
    const payload = buildPayload({ x: [1, 2, 3, 4, 5] });
    const strict = lines(join(exportCsv(single(payload), 2, 4))).length - 1;
    const wide = lines(join(exportCsv(single(payload), 2, 4, { includeNeighbours: true }))).length - 1;
    expect([strict, wide]).toEqual([3, 5]);
  });
});

describe("exportCsv: number text", () => {
  it("reconstructs absolute X rather than the raw offset", () => {
    const offset = Math.fround(0.123456);
    const payload = buildPayload({ xOrigin: 1550, x: [offset], y: [1] });
    const row = lines(join(exportCsv(single(payload), 0, 1e6)))[1];
    expect(row).toBe(`t,${String(1550 + offset)},1`);
    const xField = (row ?? "").split(",")[1] ?? "";
    expect(Number(xField)).toBe(1550 + offset);
  });

  it("writes Y as the shortest string of the widened f64", () => {
    const payload = buildPayload({ x: [1], y: [0.1] });
    const row = lines(join(exportCsv(single(payload), 0, 2)))[1];
    expect(row).toBe("t,1,0.10000000149011612");
    expect(Number((row ?? "").split(",")[2])).toBe(Math.fround(0.1));
  });

  it("keeps the sign of negative zero in X and Y", () => {
    const payload = buildPayload({ xOrigin: -0, x: [-0], y: [-0] });
    expect(lines(join(exportCsv(single(payload), -1, 1)))[1]).toBe("t,-0,-0");
  });

  it("writes a gap as NaN and keeps the row", () => {
    const payload = buildPayload({ x: [1, 2, 3], y: [1, NaN, 3] });
    expect(lines(join(exportCsv(single(payload), 0, 10))).slice(1)).toEqual([
      "t,1,1",
      "t,2,NaN",
      "t,3,3",
    ]);
  });

  it("keeps infinities distinct from gaps", () => {
    const payload = buildPayload({ x: [1, 2, 3], y: [Infinity, -Infinity, NaN] });
    const ys = lines(join(exportCsv(single(payload), 0, 10)))
      .slice(1)
      .map((row) => row.split(",")[2]);
    expect(ys).toEqual(["Infinity", "-Infinity", "NaN"]);
  });

  it("emits one row per sample for an all-gap trace", () => {
    const payload = buildPayload({ x: [1, 2, 3, 4], y: [NaN, NaN, NaN, NaN] });
    const rows = lines(join(exportCsv(single(payload), 0, 10))).slice(1);
    expect(rows).toEqual(["t,1,NaN", "t,2,NaN", "t,3,NaN", "t,4,NaN"]);
  });

  it("is byte-deterministic across runs", () => {
    const payload = buildPayload({ xOrigin: 1550, x: [0, 0.3, 0.7], y: [0.1, NaN, -0] });
    expect(join(exportCsv(single(payload), 0, 1e6))).toBe(join(exportCsv(single(payload), 0, 1e6)));
  });
});

describe("exportCsv: trace_id escaping", () => {
  function firstRow(id: string): string {
    const payload = buildPayload({ x: [1], y: [2] });
    const text = join(exportCsv(single(payload, id), 0, 2));
    return text.slice("trace_id,x,y\n".length);
  }

  it("quotes ids with a comma, quote, newline or carriage return", () => {
    expect(firstRow("a,b")).toBe('"a,b",1,2\n');
    expect(firstRow('say "hi"')).toBe('"say ""hi""",1,2\n');
    expect(firstRow("a\nb")).toBe('"a\nb",1,2\n');
    expect(firstRow("a\rb")).toBe('"a\rb",1,2\n');
  });

  it("leaves plain, empty, spaced and non-ASCII ids untouched", () => {
    expect(firstRow("power-mw")).toBe("power-mw,1,2\n");
    expect(firstRow("")).toBe(",1,2\n");
    expect(firstRow("a b")).toBe("a b,1,2\n");
    expect(firstRow("señal")).toBe("señal,1,2\n");
  });

  it("never quotes the header", () => {
    const payload = buildPayload({ x: [1] });
    expect(join(exportCsv(single(payload, "a,b"), 0, 2)).startsWith("trace_id,x,y\n")).toBe(true);
  });
});

describe("exportCsv: chunking", () => {
  const payload = buildPayload({
    xOrigin: 100,
    x: Float32Array.from({ length: 50 }, (_, i) => i * 0.25),
    y: Float32Array.from({ length: 50 }, (_, i) => Math.sin(i)),
  });

  it("produces identical bytes whatever rowsPerChunk is", () => {
    const reference = join(exportCsv(single(payload), -Infinity, Infinity));
    for (const rowsPerChunk of [1, 7, 4096]) {
      expect(join(exportCsv(single(payload), -Infinity, Infinity, { rowsPerChunk }))).toBe(reference);
    }
  });

  it("yields whole lines, at most rowsPerChunk rows per data chunk", () => {
    const chunks = [...exportCsv(single(payload), -Infinity, Infinity, { rowsPerChunk: 7 })];
    expect(chunks[0]).toBe("trace_id,x,y\n");
    for (const chunk of chunks.slice(1)) {
      expect(chunk.endsWith("\n")).toBe(true);
      expect(chunk.split("\n").length - 1).toBeLessThanOrEqual(7);
    }
  });

  it("keeps chunk count and size independent of sampleCount beyond the row bound", () => {
    function measure(count: number): { chunks: number; maxLength: number } {
      const x = new Float32Array(count);
      for (let i = 0; i < count; i += 1) x[i] = i;
      let chunks = 0;
      let maxLength = 0;
      for (const chunk of exportCsv(single(buildPayload({ x, y: x })), -Infinity, Infinity)) {
        chunks += 1;
        if (chunk.length > maxLength) maxLength = chunk.length;
      }
      return { chunks, maxLength };
    }
    const small = measure(50_000);
    const large = measure(1_000_000);
    expect(Math.ceil(1_000_000 / CSV_DEFAULT_ROWS_PER_CHUNK) + 1).toBe(large.chunks);
    // Rows of the large run are longer only by digit count (7 vs 5 digits per field).
    expect(large.maxLength).toBeLessThanOrEqual(CSV_DEFAULT_ROWS_PER_CHUNK * 24);
    expect(small.maxLength).toBeLessThanOrEqual(large.maxLength);
  }, 60_000);
});

describe("export modules stay free of DOM and runtime-global text APIs", () => {
  const forbidden = /\b(Blob|URL|TextEncoder|document|window|HTMLCanvasElement|process)\b/;

  /** Returns the offending files; a missing file or an empty list throws instead of skipping. */
  function scan(files: readonly string[]): string[] {
    if (files.length === 0) throw new Error("no files to scan");
    const offenders: string[] = [];
    for (const file of files) {
      // readFileSync throws on a renamed or moved module: that must fail the test, not skip it.
      const source = readFileSync(path.join(packageRoot, file), "utf8");
      // Strip comments and module specifiers so prose naming a forbidden API, and the
      // `viewport/window.js` import path, are not flagged as references.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/from\s+"[^"]*"/g, "");
      if (forbidden.test(code)) offenders.push(file);
    }
    return offenders;
  }

  it("fails loudly on a missing file or an empty list", () => {
    expect(() => scan(["src/export/__does-not-exist__.ts"])).toThrow();
    expect(() => scan([])).toThrow();
  });

  it("references none of the forbidden identifiers in src/export or src/viewport/window.ts", () => {
    const files = [
      "src/viewport/window.ts",
      "src/export/number-format.ts",
      "src/export/csv.ts",
      "src/export/binary-export.ts",
      "src/export/npy.ts",
      "src/export/index.ts",
    ];
    expect(scan(files)).toEqual([]);
  });
});
