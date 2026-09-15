/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateLorentzian, type LorentzianParams } from "../../src/views/core-math/lorentzian.js";

const PARAMS: LorentzianParams = {
  seed: 42,
  centerFrequency: 500,
  fwhm: 50,
  noiseFloor: 0.02,
};

describe("deterministic synthetic Lorentzian generator", () => {
  it("produces byte-identical output for an identical seed and parameters", () => {
    const sampleCount = 1_000;
    const x1 = new Float32Array(sampleCount);
    const y1 = new Float32Array(sampleCount);
    const x2 = new Float32Array(sampleCount);
    const y2 = new Float32Array(sampleCount);

    generateLorentzian(x1, y1, sampleCount, PARAMS);
    generateLorentzian(x2, y2, sampleCount, PARAMS);

    expect(x1).toEqual(x2);
    expect(y1).toEqual(y2);
  });

  it("contains no Math.exp, Math.pow, Math.sin, or Math.random call", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.join(dir, "../../src/views/core-math/lorentzian.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/Math\.exp\(/);
    expect(source).not.toMatch(/Math\.pow\(/);
    expect(source).not.toMatch(/Math\.sin\(/);
    expect(source).not.toMatch(/Math\.random\(/);
  });
});
