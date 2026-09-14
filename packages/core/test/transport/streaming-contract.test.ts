import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUCKET_OVERSAMPLE_DEFAULT,
  MAX_BUCKETS,
  computeBucketCount,
  createBucketAccumulator,
  createRawSampleRing,
  ingestSample,
  rebuildDomain,
  rotateBucketOrigin,
  selectTier,
} from "../../src/transport/streaming-contract.js";

const sourcePath = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../src/transport/streaming-contract.ts",
);
const source = readFileSync(sourcePath, "utf8");

const distPath = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../dist/index.d.ts",
);
const distSource = readFileSync(distPath, "utf8");

const changesRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../../openspec/changes");

/**
 * Reads the verify-report.md for core-transport-contract, looking first at the active change
 * location and then, since archiving relocates the change directory under a dated prefix, at the
 * archived location. Returns `undefined`, rather than failing, when neither exists: this
 * repository's `.gitignore` deliberately excludes `openspec/changes/archive/` from version
 * control, so once a change is archived its report is only ever present on the machine that
 * archived it — a fresh checkout (including CI) will never have it, and that absence is the
 * expected steady state, not a defect. The report-based half of the two callers' assertions is
 * therefore best-effort: real protection while the change is active and its report is tracked,
 * and a no-op afterward, backed by the permanent, always-checkable source-comment assertion the
 * same callers also make.
 */
