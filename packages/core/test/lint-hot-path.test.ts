import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Meta-test proving the allocation-free hot-path lint instrument in `eslint.config.js` is
// live, mirroring `lint-rules.test.ts`'s existing pattern for `no-explicit-any`. The hot-path
// selectors are scoped to `packages/core/src/decimation/**`
// only — narrower than the global rules `lint-rules.test.ts` checks — so this fixture's
// permanent committed home under `test/fixtures/` (kept out of the main `eslint .` run by that
// glob's own ignore) is linted via `lintText` with a virtual `filePath` under
// `src/decimation/`, which is what makes the scoped `files` glob match without moving the
// fixture into the published source tree.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const fixtureSource = readFileSync(
  path.join(
    repoRoot,
    "packages/core/test/fixtures/hot-path-violation.ts",
  ),
  "utf8",
);
const virtualFixturePath = path.join(
  repoRoot,
  "packages/core/src/decimation/__hot-path-fixture-proof__.ts",
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

// Full type-aware ESLint runs take noticeably longer than the default 5s test timeout under
// CPU contention from other files in the suite (this file shares a process with several
// multi-second GC-observer test files); a generous explicit timeout keeps the assertion from
// flaking on a busy machine without weakening what it checks.
const LINT_TIMEOUT_MS = 20_000;

describe("lint-hot-path meta-test", () => {
  it(
    "fires no-restricted-syntax on the .subarray-in-a-loop fixture",
    async () => {
      const messages = await lintFixture();
      const subarrayMessage = messages.find(
        (message) => message.ruleId === "no-restricted-syntax" && message.line === 11,
      );
      expect(subarrayMessage).toBeDefined();
      expect(subarrayMessage?.message).toContain("allocates a new view or object");
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "fires no-restricted-syntax on the object-literal-in-a-loop fixture",
    async () => {
      const messages = await lintFixture();
      const objectLiteralMessage = messages.find(
        (message) => message.ruleId === "no-restricted-syntax" && message.line === 21,
      );
      expect(objectLiteralMessage).toBeDefined();
      expect(objectLiteralMessage?.message).toContain("Object literals");
    },
    LINT_TIMEOUT_MS,
  );
});

// The export serializers and the window resolver sit under the same loop-allocation selectors as
// the decimation kernels. Each case lints an inline body at a virtual path under the glob being
// proven, so the scope is shown to be live without placing a violating file in the source tree.
const LOOP_ALLOCATION_BODY = [
  "export function proof(values: Float32Array, count: number): number {",
  "  let total = 0;",
  "  for (let i = 0; i < count; i += 1) {",
  "    const record = { index: i };",
  "    const list = [i];",
  "    const text = `row ${i}`;",
  "    const buffer = new Float32Array(1);",
  "    const fn = () => i;",
  "    total += record.index + list.length + text.length + buffer.length + fn() + (values[i] ?? 0);",
  "  }",
  "  return total;",
  "}",
  "",
].join("\n");

const EXPECTED_LOOP_MESSAGES = [
  { line: 4, fragment: "Object literals" },
  { line: 5, fragment: "Array literals" },
  { line: 6, fragment: "Template literals" },
  { line: 7, fragment: "`new` inside a loop" },
  { line: 8, fragment: "per-call closure" },
];

async function lintInline(source: string, relativePath: string) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
    ignore: false,
  });
  const results = await eslint.lintText(source, {
    filePath: path.join(repoRoot, relativePath),
  });
  return results.flatMap((result) => result.messages);
}

