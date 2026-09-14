/**
 * Cross-cutting gates scoped to `packages/core/src/transport/**` (`buffer-ownership-protocol`'s
 * implicit performance contract, alongside the project-wide `no any`/`no as never` rule already
 * enforced globally by `eslint.config.js`). Two checks:
 *
 *  - No `any` in any form under `src/transport/**` — already enforced by the unscoped
 *    `@typescript-eslint/no-explicit-any`/`no-restricted-syntax` rules in `eslint.config.js`
 *    (proven live against `test/fixtures/lint-any.ts`/`lint-as-never.ts` by
 *    `test/lint-rules.test.ts`); this test makes that coverage explicit and regression-guarded
 *    for the transport module specifically, the way tasks 2.4/2.8 did for pre-existing brands.
 *  - No object literal, array spread, or `.subarray` call inside the identified hot-path
 *    methods (`submit`, `poll`, `readStats` on the buffer pool) — reusing the
 *    `streaming-contract.test.ts` banned-construct-scan pattern, adapted to shorthand object-
 *    method syntax (`name(...) { ... }`) rather than `function name(...) { ... }` declarations.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const transportDir = path.join(packageRoot, "src", "transport");

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(absolutePath, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(absolutePath);
    }
  }
}

describe("transport module contains no `any` in any form", () => {
  const anyPatterns = [/:\s*any\b/, /\bas\s+any\b/, /<any>/, /,\s*any>/, /\bas\s+never\b/];

  it("finds zero occurrences across every src/transport/**/*.ts file", () => {
    const files: string[] = [];
    walkTsFiles(transportDir, files);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of anyPatterns) {
        expect(pattern.test(source), `${file} matched ${pattern}`).toBe(false);
      }
    }
  });

  it("the same patterns are live against the committed lint-any/lint-as-never fixtures", () => {
    const anyFixture = readFileSync(
      path.join(packageRoot, "test", "fixtures", "lint-any.ts"),
      "utf8",
    );
    const neverFixture = readFileSync(
      path.join(packageRoot, "test", "fixtures", "lint-as-never.ts"),
      "utf8",
    );
    const anyMatches = anyPatterns.some((pattern) => pattern.test(anyFixture));
    const neverMatches = anyPatterns.some((pattern) => pattern.test(neverFixture));
    expect(anyMatches || neverMatches).toBe(true);
  });
});

describe("no banned allocation construct inside submit/poll/readStats", () => {
  /**
   * Extracts a shorthand object-method body (`name(...) { ... }`), unlike
   * `streaming-contract.test.ts`'s sibling extractor which targets `function name(...) { ... }`
   * declarations — `buffer-pool.ts`'s pool methods are object-literal shorthand methods.
   */
  function extractMethodBody(text: string, methodName: string): string {
    const signaturePattern = new RegExp(`\\b${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
    const match = signaturePattern.exec(text);
    expect(match, `expected to find method ${methodName}`).not.toBeNull();
    const braceStart = text.indexOf("{", match!.index);
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
      /\.\.\.[a-zA-Z_]/g, // spread
      /\.subarray\(/g, // subarray view allocation
    ];
    return patterns.reduce((total, pattern) => total + (text.match(pattern) ?? []).length, 0);
  }

  const source = readFileSync(path.join(transportDir, "buffer-pool.ts"), "utf8");
  const hotPathMethods = ["submit", "poll", "readStats"];
  const VIOLATION_FIXTURE =
    "submit(lease) { const obj = { a: 1 }; const s = obj.field.subarray(0, 1); return { ...obj, s }; }";

  it("reports zero banned constructs across submit/poll/readStats; the gate is proven live", () => {
    let total = 0;
    for (const name of hotPathMethods) {
      total += countBannedConstructs(extractMethodBody(source, name));
    }
    expect(total).toBe(0);
    expect(countBannedConstructs(VIOLATION_FIXTURE)).toBeGreaterThan(0);
  });
});
