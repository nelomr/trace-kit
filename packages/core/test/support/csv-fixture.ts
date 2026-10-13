import type { CsvTraceSource } from "../../src/export/csv.js";
import { buildPayload } from "./payload-builder.js";

/** Deterministic two-trace source shared by the in-process and the child-process locale runs. */
export function buildLocaleFixture(): CsvTraceSource {
  return {
    entries: [
      {
        id: "señal, \"uno\"",
        payload: buildPayload({
          xOrigin: 1550,
          x: [0, 0.123456, 0.5, 1.75],
          y: [0.1, -0, NaN, 1234567.891],
        }),
      },
      {
        id: "dos",
        payload: buildPayload({
          xOrigin: 0.001,
          x: [0.25, 0.5],
          y: [Infinity, -Infinity],
        }),
      },
    ],
  };
}