describe("lint-hot-path glob covers the export, window, and streaming hot-path modules", () => {
  // Lint the real committed viewport-interaction files first, before `lintInline` replaces
  // their virtual text in typescript-eslint's shared project-service cache.
  it(
    "the committed interaction.ts and window-invalidation.ts report 0 violations",
    async () => {
      const eslint = new ESLint({
        cwd: repoRoot,
        overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
        ignore: false,
      });
      const results = await eslint.lintFiles([
        "packages/core/src/viewport/interaction.ts",
        "packages/core/src/transport/window-invalidation.ts",
      ]);
      const violations = results.flatMap((result) =>
        result.messages.map((message) => `${result.filePath}:${message.line} ${message.message}`),
      );
      expect(violations).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  for (const relativePath of [
    "packages/core/src/export/__hot-path-fixture-proof__.ts",
    "packages/core/src/viewport/window.ts",
    "packages/core/src/transport/streaming-contract.ts",
    "packages/core/src/transport/materialize.ts",
    "packages/core/src/viewport/interaction.ts",
    "packages/core/src/transport/window-invalidation.ts",
  ]) {
    it(
      `trips every loop-allocation selector at ${relativePath}`,
      async () => {
        const messages = await lintInline(LOOP_ALLOCATION_BODY, relativePath);
        for (const { line, fragment } of EXPECTED_LOOP_MESSAGES) {
          const hit = messages.find(
            (message) =>
              message.ruleId === "no-restricted-syntax" &&
              message.line === line &&
              message.message.includes(fragment),
          );
          expect(hit, `${relativePath}:${line} ${fragment}`).toBeDefined();
        }
      },
      LINT_TIMEOUT_MS,
    );
  }

  for (const relativePath of [
    "packages/core/src/transport/streaming-contract.ts",
    "packages/core/src/transport/materialize.ts",
    "packages/core/src/viewport/interaction.ts",
    "packages/core/src/transport/window-invalidation.ts",
  ]) {
    it(
      `rejects .subarray inside a loop at ${relativePath}`,
      async () => {
        const subarrayBody = [
          "export function proof(values: Float32Array, count: number): number {",
          "  let total = 0;",
          "  for (let i = 0; i < count; i += 1) {",
          "    const view = values.subarray(i, i + 1);",
          "    total += view[0] ?? 0;",
          "  }",
          "  return total;",
          "}",
          "",
        ].join("\n");
        const messages = await lintInline(subarrayBody, relativePath);
        const hit = messages.find(
          (message) =>
            message.ruleId === "no-restricted-syntax" &&
            message.line === 4 &&
            message.message.includes("allocates a new view or object"),
        );
        expect(hit, `${relativePath}:4 subarray`).toBeDefined();
      },
      LINT_TIMEOUT_MS,
    );
  }

  const GENERATOR_BODY = [
    "export function* proof(count: number): Generator<number, void, undefined> {",
    "  for (let i = 0; i < count; i += 1) {",
    "    yield i;",
    "  }",
    "}",
    "",
  ].join("\n");

  // The serializers are generators by contract, so the blanket generator ban of the decimation
  // kernels must not reach them; the resolver is a plain function and keeps the ban.
  it(
    "allows generators under src/export but not in the window resolver",
    async () => {
      const exportMessages = await lintInline(
        GENERATOR_BODY,
        "packages/core/src/export/__hot-path-fixture-proof__.ts",
      );
      expect(
        exportMessages.filter((message) => message.ruleId === "no-restricted-syntax"),
      ).toEqual([]);

      const windowMessages = await lintInline(
        GENERATOR_BODY,
        "packages/core/src/viewport/window.ts",
      );
      expect(
        windowMessages.some(
          (message) =>
            message.ruleId === "no-restricted-syntax" &&
            message.message.includes("Generator"),
        ),
      ).toBe(true);
    },
    LINT_TIMEOUT_MS,
  );
});

// The two viewport-interaction modules join the hot-path glob: the same fixtures that prove the
// rule block is live must fail there, and the committed sources must stay violation-free.
const VIEWPORT_INTERACTION_HOT_PATH_FILES = [
  "packages/core/src/viewport/interaction.ts",
  "packages/core/src/transport/window-invalidation.ts",
] as const;

describe("lint-hot-path glob covers the viewport interaction modules", () => {
  const FOR_OF_BODY = [
    "export function proof(values: Float32Array): number {",
    "  let total = 0;",
    "  for (const value of values) {",
    "    total += value;",
    "  }",
    "  return total;",
    "}",
    "",
  ].join("\n");

  const TRANSCENDENTAL_BODY = [
    "export function proof(count: number): number {",
    "  let total = 0;",
    "  for (let i = 0; i < count; i += 1) {",
    "    total += Math.log10(i + 1);",
    "  }",
    "  return total;",
    "}",
    "",
  ].join("\n");

  for (const relativePath of VIEWPORT_INTERACTION_HOT_PATH_FILES) {
    it(
      `rejects for...of at ${relativePath}`,
      async () => {
        const messages = await lintInline(FOR_OF_BODY, relativePath);
        const hit = messages.find(
          (message) =>
            message.ruleId === "no-restricted-syntax" &&
            message.line === 3 &&
            message.message.includes("for...of"),
        );
        expect(hit, `${relativePath}:3 for...of`).toBeDefined();
      },
      LINT_TIMEOUT_MS,
    );

    it(
      `rejects a transcendental Math call inside a loop at ${relativePath}`,
      async () => {
        const messages = await lintInline(TRANSCENDENTAL_BODY, relativePath);
        const hit = messages.find(
          (message) =>
            message.ruleId === "no-restricted-syntax" &&
            message.line === 4 &&
            message.message.includes("transcendental"),
        );
        expect(hit, `${relativePath}:4 Math.log10`).toBeDefined();
      },
      LINT_TIMEOUT_MS,
    );
  }
});