function readVerifyReport(): string | undefined {
  const activePath = path.join(changesRoot, "core-transport-contract", "verify-report.md");
  const archiveDir = path.join(changesRoot, "archive");
  let archivedPath: string | undefined;
  try {
    const archivedMatch = readdirSync(archiveDir).find((entry) => entry.endsWith("-core-transport-contract"));
    if (archivedMatch !== undefined) {
      archivedPath = path.join(archiveDir, archivedMatch, "verify-report.md");
    }
  } catch {
    archivedPath = undefined;
  }

  for (const candidate of [activePath, ...(archivedPath !== undefined ? [archivedPath] : [])]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

// --- shared source-level gate helpers, proven live against an in-band fixture --------------

/** Counts `%` used as the modulo operator, ignoring `%` inside string/template literals. */
function countModuloOperators(text: string): number {
  const matches = text.match(/[^%]%(?!%)/g);
  return matches ? matches.length : 0;
}

const MODULO_FIXTURE = "const writeIndex = totalWritten % capacity;";

describe("streaming-contract — RawSampleRing is overwrite-oldest over a power-of-two capacity", () => {
  it("accepts a power-of-two capacity and rejects a non-power-of-two one without rounding", () => {
    expect(createRawSampleRing(1024).capacity).toBe(1024);
    expect(() => createRawSampleRing(1000)).toThrow(RangeError);
    expect(() => createRawSampleRing(1025)).toThrow(RangeError);
    expect(() => createRawSampleRing(0)).toThrow(RangeError);
  });

  it("the masked-index identity totalWritten & (capacity - 1) holds at the wrap boundary", () => {
    const capacity = 1024;
    const cases: Array<[number, number]> = [
      [0, 0],
      [1023, 1023],
      [1024, 0],
      [1_048_577, 1],
    ];
    for (const [totalWritten, expected] of cases) {
      expect(totalWritten & (capacity - 1)).toBe(expected);
    }
  });

  it("declares no modulo operator in the module; the gate is proven live against a fixture", () => {
    expect(countModuloOperators(source)).toBe(0);
    expect(countModuloOperators(MODULO_FIXTURE)).toBeGreaterThan(0);
  });
});

describe("streaming-contract — count[s] === 0 is the sole normative no-data signal", () => {
  /** Looks for a declared sentinel constant or NaN-based emptiness convention on min/max. */
  function countNoDataSentinels(text: string): number {
    const patterns = [
      /NO_DATA/i,
      /EMPTY_(MIN|MAX)/i,
      /(min|max)\s*(is|===)\s*NaN/i,
      /Number\.NaN.*(min|max)/i,
    ];
    return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
  }

  const SENTINEL_FIXTURE = "const NO_DATA_MIN = Number.NaN; // min is NaN when empty";

  it("declares no competing no-data sentinel; the gate is proven live against a fixture", () => {
    expect(countNoDataSentinels(source)).toBe(0);
    expect(countNoDataSentinels(SENTINEL_FIXTURE)).toBeGreaterThan(0);
  });

  it("documents the gap rule on count's doc comment and in the emitted .d.ts", () => {
    function statesGapRule(text: string): boolean {
      return (
        /count\[s\]\s*===\s*0/.test(text) &&
        /no data/i.test(text) &&
        /gap/i.test(text) &&
        /never.*interpolat|not.*interpolat/i.test(text)
      );
    }
    expect(statesGapRule(source)).toBe(true);
    expect(statesGapRule(distSource)).toBe(true);
    // Proven live: a comment describing count only as a sample tally fails the same check.
    expect(statesGapRule("/** count is a per-bucket sample tally. */")).toBe(false);
  });
});

describe("streaming-contract — partialHistory lives on the tier result", () => {
  it("documents the totalWritten - capacity underrun condition and the count === 0 outcome", () => {
    function statesPartialHistoryRule(text: string): boolean {
      return (
        /totalWritten\s*-\s*capacity/.test(text) &&
        /count\s*===\s*0/.test(text)
      );
    }
    expect(statesPartialHistoryRule(source)).toBe(true);
    // Proven live: a comment naming only the flag, with neither the underrun formula nor the
    // count outcome, fails the same check.
    expect(statesPartialHistoryRule("/** partialHistory signals a coverage problem. */")).toBe(
      false,
    );
  });
});

describe("streaming-contract — the circular bucket wrap is a conditional subtraction, never a mask or modulo", () => {
  function countMaskOrModuloViolations(text: string): number {
    const modulo = countModuloOperators(text);
    const maskMatches = text.match(/&\s*\(?\s*bucketCount/g) ?? [];
    const bucketMaskMatches = text.match(/bucketMask/gi) ?? [];
    return modulo + maskMatches.length + bucketMaskMatches.length;
  }

  const WRAP_FIXTURE =
    "const bucketMask = bucketCount - 1; const s = (b + bucketOrigin) & bucketCount;";

  it("finds no mask, modulo, or bucketMask identifier in the module; the gate is proven live", () => {
    expect(countMaskOrModuloViolations(source)).toBe(0);
    expect(countMaskOrModuloViolations(WRAP_FIXTURE)).toBe(2);
  });

  it("the accumulator factory accepts any integer bucketCount in [1, MAX_BUCKETS], not just powers of two", () => {
    for (const bucketCount of [1440, 2, 1, 8192]) {
      const accumulator = createBucketAccumulator(bucketCount);
      expect(accumulator.bucketCount).toBe(bucketCount);
      expect(accumulator.min).toHaveLength(bucketCount);
      expect(accumulator.max).toHaveLength(bucketCount);
      expect(accumulator.count).toHaveLength(bucketCount);
    }
    for (const bucketCount of [0, -1, 1.5, MAX_BUCKETS + 1]) {
      expect(() => createBucketAccumulator(bucketCount)).toThrow(RangeError);
    }
  });
});

describe("streaming-contract — bucketOrigin stays in [0, bucketCount)", () => {
  // `createBucketAccumulator` always initializes `bucketOrigin` at 0; the validated entry point
  // is `rotateBucketOrigin`, which asserts the accumulator's *current* origin is in range before
  // computing a rotation. A rotation by 0 exercises exactly that validation without changing the
  // requested origin, letting these cases probe the boundary directly.
  it("rejects an out-of-range origin and accepts every in-range one, at exactly bucketCount", () => {
    const bucketCount = 1440;
    for (const bucketOrigin of [0, 1, 1439]) {
      const accumulator = createBucketAccumulator(bucketCount);
      accumulator.bucketOrigin = bucketOrigin;
      expect(rotateBucketOrigin(accumulator, 0)).toBe(bucketOrigin);
    }
    for (const bucketOrigin of [1440, 1441, -1, 1.5]) {
      const accumulator = createBucketAccumulator(bucketCount);
      accumulator.bucketOrigin = bucketOrigin;
      expect(() => rotateBucketOrigin(accumulator, 0)).toThrow(RangeError);
    }
  });

  it("documents normalisation in both directions on the rotation entry point", () => {
    function statesBothDirections(text: string): boolean {
      return (
        /0\s*<=\s*bucketOrigin\s*<\s*bucketCount/.test(text) &&
        /negative/i.test(text) &&
        /addition/i.test(text) &&
        /subtraction/i.test(text)
      );
    }
    expect(statesBothDirections(source)).toBe(true);
    // Proven live: a comment stating only the invariant, without the negative-k obligation, fails.
    expect(
      statesBothDirections("/** Rotates bucketOrigin. 0 <= bucketOrigin < bucketCount. */"),
    ).toBe(false);
  });
});

describe("streaming-contract — the tier-1 alignment predicate is exact, with no epsilon", () => {
  function countEpsilonTolerances(text: string): number {
    // Matches an `EPSILON` identifier (not the word "epsilon" in prose) and a tolerance-style
    // comparison against a small floating-point literal.
    const matches =
      text.match(/\bEPSILON\b|Math\.abs\([^)]*\)\s*<\s*(0\.\d+|1e-\d+)/g) ?? [];
    return matches.length;
  }

  const EPSILON_FIXTURE = "const aligned = Math.abs(shift - k) < 1e-6;";

  it("finds no tolerance constant in the module; the gate is proven live against a fixture", () => {
    expect(countEpsilonTolerances(source)).toBe(0);
    expect(countEpsilonTolerances(EPSILON_FIXTURE)).toBe(1);
  });

  it("documents the full alignment conjuncts on the tier-selection signature", () => {
    function statesConjuncts(text: string): boolean {
      return (
        /Object\.is/.test(text) &&
        /Number\.isFinite/.test(text) &&
        /Math\.round/.test(text) &&
        /k\s*!==\s*0/.test(text) &&
        /Math\.abs\(k\)\s*<\s*bucketCount/.test(text)
      );
    }
    expect(statesConjuncts(source)).toBe(true);
    // Proven live: a comment omitting the |k| < bucketCount bound fails.
    expect(
      statesConjuncts(
        "/** Object.is zoom identity, Number.isFinite, Math.round integrality, k !== 0. */",
      ),
    ).toBe(false);
  });

  it("selects tier 1 with the exact k for an aligned shift, and tier 2 at or beyond bucketCount", () => {
    const bucketCount = 1024;
    const invBucketWidth = 1;
    const accumulator = { ...createBucketAccumulator(bucketCount), invBucketWidth, domainMin: 0 };

    for (const shift of [1, 1023]) {
      const result = selectTier(accumulator, {
        requestedDomainMin: shift,
        requestedInvBucketWidth: invBucketWidth,
        inGesture: false,
      });
      expect(result).toBe(1);
    }
    for (const shift of [1024, 2048]) {
      const result = selectTier(accumulator, {
        requestedDomainMin: shift,
        requestedInvBucketWidth: invBucketWidth,
        inGesture: false,
      });
      expect(result).toBe(2);
    }
  });
});

describe("streaming-contract — revision is a bucket-layout generation, never a per-sample counter", () => {
  it("documents the increment policy naming both bumping events and excluding ingest/tier 3", () => {
    function statesRevisionPolicy(text: string): boolean {
      return (
        /revision/i.test(text) &&
        /exactly\s*1/.test(text) &&
        /tier-1/i.test(text) &&
        /tier-2/i.test(text) &&
        /never on ingest/i.test(text) &&
        /never on tier 3/i.test(text)
      );
    }
    expect(statesRevisionPolicy(source)).toBe(true);
    expect(statesRevisionPolicy(distSource)).toBe(true);
    // Proven live: a comment stating only "monotonic" fails the same check.
    expect(statesRevisionPolicy("/** revision is monotonic. */")).toBe(false);
  });

  it("leaves revision untouched by the deferred ingest and rebuild entry points", () => {
    const ring = createRawSampleRing(1024);
    const accumulator = createBucketAccumulator(4);
    accumulator.revision = 7;

    expect(() => ingestSample(ring, 0, 0)).toThrow(/change 8/);
    expect(accumulator.revision).toBe(7);

    expect(() => rebuildDomain(accumulator, ring, 0, 1)).toThrow(/change 8/);
    expect(accumulator.revision).toBe(7);

    // The field is observably writable, so the readings above come from a real invariant rather
    // than an accidentally-frozen object.
    accumulator.revision = 8;
    expect(accumulator.revision).toBe(8);
  });
});

describe("streaming-contract — the tier-3 2x zoom boundary is documented, never gated", () => {
  function classifyBucketOversampleUses(text: string): { comparisons: number; defaults: number } {
    const identifierPattern = /\b(bucketOversample|BUCKET_OVERSAMPLE_DEFAULT)\b/g;
    let comparisons = 0;
    let defaults = 0;
    let match: RegExpExecArray | null;
    while ((match = identifierPattern.exec(text)) !== null) {
      const around = text.slice(Math.max(0, match.index - 20), match.index + 40);
      if (/[<>]=?\s*(bucketOversample|BUCKET_OVERSAMPLE_DEFAULT)|(bucketOversample|BUCKET_OVERSAMPLE_DEFAULT)\s*[<>]=?/.test(around)) {
        comparisons += 1;
      } else {
        defaults += 1;
      }
    }
    return { comparisons, defaults };
  }

  const COMPARISON_FIXTURE = "if (zoomFactor > BUCKET_OVERSAMPLE_DEFAULT) { useTier3Bound(); }";

  it("appears only as a default value in the module, never as a gating comparison", () => {
    const real = classifyBucketOversampleUses(source);
    expect(real.comparisons).toBe(0);
    expect(real.defaults).toBeGreaterThan(0);

    const fixture = classifyBucketOversampleUses(COMPARISON_FIXTURE);
    expect(fixture.comparisons).toBe(1);
  });

  it("documents bounding, no fabrication, the mandatory rebuild, and the absence of a gate", () => {
    function statesFidelity(text: string): boolean {
      return (
        /bound/i.test(text) &&
        /fabricat/i.test(text) &&
        /mandatory/i.test(text) &&
        /no gate|not a pass\/fail gate|carries no gate/i.test(text)
      );
    }
    expect(statesFidelity(source)).toBe(true);
  });

  it("neither the source comment nor the verification report claims a measured tier-3 fidelity result", () => {
    const verifyReport = readVerifyReport();
    expect(source).not.toMatch(/measured tier-3 fidelity/i);
    if (verifyReport !== undefined) {
      expect(verifyReport).not.toMatch(/measured tier-3 fidelity (result|of)/i);
    }
  });
});

describe("streaming-contract — MAX_BUCKETS and BUCKET_OVERSAMPLE_DEFAULT are exported named constants", () => {
  it("exports exactly the frozen values", () => {
    expect(MAX_BUCKETS).toBe(8192);
    expect(BUCKET_OVERSAMPLE_DEFAULT).toBe(2);
  });

  it("the bucketCount derivation clamps at both ends", () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [1440, 2880],
      [3840, 7680],
      [100_000, 8192],
    ];
    for (const [viewportWidthPx, expected] of cases) {
      expect(computeBucketCount(viewportWidthPx)).toBe(expected);
    }
    expect(computeBucketCount(3840)).toBeLessThan(MAX_BUCKETS);
    expect(computeBucketCount(100_000)).toBe(MAX_BUCKETS);
  });
});

