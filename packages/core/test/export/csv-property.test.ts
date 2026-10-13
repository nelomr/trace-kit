import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportCsv } from "../../src/export/csv.js";
import { buildPayload } from "../support/payload-builder.js";
import { parseCsv } from "../support/csv-parse.js";

const idUnit = fc.constantFrom("a", "Z", "0", ",", '"', "\r", "\n", " ", "ñ", "日", "😀");
const arbId = fc.string({ unit: idUnit, maxLength: 10 });
const arbY = fc.oneof(
  fc.float({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(NaN, Infinity, -Infinity, -0, 0),
);
const arbOffset = fc.float({ noNaN: true, noDefaultInfinity: true, min: -1e5, max: 1e5 });
const arbEntry = fc.record({
  id: arbId,
  xOrigin: fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e4, max: 1e4 }),
  samples: fc.array(fc.tuple(arbOffset, arbY), { maxLength: 8 }),
});

describe("exportCsv round trip", () => {
  it("parses back to the original ids, X and Y through an RFC 4180 reader", () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 4 }), (entries) => {
        const source = {
          entries: entries.map((entry) => ({
            id: entry.id,
            payload: buildPayload({
              xOrigin: entry.xOrigin,
              x: entry.samples.map(([x]) => x),
              y: entry.samples.map(([, y]) => y),
            }),
          })),
        };
        let text = "";
        for (const chunk of exportCsv(source, -Infinity, Infinity)) text += chunk;
        const records = parseCsv(text);
        expect(records[0]).toEqual(["trace_id", "x", "y"]);
        let row = 1;
        for (const entry of source.entries) {
          const { payload } = entry;
          for (let i = 0; i < payload.sampleCount; i += 1) {
            const record = records[row];
            row += 1;
            expect(record?.length).toBe(3);
            expect(record?.[0]).toBe(entry.id);
            expect(Object.is(Number(record?.[1]), payload.xOrigin + (payload.x[i] ?? NaN))).toBe(true);
            expect(Object.is(Number(record?.[2]), payload.y[i])).toBe(true);
          }
        }
        expect(records.length).toBe(row);
      }),
    );
  });
});
