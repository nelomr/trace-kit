import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Meta-test proving the allocation-free hot-path lint instrument in `eslint.config.js`, scoped
// to `packages/renderers/src/path/**`, is live and rejects the
// permanent fixture at `test/fixtures/hot-path-violation.ts`. Mirrors the core package's own
// `lint-hot-path.test.ts` pattern exactly: the fixture lives under `test/fixtures/` (kept out of
// the main `eslint .` run by that glob's own ignore) and is linted via `lintText` with a virtual
// `filePath` under `src/path/`, which is what makes the scoped `files` glob match without moving
// the fixture into the published source tree.
//
// `packages/renderers/src/canvas2d/**` (not yet created — phase 7) is intentionally exempt from
// this hot-path block by design: `Canvas2DRenderer.render()` constructs exactly one `Path2D` per
// frame, which is a fixed per-frame cost rather than a per-point hot-path allocation.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../..");
const fixtureSource = readFileSync(
  path.join(repoRoot, "packages/renderers/test/fixtures/hot-path-violation.ts"),
  "utf8",
);
const virtualFixturePath = path.join(
  repoRoot,
  "packages/renderers/src/path/__hot-path-fixture-proof__.ts",
);

async function lintFixture() {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
    ignore: false,
  });
  const results = await eslint.lintText(fixtureSource, {
    filePath: virtualFixturePath,
  });
  return results.flatMap((result) => result.messages);
}

const LINT_TIMEOUT_MS = 20_000;

describe("renderers lint-hot-path meta-test", () => {
  it(
    "fires no-restricted-syntax on the array-literal-in-a-loop fixture, naming the construct",
    async () => {
      const messages = await lintFixture();
      const arrayLiteralMessage = messages.find(
        (message) => message.ruleId === "no-restricted-syntax" && message.line === 12,
      );
      expect(arrayLiteralMessage).toBeDefined();
      expect(arrayLiteralMessage?.message).toContain("Array literals");
    },
    LINT_TIMEOUT_MS,
  );
});

// The WebGL2 frame path sits under the same allocation-free selectors as `src/path/**`, scoped
// to the four per-frame files only: the class and the cold modules construct GL objects, typed
// arrays and strings by design, so a `src/webgl2/**` glob would reject legitimate setup code.
const LOOP_ALLOCATION_BODY = [
  "export function proof(values: Float32Array, count: number): number {",
  "  let total = 0;",
  "  for (let i = 0; i < count; i += 1) {",
  "    const record = { index: i };",
  "    const list = [i];",
  "    const copy = [...list];",
  "    const text = `row ${i}`;",
  "    const buffer = new Float32Array(1);",
  "    const fn = () => i;",
  "    total += record.index + list.length + copy.length + text.length + buffer.length + fn() + (values[i] ?? 0);",
  "  }",
  "  return total;",
  "}",
  "",
].join("\n");

const EXPECTED_LOOP_MESSAGES = [
  { line: 4, fragment: "Object literals" },
  { line: 5, fragment: "Array literals" },
  { line: 6, fragment: "Spread inside a loop" },
  { line: 7, fragment: "Template literals" },
  { line: 8, fragment: "`new` inside a loop" },
  { line: 9, fragment: "per-call closure" },
];

const HOT_WEBGL2_FILES = ["frame.ts", "upload.ts", "precision.ts", "float-bits.ts"];
const COLD_WEBGL2_FILES = [
  "shaders.ts",
  "program.ts",
  "color.ts",
  "hidden-canvas.ts",
  "trace-slot.ts",
  "webgl2-figure-renderer.ts",
];

interface RestrictedSyntaxEntry {
  readonly selector?: string;
}

async function loopSelectorsFor(relativePath: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
    ignore: false,
  });
  const config = (await eslint.calculateConfigForFile(path.join(repoRoot, relativePath))) as {
    rules?: Record<string, unknown>;
  };
  const rule = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(rule)) return [];
  return (rule.slice(1) as RestrictedSyntaxEntry[])
    .map((entry) => entry.selector ?? "")
    .filter((selector) => selector.includes("ForStatement"));
}

describe("renderers lint-hot-path glob covers the WebGL2 frame path", () => {
  it(
    "trips every loop-allocation selector at the virtual webgl2 proof path",
    async () => {
      const eslint = new ESLint({
        cwd: repoRoot,
        overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
        ignore: false,
      });
      const results = await eslint.lintText(LOOP_ALLOCATION_BODY, {
        filePath: path.join(repoRoot, "packages/renderers/src/webgl2/__hot-path-fixture-proof__.ts"),
      });
      const messages = results.flatMap((result) => result.messages);
      for (const expected of EXPECTED_LOOP_MESSAGES) {
        // One line can trip several selectors (`[...list]` is an array literal and a spread).
        const found = messages.some(
          (message) =>
            message.ruleId === "no-restricted-syntax" &&
            message.line === expected.line &&
            message.message.includes(expected.fragment),
        );
        expect(found, `line ${expected.line}: ${expected.fragment}`).toBe(true);
      }
    },
    LINT_TIMEOUT_MS,
  );

  for (const file of HOT_WEBGL2_FILES) {
    it(
      `applies the allocation-free selectors to src/webgl2/${file}`,
      async () => {
        const selectors = await loopSelectorsFor(`packages/renderers/src/webgl2/${file}`);
        expect(selectors.length).toBeGreaterThanOrEqual(6);
      },
      LINT_TIMEOUT_MS,
    );
  }

  for (const file of COLD_WEBGL2_FILES) {
    it(
      `leaves the cold file src/webgl2/${file} outside the allocation-free selectors`,
      async () => {
        const selectors = await loopSelectorsFor(`packages/renderers/src/webgl2/${file}`);
        expect(selectors).toEqual([]);
      },
      LINT_TIMEOUT_MS,
    );
  }
});