describe("streaming-contract — this change freezes types and invariants only", () => {
  it("every declared rebuild and ingest entry point throws and leaves state byte-for-byte unchanged", () => {
    const ring = createRawSampleRing(8);
    const accumulator = createBucketAccumulator(4);
    accumulator.min.set([1, 2, 3, 4]);
    accumulator.max.set([5, 6, 7, 8]);
    accumulator.count.set([1, 1, 1, 1]);
    accumulator.bucketOrigin = 1;
    accumulator.revision = 3;

    const minBefore = Array.from(accumulator.min);
    const maxBefore = Array.from(accumulator.max);
    const countBefore = Array.from(accumulator.count);

    expect(() => ingestSample(ring, 1, 2)).toThrow(/change 8/);
    expect(() => rebuildDomain(accumulator, ring, 0, 1)).toThrow(/change 8/);

    expect(Array.from(accumulator.min)).toEqual(minBefore);
    expect(Array.from(accumulator.max)).toEqual(maxBefore);
    expect(Array.from(accumulator.count)).toEqual(countBefore);
    expect(accumulator.bucketOrigin).toBe(1);
    expect(accumulator.revision).toBe(3);
  });

  it("the module performs no indexed write or fill call against min/max/count/x/y", () => {
    function countBufferWrites(text: string): number {
      const patterns = [
        /\b(min|max|count|x|y)\[[^\]]+\]\s*=(?!=)/g,
        /\b(min|max|count|x|y)\.fill\(/g,
      ];
      return patterns.reduce((total, pattern) => total + (text.match(pattern) ?? []).length, 0);
    }
    const WRITE_FIXTURE = "min[i] = 1; max[i] = 2; count.fill(0);";
    expect(countBufferWrites(source)).toBe(0);
    expect(countBufferWrites(WRITE_FIXTURE)).toBe(3);
  });
});

