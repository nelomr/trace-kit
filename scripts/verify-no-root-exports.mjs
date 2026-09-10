#!/usr/bin/env node
// Guard against a root `exports` field (design.md §D4). The root `package.json` is
// `private: true` and never published, so npm never reads an `exports` map there — the
// brief's root-level `exports["./vue"]` etc. pointing into `packages/*/dist` is dead
// configuration (proposal.md, exploration §1.11/§3.11). This is the kind of plausible-looking
// configuration a future contributor adds in good faith and nobody notices is inert, so it is
// asserted mechanically rather than left to review.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

export function checkNoRootExports(rootPackageJson) {
  if (Object.prototype.hasOwnProperty.call(rootPackageJson, "exports")) {
    return [
      'root package.json must not declare an "exports" field — the root is private:true and ' +
        "is never published, so npm never reads it there (design.md §D4).",
    ];
  }
  return [];
}

function main() {
  const rootPackageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const violations = checkNoRootExports(rootPackageJson);
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exit(1);
  }
  console.log("OK: root package.json has no exports field.");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
