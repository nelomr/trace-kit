import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { minMaxEnvelope } from "../../src/decimation/min-max.js";

// decimation-min-max spec's "Determinism" scenario: repeated invocation over identical input
// yields byte-identical output, and the recorded golden output is stable.
const fixturesDir = path.resolve(
  fileURLToPath(import.meta.url),
  "../../fixtures/golden",
);

interface MinMaxGoldenFixture {
  series: number[];
  bucketCount: number;
  expected: number[];
}

describe("determinism — minMaxEnvelope", () => {
  it("matches the committed golden fixture exactly", () => {
    const fixturePath = path.join(fixturesDir, "min-max.json");
    const fixture = JSON.parse(
      readFileSync(fixturePath, "utf8"),
    ) as MinMaxGoldenFixture;

    const series = Float32Array.from(fixture.series);
    const out = new Float32Array(fixture.bucketCount * 2);
    minMaxEnvelope(series, 0, series.length, out, 0, fixture.bucketCount);

    expect(Array.from(out)).toEqual(fixture.expected);
  });

  it("produces byte-identical output across two fresh output buffers", () => {
    const series = new Float32Array(777);
    for (let i = 0; i < series.length; i += 1) {
      series[i] = Math.sin(i * 0.37) * 50;
    }
    const outA = new Float32Array(128);
    const outB = new Float32Array(128);

    minMaxEnvelope(series, 0, series.length, outA, 0, 64);
    minMaxEnvelope(series, 0, series.length, outB, 0, 64);

    expect(outA).toEqual(outB);
  });
});
