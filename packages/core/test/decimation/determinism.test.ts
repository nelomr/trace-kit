import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lttb } from "../../src/decimation/lttb.js";
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

interface LttbGoldenFixture {
  x: number[];
  y: number[];
  sourceOffset: number;
  threshold: number;
  expected: number[];
}

describe("determinism — lttb", () => {
  it("matches the committed golden fixture exactly", () => {
    const fixturePath = path.join(fixturesDir, "lttb.json");
    const fixture = JSON.parse(
      readFileSync(fixturePath, "utf8"),
    ) as LttbGoldenFixture;

    const x = Float32Array.from(fixture.x);
    const y = Float32Array.from(fixture.y);
    const sampleCount = x.length - fixture.sourceOffset;
    const out = new Int32Array(fixture.threshold);
    lttb(x, y, fixture.sourceOffset, sampleCount, out, 0, fixture.threshold);

    expect(Array.from(out)).toEqual(fixture.expected);
  });

  it("resolves a same-area tie within one bucket to the lowest index, stably across runs", () => {
    // A flat (constant-Y) segment within a single bucket: every candidate index in that
    // bucket produces the same (zero) triangle area, so the tie-break rule alone decides.
    const sampleCount = 20;
    const x = new Float32Array(sampleCount);
    const y = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      x[i] = i;
      y[i] = i === 0 || i === sampleCount - 1 ? 100 : 5; // flat interior, distinct endpoints
    }
    const threshold = 3; // one interior bucket spans the entire flat run
    const outA = new Int32Array(threshold);
    const outB = new Int32Array(threshold);

    lttb(x, y, 0, sampleCount, outA, 0, threshold);
    lttb(x, y, 0, sampleCount, outB, 0, threshold);

    expect(outA).toEqual(outB);
    expect(outA[1]).toBe(1); // lowest index in the interior bucket's candidate range
  });
});
