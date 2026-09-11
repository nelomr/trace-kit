import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Meta-test proving the `any`/`never` ban fires on the committed regression fixtures, driven
// through ESLint's Node API against the same flat config with the `**/test/fixtures/**`
// ignore lifted. Fixture files must intentionally contain banned patterns to prove the rule
// still catches them, so they are excluded from the main `eslint .` run (see
// `eslint.config.js`) to avoid failing normal lint runs; this is the only mechanism that keeps
// them permanently committed while still proving the rules are live against them.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

async function lintFixture(relativePath: string) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
    ignore: false,
  });
  const results = await eslint.lintFiles([path.join(repoRoot, relativePath)]);
  return results.flatMap((result) => result.messages);
}

// Full type-aware ESLint runs take noticeably longer than the default 5s test timeout under
// CPU contention from other files in the suite (this file shares a process with several
// multi-second GC-observer test files); a generous explicit timeout keeps the assertion from
// flaking on a busy machine without weakening what it checks.
const LINT_TIMEOUT_MS = 20_000;

describe("lint-rules meta-test", () => {
  it(
    "fires @typescript-eslint/no-explicit-any on lint-any.ts",
    async () => {
      const messages = await lintFixture("packages/core/test/fixtures/lint-any.ts");
      const ruleIds = messages.map((message) => message.ruleId);
      expect(ruleIds).toContain("@typescript-eslint/no-explicit-any");
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "fires no-restricted-syntax on lint-as-never.ts",
    async () => {
      const messages = await lintFixture("packages/core/test/fixtures/lint-as-never.ts");
      const ruleIds = messages.map((message) => message.ruleId);
      expect(ruleIds).toContain("no-restricted-syntax");
    },
    LINT_TIMEOUT_MS,
  );
});
