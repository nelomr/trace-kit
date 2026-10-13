/** @vitest-environment node */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENARIO_FIXTURES } from "../../src/fixtures/scenarios.js";

const dir = fileURLToPath(new URL("../visual/__screenshots__/", import.meta.url));

describe("WebGL2 golden corpus", () => {
  it("has no webgl2-*.png without a matching fixture case", () => {
    const ids = new Set(SCENARIO_FIXTURES.map((f) => `webgl2-${f.id}.png`));
    const present = readdirSync(dir).filter((name) => name.startsWith("webgl2-") && name.endsWith(".png"));
    for (const name of present) expect(ids.has(name), name).toBe(true);
  });
});