describe("streaming-contract — allocation-free ingest is a frozen invariant, structurally guarded here", () => {
  /**
   * Extracts the body of a named function declaration by locating its opening brace and walking
   * forward to the matching closing brace, so the scan below applies only to the functions that
   * are actually on a hot path — the factories are explicitly allowed to allocate.
   */
  function extractFunctionBody(text: string, functionName: string): string {
    const signatureIndex = text.indexOf(`function ${functionName}(`);
    expect(signatureIndex, `expected to find function ${functionName}`).toBeGreaterThan(-1);
    const braceStart = text.indexOf("{", signatureIndex);
    let depth = 0;
    let i = braceStart;
    for (; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return text.slice(braceStart, i + 1);
  }

  function countBannedConstructs(text: string): number {
    const patterns = [
      /\{\s*[a-zA-Z_]+\s*:/g, // object literal
      /\[[^\]]*,[^\]]*\]/g, // array literal with multiple elements
      /\.\.\.[a-zA-Z_]/g, // spread
      /=>\s*\{/g, // per-call closure (arrow function body)
      /\.subarray\(/g, // subarray view allocation
    ];
    return patterns.reduce((total, pattern) => total + (text.match(pattern) ?? []).length, 0);
  }

  const hotPathFunctions = ["selectTier", "rotateBucketOrigin", "ingestSample", "rebuildDomain"];
  const VIOLATION_FIXTURE =
    "function hot() { const obj = { a: 1 }; const arr = [1, 2]; const s = arr.subarray(0, 1); const f = () => { return obj; }; return { ...obj, s, f }; }";

  it("reports zero banned constructs across every hot-path function; the gate is proven live", () => {
    let total = 0;
    for (const name of hotPathFunctions) {
      total += countBannedConstructs(extractFunctionBody(source, name));
    }
    expect(total).toBe(0);
    expect(countBannedConstructs(VIOLATION_FIXTURE)).toBeGreaterThan(0);
  });

  it("binds the per-sample cost and no-allocation obligation to the implementing change, not as a measurement taken here", () => {
    function statesObligation(text: string): boolean {
      return (
        /O\(new samples\)/.test(text) &&
        /no allocation|allocation-free/i.test(text) &&
        /not measured|is not claimed as measured/i.test(text)
      );
    }
    expect(statesObligation(source)).toBe(true);

    const verifyReport = readVerifyReport();
    if (verifyReport !== undefined) {
      expect(verifyReport).not.toMatch(/measured allocation.*ingest|GC-event result for ingest/i);
    }
  });
});
