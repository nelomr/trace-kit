import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDecimationParameter } from "../../src/decimation/selection.js";

describe("resolveDecimationParameter", () => {
  it("derives lttb's threshold from the viewport-width vertex budget when sampleCount exceeds it", () => {
    const plotWidth = 400;
    const sampleCount = 1_000_000;
    const vertexBudget = Math.max(2, Math.ceil(plotWidth * 2));
    expect(resolveDecimationParameter({ algorithm: "lttb" }, plotWidth, sampleCount)).toBe(
      vertexBudget,
    );
  });

  it("derives min-max's bucketCount as half the same vertex budget when sampleCount exceeds it", () => {
    const plotWidth = 400;
    const sampleCount = 1_000_000;
    const vertexBudget = Math.max(2, Math.ceil(plotWidth * 2));
    expect(resolveDecimationParameter({ algorithm: "min-max" }, plotWidth, sampleCount)).toBe(
      Math.floor(vertexBudget / 2),
    );
  });

  it("returns an explicit lttb threshold unchanged, clamped only by sampleCount", () => {
    expect(resolveDecimationParameter({ algorithm: "lttb", threshold: 77 }, 400, 1_000_000)).toBe(
      77,
    );
  });

  it("returns an explicit min-max bucketCount unchanged, clamped only by sampleCount", () => {
    expect(
      resolveDecimationParameter({ algorithm: "min-max", bucketCount: 33 }, 400, 1_000_000),
    ).toBe(33);
  });

  it("clamps a resolved parameter to sampleCount when the budget would exceed it", () => {
    expect(resolveDecimationParameter({ algorithm: "lttb" }, 10_000, 50)).toBe(50);
    expect(resolveDecimationParameter({ algorithm: "min-max" }, 10_000, 50)).toBe(50);
  });
});

describe("selection.ts source constraints", () => {
  it("contains no unsafe-cast escape hatches", () => {
    const filePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/decimation/selection.ts",
    );
    const source = readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/as never\b/);
    expect(source).not.toMatch(/as any\b/);
    expect(source).not.toMatch(/<any>/);
    expect(source).not.toMatch(/as unknown as/);
  });

  it("resolveDecimationParameter's body has no object/array literal or closure construction", () => {
    const filePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/decimation/selection.ts",
    );
    const source = readFileSync(filePath, "utf8");
    const start = source.indexOf("export function resolveDecimationParameter");
    const body = source.slice(start);
    const bodyEnd = body.indexOf("\n}\n");
    const fnBody = body.slice(0, bodyEnd);
    expect(fnBody).not.toMatch(/=\s*\{/); // no object literal
    expect(fnBody).not.toMatch(/\[\s*\]/); // no array literal
    expect(fnBody).not.toMatch(/=>/); // no closure
  });
});
