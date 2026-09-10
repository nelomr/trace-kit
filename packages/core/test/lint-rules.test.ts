import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Meta-test proving the `any`/`never` ban fires on the committed regression fixtures, driven
// through ESLint's Node API against the same flat config with the `**/test/fixtures/**`
// ignore lifted (design.md §D1.d). The fixtures themselves are excluded from the main
// `eslint .` run (see `eslint.config.js`); this is the only mechanism that keeps them
// permanently committed while still proving the rules are live against them.
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

describe("lint-rules meta-test", () => {
  it("fires @typescript-eslint/no-explicit-any on lint-any.ts", async () => {
    const messages = await lintFixture("packages/core/test/fixtures/lint-any.ts");
    const ruleIds = messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("@typescript-eslint/no-explicit-any");
  });

  it("fires no-restricted-syntax on lint-as-never.ts", async () => {
    const messages = await lintFixture("packages/core/test/fixtures/lint-as-never.ts");
    const ruleIds = messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-syntax");
  });
});
