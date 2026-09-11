#!/usr/bin/env node
// Guard against a root `exports` field (design.md §D4). The root `package.json` is
// `private: true` and never published, so npm never reads an `exports` map there — the
// brief's root-level `exports["./vue"]` etc. pointing into `packages/*/dist` is dead
// configuration (proposal.md, exploration §1.11/§3.11). This is the kind of plausible-looking
// configuration a future contributor adds in good faith and nobody notices is inert, so it is
// asserted mechanically rather than left to review.
//
// This module no longer runs as a CLI script — `checkNoRootExports` is asserted directly by
// `packages/core/test/catalog-discipline.test.ts` (Vitest) instead of a spawned subprocess.
export function checkNoRootExports(rootPackageJson) {
  if (Object.prototype.hasOwnProperty.call(rootPackageJson, "exports")) {
    return [
      'root package.json must not declare an "exports" field — the root is private:true and ' +
        "is never published, so npm never reads it there (design.md §D4).",
    ];
  }
  return [];
}
