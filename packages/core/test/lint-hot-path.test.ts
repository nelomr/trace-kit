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
