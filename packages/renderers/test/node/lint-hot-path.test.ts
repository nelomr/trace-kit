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
