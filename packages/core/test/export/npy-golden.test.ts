// Goldens in test/fixtures/npy were written by NumPy itself (np.save) and are the reference the
// writer is compared against byte for byte. They were produced and verified once, offline, with:
//
//   python3 -I -c "import numpy as np; \
//     [print(f, (a:=np.load(f)).dtype, a.shape, a.tolist()) \
//      for f in ('x-f8.npy', 'y-f4.npy')]"
//
// and the decoded dtype, shape and values were recorded in expected.json (NumPy 1.26.4). That
// check is not part of CI; the unit test below compares bytes and the recorded values.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportNpy } from "../../src/export/npy.js";
import { buildPayload } from "../support/payload-builder.js";
import { concatCopies, decodeNpyData, parseNpyHeader } from "../support/npy-read.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const repoRoot = path.resolve(packageRoot, "../..");
const fixtureDir = path.join(packageRoot, "test/fixtures/npy");

interface ExpectedFile {
  readonly dtype: string;
  readonly descr: string;
  readonly shape: readonly number[];
  readonly values: readonly (number | string)[];
}
interface Expected {
  readonly numpy: string;
  readonly files: Readonly<Record<string, ExpectedFile>>;
}

const expected = JSON.parse(readFileSync(path.join(fixtureDir, "expected.json"), "utf8")) as Expected;

// Same samples the goldens hold: absolute X 1550 + 0.25 k, and a Y covering every special value.
const payload = buildPayload({
  xOrigin: 1550,
  x: [0, 0.25, 0.5, 0.75, 1],
  y: [1.5, NaN, Infinity, -Infinity, -0],
});

function golden(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(fixtureDir, name)));
}

function decodeToken(value: number): number | string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return Object.is(value, -0) ? "-0" : value;
}

describe("npy golden fixtures", () => {
  it("keeps *.npy marked binary in .gitattributes", () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    expect(attributes.split("\n")).toContain("*.npy binary");
  });

  for (const [name, array] of [
    ["x-f8.npy", "x"],
    ["y-f4.npy", "y"],
  ] as const) {
    it(`writes ${name} byte-for-byte`, () => {
      const written = concatCopies(exportNpy(payload, array, -Infinity, Infinity));
      expect(Array.from(written)).toEqual(Array.from(golden(name)));
    });

    it(`decodes ${name} to the values NumPy recorded`, () => {
      const record = expected.files[name];
      expect(record).toBeDefined();
      if (record === undefined) return;
      const bytes = concatCopies(exportNpy(payload, array, -Infinity, Infinity));
      const header = parseNpyHeader(bytes);
      expect(header.descr).toBe(record.descr);
      expect(header.shape).toEqual(record.shape);
      expect(decodeNpyData(bytes).map(decodeToken)).toEqual(record.values);
    });
  }
});
