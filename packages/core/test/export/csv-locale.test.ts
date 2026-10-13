import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportCsv } from "../../src/export/csv.js";
import { buildLocaleFixture } from "../support/csv-fixture.js";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const child = path.join(packageRoot, "test/support/csv-locale-child.ts");

describe("exportCsv under a comma-decimal process locale", () => {
  it("produces the same bytes as the default-locale run", () => {
    let inProcess = "";
    for (const chunk of exportCsv(buildLocaleFixture(), -Infinity, Infinity)) inProcess += chunk;

    const result = spawnSync(process.execPath, ["--import", "tsx", child], {
      cwd: packageRoot,
      env: { ...process.env, LC_ALL: "de_DE.UTF-8", LANG: "de_DE.UTF-8", LANGUAGE: "de_DE" },
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const [probe, body] = result.stdout.split("\u0000");
    // The probe proves the child really runs under a comma-decimal locale; without it a pass
    // would say nothing about locale independence.
    expect(probe).toBe("1,5");
    expect(body).toBe(inProcess);
  }, 30_000);
});
