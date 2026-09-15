import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { median, percentile, runBenchmark } from "../../bench/runner-core.js";

// Proves the isomorphic half of the split (design.md §D9): `runner-core.ts` carries the
// dependency-free warm-up/median-of-N logic and no `node:*` import, so it can be bundled for
// the browser without pulling `node:fs`/`node:os` into the graph.
describe("runner-core", () => {
  it("exports the isomorphic benchmark primitives", () => {
    expect(typeof percentile).toBe("function");
    expect(typeof median).toBe("function");
    expect(typeof runBenchmark).toBe("function");
  });

  it("contains no node:* import at the source level", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.join(dir, "../../bench/runner-core.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from ["']node:/);
  });
});
